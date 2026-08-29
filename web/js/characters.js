// Procedural voxel workers. Boxy but expressive: idle sway, walk cycle,
// hammer swing, cheer jump. Fighter tinted by agent color; referee gets a
// hard hat + badge. Swappable later for rigged GLBs behind the same API.

import * as THREE from 'three';

const SKIN = 0xe8c39e;

export class Character {
  constructor({ color = 0xffb347, referee = false }) {
    this.group = new THREE.Group();
    this.state = 'idle';        // idle | walk | work | cheer
    this.t = Math.random() * 10;
    this.walkTarget = null;
    this.walkSpeed = 5.5;
    this.onArrive = null;

    const body = new THREE.MeshStandardMaterial({ color, roughness: 0.8, emissive: color, emissiveIntensity: 0.35 });
    const skin = new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.9, emissive: SKIN, emissiveIntensity: 0.18 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1a1e2c, roughness: 0.9 });

    // Torso
    this.torso = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.8, 0.4), body);
    this.torso.position.y = 1.15;
    // Head
    this.head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), skin);
    this.head.position.y = 1.85;
    // Eyes
    const eyeGeo = new THREE.BoxGeometry(0.07, 0.1, 0.02);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
    const eyeL = new THREE.Mesh(eyeGeo, eyeMat); eyeL.position.set(-0.12, 0.02, 0.26);
    const eyeR = new THREE.Mesh(eyeGeo, eyeMat); eyeR.position.set(0.12, 0.02, 0.26);
    this.head.add(eyeL, eyeR);

    // Arms (pivot at shoulder)
    this.armL = pivotLimb(0.18, 0.65, body); this.armL.position.set(-0.44, 1.5, 0);
    this.armR = pivotLimb(0.18, 0.65, body); this.armR.position.set(0.44, 1.5, 0);
    // Legs (pivot at hip)
    this.legL = pivotLimb(0.22, 0.75, dark); this.legL.position.set(-0.18, 0.75, 0);
    this.legR = pivotLimb(0.22, 0.75, dark); this.legR.position.set(0.18, 0.75, 0);

    this.group.add(this.torso, this.head, this.armL, this.armR, this.legL, this.legR);

    // Hammer in right hand
    this.hammer = new THREE.Group();
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.55, 6),
      new THREE.MeshStandardMaterial({ color: 0x8a6b45, roughness: 0.9 }));
    const headM = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.14, 0.14),
      new THREE.MeshStandardMaterial({ color: 0x9aa3b5, roughness: 0.5, metalness: 0.6 }));
    headM.position.y = 0.3;
    this.hammer.add(handle, headM);
    this.hammer.position.y = -0.6;
    this.hammer.visible = false;
    this.armR.add(this.hammer);

    if (referee) {
      const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.36, 0.18, 10),
        new THREE.MeshStandardMaterial({ color: 0xffd23e, roughness: 0.5 }));
      hat.position.y = 0.3;
      const brim = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.05, 0.5),
        new THREE.MeshStandardMaterial({ color: 0xffd23e, roughness: 0.5 }));
      brim.position.set(0, 0.2, 0.1);
      this.head.add(hat, brim);
      // Qodo badge on chest
      const badge = new THREE.Mesh(new THREE.CircleGeometry(0.12, 12),
        new THREE.MeshBasicMaterial({ color: 0x7a5cff }));
      badge.position.set(0, 0.05, 0.21);
      this.torso.add(badge);
    }
    this.group.scale.setScalar(2.0);
  }

  setState(s) {
    if (this.state === s) return;
    this.state = s;
    this.hammer.visible = s === 'work';
  }

  walkTo(target, onArrive) {
    this.walkTarget = target.clone();
    this.onArrive = onArrive ?? null;
    this.setState('walk');
  }

  tick(dt) {
    this.t += dt;
    const t = this.t;

    if (this.state === 'walk' && this.walkTarget) {
      const pos = this.group.position;
      const dir = new THREE.Vector3().subVectors(this.walkTarget, pos);
      dir.y = 0;
      const dist = dir.length();
      if (dist < 0.15) {
        this.walkTarget = null;
        this.setState('idle');
        const cb = this.onArrive; this.onArrive = null;
        if (cb) cb();
      } else {
        dir.normalize();
        pos.addScaledVector(dir, Math.min(dist, this.walkSpeed * dt));
        this.group.rotation.y = Math.atan2(dir.x, dir.z);
      }
    }

    switch (this.state) {
      case 'idle': {
        this.torso.position.y = 1.15 + Math.sin(t * 2) * 0.02;
        this.head.rotation.y = Math.sin(t * 0.7) * 0.25;
        this.armL.rotation.x = Math.sin(t * 2) * 0.05;
        this.armR.rotation.x = -Math.sin(t * 2) * 0.05;
        this.legL.rotation.x = 0; this.legR.rotation.x = 0;
        break;
      }
      case 'walk': {
        const w = t * 9;
        this.legL.rotation.x = Math.sin(w) * 0.7;
        this.legR.rotation.x = -Math.sin(w) * 0.7;
        this.armL.rotation.x = -Math.sin(w) * 0.5;
        this.armR.rotation.x = Math.sin(w) * 0.5;
        this.group.position.y = Math.abs(Math.sin(w)) * 0.06;
        break;
      }
      case 'work': {
        const w = t * 7;
        const swing = (Math.sin(w) + 1) / 2;        // 0..1
        this.armR.rotation.x = -2.4 + swing * 1.9;  // raise then strike
        this.armL.rotation.x = -0.2;
        this.torso.rotation.x = 0.08 * swing;
        this.head.rotation.y = 0;
        this.legL.rotation.x = 0; this.legR.rotation.x = 0;
        break;
      }
      case 'cheer': {
        const w = t * 8;
        this.armL.rotation.x = Math.PI - 0.3 + Math.sin(w) * 0.25;
        this.armR.rotation.x = Math.PI - 0.3 - Math.sin(w) * 0.25;
        this.group.position.y = Math.abs(Math.sin(w * 0.9)) * 0.35;
        break;
      }
      case 'defeat': {
        this.armL.rotation.x = 0.15;
        this.armR.rotation.x = 0.15;
        this.head.rotation.x = 0.5;
        this.torso.rotation.x = 0.25;
        this.group.position.y = 0;
        break;
      }
    }
  }
}

function pivotLimb(w, len, mat) {
  const pivot = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, len, w), mat);
  mesh.position.y = -len / 2;
  pivot.add(mesh);
  return pivot;
}
