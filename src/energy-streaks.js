import * as THREE from 'three';

// Charging aura: each hand glows like a held light and leaves a wide, soft
// ribbon of light along its real path, and a shimmering veil of golden energy
// flows upward around the caster's body. The veil is brightest at its edges
// (fresnel), so looking straight through it never blocks the view.
const NOISE = `
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p){ return noise(p) * .55 + noise(p * 2.1 + 3.1) * .3 + noise(p * 4.3 - 1.7) * .15; }
`;

function glowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.15, 'rgba(255,255,255,.7)');
  gradient.addColorStop(0.4, 'rgba(255,255,255,.18)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

function createVeil(scene) {
  const uniforms = { time: { value: 0 }, strength: { value: 0 } };
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 0.8, 1, 64, 1, true), new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: `
      varying vec3 vWorld; varying vec3 vNormal; varying vec2 vUv;
      void main() {
        vUv = uv;
        vec4 world = modelMatrix * vec4(position, 1.);
        vWorld = world.xyz;
        vNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: `${NOISE}
      uniform float time; uniform float strength;
      varying vec3 vWorld; varying vec3 vNormal; varying vec2 vUv;
      void main() {
        vec3 view = normalize(cameraPosition - vWorld);
        float edge = pow(1. - abs(dot(normalize(vNormal), view)), 2.2);
        // Flowing energy rising up the veil, with bright streaks that shimmer.
        vec2 flow = vec2(vUv.x * 14., vUv.y * 3. - time * 1.1);
        float n = fbm(flow + fbm(flow * .7 + time * .3) * 1.5);
        float streaks = pow(fbm(vec2(vUv.x * 40., vUv.y * 1.2 - time * 2.2)), 3.) * 2.5;
        float vertical = smoothstep(0., .18, vUv.y) * (1. - smoothstep(.62, 1., vUv.y));
        float a = (edge * (.45 + n * 1.3) + streaks * .7 * (.5 + edge)) * vertical * strength;
        if (a < .003) discard;
        vec3 color = mix(vec3(1., .45, .08), vec3(1., .85, .5), clamp(n * 1.2 + streaks * .3, 0., 1.));
        gl_FragColor = vec4(color, a);
        #include <colorspace_fragment>
      }`
  }));
  mesh.name = 'aura-veil';
  mesh.frustumCulled = false;
  mesh.visible = false;
  scene.add(mesh);
  return {
    update(head, time, strength) {
      mesh.visible = strength > 0.01;
      if (!mesh.visible) return;
      const height = Math.max(0.8, head.y + 0.35);
      mesh.scale.set(1, height, 1);
      mesh.position.set(head.x, height / 2, head.z);
      uniforms.time.value = time;
      uniforms.strength.value = strength;
    },
    hide() { mesh.visible = false; }
  };
}

// Wide soft ribbon of light through the last half second of one hand's path.
function createHandTrail(scene) {
  const maxPoints = 64, subdiv = 3, samples = (maxPoints - 1) * subdiv + 1, LIFE = 0.5;
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
        float shimmer = .8 + .2 * sin(vUv.y * 30. - time * 14.);
        float glow = exp(-e * 45.) * 1.1 + exp(-e * 5.) * .55 * shimmer;
        gl_FragColor = vec4(vShade.rgb * glow, vShade.a * glow);
        #include <colorspace_fragment>
      }`
  }));
  mesh.name = 'aura-hand-trail';
  mesh.frustumCulled = false;
  scene.add(mesh);

  const hot = new THREE.Color(0xfff4dc), gold = new THREE.Color(0xffb640), deep = new THREE.Color(0xff5a12);
  const color = new THREE.Color(), a = new THREE.Vector3(), dir = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const curve = new THREE.CatmullRomCurve3([], false, 'centripetal');

  function push(p, time) {
    if (used && points[0].p.distanceToSquared(p) < 0.003 * 0.003) { points[0].t = time; return; }
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
      const fade = Math.pow(1 - age, 1.8) * strength;
      color.copy(hot).lerp(gold, Math.min(1, age * 2.2)).lerp(deep, Math.max(0, age * 1.6 - 0.6));
      for (let s = 0; s < 2; s++) {
        const v = j * 2 + s;
        a.toArray(positions, v * 3); dir.toArray(tangents, v * 3);
        shades.set([color.r, color.g, color.b, fade], v * 4);
        widths[v] = 0.09 * (1 - age * 0.6);
      }
    }
    for (const name of ['position', 'normal', 'shade', 'width']) geo.attributes[name].needsUpdate = true;
    geo.setDrawRange(0, (count - 1) * 6);
  }
  function reset() { used = 0; geo.setDrawRange(0, 0); }
  return { update, reset };
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
    phase: i * 1.57, speed: 5.5 + (i % 4) * 1.3, radius: 0.1 + (i % 4) * 0.025, tilt: (i % 3 - 1) * 0.6,
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
          widths[v] = 0.03 * (1 - t * 0.7) * (0.7 + 0.3 * strength);
        }
      }
    }
    for (const name of ['position', 'normal', 'shade', 'width']) geo.attributes[name].needsUpdate = true;
  }
  return { update, orbits, hide() { mesh.visible = false; } };
}

export function createEnergyStreaks(scene) {
  const texture = glowTexture();
  const veil = createVeil(scene);
  const trails = [createHandTrail(scene), createHandTrail(scene)];
  const orbits = [createHandOrbits(scene, 6), createHandOrbits(scene, 6)];
  const sparkles = createSparkles(scene, 400);
  const p = new THREE.Vector3(), v = new THREE.Vector3();
  let flareRate = 0;
  // Each hand: a tight white-gold core and a wide warm halo.
  const glows = [0, 1].map(() => {
    const make = (hex) => {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, color: hex, transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      sprite.visible = false;
      scene.add(sprite);
      return sprite;
    };
    return { core: make(0xfff0d0), halo: make(0xff8a2a) };
  });
  const light = new THREE.PointLight(0xffa040, 0, 3, 2);
  scene.add(light);
  let strength = 0;

  function update(active, power, palms, head, facing, now, dt) {
    strength = THREE.MathUtils.lerp(strength, active ? 0.55 + 0.45 * power : 0, 1 - Math.exp(-dt * (active ? 6 : 4)));
    veil.update(head, now, strength * 1.6);
    for (let side = 0; side < 2; side++) {
      trails[side].update(active, palms[side], now, strength);
      orbits[side].update(palms[side], palms[1 - side], now, dt, strength);
      const pulse = 1 + 0.12 * Math.sin(now * 9 + side * 2);
      const { core, halo } = glows[side];
      core.visible = halo.visible = strength > 0.01;
      core.position.copy(palms[side]); halo.position.copy(palms[side]);
      core.scale.setScalar(0.1 * pulse * (0.7 + 0.3 * power));
      halo.scale.setScalar(0.45 * pulse * (0.7 + 0.5 * power));
      core.material.opacity = strength;
      halo.material.opacity = strength * 0.55;
    }
    // Big flashing star flares out around the body.
    if (active) {
      flareRate += dt * (35 + power * 45);
      while (flareRate >= 1) {
        flareRate--;
        const angle = Math.random() * Math.PI * 2, radius = 0.5 + Math.random() * 0.7;
        p.set(head.x + Math.cos(angle) * radius, 0.2 + Math.random() * (head.y + 0.2), head.z + Math.sin(angle) * radius);
        v.set(0, 0.08, 0);
        sparkles.emit(p, v, 0.6 + Math.random() * 0.5, 0.14 + Math.random() * 0.14, 8 + Math.random() * 8);
      }
    }
    sparkles.update(dt, now);
    light.position.addVectors(palms[0], palms[1]).multiplyScalar(0.5);
    light.intensity = strength * 2.5;
  }

  function release() {}
  function reset() {
    strength = 0; veil.hide(); light.intensity = 0;
    for (const t of trails) t.reset();
    for (const o of orbits) o.hide();
    sparkles.reset(); flareRate = 0;
    for (const g of glows) g.core.visible = g.halo.visible = false;
  }
  return { update, release, reset };
}
