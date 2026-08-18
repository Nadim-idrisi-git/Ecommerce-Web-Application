// Lightweight in-memory rate limiter for the AI-cost-incurring assistant
// endpoints (intent routing, chat, voice transcription). Keyed by the
// authenticated user when available, else by IP.
//
// Known limitation: this is per-process memory, so on a multi-instance
// serverless deployment (e.g. Vercel with concurrent instances) the limit
// is effectively per-instance, not truly global. Good enough to blunt
// obvious abuse/cost runaway from a single session; not a substitute for a
// shared store (Redis etc.) if stronger guarantees are ever needed.

const buckets = new Map();

// Periodically drop buckets nobody has hit in a while so this map can't
// grow without bound over a long-running process.
const STALE_MS = 10 * 60 * 1000;
setInterval(() => {
  const cutoff = Date.now() - STALE_MS;
  for (const [key, timestamps] of buckets) {
    if (!timestamps.length || timestamps[timestamps.length - 1] < cutoff) {
      buckets.delete(key);
    }
  }
}, STALE_MS).unref?.();

const createRateLimiter = ({ windowMs, max }) => (req, res, next) => {
  const key = req.userId ? `user:${req.userId}` : `ip:${req.ip}`;
  const now = Date.now();
  const recent = (buckets.get(key) || []).filter((timestamp) => now - timestamp < windowMs);

  if (recent.length >= max) {
    return res.status(429).json({
      success: false,
      message: "Too many requests. Please wait a moment and try again.",
    });
  }

  recent.push(now);
  buckets.set(key, recent);
  next();
};

export default createRateLimiter;
