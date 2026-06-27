import { describe, it, expect, vi, beforeEach } from "vitest";
import { SYSTEM_PROMPT, LLM_MODEL } from "@/lib/llm";

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
    await generateScript("Soalan?");

    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toContain("openrouter.ai");
    const body = JSON.parse(options.body as string);
    expect(body.model).toBe(LLM_MODEL);
  });

  it("includes the system prompt in the request", async () => {
    mockFetch.mockResolvedValue(openRouterResponse("Skrip"));
    const { generateScript } = await import("@/lib/llm");
    await generateScript("Soalan?");

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[0].content).toBe(SYSTEM_PROMPT);
  });

  it("embeds the query in the user message", async () => {
    mockFetch.mockResolvedValue(openRouterResponse("Skrip"));
    const { generateScript } = await import("@/lib/llm");
    await generateScript("Apakah status Sekijang?");

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    const userMsg = body.messages[1];
    expect(userMsg.role).toBe("user");
    expect(userMsg.content).toContain("Apakah status Sekijang?");
  });

  it("returns trimmed script text from the response", async () => {
    mockFetch.mockResolvedValue(openRouterResponse("  Skrip yang bersih  "));
    const { generateScript } = await import("@/lib/llm");
    const result = await generateScript("Soalan?");
    expect(result).toBe("Skrip yang bersih");
  });

  it("throws when OpenRouter returns a non-OK status", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 429, text: async () => "rate limited" });
    const { generateScript } = await import("@/lib/llm");
    await expect(generateScript("Soalan?")).rejects.toThrow("OpenRouter 429");
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

  it("forbids single-letter abbreviations", () => {
    expect(SYSTEM_PROMPT).toMatch(/TIADA singkatan huruf tunggal/);
  });

  it("targets 83-word script length", () => {
    expect(SYSTEM_PROMPT).toMatch(/lapan puluh tiga/);
  });
});
