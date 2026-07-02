import { NextRequest } from "next/server";
import { randomUUID } from "crypto";
import { createJob } from "@/lib/job-store";
import { redis, QA_KEY, JOB_KEY } from "@/lib/redis";
import { queryRagKb } from "@/lib/rag";
import { generateScript, simplifyForQA, analyzeForPanel } from "@/lib/llm";
import manifestoItems from "@/manifesto.json";

interface ManifestoItem { teras: string; tajuk: string; konten: string[] }
const manifesto = manifestoItems as ManifestoItem[];
let manifestoIndex = 0;

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);

  let query: string = body?.query ?? "";
  const user_id: string = body?.user_id || "anonymous";
  // job_id is always server-generated — a caller-supplied id would let two
  // different scripts silently overwrite each other under the same key.
  const job_id = randomUUID();

  // Empty query (any user_id) — pick a random manifesto item; skip KB
  const isManifesto = !query.trim();
  let llmPrompt = query;
  // simplifyForQA gets separate inputs so the QnA bar shows a clean 1-sentence answer:
  // - manifesto path: tajuk as question + konten as context (actual content to summarize)
  // - real query path: user's question + KB answer
  let simplifyQuery = query;
  let simplifyContext = "";
  if (isManifesto) {
    const item = manifesto[manifestoIndex % manifesto.length];
    console.log(`[manifesto] index=${manifestoIndex} → "${item.tajuk}"`);
    manifestoIndex++;
    query = item.tajuk;
    llmPrompt = item.tajuk;
    simplifyQuery = item.tajuk;
    simplifyContext = item.konten.join(" ");
  }

  let rag_answer = isManifesto ? simplifyContext : "";
  if (!isManifesto) {
    rag_answer = await queryRagKb(query).catch((err: Error) => {
      console.error("[rag] KB query failed:", err.message);
      return "";
    });
    if (!rag_answer) {
      return Response.json({ error: "Pangkalan pengetahuan tidak tersedia. Sila cuba sebentar lagi." }, { status: 503 });
    }
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
    // Direct key for O(1) job_id lookup in queue/[job_id] — no expiry, jobs
    // must remain fetchable whenever the streaming client gets around to them.
    .set(JOB_KEY(job_id), member)
    .exec()
    .catch((err: Error) => console.error("[redis] zadd failed:", err.message));

  return Response.json({ jobs: [{ job_id, script, rag_answer, qa_answer, panel_analysis }] });
}
