// Repo -> realistic night tower. Tiered setbacks, lit-window facades,
// rooftop clutter (water tower, AC, antenna), neon name sign.

import * as THREE from 'three';
import { LANG_COLORS } from './config.js';
import { makeFacadeTextures, makeSignTexture, mulberry32 } from './textures.js';

const _roofMat = new THREE.MeshStandardMaterial({ color: 0x454b60, roughness: 0.95 });
const _darkMat = new THREE.MeshStandardMaterial({ color: 0x232838, roughness: 0.9 });
const _tankMat = new THREE.MeshStandardMaterial({ color: 0x3a3428, roughness: 0.8 });

export function repoSeed(fullName) {
  let s = 0;
  for (const ch of fullName) s = (s * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(s) + 1;
}

// Height scaling: proportional to real stars (1 floor ≈ 6k stars), so a
// 231k-star repo honestly towers over a 17k one. Capped so the tallest
// stays inside the fog/camera envelope.
function floorsFor(repo) {
  return Math.min(45, Math.max(3, Math.round(repo.stars / 6000) + 3));
}

export function makeBuilding(repo) {
  const group = new THREE.Group();
  const seed = repoSeed(repo.full_name);
  const rand = mulberry32(seed);
  const accent = LANG_COLORS[repo.language] ?? LANG_COLORS.default;

  const floors = floorsFor(repo);
  const activity = Math.min(1, Math.log10(Math.max(1, repo.commits)) / 6);
  const litRatio = 0.16 + activity * 0.34;
  const floorH = 2.0;

  // Painted facade: language color softened toward a warm plaster tone,
  // slightly different per building so the skyline reads colorful, not black.
  const ac = new THREE.Color(accent);
  const plaster = new THREE.Color(0x8f94a8);
  const wall = ac.clone().lerp(plaster, 0.45).offsetHSL((rand() - 0.5) * 0.04, 0.05, 0.02 + rand() * 0.06);
  const wallHex = '#' + wall.getHexString();

  // 1-3 tiers with setbacks, taller buildings get more
  const tierCount = floors > 18 ? 3 : floors > 10 ? 2 : 1;
  const tierFloors = splitFloors(floors, tierCount, rand);
  let baseW = 10 + rand() * 4;
  let baseD = 10 + rand() * 4;
  let y = 0;
  let topW = baseW, topD = baseD, topY = 0;

  tierFloors.forEach((tf, i) => {
    const h = tf * floorH;
    const cols = Math.max(3, Math.round(baseW / 1.9));
    const { map, emissiveMap } = makeFacadeTextures({
      cols, rows: tf, litRatio, seed: seed + i * 101, faceColor: wallHex,
    });
    const wallMat = new THREE.MeshStandardMaterial({
      map, emissiveMap,
      emissive: 0xffffff, emissiveIntensity: 0.8,
      roughness: 0.85,
    });
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(baseW, h, baseD),
      [wallMat, wallMat, _roofMat, _roofMat, wallMat, wallMat],
    );
    mesh.position.y = y + h / 2;
    group.add(mesh);

    topW = baseW; topD = baseD; topY = y + h;
    y += h;
    baseW *= 0.72 + rand() * 0.1;
    baseD *= 0.72 + rand() * 0.1;
  });

  // Rooftop crown: every building gets a distinct pointed/fun top
  addCrown(group, topW, topD, topY, rand, accent, repo);
  // Rooftop clutter on the top tier
  addRoofProps(group, topW, topD, topY, rand, accent);

  // Lit lobby band at street level (storefront glow)
  const lobby = new THREE.Mesh(
    new THREE.BoxGeometry(1, 2.4, 1),
    new THREE.MeshStandardMaterial({
      color: 0xffe8c0, emissive: 0xffdf9e, emissiveIntensity: 0.5, roughness: 0.6,
    }),
  );
  lobby.position.y = 1.2;
  lobby.userData.isLobby = true; // scaled to footprint below
  group.add(lobby);

  // Neon sign near the top of the base tier
  const sign = makeSign(repo.full_name.split('/')[1] ?? repo.full_name, accent, tierFloors[0] * floorH);
  group.add(sign);

  // Language-colored trim strip at street level
  const trim = new THREE.Mesh(
    new THREE.BoxGeometry(10 + 4 + 0.3, 0.5, 10 + 4 + 0.3),
    new THREE.MeshStandardMaterial({
      color: accent, emissive: accent, emissiveIntensity: 0.9, roughness: 0.4,
    }),
  );
  // match actual base footprint (before tier shrink mutated baseW)
  const first = group.children[0];
  const bb = new THREE.Box3().setFromObject(first);
  const size = bb.getSize(new THREE.Vector3());
  trim.scale.set((size.x + 0.4) / trim.geometry.parameters.width, 1, (size.z + 0.4) / trim.geometry.parameters.depth);
  trim.position.y = 0.25;
  group.add(trim);
  // Scale the lobby band slightly proud of the footprint
  group.traverse((o) => {
    if (o.userData?.isLobby) o.scale.set(size.x + 0.25, 1, size.z + 0.25);
  });

  group.userData.repo = repo;
  group.userData.accent = accent;
  group.userData.height = y;
  return group;
}

function splitFloors(total, tiers, rand) {
  if (tiers === 1) return [total];
  if (tiers === 2) {
    const a = Math.round(total * (0.55 + rand() * 0.15));
    return [a, total - a];
  }
  const a = Math.round(total * 0.5);
  const b = Math.round(total * 0.3);
  return [a, b, total - a - b];
}

// Distinct rooftop silhouettes: spire, pyramid, art deco crown, or billboard.
function addCrown(group, w, d, y, rand, accent, repo) {
  const style = ['spire', 'pyramid', 'deco', 'billboard'][(rand() * 4) | 0];
  const accMat = new THREE.MeshStandardMaterial({
    color: accent, emissive: accent, emissiveIntensity: 0.7, roughness: 0.5,
  });

  if (style === 'spire') {
    // Art deco needle: stepped drum + long spire
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.22, w * 0.3, 1.4, 8), _darkMat);
    drum.position.y = y + 0.7;
    const needleH = 4 + rand() * 5;
    const needle = new THREE.Mesh(new THREE.ConeGeometry(0.28, needleH, 8), accMat);
    needle.position.y = y + 1.4 + needleH / 2;
    group.add(drum, needle);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 8),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 2 }));
    tip.position.y = y + 1.4 + needleH + 0.15;
    tip.userData.blink = { phase: rand() * Math.PI * 2 };
    group.add(tip);
  } else if (style === 'pyramid') {
    // Glass pyramid cap, glows softly in the accent color
    const pyr = new THREE.Mesh(
      new THREE.ConeGeometry(Math.min(w, d) * 0.62, 2.2 + rand() * 2.2, 4),
      new THREE.MeshStandardMaterial({
        color: accent, emissive: accent, emissiveIntensity: 0.5,
        roughness: 0.3, transparent: true, opacity: 0.92,
      }),
    );
    pyr.rotation.y = Math.PI / 4;
    pyr.position.y = y + pyr.geometry.parameters.height / 2;
    group.add(pyr);
  } else if (style === 'deco') {
    // Stepped crown: 3 shrinking slabs + short mast
    let cw = w * 0.8, cd = d * 0.8, cy = y;
    for (let i = 0; i < 3; i++) {
      const h = 0.9 - i * 0.2;
      const slab = new THREE.Mesh(new THREE.BoxGeometry(cw, h, cd), i === 2 ? accMat : _darkMat);
      slab.position.y = cy + h / 2;
      group.add(slab);
      cy += h; cw *= 0.66; cd *= 0.66;
    }
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 2.4, 6), _darkMat);
    mast.position.y = cy + 1.2;
    group.add(mast);
  } else {
    // Rooftop billboard with the language name
    const label = (repo.language ?? 'CODE').toUpperCase();
    const tex = makeSignTexture(label, accent);
    const bw = Math.min(7, w * 0.9);
    const board = new THREE.Mesh(
      new THREE.PlaneGeometry(bw, bw * 0.24),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide }),
    );
    board.position.set(0, y + bw * 0.16 + 0.7, 0);
    board.rotation.y = rand() < 0.5 ? 0 : Math.PI / 2;
    const legGeo = new THREE.CylinderGeometry(0.05, 0.05, 1.4, 6);
    for (const dx of [-bw * 0.35, bw * 0.35]) {
      const leg = new THREE.Mesh(legGeo, _darkMat);
      leg.position.set(
        board.rotation.y === 0 ? dx : 0, y + 0.7,
        board.rotation.y === 0 ? 0 : dx,
      );
      group.add(leg);
    }
    group.add(board);
  }
}

function addRoofProps(group, w, d, y, rand, accent) {
  // Water tower
  if (rand() < 0.6 && w > 5) {
    const tank = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.1, 1.6, 10), _tankMat);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(1.15, 0.7, 10), _tankMat);
    cone.position.y = 1.15;
    const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.9, 6, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x11141c, roughness: 1, side: THREE.DoubleSide, wireframe: true }));
    legs.position.y = -1.2;
    tank.add(body, cone, legs);
    tank.position.set((rand() - 0.5) * w * 0.4, y + 2, (rand() - 0.5) * d * 0.4);
    group.add(tank);
  }
  // AC boxes
  const acCount = 1 + (rand() * 3) | 0;
  for (let i = 0; i < acCount; i++) {
    const ac = new THREE.Mesh(new THREE.BoxGeometry(0.9 + rand(), 0.6, 0.9 + rand()), _darkMat);
    ac.position.set((rand() - 0.5) * w * 0.6, y + 0.3, (rand() - 0.5) * d * 0.6);
    group.add(ac);
  }
  // Antenna with blinking beacon
  if (rand() < 0.5) {
    const mastH = 2.5 + rand() * 3;
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, mastH, 6), _darkMat);
    mast.position.set((rand() - 0.5) * w * 0.3, y + mastH / 2, (rand() - 0.5) * d * 0.3);
    group.add(mast);
    const beacon = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 8, 8),
      new THREE.MeshStandardMaterial({ color: 0xff2222, emissive: 0xff2222, emissiveIntensity: 2 }),
    );
    beacon.position.set(mast.position.x, y + mastH + 0.1, mast.position.z);
    beacon.userData.blink = { phase: rand() * Math.PI * 2 };
    group.add(beacon);
  }
  // Roof edge parapet glow line (subtle accent)
  if (rand() < 0.35) {
    const edge = new THREE.Mesh(
      new THREE.BoxGeometry(w + 0.2, 0.12, d + 0.2),
      new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.6 }),
    );
    edge.position.y = y + 0.06;
    group.add(edge);
  }
}

function makeSign(text, accent, baseTierH) {
  const tex = makeSignTexture(text, accent);
  const aspect = 512 / 64;
  const sh = 1.1;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
  const geo = new THREE.PlaneGeometry(sh * aspect * 0.55, sh);
  const sign = new THREE.Mesh(geo, mat);
  sign.position.set(0, Math.max(3, baseTierH - 2), 0);
  sign.userData.isSign = true; // main.js billboards or offsets it after placement
  return sign;
}

// Blink pass — call each frame with scene time.
export function tickBeacons(root, t) {
  root.traverse((o) => {
    if (o.userData?.blink) {
      const on = Math.sin(t * 2.4 + o.userData.blink.phase) > 0.4;
      o.material.emissiveIntensity = on ? 2.4 : 0.05;
    }
  });
}
