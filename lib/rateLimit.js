const loginAttempts = new Map(); // key -> { start, count }
const ipAttempts = new Map();    // ip  -> { start, count }

const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_USERNAME = 8;
const MAX_PER_IP = 30; // stops password-spray across many usernames

function check(map, key, max) {
  const now = Date.now();
  const entry = map.get(key);
  if (!entry || now - entry.start > WINDOW_MS) {
    map.set(key, { start: now, count: 1 });
    return false;
  }
  entry.count += 1;
  return entry.count > max;
}

export function isRateLimited(username, ip) {
  const byUser = check(loginAttempts, `user:${username}`, MAX_PER_USERNAME);
  const byIp   = ip ? check(ipAttempts, `ip:${ip}`, MAX_PER_IP) : false;
  return byUser || byIp;
}

export function resetRateLimit(username, ip) {
  loginAttempts.delete(`user:${username}`);
  if (ip) ipAttempts.delete(`ip:${ip}`);
}

// Purge stale entries every 5 minutes so the Maps don't grow forever
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of loginAttempts) if (now - v.start > WINDOW_MS) loginAttempts.delete(k);
  for (const [k, v] of ipAttempts)    if (now - v.start > WINDOW_MS) ipAttempts.delete(k);
}, 5 * 60 * 1000);
