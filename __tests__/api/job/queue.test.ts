import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { mockTriggerJob } = vi.hoisted(() => ({
  mockTriggerJob: vi.fn(),
}));

vi.mock("@/lib/job-store", () => ({
  triggerJob: mockTriggerJob,
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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /job/queue", () => {
  beforeEach(() => vi.clearAllMocks());

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

  // ── Job lookup ────────────────────────────────────────────────────────────

  describe("job lookup", () => {
    it("returns 404 when job_id is not found in the store", async () => {
      mockTriggerJob.mockReturnValue(false);
      const res = await POST(makeRequest({ job_id: "unknown-id" }));
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toMatch(/not found/);
    });

    it("calls triggerJob with the exact job_id provided", async () => {
      mockTriggerJob.mockReturnValue(true);
      await POST(makeRequest({ job_id: "specific-job-id-abc" }));
      expect(mockTriggerJob).toHaveBeenCalledWith("specific-job-id-abc");
    });
  });

  // ── Successful trigger ────────────────────────────────────────────────────

  describe("successful trigger", () => {
    it("returns 200 when the job is found and triggered", async () => {
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

    it("calls triggerJob exactly once per request", async () => {
      mockTriggerJob.mockReturnValue(true);
      await POST(makeRequest({ job_id: "valid-id" }));
      expect(mockTriggerJob).toHaveBeenCalledOnce();
    });
  });
});
