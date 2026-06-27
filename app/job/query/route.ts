import { NextRequest } from "next/server";
import { randomUUID } from "crypto";
import { createJob, triggerJob, triggerIdle } from "@/lib/job-store";
import { redis, QA_KEY, QA_TTL_SECONDS } from "@/lib/redis";
import { queryRagKb } from "@/lib/rag";
import { generateScript } from "@/lib/llm";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);

  let query: string = body?.query ?? "";
  let user_id: string = body?.user_id ?? "";

  if (!query.trim()) {
    const teras = Math.floor(Math.random() * 6) + 1;
    query = `Apakah isi utama Teras ${teras} sahaja dalam manifesto Johor PRN 2026?`;
    user_id = user_id.trim() || "system";
  }

  if (!user_id.trim()) {
    try { triggerIdle(); } catch { /* stale subscriber on hot reload */ }
    return Response.json({ idle: true });
  }

  // Query RAG KB and generate TTS script in parallel
  const [rag_answer, script] = await Promise.all([
    queryRagKb(query),
    generateScript(query),
  ]);

  const job_id = randomUUID();
  const created_at = new Date();
  createJob({ job_id, script, query, user_id, rag_answer, created_at });

  // Store Q&A in Redis sorted set — score = Unix seconds for 3-min window queries
  const score = Math.floor(created_at.getTime() / 1000);
  const member = JSON.stringify({ job_id, query, script, rag_answer, created_at: created_at.toISOString() });
  await redis
    .pipeline()
    .zadd(QA_KEY, score, member)
    .zremrangebyscore(QA_KEY, "-inf", score - QA_TTL_SECONDS)
    .exec()
    .catch((err: Error) => console.error("[redis] zadd failed:", err.message));

  // Auto-broadcast to all SSE subscribers
  triggerJob(job_id);

  return Response.json({ jobs: [{ job_id, script, rag_answer }] });
}
