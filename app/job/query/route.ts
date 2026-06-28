import { NextRequest } from "next/server";
import { randomUUID } from "crypto";
import { createJob, triggerJob } from "@/lib/job-store";
import { redis, QA_KEY, QA_TTL_SECONDS } from "@/lib/redis";
import { queryRagKb } from "@/lib/rag";
import { generateScript, simplifyForQA } from "@/lib/llm";
import manifestoItems from "@/manifesto.json";

interface ManifestoItem { teras: string; tajuk: string; konten: string[] }
const manifesto = manifestoItems as ManifestoItem[];

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);

  let query: string = body?.query ?? "";
  const user_id: string = body?.user_id || "anonymous";

  // Empty query (any user_id) — pick a random manifesto item; skip KB
  const isManifesto = !query.trim();
  let llmPrompt = query;
  if (isManifesto) {
    const item = manifesto[Math.floor(Math.random() * manifesto.length)];
    query = item.tajuk;
    llmPrompt = `Terangkan tentang "${item.tajuk}" di bawah teras ${item.teras} dalam manifesto BN Johor PRN 2026.`;
  }

  // RAG KB only for real user queries — manifesto prompts are self-contained
  const rag_answer = isManifesto ? "" : await queryRagKb(query).catch((err: Error) => {
    console.error("[rag] KB query failed:", err.message);
    return "";
  });

  // Step 2: generate TTS script and short QA bar answer in parallel, both grounded in KB
  // simplifyForQA failure must never block job creation — it degrades to empty string.
  // generateScript throws on empty content, so if it resolves, script is guaranteed non-empty.
  const [script, qa_answer] = await Promise.all([
    generateScript(llmPrompt, rag_answer),
    simplifyForQA(llmPrompt, rag_answer).catch(() => ""),
  ]);

  if (!script) return Response.json({ error: "script generation failed" }, { status: 500 });

  const job_id = randomUUID();
  const created_at = new Date();
  createJob({ job_id, script, query, user_id, rag_answer, qa_answer, created_at });

  // Store Q&A in Redis sorted set — score = Unix seconds for 3-min window queries
  const score = Math.floor(created_at.getTime() / 1000);
  const member = JSON.stringify({ job_id, query, script, rag_answer, qa_answer, created_at: created_at.toISOString() });
  await redis
    .pipeline()
    .zadd(QA_KEY, score, member)
    .zremrangebyscore(QA_KEY, "-inf", score - QA_TTL_SECONDS)
    .exec()
    .catch((err: Error) => console.error("[redis] zadd failed:", err.message));

  // Auto-broadcast to all SSE subscribers
  triggerJob(job_id);

  return Response.json({ jobs: [{ job_id, script, rag_answer, qa_answer }] });
}
