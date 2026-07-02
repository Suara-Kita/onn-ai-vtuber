import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockZrange } = vi.hoisted(() => ({
  mockZrange: vi.fn(),
}));

vi.mock("@/lib/redis", () => ({
  redis: { zrange: mockZrange },
  QA_KEY: "vroid:qa:recent",
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

  it("returns empty entries when Redis has no data", async () => {
    mockZrange.mockResolvedValue([]);
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.entries).toEqual([]);
  });

  it("returns stored entries regardless of age", async () => {
    const entry = makeEntry({ query: "Soalan A?", script: "Skrip A" });
    mockZrange.mockResolvedValue([entry]);
    const res = await GET();
    const data = await res.json();
    expect(data.entries).toHaveLength(1);
    expect(data.entries[0].query).toBe("Soalan A?");
    expect(data.entries[0].script).toBe("Skrip A");
  });

  it("queries Redis for the full sorted set — no time window", async () => {
    mockZrange.mockResolvedValue([]);
    await GET();
    expect(mockZrange).toHaveBeenCalledWith("vroid:qa:recent", 0, -1);
  });

  it("returns multiple entries in reverse order (newest first)", async () => {
    const members = [
      makeEntry({ query: "Soalan lama", script: "Skrip lama" }),
      makeEntry({ query: "Soalan baru", script: "Skrip baru" }),
    ];
    mockZrange.mockResolvedValue(members);
    const res = await GET();
    const data = await res.json();
    expect(data.entries[0].query).toBe("Soalan baru");
    expect(data.entries[1].query).toBe("Soalan lama");
  });

  it("silently skips malformed JSON members", async () => {
    mockZrange.mockResolvedValue([
      "invalid-json",
      makeEntry({ query: "Soalan valid" }),
    ]);
    const res = await GET();
    const data = await res.json();
    expect(data.entries).toHaveLength(1);
    expect(data.entries[0].query).toBe("Soalan valid");
  });

  it("returns empty entries and does not throw when Redis errors", async () => {
    mockZrange.mockRejectedValue(new Error("Redis connection refused"));
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.entries).toEqual([]);
  });

  it("includes all required QAEntry fields", async () => {
    mockZrange.mockResolvedValue([makeEntry()]);
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
