import { NextRequest } from "next/server";
import { randomUUID } from "crypto";
import { createJob } from "@/lib/job-store";
import { redis, QA_KEY, QA_TTL_SECONDS, JOB_KEY } from "@/lib/redis";
import { queryRagKb } from "@/lib/rag";
import { generateScript, simplifyForQA, analyzeForPanel } from "@/lib/llm";
import manifestoItems from "@/manifesto.json";

interface ManifestoItem { teras: string; tajuk: string; konten: string[] }
const manifesto = manifestoItems as ManifestoItem[];

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);

  let query: string = body?.query ?? "";
  const user_id: string = body?.user_id || "anonymous";
  const job_id = (body?.job_id as string | undefined) || randomUUID();

  // Empty query (any user_id) — pick a random manifesto item; skip KB
  const isManifesto = !query.trim();
  let llmPrompt = query;
  // simplifyForQA gets separate inputs so the QnA bar shows a clean 1-sentence answer:
  // - manifesto path: tajuk as question + konten as context (actual content to summarize)
  // - real query path: user's question + KB answer
  let simplifyQuery = query;
  let simplifyContext = "";
  if (isManifesto) {
    const item = manifesto[Math.floor(Math.random() * manifesto.length)];
    query = item.tajuk;
    llmPrompt = `Terangkan tentang "${item.tajuk}" di bawah teras ${item.teras} dalam manifesto BN Johor PRN 2026.`;
    simplifyQuery = item.tajuk;
    simplifyContext = item.konten.join(" ");
  }

  // RAG KB only for real user queries — manifesto prompts are self-contained
  const rag_answer = isManifesto ? "" : await queryRagKb(query).catch((err: Error) => {
    console.error("[rag] KB query failed:", err.message);
    return "";
  });

  if (!isManifesto) {
    simplifyQuery = query;
    simplifyContext = rag_answer;
  }

  // Step 2: generate TTS script and short QA bar answer in parallel, both grounded in KB
  // simplifyForQA failure must never block job creation — it degrades to empty string.
  // generateScript throws on empty content, so if it resolves, script is guaranteed non-empty.
  let script: string, qa_answer: string, panel_analysis: string;
  try {
    [script, qa_answer, panel_analysis] = await Promise.all([
      generateScript(llmPrompt, rag_answer),
      simplifyForQA(simplifyQuery, simplifyContext).catch(() => ""),
      analyzeForPanel(llmPrompt, rag_answer).catch(() => ""),
    ]);
  } catch (err) {
    console.error("[llm] script generation failed:", (err as Error).message);
    return Response.json({ error: "script generation failed" }, { status: 500 });
  }

  if (!script) return Response.json({ error: "script generation failed" }, { status: 500 });

  const created_at = new Date();
  createJob({ job_id, script, query, user_id, rag_answer, qa_answer, panel_analysis, created_at });

  // Store Q&A in Redis sorted set — score = Unix seconds for time-window queries
  const score = Math.floor(created_at.getTime() / 1000);
  const member = JSON.stringify({ job_id, query, script, rag_answer, qa_answer, panel_analysis, created_at: created_at.toISOString() });
  await redis
    .pipeline()
    .zadd(QA_KEY, score, member)
    .zremrangebyscore(QA_KEY, "-inf", score - QA_TTL_SECONDS)
    // Direct key for O(1) job_id lookup in queue/[job_id]
    .set(JOB_KEY(job_id), member, "EX", QA_TTL_SECONDS)
    .exec()
    .catch((err: Error) => console.error("[redis] zadd failed:", err.message));

  return Response.json({ jobs: [{ job_id, script, rag_answer, qa_answer, panel_analysis }] });
}
