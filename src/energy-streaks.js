import * as THREE from 'three';

// Charging aura: bold fire-gold energy streams spiral around the caster and
// shed flame wisps, sparkles and embers; light trails swirl around each hand
// and follow its movement, throwing off twinkling star sparkles.
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
  const bodyCount = 14, palmCount = 0, count = bodyCount + palmCount, samples = 48;
  const up = new THREE.Vector3(0, 1, 0), right = new THREE.Vector3(), forward = new THREE.Vector3();
  const axis = new THREE.Vector3(), cross = new THREE.Vector3(), other = new THREE.Vector3();
  const point = new THREE.Vector3(), next = new THREE.Vector3(), dir = new THREE.Vector3();
  const gold = new THREE.Color(0xffc15e), ember = new THREE.Color(0xff5a14), hot = new THREE.Color(0xfff1c8);
  let strength = 0, storedPower = 0, burst = 0, time = 0;
  const emitters = Array.from({ length: count }, (_, i) => ({
    phase: i * 2.399963, speed: 1.3 + (i * 0.317 % 1) * 0.8, spin: i % 3 === 0 ? -1 : 1,
    radius: 0.65 + (i * 0.731 % 1) * 0.4, tilt: (i * 0.529 % 1 - 0.5) * 0.9,
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
      out.y = head.y - 1.5 + climb * 1.3 + Math.sin(a + i) * e.wobble + Math.cos(a) * e.tilt * 0.3;
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
    strength = THREE.MathUtils.lerp(strength, active ? 0.8 + 0.2 * power : 0, 1 - Math.exp(-dt * (active ? 8 : 5)));
    if (strength < 0.01) { trails.visible = heads.visible = false; return; }
    forward.copy(facing); forward.y = 0;
    if (forward.lengthSq() < 0.001) forward.set(0, 0, -1);
    forward.normalize();
    right.crossVectors(forward, up).normalize();
    for (let i = 0; i < count; i++) {
      const e = emitters[i], palm = i >= bodyCount;
      e.phase += dt * e.spin * e.speed * (palm ? 2.6 : 0.6) * (0.75 + storedPower * 0.8);
      // Trail covers a fixed arc of the orbit behind the head.
      const arc = (palm ? 3 : 3.2) * e.spin;
      const baseWidth = (palm ? 0.009 : 0.055) * (0.7 + 0.3 * storedPower);
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
          dummy.scale.setScalar((palm ? 0.006 : 0.024) * strength * visible);
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

// Ribbon of light through the last ~0.4 s of one hand's path.
function createHandTrail(scene) {
  const maxPoints = 64, subdiv = 3, samples = (maxPoints - 1) * subdiv + 1, LIFE = 0.6;
  const points = Array.from({ length: maxPoints }, () => ({ p: new THREE.Vector3(), t: 0 }));
  let used = 0;
  const vertices = samples * 2;
  const positions = new Float32Array(vertices * 3), tangents = new Float32Array(vertices * 3);
  const shades = new Float32Array(vertices * 4), widths = new Float32Array(vertices), uvs = new Float32Array(vertices * 2);
  const indices = [];
  for (let j = 0; j < samples; j++) {
    uvs.set([0, j / (samples - 1), 1, j / (samples - 1)], j * 4);
    if (j < samples - 1) indices.push(j * 2, j * 2 + 1, j * 2 + 2, j * 2 + 1, j * 2 + 3, j * 2 + 2);
  }
  const geo = new THREE.BufferGeometry();
  const dynamic = (array, size) => new THREE.BufferAttribute(array, size).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', dynamic(positions, 3));
  geo.setAttribute('normal', dynamic(tangents, 3));
  geo.setAttribute('shade', dynamic(shades, 4));
  geo.setAttribute('width', dynamic(widths, 1));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.setDrawRange(0, 0);
  const mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: `
      attribute vec4 shade; attribute float width; varying vec4 vShade; varying vec2 vUv;
      void main() {
        vShade = shade; vUv = uv;
        vec3 side = normalize(cross(normalize(cameraPosition - position), normal));
        gl_Position = projectionMatrix * viewMatrix * vec4(position + side * (uv.x * 2. - 1.) * width, 1.);
      }`,
    fragmentShader: `
      uniform float time; varying vec4 vShade; varying vec2 vUv;
      void main() {
        float e = vUv.x * 2. - 1.; e *= e;
        // Bright core, soft halo and shimmering bands running down the trail.
        float shimmer = .75 + .25 * sin(vUv.y * 60. - time * 18.);
        float glow = exp(-e * 22.) * 1.3 + exp(-e * 3.) * .35 * shimmer;
        gl_FragColor = vec4(vShade.rgb * glow, vShade.a * glow);
        #include <colorspace_fragment>
      }`
  }));
  mesh.name = 'aura-hand-trail';
  mesh.frustumCulled = false;
  scene.add(mesh);

  const hot = new THREE.Color(0xfff8e8), gold = new THREE.Color(0xffc24a), rose = new THREE.Color(0xff5fa8);
  const color = new THREE.Color(), a = new THREE.Vector3(), dir = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const curve = new THREE.CatmullRomCurve3([], false, 'centripetal');

  function push(p, time) {
    if (used && points[0].p.distanceToSquared(p) < 0.002 * 0.002) { points[0].t = time; return; }
    for (let i = Math.min(used, maxPoints - 1); i > 0; i--) { points[i].p.copy(points[i - 1].p); points[i].t = points[i - 1].t; }
    points[0].p.copy(p); points[0].t = time;
    used = Math.min(maxPoints, used + 1);
  }
  function update(active, palm, time, strength) {
    mesh.material.uniforms.time.value = time;
    if (active) push(palm, time);
    while (used && time - points[used - 1].t > LIFE) used--;
    if (used < 2 || strength < 0.01) { geo.setDrawRange(0, 0); return; }
    curve.points = points.slice(0, used).map(q => q.p);
    const count = (used - 1) * subdiv + 1;
    for (let j = 0; j < count; j++) {
      const u = j / (count - 1);
      curve.getPoint(u, a);
      curve.getTangent(Math.min(u, 0.999), dir);
      if (dir.lengthSq() < 1e-8) dir.copy(up);
      const k = Math.min(used - 1, Math.round(u * (used - 1)));
      const age = THREE.MathUtils.clamp((time - points[k].t) / LIFE, 0, 1);
      const fade = Math.pow(1 - age, 1.6) * strength;
      color.copy(hot).lerp(gold, Math.min(1, age * 2.5)).lerp(rose, Math.max(0, age * 1.5 - 0.5));
      for (let s = 0; s < 2; s++) {
        const v = j * 2 + s;
        a.toArray(positions, v * 3); dir.toArray(tangents, v * 3);
        shades.set([color.r, color.g, color.b, fade], v * 4);
        widths[v] = 0.045 * (1 - age * 0.75) * (0.7 + 0.3 * strength);
      }
    }
    for (const name of ['position', 'normal', 'shade', 'width']) geo.attributes[name].needsUpdate = true;
    geo.setDrawRange(0, (count - 1) * 6);
  }
  function reset() { used = 0; geo.setDrawRange(0, 0); }
  return { update, reset };
}



// Light trails that swirl around a hand: each is sampled from its own orbit,
// so the curves stay smooth, tapering from a bright head to a faded tail.
function createHandOrbits(scene, count) {
  const samples = 40, vertices = count * samples * 2;
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
  const mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: `
      attribute vec4 shade; attribute float width; varying vec4 vShade; varying vec2 vUv;
      void main() {
        vShade = shade; vUv = uv;
        vec3 side = normalize(cross(normalize(cameraPosition - position), normal));
        gl_Position = projectionMatrix * viewMatrix * vec4(position + side * (uv.x * 2. - 1.) * width, 1.);
      }`,
    fragmentShader: `
      uniform float time; varying vec4 vShade; varying vec2 vUv;
      void main() {
        float e = vUv.x * 2. - 1.; e *= e;
        float shimmer = .7 + .3 * sin(vUv.y * 40. - time * 22.);
        float glow = exp(-e * 20.) * 1.4 + exp(-e * 2.5) * .4 * shimmer;
        gl_FragColor = vec4(vShade.rgb * glow, vShade.a * glow);
        #include <colorspace_fragment>
      }`
  }));
  mesh.name = 'aura-hand-orbits';
  mesh.frustumCulled = false;
  mesh.visible = false;
  scene.add(mesh);
  const orbits = Array.from({ length: count }, (_, i) => ({
    phase: i * 1.57, speed: 6 + (i % 4) * 1.4, radius: 0.09 + (i % 4) * 0.022, tilt: (i % 3 - 1) * 0.6,
    head: new THREE.Vector3()
  }));
  const axis = new THREE.Vector3(), u = new THREE.Vector3(), w = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const point = new THREE.Vector3(), next = new THREE.Vector3(), dir = new THREE.Vector3();
  const hot = new THREE.Color(0xffffff), gold = new THREE.Color(0xffc75a), rose = new THREE.Color(0xff6fb0), color = new THREE.Color();
  function place(o, a, palm, out) {
    const r = o.radius * (1 + 0.15 * Math.sin(a * 2));
    out.copy(palm).addScaledVector(u, Math.cos(a) * r).addScaledVector(w, Math.sin(a) * r)
      .addScaledVector(axis, Math.sin(a + o.tilt * 3) * 0.035 + o.tilt * 0.02);
  }
  function update(palm, other, time, dt, strength) {
    mesh.visible = strength > 0.01;
    if (!mesh.visible) return;
    mesh.material.uniforms.time.value = time;
    axis.subVectors(other, palm);
    if (axis.lengthSq() < 1e-6) axis.set(1, 0, 0);
    axis.normalize();
    u.crossVectors(axis, up);
    if (u.lengthSq() < 1e-4) u.set(0, 0, 1);
    u.normalize();
    w.crossVectors(axis, u);
    for (let i = 0; i < count; i++) {
      const o = orbits[i];
      o.phase += dt * o.speed;
      for (let j = 0; j < samples; j++) {
        const t = j / (samples - 1), a = o.phase - t * 3.4;
        place(o, a, palm, point); place(o, a + 0.01, palm, next);
        dir.subVectors(next, point).normalize();
        if (j === 0) o.head.copy(point);
        const fade = Math.pow(1 - t, 1.4) * strength;
        color.copy(hot).lerp(gold, Math.min(1, t * 3)).lerp(rose, Math.max(0, t * 1.6 - 0.6));
        for (let s = 0; s < 2; s++) {
          const v = (i * samples + j) * 2 + s;
          point.toArray(positions, v * 3); dir.toArray(tangents, v * 3);
          shades.set([color.r, color.g, color.b, fade], v * 4);
          widths[v] = 0.02 * (1 - t * 0.75) * (0.7 + 0.3 * strength);
        }
      }
    }
    for (const name of ['position', 'normal', 'shade', 'width']) geo.attributes[name].needsUpdate = true;
  }
  return { update, orbits, hide() { mesh.visible = false; } };
}

export function createEnergyStreaks(scene) {
  const ribbons = createRibbons(scene);
  const flames = createFlamePool(scene, 1400, false);
  const embers = createFlamePool(scene, 300, true);
  const sparkles = createSparkles(scene, 1200);
  const handTrails = [createHandTrail(scene), createHandTrail(scene)];
  const handOrbits = [createHandOrbits(scene, 4), createHandOrbits(scene, 4)];
  const previous = [new THREE.Vector3(), new THREE.Vector3()];
  const center = new THREE.Vector3(), p = new THREE.Vector3(), v = new THREE.Vector3(), move = new THREE.Vector3();
  let wispRate = 0, emberRate = 0, glintRate = 0, handRate = 0, started = false;

  function update(active, power, palms, head, facing, now, dt) {
    ribbons.update(active, power, palms, head, facing, now, dt);
    const strength = ribbons.strength;
    center.set(head.x, 0, head.z);
    for (let side = 0; side < 2; side++) {
      handTrails[side].update(active, palms[side], now, strength);
      handOrbits[side].update(palms[side], palms[1 - side], now, dt, strength);
    }
    if (active && strength > 0.02 && dt > 0) {
      // Flame wisps and sparkles shed from the heads of the body streams.
      wispRate += dt * (220 + power * 220);
      while (wispRate >= 1) {
        wispRate--;
        const e = ribbons.emitters[Math.floor(Math.random() * 14)];
        if (e.visible < 0.2) continue;
        v.set((Math.random() - 0.5) * 0.1, 0.25 + Math.random() * 0.3, (Math.random() - 0.5) * 0.1);
        flames.emit(e.head, v, 0.35 + Math.random() * 0.3, 0.09 + power * 0.06, 0.5 * e.visible);
      }
      glintRate += dt * (140 + power * 160);
      while (glintRate >= 1) {
        glintRate--;
        const e = ribbons.emitters[Math.floor(Math.random() * 14)];
        if (e.visible < 0.2) continue;
        v.randomDirection().multiplyScalar(0.1 + Math.random() * 0.15);
        sparkles.emit(e.head, v, 0.5 + Math.random() * 0.6, 0.03 + Math.random() * 0.05, 6 + Math.random() * 12);
      }
      // Hands: sparkles off the swirling trails, more when the hands move fast.
      for (let side = 0; side < 2; side++) {
        move.subVectors(palms[side], previous[side]);
        const speed = started ? move.length() / dt : 0;
        handRate += dt * (60 + Math.min(speed, 3) * 80) * (0.7 + power * 0.6);
        while (handRate >= 1) {
          handRate--;
          const o = handOrbits[side].orbits[Math.floor(Math.random() * 4)];
          v.randomDirection().multiplyScalar(0.06 + Math.random() * 0.12);
          sparkles.emit(o.head, v, 0.4 + Math.random() * 0.5, 0.018 + Math.random() * 0.03, 8 + Math.random() * 14);
        }
      }
      emberRate += dt * (60 + power * 70);
      while (emberRate >= 1) {
        emberRate--;
        const angle = Math.random() * Math.PI * 2, radius = 0.5 + Math.random() * 0.7;
        p.set(center.x + Math.cos(angle) * radius, head.y - 1.5 + Math.random() * 0.6, center.z + Math.sin(angle) * radius);
        v.set(0, 0.5 + Math.random() * 0.8, 0);
        embers.emit(p, v, 1 + Math.random() * 0.8, 0.008 + Math.random() * 0.008, 0.9, 0.8 + Math.random());
      }
    }
    previous[0].copy(palms[0]); previous[1].copy(palms[1]); started = active;
    flames.update(dt, now, center);
    embers.update(dt, now, center);
    sparkles.update(dt, now);
  }

  // Firing throws a burst of sparkles off both hands and flares the streams out.
  function release(power) {
    ribbons.release(power);
    for (let side = 0; side < 2; side++) for (let i = 0; i < 60; i++) {
      v.randomDirection().multiplyScalar(0.6 + Math.random() * (0.8 + power));
      sparkles.emit(previous[side], v, 0.4 + Math.random() * 0.5, 0.03 + Math.random() * 0.04, 12 + Math.random() * 10);
    }
  }

  function reset() {
    ribbons.reset(); flames.reset(); embers.reset(); sparkles.reset();
    for (const t of handTrails) t.reset();
    for (const o of handOrbits) o.hide();
    wispRate = emberRate = glintRate = handRate = 0; started = false;
  }
  return { update, release, reset };
}
