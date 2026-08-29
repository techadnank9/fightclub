// One place that turns a server session id into dispatched events.
// Both the fight setup dialog and the history panel use it, so the reconnect
// handling below only has to be right once.

import { dispatch } from './events.js';

export function connectSession(session) {
  const es = new EventSource(`/events?session=${encodeURIComponent(session)}`);
  // Reconnects replay the session history from the server; skip what we have
  // already dispatched instead of closing on the first error.
  let seen = 0;
  let sinceOpen = 0;
  es.onopen = () => { sinceOpen = 0; };
  es.onmessage = (m) => {
    sinceOpen += 1;
    if (sinceOpen <= seen) return;
    seen = sinceOpen;
    const ev = JSON.parse(m.data);
    dispatch(ev);
    if (ev.type === 'session.closed') es.close();
  };
  return es;
}
