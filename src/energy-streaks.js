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
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.44, 1, 64, 1, true), new THREE.ShaderMaterial({
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
        float a = (edge * (.25 + n * .9) + streaks * .35 * (.4 + edge)) * vertical * strength;
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
      const height = Math.max(0.8, head.y - 0.1);
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
        widths[v] = 0.06 * (1 - age * 0.6);
      }
    }
    for (const name of ['position', 'normal', 'shade', 'width']) geo.attributes[name].needsUpdate = true;
    geo.setDrawRange(0, (count - 1) * 6);
  }
  function reset() { used = 0; geo.setDrawRange(0, 0); }
  return { update, reset };
}

export function createEnergyStreaks(scene) {
  const texture = glowTexture();
  const veil = createVeil(scene);
  const trails = [createHandTrail(scene), createHandTrail(scene)];
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
    veil.update(head, now, strength * 0.9);
    for (let side = 0; side < 2; side++) {
      trails[side].update(active, palms[side], now, strength);
      const pulse = 1 + 0.12 * Math.sin(now * 9 + side * 2);
      const { core, halo } = glows[side];
      core.visible = halo.visible = strength > 0.01;
      core.position.copy(palms[side]); halo.position.copy(palms[side]);
      core.scale.setScalar(0.07 * pulse * (0.7 + 0.3 * power));
      halo.scale.setScalar(0.28 * pulse * (0.7 + 0.5 * power));
      core.material.opacity = strength;
      halo.material.opacity = strength * 0.55;
    }
    light.position.addVectors(palms[0], palms[1]).multiplyScalar(0.5);
    light.intensity = strength * 2.5;
  }

  function release() {}
  function reset() {
    strength = 0; veil.hide(); light.intensity = 0;
    for (const t of trails) t.reset();
    for (const g of glows) g.core.visible = g.halo.visible = false;
  }
  return { update, release, reset };
}
