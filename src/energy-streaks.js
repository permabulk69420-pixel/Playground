import * as THREE from 'three';

// Charging aura: glowing energy streaks orbit the caster and shed small
// flame wisps and embers as they go. Trails are sampled from each streak's
// own orbit, so they stay smooth at any frame rate. Flames are billboards
// stretched along world-up so they stay upright however the headset tilts.
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

function createRibbons(scene) {
  const bodyCount = 16, palmCount = 8, count = bodyCount + palmCount, samples = 48;
  const up = new THREE.Vector3(0, 1, 0), right = new THREE.Vector3(), forward = new THREE.Vector3();
  const axis = new THREE.Vector3(), cross = new THREE.Vector3(), other = new THREE.Vector3();
  const point = new THREE.Vector3(), next = new THREE.Vector3(), dir = new THREE.Vector3();
  const gold = new THREE.Color(0xffc15e), ember = new THREE.Color(0xff5a14), hot = new THREE.Color(0xfff1c8);
  let strength = 0, storedPower = 0, burst = 0, time = 0;
  const emitters = Array.from({ length: count }, (_, i) => ({
    phase: i * 2.399963, speed: 1.3 + (i * 0.317 % 1) * 0.8, spin: i % 3 === 0 ? -1 : 1,
    radius: 0.6 + (i * 0.731 % 1) * 0.45, tilt: (i * 0.529 % 1 - 0.5) * 0.9,
    rise: i * 0.618 % 1, wobble: 0.08 + (i * 0.413 % 1) * 0.1,
    head: new THREE.Vector3(), visible: 0
  }));

  const vertices = count * samples * 2;
  const positions = new Float32Array(vertices * 3), tangents = new Float32Array(vertices * 3);
  const shades = new Float32Array(vertices * 4), widths = new Float32Array(vertices), uvs = new Float32Array(vertices * 2);
  const indices = [];
  for (let e = 0; e < count; e++) for (let j = 0; j < samples; j++) {
    const at = (e * samples + j) * 2;
    uvs.set([0, j / (samples - 1), 1, j / (samples - 1)], at * 2);
    if (j < samples - 1) indices.push(at, at + 1, at + 2, at + 1, at + 3, at + 2);
  }
  const geo = new THREE.BufferGeometry();
  const dynamic = (array, size) => new THREE.BufferAttribute(array, size).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', dynamic(positions, 3));
  geo.setAttribute('normal', dynamic(tangents, 3));
  geo.setAttribute('shade', dynamic(shades, 4));
  geo.setAttribute('width', dynamic(widths, 1));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  const trails = new THREE.Mesh(geo, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: `
      attribute vec4 shade; attribute float width; varying vec4 vShade; varying float vSide;
      void main() {
        vShade = shade; vSide = uv.x * 2. - 1.;
        vec3 side = normalize(cross(normalize(cameraPosition - position), normal));
        gl_Position = projectionMatrix * viewMatrix * vec4(position + side * vSide * width, 1.);
      }`,
    fragmentShader: `
      varying vec4 vShade; varying float vSide;
      void main() {
        float e = vSide * vSide;
        float glow = exp(-e * 16.) * 1.5 + exp(-e * 2.5) * .55;
        gl_FragColor = vec4(vShade.rgb * glow, vShade.a * glow);
        #include <colorspace_fragment>
      }`
  }));
  trails.name = 'energy-streak-trails';
  trails.frustumCulled = false;
  trails.visible = false;
  scene.add(trails);

  const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), new THREE.MeshBasicMaterial({
    color: 0xfff1c8, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), count);
  heads.name = 'energy-streak-heads';
  heads.frustumCulled = false;
  heads.visible = false;
  scene.add(heads);
  const dummy = new THREE.Object3D(), color = new THREE.Color();

  // Body ribbons spiral from the floor to above head height, 1-2 m out; palm ribbons
  // coil tightly around each hand. `a` is the orbit angle along the path.
  function place(e, i, a, head, palms, out) {
    if (i < bodyCount) {
      const radius = e.radius * (1 + burst * 1.2);
      const climb = (e.rise + time * 0.12 * (0.6 + storedPower)) % 1;
      out.copy(head).addScaledVector(right, Math.cos(a) * radius).addScaledVector(forward, Math.sin(a) * radius);
      out.y = head.y - 1.4 + climb * 1.15 + Math.sin(a + i) * e.wobble + Math.cos(a) * e.tilt * 0.3;
      return Math.sin(climb * Math.PI);
    }
    const side = i % 2;
    axis.copy(palms[side]).sub(head).addScaledVector(right, side ? -0.2 : 0.2);
    axis.y += 0.5;
    if (axis.lengthSq() < 0.001) axis.copy(forward);
    axis.normalize();
    cross.crossVectors(axis, up);
    if (cross.lengthSq() < 0.001) cross.copy(right);
    cross.normalize();
    other.crossVectors(axis, cross).normalize();
    const radius = (0.07 + (i * 0.37 % 1) * 0.05) * (1 + burst * 3);
    out.copy(palms[side]).addScaledVector(axis, -0.03 - (0.5 + 0.5 * Math.sin(a * 0.5 + i)) * 0.13)
      .addScaledVector(cross, Math.cos(a) * radius).addScaledVector(other, Math.sin(a) * radius);
    return 1;
  }

  function update(active, power, palms, head, facing, now, dt) {
    time = now;
    if (active) { storedPower = power; burst = 0; } else burst = Math.min(1, burst + dt * 2.5);
    strength = THREE.MathUtils.lerp(strength, active ? 0.7 + 0.3 * power : 0, 1 - Math.exp(-dt * (active ? 8 : 5)));
    if (strength < 0.01) { trails.visible = heads.visible = false; return; }
    forward.copy(facing); forward.y = 0;
    if (forward.lengthSq() < 0.001) forward.set(0, 0, -1);
    forward.normalize();
    right.crossVectors(forward, up).normalize();
    for (let i = 0; i < count; i++) {
      const e = emitters[i], palm = i >= bodyCount;
      e.phase += dt * e.spin * e.speed * (palm ? 2.6 : 0.6) * (0.75 + storedPower * 0.8);
      // Trail covers a fixed arc of the orbit behind the head.
      const arc = (palm ? 3 : 2.2) * e.spin;
      const baseWidth = (palm ? 0.009 : 0.024) * (0.65 + 0.35 * storedPower);
      for (let j = 0; j < samples; j++) {
        const t = j / (samples - 1);
        const a = e.phase - arc * t;
        const visible = place(e, i, a, head, palms, point);
        place(e, i, a + 0.01 * e.spin, head, palms, next);
        dir.subVectors(next, point);
        if (dir.lengthSq() < 1e-10) dir.copy(up);
        dir.normalize();
        const fade = Math.pow(1 - t, 1.5) * strength * visible;
        color.copy(hot).lerp(gold, Math.min(1, t * 3)).lerp(ember, Math.max(0, t * 1.4 - 0.4));
        for (let s = 0; s < 2; s++) {
          const v = (i * samples + j) * 2 + s;
          point.toArray(positions, v * 3);
          dir.toArray(tangents, v * 3);
          shades.set([color.r, color.g, color.b, fade], v * 4);
          widths[v] = baseWidth * (0.25 + 0.75 * Math.pow(1 - t, 0.6));
        }
        if (j === 0) {
          dummy.position.copy(point);
          dummy.scale.setScalar((palm ? 0.006 : 0.012) * strength * visible);
          e.head.copy(point); e.visible = visible;
          dummy.updateMatrix();
          heads.setMatrixAt(i, dummy.matrix);
        }
      }
    }
    for (const name of ['position', 'normal', 'shade', 'width']) geo.attributes[name].needsUpdate = true;
    heads.instanceMatrix.needsUpdate = true;
    trails.visible = heads.visible = true;
  }
  function release(power) { storedPower = power; }
  function reset() { strength = 0; burst = 0; trails.visible = heads.visible = false; }
  return { update, release, reset, emitters, get strength() { return strength; } };
}

export function createEnergyStreaks(scene) {
  const ribbons = createRibbons(scene);
  const flames = createFlamePool(scene, 700, false);
  const embers = createFlamePool(scene, 220, true);
  const center = new THREE.Vector3(), p = new THREE.Vector3(), v = new THREE.Vector3();
  let wispRate = 0, emberRate = 0;

  function update(active, power, palms, head, facing, now, dt) {
    ribbons.update(active, power, palms, head, facing, now, dt);
    const strength = ribbons.strength;
    center.set(head.x, 0, head.z);
    if (active && strength > 0.02) {
      // Each body streak sheds small flame wisps from its glowing head.
      wispRate += dt * (60 + power * 90);
      while (wispRate >= 1) {
        wispRate--;
        const e = ribbons.emitters[Math.floor(Math.random() * 16)];
        if (e.visible < 0.2) continue;
        p.copy(e.head);
        v.set((Math.random() - 0.5) * 0.1, 0.25 + Math.random() * 0.3, (Math.random() - 0.5) * 0.1);
        flames.emit(p, v, 0.3 + Math.random() * 0.25, 0.05 + power * 0.04, 0.45 * e.visible);
      }
      emberRate += dt * (25 + power * 40);
      while (emberRate >= 1) {
        emberRate--;
        const angle = Math.random() * Math.PI * 2, radius = 0.5 + Math.random() * 0.6;
        p.set(center.x + Math.cos(angle) * radius, head.y - 1.4 + Math.random() * 0.6, center.z + Math.sin(angle) * radius);
        v.set(0, 0.5 + Math.random() * 0.8, 0);
        embers.emit(p, v, 1 + Math.random() * 0.8, 0.008 + Math.random() * 0.008, 0.9, 0.8 + Math.random());
      }
    }
    flames.update(dt, now, center);
    embers.update(dt, now, center);
  }

  function release(power) { ribbons.release(power); }
  function reset() { ribbons.reset(); flames.reset(); embers.reset(); wispRate = emberRate = 0; }
  return { update, release, reset };
}
