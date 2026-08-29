// The world beyond the city: rolling terrain out to the horizon, a gradient
// sky dome, instanced outskirt buildings, trees, and roads running off into
// the distance. Concept borrowed from coincide's map page (the focus point
// sits inside a whole world; detail "hushes" with distance); implementation
// is entirely ours — coincide is MapLibre, not Three.js, and carries no
// license, so nothing was copied verbatim.
//
// Perf rules: everything repeated is an InstancedMesh, geometry is built
// once, and there is no per-frame work (no tick method needed).

import * as THREE from 'three';
import { makeFacadeTextures, mulberry32 } from './textures.js';

const WORLD_R = 900;   // terrain half-extent
const SKY_R = 1000;    // sky dome radius (camera.far must exceed this + zoom)

export class World {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
  }

  // cityHalf: half-extent of the city's ground plate. Everything the world
  // adds stays clear of the square [-cityHalf, cityHalf]^2.
  build(cityHalf) {
    this.cityHalf = cityHalf;
    this.heightAt = makeHeightField(cityHalf);
    this.addTerrain();
    this.addSky();
    this.addRoads();
    this.addOutskirts();
    this.addTrees();
    this.setDay(false);
  }

  // ── Day / night ──────────────────────────────────────────────
  // Called by main.js applyTheme alongside city.setDay.
  setDay(isDay) {
    this.sky.material.map = isDay ? this.skyDayTex : this.skyNightTex;
    // Vertex colors hold the horizon gradient (grayscale); the material
    // color tints them per theme, so no re-bake on toggle.
    this.terrain.material.color.setHex(isDay ? 0x93a388 : 0x18203a);
    this.outskirts.material.emissiveIntensity = isDay ? 0.06 : 0.5;
    this.foliage.material.color.setHex(isDay ? 0x357040 : 0x18301f);
    this.trunks.material.color.setHex(isDay ? 0x5a4632 : 0x241c12);
  }

  // ── Terrain: one big displaced plane with a baked gradient ───
  addTerrain() {
    const seg = 110;
    const geo = new THREE.PlaneGeometry(WORLD_R * 2, WORLD_R * 2, seg, seg);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      // Plane is in XY; mesh gets rotation.x = -PI/2, mapping local
      // (x, y) -> world (x, -y) and local +z -> world +y.
      const wx = pos.getX(i), wz = -pos.getY(i);
      pos.setZ(i, this.heightAt(wx, wz));
      const d = Math.hypot(wx, wz);
      // Grayscale gradient: brighter toward the horizon so the far ground
      // lifts into the sky glow instead of reading as void.
      const t = smoothstep(this.cityHalf, WORLD_R * 0.85, d);
      const v = 0.5 + t * 0.5;
      colors[i * 3] = v; colors[i * 3 + 1] = v; colors[i * 3 + 2] = v;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
    const terrain = new THREE.Mesh(geo, mat);
    terrain.rotation.x = -Math.PI / 2;
    terrain.position.y = -0.12; // just under the city plate / apron
    this.group.add(terrain);
    this.terrain = terrain;
  }

  // ── Sky dome: vertical gradient, horizon glow band ───────────
  addSky() {
    this.skyNightTex = makeSkyTexture([
      [0.0, '#04060d'],  // zenith
      [0.45, '#0a0e1a'],
      [0.72, '#141d36'],
      [0.80, '#27395f'], // horizon glow band
      [0.84, '#101728'],
      [1.0, '#0a0e1a'],  // below horizon: fog color
    ]);
    this.skyDayTex = makeSkyTexture([
      [0.0, '#5c9ad6'],
      [0.5, '#8ebbe4'],
      [0.78, '#dbe9f4'], // pale horizon
      [0.85, '#b6cfe4'],
      [1.0, '#a8c4e0'],  // below horizon: fog color
    ]);
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(SKY_R, 32, 18),
      new THREE.MeshBasicMaterial({
        map: this.skyNightTex, side: THREE.BackSide, fog: false, depthWrite: false,
      }),
    );
    sky.renderOrder = -1;
    this.group.add(sky);
    this.sky = sky;
  }

  // ── Roads: four strips running from the city out to the horizon ──
  addRoads() {
    const tex = makeRoadTexture();
    const len = WORLD_R * 0.92 - this.cityHalf;
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 1 });
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1, len / 24);
    const geo = new THREE.PlaneGeometry(7, len);
    for (let i = 0; i < 4; i++) {
      const road = new THREE.Mesh(geo, mat);
      road.rotation.x = -Math.PI / 2;
      road.rotation.z = (i * Math.PI) / 2;
      const mid = this.cityHalf + len / 2;
      const dir = [[0, -1], [1, 0], [0, 1], [-1, 0]][i];
      road.position.set(dir[0] * mid, 0.04, dir[1] * mid);
      this.group.add(road);
    }
  }

  // ── Outskirts: clustered settlements, one InstancedMesh ──────
  // Suburbs, not confetti: small blocks hugging the city plate and strung
  // along the road corridors, with clear empty ground between clusters.
  addOutskirts() {
    const capacity = 460;
    // Plaster-toned facade like the city's own painted buildings
    // (buildings.js lerps language color toward 0x8f94a8), so by day these
    // read as light walls, not black debris; windows still glow at night.
    const { map, emissiveMap } = makeFacadeTextures({
      cols: 6, rows: 9, litRatio: 0.16, faceColor: '#8f94a8', seed: 77,
    });
    const mat = new THREE.MeshStandardMaterial({
      map, emissiveMap, emissive: 0xffffff, emissiveIntensity: 0.5, roughness: 0.9,
    });
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0); // origin at base
    const mesh = new THREE.InstancedMesh(geo, mat, capacity);
    const dummy = new THREE.Object3D();
    const col = new THREE.Color();
    const rand = mulberry32(1234);
    const inner = this.cityHalf + 16;

    // Cluster centers: a broken ring around the plate...
    const centers = [];
    const ringN = 10;
    for (let i = 0; i < ringN; i++) {
      const a = (i / ringN) * Math.PI * 2 + rand() * 0.45;
      const r = inner + 36 + rand() * 55;
      centers.push({
        x: Math.cos(a) * r, z: Math.sin(a) * r,
        rad: 22 + rand() * 12, n: 24, yaw: rand() * Math.PI,
      });
    }
    // ...and settlements to one side of each road, marching outward.
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      for (const d of [70, 165, 285, 410]) {
        const side = rand() < 0.5 ? 1 : -1;
        const off = 18 + rand() * 20;
        centers.push({
          x: dx * (inner + d) - dz * side * off,
          z: dz * (inner + d) + dx * side * off,
          rad: 15 + rand() * 10, n: 13, yaw: rand() * Math.PI,
        });
      }
    }

    let placed = 0;
    for (const c of centers) {
      for (let k = 0; k < c.n && placed < capacity; k++) {
        const a = rand() * Math.PI * 2;
        const r = Math.sqrt(rand()) * c.rad;
        const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
        // Keep the road corridors and the city plate clear.
        if (Math.min(Math.abs(x), Math.abs(z)) < 11) continue;
        if (Math.max(Math.abs(x), Math.abs(z)) < inner) continue;
        const t = smoothstep(inner, inner + 420, Math.hypot(x, z));
        const h = (11 - t * 7) * (0.5 + rand() * 0.9);
        const w = 3.5 + rand() * 4.5, dpt = 3.5 + rand() * 4.5;
        // Sit on the terrain: sample the SAME height field the terrain mesh
        // uses at all four footprint corners and take the lowest, so a box
        // on a slope sinks into the hill instead of floating off it.
        // (-0.12 matches the terrain mesh's own y offset.)
        const hw = w / 2, hd = dpt / 2;
        const ground = Math.min(
          this.heightAt(x - hw, z - hd), this.heightAt(x + hw, z - hd),
          this.heightAt(x - hw, z + hd), this.heightAt(x + hw, z + hd),
        ) - 0.12;
        dummy.position.set(x, ground - 0.1, z);
        // Blocks in one cluster share a street grid (base yaw ± 90°).
        dummy.rotation.set(0, c.yaw + (rand() < 0.5 ? 0 : Math.PI / 2) + (rand() - 0.5) * 0.12, 0);
        dummy.scale.set(w, h, dpt);
        dummy.updateMatrix();
        mesh.setMatrixAt(placed, dummy.matrix);
        // Pastel tints over the plaster facade, gently receding with distance.
        col.setHSL(rand(), 0.12, 0.72 - t * 0.16);
        mesh.setColorAt(placed, col);
        placed++;
      }
    }
    mesh.count = placed;
    this.group.add(mesh);
    this.outskirts = mesh;
  }

  // ── Trees: two InstancedMeshes (trunks + cones) ──────────────
  addTrees() {
    const count = 260;
    const trunks = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.14, 0.24, 1.4, 5),
      new THREE.MeshStandardMaterial({ color: 0x241c12, roughness: 1 }),
      count,
    );
    const foliage = new THREE.InstancedMesh(
      new THREE.ConeGeometry(1.15, 2.8, 6),
      new THREE.MeshStandardMaterial({ color: 0x18301f, roughness: 1 }),
      count,
    );
    const dummy = new THREE.Object3D();
    const rand = mulberry32(555);
    const inner = this.cityHalf + 12;
    let placed = 0, guard = 0;
    while (placed < count && guard++ < count * 30) {
      const r = inner + rand() * 440;
      const a = rand() * Math.PI * 2;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (Math.min(Math.abs(x), Math.abs(z)) < 10) continue;
      if (Math.max(Math.abs(x), Math.abs(z)) < inner) continue;
      const s = 0.7 + rand() * 1.1;
      // Same height field as the terrain mesh (-0.12 mesh offset), sunk a
      // little so trunks on a slope never float.
      const y = this.heightAt(x, z) - 0.12 - 0.35 * s;
      dummy.position.set(x, y + 0.7 * s, z);
      dummy.scale.setScalar(s);
      dummy.rotation.set(0, rand() * Math.PI, 0);
      dummy.updateMatrix();
      trunks.setMatrixAt(placed, dummy.matrix);
      dummy.position.y = y + (1.4 + 1.4) * s * 0.8;
      dummy.updateMatrix();
      foliage.setMatrixAt(placed, dummy.matrix);
      placed++;
    }
    trunks.count = foliage.count = placed;
    this.group.add(trunks, foliage);
    this.trunks = trunks;
    this.foliage = foliage;
  }
}

// Gently rolling height field: dead flat under the city and along the four
// road corridors, ramping up to soft hills farther out.
function makeHeightField(cityHalf) {
  const r1 = cityHalf + 26;   // flat until here
  const r2 = cityHalf + 130;  // full amplitude from here
  return (x, z) => {
    const d = Math.hypot(x, z);
    let ramp = smoothstep(r1, r2, d);
    ramp *= smoothstep(9, 30, Math.min(Math.abs(x), Math.abs(z)));
    const n =
      Math.sin(x * 0.012 + 1.7) * Math.cos(z * 0.014 + 4.2) * 5 +
      Math.sin(x * 0.031 + 2.9) * Math.sin(z * 0.026 + 0.8) * 2 +
      Math.sin((x + z) * 0.006 + 5.1) * 6;
    return ramp * (n * 0.9 + 4);
  };
}

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// Vertical gradient canvas for the sky dome. Stops: [v, color] with v=0 at
// the zenith and v=1 at the dome's bottom.
function makeSkyTexture(stops) {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 512;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, c.height);
  for (const [v, col] of stops) g.addColorStop(v, col);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, c.width, c.height);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Asphalt strip with a dashed center line, tiled along the road.
function makeRoadTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#181c26';
  ctx.fillRect(0, 0, c.width, c.height);
  const rand = mulberry32(31);
  for (let i = 0; i < 300; i++) {
    ctx.fillStyle = rand() > 0.5 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.06)';
    ctx.fillRect(rand() * c.width, rand() * c.height, 2, 2);
  }
  // Edge lines
  ctx.fillStyle = 'rgba(200,205,220,0.25)';
  ctx.fillRect(3, 0, 2, c.height);
  ctx.fillRect(c.width - 5, 0, 2, c.height);
  // Center dashes
  ctx.fillStyle = 'rgba(240,220,130,0.55)';
  for (let y = 0; y < c.height; y += 48) ctx.fillRect(c.width / 2 - 2, y, 4, 26);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
