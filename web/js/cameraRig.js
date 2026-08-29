// Camera choreography. OrbitControls own the camera; the rig tweens the
// controls' target + camera position for cinematic moves. Any user drag
// cancels the current move; the next event re-takes control.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export class CameraRig {
  constructor(camera, dom) {
    this.camera = camera;
    this.controls = new OrbitControls(camera, dom);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 3200; // zoom out all the way to orbit

    this.move = null;             // active tween
    this.orbit = null;            // slow auto-orbit {center, radius, speed, height}
    this.userHold = false;
    this.shakeAmt = 0;

    dom.addEventListener('pointerdown', () => {
      this.move = null;
      this.orbit = null;
      this.userHold = true;
    });
  }

  // Fly camera + target somewhere, over dur seconds.
  flyTo({ pos, target, dur = 1.8, then = null }) {
    this.userHold = false;
    this.orbit = null;
    this.move = {
      t: 0, dur,
      fromPos: this.camera.position.clone(),
      toPos: pos.clone(),
      fromTgt: this.controls.target.clone(),
      toTgt: target.clone(),
      then,
    };
  }

  // Slow cinematic orbit around a point (used while fighters work).
  orbitAround(center, radius = 34, height = 16, speed = 0.08) {
    this.userHold = false;
    this.orbit = { center: center.clone(), radius, height, speed, angle: this.angleTo(center) };
    this.move = null;
  }

  angleTo(center) {
    const d = new THREE.Vector3().subVectors(this.camera.position, center);
    return Math.atan2(d.z, d.x);
  }

  shake(amount) {
    this.shakeAmt = Math.min(1, this.shakeAmt + amount);
  }

  tick(dt, t) {
    if (this.move) {
      const m = this.move;
      m.t += dt;
      const p = Math.min(1, m.t / m.dur);
      const e = 1 - (1 - p) ** 3;
      this.camera.position.lerpVectors(m.fromPos, m.toPos, e);
      this.controls.target.lerpVectors(m.fromTgt, m.toTgt, e);
      if (p >= 1) {
        const then = m.then;
        this.move = null;
        then?.();
      }
    } else if (this.orbit) {
      const o = this.orbit;
      o.angle += o.speed * dt;
      const px = o.center.x + Math.cos(o.angle) * o.radius;
      const pz = o.center.z + Math.sin(o.angle) * o.radius;
      this.camera.position.lerp(new THREE.Vector3(px, o.center.y + o.height, pz), 0.03);
      this.controls.target.lerp(o.center, 0.05);
    }

    // Shake decay, applied as small target jitter
    if (this.shakeAmt > 0.001) {
      const s = this.shakeAmt;
      this.camera.position.x += (Math.random() - 0.5) * s * 0.5;
      this.camera.position.y += (Math.random() - 0.5) * s * 0.35;
      this.shakeAmt *= Math.pow(0.001, dt); // fast decay
    }

    this.controls.update();
  }
}
