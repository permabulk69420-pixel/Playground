import * as THREE from 'three';

// Magical charging aura: glowing light trails that follow each hand's actual
// movement, shedding twinkling star sparkles, plus flashing glints that swirl
// around the caster. Trails are smoothed through the recorded hand path.
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
        widths[v] = 0.034 * (1 - age * 0.75) * (0.7 + 0.3 * strength);
      }
    }
    for (const name of ['position', 'normal', 'shade', 'width']) geo.attributes[name].needsUpdate = true;
    geo.setDrawRange(0, (count - 1) * 6);
  }
  function reset() { used = 0; geo.setDrawRange(0, 0); }
  return { update, reset };
}


// Glowing rune circle that spins at a palm, facing the other hand.
function createHandCircle(scene) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, strength: { value: 0 }, spin: { value: 1 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: `
      uniform float time; uniform float strength; uniform float spin; varying vec2 vUv;
      float band(float r, float at, float w){ return exp(-pow((r - at) / w, 2.)); }
      void main(){
        vec2 p = vUv * 2. - 1.; float r = length(p); float a = atan(p.y, p.x);
        float outer = band(r, .92, .018) + band(r, .8, .012);
        float inner = band(r, .5, .015);
        // Rune ticks between the outer rings, rotating one way; spokes the other.
        float ticks = step(.55, fract((a + time * .8 * spin) / 6.2832 * 24.)) * smoothstep(.83, .845, r) * (1. - smoothstep(.885, .9, r));
        float spokes = pow(max(0., cos((a - time * 1.3 * spin) * 3.)), 40.) * smoothstep(.5, .55, r) * (1. - smoothstep(.76, .8, r));
        float glow = exp(-r * r * 6.) * .25;
        float a1 = (outer + inner * .8 + ticks * .9 + spokes * .7 + glow) * strength;
        if (a1 < .004) discard;
        vec3 color = mix(vec3(1., .62, .2), vec3(1., .95, .8), clamp(outer + ticks, 0., 1.));
        gl_FragColor = vec4(color, a1);
        #include <colorspace_fragment>
      }`
  }));
  mesh.name = 'aura-hand-circle';
  mesh.frustumCulled = false;
  mesh.visible = false;
  scene.add(mesh);
  const facing = new THREE.Vector3(), z = new THREE.Vector3(0, 0, 1);
  function update(palm, other, time, strength, power, sign) {
    mesh.visible = strength > 0.01;
    if (!mesh.visible) return;
    facing.subVectors(other, palm);
    if (facing.lengthSq() < 1e-6) facing.set(1, 0, 0);
    mesh.position.copy(palm).addScaledVector(facing.normalize(), -0.03);
    mesh.quaternion.setFromUnitVectors(z, facing);
    mesh.scale.setScalar((0.14 + power * 0.12) * (0.6 + 0.4 * strength));
    mesh.material.uniforms.time.value = time;
    mesh.material.uniforms.strength.value = strength * 1.2;
    mesh.material.uniforms.spin.value = sign;
  }
  return { update, hide() { mesh.visible = false; } };
}

export function createEnergyStreaks(scene) {
  const trails = [createHandTrail(scene), createHandTrail(scene)];
  const circles = [createHandCircle(scene), createHandCircle(scene)];
  let power = 0;
  const sparkles = createSparkles(scene, 700);
  const previous = [new THREE.Vector3(), new THREE.Vector3()];
  const p = new THREE.Vector3(), v = new THREE.Vector3(), move = new THREE.Vector3();
  let strength = 0, handRate = 0, auraRate = 0, started = false;

  function update(active, charge, palms, head, facing, now, dt) {
    strength = THREE.MathUtils.lerp(strength, active ? 0.55 + 0.45 * charge : 0, 1 - Math.exp(-dt * (active ? 10 : 4)));
    if (active) power = charge;
    for (let side = 0; side < 2; side++) {
      trails[side].update(active, palms[side], now, strength);
      circles[side].update(palms[side], palms[1 - side], now, strength, power, side ? -1 : 1);
    }
    if (active && dt > 0) {
      // Sparkles shed off the hands, more the faster they move.
      for (let side = 0; side < 2; side++) {
        move.subVectors(palms[side], previous[side]);
        const speed = started ? move.length() / dt : 0;
        handRate += dt * (14 + Math.min(speed, 3) * 55) * (0.6 + power * 0.6);
        while (handRate >= 1) {
          handRate--;
          p.copy(previous[side]).lerp(palms[side], Math.random()).add(v.randomDirection().multiplyScalar(0.02));
          v.randomDirection().multiplyScalar(0.08 + Math.random() * 0.12);
          if (started) v.addScaledVector(move, -0.03 / dt);
          sparkles.emit(p, v, 0.5 + Math.random() * 0.6, 0.018 + Math.random() * 0.025, 8 + Math.random() * 14);
        }
      }
      // Flashing glints swirling around the upper body and arms.
      auraRate += dt * (30 + power * 70);
      while (auraRate >= 1) {
        auraRate--;
        const angle = Math.random() * Math.PI * 2, radius = 0.3 + Math.random() * 0.45;
        p.set(head.x + Math.cos(angle) * radius, head.y - 0.2 - Math.random() * 0.9, head.z + Math.sin(angle) * radius);
        v.set(-Math.sin(angle) * 0.12, 0.05 + Math.random() * 0.1, Math.cos(angle) * 0.12);
        sparkles.emit(p, v, 0.7 + Math.random() * 0.8, 0.02 + Math.random() * 0.035 * (0.5 + power), 5 + Math.random() * 10);
      }
    }
    previous[0].copy(palms[0]); previous[1].copy(palms[1]); started = active;
    sparkles.update(dt, now);
  }

  // Firing throws a burst of sparkles off both hands.
  function release(power) {
    for (let side = 0; side < 2; side++) {
      for (let i = 0; i < 40; i++) {
        v.randomDirection().multiplyScalar(0.6 + Math.random() * (0.8 + power));
        sparkles.emit(previous[side], v, 0.4 + Math.random() * 0.5, 0.025 + Math.random() * 0.03, 12 + Math.random() * 10);
      }
    }
  }

  function reset() {
    strength = 0; handRate = auraRate = 0; started = false;
    trails[0].reset(); trails[1].reset(); circles[0].hide(); circles[1].hide(); sparkles.reset();
  }
  return { update, release, reset };
}
