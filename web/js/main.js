// Entry: scene, bloom, city, picking, fight wiring. The frontend consumes
// events and animates — no fight logic lives here (see CLAUDE.md).

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { CITY } from './config.js';
import { City } from './city.js';
import { World } from './world.js';
import { SpaceLayer, playSpaceDive } from './spaceIntro.js';
import { CameraRig } from './cameraRig.js';
import { FightArena } from './fight.js';
import { Hud } from './hud.js';
import { Replay } from './replay.js';
import { Details } from './details.js';
import { History } from './history.js';
import { connectSession } from './stream.js';
import { subscribe, dispatch } from './events.js';
import { startMockFight } from './mock.js';

const app = document.querySelector('#app');

// ── Renderer / composer ────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.3;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(CITY.fogColor);
scene.fog = new THREE.Fog(CITY.fogColor, CITY.fogNear, CITY.fogFar);

const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 9000);
camera.position.set(80, 60, 80);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.42, 0.55, 0.85);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// ── Lights: cold moonlight + faint ambient ─────────────────────
const ambient = new THREE.AmbientLight(0x33406a, 0.55);
scene.add(ambient);
const moon = new THREE.DirectionalLight(0x8fa8ff, 0.5);
moon.position.set(-60, 100, -40);
scene.add(moon);
const warmFill = new THREE.DirectionalLight(0xffc98a, 0.12);
warmFill.position.set(50, 30, 60);
scene.add(warmFill);

// ── Systems ────────────────────────────────────────────────────
const city = new City(scene);
const world = new World(scene);
const space = new SpaceLayer(scene);
const rig = new CameraRig(camera, renderer.domElement);
const hud = new Hud();
const replay = new Replay();
const details = new Details();
const history = new History();
const arena = new FightArena(scene, {
  shake: (amt) => rig.shake(amt),
  onPhase: () => {},
});

// ── Day / night theme ──────────────────────────────────────────
const THEMES = {
  night: {
    bg: 0x0a0e1a, fogNear: CITY.fogNear, fogFar: CITY.fogFar,
    ambient: [0x55628f, 1.0], key: [0x9db4ff, 0.75], fill: [0xffc98a, 0.2],
    bloom: 0.42, icon: '☀',
  },
  day: {
    bg: 0xa8c4e0, fogNear: 300, fogFar: 1500,
    ambient: [0xdfe8ff, 1.05], key: [0xfff2d9, 1.7], fill: [0xbcd4ff, 0.35],
    bloom: 0.1, icon: '🌙',
  },
};
let isDay = false;

function applyTheme() {
  const t = THEMES[isDay ? 'day' : 'night'];
  scene.background.setHex(t.bg);
  scene.fog.color.setHex(t.bg);
  scene.fog.near = t.fogNear;
  scene.fog.far = t.fogFar;
  ambient.color.setHex(t.ambient[0]); ambient.intensity = t.ambient[1];
  moon.color.setHex(t.key[0]); moon.intensity = t.key[1];
  warmFill.color.setHex(t.fill[0]); warmFill.intensity = t.fill[1];
  bloom.strength = t.bloom;
  city.setDay(isDay);
  world.setDay(isDay);
  space.setDay(isDay);
  document.querySelector('#theme-toggle').textContent = t.icon;
}

document.querySelector('#theme-toggle').addEventListener('click', () => {
  isDay = !isDay;
  applyTheme();
});

// ── Load city data ─────────────────────────────────────────────
// Prefer the server's /repos (live Bright Data scrape); fall back to the seed.
const data = await fetch('/repos').then((r) => (r.ok ? r.json() : Promise.reject()))
  .catch(() => fetch('./data/repos.json').then((r) => r.json()));
const plate = city.build(data.repos);
world.build(plate.half);

// Idle ambient orbit: low and wide so the skyline reads against the horizon.
const idleOrbit = () => rig.orbitAround(new THREE.Vector3(0, 12, 0), 150, 46, 0.03);
// Space dive intro: start in orbit, plunge into the city. Drag skips it.
playSpaceDive(rig, idleOrbit);
document.querySelector('#space-dive').addEventListener('click', () => {
  if (!fightRunning) playSpaceDive(rig, idleOrbit);
});

// ── Picking ────────────────────────────────────────────────────
const ndc = new THREE.Vector2();
let selected = null;
let fightRunning = false;

renderer.domElement.addEventListener('pointermove', (e) => {
  ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  const b = city.pick(ndc, camera);
  city.setHovered(b);
  const tip = document.querySelector('#tip');
  if (b) {
    tip.style.display = 'block';
    tip.style.left = `${e.clientX + 14}px`;
    tip.style.top = `${e.clientY + 14}px`;
    tip.innerHTML = `<div class="name">${b.repo.full_name}</div>
      <div class="meta">${b.repo.language} · ★${fmt(b.repo.stars)} · ${b.repo.open_issues.length} open issues</div>`;
  } else {
    tip.style.display = 'none';
  }
});

renderer.domElement.addEventListener('click', (e) => {
  if (fightRunning) return;
  ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  const b = city.pick(ndc, camera);
  if (b) openSetup(b);
});

// ── Fight setup dialog ─────────────────────────────────────────
const setupEl = document.querySelector('#setup');
const setupBackdrop = document.querySelector('#setup-backdrop');

function closeSetup() {
  setupEl.style.display = 'none';
  setupBackdrop.style.display = 'none';
  selected = null;
  idleOrbit();
}

function openSetup(building) {
  selected = building;
  setupEl.querySelector('.repo-name').textContent = building.repo.full_name;
  const sel = setupEl.querySelector('#issue-select');
  sel.innerHTML = '';
  for (const iss of building.repo.open_issues) {
    const o = document.createElement('option');
    o.value = iss.title;
    o.textContent = `#${iss.number} ${iss.title}`;
    sel.appendChild(o);
  }
  setupEl.style.display = 'block';
  setupBackdrop.style.display = 'block';
  // Swoop toward the chosen building
  const p = building.group.position;
  rig.flyTo({
    pos: new THREE.Vector3(p.x + 36, Math.max(42, building.group.userData.height + 14), p.z + 48),
    target: new THREE.Vector3(p.x, building.group.userData.height / 2, p.z),
    dur: 1.4,
  });
}

setupEl.querySelector('#setup-cancel').addEventListener('click', closeSetup);
setupEl.querySelector('#setup-close').addEventListener('click', closeSetup);
// Clicking anywhere outside the dialog behaves exactly like CANCEL. The
// backdrop only exists while the dialog is open, so the click that opened
// it can never immediately close it.
setupBackdrop.addEventListener('click', closeSetup);
addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && setupEl.style.display === 'block') closeSetup();
});

// Verdict overlay: outside click = BACK TO CITY. It opens from a fight
// event, never from a click, so there is no open/close race.
const verdictEl = document.querySelector('#verdict');
document.addEventListener('pointerdown', (e) => {
  if (verdictEl.classList.contains('show') && !verdictEl.contains(e.target)) {
    document.querySelector('#verdict-close').click();
  }
});

setupEl.querySelector('#setup-start').addEventListener('click', () => {
  if (!selected) return;
  const custom = setupEl.querySelector('#task-text').value.trim();
  const task = custom || setupEl.querySelector('#issue-select').value;
  const a = setupEl.querySelector('#agent-a').value;
  const b = setupEl.querySelector('#agent-b').value;
  // Capture now: `selected` is mutable global state and the fallback below
  // runs later, when the user may have picked a different building.
  const repoName = selected.repo.full_name;
  setupEl.style.display = 'none';
  setupBackdrop.style.display = 'none';
  // Per the brief: ?mock=1 forces the mock feed; otherwise use the backend.
  const useMock = new URLSearchParams(location.search).get('mock') === '1';
  if (useMock) {
    startMockFight({ repo: repoName, task, a, b });
  } else {
    fetch('/fight', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repo: repoName, task, a, b }),
    }).then((r) => {
      if (!r.ok) throw new Error(`fight failed: ${r.status}`);
      return r.json();
    }).then(({ session }) => connectSession(session)).catch(async () => {
      // No backend reachable: replay the bundled recording of a real fight.
      try {
        const text = await fetch('./data/real_fight.jsonl').then((r) => r.text());
        const events = text.split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l));
        let prev = null;
        let delay = 400;
        for (const ev of events) {
          const gap = prev != null && ev.ts ? Math.min(2.6, Math.max(0.15, ev.ts - prev)) : 0;
          prev = ev.ts ?? prev;
          delay += gap * 1000;
          setTimeout(() => dispatch(ev), delay);
        }
      } catch {
        startMockFight({ repo: repoName, task, a, b });
      }
    });
  }
});

// ── Event -> scene choreography ────────────────────────────────
let arenaPos = new THREE.Vector3();

subscribe((ev) => {
  hud.handle(ev);
  switch (ev.type) {
    case 'session.opened': {
      fightRunning = true;
      const building = city.findByName(ev.repo) ?? selected;
      if (!building) break;
      selected = building;
      const lot = city.nearestFreeLot(building);
      arenaPos.set(lot.x, 0, lot.z);
      arena.open({
        arenaPos,
        repoBuilding: building,
        agents: { a: null, b: null },
      });
      // Swoop to the arena lot
      rig.flyTo({
        pos: new THREE.Vector3(arenaPos.x + 16, 18, arenaPos.z + 26),
        target: arenaPos.clone().setY(5),
        dur: 1.8,
        then: () => rig.orbitAround(arenaPos.clone().setY(7), 31, 18, 0.055),
      });
      break;
    }
    case 'fighter.started': arena.fighterStart(ev.side, ev.agent); break;
    case 'tool.called':     arena.toolCalled(ev.side, ev.tool); break;
    case 'commit.pushed':   arena.commit(ev.side); break;
    case 'tests.result':
      if (ev.by === 'referee') arena.refereeInspect(ev.side, ev.ok);
      else arena.testResult(ev.side, ev.ok);
      break;
    case 'fighter.done':    arena.fighterDone(ev.side); break;
    case 'referee.spawned': {
      arena.refereeSpawn();
      // Cut to the referee walking in
      rig.flyTo({
        pos: new THREE.Vector3(arenaPos.x, 9, arenaPos.z + 26),
        target: new THREE.Vector3(arenaPos.x, 3, arenaPos.z + 8),
        dur: 1.0,
        then: () => rig.orbitAround(arenaPos.clone().setY(4), 21, 9, 0.05),
      });
      break;
    }
    case 'referee.finding': arena.finding(ev.side, ev.severity); break;
    case 'verdict': {
      arena.verdict(ev);
      // Pull back wide
      rig.flyTo({
        pos: new THREE.Vector3(arenaPos.x + 42, 44, arenaPos.z + 56),
        target: arenaPos.clone().setY(10),
        dur: 2.0,
      });
      break;
    }
    case 'session.closed': {
      fightRunning = false;
      setTimeout(() => {
        if (!fightRunning) {
          arena.close();
          idleOrbit();
        }
      }, 4000);
      break;
    }
  }
});

// Debug handle for tests/tooling (not part of the event contract)
window.__debug = { city, camera, rig, arena, composer, renderer };

// ── Loop ───────────────────────────────────────────────────────
import { tickTweens } from './fight.js';
const clock = new THREE.Clock();

const baseFog = { near: 0, far: 0 };
function stretchFogForAltitude() {
  const t = THEMES[isDay ? 'day' : 'night'];
  const h = Math.max(0, camera.position.y);
  const k = Math.max(1, h / 160);          // 1 at street level, grows in orbit
  scene.fog.near = t.fogNear * k;
  scene.fog.far = Math.max(t.fogFar * k, h * 3.2);
}

function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, clock.getDelta());
  const t = clock.elapsedTime;
  rig.tick(dt, t);
  city.tick(t);
  arena.tick(dt);
  tickTweens(dt);
  space.tick(dt, camera.position.y);
  stretchFogForAltitude();
  composer.render();
}
loop();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});

function fmt(n) {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : `${n}`;
}
