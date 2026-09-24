import * as THREE from 'three';
import './style.css';
import { createVRHands } from './hands.js';
import { createMagicBlast } from './magic-blast.js';

const canvas = document.querySelector('#world');
const enterVR = document.querySelector('#enter-vr');
const status = document.querySelector('#status');

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance'
});
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
renderer.xr.setFramebufferScaleFactor(1.0);
renderer.xr.setFoveation(0.65);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setClearColor(0x282b2e);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x282b2e, 18, 42);

const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 80);
const rig = new THREE.Group();
rig.name = 'player-rig';
rig.add(camera);
scene.add(rig);

camera.position.set(0, 1.68, 5.2);
camera.rotation.order = 'YXZ';

const hands = createVRHands({
  renderer,
  parent: rig,
  onError: (message) => console.warn('[Playground hands]', message)
});

// Deliberately expose the XR pieces for quick experiments.
// Astra/other prototypes can use window.playground.hands.states without rewiring input.
window.playground = { THREE, renderer, scene, camera, rig, hands };

const blastColliders = [];
let blastTarget;

function makeTestZone() {
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x777b7e, roughness: 0.92, metalness: 0.0 });
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x686c70, roughness: 0.95, metalness: 0.0 });
  const propMat = new THREE.MeshStandardMaterial({ color: 0x92969a, roughness: 0.8, metalness: 0.0 });

  const floor = new THREE.Mesh(new THREE.BoxGeometry(18, 0.12, 18), floorMat);
  floor.position.y = -0.06;
  floor.receiveShadow = true;
  scene.add(floor);
  blastColliders.push(floor);

  const wallHeight = 4;
  const wallThickness = 0.16;
  const back = new THREE.Mesh(new THREE.BoxGeometry(18, wallHeight, wallThickness), wallMat);
  back.position.set(0, wallHeight / 2, -9);
  back.receiveShadow = true;
  scene.add(back);
  blastColliders.push(back);

  const left = new THREE.Mesh(new THREE.BoxGeometry(wallThickness, wallHeight, 18), wallMat);
  left.position.set(-9, wallHeight / 2, 0);
  left.receiveShadow = true;
  scene.add(left);
  blastColliders.push(left);

  const right = left.clone();
  right.position.x = 9;
  scene.add(right);
  blastColliders.push(right);

  const grid = new THREE.GridHelper(18, 18, 0x4a4d50, 0x5b5f62);
  grid.position.y = 0.004;
  scene.add(grid);

  const plinths = [
    { x: -3.1, z: -4.4, h: 0.5 },
    { x: 0, z: -4.8, h: 1.0 },
    { x: 3.1, z: -4.4, h: 1.5 }
  ];

  for (const item of plinths) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.1, item.h, 1.1), propMat);
    mesh.position.set(item.x, item.h / 2, item.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    blastColliders.push(mesh);
  }

  const target = new THREE.Mesh(
    new THREE.CylinderGeometry(0.72, 0.72, 0.12, 48),
    new THREE.MeshStandardMaterial({ color: 0x8b8f92, roughness: 0.75 })
  );
  target.rotation.x = Math.PI / 2;
  target.position.set(0, 1.6, -8.82);
  target.castShadow = true;
  scene.add(target);
  blastTarget = target;
  blastColliders.push(target);
  // Concentric markings make it easy to judge a shot from across the room.
  for (const radius of [0.23, 0.48, 0.69]) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(radius - 0.013, radius, 64),
      new THREE.MeshBasicMaterial({ color: 0x34393d, side: THREE.DoubleSide }));
    ring.position.set(0, 1.6, -8.75);
    scene.add(ring);
  }
}

makeTestZone();
const magic = createMagicBlast({ scene, renderer, camera, rig, hands,
  colliders: blastColliders, target: blastTarget });
window.playground.magic = magic;

scene.add(new THREE.HemisphereLight(0xdde3e7, 0x3b3e41, 1.7));

const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
keyLight.position.set(4, 8, 5);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(1024, 1024);
keyLight.shadow.camera.left = -10;
keyLight.shadow.camera.right = 10;
keyLight.shadow.camera.top = 10;
keyLight.shadow.camera.bottom = -10;
scene.add(keyLight);

const fill = new THREE.DirectionalLight(0xbfc8d0, 0.7);
fill.position.set(-5, 4, -3);
scene.add(fill);

const WALK_SPEED = 2.6;
const TURN_SPEED = 1.4;
const ROOM_LIMIT = 8.25;
const STICK_DEADZONE = 0.15;

const up = new THREE.Vector3(0, 1, 0);
const forward = new THREE.Vector3();
const right = new THREE.Vector3();
const targetVelocity = new THREE.Vector3();
const velocity = new THREE.Vector3();
const head = new THREE.Vector3();

const keys = new Set();
let pointerLocked = false;
let lastTime = 0;

function stickAxis(value, deadzone = STICK_DEADZONE) {
  const magnitude = Math.abs(value);
  if (magnitude <= deadzone) return 0;
  return Math.sign(value) * (magnitude - deadzone) / (1 - deadzone);
}

function pivotRigAroundHead(angle) {
  const dx = rig.position.x - head.x;
  const dz = rig.position.z - head.z;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  rig.position.x = head.x + dx * cos - dz * sin;
  rig.position.z = head.z + dx * sin + dz * cos;
  rig.rotation.y += angle;
}

function readXRInput() {
  let x = 0;
  let z = 0;
  let turn = 0;

  const session = renderer.xr.getSession();
  if (!session || session.visibilityState !== 'visible') return { x, z, turn };

  for (const source of session.inputSources) {
    const pad = source.gamepad;
    if (!pad) continue;

    const axes = pad.axes || [];
    const axis = axes.length >= 4 ? axes.length - 2 : 0;

    if (source.handedness === 'left' && axes.length >= 2) {
      x = stickAxis(axes[axis] || 0);
      z = stickAxis(axes[axis + 1] || 0);
    }

    if (source.handedness === 'right' && axes.length >= 2) {
      turn = stickAxis(axes[axis] || 0);
    }
  }

  return { x, z, turn };
}

function readDesktopInput() {
  let x = Number(keys.has('KeyD')) - Number(keys.has('KeyA'));
  let z = Number(keys.has('KeyS')) - Number(keys.has('KeyW'));
  const length = Math.max(1, Math.hypot(x, z));
  x /= length;
  z /= length;
  return { x, z, turn: 0 };
}

function updateMovement(dt) {
  const activeCamera = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  activeCamera.getWorldPosition(head);

  const input = renderer.xr.isPresenting ? readXRInput() : readDesktopInput();

  if (renderer.xr.isPresenting) {
    const turn = -input.turn * TURN_SPEED * dt;
    if (turn) pivotRigAroundHead(turn);

    // Same Oasis behavior: locomotion follows the virtual body/rig yaw,
    // not wherever the player happens to look.
    forward.set(-Math.sin(rig.rotation.y), 0, -Math.cos(rig.rotation.y));
  } else {
    activeCamera.getWorldDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() < 0.001) forward.set(0, 0, -1);
    forward.normalize();
  }

  right.crossVectors(forward, up).normalize();
  targetVelocity.copy(right).multiplyScalar(input.x).addScaledVector(forward, -input.z);
  if (targetVelocity.lengthSq() > 1) targetVelocity.normalize();
  targetVelocity.multiplyScalar(WALK_SPEED);

  velocity.lerp(targetVelocity, 1 - Math.exp(-dt * (targetVelocity.lengthSq() ? 18 : 28)));

  const dx = velocity.x * dt;
  const dz = velocity.z * dt;
  const nextX = THREE.MathUtils.clamp(head.x + dx, -ROOM_LIMIT, ROOM_LIMIT);
  const nextZ = THREE.MathUtils.clamp(head.z + dz, -ROOM_LIMIT, ROOM_LIMIT);
  rig.position.x += nextX - head.x;
  rig.position.z += nextZ - head.z;
}

window.addEventListener('keydown', (event) => {
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(event.code)) {
    event.preventDefault();
    keys.add(event.code);
  }
});
window.addEventListener('keyup', (event) => keys.delete(event.code));
window.addEventListener('blur', () => {
  keys.clear();
  velocity.set(0, 0, 0);
});

canvas.addEventListener('click', () => {
  if (!renderer.xr.isPresenting) canvas.requestPointerLock?.();
});

document.addEventListener('pointerlockchange', () => {
  pointerLocked = document.pointerLockElement === canvas;
});

document.addEventListener('mousemove', (event) => {
  if (!pointerLocked || renderer.xr.isPresenting) return;
  rig.rotation.y -= event.movementX * 0.0024;
  camera.rotation.x = THREE.MathUtils.clamp(camera.rotation.x - event.movementY * 0.0024, -1.35, 1.35);
});

enterVR.addEventListener('click', async () => {
  if (renderer.xr.isPresenting) return;

  enterVR.disabled = true;
  status.textContent = '';

  let session;
  try {
    session = await navigator.xr.requestSession('immersive-vr', {
      requiredFeatures: ['local-floor'],
      optionalFeatures: ['bounded-floor']
    });

    await renderer.xr.setSession(session);
    renderer.xr.setFoveation(0.65);

    if (session.supportedFrameRates && session.updateTargetFrameRate) {
      const rates = Array.from(session.supportedFrameRates);
      const preferred = rates.includes(72) ? 72 : rates.find((rate) => rate >= 72);
      if (preferred) await session.updateTargetFrameRate(preferred).catch(() => {});
    }
  } catch (error) {
    if (session) await session.end().catch(() => {});
    status.textContent = error.name === 'NotAllowedError'
      ? 'VR access was declined.'
      : 'Could not enter VR. Open this page in Meta Quest Browser and try again.';
  } finally {
    enterVR.disabled = false;
  }
});

renderer.xr.addEventListener('sessionstart', () => {
  document.exitPointerLock?.();
  keys.clear();
  velocity.set(0, 0, 0);

  // Match Oasis: start VR with a clean local-floor rig and no desktop camera transform.
  rig.position.set(0, 0, 5.2);
  rig.rotation.set(0, 0, 0);
  rig.scale.set(1, 1, 1);
  camera.position.set(0, 0, 0);
  camera.quaternion.identity();

  status.textContent = '';
});

renderer.xr.addEventListener('sessionend', () => {
  rig.position.set(0, 0, 0);
  rig.rotation.set(0, 0, 0);
  camera.position.set(0, 1.68, 5.2);
  camera.rotation.set(0, 0, 0);
  velocity.set(0, 0, 0);
  lastTime = 0;
});

function frame(time, xrFrame) {
  const dt = lastTime ? Math.min((time - lastTime) / 1000, 0.05) : 0;
  lastTime = time;

  rig.updateMatrixWorld(true);
  if (renderer.xr.isPresenting) renderer.xr.updateCamera(camera);

  updateMovement(dt);
  rig.updateMatrixWorld(true);
  if (renderer.xr.isPresenting) renderer.xr.updateCamera(camera);
  magic.update(dt, xrFrame);
  hands.update(dt);
  renderer.render(scene, camera);
}

renderer.setAnimationLoop(frame);

window.addEventListener('resize', () => {
  if (renderer.xr.isPresenting) return;
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

try {
  const supported = Boolean(navigator.xr) && await navigator.xr.isSessionSupported('immersive-vr');
  enterVR.disabled = !supported;
  enterVR.textContent = supported ? 'Enter VR' : 'VR unavailable';
} catch {
  enterVR.disabled = true;
  enterVR.textContent = 'VR unavailable';
}
