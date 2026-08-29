// Past fights, from two stores merged into one list:
//
// - the server's .fights/*.jsonl, via GET /fights, replayed with
//   POST /fight {replay} — the real record, shared across browsers;
// - localStorage, for fights this browser ran with no backend reachable
//   (the hosted static demo, or ?mock=1), replayed from memory.
//
// Either way the events go through the ordinary dispatch path, so the city,
// HUD, full log and scrubber animate a past fight exactly like a live one.

import { connectSession } from './stream.js';
import { dispatch, subscribe, getLog } from './events.js';
import * as localFights from './localFights.js';

const $ = (s) => document.querySelector(s);

export class History {
  constructor() {
    this.el = $('#history');
    this.listEl = $('#history-list');
    this.open = false;
    this.speed = 4;
    this.player = null;      // timer id of an in-flight local replay

    // Record every fight that finishes in this browser. Replays re-dispatch
    // with the original session.opened, so re-saving overwrites in place.
    subscribe((ev) => {
      if (ev.type === 'session.closed') {
        const log = getLog();
        if (log.length) localFights.save(log);
      }
    });

    $('#history-open').addEventListener('click', () => this.toggle());
    $('#history-close').addEventListener('click', () => this.toggle(false));
    $('#history-speed').addEventListener('change', (e) => { this.speed = +e.target.value; });
    addEventListener('keydown', (e) => {
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (e.key === 'h' || e.key === 'H') this.toggle();
      if (e.key === 'Escape' && this.open) this.toggle(false);
    });
  }

  toggle(force) {
    this.open = force ?? !this.open;
    this.el.style.display = this.open ? 'block' : 'none';
    if (this.open) this.load();
  }

  async load() {
    this.listEl.innerHTML = '<div class="hempty">loading…</div>';

    let server = [];
    let serverUp = true;
    try {
      const r = await fetch('/fights');
      if (!r.ok) throw new Error(r.status);
      server = (await r.json()).fights.map((f) => ({ ...f, source: 'server' }));
    } catch {
      serverUp = false;   // static hosting or the server is down — local only
    }

    // Server wins on a session both stores have: its log is the real record.
    const seen = new Set(server.map((f) => f.session));
    const merged = [...server, ...localFights.list().filter((f) => !seen.has(f.session))]
      .sort((x, y) => y.at - x.at);

    if (!merged.length) {
      this.listEl.innerHTML = serverUp
        ? '<div class="hempty">no fights recorded yet</div>'
        : '<div class="hempty">no fights yet — run one and it is kept in this '
          + 'browser. (No backend reachable, so server-side history is unavailable.)</div>';
      return;
    }
    this.listEl.innerHTML = '';
    if (!serverUp) {
      const note = document.createElement('div');
      note.className = 'hnote';
      note.textContent = 'no backend reachable — showing fights saved in this browser';
      this.listEl.appendChild(note);
    }
    for (const f of merged) this.listEl.appendChild(this.row(f));
  }

  row(f) {
    const el = document.createElement('div');
    el.className = 'hrow';
    const won = f.winner ? `${f.winner.toUpperCase()} won` : 'no verdict';
    const score = f.score ? `${f.score.a}–${f.score.b}` : '';
    el.innerHTML = `
      <div class="hmain">
        <div class="hrepo"></div>
        <div class="htask"></div>
      </div>
      <div class="hside">
        <div class="hwin ${f.winner ? `w-${f.winner}` : 'w-none'}"></div>
        <div class="hmeta"></div>
      </div>`;
    el.querySelector('.hrepo').textContent = f.repo || f.session;
    el.querySelector('.htask').textContent = f.task || '';
    el.querySelector('.hwin').textContent = `${won}${score ? `  ${score}` : ''}`;
    el.querySelector('.hmeta').textContent =
      [f.pr ? `PR #${f.pr}` : null, `${f.events} events`, ago(f.at),
       f.source === 'local' ? 'this browser' : null].filter(Boolean).join('  ·  ');
    if (!f.complete) el.classList.add('partial');
    el.addEventListener('click', () => this.replay(f, el));
    return el;
  }

  async replay(f, el) {
    el.classList.add('loading');
    if (f.source === 'local') {
      const events = localFights.eventsFor(f.session);
      if (!events?.length) {
        el.classList.remove('loading');
        el.classList.add('failed');
        el.querySelector('.hmeta').textContent = 'replay failed — log missing from this browser';
        return;
      }
      this.playLocal(events);
      this.toggle(false);
      return;
    }
    try {
      const r = await fetch('/fight', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ replay: f.replay, speed: this.speed }),
      });
      if (!r.ok) throw new Error(await r.text());
      const { session } = await r.json();
      connectSession(session);
      this.toggle(false);
    } catch (err) {
      el.classList.remove('loading');
      el.classList.add('failed');
      el.querySelector('.hmeta').textContent = `replay failed — ${err.message}`.slice(0, 120);
    }
  }

  // Re-dispatch a stored log on its original spacing, scaled by speed.
  playLocal(events) {
    this.stopLocal();
    let i = 0;
    const step = () => {
      if (i >= events.length) { this.player = null; return; }
      const ev = events[i];
      dispatch({ ...ev, _t: undefined });
      i += 1;
      const gap = Math.min(4000, Math.max(0, (events[i]?._t ?? ev._t) - ev._t)) / this.speed;
      this.player = setTimeout(step, Math.max(16, gap));
    };
    step();
  }

  stopLocal() {
    if (this.player) { clearTimeout(this.player); this.player = null; }
  }
}

function ago(ts) {
  const s = Math.max(0, Date.now() / 1000 - ts);
  if (s < 90) return 'just now';
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  if (s < 172800) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
