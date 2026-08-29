// Mock harness: emits only the documented event types with realistic timing.
// A stand-in for the real backend — no fight logic beyond plausible pacing.

import { dispatch } from './events.js';

const TOOLS = [
  'read failing test', 'grep call sites', 'edit routes.ts', 'edit handler.ts',
  'run tests', 'read stack trace', 'edit config', 'write regression test',
  'refactor helper', 'run linter', 'read docs', 'edit middleware',
];

const COMMITS = [
  'add limiter', 'fix off-by-one', 'handle null case', 'add regression test',
  'extract helper', 'tighten types', 'fix race', 'update snapshot',
  'guard empty input', 'simplify branch',
];

let running = false;

export function isMockRunning() { return running; }

export function startMockFight({ repo, task, a, b }) {
  if (running) return;
  running = true;
  const session = `fight-${Math.random().toString(16).slice(2, 6)}`;
  const q = [];
  let t = 0;
  const push = (dt, ev) => { t += dt; q.push({ at: t, ev }); };

  push(0, { type: 'session.opened', session, repo, task });
  push(800, { type: 'fighter.started', side: 'a', agent: a, sandbox: `sb-a-${session.slice(6)}`, branch: `fight/a-${session.slice(6)}` });
  push(600, { type: 'fighter.started', side: 'b', agent: b, sandbox: `sb-b-${session.slice(6)}`, branch: `fight/b-${session.slice(6)}` });

  // Interleaved work: tools, commits, test runs. A is slightly faster.
  const plan = { a: { commits: 4 + rint(3), speed: 1 }, b: { commits: 3 + rint(3), speed: 1.25 } };
  const totals = { a: 10 + rint(6), b: 10 + rint(6) };
  for (const side of ['a', 'b']) {
    let lt = 1600;
    const total = totals[side];
    for (let i = 0; i < plan[side].commits; i++) {
      for (let k = 0; k < 1 + rint(2); k++) {
        lt += (900 + rint(1800)) * plan[side].speed;
        qAt(q, lt, { type: 'tool.called', side, tool: pick(TOOLS) });
      }
      lt += (700 + rint(1200)) * plan[side].speed;
      qAt(q, lt, { type: 'commit.pushed', side, sha: sha(), msg: pick(COMMITS) });
      const passed = Math.min(total, Math.round(total * (0.5 + (i + 1) / plan[side].commits * 0.5)) - rint(2));
      lt += (600 + rint(900)) * plan[side].speed;
      qAt(q, lt, { type: 'tests.result', side, ok: passed === total, passed: Math.max(0, passed), total });
    }
    qAt(q, lt + 500, { type: 'fighter.done', side });
  }

  // Referee after both are done
  const doneAt = Math.max(...q.filter((x) => x.ev.type === 'fighter.done').map((x) => x.at));
  let rt = doneAt + 1200;
  qAt(q, rt, { type: 'referee.spawned', sandbox: `sb-ref-${session.slice(6)}` });
  const findings = 1 + rint(3);
  const sides = ['a', 'b'];
  const msgs = [
    '2 tests weakened', 'unused variable introduced', 'error path swallowed',
    'diff touches unrelated file', 'missing null guard', 'good test coverage added',
  ];
  for (let i = 0; i < findings; i++) {
    rt += 1400 + rint(1600);
    qAt(q, rt, {
      type: 'referee.finding', side: pick(sides),
      severity: pick(['low', 'medium', 'high']), msg: pick(msgs),
    });
  }
  rt += 2000;
  const winner = Math.random() < 0.5 ? 'a' : 'b';
  const ws = 70 + rint(25), ls = 40 + rint(25);
  qAt(q, rt, {
    type: 'verdict', winner,
    score: { a: winner === 'a' ? ws : ls, b: winner === 'b' ? ws : ls },
    pr: 4000 + rint(999),
    deleted: `fight/${winner === 'a' ? 'b' : 'a'}-${session.slice(6)}`,
  });
  qAt(q, rt + 6000, { type: 'session.closed' });

  // Fire on schedule
  q.sort((x, y) => x.at - y.at);
  const start = performance.now();
  const timer = setInterval(() => {
    const now = performance.now() - start;
    while (q.length && q[0].at <= now) {
      dispatch(q.shift().ev);
    }
    if (!q.length) { clearInterval(timer); running = false; }
  }, 60);
}

function qAt(q, at, ev) { q.push({ at, ev }); }
function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }
function rint(n) { return (Math.random() * n) | 0; }
function sha() { return Math.random().toString(16).slice(2, 10); }
