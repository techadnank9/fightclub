const pptxgen = require('pptxgenjs');
const pres = new pptxgen();
pres.layout = 'LAYOUT_WIDE'; // 13.33 x 7.5

const BG = '0A0E1A';       // night city navy
const INK = 'DFE6FF';
const DIM = '8B96C2';
const A = 'FFB347';        // fighter A amber
const B = '7EC8FF';        // fighter B blue
const GOOD = '6FE3A1';
const REF = 'C9A5FF';

const IMG = (n) => `docs/deck/${n}.png`;

// ── 1. Title ──────────────────────────────────────────────
{
  const s = pres.addSlide();
  s.background = { color: BG };
  // hero image fills the bottom
  s.addImage({ path: IMG('hero'), x: 0, y: 3.1, w: 13.33, h: 4.4 });
  s.addText('AGENT FIGHT CITY', {
    x: 0.7, y: 0.55, w: 12, h: 1.1, fontSize: 54, bold: true, color: INK,
    fontFace: 'Arial', charSpacing: 4, isTextBox: true, margin: 0,
  });
  s.addText([
    { text: 'Two AI agents. One bug. ', options: { color: DIM } },
    { text: 'A whole city watching.', options: { color: A } },
  ], {
    x: 0.72, y: 1.7, w: 12, h: 0.6, fontSize: 24, italic: true,
    fontFace: 'Cambria', isTextBox: true, margin: 0,
  });
  s.addText('Adnan  ·  @techadnank9  ·  agentfightclub.vercel.app', {
    x: 0.72, y: 2.45, w: 12, h: 0.4, fontSize: 14, color: DIM,
    fontFace: 'Arial', isTextBox: true, margin: 0,
  });
}

// ── 2. Why ────────────────────────────────────────────────
{
  const s = pres.addSlide();
  s.background = { color: BG };
  s.addImage({ path: IMG('night'), x: 7.4, y: 0, w: 5.93, h: 7.5 });
  s.addText('Benchmarks rank\naverages.', {
    x: 0.7, y: 1.0, w: 6.3, h: 1.8, fontSize: 40, bold: true, color: INK,
    fontFace: 'Arial', isTextBox: true, margin: 0,
  });
  s.addText('Nobody ships averages.', {
    x: 0.7, y: 2.9, w: 6.3, h: 0.7, fontSize: 26, color: DIM,
    fontFace: 'Arial', isTextBox: true, margin: 0,
  });
  s.addText('Which agent fixes THIS bug,\nin MY repo, without breaking anything?', {
    x: 0.7, y: 4.0, w: 6.3, h: 1.3, fontSize: 22, italic: true, color: A,
    fontFace: 'Cambria', isTextBox: true, margin: 0,
  });
  s.addText('So we made them fight.', {
    x: 0.7, y: 5.7, w: 6.3, h: 0.7, fontSize: 26, bold: true, color: GOOD,
    fontFace: 'Arial', isTextBox: true, margin: 0,
  });
}

// ── 3. Demo ───────────────────────────────────────────────
{
  const s = pres.addSlide();
  s.background = { color: BG };
  s.addText('Every floor is a real commit.', {
    x: 0.7, y: 0.4, w: 12, h: 0.7, fontSize: 32, bold: true, color: INK,
    fontFace: 'Arial', isTextBox: true, margin: 0,
  });
  s.addImage({ path: IMG('build'), x: 0.7, y: 1.35, w: 5.9, h: 4.86 });
  s.addImage({ path: IMG('verdict'), x: 6.85, y: 1.35, w: 5.78, h: 4.86 });
  s.addText('they build, commit by commit…', {
    x: 0.7, y: 6.35, w: 5.9, h: 0.45, fontSize: 15, italic: true, color: B,
    fontFace: 'Cambria', isTextBox: true, margin: 0, align: 'center',
  });
  s.addText('…the referee scores it, opens the winner’s PR', {
    x: 6.85, y: 6.35, w: 5.78, h: 0.45, fontSize: 15, italic: true, color: REF,
    fontFace: 'Cambria', isTextBox: true, margin: 0, align: 'center',
  });
  s.addText('live: agentfightclub.vercel.app', {
    x: 0.7, y: 6.95, w: 12, h: 0.4, fontSize: 13, color: DIM,
    fontFace: 'Arial', isTextBox: true, margin: 0, align: 'center',
  });
}

// ── 4. Architecture (technical) ──────────────────────────
{
  const s = pres.addSlide();
  s.background = { color: BG };
  s.addText('Architecture', {
    x: 0.6, y: 0.25, w: 12, h: 0.6, fontSize: 30, bold: true, color: INK,
    fontFace: 'Arial', isTextBox: true, margin: 0,
  });

  const CARD = '141A2E';
  const box = (x, y, w, h, edge) => s.addShape(pres.ShapeType.roundRect, {
    x, y, w, h, rectRadius: 0.08, fill: { color: CARD }, line: { color: edge, width: 1.25 },
  });
  const t = (txt, x, y, w, opts = {}) => s.addText(txt, Object.assign({
    x, y, w, h: 0.35, fontSize: 12, color: INK, fontFace: 'Arial',
    isTextBox: true, margin: 0, align: 'center',
  }, opts));
  const arrow = (x, y, w, h, opts = {}) => s.addShape(pres.ShapeType.line, Object.assign({
    x, y, w, h, line: { color: DIM, width: 1.5, endArrowType: 'triangle' },
  }, opts));
  const lbl = (txt, x, y, w) => t(txt, x, y, w, { fontSize: 10.5, color: DIM, italic: true, fontFace: 'Cambria' });

  // ── Browser (left) ──
  box(0.6, 1.1, 3.0, 2.5, B);
  t('BROWSER', 0.75, 1.25, 2.7, { bold: true, fontSize: 15, color: B });
  t('Three.js city + HUD\nreplay scrubber\nzero fight logic —\nrenders 10 event types', 0.75, 1.75, 2.7, { h: 1.6, fontSize: 12.5 });

  // ── Server (middle top) ──
  box(4.9, 1.1, 3.4, 2.5, GOOD);
  t('FastAPI SERVER', 5.05, 1.25, 3.1, { bold: true, fontSize: 15, color: GOOD });
  t('POST /fight  →  session\nGET /events  (SSE)\nGET /repos · /stats\n"a dumb pipe, on purpose"', 5.05, 1.75, 3.1, { h: 1.6, fontSize: 12.5 });

  // browser <-> server
  arrow(3.6, 1.9, 1.3, 0, {});
  lbl('POST /fight', 3.55, 1.55, 1.4);
  arrow(4.9, 2.75, 1.3, 0, { flipH: true });
  lbl('SSE event stream', 3.4, 2.9, 1.7);

  // ── Harness (middle bottom) ──
  box(3.7, 4.15, 5.9, 2.9, A);
  t('FIGHT HARNESS  (python subprocess · emits JSONL on stdout)', 3.85, 4.28, 5.6, { bold: true, fontSize: 13, color: A });
  // three agent boxes inside
  box(3.95, 4.85, 1.75, 1.95, A);
  t('FIGHTER A', 4.0, 4.95, 1.65, { bold: true, fontSize: 12, color: A });
  t('sandbox clone\nbranch fight/a\nTrueFoundry\ngateway', 4.0, 5.32, 1.65, { h: 1.35, fontSize: 10.5 });
  box(5.8, 4.85, 1.75, 1.95, B);
  t('FIGHTER B', 5.85, 4.95, 1.65, { bold: true, fontSize: 12, color: B });
  t('sandbox clone\nbranch fight/b\nOpenAI /\nGemini Vertex', 5.85, 5.32, 1.65, { h: 1.35, fontSize: 10.5 });
  box(7.65, 4.85, 1.75, 1.95, REF);
  t('REFEREE', 7.7, 4.95, 1.65, { bold: true, fontSize: 12, color: REF });
  t("clean 4th clone\nre-runs MAIN's\ntests · reviews\ndiffs · scores", 7.7, 5.32, 1.65, { h: 1.35, fontSize: 10.5 });

  // server -> harness
  arrow(6.6, 3.6, 0, 0.55, {});
  lbl('spawn · pipe stdout', 6.75, 3.62, 2.0);

  // ── External (right) ──
  box(10.3, 0.95, 2.45, 1.5, GOOD);
  t('GITHUB', 10.4, 1.06, 2.25, { bold: true, fontSize: 13, color: GOOD });
  t("winner's PR opened\nloser's branch deleted", 10.4, 1.45, 2.25, { h: 0.8, fontSize: 11 });
  box(10.3, 2.75, 2.45, 1.5, B);
  t('BRIGHT DATA', 10.4, 2.86, 2.25, { bold: true, fontSize: 13, color: B });
  t('Web Unlocker scrapes\nGitHub → repos.json', 10.4, 3.25, 2.25, { h: 0.8, fontSize: 11 });
  box(10.3, 4.55, 2.45, 1.5, A);
  t('CLICKHOUSE', 10.4, 4.66, 2.25, { bold: true, fontSize: 13, color: A });
  t('every event inserted\nJSONEachRow · /stats', 10.4, 5.05, 2.25, { h: 0.8, fontSize: 11 });
  box(10.3, 6.35, 2.45, 0.85, REF);
  t('QODO', 10.4, 6.44, 2.25, { bold: true, fontSize: 13, color: REF });
  t('reviews every PR merged', 10.4, 6.8, 2.25, { fontSize: 10.5 });

  // harness -> github (push/PR)
  arrow(9.6, 5.5, 0.7, -3.6, {});
  lbl('git push · gh pr create', 8.55, 4.0, 2.1);
  // bright data -> server (repos)
  arrow(10.3, 3.5, -2.0, -1.2, { flipH: true });
  // server -> clickhouse
  arrow(8.3, 3.3, 2.0, 2.0, {});
  lbl('events', 9.35, 4.35, 1.0);
  // github -> qodo note is positional (right column stack)

  s.addText('60% original tests · 25% review findings · 15% diff economy  →  one verdict, shown live', {
    x: 0.6, y: 7.05, w: 9.4, h: 0.4, fontSize: 12.5, italic: true, color: A,
    fontFace: 'Cambria', isTextBox: true, margin: 0,
  });
}

// ── 5. QR ─────────────────────────────────────────────────
{
  const s = pres.addSlide();
  s.background = { color: BG };
  s.addText('Come start a fight.', {
    x: 0.7, y: 0.9, w: 12, h: 0.9, fontSize: 44, bold: true, color: INK,
    fontFace: 'Arial', isTextBox: true, margin: 0, align: 'center',
  });
  s.addShape(pres.ShapeType.roundRect, {
    x: 5.06, y: 2.1, w: 3.2, h: 3.2, rectRadius: 0.15, fill: { color: 'FFFFFF' },
  });
  s.addImage({ path: IMG('qr'), x: 5.26, y: 2.3, w: 2.8, h: 2.8 });
  s.addText('agentfightclub.vercel.app', {
    x: 0.7, y: 5.6, w: 12, h: 0.6, fontSize: 24, bold: true, color: GOOD,
    fontFace: 'Arial', isTextBox: true, margin: 0, align: 'center',
  });
  s.addText('pick a building · pick a bug · pick your fighters', {
    x: 0.7, y: 6.3, w: 12, h: 0.5, fontSize: 16, italic: true, color: DIM,
    fontFace: 'Cambria', isTextBox: true, margin: 0, align: 'center',
  });
}

pres.writeFile({ fileName: 'docs/deck/agent-fight-city.pptx' }).then(() => console.log('deck written'));
