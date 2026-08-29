// Space dive: the globe feel without a globe engine. A huge planet disc +
// atmosphere rim + drifting clouds sell "seen from orbit"; the camera starts
// up there and dives into the city. Any user drag cancels (rig handles it).

import * as THREE from 'three';

export class SpaceLayer {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);

    // Planet disc: far below the terrain, big enough to read as a world
    const discGeo = new THREE.CircleGeometry(7000, 96);
    this.discMat = new THREE.MeshBasicMaterial({ color: 0x0a111e, fog: false });
    const disc = new THREE.Mesh(discGeo, this.discMat);
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = -40;
    disc.renderOrder = -3;
    this.group.add(disc);

    // Soft radial shading on the disc: darker toward the rim (fake curvature)
    const shade = new THREE.Mesh(discGeo.clone(), new THREE.MeshBasicMaterial({
      map: radialShadeTexture(), transparent: true, fog: false, depthWrite: false,
    }));
    shade.rotation.x = -Math.PI / 2;
    shade.position.y = -39;
    shade.renderOrder = -2;
    this.group.add(shade);

    // Atmosphere rim: additive ring floating at the disc edge
    const rim = new THREE.Mesh(
      new THREE.RingGeometry(6400, 7350, 96),
      new THREE.MeshBasicMaterial({
        map: rimGlowTexture(), transparent: true, blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide, fog: false, depthWrite: false,
      }),
    );
    rim.rotation.x = -Math.PI / 2;
    rim.position.y = -20;
    rim.renderOrder = -1;
    this.group.add(rim);
    this.rim = rim;

    // Cloud sprites drifting between space and ground
    this.clouds = [];
    const cloudTex = cloudTexture();
    for (let i = 0; i < 14; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: cloudTex, transparent: true, opacity: 0.32,
        depthWrite: false, fog: false,
      }));
      const r = 250 + Math.random() * 1400;
      const th = Math.random() * Math.PI * 2;
      sp.position.set(Math.cos(th) * r, 320 + Math.random() * 480, Math.sin(th) * r);
      const s = 380 + Math.random() * 520;
      sp.scale.set(s, s * 0.38, 1);
      sp.userData.drift = (Math.random() - 0.5) * 4;
      this.clouds.push(sp);
      this.group.add(sp);
    }
  }

  setDay(isDay) {
    this.discMat.color.setHex(isDay ? 0x6d8a74 : 0x0a111e);
    for (const c of this.clouds) c.material.opacity = isDay ? 0.5 : 0.32;
  }

  tick(dt, cameraY = 1000) {
    for (const c of this.clouds) c.position.x += c.userData.drift * dt;
    // The rim reads as a hard line from street level: fade it in with altitude
    this.rim.material.opacity = Math.min(1, Math.max(0, (cameraY - 180) / 500));
  }
}

// Camera choreography: orbit altitude -> swoop -> hand off to idle orbit.
export function playSpaceDive(rig, onDone) {
  rig.controls.enabled = true;
  rig.camera.position.set(-400, 2400, 1400);
  rig.controls.target.set(0, 0, 0);
  rig.flyTo({
    pos: new THREE.Vector3(120, 620, 420),
    target: new THREE.Vector3(0, 10, 0),
    dur: 4.2,
    then: () => rig.flyTo({
      pos: new THREE.Vector3(150, 46, 150),
      target: new THREE.Vector3(0, 6, 0),
      dur: 2.6,
      then: onDone,
    }),
  });
}

function radialShadeTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(256, 256, 120, 256, 256, 256);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(0.78, 'rgba(0,0,0,0.25)');
  g.addColorStop(1, 'rgba(0,0,0,0.85)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 512);
  const t = new THREE.CanvasTexture(c);
  return t;
}

function rimGlowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(256, 256, 218, 256, 256, 256);
  g.addColorStop(0, 'rgba(90,170,255,0)');
  g.addColorStop(0.5, 'rgba(110,190,255,0.55)');
  g.addColorStop(0.8, 'rgba(140,205,255,0.25)');
  g.addColorStop(1, 'rgba(160,215,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 512);
  return new THREE.CanvasTexture(c);
}

function cloudTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const ctx = c.getContext('2d');
  for (let i = 0; i < 26; i++) {
    const x = 30 + Math.random() * 196, y = 40 + Math.random() * 48;
    const r = 14 + Math.random() * 30;
    const g = ctx.createRadialGradient(x, y, 1, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 128);
  }
  return new THREE.CanvasTexture(c);
}
