// Browser-side fight store.
//
// The hosted demo (Vercel) serves web/ as static files — there is no backend,
// so /fights is unreachable and mock fights are never recorded server-side.
// This keeps finished fights in localStorage so the demo has history of its
// own. Local to one browser; the server store is still the real record.

const KEY = 'afc.fights.v1';
const MAX_FIGHTS = 20;

function readAll() {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];   // private mode, cleared storage, or someone else's key
  }
}

function writeAll(fights) {
  // Trim oldest until it fits — a long fight log can bump the ~5MB quota.
  let keep = fights.slice(0, MAX_FIGHTS);
  while (keep.length) {
    try {
      localStorage.setItem(KEY, JSON.stringify(keep));
      return true;
    } catch {
      keep = keep.slice(0, keep.length - 1);
    }
  }
  try { localStorage.removeItem(KEY); } catch { /* nothing we can do */ }
  return false;
}

export function summarize(events) {
  const opened = events.find((e) => e.type === 'session.opened');
  if (!opened) return null;
  const verdict = events.find((e) => e.type === 'verdict');
  return {
    session: opened.session ?? `local-${Math.random().toString(16).slice(2, 8)}`,
    repo: opened.repo ?? '',
    task: opened.task ?? '',
    events: events.length,
    at: Date.now() / 1000,
    winner: verdict?.winner ?? null,
    score: verdict?.score ?? null,
    pr: verdict?.pr ?? null,
    complete: !!verdict,
    source: 'local',
  };
}

export function list() {
  return readAll().map((f) => ({ ...f.summary, source: 'local' }));
}

export function eventsFor(session) {
  return readAll().find((f) => f.summary.session === session)?.events ?? null;
}

// Idempotent: re-saving the same session (e.g. after replaying it) overwrites
// its entry rather than adding a duplicate.
export function save(events) {
  const summary = summarize(events);
  if (!summary) return null;
  const rest = readAll().filter((f) => f.summary.session !== summary.session);
  writeAll([{ summary, events }, ...rest]);
  return summary;
}

export function clear() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
