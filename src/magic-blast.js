import * as THREE from 'three';
import { BlastGesture } from './blast-gesture.js';
import { createPlasmaOrb, createShockwave, createBlastAtmosphere } from './blast-vfx.js';

const UP = new THREE.Vector3(0, 1, 0);
const ORANGE = new THREE.Color(0xff741b);
const GOLD = new THREE.Color(0xffd884);
const clamp = THREE.MathUtils.clamp;

function glowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(255,250,219,1)');
  gradient.addColorStop(0.12, 'rgba(255,209,94,.85)');
  gradient.addColorStop(0.32, 'rgba(255,103,18,.30)');
  gradient.addColorStop(0.65, 'rgba(244,43,4,.065)');
  gradient.addColorStop(1, 'rgba(240,30,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createMagicBlast({ scene, renderer, camera, rig, hands, colliders, target }) {
  const gesture = new BlastGesture();
  const atmosphere = createBlastAtmosphere(scene);
  const texture = glowTexture();
  const orb = createPlasmaOrb(texture);
  scene.add(orb.group);
  const light = new THREE.PointLight(0xff8a26, 0, 4, 2);
  scene.add(light);

  // One instanced batch for the palm ribbons, trailing sparks and impact embers.
  const count = 480;
  const particles = Array.from({ length: count }, () => ({
    life: 0, duration: 1, type: '', side: 0, phase: 0, radius: 0,
    position: new THREE.Vector3(), previous: new THREE.Vector3(), velocity: new THREE.Vector3()
  }));
  const sparks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.6, 1, 1, 5),
    new THREE.MeshBasicMaterial({ color: 0xffffff, blending: THREE.AdditiveBlending,
      transparent: true, depthWrite: false, toneMapped: false }), count);
  sparks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  sparks.frustumCulled = false;
  scene.add(sparks);
  const dummy = new THREE.Object3D();
  const particleColor = new THREE.Color();
  const scratch = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const bitangent = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const midpoint = new THREE.Vector3();
  const palms = [new THREE.Vector3(), new THREE.Vector3()];
  let cursor = 0;
  let emission = 0;
  let hapticClock = 0;
  let lastBucket = -1;
  let time = 0;
  let demo = false;
  let demoTime = 0;
  let targetFlash = 0;
  let hits = 0;
  let shots = 0;
  let aimHead = new THREE.Quaternion();
  const inverseRig = new THREE.Quaternion();
  const worldDirection = new THREE.Vector3();
  const sample = {
    tracked: false, held: false,
    left: new THREE.Vector3(), right: new THREE.Vector3(),
    leftNormal: new THREE.Vector3(), rightNormal: new THREE.Vector3(),
    head: new THREE.Vector3(), forward: new THREE.Vector3()
  };

  const projectiles = Array.from({ length: 6 }, () => {
    const visual = createPlasmaOrb(texture);
    scene.add(visual.group);
    return { ...visual, life: 0, power: 0, velocity: new THREE.Vector3(), previous: new THREE.Vector3() };
  });
  const shockwaves = Array.from({ length: 5 }, () => {
    const mesh = createShockwave();
    mesh.visible = false;
    scene.add(mesh);
    return { mesh, life: 0, power: 0 };
  });
  const ray = new THREE.Raycaster();
  const intersections = [];

  // In-world text is visible in immersive VR, where the HTML overlay is absent.
  const panelCanvas = document.createElement('canvas');
  panelCanvas.width = 1024; panelCanvas.height = 192;
  const ctx = panelCanvas.getContext('2d');
  const panelTexture = new THREE.CanvasTexture(panelCanvas);
  panelTexture.colorSpace = THREE.SRGBColorSpace;
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.135), new THREE.MeshBasicMaterial({
    map: panelTexture, transparent: true, depthWrite: false, toneMapped: false
  }));
  scene.add(panel);
  let lastPanel = '';
  let lastPanelTime = -1;

  const hint = document.querySelector('#magic-status');
  const demoButton = document.querySelector('#demo-blast');
  demoButton.addEventListener('click', () => {
    if (!renderer.xr.isPresenting) { reset(); demo = true; demoTime = 0; }
  });

  function pulse(amount, duration = 30) {
    for (const state of hands.states) {
      const actuator = state.inputSource?.gamepad?.hapticActuators?.[0];
      if (actuator?.pulse) {
        try { Promise.resolve(actuator.pulse(amount, duration)).catch(() => {}); } catch { /* Optional hardware. */ }
      }
    }
  }

  function particle(type, position, velocity, life, width = 0.005) {
    const p = particles[cursor++ % count];
    p.type = type;
    p.position.copy(position);
    p.previous.copy(position);
    p.velocity.copy(velocity);
    p.life = p.duration = life;
    p.radius = width;
    p.phase = Math.random() * Math.PI * 2;
    return p;
  }

  function burst(position, power, normal) {
    atmosphere.burst(position, power, normal);
    for (let i = 0; i < 100 + power * 90; i++) {
      scratch.randomDirection().multiplyScalar(1.2 + Math.random() * (3 + power * 3));
      if (normal && scratch.dot(normal) < 0) scratch.reflect(normal);
      particle('ember', position, scratch, 0.5 + Math.random() * 1.1, 0.003 + Math.random() * 0.006);
    }
    const wave = shockwaves.find(w => w.life <= 0) || shockwaves[0];
    wave.life = 0.7;
    wave.power = power;
    wave.mesh.position.copy(position);
    if (normal) wave.mesh.position.addScaledVector(normal, 0.03);
    if (normal) wave.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    else wave.mesh.quaternion.copy(camera.getWorldQuaternion(aimHead));
    wave.mesh.visible = true;
  }

  function launch(shot) {
    const p = projectiles.find(p => p.life <= 0) || projectiles[0];
    p.life = 3;
    p.fireEmission = 0;
    p.emission = 0;
    p.power = shot.charge;
    p.group.position.copy(midpoint);
    worldDirection.copy(shot.direction).transformDirection(rig.matrixWorld);
    p.velocity.copy(worldDirection).multiplyScalar(11 + shot.charge * 9);
    atmosphere.release(midpoint, worldDirection, shot.charge);
    p.group.position.addScaledVector(worldDirection, 0.08);
    p.group.scale.setScalar(0.08 + shot.charge * 0.12);
    p.uniforms.power.value = shot.charge;
    p.group.visible = true;
    pulse(0.5 + shot.charge * 0.45, 110);
    shots++;
    orb.group.visible = false;
  }

  function readSample(frame) {
    const left = hands.getState('left');
    const right = hands.getState('right');
    const session = renderer.xr.getSession();
    const referenceSpace = renderer.xr.getReferenceSpace();
    sample.tracked = Boolean(frame && session?.visibilityState === 'visible' && referenceSpace &&
      left?.inputSource?.gripSpace && right?.inputSource?.gripSpace &&
      left.inputSource.gamepad && right.inputSource.gamepad);
    if (!sample.tracked) return;
    const lp = frame.getPose(left.inputSource.gripSpace, referenceSpace);
    const rp = frame.getPose(right.inputSource.gripSpace, referenceSpace);
    if (!lp || !rp || lp.emulatedPosition || rp.emulatedPosition) { sample.tracked = false; return; }
    const lq = left.grip.quaternion;
    const rq = right.grip.quaternion;
    sample.left.copy(left.grip.position);
    sample.right.copy(right.grip.position);
    // WebXR grip-space +X is through the left palm; -X through the right.
    // https://www.w3.org/TR/webxr/#dom-xrinputsource-gripspace
    sample.leftNormal.set(1, 0, 0).applyQuaternion(lq);
    sample.rightNormal.set(-1, 0, 0).applyQuaternion(rq);
    const viewer = frame.getViewerPose(referenceSpace);
    if (!viewer) { sample.tracked = false; return; }
    sample.head.copy(viewer.transform.position);
    aimHead.copy(viewer.transform.orientation);
    sample.forward.set(0, 0, -1).applyQuaternion(aimHead);
    sample.held = Boolean(right.inputSource.gamepad.buttons[4]?.pressed);
    // Put the stream origins just above the controller grip, on the palm side.
    palms[0].copy(sample.left).addScaledVector(sample.leftNormal, 0.025).applyMatrix4(rig.matrixWorld);
    palms[1].copy(sample.right).addScaledVector(sample.rightNormal, 0.025).applyMatrix4(rig.matrixWorld);
    midpoint.addVectors(palms[0], palms[1]).multiplyScalar(0.5);
  }

  function demoSample(dt) {
    demoTime += dt;
    const oscillation = Math.sin(demoTime * 12) * 0.09;
    const thrust = clamp((demoTime - 3.6) * 1.5, 0, 0.32);
    camera.getWorldQuaternion(aimHead);
    rig.getWorldQuaternion(inverseRig).invert();
    aimHead.premultiply(inverseRig);
    sample.head.copy(camera.position);
    sample.forward.set(0, 0, -1).applyQuaternion(aimHead);
    sample.left.set(-0.22, -0.27 + oscillation, -0.62 - thrust).applyQuaternion(aimHead).add(sample.head);
    sample.right.set(0.22, -0.27 - oscillation, -0.62 - thrust).applyQuaternion(aimHead).add(sample.head);
    sample.leftNormal.set(1, 0, 0).applyQuaternion(aimHead);
    sample.rightNormal.set(-1, 0, 0).applyQuaternion(aimHead);
    sample.held = demoTime < 4;
    sample.tracked = true;
    palms[0].copy(sample.left).applyMatrix4(rig.matrixWorld);
    palms[1].copy(sample.right).applyMatrix4(rig.matrixWorld);
    midpoint.addVectors(palms[0], palms[1]).multiplyScalar(0.5);
    if (demoTime > 5.3) { demo = false; gesture.reset(); }
  }

  function drawPanel() {
    const percent = Math.floor(gesture.charge * 100);
    const message = renderer.xr.isPresenting || demo ? gesture.message : 'Hold A · palms facing · oscillate · push to fire';
    const text = `${message}|${percent}|${hits}`;
    if (text !== lastPanel && time - lastPanelTime > 0.08) {
      lastPanelTime = time;
      lastPanel = text;
      ctx.clearRect(0, 0, 1024, 192);
      ctx.fillStyle = 'rgba(15,18,22,.9)';
      ctx.beginPath(); ctx.roundRect(0, 0, 1024, 192, 24); ctx.fill();
      ctx.fillStyle = '#ffc779'; ctx.font = 'bold 25px sans-serif';
      ctx.fillText('MAGIC BLAST', 28, 40);
      ctx.textAlign = 'right'; ctx.fillStyle = '#adb7bd';
      ctx.fillText(`TARGET HITS  ${hits}`, 992, 40);
      ctx.textAlign = 'left'; ctx.fillStyle = '#fff3dc'; ctx.font = '30px sans-serif';
      ctx.fillText(message, 28, 91);
      ctx.fillStyle = '#32383e'; ctx.fillRect(28, 124, 870, 14);
      ctx.fillStyle = gesture.charge >= 0.22 ? '#ffc56a' : '#d46a24';
      ctx.fillRect(28, 124, 870 * gesture.charge, 14);
      ctx.font = '24px sans-serif'; ctx.fillText(`${percent}%`, 924, 139);
      ctx.fillStyle = '#adb7bd'; ctx.font = '22px sans-serif';
      ctx.fillText('One hand up, the other down. Keep A held through the push.', 28, 173);
      panelTexture.needsUpdate = true;
      if (hint) hint.textContent = `${message}${gesture.active ? ` · ${percent}%` : ''}`;
    }
    const viewCamera = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
    viewCamera.getWorldQuaternion(aimHead);
    viewCamera.getWorldPosition(scratch);
    panel.position.set(0, -0.46, -1.2).applyQuaternion(aimHead).add(scratch);
    panel.quaternion.copy(aimHead);
    panel.visible = renderer.xr.isPresenting;
  }

  function updateParticles(dt) {
    for (let i = 0; i < count; i++) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        dummy.scale.setScalar(0); dummy.updateMatrix(); sparks.setMatrixAt(i, dummy.matrix); continue;
      }
      p.previous.copy(p.position);
      const fraction = 1 - p.life / p.duration;
      if (p.type === 'stream') {
        if (!gesture.active) { p.life = 0; dummy.scale.setScalar(0); dummy.updateMatrix(); sparks.setMatrixAt(i, dummy.matrix); continue; }
        direction.subVectors(midpoint, palms[p.side]).normalize();
        tangent.crossVectors(direction, UP);
        if (tangent.lengthSq() < 0.01) tangent.set(1, 0, 0);
        tangent.normalize();
        bitangent.crossVectors(direction, tangent);
        const swirl = Math.sin(fraction * Math.PI) * (0.035 + gesture.charge * 0.065);
        const angle = p.phase + fraction * Math.PI * 3.5 + time * 2;
        p.position.lerpVectors(palms[p.side], midpoint, fraction)
          .addScaledVector(tangent, Math.cos(angle) * swirl)
          .addScaledVector(bitangent, Math.sin(angle) * swirl);
      } else {
        p.position.addScaledVector(p.velocity, dt);
        if (p.type === 'ember') { p.velocity.y -= dt * 2.5; p.velocity.multiplyScalar(Math.exp(-dt * 1.4)); }
      }
      direction.subVectors(p.position, p.previous);
      const length = clamp(direction.length() * 2, 0.008, p.type === 'stream' ? 0.035 : 0.14);
      if (direction.lengthSq() < 0.000001) direction.copy(UP);
      direction.normalize();
      dummy.position.copy(p.position).addScaledVector(direction, -length * 0.5);
      dummy.quaternion.setFromUnitVectors(UP, direction);
      const width = p.radius * Math.min(1, p.life * 8);
      dummy.scale.set(width, length, width);
      dummy.updateMatrix();
      sparks.setMatrixAt(i, dummy.matrix);
      sparks.setColorAt(i, particleColor.copy(GOLD).lerp(ORANGE, fraction));
    }
    sparks.instanceMatrix.needsUpdate = true;
    if (sparks.instanceColor) sparks.instanceColor.needsUpdate = true;
  }

  function updateProjectiles(dt) {
    for (const p of projectiles) {
      if (p.life <= 0) continue;
      p.life -= dt;
      p.previous.copy(p.group.position);
      direction.copy(p.velocity).normalize();
      const distance = p.velocity.length() * dt;
      ray.set(p.previous, direction);
      ray.far = distance + p.group.scale.x;
      intersections.length = 0;
      ray.intersectObjects(colliders, false, intersections);
      if (intersections.length || p.life <= 0) {
        if (intersections.length) {
          const hit = intersections[0];
          const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
          burst(hit.point, p.power, normal);
          if (hit.object === target) { targetFlash = 1; hits++; pulse(0.3, 45); }
        }
        p.life = 0; p.group.visible = false; continue;
      }
      p.group.position.addScaledVector(p.velocity, dt);
      p.uniforms.time.value = time;
      p.group.rotation.y += dt * 2;
      p.shells[0].rotation.z += dt * 1.1;
      p.shells[1].rotation.y -= dt * 1.5;
      atmosphere.trail(p.previous, p.group.position, p.velocity, p.power, dt, p, p.group.scale.x);
      if (!gesture.active) {
        light.position.copy(p.group.position);
        light.intensity = 4 + p.power * 5;
      }
      // Time-based trail density stays the same at 72/90/120 Hz.
      p.emission = (p.emission || 0) + dt * 100;
      while (p.emission >= 1) {
        p.emission--;
        scratch.randomDirection().multiplyScalar(0.35).addScaledVector(direction, -1.5);
        tangent.lerpVectors(p.previous, p.group.position, Math.random());
        particle('trail', tangent, scratch, 0.14 + Math.random() * 0.2, 0.002 + p.power * 0.0025);
      }
    }
    for (const wave of shockwaves) {
      if (wave.life <= 0) continue;
      wave.life -= dt;
      const progress = 1 - Math.max(wave.life, 0) / 0.7;
      wave.mesh.scale.setScalar(0.12 + Math.pow(progress, 0.65) * (1.2 + wave.power * 1.8));
      wave.mesh.material.uniforms.progress.value = progress;
      wave.mesh.visible = wave.life > 0;
    }
    targetFlash = Math.max(0, targetFlash - dt * 2);
    target.material.emissive.setHex(0xff6b0b);
    target.material.emissiveIntensity = targetFlash * 2;
  }

  function reset() {
    gesture.reset(); atmosphere.reset(); demo = false; emission = 0; lastBucket = -1;
    orb.group.visible = false; light.intensity = 0;
    for (const p of projectiles) { p.life = 0; p.group.visible = false; }
    for (const p of particles) p.life = 0;
    for (const wave of shockwaves) { wave.life = 0; wave.mesh.visible = false; }
    for (const state of hands.states) state.magicPose = false;
  }
  renderer.xr.addEventListener('sessionstart', reset);
  renderer.xr.addEventListener('sessionend', reset);
  window.addEventListener('blur', reset);

  function update(dt, frame) {
    time += dt;
    const inVR = renderer.xr.isPresenting;
    demoButton.hidden = inVR;
    if (inVR) readSample(frame);
    else if (demo) demoSample(dt);
    if (inVR || demo) {
      const shot = gesture.update(dt, sample);
      if (shot) launch(shot);
    } else if (gesture.active) gesture.reset();
    for (const state of hands.states) state.magicPose = gesture.active;
    orb.group.visible = gesture.active;
    light.intensity = gesture.active ? 1 + gesture.charge * 8 : 0;
    if (gesture.active) {
      orb.group.position.copy(midpoint);
      light.position.copy(midpoint);
      const radius = 0.038 + gesture.charge * 0.115;
      const maxRadius = palms[0].distanceTo(palms[1]) * 0.29;
      orb.group.scale.setScalar(Math.min(maxRadius, radius) * (1 + Math.sin(time * 18) * 0.025));
      orb.uniforms.time.value = time;
      orb.uniforms.power.value = gesture.charge;
      orb.glow.material.opacity = 0.18 + gesture.charge * 0.1;
      orb.shells[0].rotation.y += dt * (0.7 + gesture.motion);
      orb.shells[1].rotation.z -= dt * (0.4 + gesture.motion * 0.6);
      emission += dt * (12 + gesture.motion * 110);
      while (emission >= 1) {
        emission--;
        const side = Math.random() < 0.5 ? 0 : 1;
        scratch.set(0, 0, 0);
        const p = particle('stream', palms[side], scratch, 0.22 + Math.random() * 0.2, 0.0015 + gesture.motion * 0.0015);
        p.side = side;
      }
      hapticClock -= dt;
      const bucket = Math.floor(gesture.charge * 4);
      if (bucket > lastBucket && bucket > 0) { pulse(0.2 + gesture.charge * 0.3, 55); lastBucket = bucket; }
      else if (gesture.motion > 0.2 && hapticClock <= 0) { pulse(0.06 + gesture.charge * 0.12, 25); hapticClock = 0.14; }
    } else lastBucket = -1;
    atmosphere.charge(gesture.active, palms, midpoint, gesture.charge, gesture.motion, time, dt, orb.group.scale.x);
    updateProjectiles(dt);
    atmosphere.update(dt, time);
    updateParticles(dt);
    drawPanel();
  }

  return { update, reset, gesture, get stats() { return { shots, hits }; } };
}
