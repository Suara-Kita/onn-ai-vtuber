import { redis, QA_KEY } from "@/lib/redis";

export interface QAEntry {
  job_id: string;
  query: string;
  script: string;
  rag_answer: string;
  qa_answer: string;
  panel_analysis: string;
  created_at: string;
}

export async function GET() {
  let members: string[] = [];
  try {
    members = await redis.zrange(QA_KEY, 0, -1);
  } catch (err) {
    console.error("[redis] zrange failed:", (err as Error).message);
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
