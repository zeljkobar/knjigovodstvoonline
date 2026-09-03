const LOCAL_APP_URL = "http://localhost:3000";
const PRODUCTION_APP_URL = "https://knjigovodstvo.summasummarum.me";

function isLoopbackHost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

export function getPublicAppUrl() {
  const configured = process.env.APP_URL?.trim();
  const fallback = process.env.NODE_ENV === "production" ? PRODUCTION_APP_URL : LOCAL_APP_URL;
  const url = new URL(configured || fallback);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("APP_URL mora koristiti http ili https protokol.");
  }

  if (process.env.NODE_ENV === "production" && isLoopbackHost(url.hostname)) {
    return PRODUCTION_APP_URL;
  }

  return url.origin;
}

export function createPublicAppUrl(path: string) {
  return new URL(path, `${getPublicAppUrl()}/`);
}
