import { subscribe } from "@/lib/job-store";

// Server-Sent Events — UI connects here to receive screen-change triggers
export async function GET() {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (data: string) => {
        try {
          controller.enqueue(encoder.encode(data));
        } catch {
          // client disconnected
        }
      };

      // Send initial connection confirmation
      send("data: {\"connected\":true}\n\n");

      // Subscribe to job triggers — auto-fired by POST /job/query or /job/queue/:id
      const unsubscribe = subscribe((job, forced) => {
        const payload = job
          ? JSON.stringify({ job_id: job.job_id, script: job.script, query: job.query, user_id: job.user_id, rag_answer: job.rag_answer, qa_answer: job.qa_answer, forced })
          : JSON.stringify({ idle: true });
        send(`data: ${payload}\n\n`);
      });

      // Keepalive every 25s to prevent proxy timeouts
      const keepalive = setInterval(() => {
        send(": keepalive\n\n");
      }, 25000);

      return () => {
        unsubscribe();
        clearInterval(keepalive);
      };
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
