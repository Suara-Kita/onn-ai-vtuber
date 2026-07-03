import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import manifestoItems from "@/manifesto.json";

const { mockCreateJob, mockGetJob, mockRedisGet, mockRedisIncr, mockPipeline, mockQueryRagKb, mockGenerateScript, mockSimplifyForQA, mockAnalyzeForPanel } =
  vi.hoisted(() => {
    const mockPipeline = {
      zadd: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([[null, 1], [null, 0]]),
    };
    return {
      mockCreateJob: vi.fn(),
      mockGetJob: vi.fn().mockReturnValue(undefined),
      mockRedisGet: vi.fn().mockResolvedValue(null),
      mockRedisIncr: vi.fn().mockResolvedValue(1),
      mockPipeline,
      mockQueryRagKb: vi.fn(),
      mockGenerateScript: vi.fn(),
      mockSimplifyForQA: vi.fn().mockResolvedValue("ringkasan"),
      mockAnalyzeForPanel: vi.fn().mockResolvedValue("Fakta pertama\nFakta kedua\nFakta ketiga"),
    };
  });

vi.mock("@/lib/rag", () => ({ queryRagKb: mockQueryRagKb }));
vi.mock("@/lib/llm", () => ({
  generateScript: mockGenerateScript,
  simplifyForQA: mockSimplifyForQA,
  analyzeForPanel: mockAnalyzeForPanel,
}));
vi.mock("@/lib/redis", () => ({
  redis: { pipeline: vi.fn(() => mockPipeline), get: mockRedisGet, incr: mockRedisIncr },
  QA_KEY: "vroid:qa:recent",
  JOB_KEY: (job_id: string) => `vroid:job:${job_id}`,
  MANIFESTO_INDEX_KEY: "vroid:manifesto:index",
}));
vi.mock("@/lib/job-store", () => ({
  createJob: mockCreateJob,
  getJob: mockGetJob,
}));

import { POST } from "@/app/job/query/route";
import { redis } from "@/lib/redis";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeRequest(body: object) {
  return new NextRequest("http://localhost/job/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("POST /job/query", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPipeline.exec.mockResolvedValue([[null, 1], [null, 0]]);
    mockGetJob.mockReturnValue(undefined);
    mockRedisGet.mockResolvedValue(null);
    mockRedisIncr.mockResolvedValue(1);
  });

  // ── Manifesto fallback (empty query) ────────────────────────────────────

  describe("empty query — manifesto fallback", () => {
    beforeEach(() => {
      mockGenerateScript.mockResolvedValue("Skrip manifesto.");
    });

    it("returns 200 when query is empty string", async () => {
      const res = await POST(makeRequest({ query: "", user_id: "u1" }));
      expect(res.status).toBe(200);
    });

    it("returns 200 when query is missing entirely", async () => {
      const res = await POST(makeRequest({ user_id: "u1" }));
      expect(res.status).toBe(200);
    });

    it("returns 200 when body is invalid JSON", async () => {
      const req = new NextRequest("http://localhost/job/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not-json",
      });
      const res = await POST(req);
      expect(res.status).toBe(200);
    });

    it("does not call queryRagKb on manifesto path", async () => {
      await POST(makeRequest({ query: "", user_id: "u1" }));
      expect(mockQueryRagKb).not.toHaveBeenCalled();
    });

    it("stored query is the manifesto tajuk, not the LLM prompt", async () => {
      await POST(makeRequest({ query: "", user_id: "u1" }));
      const storedQuery: string = mockCreateJob.mock.calls[0][0].query;
      expect(storedQuery).not.toMatch(/^Terangkan tentang/);
      expect(storedQuery.length).toBeGreaterThan(0);
    });

    it("ignores a caller-supplied job_id and generates its own UUID", async () => {
      const res = await POST(makeRequest({ query: "", user_id: "u1", job_id: "caller-supplied-id" }));
      const { jobs } = await res.json();
      expect(jobs[0].job_id).not.toBe("caller-supplied-id");
      expect(jobs[0].job_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it("generates a UUID job_id when none is supplied", async () => {
      const res = await POST(makeRequest({ query: "", user_id: "u1" }));
      const { jobs } = await res.json();
      expect(jobs[0].job_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it("generates a different job_id on every call, even for identical input", async () => {
      const res1 = await POST(makeRequest({ query: "", user_id: "u1" }));
      const res2 = await POST(makeRequest({ query: "", user_id: "u1" }));
      const { jobs: jobs1 } = await res1.json();
      const { jobs: jobs2 } = await res2.json();
      expect(jobs1[0].job_id).not.toBe(jobs2[0].job_id);
    });

    it("stores the job but does not touch the left panel — only /job/queue/[job_id] triggers SSE", async () => {
      await POST(makeRequest({ query: "", user_id: "u1" }));
      expect(mockCreateJob).toHaveBeenCalledOnce();
    });

    it("includes panel_analysis in the response", async () => {
      const res = await POST(makeRequest({ query: "", user_id: "u1" }));
      const { jobs } = await res.json();
      expect(jobs[0]).toHaveProperty("panel_analysis");
      expect(jobs[0].panel_analysis).toBe("Fakta pertama\nFakta kedua\nFakta ketiga");
    });

    it("stores panel_analysis in the Redis member JSON", async () => {
      await POST(makeRequest({ query: "", user_id: "u1" }));
      const memberStr = mockPipeline.zadd.mock.calls[0][2] as string;
      const member = JSON.parse(memberStr);
      expect(member.panel_analysis).toBe("Fakta pertama\nFakta kedua\nFakta ketiga");
    });

    it("increments the manifesto index in Redis so it persists across restarts", async () => {
      await POST(makeRequest({ query: "", user_id: "u1" }));
      expect(mockRedisIncr).toHaveBeenCalledWith("vroid:manifesto:index");
    });

    it("still returns a job when the Redis incr call fails", async () => {
      mockRedisIncr.mockRejectedValueOnce(new Error("Redis down"));
      const res = await POST(makeRequest({ query: "", user_id: "u1" }));
      expect(res.status).toBe(200);
    });

    it("cycles through manifesto items 0 through 10 in order across consecutive requests", async () => {
      // Fake Redis INCR: a real counter that increments on every call, the
      // same contract redis.incr gives us in production.
      let counter = 0;
      mockRedisIncr.mockImplementation(async () => ++counter);

      for (let i = 0; i <= 10; i++) {
        await POST(makeRequest({ query: "", user_id: "u1" }));
        const storedQuery: string = mockCreateJob.mock.calls[i][0].query;
        expect(storedQuery).toBe(manifestoItems[i].tajuk);
      }
    });
  });

  // ── Existing job_id lookup ────────────────────────────────────────────────

  describe("caller-supplied job_id that matches an existing job", () => {
    const existingJob = {
      job_id: "2ebc30ce-986e-4875-a8ef-9cf49c5430b0",
      script: "Skrip sedia ada.",
      query: "Soalan asal?",
      user_id: "u1",
      rag_answer: "Jawapan RAG asal.",
      qa_answer: "Ringkasan asal.",
      panel_analysis: "Analisis asal.",
      created_at: new Date(),
    };

    it("returns the same job_id and its already-generated script, in-memory hit", async () => {
      mockGetJob.mockReturnValue(existingJob);

      const res = await POST(makeRequest({ job_id: existingJob.job_id }));
      const { jobs } = await res.json();

      expect(res.status).toBe(200);
      expect(jobs[0]).toEqual({
        job_id: existingJob.job_id,
        script: existingJob.script,
        rag_answer: existingJob.rag_answer,
        qa_answer: existingJob.qa_answer,
        panel_analysis: existingJob.panel_analysis,
      });
    });

    it("does not call the LLM or RAG when returning a cached job", async () => {
      mockGetJob.mockReturnValue(existingJob);

      await POST(makeRequest({ job_id: existingJob.job_id }));

      expect(mockQueryRagKb).not.toHaveBeenCalled();
      expect(mockGenerateScript).not.toHaveBeenCalled();
    });

    it("does not create a new job or write to Redis when returning a cached job", async () => {
      mockGetJob.mockReturnValue(existingJob);

      await POST(makeRequest({ job_id: existingJob.job_id }));

      expect(mockCreateJob).not.toHaveBeenCalled();
      expect(mockPipeline.zadd).not.toHaveBeenCalled();
    });

    it("falls back to Redis when the job isn't in memory (server restarted)", async () => {
      mockGetJob.mockReturnValue(undefined);
      mockRedisGet.mockResolvedValue(JSON.stringify({
        job_id: existingJob.job_id,
        query: existingJob.query,
        script: existingJob.script,
        rag_answer: existingJob.rag_answer,
        qa_answer: existingJob.qa_answer,
        panel_analysis: existingJob.panel_analysis,
        created_at: existingJob.created_at.toISOString(),
      }));

      const res = await POST(makeRequest({ job_id: existingJob.job_id }));
      const { jobs } = await res.json();

      expect(jobs[0].job_id).toBe(existingJob.job_id);
      expect(jobs[0].script).toBe(existingJob.script);
      // Rehydrates into memory so future lookups are O(1) again.
      expect(mockCreateJob).toHaveBeenCalledWith(
        expect.objectContaining({ job_id: existingJob.job_id })
      );
    });

    it("falls through to generating a new job when job_id matches nothing in memory or Redis", async () => {
      mockGetJob.mockReturnValue(undefined);
      mockRedisGet.mockResolvedValue(null);
      mockGenerateScript.mockResolvedValue("Skrip manifesto baharu.");

      const res = await POST(makeRequest({ query: "", job_id: "unknown-job-id" }));
      const { jobs } = await res.json();

      expect(res.status).toBe(200);
      expect(jobs[0].job_id).not.toBe("unknown-job-id");
      expect(mockGenerateScript).toHaveBeenCalledOnce();
    });
  });

  // ── Valid query (real question) ──────────────────────────────────────────

  describe("valid query — RAG + LLM path", () => {
    beforeEach(() => {
      mockQueryRagKb.mockResolvedValue("Sekijang mendapat peruntukan RM45 juta untuk infrastruktur.");
      mockGenerateScript.mockResolvedValue("Skrip TTS Sekijang lapan belas kilometer.");
    });

    it("returns 200 with jobs array", async () => {
      const res = await POST(makeRequest({ query: "Soalan tentang Sekijang?", user_id: "u1" }));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data.jobs)).toBe(true);
      expect(data.jobs).toHaveLength(1);
    });

    it("calls queryRagKb with the exact query string", async () => {
      await POST(makeRequest({ query: "Apakah status jalan Sekijang?", user_id: "u1" }));
      expect(mockQueryRagKb).toHaveBeenCalledWith("Apakah status jalan Sekijang?");
    });

    it("passes query and RAG context to generateScript", async () => {
      await POST(makeRequest({ query: "Apakah status jalan Sekijang?", user_id: "u1" }));
      expect(mockGenerateScript).toHaveBeenCalledWith(
        "Apakah status jalan Sekijang?",
        "Sekijang mendapat peruntukan RM45 juta untuk infrastruktur."
      );
    });

    it("passes query and RAG context to analyzeForPanel", async () => {
      await POST(makeRequest({ query: "Apakah status jalan Sekijang?", user_id: "u1" }));
      expect(mockAnalyzeForPanel).toHaveBeenCalledWith(
        "Apakah status jalan Sekijang?",
        "Sekijang mendapat peruntukan RM45 juta untuk infrastruktur."
      );
    });

    it("ignores a caller-supplied job_id, even for a valid query", async () => {
      await POST(makeRequest({ query: "Soalan?", user_id: "u1", job_id: "caller-uuid-valid" }));
      expect(mockCreateJob).not.toHaveBeenCalledWith(
        expect.objectContaining({ job_id: "caller-uuid-valid" })
      );
    });

    it("response contains job_id, script, rag_answer, qa_answer, panel_analysis", async () => {
      const res = await POST(makeRequest({ query: "Soalan?", user_id: "u1" }));
      const { jobs } = await res.json();
      expect(jobs[0]).toHaveProperty("job_id");
      expect(jobs[0]).toHaveProperty("script");
      expect(jobs[0]).toHaveProperty("rag_answer");
      expect(jobs[0]).toHaveProperty("qa_answer");
      expect(jobs[0]).toHaveProperty("panel_analysis");
    });

    it("defaults user_id to anonymous when omitted", async () => {
      await POST(makeRequest({ query: "Soalan?" }));
      expect(mockCreateJob).toHaveBeenCalledWith(
        expect.objectContaining({ user_id: "anonymous" })
      );
    });

    it("stores all fields in Redis member JSON", async () => {
      await POST(makeRequest({ query: "Apakah Sekijang?", user_id: "u1" }));
      const memberStr = mockPipeline.zadd.mock.calls[0][2] as string;
      const member = JSON.parse(memberStr);
      expect(member.query).toBe("Apakah Sekijang?");
      expect(member.script).toBe("Skrip TTS Sekijang lapan belas kilometer.");
      expect(member.rag_answer).toBe("Sekijang mendapat peruntukan RM45 juta untuk infrastruktur.");
      expect(member.panel_analysis).toBe("Fakta pertama\nFakta kedua\nFakta ketiga");
      expect(member.job_id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it("stores the job but does not touch the left panel — only /job/queue/[job_id] triggers SSE", async () => {
      await POST(makeRequest({ query: "Soalan?", user_id: "u1" }));
      expect(mockCreateJob).toHaveBeenCalledOnce();
    });
  });

  // ── Parallel LLM processing ──────────────────────────────────────────────

  describe("parallel processing", () => {
    beforeEach(() => {
      mockQueryRagKb.mockResolvedValue("RAG context");
      mockGenerateScript.mockResolvedValue("Script");
    });

    it("generateScript, simplifyForQA and analyzeForPanel all run in parallel", async () => {
      const order: string[] = [];
      mockGenerateScript.mockImplementation(async () => {
        order.push("script-start");
        await Promise.resolve();
        order.push("script-end");
        return "Script";
      });
      mockSimplifyForQA.mockImplementation(async () => {
        order.push("simplify-start");
        await Promise.resolve();
        order.push("simplify-end");
        return "ringkasan";
      });
      mockAnalyzeForPanel.mockImplementation(async () => {
        order.push("panel-start");
        await Promise.resolve();
        order.push("panel-end");
        return "Fakta";
      });

      await POST(makeRequest({ query: "Soalan?", user_id: "u1" }));

      // All three started before any finished
      expect(order.indexOf("script-start")).toBeLessThan(order.indexOf("simplify-end"));
      expect(order.indexOf("simplify-start")).toBeLessThan(order.indexOf("script-end"));
      expect(order.indexOf("panel-start")).toBeLessThan(order.indexOf("script-end"));
    });

    it("analyzeForPanel failure is isolated — job still created", async () => {
      mockAnalyzeForPanel.mockRejectedValueOnce(new Error("DeepSeek timeout"));
      const res = await POST(makeRequest({ query: "Soalan?", user_id: "u1" }));
      expect(res.status).toBe(200);
      expect(mockCreateJob).toHaveBeenCalledWith(
        expect.objectContaining({ panel_analysis: "" })
      );
    });

    it("simplifyForQA failure is isolated — job still created", async () => {
      mockSimplifyForQA.mockRejectedValueOnce(new Error("timeout"));
      const res = await POST(makeRequest({ query: "Soalan?", user_id: "u1" }));
      expect(res.status).toBe(200);
      expect(mockCreateJob).toHaveBeenCalledWith(
        expect.objectContaining({ qa_answer: "" })
      );
    });
  });

  // ── Non-valid / error cases ──────────────────────────────────────────────

  describe("non-valid inputs and error cases", () => {
    it("returns 500 when generateScript returns empty string", async () => {
      mockQueryRagKb.mockResolvedValue("RAG");
      mockGenerateScript.mockResolvedValue("");
      const res = await POST(makeRequest({ query: "Soalan?", user_id: "u1" }));
      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error).toMatch(/script generation failed/);
    });

    it("returns 500 when generateScript throws", async () => {
      mockQueryRagKb.mockResolvedValue("RAG");
      mockGenerateScript.mockRejectedValueOnce(new Error("OpenRouter 500"));
      const res = await POST(makeRequest({ query: "Soalan?", user_id: "u1" }));
      expect(res.status).toBe(500);
    });

    it("does not call createJob when script generation fails", async () => {
      mockQueryRagKb.mockResolvedValue("RAG");
      mockGenerateScript.mockResolvedValue("");
      await POST(makeRequest({ query: "Soalan?", user_id: "u1" }));
      expect(mockCreateJob).not.toHaveBeenCalled();
    });

    it("RAG returning empty string returns 503 and blocks script generation", async () => {
      mockQueryRagKb.mockResolvedValue("");
      const res = await POST(makeRequest({ query: "Soalan tidak dikenali?", user_id: "u1" }));
      expect(res.status).toBe(503);
    });

    it("does not throw if Redis pipeline fails", async () => {
      mockQueryRagKb.mockResolvedValue("RAG");
      mockGenerateScript.mockResolvedValue("Skrip");
      mockPipeline.exec.mockRejectedValueOnce(new Error("Redis down"));
      await expect(POST(makeRequest({ query: "Q?", user_id: "u1" }))).resolves.toBeDefined();
    });
  });

  // ── Redis storage ────────────────────────────────────────────────────────

  describe("Redis storage", () => {
    beforeEach(() => {
      mockQueryRagKb.mockResolvedValue("RAG answer");
      mockGenerateScript.mockResolvedValue("TTS script");
    });

    it("writes to Redis sorted set with Unix timestamp score", async () => {
      const before = Math.floor(Date.now() / 1000);
      await POST(makeRequest({ query: "Q?", user_id: "u1" }));
      const after = Math.floor(Date.now() / 1000);

      expect(redis.pipeline).toHaveBeenCalled();
      const score = mockPipeline.zadd.mock.calls[0][1] as number;
      expect(score).toBeGreaterThanOrEqual(before);
      expect(score).toBeLessThanOrEqual(after);
    });

    it("stores the job under its key with no expiry", async () => {
      await POST(makeRequest({ query: "Q?", user_id: "u1" }));
      const setArgs = mockPipeline.set.mock.calls[0];
      expect(setArgs).toHaveLength(2); // key, value only — no EX/TTL arg
    });
  });
});
