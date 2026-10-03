import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const GRAVITY = 14;
const JUMP_SPEED = 4.6;

// Clawd, the playable character. The GLB (tools/build_clawd.py) faces +Z with its origin at the feet.
export function createClawd({ scene }) {
  const root = new THREE.Group();
  root.name = 'clawd-player';
  scene.add(root);

  const parts = {};
  let facing = 0;
  let phase = 0;
  let jumpY = 0;
  let jumpV = 0;
  let squash = 0;
  let time = 0;

  new GLTFLoader().load(`${import.meta.env.BASE_URL}models/clawd.glb`, (gltf) => {
    gltf.scene.traverse((o) => {
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
      parts[o.name] = o;
    });
    root.add(gltf.scene);
  }, undefined, (error) => console.warn('[Clawd] could not load model', error));

  function jump() {
    if (jumpY > 0.001) return;
    jumpV = JUMP_SPEED;
    squash = -1; // anticipation stretch handled below
  }

  /** position: ground position; velocity: world-space xz velocity (m/s). Returns jump height. */
  function update(dt, position, velocity) {
    time += dt;
    const speed = Math.hypot(velocity.x, velocity.z);

    if (jumpV !== 0 || jumpY > 0) {
      jumpV -= GRAVITY * dt;
      jumpY += jumpV * dt;
      if (jumpY <= 0) { jumpY = 0; jumpV = 0; squash = 1; }
    }
    squash += (0 - squash) * (1 - Math.exp(-dt * 12));

    if (speed > 0.15) {
      const target = Math.atan2(velocity.x, velocity.z);
      let diff = target - facing;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      facing += diff * (1 - Math.exp(-dt * 14));
      phase += dt * (6 + speed * 2.2);
    }

    root.position.set(position.x, position.y + jumpY, position.z);
    root.rotation.y = facing;

    const swing = Math.min(speed / 2.6, 1);
    const air = jumpY > 0.001;
    const s = Math.sin(phase);
    const bob = air ? 0 : Math.abs(s) * 0.03 * swing + Math.sin(time * 2.2) * 0.006 * (1 - swing);
    root.children[0]?.position.set(0, bob, 0);
    root.scale.set(1 + squash * 0.08, 1 - squash * 0.1, 1 + squash * 0.08);

    // Legs scuttle in diagonal pairs; arms swing opposite to the leg pairs.
    const legAmp = air ? 0.15 : 0.7 * swing;
    for (let i = 0; i < 4; i++) {
      const leg = parts[`Clawd_Leg_${i}`];
      if (leg) leg.rotation.x = (i === 0 || i === 3 ? s : -s) * legAmp;
    }
    const armL = parts.Clawd_Arm_L;
    const armR = parts.Clawd_Arm_R;
    const flap = air ? -0.9 : Math.sin(time * 1.8) * 0.05 + -s * 0.5 * swing;
    if (armL) armL.rotation.z = -Math.abs(flap) * 0.6 - (air ? 0.3 : 0.0);
    if (armR) armR.rotation.z = Math.abs(air ? flap : -flap) * 0.6 + (air ? 0.3 : 0.0);

    return jumpY;
  }

  return { root, update, jump };
}
