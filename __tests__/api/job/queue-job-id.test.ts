import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { mockTriggerJob, mockCreateJob } = vi.hoisted(() => ({
  mockTriggerJob: vi.fn(),
  mockCreateJob: vi.fn(),
}));

const { mockZrangebyscore } = vi.hoisted(() => ({
  mockZrangebyscore: vi.fn(),
}));

vi.mock("@/lib/job-store", () => ({
  triggerJob: mockTriggerJob,
  createJob: mockCreateJob,
}));

vi.mock("@/lib/redis", () => ({
  redis: { zrangebyscore: mockZrangebyscore },
  QA_KEY: "vroid:qa:recent",
  QA_TTL_SECONDS: 3600,
}));

import { POST } from "@/app/job/queue/[job_id]/route";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRequest(job_id: string) {
  return [
    new NextRequest(`http://localhost/job/queue/${job_id}`, { method: "POST" }),
    { params: Promise.resolve({ job_id }) },
  ] as const;
}

const SAMPLE_ENTRY = {
  job_id: "abc-123",
  query: "Apa itu JS-SEZ?",
  script: "JS-SEZ ialah...",
  rag_answer: "Jawatan Sel Ekonomi...",
  qa_answer: "Zon ekonomi khas di Johor",
  created_at: new Date().toISOString(),
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /job/queue/[job_id]", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockZrangebyscore.mockResolvedValue([]);
  });

  // ── Fast path (in-memory hit) ─────────────────────────────────────────────

  describe("in-memory fast path", () => {
    it("returns 200 when job is found in memory", async () => {
      mockTriggerJob.mockReturnValue(true);
      const res = await POST(...makeRequest("abc-123"));
      expect(res.status).toBe(200);
    });

    it("response contains success:true and job_id", async () => {
      mockTriggerJob.mockReturnValue(true);
      const res = await POST(...makeRequest("abc-123"));
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.job_id).toBe("abc-123");
    });

    it("calls triggerJob with forced=true to bypass dedup", async () => {
      mockTriggerJob.mockReturnValue(true);
      await POST(...makeRequest("abc-123"));
      expect(mockTriggerJob).toHaveBeenCalledWith("abc-123", true);
    });

    it("does not query Redis when in-memory hit succeeds", async () => {
      mockTriggerJob.mockReturnValue(true);
      await POST(...makeRequest("abc-123"));
      expect(mockZrangebyscore).not.toHaveBeenCalled();
    });

    it("does not call createJob on memory hit", async () => {
      mockTriggerJob.mockReturnValue(true);
      await POST(...makeRequest("abc-123"));
      expect(mockCreateJob).not.toHaveBeenCalled();
    });
  });

  // ── Redis fallback (in-memory miss) ──────────────────────────────────────

  describe("Redis fallback", () => {
    beforeEach(() => {
      // First triggerJob call (memory) misses; second call (after rehydration) succeeds
      mockTriggerJob.mockReturnValueOnce(false).mockReturnValueOnce(true);
    });

    it("queries Redis when in-memory miss", async () => {
      mockZrangebyscore.mockResolvedValue([JSON.stringify(SAMPLE_ENTRY)]);
      await POST(...makeRequest("abc-123"));
      expect(mockZrangebyscore).toHaveBeenCalled();
    });

    it("returns 404 when job_id not in Redis either", async () => {
      mockZrangebyscore.mockResolvedValue([]);
      const res = await POST(...makeRequest("unknown-id"));
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toMatch(/not found/);
    });

    it("returns 404 when Redis has entries but none match job_id", async () => {
      const other = { ...SAMPLE_ENTRY, job_id: "different-id" };
      mockZrangebyscore.mockResolvedValue([JSON.stringify(other)]);
      const res = await POST(...makeRequest("abc-123"));
      expect(res.status).toBe(404);
    });

    it("rehydrates matching entry via createJob", async () => {
      mockZrangebyscore.mockResolvedValue([JSON.stringify(SAMPLE_ENTRY)]);
      await POST(...makeRequest("abc-123"));
      expect(mockCreateJob).toHaveBeenCalledWith(
        expect.objectContaining({
          job_id: "abc-123",
          script: SAMPLE_ENTRY.script,
          query: SAMPLE_ENTRY.query,
          user_id: "remote",
          rag_answer: SAMPLE_ENTRY.rag_answer,
          qa_answer: SAMPLE_ENTRY.qa_answer,
        })
      );
    });

    it("calls triggerJob with forced=true after rehydration", async () => {
      mockZrangebyscore.mockResolvedValue([JSON.stringify(SAMPLE_ENTRY)]);
      await POST(...makeRequest("abc-123"));
      expect(mockTriggerJob).toHaveBeenLastCalledWith("abc-123", true);
    });

    it("returns 200 after successful rehydration and trigger", async () => {
      mockZrangebyscore.mockResolvedValue([JSON.stringify(SAMPLE_ENTRY)]);
      const res = await POST(...makeRequest("abc-123"));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.job_id).toBe("abc-123");
    });

    it("skips malformed Redis members without throwing", async () => {
      mockZrangebyscore.mockResolvedValue(["not-json", JSON.stringify(SAMPLE_ENTRY)]);
      const res = await POST(...makeRequest("abc-123"));
      expect(res.status).toBe(200);
    });

    it("returns 404 when Redis throws", async () => {
      mockZrangebyscore.mockRejectedValue(new Error("redis down"));
      const res = await POST(...makeRequest("abc-123"));
      expect(res.status).toBe(404);
    });

    it("fills missing qa_answer with empty string on rehydration", async () => {
      const entryNoQA = { ...SAMPLE_ENTRY, qa_answer: undefined };
      mockZrangebyscore.mockResolvedValue([JSON.stringify(entryNoQA)]);
      await POST(...makeRequest("abc-123"));
      expect(mockCreateJob).toHaveBeenCalledWith(
        expect.objectContaining({ qa_answer: "" })
      );
    });

    it("fills missing rag_answer with empty string on rehydration", async () => {
      const entryNoRag = { ...SAMPLE_ENTRY, rag_answer: undefined };
      mockZrangebyscore.mockResolvedValue([JSON.stringify(entryNoRag)]);
      await POST(...makeRequest("abc-123"));
      expect(mockCreateJob).toHaveBeenCalledWith(
        expect.objectContaining({ rag_answer: "" })
      );
    });
  });
});
