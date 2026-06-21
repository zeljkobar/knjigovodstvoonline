const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;

const store = new Map<string, { count: number; resetAt: number }>();

export function isRateLimited(key: string): boolean {
  const now = Date.now();
  const record = store.get(key);

  if (!record || record.resetAt < now) {
    store.delete(key);
    return false;
  }

  return record.count >= MAX_ATTEMPTS;
}

export function recordFailedAttempt(key: string): void {
  const now = Date.now();
  const record = store.get(key);

  if (!record || record.resetAt < now) {
    store.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }

  record.count++;
}

export function clearAttempts(key: string): void {
  store.delete(key);
}
