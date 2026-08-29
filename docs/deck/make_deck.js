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

// ── 4. Architecture (sponsors) ───────────────────────────
{
  const s = pres.addSlide();
  s.background = { color: BG };
  s.addText('How a fight flows', {
    x: 0.7, y: 0.4, w: 12, h: 0.7, fontSize: 32, bold: true, color: INK,
    fontFace: 'Arial', isTextBox: true, margin: 0,
  });

  const chips = [
    { name: 'Bright Data', role: 'scrapes live GitHub —\nthe skyline IS the data', color: B },
    { name: 'TrueFoundry', role: 'AI gateway runs the\nfighter + referee agents', color: A },
    { name: 'Qodo', role: 'review gates every PR —\nours and the referee’s', color: REF },
    { name: 'GitHub', role: 'winner’s PR opens,\nloser’s branch deleted', color: GOOD },
  ];
  const cw = 2.75, ch = 2.5, gap = 0.45, y0 = 2.0;
  let x = 0.7;
  chips.forEach((c, i) => {
    s.addShape(pres.ShapeType.roundRect, {
      x, y: y0, w: cw, h: ch, rectRadius: 0.12,
      fill: { color: '141A2E' }, line: { color: c.color, width: 1.5 },
    });
    s.addText(c.name, {
      x: x + 0.15, y: y0 + 0.35, w: cw - 0.3, h: 0.6, fontSize: 21, bold: true,
      color: c.color, fontFace: 'Arial', isTextBox: true, margin: 0, align: 'center',
    });
    s.addText(c.role, {
      x: x + 0.15, y: y0 + 1.05, w: cw - 0.3, h: 1.2, fontSize: 13.5,
      color: INK, fontFace: 'Arial', isTextBox: true, margin: 0, align: 'center',
    });
    if (i < chips.length - 1) {
      s.addText('→', {
        x: x + cw + 0.02, y: y0 + 0.9, w: gap, h: 0.7, fontSize: 26, bold: true,
        color: DIM, fontFace: 'Arial', isTextBox: true, margin: 0, align: 'center',
      });
    }
    x += cw + gap;
  });

  s.addText([
    { text: 'plus  ', options: { color: DIM } },
    { text: 'ClickHouse Cloud', options: { color: INK, bold: true } },
    { text: '  for every fight event  ·  ', options: { color: DIM } },
    { text: 'Vercel', options: { color: INK, bold: true } },
    { text: '  for the live city  ·  ', options: { color: DIM } },
    { text: 'Gemini on Vertex', options: { color: INK, bold: true } },
    { text: '  in the ring', options: { color: DIM } },
  ], {
    x: 0.7, y: 5.3, w: 12, h: 0.5, fontSize: 15, fontFace: 'Arial',
    isTextBox: true, margin: 0, align: 'center',
  });
  s.addText('The frontend holds zero fight logic — ten JSON events drive everything you see.', {
    x: 0.7, y: 6.1, w: 12, h: 0.5, fontSize: 15, italic: true, color: A,
    fontFace: 'Cambria', isTextBox: true, margin: 0, align: 'center',
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
