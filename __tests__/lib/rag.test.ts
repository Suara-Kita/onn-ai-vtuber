import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── HTTP/HTTPS mock infrastructure ────────────────────────────────────────────

// vi.mock factories are hoisted — declare shared mock fns with vi.hoisted
const { mockHttpRequest, mockHttpsRequest } = vi.hoisted(() => ({
  mockHttpRequest: vi.fn(),
  mockHttpsRequest: vi.fn(),
}));

vi.mock("node:http", () => ({ default: { request: mockHttpRequest } }));
vi.mock("node:https", () => ({ default: { request: mockHttpsRequest } }));

// Simulate a successful HTTP response for the given mock
function setupResponse(mockFn: ReturnType<typeof vi.fn>, body: string) {
  mockFn.mockImplementation((_opts: unknown, callback: (res: unknown) => void) => {
    const req = {
      write: vi.fn(),
      end: vi.fn().mockImplementation(() => {
        const res = {
          on: vi.fn((event: string, cb: (chunk?: Buffer) => void) => {
            if (event === "data") cb(Buffer.from(body));
            if (event === "end") cb();
          }),
        };
        callback(res);
      }),
      on: vi.fn(), // error handler — not triggered on success path
    };
    return req;
  });
}

// Simulate a network error for the given mock
function setupError(mockFn: ReturnType<typeof vi.fn>, error: Error) {
  mockFn.mockImplementation(() => {
    const errorHandlers: Record<string, (err: Error) => void> = {};
    const req = {
      write: vi.fn(),
      end: vi.fn().mockImplementation(() => {
        errorHandlers["error"]?.(error);
      }),
      on: vi.fn((event: string, cb: (err: Error) => void) => {
        errorHandlers[event] = cb;
      }),
    };
    return req;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.MCP_API_URL = "http://localhost:8001/";
});

afterEach(() => {
  delete process.env.MCP_API_URL;
});

// ── postJson ──────────────────────────────────────────────────────────────────

describe("postJson", () => {
  it("uses the http module for http:// URLs", async () => {
    setupResponse(mockHttpRequest, '{"ok":true}');
    const { postJson } = await import("@/lib/rag");
    await postJson("http://localhost:8001/query", { question: "test" });
    expect(mockHttpRequest).toHaveBeenCalled();
    expect(mockHttpsRequest).not.toHaveBeenCalled();
  });

  it("uses the https module for https:// URLs", async () => {
    setupResponse(mockHttpsRequest, '{"ok":true}');
    const { postJson } = await import("@/lib/rag");
    await postJson("https://example.com/query", { question: "test" });
    expect(mockHttpsRequest).toHaveBeenCalled();
    expect(mockHttpRequest).not.toHaveBeenCalled();
  });

  it("sends a POST request with Content-Type application/json", async () => {
    setupResponse(mockHttpRequest, "{}");
    const { postJson } = await import("@/lib/rag");
    await postJson("http://localhost:8001/query", { question: "Soalan?" });
    const [options] = mockHttpRequest.mock.calls[0] as [Record<string, unknown>];
    expect(options.method).toBe("POST");
    expect((options.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });

  it("serialises the body as JSON and writes it", async () => {
    setupResponse(mockHttpRequest, "{}");
    const { postJson } = await import("@/lib/rag");
    await postJson("http://localhost:8001/q", { question: "Soalan?", top_k: 5 });
    const req = mockHttpRequest.mock.results[0].value as { write: ReturnType<typeof vi.fn> };
    const written = JSON.parse(req.write.mock.calls[0][0] as string);
    expect(written).toEqual({ question: "Soalan?", top_k: 5 });
  });

  it("resolves with the raw response body", async () => {
    setupResponse(mockHttpRequest, "hello world");
    const { postJson } = await import("@/lib/rag");
    const result = await postJson("http://localhost:8001/q", {});
    expect(result).toBe("hello world");
  });

  it("rejects when the request emits an error", async () => {
    setupError(mockHttpRequest, new Error("connection refused"));
    const { postJson } = await import("@/lib/rag");
    await expect(postJson("http://localhost:8001/q", {})).rejects.toThrow("connection refused");
  });

  it("uses the correct hostname, port, and path from the URL", async () => {
    setupResponse(mockHttpRequest, "{}");
    const { postJson } = await import("@/lib/rag");
    await postJson("http://165.99.199.21:8002/query", {});
    const [options] = mockHttpRequest.mock.calls[0] as [Record<string, unknown>];
    expect(options.hostname).toBe("165.99.199.21");
    expect(options.port).toBe("8002");
    expect(options.path).toBe("/query");
  });
});

// ── queryRagKb ────────────────────────────────────────────────────────────────

describe("queryRagKb", () => {
  it("appends /query to a base URL that ends with a slash", async () => {
    process.env.MCP_API_URL = "http://localhost:8001/";
    setupResponse(mockHttpRequest, '{"answer":"ok"}');
    const { queryRagKb } = await import("@/lib/rag");
    await queryRagKb("Soalan?");
    const [options] = mockHttpRequest.mock.calls[0] as [Record<string, unknown>];
    expect(options.path).toBe("/query");
  });

  it("appends /query to a base URL without a trailing slash", async () => {
    process.env.MCP_API_URL = "http://localhost:8001";
    setupResponse(mockHttpRequest, '{"answer":"ok"}');
    const { queryRagKb } = await import("@/lib/rag");
    await queryRagKb("Soalan?");
    const [options] = mockHttpRequest.mock.calls[0] as [Record<string, unknown>];
    expect(options.path).toBe("/query");
  });

  it("returns the answer field from the JSON response", async () => {
    setupResponse(mockHttpRequest, '{"answer":"Ini adalah jawapan dari pangkalan pengetahuan"}');
    const { queryRagKb } = await import("@/lib/rag");
    const result = await queryRagKb("Soalan?");
    expect(result).toBe("Ini adalah jawapan dari pangkalan pengetahuan");
  });

  it("returns empty string when the answer field is absent", async () => {
    setupResponse(mockHttpRequest, '{"reply":"salah kunci"}');
    const { queryRagKb } = await import("@/lib/rag");
    const result = await queryRagKb("Soalan?");
    expect(result).toBe("");
  });

  it("sends the question and top_k:5 in the request body", async () => {
    setupResponse(mockHttpRequest, '{"answer":"ok"}');
    const { queryRagKb } = await import("@/lib/rag");
    await queryRagKb("Apakah itu JS-SEZ?");
    const req = mockHttpRequest.mock.results[0].value as { write: ReturnType<typeof vi.fn> };
    const body = JSON.parse(req.write.mock.calls[0][0] as string);
    expect(body.question).toBe("Apakah itu JS-SEZ?");
    expect(body.top_k).toBe(5);
  });
});
