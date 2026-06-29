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
  QA_TTL_SECONDS: 3600,
  JOB_KEY: (job_id: string) => `vroid:job:${job_id}`,
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
  panel_analysis: "Pelaburan RM88 bilion\nMelibatkan kawasan Iskandar Puteri\nSasaran dua puluh tahun",
  created_at: new Date().toISOString(),
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /job/queue/[job_id]", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockRedisGet.mockResolvedValue([]);
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
      expect(mockRedisGet).not.toHaveBeenCalled();
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
      mockRedisGet.mockResolvedValue(JSON.stringify(SAMPLE_ENTRY));
      await POST(...makeRequest("abc-123"));
      expect(mockRedisGet).toHaveBeenCalled();
    });

    it("returns 404 when job_id not in Redis either", async () => {
      mockRedisGet.mockResolvedValue([]);
      const res = await POST(...makeRequest("unknown-id"));
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toMatch(/not found/);
    });

    it("rehydrates matching entry via createJob", async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify(SAMPLE_ENTRY));
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
      mockRedisGet.mockResolvedValue(JSON.stringify(SAMPLE_ENTRY));
      await POST(...makeRequest("abc-123"));
      expect(mockTriggerJob).toHaveBeenLastCalledWith("abc-123", true);
    });

    it("returns 200 after successful rehydration and trigger", async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify(SAMPLE_ENTRY));
      const res = await POST(...makeRequest("abc-123"));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.job_id).toBe("abc-123");
    });

    it("skips malformed Redis member without throwing", async () => {
      mockRedisGet.mockResolvedValue("not-json");
      const res = await POST(...makeRequest("abc-123"));
      expect(res.status).toBe(404);
    });

    it("returns 404 when Redis throws", async () => {
      mockRedisGet.mockRejectedValue(new Error("redis down"));
      const res = await POST(...makeRequest("abc-123"));
      expect(res.status).toBe(404);
    });

    it("fills missing qa_answer with empty string on rehydration", async () => {
      const entryNoQA = { ...SAMPLE_ENTRY, qa_answer: undefined };
      mockRedisGet.mockResolvedValue(JSON.stringify(entryNoQA));
      await POST(...makeRequest("abc-123"));
      expect(mockCreateJob).toHaveBeenCalledWith(
        expect.objectContaining({ qa_answer: "" })
      );
    });

    it("fills missing rag_answer with empty string on rehydration", async () => {
      const entryNoRag = { ...SAMPLE_ENTRY, rag_answer: undefined };
      mockRedisGet.mockResolvedValue(JSON.stringify(entryNoRag));
      await POST(...makeRequest("abc-123"));
      expect(mockCreateJob).toHaveBeenCalledWith(
        expect.objectContaining({ rag_answer: "" })
      );
    });

    it("rehydrates panel_analysis from Redis entry", async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify(SAMPLE_ENTRY));
      await POST(...makeRequest("abc-123"));
      expect(mockCreateJob).toHaveBeenCalledWith(
        expect.objectContaining({
          panel_analysis: "Pelaburan RM88 bilion\nMelibatkan kawasan Iskandar Puteri\nSasaran dua puluh tahun",
        })
      );
    });

    it("fills missing panel_analysis with empty string on rehydration", async () => {
      const entryNoPanel = { ...SAMPLE_ENTRY, panel_analysis: undefined };
      mockRedisGet.mockResolvedValue(JSON.stringify(entryNoPanel));
      await POST(...makeRequest("abc-123"));
      expect(mockCreateJob).toHaveBeenCalledWith(
        expect.objectContaining({ panel_analysis: "" })
      );
    });
  });
});
