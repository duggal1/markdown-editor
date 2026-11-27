import { createHash, timingSafeEqual } from 'node:crypto';
const digest = value => createHash('sha256').update(value).digest();

export function plannerAccess(env, supplied) {
  const apiKey = env.REFLECTION_API_KEY?.trim();
  if (!apiKey) return { status: 503, error: 'REFLECTION_API_KEY is missing from the server environment. Set it for this deployment and redeploy.' };
  const access = env.FLOW_PLANNER_ACCESS_KEY?.trim();
  if (access) {
    if (access.length < 24) return { status: 503, error: 'Optional FLOW_PLANNER_ACCESS_KEY must be at least 24 characters, or unset it.' };
    if (typeof supplied !== 'string' || supplied.length > 512 || !timingSafeEqual(digest(supplied), digest(access)))
      return { status: 401, error: 'Enter your private planner access key.' };
  }
  return { apiKey, protected: !!access };
}

// Instance-local defense in depth. This is not a distributed quota or authentication.
export function createPlannerLimiter(now = Date.now) {
  const windowMs = 60_000, clients = new Map();
  let started = [], active = 0;
  return function admit(client) {
    const time = now(), cutoff = time - windowMs;
    started = started.filter(at => at > cutoff);
    for (const [key, entry] of clients) if (!entry.active && entry.last <= cutoff) clients.delete(key);
    if (active >= 6 || started.length >= 24) return null;
    const entry = clients.get(client) || { starts: [], active: 0, last: time };
    entry.starts = entry.starts.filter(at => at > cutoff);
    if (entry.active >= 1 || entry.starts.length >= 6 || (!clients.has(client) && clients.size >= 128)) return null;
    entry.starts.push(time); entry.active++; entry.last = time;
    clients.set(client, entry); started.push(time); active++;
    let released = false;
    return () => { if (!released) { released = true; entry.active--; active--; } };
  };
}
