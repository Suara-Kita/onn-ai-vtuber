import { NextRequest } from "next/server";
import { triggerJobById } from "@/lib/trigger";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ job_id: string }> }
) {
  const { job_id } = await params;

  if (!job_id) {
    return Response.json({ error: "job_id is required" }, { status: 400 });
  }

  const found = await triggerJobById(job_id);
  if (!found) {
    return Response.json({ error: "job_id not found" }, { status: 404 });
  }

  return Response.json({ success: true, job_id });
}
