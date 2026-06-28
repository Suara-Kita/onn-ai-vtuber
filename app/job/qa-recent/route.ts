import { redis, QA_KEY, QA_TTL_SECONDS } from "@/lib/redis";

export interface QAEntry {
  job_id: string;
  query: string;
  script: string;
  rag_answer: string;
  qa_answer: string;
  created_at: string;
}

export async function GET() {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const minScore = nowSeconds - QA_TTL_SECONDS;

  let members: string[] = [];
  try {
    members = await redis.zrangebyscore(QA_KEY, minScore, "+inf");
  } catch (err) {
    console.error("[redis] zrangebyscore failed:", (err as Error).message);
  }

  const entries: QAEntry[] = members
    .map((m) => {
      try {
        return JSON.parse(m) as QAEntry;
      } catch {
        return null;
      }
    })
    .filter((e): e is QAEntry => e !== null)
    .reverse(); // newest first

  return Response.json({ entries });
}
