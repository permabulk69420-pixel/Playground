import * as THREE from 'three';

// Charging aura: no lines. A swirling cloud of glowing magic motes and
// twinkling star sparks circles the caster, and each hand throws off
// glittering sparkler dust that hangs in the air as a trail.
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

const STAR = `
float star(vec2 p) {
  float core = exp(-dot(p, p) * 18.);
  float rays = exp(-abs(p.x) * 26.) * exp(-abs(p.y) * 3.2) + exp(-abs(p.y) * 26.) * exp(-abs(p.x) * 3.2);
  return core + rays * .85;
}`;

function createSparkles(scene, count) {
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
  const mesh = new THREE.Mesh(geometry, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `
      attribute vec4 place; attribute vec4 look; varying vec2 vUv; varying vec4 vLook;
      void main() {
        vUv = uv; vLook = look;
        vec4 view = viewMatrix * vec4(place.xyz, 1.);
        float c = cos(look.w), s = sin(look.w);
        view.xy += mat2(c, s, -s, c) * position.xy * place.w;
        gl_Position = projectionMatrix * view;
      }`,
    fragmentShader: `${STAR}
      varying vec2 vUv; varying vec4 vLook;
      void main() {
        float a = star(vUv * 2. - 1.) * vLook.x;
        if (a < .004) discard;
        vec3 color = mix(vec3(1., .78, .38), vec3(1., .97, .9), vLook.y);
        gl_FragColor = vec4(color, a);
        #include <colorspace_fragment>
      }`
  }));
  mesh.name = 'aura-sparkles';
  mesh.frustumCulled = false;
  scene.add(mesh);

  const pos = new Float32Array(count * 3), vel = new Float32Array(count * 3);
  const life = new Float32Array(count), duration = new Float32Array(count);
  const size = new Float32Array(count), twinkle = new Float32Array(count), seed = new Float32Array(count);
  let cursor = 0;
  function emit(p, v, lifetime, s, rate) {
    const i = cursor; cursor = (cursor + 1) % count;
    pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
    vel[i * 3] = v.x; vel[i * 3 + 1] = v.y; vel[i * 3 + 2] = v.z;
    life[i] = duration[i] = lifetime; size[i] = s; twinkle[i] = rate; seed[i] = Math.random() * 20;
  }
  function update(dt, time) {
    for (let i = 0; i < count; i++) {
      if (life[i] <= 0) { place[i * 4 + 3] = 0; continue; }
      life[i] -= dt;
      if (life[i] <= 0) { place[i * 4 + 3] = 0; continue; }
      const t = 1 - life[i] / duration[i], j = i * 3;
      const damping = Math.exp(-dt * 2);
      vel[j] *= damping; vel[j + 1] = vel[j + 1] * damping + dt * 0.05; vel[j + 2] *= damping;
      pos[j] += vel[j] * dt; pos[j + 1] += vel[j + 1] * dt; pos[j + 2] += vel[j + 2] * dt;
      // Sharp on/off twinkle so sparkles flash rather than just fade.
      const flash = Math.pow(0.5 + 0.5 * Math.sin(time * twinkle[i] + seed[i]), 3);
      const fade = Math.min(1, t * 8) * (1 - t);
      place[i * 4] = pos[j]; place[i * 4 + 1] = pos[j + 1]; place[i * 4 + 2] = pos[j + 2];
      place[i * 4 + 3] = size[i] * (0.6 + flash * 0.8);
      look[i * 4] = fade * (0.35 + flash * 0.9);
      look[i * 4 + 1] = flash;
      look[i * 4 + 3] = seed[i] + time * 0.6;
    }
    geometry.attributes.place.needsUpdate = true;
    geometry.attributes.look.needsUpdate = true;
  }
  function reset() { life.fill(0); place.fill(0); geometry.attributes.place.needsUpdate = true; }
  return { emit, update, reset };
}

export function createEnergyStreaks(scene) {
  const motes = createFlamePool(scene, 1500, true);
  const sparkles = createSparkles(scene, 1800);
  const previous = [new THREE.Vector3(), new THREE.Vector3()];
  const center = new THREE.Vector3(), p = new THREE.Vector3(), v = new THREE.Vector3(), move = new THREE.Vector3();
  const mid = new THREE.Vector3(), swirl = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  let strength = 0, moteRate = 0, starRate = 0, dustRate = 0, streamRate = 0, started = false;

  function update(active, power, palms, head, facing, now, dt) {
    strength = THREE.MathUtils.lerp(strength, active ? 0.6 + 0.4 * power : 0, 1 - Math.exp(-dt * (active ? 6 : 4)));
    center.set(head.x, 0, head.z);
    if (active && dt > 0) {
      // Vortex of glowing motes orbiting the body, rising slowly.
      moteRate += dt * (320 + power * 380);
      while (moteRate >= 1) {
        moteRate--;
        const angle = Math.random() * Math.PI * 2, radius = 0.35 + Math.random() * 0.7;
        p.set(center.x + Math.cos(angle) * radius, head.y - 1.55 + Math.random() * 1.45, center.z + Math.sin(angle) * radius);
        v.set(0, 0.08 + Math.random() * 0.22, 0);
        motes.emit(p, v, 1.4 + Math.random() * 1.2, 0.012 + Math.random() * 0.02, 0.8, (1.2 + Math.random() * 1.3) * (Math.random() < 0.5 ? 1 : -1) * (0.8 + power));
      }
      // Twinkling star sparks through the cloud.
      starRate += dt * (70 + power * 110);
      while (starRate >= 1) {
        starRate--;
        const angle = Math.random() * Math.PI * 2, radius = 0.35 + Math.random() * 0.7;
        p.set(center.x + Math.cos(angle) * radius, head.y - 1.5 + Math.random() * 1.4, center.z + Math.sin(angle) * radius);
        v.set(-Math.sin(angle) * 0.25, 0.06, Math.cos(angle) * 0.25);
        sparkles.emit(p, v, 0.6 + Math.random() * 0.7, 0.03 + Math.random() * 0.06 * (0.6 + power), 6 + Math.random() * 12);
      }
      // Glittering streams pulled from each palm into the ball between the hands.
      mid.addVectors(palms[0], palms[1]).multiplyScalar(0.5);
      streamRate += dt * (500 + power * 500);
      while (streamRate >= 1) {
        streamRate--;
        const side = Math.random() < 0.5 ? 0 : 1, lifetime = 0.28 + Math.random() * 0.22;
        p.copy(palms[side]).add(v.randomDirection().multiplyScalar(0.03));
        v.subVectors(mid, p).divideScalar(lifetime);
        swirl.subVectors(mid, palms[side]).cross(up).normalize().multiplyScalar((Math.random() - 0.5) * 0.9);
        v.add(swirl);
        if (Math.random() < 0.3) sparkles.emit(p, v, lifetime, 0.02 + Math.random() * 0.025, 12 + Math.random() * 14);
        else motes.emit(p, v, lifetime, 0.008 + Math.random() * 0.01, 1, 0);
      }
      // Sparkler dust off each hand; left behind in the air it draws a trail.
      for (let side = 0; side < 2; side++) {
        move.subVectors(palms[side], previous[side]);
        const speed = started ? move.length() / dt : 0;
        dustRate += dt * (120 + Math.min(speed, 3) * 160) * (0.7 + power * 0.6);
        while (dustRate >= 1) {
          dustRate--;
          p.copy(previous[side]).lerp(palms[side], Math.random()).add(v.randomDirection().multiplyScalar(0.025));
          v.randomDirection().multiplyScalar(0.05 + Math.random() * 0.15);
          if (Math.random() < 0.35) sparkles.emit(p, v, 0.35 + Math.random() * 0.45, 0.018 + Math.random() * 0.025, 10 + Math.random() * 16);
          else motes.emit(p, v, 0.5 + Math.random() * 0.6, 0.006 + Math.random() * 0.01, 1, 0);
        }
      }
    }
    previous[0].copy(palms[0]); previous[1].copy(palms[1]); started = active;
    motes.update(dt, now, center);
    sparkles.update(dt, now);
  }

  // Firing blows the whole cloud outward in a burst of sparks.
  function release(power) {
    for (let i = 0; i < 260; i++) {
      const angle = Math.random() * Math.PI * 2;
      p.set(center.x + Math.cos(angle) * 0.4, previous[0].y - 0.6 + Math.random() * 1.2, center.z + Math.sin(angle) * 0.4);
      v.set(Math.cos(angle), (Math.random() - 0.3) * 0.6, Math.sin(angle)).multiplyScalar(1.5 + Math.random() * (1.5 + power * 2));
      if (i % 3 === 0) sparkles.emit(p, v, 0.5 + Math.random() * 0.5, 0.04 + Math.random() * 0.05, 12 + Math.random() * 10);
      else motes.emit(p, v, 0.6 + Math.random() * 0.6, 0.015 + Math.random() * 0.015, 1, 0);
    }
  }

  function reset() { strength = 0; moteRate = starRate = dustRate = streamRate = 0; started = false; motes.reset(); sparkles.reset(); }
  return { update, release, reset };
}
