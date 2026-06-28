import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Job } from "@/lib/job-store";

// Each test gets a clean global store + fresh module instance
beforeEach(() => {
  (globalThis as Record<string, unknown>).__jobStore = undefined;
  vi.resetModules();
});

async function getStore() {
  return import("@/lib/job-store");
}

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    job_id: "test-id-1",
    script: "Skrip ujian untuk kawasan",
    query: "Soalan ujian?",
    user_id: "user-1",
    rag_answer: "Jawapan dari pangkalan pengetahuan",
    qa_answer: "",
    panel_analysis: "",
    created_at: new Date("2026-06-27T00:00:00Z"),
    ...overrides,
  };
}

// ── createJob / getJob ────────────────────────────────────────────────────────

describe("createJob / getJob", () => {
  it("stores and retrieves a job by id", async () => {
    const { createJob, getJob } = await getStore();
    const job = makeJob();
    createJob(job);
    expect(getJob(job.job_id)).toEqual(job);
  });

  it("returns undefined for an unknown job_id", async () => {
    const { getJob } = await getStore();
    expect(getJob("ghost-id")).toBeUndefined();
  });

  it("stores multiple jobs independently", async () => {
    const { createJob, getJob } = await getStore();
    const a = makeJob({ job_id: "id-a", query: "Soalan A?" });
    const b = makeJob({ job_id: "id-b", query: "Soalan B?" });
    createJob(a);
    createJob(b);
    expect(getJob("id-a")?.query).toBe("Soalan A?");
    expect(getJob("id-b")?.query).toBe("Soalan B?");
  });

  it("overwrites an existing job when the same id is reused", async () => {
    const { createJob, getJob } = await getStore();
    createJob(makeJob({ script: "Skrip lama" }));
    createJob(makeJob({ script: "Skrip baharu" }));
    expect(getJob("test-id-1")?.script).toBe("Skrip baharu");
  });
});

// ── triggerJob ────────────────────────────────────────────────────────────────

describe("triggerJob", () => {
  it("returns false when job_id is not in the store", async () => {
    const { triggerJob } = await getStore();
    expect(triggerJob("missing-id")).toBe(false);
  });

  it("returns true when the job exists", async () => {
    const { createJob, triggerJob } = await getStore();
    createJob(makeJob());
    expect(triggerJob("test-id-1")).toBe(true);
  });

  it("calls every subscriber with the job payload", async () => {
    const { createJob, triggerJob, subscribe } = await getStore();
    const job = makeJob();
    createJob(job);

    const cb1 = vi.fn();
    const cb2 = vi.fn();
    subscribe(cb1);
    subscribe(cb2);

    triggerJob(job.job_id);

    expect(cb1).toHaveBeenCalledOnce();
    expect(cb1).toHaveBeenCalledWith(job, false);
    expect(cb2).toHaveBeenCalledOnce();
    expect(cb2).toHaveBeenCalledWith(job, false);
  });

  it("does not call subscribers when job_id is missing", async () => {
    const { triggerJob, subscribe } = await getStore();
    const cb = vi.fn();
    subscribe(cb);
    triggerJob("not-a-real-id");
    expect(cb).not.toHaveBeenCalled();
  });
});

// ── subscribe / unsubscribe ───────────────────────────────────────────────────

describe("subscribe / unsubscribe", () => {
  it("calling the returned function removes the subscriber", async () => {
    const { createJob, triggerJob, subscribe } = await getStore();
    const job = makeJob();
    createJob(job);

    const cb = vi.fn();
    const unsub = subscribe(cb);
    unsub();

    triggerJob(job.job_id);
    expect(cb).not.toHaveBeenCalled();
  });

  it("remaining subscribers still fire after one unsubscribes", async () => {
    const { createJob, triggerJob, subscribe } = await getStore();
    const job = makeJob();
    createJob(job);

    const cb1 = vi.fn();
    const cb2 = vi.fn();
    const unsub1 = subscribe(cb1);
    subscribe(cb2);
    unsub1();

    triggerJob(job.job_id);
    expect(cb1).not.toHaveBeenCalled();
    expect(cb2).toHaveBeenCalledWith(job, false);
  });

  it("adding the same callback reference twice only fires it once (Set deduplication)", async () => {
    const { createJob, triggerJob, subscribe } = await getStore();
    const job = makeJob();
    createJob(job);

    const cb = vi.fn();
    subscribe(cb);
    subscribe(cb); // duplicate — Set ignores it

    triggerJob(job.job_id);
    expect(cb).toHaveBeenCalledTimes(1);
  });
});

// ── globalThis singleton ──────────────────────────────────────────────────────

describe("globalThis singleton", () => {
  it("data written via one import is visible via another import of the same module", async () => {
    const store1 = await getStore();
    const store2 = await getStore(); // same cached instance
    store1.createJob(makeJob({ job_id: "shared-id" }));
    expect(store2.getJob("shared-id")).toBeDefined();
  });

  it("uses globalThis.__jobStore as the backing store", async () => {
    await getStore();
    expect((globalThis as Record<string, unknown>).__jobStore).toBeDefined();
  });
});
