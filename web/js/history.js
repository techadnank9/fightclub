// Past fights. The server keeps every real fight's event log in .fights/,
// GET /fights lists them, and POST /fight {replay} streams one back through
// the ordinary event path — so a replayed fight animates exactly like a live
// one, no special-casing anywhere downstream.
//
// Mock fights (?mock=1) never reach the server and so never appear here.

import { connectSession } from './stream.js';

const $ = (s) => document.querySelector(s);

export class History {
  constructor() {
    this.el = $('#history');
    this.listEl = $('#history-list');
    this.open = false;
    this.speed = 4;

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
    let fights;
    try {
      const r = await fetch('/fights');
      if (!r.ok) throw new Error(r.status);
      ({ fights } = await r.json());
    } catch {
      this.listEl.innerHTML =
        '<div class="hempty">no backend reachable — history lives on the server, '
        + 'and mock fights (<code>?mock=1</code>) are never recorded.</div>';
      return;
    }
    if (!fights.length) {
      this.listEl.innerHTML = '<div class="hempty">no fights recorded yet</div>';
      return;
    }
    this.listEl.innerHTML = '';
    for (const f of fights) this.listEl.appendChild(this.row(f));
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
      [f.pr ? `PR #${f.pr}` : null, `${f.events} events`, ago(f.at)].filter(Boolean).join('  ·  ');
    if (!f.complete) el.classList.add('partial');
    el.addEventListener('click', () => this.replay(f, el));
    return el;
  }

  async replay(f, el) {
    el.classList.add('loading');
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
}

function ago(ts) {
  const s = Math.max(0, Date.now() / 1000 - ts);
  if (s < 90) return 'just now';
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  if (s < 172800) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
