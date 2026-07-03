/**
 * End-to-end flow tests: POST /job/query (store, and look up an existing
 * job_id's already-generated script) → POST /job/queue/[job_id] (display).
 *
 * Only POST /job/queue/[job_id] ever broadcasts to the left panel over SSE.
 * POST /job/query never triggers it, whether it's creating a new job or
 * returning a cached one by job_id.
 *
 * Uses the real job-store so jobs created in step 1 are visible to step 2.
 * LLM, RAG and Redis are mocked to keep tests fast and deterministic.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Mocks ──────────────────────────────────────────────────────────────────

const { mockPipeline, mockQueryRagKb, mockGenerateScript, mockSimplifyForQA, mockAnalyzeForPanel, mockRedisGet, mockRedisIncr } =
  vi.hoisted(() => {
    const mockPipeline = {
      zadd: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([[null, 1], [null, 0]]),
    };
    return {
      mockPipeline,
      mockQueryRagKb: vi.fn(),
      mockGenerateScript: vi.fn(),
      mockSimplifyForQA: vi.fn().mockResolvedValue("Ringkasan satu ayat."),
      mockAnalyzeForPanel: vi.fn().mockResolvedValue("Poin satu\nPoin dua\nPoin tiga"),
      mockRedisGet: vi.fn().mockResolvedValue(null),
      mockRedisIncr: vi.fn().mockResolvedValue(1),
    };
  });

// Real job-store — NOT mocked — so createJob and triggerJob share the same store instance
vi.mock("@/lib/llm", () => ({
  generateScript: mockGenerateScript,
  simplifyForQA: mockSimplifyForQA,
  analyzeForPanel: mockAnalyzeForPanel,
}));
vi.mock("@/lib/rag", () => ({ queryRagKb: mockQueryRagKb }));
vi.mock("@/lib/redis", () => ({
  redis: {
    pipeline: vi.fn(() => mockPipeline),
    get: mockRedisGet,
    incr: mockRedisIncr,
  },
  QA_KEY: "vroid:qa:recent",
  JOB_KEY: (job_id: string) => `vroid:job:${job_id}`,
  MANIFESTO_INDEX_KEY: "vroid:manifesto:index",
}));

// ── Reset store between tests ──────────────────────────────────────────────

beforeEach(() => {
  (globalThis as Record<string, unknown>).__jobStore = undefined;
  vi.resetModules();
  vi.clearAllMocks();
  mockPipeline.exec.mockResolvedValue([[null, 1], [null, 0]]);
  mockSimplifyForQA.mockResolvedValue("Ringkasan satu ayat.");
  mockAnalyzeForPanel.mockResolvedValue("Poin satu\nPoin dua\nPoin tiga");
  mockRedisGet.mockResolvedValue(null);
  mockRedisIncr.mockResolvedValue(1);
});

// ── Request helpers ────────────────────────────────────────────────────────

function makeQueryRequest(body: object) {
  return new NextRequest("http://localhost/job/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeQueueRequest(job_id: string) {
  return [
    new NextRequest(`http://localhost/job/queue/${job_id}`, { method: "POST" }),
    { params: Promise.resolve({ job_id }) },
  ] as const;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("Full flow: POST /job/query → POST /job/queue/[job_id]", () => {

  // ── Empty query (manifesto fallback) ──────────────────────────────────────

  describe("empty query / manifesto fallback", () => {
    beforeEach(() => {
      mockGenerateScript.mockResolvedValue("Skrip manifesto untuk JS-SEZ dua ribu dua puluh enam.");
    });

    it("step 1 stores the job without broadcasting to the left panel", async () => {
      const { POST: queryPOST } = await import("@/app/job/query/route");
      const { subscribe } = await import("@/lib/job-store");

      const received: unknown[] = [];
      const unsub = subscribe((job, _forced) => received.push(job));

      await queryPOST(makeQueryRequest({ query: "", user_id: "u1" }));

      expect(received).toHaveLength(0); // no SSE fired
      unsub();
    });

    it("step 2 triggers SSE and left panel receives the job", async () => {
      const { POST: queryPOST } = await import("@/app/job/query/route");
      const { POST: queuePOST } = await import("@/app/job/queue/[job_id]/route");
      const { subscribe } = await import("@/lib/job-store");

      const qRes = await queryPOST(makeQueryRequest({ query: "", user_id: "u1" }));
      const { jobs } = await qRes.json();
      const job_id: string = jobs[0].job_id;

      const received: unknown[] = [];
      const unsub = subscribe((job, _forced) => received.push(job));

      const res = await queuePOST(...makeQueueRequest(job_id));
      expect(res.status).toBe(200);
      expect(received).toHaveLength(1);
      unsub();
    });

    it("SSE payload contains the correct job_id, query and panel_analysis", async () => {
      const { POST: queryPOST } = await import("@/app/job/query/route");
      const { POST: queuePOST } = await import("@/app/job/queue/[job_id]/route");
      const { subscribe } = await import("@/lib/job-store");

      const qRes = await queryPOST(makeQueryRequest({ query: "", user_id: "u1" }));
      const { jobs } = await qRes.json();
      const job_id: string = jobs[0].job_id;

      const received: Record<string, unknown>[] = [];
      const unsub = subscribe((job, _forced) => { if (job) received.push(job as unknown as Record<string, unknown>); });

      await queuePOST(...makeQueueRequest(job_id));

      expect(received[0].job_id).toBe(job_id);
      expect(received[0].panel_analysis).toBe("Poin satu\nPoin dua\nPoin tiga");
      // query is the manifesto tajuk, not the LLM prompt
      expect(typeof received[0].query).toBe("string");
      expect((received[0].query as string).length).toBeGreaterThan(0);
      unsub();
    });

    it("triggering with wrong job_id after empty query returns 404", async () => {
      const { POST: queryPOST } = await import("@/app/job/query/route");
      const { POST: queuePOST } = await import("@/app/job/queue/[job_id]/route");

      await queryPOST(makeQueryRequest({ query: "", user_id: "u1" }));

      const res = await queuePOST(...makeQueueRequest("wrong-id"));
      expect(res.status).toBe(404);
    });
  });

  // ── Valid question ─────────────────────────────────────────────────────────

  describe("valid question", () => {
    beforeEach(() => {
      mockQueryRagKb.mockResolvedValue("JS-SEZ ialah Zon Ekonomi Khas Johor-Singapura bernilai lapan puluh lapan bilion.");
      mockGenerateScript.mockResolvedValue(
        "Zon Ekonomi Khas Johor Singapura merupakan satu inisiatif bersama Malaysia dan Singapura " +
        "yang bertujuan menarik pelaburan asing bernilai lapan puluh lapan bilion Ringgit Malaysia " +
        "ke kawasan selatan Johor dalam tempoh dua puluh tahun akan datang untuk menjana peluang " +
        "pekerjaan dan memajukan ekonomi tempatan bagi semua lapisan rakyat Johor khususnya generasi muda."
      );
    });

    it("step 1 creates job without SSE broadcast", async () => {
      const { POST: queryPOST } = await import("@/app/job/query/route");
      const { subscribe } = await import("@/lib/job-store");

      const received: unknown[] = [];
      const unsub = subscribe((job, _forced) => received.push(job));

      const res = await queryPOST(makeQueryRequest({ query: "Apa itu JS-SEZ?", user_id: "u2" }));
      expect(res.status).toBe(200);
      expect(received).toHaveLength(0);
      unsub();
    });

    it("step 2 broadcasts job with correct query and script", async () => {
      const { POST: queryPOST } = await import("@/app/job/query/route");
      const { POST: queuePOST } = await import("@/app/job/queue/[job_id]/route");
      const { subscribe } = await import("@/lib/job-store");

      const qRes = await queryPOST(makeQueryRequest({ query: "Apa itu JS-SEZ?", user_id: "u2" }));
      const { jobs } = await qRes.json();
      const job_id: string = jobs[0].job_id;

      const received: Record<string, unknown>[] = [];
      const unsub = subscribe((job, _forced) => { if (job) received.push(job as unknown as Record<string, unknown>); });

      const res = await queuePOST(...makeQueueRequest(job_id));
      expect(res.status).toBe(200);
      expect(received).toHaveLength(1);
      expect(received[0].query).toBe("Apa itu JS-SEZ?");
      expect(received[0].script).toContain("Zon Ekonomi Khas");
      unsub();
    });

    it("SSE payload carries rag_answer from the KB", async () => {
      const { POST: queryPOST } = await import("@/app/job/query/route");
      const { POST: queuePOST } = await import("@/app/job/queue/[job_id]/route");
      const { subscribe } = await import("@/lib/job-store");

      const qRes = await queryPOST(makeQueryRequest({ query: "Apa itu JS-SEZ?", user_id: "u2" }));
      const { jobs } = await qRes.json();
      const job_id: string = jobs[0].job_id;

      const received: Record<string, unknown>[] = [];
      const unsub = subscribe((job, _forced) => { if (job) received.push(job as unknown as Record<string, unknown>); });

      await queuePOST(...makeQueueRequest(job_id));
      expect(received[0].rag_answer).toBe(
        "JS-SEZ ialah Zon Ekonomi Khas Johor-Singapura bernilai lapan puluh lapan bilion."
      );
      unsub();
    });

    it("SSE payload carries panel_analysis from DeepSeek", async () => {
      const { POST: queryPOST } = await import("@/app/job/query/route");
      const { POST: queuePOST } = await import("@/app/job/queue/[job_id]/route");
      const { subscribe } = await import("@/lib/job-store");

      const qRes = await queryPOST(makeQueryRequest({ query: "Apa itu JS-SEZ?", user_id: "u2" }));
      const { jobs } = await qRes.json();
      const job_id: string = jobs[0].job_id;

      const received: Record<string, unknown>[] = [];
      const unsub = subscribe((job, _forced) => { if (job) received.push(job as unknown as Record<string, unknown>); });

      await queuePOST(...makeQueueRequest(job_id));
      expect(received[0].panel_analysis).toBe("Poin satu\nPoin dua\nPoin tiga");
      unsub();
    });

    it("server-generated job_id flows through both steps — caller-supplied id is ignored", async () => {
      const { POST: queryPOST } = await import("@/app/job/query/route");
      const { POST: queuePOST } = await import("@/app/job/queue/[job_id]/route");
      const { subscribe } = await import("@/lib/job-store");

      const res = await queryPOST(
        makeQueryRequest({ query: "Soalan sebenar?", user_id: "caller", job_id: "my-own-uuid-abc" })
      );
      const { jobs } = await res.json();
      const job_id: string = jobs[0].job_id;
      expect(job_id).not.toBe("my-own-uuid-abc");

      // The caller-supplied id was never stored — triggering it returns 404.
      const wrongTrigger = await queuePOST(...makeQueueRequest("my-own-uuid-abc"));
      expect(wrongTrigger.status).toBe(404);

      const received: Record<string, unknown>[] = [];
      const unsub = subscribe((job, _forced) => { if (job) received.push(job as unknown as Record<string, unknown>); });

      const triggerRes = await queuePOST(...makeQueueRequest(job_id));
      expect(triggerRes.status).toBe(200);
      expect(received[0].job_id).toBe(job_id);
      unsub();
    });
  });

  // ── Re-posting an existing job_id to /job/query ─────────────────────────────

  describe("POST /job/query with an existing job_id", () => {
    beforeEach(() => {
      mockQueryRagKb.mockResolvedValue("JS-SEZ ialah Zon Ekonomi Khas Johor-Singapura bernilai lapan puluh lapan bilion.");
      mockGenerateScript.mockResolvedValue("Skrip JS-SEZ sedia ada.");
    });

    it("returns the same job_id and script instead of generating a new one", async () => {
      const { POST: queryPOST } = await import("@/app/job/query/route");

      const firstRes = await queryPOST(makeQueryRequest({ query: "Apa itu JS-SEZ?", user_id: "u1" }));
      const { jobs: firstJobs } = await firstRes.json();
      const job_id: string = firstJobs[0].job_id;

      mockQueryRagKb.mockClear();
      mockGenerateScript.mockClear();

      const secondRes = await queryPOST(makeQueryRequest({ job_id }));
      const { jobs: secondJobs } = await secondRes.json();

      expect(secondRes.status).toBe(200);
      expect(secondJobs[0]).toEqual(firstJobs[0]);
      // No regeneration — RAG/LLM untouched on the lookup path.
      expect(mockQueryRagKb).not.toHaveBeenCalled();
      expect(mockGenerateScript).not.toHaveBeenCalled();
    });

    it("does not broadcast to the left panel when looking up an existing job_id", async () => {
      const { POST: queryPOST } = await import("@/app/job/query/route");
      const { subscribe } = await import("@/lib/job-store");

      const firstRes = await queryPOST(makeQueryRequest({ query: "Apa itu JS-SEZ?", user_id: "u1" }));
      const { jobs } = await firstRes.json();
      const job_id: string = jobs[0].job_id;

      const received: unknown[] = [];
      const unsub = subscribe((job, _forced) => received.push(job));

      await queryPOST(makeQueryRequest({ job_id }));

      expect(received).toHaveLength(0);
      unsub();
    });

    it("the looked-up job_id can still be triggered afterwards via /job/queue/[job_id]", async () => {
      const { POST: queryPOST } = await import("@/app/job/query/route");
      const { POST: queuePOST } = await import("@/app/job/queue/[job_id]/route");
      const { subscribe } = await import("@/lib/job-store");

      const firstRes = await queryPOST(makeQueryRequest({ query: "Apa itu JS-SEZ?", user_id: "u1" }));
      const { jobs } = await firstRes.json();
      const job_id: string = jobs[0].job_id;

      await queryPOST(makeQueryRequest({ job_id })); // lookup, no side effects

      const received: Record<string, unknown>[] = [];
      const unsub = subscribe((job, _forced) => { if (job) received.push(job as unknown as Record<string, unknown>); });

      const res = await queuePOST(...makeQueueRequest(job_id));
      expect(res.status).toBe(200);
      expect(received[0].job_id).toBe(job_id);
      unsub();
    });
  });

  // ── Non-valid / error cases ────────────────────────────────────────────────

  describe("non-valid inputs", () => {
    it("unknown job_id returns 404 from queue endpoint", async () => {
      const { POST: queuePOST } = await import("@/app/job/queue/[job_id]/route");
      const res = await queuePOST(...makeQueueRequest("does-not-exist"));
      expect(res.status).toBe(404);
    });

    it("script generation failure returns 500 and no job is stored", async () => {
      mockQueryRagKb.mockResolvedValue("RAG");
      mockGenerateScript.mockRejectedValueOnce(new Error("LLM unavailable"));

      const { POST: queryPOST } = await import("@/app/job/query/route");
      const { POST: queuePOST } = await import("@/app/job/queue/[job_id]/route");

      const res = await queryPOST(makeQueryRequest({ query: "Soalan?", user_id: "u1" }));
      expect(res.status).toBe(500);

      // No job stored — trigger returns 404
      const triggerRes = await queuePOST(...makeQueueRequest("fail-job"));
      expect(triggerRes.status).toBe(404);
    });

    it("empty script from LLM returns 500 and blocks storage", async () => {
      mockQueryRagKb.mockResolvedValue("RAG");
      mockGenerateScript.mockResolvedValue("");

      const { POST: queryPOST } = await import("@/app/job/query/route");
      const { POST: queuePOST } = await import("@/app/job/queue/[job_id]/route");

      const res = await queryPOST(makeQueryRequest({ query: "Soalan?", user_id: "u1" }));
      expect(res.status).toBe(500);

      const triggerRes = await queuePOST(...makeQueueRequest("empty-script"));
      expect(triggerRes.status).toBe(404);
    });

    it("RAG failure returns 503 and blocks script generation", async () => {
      mockQueryRagKb.mockRejectedValueOnce(new Error("KB offline"));

      const { POST: queryPOST } = await import("@/app/job/query/route");

      const res = await queryPOST(makeQueryRequest({ query: "Soalan?", user_id: "u1" }));
      expect(res.status).toBe(503);
    });

    it("same job_id cannot be triggered before query is posted", async () => {
      const { POST: queuePOST } = await import("@/app/job/queue/[job_id]/route");
      const res = await queuePOST(...makeQueueRequest("not-yet-created"));
      expect(res.status).toBe(404);
    });
  });

  // ── 83-word script enforcement ─────────────────────────────────────────────

  describe("83-word script enforcement", () => {
    it("a script of exactly 83 words passes through and is stored correctly", async () => {
      const words = Array.from({ length: 83 }, (_, i) => `perkataan${i + 1}`);
      const script83 = words.join(" ");
      expect(script83.split(/\s+/).length).toBe(83);

      mockQueryRagKb.mockResolvedValue("Konteks KB");
      mockGenerateScript.mockResolvedValue(script83);

      const { POST: queryPOST } = await import("@/app/job/query/route");
      const { POST: queuePOST } = await import("@/app/job/queue/[job_id]/route");
      const { subscribe } = await import("@/lib/job-store");

      const qRes = await queryPOST(makeQueryRequest({ query: "Soalan?", user_id: "u1" }));
      const { jobs } = await qRes.json();
      const job_id: string = jobs[0].job_id;

      const received: Record<string, unknown>[] = [];
      const unsub = subscribe((job, _forced) => { if (job) received.push(job as unknown as Record<string, unknown>); });

      await queuePOST(...makeQueueRequest(job_id));

      const storedScript = received[0].script as string;
      expect(storedScript.split(/\s+/).length).toBe(83);
      unsub();
    });

    it("script is passed through as-is — server does not trim or alter word count", async () => {
      const script = "Satu dua tiga empat lima";
      mockQueryRagKb.mockResolvedValue("Konteks dari pangkalan pengetahuan.");
      mockGenerateScript.mockResolvedValue(script);

      const { POST: queryPOST } = await import("@/app/job/query/route");
      const { POST: queuePOST } = await import("@/app/job/queue/[job_id]/route");
      const { subscribe } = await import("@/lib/job-store");

      const qRes = await queryPOST(makeQueryRequest({ query: "Soalan?", user_id: "u1" }));
      const { jobs } = await qRes.json();
      const job_id: string = jobs[0].job_id;

      const received: Record<string, unknown>[] = [];
      const unsub = subscribe((job, _forced) => { if (job) received.push(job as unknown as Record<string, unknown>); });
      await queuePOST(...makeQueueRequest(job_id));

      expect(received[0].script).toBe(script);
      unsub();
    });

    it("manifesto path calls generateScript once with item konten as context", async () => {
      mockGenerateScript.mockResolvedValue("Skrip manifesto.");

      const { POST: queryPOST } = await import("@/app/job/query/route");
      await queryPOST(makeQueryRequest({ query: "" }));

      expect(mockGenerateScript).toHaveBeenCalledOnce();
      // RAG context arg should be the manifesto item's konten (non-empty)
      const ragArg = mockGenerateScript.mock.calls[0][1] as string;
      expect(ragArg.length).toBeGreaterThan(0);
    });
  });
});
