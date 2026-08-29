// Event bus. Backend (or mock) pushes events here; every subsystem listens.
// window.FightCity.dispatch(event) is the public contract from the brief.

const listeners = new Set();
let log = [];               // full event log of the current session (for replay)

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function dispatch(event, { record = true } = {}) {
  if (record) {
    if (event.type === 'session.opened') log = [];
    log.push({ ...event, _t: performance.now() });
  }
  for (const fn of listeners) fn(event);
}

export function getLog() {
  return log;
}

// Public contract
window.FightCity = { dispatch };
