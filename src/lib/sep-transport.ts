import "server-only";
import https from "node:https";

export class SepError extends Error {
  constructor(readonly code: string) { super(code); }
}

export type SepEnvironment = "test" | "production";
export type SepTransport = (path: string, data: unknown, options?: { form?: boolean; binary?: boolean; get?: boolean }) => Promise<unknown>;

export async function withSepTransport<T>(
  environment: SepEnvironment, pfx: Buffer, password: string,
  work: (transport: SepTransport) => Promise<T>, timeout = 120000,
): Promise<T> {
  const agent = new https.Agent({ pfx, passphrase: password, keepAlive: true, maxSockets: 1 });
  let token = "";
  const cookies = new Map<string, string>();
  const deadline = Date.now() + timeout;
  const transport: SepTransport = (path, data, options = {}) => new Promise((resolve, reject) => {
    if (Date.now() >= deadline) { reject(new SepError("TIMEOUT")); return; }
    const body = options.get ? "" : options.form ? new URLSearchParams(data as Record<string, string>).toString() : JSON.stringify(data);
    const request = https.request({
      hostname: environment === "test" ? "efitest.tax.gov.me" : "sep.tax.gov.me", port: 443, path, method: options.get ? "GET" : "POST", agent,
      headers: {
        ...(path.startsWith("/kickstart/") ? { schema: "CPCM" } : { lang: "ME" }),
        Accept: "application/json", "Content-Type": options.form ? "application/x-www-form-urlencoded" : "application/json",
        "Content-Length": Buffer.byteLength(body),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(cookies.size ? { Cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join("; ") } : {}),
      },
    }, response => {
      if (response.statusCode !== 200) { response.resume(); reject(new SepError(`HTTP_${response.statusCode}`)); return; }
      if (!options.binary && !response.headers["content-type"]?.includes("json")) { response.resume(); reject(new SepError("EXPECTED_JSON")); return; }
      for (const cookie of response.headers["set-cookie"] ?? []) {
        const pair = cookie.split(";", 1)[0], split = pair.indexOf("=");
        if (split > 0) cookies.set(pair.slice(0, split), pair.slice(split + 1));
      }
      const chunks: Buffer[] = []; let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 20 * 1024 * 1024) response.destroy(new SepError("RESPONSE_TOO_LARGE"));
        else chunks.push(chunk);
      });
      response.on("error", () => reject(new SepError("NETWORK_ERROR")));
      response.on("end", () => {
        const bytes = Buffer.concat(chunks);
        if (options.binary) { resolve(bytes); return; }
        try {
          const result = JSON.parse(bytes.toString("utf8"));
          if (path === "/kickstart/login") {
            if (!result?.user || typeof result.token !== "string" || !result.token) throw new SepError("LOGIN_FAILED");
            token = result.token;
          }
          resolve(result);
        } catch (error) { reject(error instanceof SepError ? error : new SepError("INVALID_JSON")); }
      });
    });
    const timer = setTimeout(() => request.destroy(new SepError("TIMEOUT")), Math.min(30000, deadline - Date.now()));
    request.on("close", () => clearTimeout(timer));
    request.on("error", error => reject(error instanceof SepError ? error : new SepError("NETWORK_ERROR")));
    request.end(body);
  });
  try { return await work(transport); }
  finally { agent.destroy(); token = ""; cookies.clear(); }
}
