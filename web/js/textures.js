// Canvas-generated textures: building facades with lit windows, neon signs,
// asphalt ground. Technique (window grid on canvas, emissive lit cells)
// borrowed conceptually from git-city; implementation is ours.

import * as THREE from 'three';

const WARM = ['#ffd9a0', '#ffe9c4', '#ffc978', '#fff3d6'];
const COOL = ['#bcd9ff', '#dceaff', '#9fc4f5'];

// Facade: grid of windows, some lit. litRatio drives how alive the building looks.
// Returns { map, emissiveMap } sharing the same canvas layout.
export function makeFacadeTextures({ cols, rows, litRatio, faceColor = '#4a5068', seed = 1 }) {
  const cell = 16;
  const w = cols * cell, h = rows * cell;

  const rand = mulberry32(seed);

  const face = document.createElement('canvas');
  face.width = w; face.height = h;
  const fc = face.getContext('2d');

  const emis = document.createElement('canvas');
  emis.width = w; emis.height = h;
  const ec = emis.getContext('2d');

  // Wall base with subtle vertical concrete striping
  fc.fillStyle = faceColor;
  fc.fillRect(0, 0, w, h);
  fc.globalAlpha = 0.07;
  for (let x = 0; x < w; x += 4) {
    fc.fillStyle = rand() > 0.5 ? '#ffffff' : '#000000';
    fc.fillRect(x, 0, 2, h);
  }
  fc.globalAlpha = 1;

  ec.fillStyle = '#000000';
  ec.fillRect(0, 0, w, h);

  // Windows: inset in each cell. Lit ones glow on the emissive map.
  const pad = 3;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * cell + pad, y = r * cell + pad;
      const ww = cell - pad * 2, wh = cell - pad * 2 - 2;
      const lit = rand() < litRatio;
      // Frame
      fc.fillStyle = '#0a0f1d';
      fc.fillRect(x - 1, y - 1, ww + 2, wh + 2);
      if (lit) {
        const col = rand() < 0.75 ? WARM[(rand() * WARM.length) | 0] : COOL[(rand() * COOL.length) | 0];
        fc.fillStyle = col;
        fc.fillRect(x, y, ww, wh);
        ec.fillStyle = col;
        ec.fillRect(x, y, ww, wh);
        // Occasional half-drawn blind
        if (rand() < 0.25) {
          const blind = (wh * (0.3 + rand() * 0.4)) | 0;
          fc.fillStyle = 'rgba(10,15,29,0.85)';
          fc.fillRect(x, y, ww, blind);
          ec.fillStyle = 'rgba(0,0,0,0.85)';
          ec.fillRect(x, y, ww, blind);
        }
      } else {
        // Dark glass with faint sky reflection gradient
        const g = fc.createLinearGradient(x, y, x, y + wh);
        g.addColorStop(0, '#1c2742');
        g.addColorStop(1, '#0c1120');
        fc.fillStyle = g;
        fc.fillRect(x, y, ww, wh);
      }
    }
  }

  const map = new THREE.CanvasTexture(face);
  const emissiveMap = new THREE.CanvasTexture(emis);
  map.colorSpace = THREE.SRGBColorSpace;
  emissiveMap.colorSpace = THREE.SRGBColorSpace;
  for (const t of [map, emissiveMap]) {
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.anisotropy = 4;
  }
  return { map, emissiveMap };
}

// Neon sign strip with repo name. Rendered emissive-only.
export function makeSignTexture(text, colorHex) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#05070f';
  ctx.fillRect(0, 0, c.width, c.height);
  const col = '#' + colorHex.toString(16).padStart(6, '0');
  ctx.font = 'bold 34px "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = col;
  ctx.shadowBlur = 18;
  ctx.fillStyle = col;
  ctx.fillText(text.slice(0, 24), c.width / 2, c.height / 2 + 2);
  ctx.shadowBlur = 0;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Ground: asphalt blocks with sidewalk edges and street lane dashes.
export function makeGroundTexture(gridCells, blockPx = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = gridCells * blockPx;
  const ctx = c.getContext('2d');
  const rand = mulberry32(7);

  // Asphalt base
  ctx.fillStyle = '#0d1017';
  ctx.fillRect(0, 0, c.width, c.height);
  // Noise speckle
  for (let i = 0; i < c.width * 18; i++) {
    ctx.fillStyle = rand() > 0.5 ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.05)';
    ctx.fillRect(rand() * c.width, rand() * c.height, 2, 2);
  }

  const lotPx = blockPx * 0.62;                 // sidewalk+lot area per cell
  for (let gy = 0; gy < gridCells; gy++) {
    for (let gx = 0; gx < gridCells; gx++) {
      const x = gx * blockPx, y = gy * blockPx;
      const off = (blockPx - lotPx) / 2;
      // Sidewalk slab
      ctx.fillStyle = '#1a1f2c';
      ctx.fillRect(x + off - 6, y + off - 6, lotPx + 12, lotPx + 12);
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.strokeRect(x + off - 6, y + off - 6, lotPx + 12, lotPx + 12);
      // Lot base
      ctx.fillStyle = '#12151f';
      ctx.fillRect(x + off, y + off, lotPx, lotPx);
    }
  }

  // Street center dashes between cells
  ctx.strokeStyle = 'rgba(240,220,130,0.5)';
  ctx.lineWidth = 3;
  ctx.setLineDash([14, 18]);
  for (let g = 1; g < gridCells; g++) {
    const p = g * blockPx;
    ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, c.height); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(c.width, p); ctx.stroke();
  }
  ctx.setLineDash([]);

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
