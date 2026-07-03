import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { mockTriggerJob, mockCreateJob } = vi.hoisted(() => ({
  mockTriggerJob: vi.fn(),
  mockCreateJob: vi.fn(),
}));

const { mockRedisGet } = vi.hoisted(() => ({
  mockRedisGet: vi.fn(),
}));

vi.mock("@/lib/job-store", () => ({
  triggerJob: mockTriggerJob,
  createJob: mockCreateJob,
}));

vi.mock("@/lib/redis", () => ({
  redis: { get: mockRedisGet },
  QA_KEY: "vroid:qa:recent",
  JOB_KEY: (job_id: string) => `vroid:job:${job_id}`,
}));

import { POST } from "@/app/job/queue/route";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRequest(body: object) {
  return new NextRequest("http://localhost/job/queue", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const SAMPLE_ENTRY = {
  job_id: "abc-123",
  query: "Apa itu JS-SEZ?",
  script: "JS-SEZ ialah...",
  rag_answer: "Jawatan Sel Ekonomi...",
  qa_answer: "Zon ekonomi khas di Johor",
  panel_analysis: "Pelaburan RM88 bilion",
  created_at: new Date().toISOString(),
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /job/queue", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockRedisGet.mockResolvedValue(null);
  });

  // ── Input validation ──────────────────────────────────────────────────────

  describe("input validation", () => {
    it("returns 400 when body is invalid JSON", async () => {
      const req = new NextRequest("http://localhost/job/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not-json",
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it("returns 400 when job_id is missing from body", async () => {
      const res = await POST(makeRequest({}));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toMatch(/job_id is required/);
    });

    it("returns 400 when body is empty object", async () => {
      const res = await POST(makeRequest({}));
      expect(res.status).toBe(400);
    });

    it("does not call triggerJob when validation fails", async () => {
      await POST(makeRequest({}));
      expect(mockTriggerJob).not.toHaveBeenCalled();
    });
  });

  // ── In-memory fast path ───────────────────────────────────────────────────

  describe("in-memory fast path", () => {
    it("returns 200 when job is found in memory", async () => {
      mockTriggerJob.mockReturnValue(true);
      const res = await POST(makeRequest({ job_id: "valid-id" }));
      expect(res.status).toBe(200);
    });

    it("response body contains success:true and the job_id", async () => {
      mockTriggerJob.mockReturnValue(true);
      const res = await POST(makeRequest({ job_id: "valid-id" }));
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.job_id).toBe("valid-id");
    });

    it("calls triggerJob with forced=true", async () => {
      mockTriggerJob.mockReturnValue(true);
      await POST(makeRequest({ job_id: "specific-job-id-abc" }));
      expect(mockTriggerJob).toHaveBeenCalledWith("specific-job-id-abc", true);
    });

    it("does not query Redis when in-memory hit succeeds", async () => {
      mockTriggerJob.mockReturnValue(true);
      await POST(makeRequest({ job_id: "valid-id" }));
      expect(mockRedisGet).not.toHaveBeenCalled();
    });

    it("calls triggerJob exactly once per request", async () => {
      mockTriggerJob.mockReturnValue(true);
      await POST(makeRequest({ job_id: "valid-id" }));
      expect(mockTriggerJob).toHaveBeenCalledOnce();
    });
  });

  // ── Redis fallback (in-memory miss) ──────────────────────────────────────

  describe("Redis fallback", () => {
    beforeEach(() => {
      // First triggerJob call (memory) misses; second call (after rehydration) succeeds
      mockTriggerJob.mockReturnValueOnce(false).mockReturnValueOnce(true);
    });

    it("queries Redis when in-memory miss", async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify(SAMPLE_ENTRY));
      await POST(makeRequest({ job_id: "abc-123" }));
      expect(mockRedisGet).toHaveBeenCalledWith("vroid:job:abc-123");
    });

    it("returns 404 when job_id is not found in the store or Redis", async () => {
      mockRedisGet.mockResolvedValue(null);
      const res = await POST(makeRequest({ job_id: "unknown-id" }));
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toMatch(/not found/);
    });

    it("rehydrates matching entry via createJob", async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify(SAMPLE_ENTRY));
      await POST(makeRequest({ job_id: "abc-123" }));
      expect(mockCreateJob).toHaveBeenCalledWith(
        expect.objectContaining({
          job_id: "abc-123",
          script: SAMPLE_ENTRY.script,
          query: SAMPLE_ENTRY.query,
          user_id: "remote",
        })
      );
    });

    it("returns 200 after successful rehydration and trigger", async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify(SAMPLE_ENTRY));
      const res = await POST(makeRequest({ job_id: "abc-123" }));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.job_id).toBe("abc-123");
    });

    it("returns 404 when Redis throws", async () => {
      mockRedisGet.mockRejectedValue(new Error("redis down"));
      const res = await POST(makeRequest({ job_id: "abc-123" }));
      expect(res.status).toBe(404);
    });

    it("returns 404 on malformed Redis member without throwing", async () => {
      mockRedisGet.mockResolvedValue("not-json");
      const res = await POST(makeRequest({ job_id: "abc-123" }));
      expect(res.status).toBe(404);
    });
  });
});
