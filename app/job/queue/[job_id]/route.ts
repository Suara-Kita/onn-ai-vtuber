import { NextRequest } from "next/server";
import { createJob, triggerJob } from "@/lib/job-store";
import { redis, QA_KEY, QA_TTL_SECONDS } from "@/lib/redis";
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

  // In-memory miss — server may have restarted. Fetch from Redis.
  let entry: QAEntry | null = null;
  try {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const minScore = nowSeconds - QA_TTL_SECONDS;
    const members = await redis.zrangebyscore(QA_KEY, minScore, "+inf");
    for (const m of members) {
      try {
        const parsed = JSON.parse(m) as QAEntry;
        if (parsed.job_id === job_id) { entry = parsed; break; }
      } catch { /* skip malformed */ }
    }
  } catch (err) {
    console.error("[redis] queue lookup failed:", (err as Error).message);
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
