import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockZrangebyscore } = vi.hoisted(() => ({
  mockZrangebyscore: vi.fn(),
}));

vi.mock("@/lib/redis", () => ({
  redis: { zrangebyscore: mockZrangebyscore },
  QA_KEY: "vroid:qa:recent",
  QA_TTL_SECONDS: 180,
}));

import { GET } from "@/app/job/qa-recent/route";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<{
  job_id: string; query: string; script: string; rag_answer: string; created_at: string;
}> = {}) {
  return JSON.stringify({
    job_id: "test-uuid",
    query: "Soalan ujian?",
    script: "Skrip ujian untuk Sekijang",
    rag_answer: "Jawapan dari pangkalan pengetahuan",
    created_at: new Date().toISOString(),
    ...overrides,
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("GET /job/qa-recent", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns empty entries when Redis has no data in the window", async () => {
    mockZrangebyscore.mockResolvedValue([]);
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.entries).toEqual([]);
  });

  it("returns entries from the last 3 minutes", async () => {
    const entry = makeEntry({ query: "Soalan A?", script: "Skrip A" });
    mockZrangebyscore.mockResolvedValue([entry]);
    const res = await GET();
    const data = await res.json();
    expect(data.entries).toHaveLength(1);
    expect(data.entries[0].query).toBe("Soalan A?");
    expect(data.entries[0].script).toBe("Skrip A");
  });

  it("queries Redis with a min score of now-180s", async () => {
    mockZrangebyscore.mockResolvedValue([]);
    const before = Math.floor(Date.now() / 1000) - 180;
    await GET();
    const [key, min] = mockZrangebyscore.mock.calls[0];
    expect(key).toBe("vroid:qa:recent");
    expect(Number(min)).toBeGreaterThanOrEqual(before);
    expect(Number(min)).toBeLessThanOrEqual(before + 2);
  });

  it("returns multiple entries in reverse order (newest first)", async () => {
    const members = [
      makeEntry({ query: "Soalan lama", script: "Skrip lama" }),
      makeEntry({ query: "Soalan baru", script: "Skrip baru" }),
    ];
    mockZrangebyscore.mockResolvedValue(members);
    const res = await GET();
    const data = await res.json();
    expect(data.entries[0].query).toBe("Soalan baru");
    expect(data.entries[1].query).toBe("Soalan lama");
  });

  it("silently skips malformed JSON members", async () => {
    mockZrangebyscore.mockResolvedValue([
      "invalid-json",
      makeEntry({ query: "Soalan valid" }),
    ]);
    const res = await GET();
    const data = await res.json();
    expect(data.entries).toHaveLength(1);
    expect(data.entries[0].query).toBe("Soalan valid");
  });

  it("returns empty entries and does not throw when Redis errors", async () => {
    mockZrangebyscore.mockRejectedValue(new Error("Redis connection refused"));
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.entries).toEqual([]);
  });

  it("includes all required QAEntry fields", async () => {
    mockZrangebyscore.mockResolvedValue([makeEntry()]);
    const res = await GET();
    const data = await res.json();
    const entry = data.entries[0];
    expect(entry).toHaveProperty("job_id");
    expect(entry).toHaveProperty("query");
    expect(entry).toHaveProperty("script");
    expect(entry).toHaveProperty("rag_answer");
    expect(entry).toHaveProperty("created_at");
  });
});
