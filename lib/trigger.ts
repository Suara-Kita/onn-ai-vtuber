import { createJob, triggerJob } from "@/lib/job-store";
import { redis, JOB_KEY } from "@/lib/redis";
import type { QAEntry } from "@/app/job/qa-recent/route";

// Fast path: in-memory hit. Fallback: rehydrate from Redis (server may have
// restarted, or this process never held the job in memory). Shared by both
// the path-based and body-based queue endpoints so their lookup behavior
// can't drift apart again.
export async function triggerJobById(job_id: string): Promise<boolean> {
  if (triggerJob(job_id, true)) return true;

  let entry: QAEntry | null = null;
  try {
    const raw = await redis.get(JOB_KEY(job_id));
    if (raw) entry = JSON.parse(raw) as QAEntry;
  } catch (err) {
    console.error("[redis] job lookup failed:", (err as Error).message);
  }

  if (!entry) return false;

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

  return triggerJob(job_id, true);
}
