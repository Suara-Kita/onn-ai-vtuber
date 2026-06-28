import { describe, it, expect, vi, beforeEach } from "vitest";
import { SYSTEM_PROMPT, LLM_MODEL, SCRIPT_WORD_LIMIT, analyzeForPanel } from "@/lib/llm";

// ── Mock global fetch ─────────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ── Helpers ───────────────────────────────────────────────────────────────

function openRouterResponse(content: string) {
  return {
    ok: true,
    json: async () => ({
      choices: [{ message: { content } }],
    }),
    text: async () => content,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("generateScript (lib/llm)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls OpenRouter with the correct model", async () => {
    mockFetch.mockResolvedValue(openRouterResponse("Skrip ujian"));
    const { generateScript } = await import("@/lib/llm");
    await generateScript("Soalan?", "");

    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toContain("openrouter.ai");
    const body = JSON.parse(options.body as string);
    expect(body.model).toBe(LLM_MODEL);
  });

  it("includes the system prompt in the request", async () => {
    mockFetch.mockResolvedValue(openRouterResponse("Skrip"));
    const { generateScript } = await import("@/lib/llm");
    await generateScript("Soalan?", "");

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[0].content).toBe(SYSTEM_PROMPT);
  });

  it("embeds the query in the user message", async () => {
    mockFetch.mockResolvedValue(openRouterResponse("Skrip"));
    const { generateScript } = await import("@/lib/llm");
    await generateScript("Apakah status Sekijang?", "");

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    const userMsg = body.messages[1];
    expect(userMsg.role).toBe("user");
    expect(userMsg.content).toContain("Apakah status Sekijang?");
  });

  it("returns trimmed script text from the response", async () => {
    mockFetch.mockResolvedValue(openRouterResponse("  Skrip yang bersih  "));
    const { generateScript } = await import("@/lib/llm");
    const result = await generateScript("Soalan?", "");
    expect(result).toBe("Skrip yang bersih");
  });

  it("hard-trims output to 83 words when LLM returns more", async () => {
    const over = Array.from({ length: 94 }, (_, i) => `perkataan${i + 1}`).join(" ");
    expect(over.split(/\s+/).length).toBe(94);
    mockFetch.mockResolvedValue(openRouterResponse(over));
    const { generateScript } = await import("@/lib/llm");
    const result = await generateScript("Soalan?", "");
    expect(result.split(/\s+/).length).toBe(SCRIPT_WORD_LIMIT);
  });

  it("does not trim output that is exactly 83 words", async () => {
    const exact = Array.from({ length: 83 }, (_, i) => `perkataan${i + 1}`).join(" ");
    mockFetch.mockResolvedValue(openRouterResponse(exact));
    const { generateScript } = await import("@/lib/llm");
    const result = await generateScript("Soalan?", "");
    expect(result.split(/\s+/).length).toBe(83);
    expect(result).toBe(exact);
  });

  it("does not trim output that is under 83 words", async () => {
    const under = Array.from({ length: 75 }, (_, i) => `perkataan${i + 1}`).join(" ");
    mockFetch.mockResolvedValue(openRouterResponse(under));
    const { generateScript } = await import("@/lib/llm");
    const result = await generateScript("Soalan?", "");
    expect(result.split(/\s+/).length).toBe(75);
  });

  it("sends max_tokens: 200 to prevent runaway output", async () => {
    mockFetch.mockResolvedValue(openRouterResponse("Skrip"));
    const { generateScript } = await import("@/lib/llm");
    await generateScript("Soalan?", "");
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.max_tokens).toBe(200);
  });

  it("throws when OpenRouter returns a non-OK status", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 429, text: async () => "rate limited" });
    const { generateScript } = await import("@/lib/llm");
    await expect(generateScript("Soalan?", "")).rejects.toThrow("OpenRouter 429");
  });
});

describe("SYSTEM_PROMPT TTS constraints", () => {
  it("forbids digit characters", () => {
    expect(SYSTEM_PROMPT).toMatch(/TIADA nombor digit/);
  });

  it("forbids decimal point", () => {
    expect(SYSTEM_PROMPT).toMatch(/TIADA titik/);
  });

  it("forbids parentheses", () => {
    expect(SYSTEM_PROMPT).toMatch(/TIADA tanda kurung/);
  });

  it("forbids abbreviations and acronyms", () => {
    expect(SYSTEM_PROMPT).toMatch(/TIADA singkatan atau akronim/);
  });

  it("targets exactly 83 words and states the hard limit clearly", () => {
    // Check both the opening warning and the numbered rule
    expect(SYSTEM_PROMPT).toMatch(/lapan puluh tiga/i);
    expect(SYSTEM_PROMPT).toMatch(/83/);
  });

  it("SCRIPT_WORD_LIMIT constant matches the prompt value", () => {
    expect(SCRIPT_WORD_LIMIT).toBe(83);
  });

  it("applies to both real queries and manifesto fallback — same prompt, no branching", () => {
    expect(SYSTEM_PROMPT).toContain("PERATURAN WAJIB UNTUK SKRIP TTS");
  });

  it("ends with a complete sentence instruction, not a word-count reminder", () => {
    const lines = SYSTEM_PROMPT.trim().split("\n");
    const lastLine = lines[lines.length - 1];
    expect(lastLine).toContain("ayat yang lengkap");
    expect(lastLine).not.toMatch(/\(83\)/);
  });
});

describe("analyzeForPanel (lib/llm)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls OpenRouter and returns trimmed 3-line output", async () => {
    mockFetch.mockResolvedValue(
      openRouterResponse("  Pelaburan RM88 bilion\nKawasan Iskandar Puteri\nSasaran dua puluh tahun  ")
    );
    const result = await analyzeForPanel("Apa itu JS-SEZ?", "Konteks KB");
    expect(result).toBe("Pelaburan RM88 bilion\nKawasan Iskandar Puteri\nSasaran dua puluh tahun");
  });

  it("includes the query in the user message", async () => {
    mockFetch.mockResolvedValue(openRouterResponse("Fakta"));
    await analyzeForPanel("Apakah status jalan Sekijang?", "");
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    const userMsg = body.messages[1].content as string;
    expect(userMsg).toContain("Apakah status jalan Sekijang?");
  });

  it("includes RAG context in the user message when provided", async () => {
    mockFetch.mockResolvedValue(openRouterResponse("Fakta"));
    await analyzeForPanel("Soalan?", "Konteks KB penting");
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    const userMsg = body.messages[1].content as string;
    expect(userMsg).toContain("Konteks KB penting");
  });

  it("sends only the query when RAG context is empty", async () => {
    mockFetch.mockResolvedValue(openRouterResponse("Fakta"));
    await analyzeForPanel("Soalan?", "");
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    const userMsg = body.messages[1].content as string;
    expect(userMsg).not.toContain("Konteks:");
    expect(userMsg).toContain("Soalan?");
  });

  it("throws when OpenRouter returns a non-OK status", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 503, text: async () => "Service Unavailable" });
    await expect(analyzeForPanel("Soalan?", "")).rejects.toThrow("OpenRouter 503");
  });

  it("returns empty string when response content is missing", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: null } }] }),
    });
    const result = await analyzeForPanel("Soalan?", "");
    expect(result).toBe("");
  });

  it("uses deepseek model for cost-efficient panel analysis", async () => {
    mockFetch.mockResolvedValue(openRouterResponse("Fakta"));
    await analyzeForPanel("Soalan?", "");
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.model).toContain("deepseek");
  });
});
