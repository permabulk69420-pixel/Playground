import * as THREE from 'three';

// Charging aura: a ring of fire on the floor around the caster, a column of
// flame tongues rising around the body and embers spiralling upward. Firing
// blasts the ring outward. Flames are camera-facing billboards stretched
// along world-up so they stay vertical however the headset is tilted.
const NOISE = `
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p){ return noise(p) * .55 + noise(p * 2.1 + 3.1) * .3 + noise(p * 4.3 - 1.7) * .15; }
`;

function createFlamePool(scene, count, ember) {
  const quad = new THREE.PlaneGeometry(1, 1);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = quad.index;
  geometry.setAttribute('position', quad.attributes.position);
  geometry.setAttribute('uv', quad.attributes.uv);
  const place = new Float32Array(count * 4), look = new Float32Array(count * 4);
  const dynamic = (array) => new THREE.InstancedBufferAttribute(array, 4).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('place', dynamic(place));
  geometry.setAttribute('look', dynamic(look));
  geometry.instanceCount = count;
  const material = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `
      attribute vec4 place; attribute vec4 look; varying vec2 vUv; varying vec4 vLook;
      void main() {
        vUv = uv; vLook = look;
        vec4 view = viewMatrix * vec4(place.xyz, 1.);
        vec2 upView = (viewMatrix * vec4(0., 1., 0., 0.)).xy;
        upView = length(upView) > 1e-3 ? normalize(upView) : vec2(0., 1.);
        vec2 across = vec2(upView.y, -upView.x);
        float stretch = ${ember ? '1.' : '1.6'};
        view.xy += across * position.x * place.w + upView * (position.y + .25) * place.w * stretch;
        gl_Position = projectionMatrix * view;
      }`,
    fragmentShader: `${NOISE}
      uniform float time; varying vec2 vUv; varying vec4 vLook;
      void main() {
        vec2 p = vUv * 2. - 1.;
        float age = vLook.x, seed = vLook.y;
        ${ember ? `
        float a = exp(-dot(p, p) * 7.) * vLook.z;
        vec3 color = mix(vec3(1., .85, .5), vec3(1., .35, .05), age);` : `
        // Teardrop flame: wide base, tapering tip, torn by rising noise.
        float n = fbm(vec2(p.x * 2.2 + seed, p.y * 1.6 - time * 3.2 - seed));
        float width = mix(.95, .12, clamp(p.y * .5 + .5, 0., 1.));
        float body = 1. - abs(p.x) / width - max(p.y, 0.) * .35 + (n - .5) * 1.1;
        float base = smoothstep(-1., -.55, p.y);
        float a = smoothstep(0., .5, body) * base * vLook.z;
        float heat = clamp(body * .95 - age * .9 + (1. - (p.y * .5 + .5)) * .25, 0., 1.);
        vec3 color = mix(vec3(.75, .07, .005), vec3(1., .38, .03), smoothstep(.05, .45, heat));
        color = mix(color, vec3(1., .7, .25), smoothstep(.6, .98, heat));`}
        if (a < .004) discard;
        gl_FragColor = vec4(color, a);
        #include <colorspace_fragment>
      }`
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = ember ? 'aura-embers' : 'aura-flames';
  mesh.frustumCulled = false;
  scene.add(mesh);

  const pos = new Float32Array(count * 3), vel = new Float32Array(count * 3);
  const life = new Float32Array(count), duration = new Float32Array(count);
  const size = new Float32Array(count), gain = new Float32Array(count), seed = new Float32Array(count);
  const swirl = new Float32Array(count);
  const center = new THREE.Vector3();
  let cursor = 0;
  function emit(p, v, lifetime, s, g, spin = 0) {
    const i = cursor; cursor = (cursor + 1) % count;
    pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
    vel[i * 3] = v.x; vel[i * 3 + 1] = v.y; vel[i * 3 + 2] = v.z;
    life[i] = duration[i] = lifetime; size[i] = s; gain[i] = g; seed[i] = Math.random() * 50; swirl[i] = spin;
  }
  function update(dt, time, around) {
    material.uniforms.time.value = time;
    center.copy(around);
    for (let i = 0; i < count; i++) {
      if (life[i] <= 0) { place[i * 4 + 3] = 0; continue; }
      life[i] -= dt;
      if (life[i] <= 0) { place[i * 4 + 3] = 0; continue; }
      const t = 1 - life[i] / duration[i], j = i * 3;
      if (swirl[i]) {
        // Embers orbit the caster while they climb.
        const dx = pos[j] - center.x, dz = pos[j + 2] - center.z;
        pos[j] += -dz * swirl[i] * dt; pos[j + 2] += dx * swirl[i] * dt;
      }
      pos[j] += vel[j] * dt; pos[j + 1] += vel[j + 1] * dt; pos[j + 2] += vel[j + 2] * dt;
      const damping = Math.exp(-dt * 1.5);
      vel[j] *= damping; vel[j + 2] *= damping;
      place[i * 4] = pos[j]; place[i * 4 + 1] = pos[j + 1]; place[i * 4 + 2] = pos[j + 2];
      place[i * 4 + 3] = size[i] * (ember ? 1 - t * 0.5 : 0.6 + Math.sin(t * Math.PI) * 0.6);
      look[i * 4] = t; look[i * 4 + 1] = seed[i];
      look[i * 4 + 2] = gain[i] * Math.min(1, t * 6) * Math.pow(1 - t, ember ? 1 : 1.3);
    }
    geometry.attributes.place.needsUpdate = true;
    geometry.attributes.look.needsUpdate = true;
  }
  function reset() { life.fill(0); place.fill(0); geometry.attributes.place.needsUpdate = true; }
  return { emit, update, reset };
}

export function createEnergyStreaks(scene) {
  const flames = createFlamePool(scene, 1100, false);
  const embers = createFlamePool(scene, 260, true);
  const light = new THREE.PointLight(0xff6a1a, 0, 5, 2);
  scene.add(light);
  const center = new THREE.Vector3(), p = new THREE.Vector3(), v = new THREE.Vector3();
  let strength = 0, ringRate = 0, columnRate = 0, emberRate = 0, time = 0;
  const TAU = Math.PI * 2;

  function update(active, power, palms, head, facing, now, dt) {
    time = now;
    strength = THREE.MathUtils.lerp(strength, active ? 0.4 + 0.6 * power : 0, 1 - Math.exp(-dt * (active ? 5 : 6)));
    center.set(head.x, 0, head.z);
    if (strength > 0.02) {
      // Ring of fire on the floor.
      ringRate += dt * 320 * strength;
      while (ringRate >= 1) {
        ringRate--;
        const angle = Math.random() * TAU, radius = 1.15 + (Math.random() - 0.5) * 0.12;
        p.set(center.x + Math.cos(angle) * radius, 0.02, center.z + Math.sin(angle) * radius);
        v.set(0, 0.5 + strength * 0.9 + Math.random() * 0.4, 0);
        flames.emit(p, v, 0.45 + Math.random() * 0.35, 0.2 + strength * 0.16, 0.4);
      }
      // Tall flame tongues rising around the body.
      columnRate += dt * 170 * strength;
      while (columnRate >= 1) {
        columnRate--;
        const angle = Math.random() * TAU, radius = 0.7 + Math.random() * 0.25;
        p.set(center.x + Math.cos(angle) * radius, Math.random() * 0.3, center.z + Math.sin(angle) * radius);
        v.set(-Math.sin(angle) * 0.25, 0.9 + strength * 0.9 + Math.random() * 0.4, Math.cos(angle) * 0.25);
        flames.emit(p, v, 0.55 + Math.random() * 0.4, 0.22 + strength * 0.2, 0.3);
      }
      emberRate += dt * 70 * strength;
      while (emberRate >= 1) {
        emberRate--;
        const angle = Math.random() * TAU, radius = 0.6 + Math.random() * 0.7;
        p.set(center.x + Math.cos(angle) * radius, Math.random() * 0.5, center.z + Math.sin(angle) * radius);
        v.set(0, 0.8 + Math.random() * 1.2, 0);
        embers.emit(p, v, 1.2 + Math.random() * 1, 0.012 + Math.random() * 0.012, 1, 1.2 + Math.random());
      }
    }
    light.position.set(center.x, 0.6, center.z);
    light.intensity = strength * (4 + 2 * Math.sin(time * 19) * Math.sin(time * 7));
    flames.update(dt, time, center);
    embers.update(dt, time, center);
  }

  // Firing blasts the ring outward as a wave of flame.
  function release(power) {
    for (let i = 0; i < 160; i++) {
      const angle = i / 160 * TAU;
      p.set(center.x + Math.cos(angle) * 1.1, 0.03, center.z + Math.sin(angle) * 1.1);
      const speed = 3 + power * 3 + Math.random();
      v.set(Math.cos(angle) * speed, 0.6 + Math.random() * 0.6, Math.sin(angle) * speed);
      flames.emit(p, v, 0.5 + Math.random() * 0.3, 0.2 + power * 0.15, 0.6);
    }
  }

  function reset() {
    strength = 0; ringRate = columnRate = emberRate = 0; light.intensity = 0;
    flames.reset(); embers.reset();
  }
  return { update, release, reset };
}
