// Fight arena: consumes harness events, renders the construction battle.
// Two sites, one tower per fighter. Floors drop with squash-and-stretch,
// tests pulse the windows, verdict = crane crown for the winner and a dusty
// collapse for the loser, then the winning floors fly onto the repo building.

import * as THREE from 'three';
import { AGENT_COLORS, TOWER } from './config.js';
import { Character } from './characters.js';
import { makeFacadeTextures } from './textures.js';

// ── tiny tween helper ──────────────────────────────────────────
const tweens = [];
export function tween({ dur, ease = easeOutCubic, onUpdate, onDone, delay = 0 }) {
  tweens.push({ t: -delay, dur, ease, onUpdate, onDone });
}
export function tickTweens(dt) {
  for (let i = tweens.length - 1; i >= 0; i--) {
    const tw = tweens[i];
    tw.t += dt;
    if (tw.t < 0) continue;
    const p = Math.min(1, tw.t / tw.dur);
    tw.onUpdate(tw.ease(p));
    if (p >= 1) {
      tweens.splice(i, 1);
      tw.onDone?.();
    }
  }
}
const easeOutCubic = (p) => 1 - (1 - p) ** 3;
const easeOutBack = (p) => 1 + 2.7 * (p - 1) ** 3 + 1.7 * (p - 1) ** 2;

export class FightArena {
  constructor(scene, callbacks = {}) {
    this.scene = scene;
    this.cb = callbacks;        // { shake(amount), onPhase(name, data) }
    this.group = null;
    this.sides = {};
    this.referee = null;
    this.repoBuilding = null;
    this.active = false;
  }

  // session.opened
  open({ arenaPos, repoBuilding, agents }) {
    this.close(true);
    this.active = true;
    this.repoBuilding = repoBuilding;
    this.group = new THREE.Group();
    this.group.position.copy(arenaPos);
    this.scene.add(this.group);
    this.agents = agents;

    // Construction floodlight so the arena reads at night
    const flood = new THREE.PointLight(0xfff0d0, 900, 70, 1.8);
    flood.position.set(0, 22, 6);
    this.group.add(flood);

    // Two construction pads
    const padGeo = new THREE.BoxGeometry(TOWER.baseWidth + 2, 0.3, TOWER.baseWidth + 2);
    for (const [side, dx] of [['a', -7.5], ['b', 7.5]]) {
      const color = AGENT_COLORS[agents?.[side]] ?? 0x888888;
      const pad = new THREE.Mesh(padGeo, new THREE.MeshStandardMaterial({
        color: 0x151a28, roughness: 1,
      }));
      pad.position.set(dx, 0.15, 0);
      const rim = new THREE.Mesh(
        new THREE.BoxGeometry(TOWER.baseWidth + 2.4, 0.12, TOWER.baseWidth + 2.4),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.8 }),
      );
      rim.position.set(dx, 0.06, 0);
      this.group.add(pad, rim);
      this.sides[side] = {
        x: dx, color, floors: [], char: null, rim,
        toolSprite: null, done: false,
      };
    }
  }

  // fighter.started — character walks in from the street edge
  fighterStart(side, agent) {
    const s = this.sides[side];
    if (!s) return;
    s.agent = agent;
    const color = AGENT_COLORS[agent] ?? s.color;
    s.color = color;
    s.rim.material.color.setHex(color);
    s.rim.material.emissive.setHex(color);
    const ch = new Character({ color });
    ch.group.position.set(s.x * 2.2, 0, 18);
    this.group.add(ch.group);
    s.char = ch;
    ch.walkTo(new THREE.Vector3(s.x + (side === 'a' ? 3.4 : -3.4), 0, 4.2), () => {
      ch.setState('work');
      ch.group.lookAt(this.group.position.x + s.x, 1, this.group.position.z);
    });
  }

  // tool.called — floating text above the fighter
  toolCalled(side, tool) {
    const s = this.sides[side];
    if (!s?.char) return;
    const g = this.group;
    if (!g) return;
    if (s.toolSprite) { g.remove(s.toolSprite); s.toolSprite.material.map.dispose(); }
    const sprite = makeTextSprite(tool, s.color);
    sprite.position.copy(s.char.group.position).add(new THREE.Vector3(0, 5.2, 0));
    g.add(sprite);
    s.toolSprite = sprite;
    tween({ dur: 2.2, onUpdate: (p) => { sprite.material.opacity = 1 - p; },
      onDone: () => { g.remove(sprite); if (s.toolSprite === sprite) s.toolSprite = null; } });
  }

  // commit.pushed — drop a floor with squash-and-stretch
  commit(side) {
    const s = this.sides[side];
    if (!s || !this.group) return;
    const g = this.group;
    const idx = s.floors.length;
    if (idx >= TOWER.maxFloors) return;
    const h = TOWER.floorHeight;
    const w = TOWER.baseWidth * (1 - idx * 0.03);
    const { map, emissiveMap } = makeFacadeTextures({
      cols: 5, rows: 1, litRatio: 0.7, seed: 1000 + idx * 7 + (side === 'a' ? 0 : 500),
    });
    const mat = new THREE.MeshStandardMaterial({
      map, emissiveMap, emissive: 0xffffff, emissiveIntensity: 0.85, roughness: 0.8,
    });
    const roof = new THREE.MeshStandardMaterial({ color: 0x454b60, roughness: 0.95 });
    const floor = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), [mat, mat, roof, roof, mat, mat]);
    const targetY = 0.3 + idx * h + h / 2;
    floor.position.set(s.x, targetY + 14, 0);
    g.add(floor);
    s.floors.push(floor);

    // Drop + squash/stretch: stretch tall while falling, squash on land, settle
    tween({
      dur: 0.45,
      ease: (p) => p * p,
      onUpdate: (p) => {
        floor.position.y = targetY + 14 * (1 - p);
        floor.scale.set(1 - 0.12 * p, 1 + 0.35 * p, 1 - 0.12 * p);
      },
      onDone: () => {
        this.cb.shake?.(0.25);
        this.dust(s.x, 0.4, 0, s.color, 10);
        tween({
          dur: 0.4, ease: easeOutBack,
          onUpdate: (p) => {
            const sq = 1 - p;
            floor.scale.set(1 + 0.22 * sq, 1 - 0.3 * sq, 1 + 0.22 * sq);
          },
          onDone: () => floor.scale.set(1, 1, 1),
        });
      },
    });
  }

  // tests.result — pulse the tower windows green/red
  testResult(side, ok) {
    const s = this.sides[side];
    if (!s) return;
    const col = ok ? 0x6fe3a1 : 0xff6b81;
    for (const f of s.floors) {
      const mats = Array.isArray(f.material) ? f.material : [f.material];
      for (const m of mats) {
        if (!m.emissiveMap) continue;
        if (m.userData.origEmissive === undefined) m.userData.origEmissive = 0xffffff;
        m.emissive.setHex(col);
        tween({ dur: 0.9, onUpdate: () => {}, onDone: () => m.emissive.setHex(m.userData.origEmissive) });
      }
    }
    if (!ok) this.cb.shake?.(0.15);
  }

  fighterDone(side) {
    const s = this.sides[side];
    s?.char?.setState('idle');
    if (s) s.done = true;
  }

  // referee.spawned — walks in between the towers
  refereeSpawn() {
    const ref = new Character({ color: AGENT_COLORS.referee, referee: true });
    ref.group.position.set(0, 0, 24);
    this.group.add(ref.group);
    this.referee = ref;
    ref.walkTo(new THREE.Vector3(0, 0, 6), () => ref.setState('idle'));
  }

  // referee.finding — flash the offending side
  finding(side, severity) {
    const s = this.sides[side];
    if (!s) return;
    this.testResult(side, false);
    this.dust(s.x, 1, 0, 0xff6b81, severity === 'high' ? 22 : 10);
  }

  // verdict — crown the winner, collapse the loser
  verdict({ winner }) {
    const loser = winner === 'a' ? 'b' : 'a';
    const w = this.sides[winner], l = this.sides[loser];
    w?.char?.setState('cheer');
    l?.char?.setState('defeat');
    this.referee?.setState('cheer');

    if (l) this.collapse(l);
    if (w) this.crown(w, () => this.mergeFly(w));
  }

  collapse(s) {
    const g = this.group;
    if (!g) return;
    s.floors.forEach((f, i) => {
      tween({
        delay: 0.15 * (s.floors.length - i), dur: 0.5, ease: (p) => p * p,
        onUpdate: (p) => {
          f.position.y = Math.max(0.4, f.position.y - p * 2.2);
          f.rotation.z += (i % 2 ? 1 : -1) * 0.02;
          f.scale.y = Math.max(0.08, 1 - p);
        },
        onDone: () => {
          this.dust(s.x, 0.6, 0, 0x9aa3b5, 16);
          this.cb.shake?.(0.5);
          tween({ dur: 0.8, onUpdate: (p) => {
            const mats = Array.isArray(f.material) ? f.material : [f.material];
            mats.forEach((m) => { m.transparent = true; m.opacity = 1 - p; });
          }, onDone: () => { g.remove(f); } });
        },
      });
    });
    s.floors = [];
  }

  crown(s, then) {
    const g = this.group;
    if (!g) return;
    const topY = 0.3 + s.floors.length * TOWER.floorHeight;
    // Beam cable
    const cable = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.04, 30, 6),
      new THREE.MeshBasicMaterial({ color: 0x444c66 }),
    );
    cable.position.set(s.x, topY + 30, 0);
    g.add(cable);
    // Crown: glowing star topper
    const crown = new THREE.Mesh(
      new THREE.OctahedronGeometry(1.1),
      new THREE.MeshStandardMaterial({ color: s.color, emissive: s.color, emissiveIntensity: 2.4 }),
    );
    crown.position.set(s.x, topY + 26, 0);
    g.add(crown);
    tween({
      dur: 1.6, ease: easeOutCubic,
      onUpdate: (p) => {
        crown.position.y = topY + 26 - p * 25;
        cable.position.y = crown.position.y + 15.05;
        crown.rotation.y += 0.05;
      },
      onDone: () => {
        g.remove(cable);
        this.dust(s.x, topY + 1, 0, s.color, 18);
        s.crownMesh = crown;
        tween({ dur: 0.8, onUpdate: () => {}, onDone: then });
      },
    });
  }

  // Winning floors fly onto the repo building
  mergeFly(s) {
    if (!this.repoBuilding || !this.group) return;
    const g = this.group;   // capture: close() may null this.group mid-tween
    const target = new THREE.Vector3();
    this.repoBuilding.group.getWorldPosition(target);
    target.y = this.repoBuilding.group.userData.height ?? 10;
    const world = new THREE.Vector3();
    const flyers = [...s.floors];
    if (s.crownMesh) flyers.push(s.crownMesh);
    flyers.forEach((f, i) => {
      f.getWorldPosition(world);
      const from = world.clone();
      const local = g.worldToLocal(target.clone());
      const fromLocal = g.worldToLocal(from.clone());
      tween({
        delay: 0.12 * i, dur: 1.1, ease: easeOutCubic,
        onUpdate: (p) => {
          const arc = Math.sin(p * Math.PI) * 8;
          f.position.lerpVectors(fromLocal, local, p);
          f.position.y += arc * (1 - p) * 0.3 + arc * 0.1;
          f.scale.setScalar(Math.max(0.05, 1 - p * 0.95));
          f.rotation.y += 0.08;
        },
        onDone: () => {
          g.remove(f);
          if (i === flyers.length - 1) {
            this.cb.shake?.(0.3);
            this.cb.onPhase?.('merged');
          }
        },
      });
    });
    s.floors = [];
  }

  // simple dust burst
  dust(x, y, z, color, n = 12) {
    if (!this.group) return;
    const g = this.group;   // capture for the cleanup closure
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3);
    const vel = [];
    for (let i = 0; i < n; i++) {
      pos[i * 3] = x + (Math.random() - 0.5) * 2;
      pos[i * 3 + 1] = y + Math.random() * 0.5;
      pos[i * 3 + 2] = z + (Math.random() - 0.5) * 2;
      vel.push(new THREE.Vector3(
        (Math.random() - 0.5) * 4, 2 + Math.random() * 3, (Math.random() - 0.5) * 4,
      ));
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color, size: 0.35, transparent: true, opacity: 0.9, depthWrite: false,
    });
    const pts = new THREE.Points(geo, mat);
    g.add(pts);
    tween({
      dur: 1.1,
      onUpdate: (p) => {
        const arr = geo.attributes.position.array;
        for (let i = 0; i < n; i++) {
          arr[i * 3] += vel[i].x * 0.016;
          arr[i * 3 + 1] += vel[i].y * 0.016;
          arr[i * 3 + 2] += vel[i].z * 0.016;
          vel[i].y -= 0.12;
        }
        geo.attributes.position.needsUpdate = true;
        mat.opacity = 0.9 * (1 - p);
      },
      onDone: () => { g.remove(pts); geo.dispose(); mat.dispose(); },
    });
  }

  close(instant = false) {
    if (!this.group) return;
    const g = this.group;
    this.group = null;
    this.sides = {};
    this.referee = null;
    this.active = false;
    if (instant) { this.scene.remove(g); return; }
    tween({
      dur: 1.2, onUpdate: (p) => { g.position.y = -p * 6; },
      onDone: () => this.scene.remove(g),
    });
  }

  tick(dt) {
    for (const side of Object.values(this.sides)) side.char?.tick(dt);
    this.referee?.tick(dt);
  }
}

function makeTextSprite(text, colorHex) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 48;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(10,14,26,0.85)';
  roundRect(ctx, 0, 0, 256, 48, 10);
  ctx.fill();
  ctx.font = '20px "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#' + colorHex.toString(16).padStart(6, '0');
  ctx.fillText(text.slice(0, 22), 128, 25);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthWrite: false,
  }));
  sprite.scale.set(6.4, 1.2, 1);
  return sprite;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
