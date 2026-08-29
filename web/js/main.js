// Entry: scene, bloom, city, picking, fight wiring. The frontend consumes
// events and animates — no fight logic lives here (see CLAUDE.md).

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { CITY } from './config.js';
import { City } from './city.js';
import { CameraRig } from './cameraRig.js';
import { FightArena } from './fight.js';
import { Hud } from './hud.js';
import { Replay } from './replay.js';
import { subscribe, dispatch } from './events.js';
import { startMockFight } from './mock.js';

const app = document.querySelector('#app');

// ── Renderer / composer ────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.setSize(innerWidth, innerHeight);
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(CITY.fogColor);
scene.fog = new THREE.Fog(CITY.fogColor, CITY.fogNear, CITY.fogFar);

const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 1200);
camera.position.set(80, 60, 80);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.55, 0.6, 0.82);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// ── Lights: cold moonlight + faint ambient ─────────────────────
scene.add(new THREE.AmbientLight(0x33406a, 0.55));
const moon = new THREE.DirectionalLight(0x8fa8ff, 0.5);
moon.position.set(-60, 100, -40);
scene.add(moon);
const warmFill = new THREE.DirectionalLight(0xffc98a, 0.12);
warmFill.position.set(50, 30, 60);
scene.add(warmFill);

// ── Systems ────────────────────────────────────────────────────
const city = new City(scene);
const rig = new CameraRig(camera, renderer.domElement);
const hud = new Hud();
const replay = new Replay();
const arena = new FightArena(scene, {
  shake: (amt) => rig.shake(amt),
  onPhase: () => {},
});

// ── Load city data ─────────────────────────────────────────────
const data = await fetch('./data/repos.json').then((r) => r.json());
city.build(data.repos);

// Idle ambient orbit over the city
rig.orbitAround(new THREE.Vector3(0, 6, 0), 120, 70, 0.03);

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

renderer.domElement.addEventListener('click', () => {
  if (fightRunning) return;
  const b = city.pick(ndc, camera);
  if (b) openSetup(b);
});

// ── Fight setup dialog ─────────────────────────────────────────
const setupEl = document.querySelector('#setup');

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
  // Swoop toward the chosen building
  const p = building.group.position;
  rig.flyTo({
    pos: new THREE.Vector3(p.x + 28, 24, p.z + 34),
    target: new THREE.Vector3(p.x, building.group.userData.height / 2, p.z),
    dur: 1.4,
  });
}

setupEl.querySelector('#setup-cancel').addEventListener('click', () => {
  setupEl.style.display = 'none';
  selected = null;
  rig.orbitAround(new THREE.Vector3(0, 6, 0), 120, 70, 0.03);
});

setupEl.querySelector('#setup-start').addEventListener('click', () => {
  if (!selected) return;
  const custom = setupEl.querySelector('#task-text').value.trim();
  const task = custom || setupEl.querySelector('#issue-select').value;
  const a = setupEl.querySelector('#agent-a').value;
  const b = setupEl.querySelector('#agent-b').value;
  setupEl.style.display = 'none';
  const useMock = new URLSearchParams(location.search).get('mock') !== '0';
  if (useMock) {
    startMockFight({ repo: selected.repo.full_name, task, a, b });
  } else {
    fetch('/fight', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repo: selected.repo.full_name, task, a, b }),
    }).then((r) => r.json()).then(({ session }) => {
      const es = new EventSource(`/events?session=${session}`);
      es.onmessage = (m) => {
        const ev = JSON.parse(m.data);
        dispatch(ev);
        if (ev.type === 'session.closed') es.close();
      };
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
        pos: new THREE.Vector3(arenaPos.x + 20, 15, arenaPos.z + 30),
        target: arenaPos.clone().setY(4),
        dur: 1.8,
        then: () => rig.orbitAround(arenaPos.clone().setY(5), 32, 15, 0.06),
      });
      break;
    }
    case 'fighter.started': arena.fighterStart(ev.side, ev.agent); break;
    case 'tool.called':     arena.toolCalled(ev.side, ev.tool); break;
    case 'commit.pushed':   arena.commit(ev.side); break;
    case 'tests.result':    arena.testResult(ev.side, ev.ok); break;
    case 'fighter.done':    arena.fighterDone(ev.side); break;
    case 'referee.spawned': {
      arena.refereeSpawn();
      // Cut to the referee walking in
      rig.flyTo({
        pos: new THREE.Vector3(arenaPos.x, 6, arenaPos.z + 26),
        target: new THREE.Vector3(arenaPos.x, 2, arenaPos.z + 8),
        dur: 1.0,
        then: () => rig.orbitAround(arenaPos.clone().setY(4), 26, 10, 0.05),
      });
      break;
    }
    case 'referee.finding': arena.finding(ev.side, ev.severity); break;
    case 'verdict': {
      arena.verdict(ev);
      // Pull back wide
      rig.flyTo({
        pos: new THREE.Vector3(arenaPos.x + 34, 30, arenaPos.z + 44),
        target: arenaPos.clone().setY(8),
        dur: 2.0,
      });
      break;
    }
    case 'session.closed': {
      fightRunning = false;
      setTimeout(() => {
        if (!fightRunning) {
          arena.close();
          rig.orbitAround(new THREE.Vector3(0, 6, 0), 120, 70, 0.03);
        }
      }, 4000);
      break;
    }
  }
});

// ── Loop ───────────────────────────────────────────────────────
import { tickTweens } from './fight.js';
const clock = new THREE.Clock();

function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, clock.getDelta());
  const t = clock.elapsedTime;
  rig.tick(dt, t);
  city.tick(t);
  arena.tick(dt);
  tickTweens(dt);
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
