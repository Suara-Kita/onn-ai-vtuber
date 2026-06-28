import { NextRequest } from "next/server";
import { createJob, triggerJob } from "@/lib/job-store";
import { redis, JOB_KEY } from "@/lib/redis";
import type { QAEntry } from "@/app/job/qa-recent/route";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ job_id: string }> }
) {
  const { job_id } = await params;

  if (!job_id) {
    return Response.json({ error: "job_id is required" }, { status: 400 });
  }

  // Try in-memory first (fast path) — forced=true bypasses LeftPanel dedup
  if (triggerJob(job_id, true)) {
    return Response.json({ success: true, job_id });
  }

  // In-memory miss — server may have restarted. Direct O(1) lookup by job_id.
  let entry: QAEntry | null = null;
  try {
    const raw = await redis.get(JOB_KEY(job_id));
    if (raw) entry = JSON.parse(raw) as QAEntry;
  } catch (err) {
    console.error("[redis] job lookup failed:", (err as Error).message);
  }

  if (!entry) {
    return Response.json({ error: "job_id not found" }, { status: 404 });
  }

  // Rehydrate into memory store so triggerJob can broadcast it
  createJob({
    job_id: entry.job_id,
    script: entry.script,
    query: entry.query,
    user_id: "remote",
    rag_answer: entry.rag_answer ?? "",
    qa_answer: entry.qa_answer ?? "",
    panel_analysis: entry.panel_analysis ?? "",
    created_at: new Date(entry.created_at),
  });

  triggerJob(job_id, true);
  return Response.json({ success: true, job_id });
}
