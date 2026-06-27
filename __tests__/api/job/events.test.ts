import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Job } from "@/lib/job-store";

// ── Mock job-store ────────────────────────────────────────────────────────────

const { mockSubscribe } = vi.hoisted(() => ({
  mockSubscribe: vi.fn(),
}));

vi.mock("@/lib/job-store", () => ({
  subscribe: mockSubscribe,
}));

import { GET } from "@/app/job/events/route";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    job_id: "evt-job-1",
    script: "Skrip ujian acara",
    query: "Soalan acara?",
    user_id: "u1",
    rag_answer: "Jawapan acara",
    created_at: new Date("2026-06-27T00:00:00Z"),
    ...overrides,
  };
}

async function readChunk(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  const { value } = await reader.read();
  return new TextDecoder().decode(value);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /job/events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockSubscribe.mockReturnValue(vi.fn()); // default: return a no-op unsubscribe
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Response headers ──────────────────────────────────────────────────────

  describe("response headers", () => {
    it("sets Content-Type to text/event-stream", async () => {
      const res = await GET();
      expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    });

    it("sets Cache-Control to no-cache, no-transform", async () => {
      const res = await GET();
      expect(res.headers.get("Cache-Control")).toBe("no-cache, no-transform");
    });

    it("sets X-Accel-Buffering to no (disables nginx buffering)", async () => {
      const res = await GET();
      expect(res.headers.get("X-Accel-Buffering")).toBe("no");
    });

    it("sets Connection: keep-alive", async () => {
      const res = await GET();
      expect(res.headers.get("Connection")).toBe("keep-alive");
    });
  });

  // ── Initial connection event ──────────────────────────────────────────────

  describe("initial connection event", () => {
    it("sends a connected:true event immediately on connect", async () => {
      const res = await GET();
      const reader = res.body!.getReader();
      const text = await readChunk(reader);
      expect(text).toContain('"connected":true');
      reader.cancel();
    });

    it("formats the initial event as SSE data line", async () => {
      const res = await GET();
      const reader = res.body!.getReader();
      const text = await readChunk(reader);
      expect(text).toMatch(/^data: .+\n\n/);
      reader.cancel();
    });
  });

  // ── Subscription ─────────────────────────────────────────────────────────

  describe("subscription", () => {
    it("subscribes to job events when a client connects", async () => {
      await GET();
      expect(mockSubscribe).toHaveBeenCalledOnce();
    });

    it("passes a callback function to subscribe", async () => {
      await GET();
      expect(typeof mockSubscribe.mock.calls[0][0]).toBe("function");
    });
  });

  // ── Job event broadcasting ────────────────────────────────────────────────

  describe("job event broadcasting", () => {
    it("sends job payload as SSE data when a job is triggered", async () => {
      let capturedCb: ((job: Job) => void) | null = null;
      mockSubscribe.mockImplementation((cb: (job: Job) => void) => {
        capturedCb = cb;
        return vi.fn();
      });

      const res = await GET();
      const reader = res.body!.getReader();

      // consume the initial connected event
      await readChunk(reader);

      // simulate a job being triggered
      capturedCb!(makeJob());
      const text = await readChunk(reader);

      expect(text).toMatch(/^data: /);
      const payload = JSON.parse(text.replace(/^data: /, "").trim());
      expect(payload.job_id).toBe("evt-job-1");
      reader.cancel();
    });

    it("includes script, query, rag_answer, and user_id in the broadcast", async () => {
      let capturedCb: ((job: Job) => void) | null = null;
      mockSubscribe.mockImplementation((cb: (job: Job) => void) => {
        capturedCb = cb;
        return vi.fn();
      });

      const res = await GET();
      const reader = res.body!.getReader();
      await readChunk(reader); // discard connected event

      const job = makeJob({
        job_id: "full-job",
        script: "Skrip penuh",
        query: "Soalan penuh?",
        rag_answer: "Jawapan penuh",
        user_id: "user-abc",
      });
      capturedCb!(job);
      const text = await readChunk(reader);
      const payload = JSON.parse(text.replace(/^data: /, "").trim());

      expect(payload.script).toBe("Skrip penuh");
      expect(payload.query).toBe("Soalan penuh?");
      expect(payload.rag_answer).toBe("Jawapan penuh");
      expect(payload.user_id).toBe("user-abc");
      reader.cancel();
    });

    it("broadcasts to every active subscriber callback independently", async () => {
      const subscribers: ((job: Job) => void)[] = [];
      mockSubscribe.mockImplementation((cb: (job: Job) => void) => {
        subscribers.push(cb);
        return vi.fn();
      });

      // two simultaneous SSE connections
      const res1 = await GET();
      const res2 = await GET();
      const reader1 = res1.body!.getReader();
      const reader2 = res2.body!.getReader();

      await readChunk(reader1);
      await readChunk(reader2);

      const job = makeJob();
      subscribers.forEach((cb) => cb(job));

      const text1 = await readChunk(reader1);
      const text2 = await readChunk(reader2);

      expect(JSON.parse(text1.replace(/^data: /, "").trim()).job_id).toBe("evt-job-1");
      expect(JSON.parse(text2.replace(/^data: /, "").trim()).job_id).toBe("evt-job-1");
      reader1.cancel();
      reader2.cancel();
    });
  });
});
