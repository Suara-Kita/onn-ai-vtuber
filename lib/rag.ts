import https from "node:https";
import http from "node:http";

// HTTP POST helper — uses native Node modules so self-signed certs are fine
export function postJson(url: string, body: object, timeoutMs = 60000): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const data = JSON.stringify(body);
    const isHttps = parsed.protocol === "https:";
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
      },
      rejectUnauthorized: false,
    };
    const mod = isHttps ? https : http;
    const req = mod.request(options, (res) => {
      let chunks = "";
      res.on("data", (c: Buffer) => (chunks += c));
      res.on("end", () => resolve(chunks));
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`RAG KB timeout after ${timeoutMs}ms`));
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

export async function queryRagKb(question: string): Promise<string> {
  const base = process.env.MCP_API_URL ?? "";
  if (!base) return "";
  const url = base.endsWith("/") ? `${base}query` : `${base}/query`;
  const raw = await postJson(url, { question, top_k: 5 });
  try {
    const data = JSON.parse(raw) as { answer?: string };
    return data.answer ?? "";
  } catch {
    console.error("[rag] invalid JSON from KB:", raw.slice(0, 200));
    return "";
  }
}
