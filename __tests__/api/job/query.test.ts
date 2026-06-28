import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// vi.mock factories are hoisted — declare mocks with vi.hoisted so they're
// available inside the factory closures before the file is executed.
const { mockCreateJob, mockTriggerJob, mockPipeline, mockQueryRagKb, mockGenerateScript, mockSimplifyForQA } =
  vi.hoisted(() => {
    const mockPipeline = {
      zadd: vi.fn().mockReturnThis(),
      zremrangebyscore: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([[null, 1], [null, 0]]),
    };
    return {
      mockCreateJob: vi.fn(),
      mockTriggerJob: vi.fn().mockReturnValue(true),
      mockPipeline,
      mockQueryRagKb: vi.fn(),
      mockGenerateScript: vi.fn(),
      mockSimplifyForQA: vi.fn().mockResolvedValue("ringkasan"),
    };
  });

vi.mock("@/lib/rag", () => ({ queryRagKb: mockQueryRagKb }));
vi.mock("@/lib/llm", () => ({ generateScript: mockGenerateScript, simplifyForQA: mockSimplifyForQA }));
vi.mock("@/lib/redis", () => ({
  redis: { pipeline: vi.fn(() => mockPipeline) },
  QA_KEY: "vroid:qa:recent",
  QA_TTL_SECONDS: 180,
}));
vi.mock("@/lib/job-store", () => ({
  createJob: mockCreateJob,
  triggerJob: mockTriggerJob,
}));

import { POST } from "@/app/job/query/route";
import { redis, QA_KEY } from "@/lib/redis";

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
  });

  // ── Manifesto fallback ───────────────────────────────────────────────────

  describe("manifesto fallback", () => {
    beforeEach(() => {
      mockGenerateScript.mockResolvedValue("Skrip manifesto.");
    });

    it("returns 200 when body is invalid JSON (manifesto fallback)", async () => {
      const req = new NextRequest("http://localhost/job/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not-json",
      });
      const res = await POST(req);
      expect(res.status).toBe(200);
    });

    it("returns 200 when query is empty (manifesto fallback)", async () => {
      const res = await POST(makeRequest({ query: "", user_id: "u1" }));
      expect(res.status).toBe(200);
    });

    it("returns 200 when query is missing (manifesto fallback)", async () => {
      const res = await POST(makeRequest({ user_id: "u1" }));
      expect(res.status).toBe(200);
    });

    it("returns 200 and defaults user_id to anonymous when missing", async () => {
      mockQueryRagKb.mockResolvedValue("RAG");
      const res = await POST(makeRequest({ query: "Apa projek Sekijang?" }));
      expect(res.status).toBe(200);
      expect(mockCreateJob).toHaveBeenCalledWith(
        expect.objectContaining({ user_id: "anonymous" })
      );
    });

    it("does not call queryRagKb on manifesto path", async () => {
      await POST(makeRequest({ query: "", user_id: "u1" }));
      expect(mockQueryRagKb).not.toHaveBeenCalled();
    });

    it("stored query is the tajuk, not the full LLM prompt", async () => {
      await POST(makeRequest({ query: "", user_id: "u1" }));
      const storedQuery: string = mockCreateJob.mock.calls[0][0].query;
      expect(storedQuery).not.toMatch(/^Terangkan tentang/);
      expect(storedQuery.length).toBeGreaterThan(0);
    });
  });

  // ── Parallel processing ─────────────────────────────────────────────────

  describe("parallel RAG + script processing", () => {
    beforeEach(() => {
      mockQueryRagKb.mockResolvedValue("Sekijang mendapat peruntukan RM45 juta.");
      mockGenerateScript.mockResolvedValue("Skrip TTS Sekijang lapan belas kilometer.");
    });

    it("generateScript and simplifyForQA run in parallel (not sequential)", async () => {
      const order: string[] = [];
      mockGenerateScript.mockImplementation(async () => {
        order.push("script-start");
        await Promise.resolve();
        order.push("script-end");
        return "LLM script";
      });
      mockSimplifyForQA.mockImplementation(async () => {
        order.push("simplify-start");
        await Promise.resolve();
        order.push("simplify-end");
        return "ringkasan";
      });

      await POST(makeRequest({ query: "Soalan?", user_id: "u1" }));

      // Both started before either finished
      expect(order.indexOf("script-start")).toBeLessThan(order.indexOf("simplify-end"));
      expect(order.indexOf("simplify-start")).toBeLessThan(order.indexOf("script-end"));
    });

    it("passes the query to queryRagKb", async () => {
      const q = "Apakah status jalan Sekijang?";
      await POST(makeRequest({ query: q, user_id: "u1" }));
      expect(mockQueryRagKb).toHaveBeenCalledWith(q);
    });

    it("passes the query and rag_answer to generateScript", async () => {
      const q = "Apakah status jalan Sekijang?";
      await POST(makeRequest({ query: q, user_id: "u1" }));
      expect(mockGenerateScript).toHaveBeenCalledWith(q, "Sekijang mendapat peruntukan RM45 juta.");
    });
  });

  // ── Output shape ────────────────────────────────────────────────────────

  describe("response output", () => {
    beforeEach(() => {
      mockQueryRagKb.mockResolvedValue("RAG context answer");
      mockGenerateScript.mockResolvedValue("Generated TTS script for Sekijang");
    });

    it("returns 200 with jobs array", async () => {
      const res = await POST(makeRequest({ query: "Soalan?", user_id: "u1" }));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toHaveProperty("jobs");
      expect(Array.isArray(data.jobs)).toBe(true);
      expect(data.jobs).toHaveLength(1);
    });

    it("response job contains job_id, script, and rag_answer", async () => {
      const res = await POST(makeRequest({ query: "Soalan?", user_id: "u1" }));
      const { jobs } = await res.json();
      expect(jobs[0]).toHaveProperty("job_id");
      expect(jobs[0].script).toBe("Generated TTS script for Sekijang");
      expect(jobs[0].rag_answer).toBe("RAG context answer");
    });

    it("job_id is a valid UUID", async () => {
      const res = await POST(makeRequest({ query: "Soalan?", user_id: "u1" }));
      const { jobs } = await res.json();
      expect(jobs[0].job_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
    });
  });

  // ── Job store ───────────────────────────────────────────────────────────

  describe("job store", () => {
    beforeEach(() => {
      mockQueryRagKb.mockResolvedValue("RAG");
      mockGenerateScript.mockResolvedValue("Script");
    });

    it("creates a job with all required fields", async () => {
      await POST(makeRequest({ query: "Q?", user_id: "user-42" }));
      expect(mockCreateJob).toHaveBeenCalledWith(
        expect.objectContaining({
          job_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
          query: "Q?",
          user_id: "user-42",
          script: "Script",
          rag_answer: "RAG",
          created_at: expect.any(Date),
        })
      );
    });

    it("auto-triggers SSE broadcast after creating the job", async () => {
      await POST(makeRequest({ query: "Q?", user_id: "u1" }));
      const jobId = mockCreateJob.mock.calls[0][0].job_id;
      expect(mockTriggerJob).toHaveBeenCalledWith(jobId);
    });

    it("triggers SSE after creating the job (not before)", async () => {
      const callOrder: string[] = [];
      mockCreateJob.mockImplementation(() => { callOrder.push("create"); });
      mockTriggerJob.mockImplementation(() => { callOrder.push("trigger"); return true; });

      await POST(makeRequest({ query: "Q?", user_id: "u1" }));
      expect(callOrder).toEqual(["create", "trigger"]);
    });
  });

  // ── Redis storage ───────────────────────────────────────────────────────

  describe("Redis Q&A storage", () => {
    beforeEach(() => {
      mockQueryRagKb.mockResolvedValue("RAG answer");
      mockGenerateScript.mockResolvedValue("TTS script");
    });

    it("writes to Redis sorted set with Unix timestamp score", async () => {
      const before = Math.floor(Date.now() / 1000);
      await POST(makeRequest({ query: "Q?", user_id: "u1" }));
      const after = Math.floor(Date.now() / 1000);

      expect(redis.pipeline).toHaveBeenCalled();
      expect(mockPipeline.zadd).toHaveBeenCalledWith(
        QA_KEY,
        expect.any(Number),
        expect.any(String)
      );
      const score = mockPipeline.zadd.mock.calls[0][1] as number;
      expect(score).toBeGreaterThanOrEqual(before);
      expect(score).toBeLessThanOrEqual(after);
    });

    it("stores query, script and rag_answer in the Redis member JSON", async () => {
      await POST(makeRequest({ query: "Apakah Sekijang?", user_id: "u1" }));
      const memberStr = mockPipeline.zadd.mock.calls[0][2] as string;
      const member = JSON.parse(memberStr);
      expect(member.query).toBe("Apakah Sekijang?");
      expect(member.script).toBe("TTS script");
      expect(member.rag_answer).toBe("RAG answer");
      expect(member.job_id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it("prunes entries older than 3 minutes on every write", async () => {
      await POST(makeRequest({ query: "Q?", user_id: "u1" }));
      const score = mockPipeline.zadd.mock.calls[0][1] as number;
      expect(mockPipeline.zremrangebyscore).toHaveBeenCalledWith(
        QA_KEY,
        "-inf",
        score - 180
      );
    });

    it("does not throw if Redis pipeline fails", async () => {
      mockPipeline.exec.mockRejectedValueOnce(new Error("Redis down"));
      await expect(
        POST(makeRequest({ query: "Q?", user_id: "u1" }))
      ).resolves.toBeDefined();
    });
  });
});
