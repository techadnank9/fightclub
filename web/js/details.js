// Full fight log: the cramped harness feed is a ticker, this is the record.
// Two columns (a | b) with every commit, tool call and test run, plus the
// referee's findings and verdict. Pure event consumer — resets on
// session.opened, so replay scrubbing rebuilds it exactly like the 3D scene.

import { subscribe } from './events.js';

const $ = (s) => document.querySelector(s);

export class Details {
  constructor() {
    this.el = $('#details');
    this.open = false;
    this.commitsOnly = false;
    this.reset();

    subscribe((ev) => this.handle(ev));

    $('#details-close').addEventListener('click', () => this.toggle(false));
    $('#details-open').addEventListener('click', () => this.toggle());
    $('#details-filter').addEventListener('click', () => {
      this.commitsOnly = !this.commitsOnly;
      $('#details-filter').textContent = this.commitsOnly ? 'ALL EVENTS' : 'COMMITS ONLY';
      this.render();
    });
    addEventListener('keydown', (e) => {
      // Don't steal keystrokes from the task box / agent selects.
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (e.key === 'l' || e.key === 'L') this.toggle();
      if (e.key === 'Escape' && this.open) this.toggle(false);
    });
  }

  reset() {
    this.meta = { repo: '', task: '', session: '' };
    this.sides = {
      a: { agent: '—', branch: '', sandbox: '', rows: [], commits: 0, tests: null, refTests: null },
      b: { agent: '—', branch: '', sandbox: '', rows: [], commits: 0, tests: null, refTests: null },
    };
    this.findings = [];
    this.verdict = null;
  }

  toggle(force) {
    this.open = force ?? !this.open;
    this.el.style.display = this.open ? 'flex' : 'none';
    if (this.open) this.render();
  }

  handle(ev) {
    const s = this.sides[ev.side];
    switch (ev.type) {
      case 'session.opened':
        this.reset();
        this.meta = { repo: ev.repo, task: ev.task, session: ev.session };
        break;
      case 'fighter.started':
        s.agent = ev.agent; s.branch = ev.branch; s.sandbox = ev.sandbox;
        break;
      case 'tool.called':
        s.rows.push({ kind: 'tool', text: ev.tool });
        break;
      case 'commit.pushed':
        s.commits++;
        s.rows.push({ kind: 'commit', sha: ev.sha, text: ev.msg, n: s.commits });
        break;
      case 'tests.result':
        // by:'referee' is the ORIGINAL suite from main re-run on the branch —
        // authoritative, and not the same as the fighter's own run.
        if (ev.by === 'referee') {
          s.refTests = { passed: ev.passed, total: ev.total, ok: ev.ok };
          s.rows.push({ kind: 'reftests', text: `referee re-ran main's tests: ${ev.passed}/${ev.total}`, ok: ev.ok });
        } else {
          s.tests = { passed: ev.passed, total: ev.total, ok: ev.ok };
          s.rows.push({ kind: 'tests', text: `${ev.passed}/${ev.total}`, ok: ev.ok });
        }
        break;
      case 'fighter.done':
        s.rows.push({ kind: 'done', text: 'finished — waiting for referee' });
        break;
      case 'referee.finding':
        this.findings.push({ side: ev.side, severity: ev.severity, msg: ev.msg });
        break;
      case 'verdict':
        this.verdict = ev;
        break;
    }
    if (this.open) this.render();
  }

  render() {
    $('#details-task').textContent = this.meta.repo
      ? `${this.meta.repo} — ${this.meta.task}`
      : 'no fight yet — start one and the full log lands here';
    $('#details-session').textContent = this.meta.session ? `session ${this.meta.session}` : '';

    for (const side of ['a', 'b']) {
      const s = this.sides[side];
      const col = this.el.querySelector(`.dcol[data-side="${side}"]`);
      const won = this.verdict && this.verdict.winner === side;
      col.querySelector('.dagent').textContent = s.agent.toUpperCase();
      col.querySelector('.dbadge').textContent = won ? 'WINNER' : (this.verdict ? 'branch deleted' : '');
      col.querySelector('.dbadge').className = `dbadge ${won ? 'win' : 'lose'}`;
      col.querySelector('.dmeta').textContent =
        [s.branch, s.sandbox, `${s.commits} commit${s.commits === 1 ? '' : 's'}`,
         s.tests ? `${s.tests.passed}/${s.tests.total} own tests` : null,
         s.refTests ? `${s.refTests.passed}/${s.refTests.total} referee tests` : null]
        .filter(Boolean).join('  ·  ');

      // Score breakdown, once the verdict carries one
      const bd = this.verdict?.breakdown?.[side];
      const bEl = col.querySelector('.dscore');
      if (bd) {
        bEl.style.display = 'block';
        bEl.innerHTML = '';
        const parts = [
          ['tests', bd.tests, 60, `${bd.passed}/${bd.total} on main's suite`],
          ['review', bd.review, 25, `${bd.findings} qodo finding${bd.findings === 1 ? '' : 's'}`],
          ['economy', bd.economy, 15, `${bd.diffLines} diff lines`],
        ];
        for (const [name, val, cap, detail] of parts) {
          const row = document.createElement('div');
          row.className = 'dscomp';
          row.innerHTML = `<span class="sn"></span><span class="sbar"><i></i></span><span class="sv"></span><span class="sd"></span>`;
          row.querySelector('.sn').textContent = name;
          row.querySelector('.sv').textContent = `${val}/${cap}`;
          row.querySelector('.sd').textContent = detail;
          row.querySelector('.sbar i').style.width = `${Math.max(0, Math.min(100, (val / cap) * 100))}%`;
          bEl.appendChild(row);
        }
      } else {
        bEl.style.display = 'none';
      }

      const rows = this.commitsOnly ? s.rows.filter((r) => r.kind === 'commit') : s.rows;
      const body = col.querySelector('.drows');
      body.innerHTML = '';
      if (!rows.length) {
        body.innerHTML = '<div class="drow empty">nothing yet</div>';
        continue;
      }
      for (const r of rows) {
        const d = document.createElement('div');
        d.className = `drow ${r.kind}${r.kind === 'tests' && !r.ok ? ' fail' : ''}`;
        if (r.kind === 'commit') {
          d.innerHTML = `<span class="cn">#${r.n}</span><span class="sha">${r.sha.slice(0, 7)}</span><span class="msg"></span>`;
          d.querySelector('.msg').textContent = r.text;
        } else {
          d.textContent = `${r.kind === 'tests' ? 'tests ' : ''}${r.text}`;
        }
        body.appendChild(d);
      }
    }

    const fEl = $('#details-findings');
    fEl.innerHTML = '';
    for (const f of this.findings) {
      const d = document.createElement('div');
      d.className = `dfind sev-${f.severity}`;
      d.textContent = `[${f.side}] ${f.severity} — ${f.msg}`;
      fEl.appendChild(d);
    }
    if (!this.findings.length) fEl.innerHTML = '<div class="drow empty">no findings yet</div>';

    const v = $('#details-verdict');
    if (this.verdict) {
      const l = this.verdict.winner === 'a' ? 'b' : 'a';
      v.textContent = `${this.verdict.winner.toUpperCase()} wins ${this.verdict.score[this.verdict.winner]}–${this.verdict.score[l]}`
        + (this.verdict.pr ? `  ·  PR #${this.verdict.pr} opened` : '')
        + (this.verdict.deleted ? `  ·  ${this.verdict.deleted} deleted` : '');
    } else {
      v.textContent = 'no verdict yet';
    }
  }
}
