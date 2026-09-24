import * as THREE from 'three';
import { BlastGesture } from './blast-gesture.js';
import { createFireVFX } from './fire-vfx.js';

const clamp = THREE.MathUtils.clamp;

export function createMagicBlast({ scene, renderer, camera, rig, hands, colliders, target }) {
  const gesture = new BlastGesture();
  const fx = createFireVFX(scene);
  const light = new THREE.PointLight(0xff7a1e, 0, 5, 2);
  scene.add(light);
  const scratch = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const midpoint = new THREE.Vector3();
  const palms = [new THREE.Vector3(), new THREE.Vector3()];
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

  const projectiles = Array.from({ length: 6 }, () => ({
    life: 0, power: 0, radius: 0, trail: {},
    position: new THREE.Vector3(), previous: new THREE.Vector3(), velocity: new THREE.Vector3()
  }));
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

  function launch(shot) {
    const p = projectiles.find(p => p.life <= 0) || projectiles[0];
    worldDirection.copy(shot.direction).transformDirection(rig.matrixWorld);
    p.life = 3;
    p.power = shot.charge;
    p.radius = 0.05 + shot.charge * 0.07;
    p.trail = {};
    p.previous.copy(midpoint);
    p.position.copy(midpoint).addScaledVector(worldDirection, 0.08);
    p.velocity.copy(worldDirection).multiplyScalar(11 + shot.charge * 9);
    fx.release(midpoint, worldDirection, shot.charge);
    pulse(0.5 + shot.charge * 0.45, 110);
    shots++;
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

  function updateProjectiles(dt) {
    for (const p of projectiles) {
      if (p.life <= 0) continue;
      p.life -= dt;
      p.previous.copy(p.position);
      direction.copy(p.velocity).normalize();
      ray.set(p.previous, direction);
      ray.far = p.velocity.length() * dt + p.radius;
      intersections.length = 0;
      ray.intersectObjects(colliders, false, intersections);
      if (intersections.length) {
        const hit = intersections[0];
        const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
        fx.impact(hit.point, normal, p.power);
        if (hit.object === target) { targetFlash = 1; hits++; pulse(0.3, 45); }
        p.life = 0;
        continue;
      }
      if (p.life <= 0) continue;
      p.position.addScaledVector(p.velocity, dt);
      fx.projectile(p.trail, p.previous, p.position, p.velocity, p.radius, p.power);
      if (!gesture.active) {
        light.position.copy(p.position);
        light.intensity = (3 + p.power * 5) * fx.flicker(2);
      }
    }
    targetFlash = Math.max(0, targetFlash - dt * 2);
    target.material.emissive.setHex(0xff6b0b);
    target.material.emissiveIntensity = targetFlash * 2;
  }

  function reset() {
    gesture.reset(); fx.reset(); demo = false; lastBucket = -1; light.intensity = 0;
    for (const p of projectiles) p.life = 0;
    for (const state of hands.states) state.magicPose = false;
  }
  renderer.xr.addEventListener('sessionstart', reset);
  renderer.xr.addEventListener('sessionend', reset);
  window.addEventListener('blur', reset);

  function update(dt, frame) {
    time += dt;
    fx.begin();
    const inVR = renderer.xr.isPresenting;
    demoButton.hidden = inVR;
    if (inVR) readSample(frame);
    else if (demo) demoSample(dt);
    if (inVR || demo) {
      const shot = gesture.update(dt, sample);
      if (shot) launch(shot);
    } else if (gesture.active) gesture.reset();
    for (const state of hands.states) state.magicPose = gesture.active;
    light.intensity = 0;
    if (gesture.active) {
      const radius = Math.min(palms[0].distanceTo(palms[1]) * 0.3, 0.04 + gesture.charge * 0.1);
      fx.charge(midpoint, palms, radius, gesture.charge, gesture.motion, dt);
      light.position.copy(midpoint);
      light.intensity = (1.5 + gesture.charge * 7) * fx.flicker();
      hapticClock -= dt;
      const bucket = Math.floor(gesture.charge * 4);
      if (bucket > lastBucket && bucket > 0) { pulse(0.2 + gesture.charge * 0.3, 55); lastBucket = bucket; }
      else if (gesture.motion > 0.2 && hapticClock <= 0) { pulse(0.06 + gesture.charge * 0.12, 25); hapticClock = 0.14; }
    } else lastBucket = -1;
    updateProjectiles(dt);
    fx.update(dt, time);
    drawPanel();
  }

  return { update, reset, gesture, get stats() { return { shots, hits }; } };
}
