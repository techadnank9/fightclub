// DOM HUD: fight card (what each fighter is doing / waiting on / did),
// harness sandbox panel, event log, verdict overlay. Pure event consumer.

const $ = (s) => document.querySelector(s);

export class Hud {
  constructor() {
    this.card = $('#fightcard');
    this.harness = $('#harness');
    this.verdictEl = $('#verdict');
    this.sandboxes = new Map();
    $('#verdict-close').addEventListener('click', () => {
      this.verdictEl.classList.remove('show');
    });
  }

  handle(ev) {
    switch (ev.type) {
      case 'session.opened': {
        this.reset();
        this.card.style.display = 'block';
        this.harness.style.display = 'block';
        this.card.querySelector('.task').textContent = `${ev.repo} — ${ev.task}`;
        this.logLine(`session ${ev.session} opened`, '');
        break;
      }
      case 'fighter.started': {
        const f = this.fighter(ev.side);
        f.querySelector('.nm').textContent = ev.agent.toUpperCase();
        this.setState(ev.side, 'working', 'spinning up sandbox');
        this.sandbox(ev.sandbox, 'running');
        this.logLine(`${ev.agent} enters (${ev.branch})`, `t-${ev.side}`);
        break;
      }
      case 'tool.called': {
        this.setState(ev.side, 'working', ev.tool);
        this.logLine(`[${ev.side}] ${ev.tool}`, `t-${ev.side}`);
        break;
      }
      case 'commit.pushed': {
        const f = this.fighter(ev.side);
        const c = f.querySelector('.commits');
        const n = (parseInt(c.dataset.n ?? '0', 10) + 1);
        c.dataset.n = n;
        c.textContent = `${n} commit${n > 1 ? 's' : ''}`;
        this.setState(ev.side, 'working', `pushed: ${ev.msg}`);
        this.logLine(`[${ev.side}] commit ${ev.sha.slice(0, 7)} ${ev.msg}`, `t-${ev.side}`);
        break;
      }
      case 'tests.result': {
        const f = this.fighter(ev.side);
        f.querySelector('.tests').textContent = `${ev.passed}/${ev.total} tests`;
        const fill = f.querySelector('.fill');
        fill.style.width = `${(ev.passed / Math.max(1, ev.total)) * 100}%`;
        fill.classList.toggle('fail', !ev.ok);
        this.logLine(`[${ev.side}] tests ${ev.passed}/${ev.total}`, ev.ok ? '' : `t-${ev.side}`);
        break;
      }
      case 'fighter.done': {
        this.setState(ev.side, 'waiting', 'waiting for referee');
        this.logLine(`[${ev.side}] done`, `t-${ev.side}`);
        break;
      }
      case 'referee.spawned': {
        this.sandbox(ev.sandbox, 'running');
        this.logLine('referee enters the arena', 't-ref');
        break;
      }
      case 'referee.finding': {
        this.logLine(`referee (qodo): [${ev.side}] ${ev.severity} — ${ev.msg}`, 't-ref');
        break;
      }
      case 'verdict': {
        this.setState(ev.winner, 'done', 'winner');
        const loser = ev.winner === 'a' ? 'b' : 'a';
        this.setState(loser, 'done', 'branch deleted');
        this.showVerdict(ev);
        this.logLine(`verdict: ${ev.winner.toUpperCase()} wins ${ev.score[ev.winner]}–${ev.score[loser]}`, 't-ref');
        break;
      }
      case 'session.closed': {
        for (const [id] of this.sandboxes) this.sandbox(id, 'closed');
        this.logLine('session closed', '');
        break;
      }
    }
  }

  fighter(side) { return this.card.querySelector(`.fighter[data-side="${side}"]`); }

  setState(side, state, text) {
    const f = this.fighter(side);
    const dot = f.querySelector('.state-dot');
    dot.className = `state-dot ${state}`;
    f.querySelector('.state-txt').textContent = state;
    if (text != null) f.querySelector('.status').textContent = text;
  }

  sandbox(id, state) {
    this.sandboxes.set(id, state);
    const el = document.querySelector('#sandboxes');
    el.innerHTML = '';
    for (const [sid, st] of this.sandboxes) {
      const row = document.createElement('div');
      row.className = 'sbx';
      row.innerHTML = `<span class="id">${sid}</span><span>${st}</span>`;
      el.appendChild(row);
    }
  }

  logLine(text, cls) {
    const el = document.querySelector('#eventlog');
    const row = document.createElement('div');
    if (cls) row.className = cls;
    row.textContent = text;
    el.prepend(row);
    while (el.children.length > 40) el.lastChild.remove();
  }

  showVerdict(ev) {
    const loser = ev.winner === 'a' ? 'b' : 'a';
    this.verdictEl.querySelector('.winner').textContent = `FIGHTER ${ev.winner.toUpperCase()} WINS`;
    this.verdictEl.querySelector('.score').textContent = `${ev.score[ev.winner]} — ${ev.score[loser]}`;
    this.verdictEl.querySelector('.pr').textContent = ev.pr ? `PR #${ev.pr} opened` : '';
    this.verdictEl.querySelector('.deleted').textContent = ev.deleted ? `${ev.deleted} deleted` : '';
    this.verdictEl.classList.add('show');
  }

  reset() {
    this.verdictEl.classList.remove('show');
    this.sandboxes.clear();
    document.querySelector('#sandboxes').innerHTML = '';
    document.querySelector('#eventlog').innerHTML = '';
    for (const side of ['a', 'b']) {
      const f = this.fighter(side);
      f.querySelector('.nm').textContent = '—';
      f.querySelector('.status').textContent = '';
      const c = f.querySelector('.commits');
      c.dataset.n = '0'; c.textContent = '0 commits';
      f.querySelector('.tests').textContent = '— tests';
      const fill = f.querySelector('.fill');
      fill.style.width = '0%'; fill.classList.remove('fail');
      this.setState(side, '', 'idle');
    }
  }
}
