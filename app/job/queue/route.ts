import { NextRequest } from "next/server";
import { triggerJobById } from "@/lib/trigger";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);

  if (!body?.job_id || typeof body.job_id !== "string") {
    return Response.json({ error: "job_id is required" }, { status: 400 });
  }

  const { job_id } = body as { job_id: string };
  const found = await triggerJobById(job_id);

  if (!found) {
    return Response.json({ error: "job_id not found" }, { status: 404 });
  }

  return Response.json({ success: true, job_id });
}
