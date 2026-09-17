/**
 * Rate limiting.
 *
 * READ THIS BEFORE RELYING ON IT
 * The default implementation is an in-memory counter. On Vercel that means
 * per-instance: requests are spread across however many warm instances exist,
 * so the effective limit is (your limit × instance count), and it resets
 * whenever an instance is recycled. That is genuinely useful against a
 * runaway client loop or a single script hammering one endpoint, and it is
 * genuinely NOT sufficient against a distributed brute-force attempt on the
 * login endpoint.
 *
 * For login specifically, set UPSTASH_REDIS_REST_URL and
 * UPSTASH_REDIS_REST_TOKEN and this module switches to a shared counter
 * automatically. Until then, treat the login limit as speed-bump, not
 * defence, and keep Supabase's own auth rate limiting enabled.
 *
 * I would rather say this plainly here than have the file read as though it
 * solves a problem it only partly solves.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
const WINDOW_MS = 60_000;

/** Keeps the map from growing without bound on a long-lived warm instance. */
function sweep(now: number) {
  if (buckets.size < 5000) return;
  for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
}

const redisUrl = () => process.env.UPSTASH_REDIS_REST_URL;
const redisToken = () => process.env.UPSTASH_REDIS_REST_TOKEN;
export const hasSharedLimiter = () => Boolean(redisUrl() && redisToken());

async function redisLimit(key: string, limit: number): Promise<RateResult> {
  const url = redisUrl()!;
  const token = redisToken()!;
  try {
    // INCR then EXPIRE on first hit — two round trips pipelined into one.
    const res = await fetch(`${url}/pipeline`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify([
        ["INCR", key],
        ["EXPIRE", key, "60", "NX"],
      ]),
    });
    if (!res.ok) throw new Error(`redis ${res.status}`);
    const out = (await res.json()) as { result: number }[];
    const count = Number(out?.[0]?.result ?? 0);
    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      retryAfterSeconds: 60,
    };
  } catch (e) {
    // A limiter outage must not take the app down. Log and allow.
    console.warn("[ratelimit] shared limiter unavailable, falling back:", e);
    return memoryLimit(key, limit);
  }
}

function memoryLimit(key: string, limit: number): RateResult {
  const now = Date.now();
  sweep(now);
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, remaining: limit - 1, retryAfterSeconds: 60 };
  }
  existing.count += 1;
  return {
    allowed: existing.count <= limit,
    remaining: Math.max(0, limit - existing.count),
    retryAfterSeconds: Math.ceil((existing.resetAt - now) / 1000),
  };
}

export interface RateResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * @param key   Identity to limit on — prefer the user id, fall back to IP.
 * @param limit Requests permitted per 60s window.
 */
export async function rateLimit(key: string, limit: number): Promise<RateResult> {
  return hasSharedLimiter() ? redisLimit(`rl:${key}`, limit) : memoryLimit(key, limit);
}

export function rateHeaders(r: RateResult, limit: number): Record<string, string> {
  return {
    "x-ratelimit-limit": String(limit),
    "x-ratelimit-remaining": String(r.remaining),
    ...(r.allowed ? {} : { "retry-after": String(r.retryAfterSeconds) }),
  };
}
