import https from "node:https";
import http from "node:http";

// HTTP POST helper — uses native Node modules so self-signed certs are fine
export function postJson(url: string, body: object): Promise<string> {
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
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

export async function queryRagKb(question: string): Promise<string> {
  const base = process.env.MCP_API_URL ?? "";
  const url = base.endsWith("/") ? `${base}query` : `${base}/query`;
  const raw = await postJson(url, { question, top_k: 5 });
  const data = JSON.parse(raw) as { answer?: string };
  return data.answer ?? "";
}
