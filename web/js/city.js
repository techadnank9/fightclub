// City layout: grid of lots, one building per repo, empty lots stay free so a
// fight arena can spawn on the nearest one. Streetlights, stars, ground.

import * as THREE from 'three';
import { CITY } from './config.js';
import { makeBuilding, tickBeacons } from './buildings.js';
import { makeGroundTexture, mulberry32 } from './textures.js';

export class City {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.buildings = [];      // { group, repo, lot: {gx,gy,x,z} }
    this.freeLots = [];       // empty lots for fight arenas
    this.grid = CITY.blockSize;
    this.raycaster = new THREE.Raycaster();
    this.hovered = null;
    this.lampBits = [];   // streetlight heads + glow sprites
    this.stars = null;
  }

  // Day/night: dial window emissive, lamps, stars. Called by the theme toggle.
  setDay(isDay) {
    this.group.traverse((o) => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (m.emissiveMap) m.emissiveIntensity = isDay ? 0.12 : 0.8;
      }
    });
    for (const bit of this.lampBits) bit.visible = !isDay;
    if (this.stars) this.stars.visible = !isDay;
    // Day: match the World terrain's near-city shade (its 0x93a388 material
    // color times the ~0.5 vertex gray it bakes near the plate) so the apron
    // disappears into the grass instead of reading as a gray disc.
    if (this.apron) this.apron.material.color.setHex(isDay ? 0x4a5244 : 0x070a12);
  }

  build(repos) {
    const n = repos.length;
    const cols = Math.ceil(Math.sqrt(n * 1.3));
    const rows = Math.ceil((n * 1.3) / cols);
    const pitch = this.grid;
    const w = cols * pitch, h = rows * pitch;

    // Ground
    const groundTex = makeGroundTexture(Math.max(cols, rows));
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(Math.max(w, h), Math.max(w, h)),
      new THREE.MeshStandardMaterial({ map: groundTex, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    this.group.add(ground);

    // Dark apron skirt just past the plate; the World's terrain takes over
    // beyond it (it used to be 1.6x when the city floated in void).
    const apron = new THREE.Mesh(
      new THREE.CircleGeometry(Math.max(w, h) * 0.72, 48),
      new THREE.MeshStandardMaterial({ color: 0x070a12, roughness: 1 }),
    );
    apron.rotation.x = -Math.PI / 2;
    apron.position.y = -0.05;
    this.group.add(apron);
    this.apron = apron;

    // Shuffle lot order deterministically so big repos spread out
    const lots = [];
    for (let gy = 0; gy < rows; gy++)
      for (let gx = 0; gx < cols; gx++) lots.push({ gx, gy });
    const rand = mulberry32(42);
    for (let i = lots.length - 1; i > 0; i--) {
      const j = (rand() * (i + 1)) | 0;
      [lots[i], lots[j]] = [lots[j], lots[i]];
    }

    const ox = -w / 2 + pitch / 2, oz = -h / 2 + pitch / 2;
    repos.forEach((repo, i) => {
      const lot = lots[i];
      const x = ox + lot.gx * pitch, z = oz + lot.gy * pitch;
      const b = makeBuilding(repo);
      b.position.set(x, 0, z);
      // Face the sign toward -z street side, sitting just off the facade
      b.traverse((o) => {
        if (o.userData?.isSign) {
          const bb = new THREE.Box3().setFromObject(b.children[0]);
          o.position.z = (bb.max.z - bb.min.z) / 2 + 0.15;
        }
      });
      this.group.add(b);
      this.buildings.push({ group: b, repo, lot: { ...lot, x, z } });
    });
    for (let i = repos.length; i < lots.length; i++) {
      const lot = lots[i];
      this.freeLots.push({ ...lot, x: ox + lot.gx * pitch, z: oz + lot.gy * pitch });
    }

    this.addStreetlights(cols, rows, ox, oz, pitch);
    this.addStars();

    // Let callers (the World builder) know how far the plate reaches.
    return { half: Math.max(w, h) / 2 };
  }

  addStreetlights(cols, rows, ox, oz, pitch) {
    const poleGeo = new THREE.CylinderGeometry(0.08, 0.1, 4.6, 6);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x1c2130, roughness: 0.9 });
    const headGeo = new THREE.SphereGeometry(0.22, 8, 8);
    const headMat = new THREE.MeshStandardMaterial({ color: 0xffdf9e, emissive: 0xffc95e, emissiveIntensity: 2.2 });
    const glowTex = makeGlowSprite();
    for (let gy = 0; gy <= rows; gy++) {
      for (let gx = 0; gx <= cols; gx++) {
        if ((gx + gy) % 2 !== 0) continue;
        const x = ox + gx * pitch - pitch / 2, z = oz + gy * pitch - pitch / 2;
        const pole = new THREE.Mesh(poleGeo, poleMat);
        pole.position.set(x, 2.3, z);
        const head = new THREE.Mesh(headGeo, headMat);
        head.position.set(x, 4.7, z);
        const glow = new THREE.Sprite(new THREE.SpriteMaterial({
          map: glowTex, color: 0xffc95e, transparent: true, opacity: 0.35,
          blending: THREE.AdditiveBlending, depthWrite: false,
        }));
        glow.scale.set(6, 6, 1);
        glow.position.copy(head.position);
        this.group.add(pole, head, glow);
        this.lampBits.push(head, glow);
      }
    }
  }

  addStars() {
    const count = 700;
    const pos = new Float32Array(count * 3);
    const rand = mulberry32(9);
    for (let i = 0; i < count; i++) {
      const r = 600 + rand() * 300;
      const theta = rand() * Math.PI * 2;
      const phi = rand() * Math.PI * 0.45;
      pos[i * 3] = r * Math.cos(theta) * Math.sin(phi);
      pos[i * 3 + 1] = r * Math.cos(phi) * 0.6 + 60;
      pos[i * 3 + 2] = r * Math.sin(theta) * Math.sin(phi);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const stars = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0xbcd0ff, size: 1.4, sizeAttenuation: false, transparent: true, opacity: 0.8,
    }));
    this.group.add(stars);
    this.stars = stars;
  }

  // Nearest free lot to a building — the fight arena site.
  nearestFreeLot(building) {
    const bx = building.lot.x, bz = building.lot.z;
    let best = null, bestD = Infinity;
    for (const lot of this.freeLots) {
      const d = (lot.x - bx) ** 2 + (lot.z - bz) ** 2;
      if (d < bestD) { bestD = d; best = lot; }
    }
    return best ?? { x: bx + this.grid, z: bz, gx: -1, gy: -1 };
  }

  findByName(fullName) {
    return this.buildings.find((b) => b.repo.full_name === fullName) ?? null;
  }

  // Raycast pick. Returns building record or null.
  pick(ndc, camera) {
    this.raycaster.setFromCamera(ndc, camera);
    for (const b of this.buildings) {
      const hits = this.raycaster.intersectObject(b.group, true);
      if (hits.length) return b;
    }
    return null;
  }

  setHovered(b) {
    if (this.hovered === b) return;
    if (this.hovered) setEmissiveBoost(this.hovered.group, 1);
    this.hovered = b;
    if (b) setEmissiveBoost(b.group, 1.8);
    document.body.style.cursor = b ? 'pointer' : 'default';
  }

  tick(t) {
    tickBeacons(this.group, t);
  }
}

function setEmissiveBoost(group, v) {
  group.traverse((o) => {
    if (o.isMesh) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (m.emissiveMap) m.emissiveIntensity = 0.8 * v;
      }
    }
  });
}

function makeGlowSprite() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.25)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  return t;
}
