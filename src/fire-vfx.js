import * as THREE from 'three';

// Particle fire: every flame, puff of smoke and spark is a camera-facing
// billboard with its own motion and colour-over-life. Many overlapping additive
// flames build the white-hot centre naturally instead of painting it on a mesh.
const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);

const FIRE = [[0, 0xffe2a0, 0], [0.06, 0xffc15a, 0.9], [0.22, 0xff8420, 0.85],
  [0.45, 0xe8420a, 0.6], [0.72, 0x7a1203, 0.28], [1, 0x200500, 0]];
const SMOKE = [[0, 0x2e2926, 0], [0.25, 0x28231f, 0.32], [0.6, 0x1e1b19, 0.2], [1, 0x151312, 0]];
const SPARK = [[0, 0xffffff, 1], [0.3, 0xffd27a, 1], [0.7, 0xff7a1a, 0.8], [1, 0xa02000, 0]];

function rampTable(stops) {
  const table = new Float32Array(64 * 4);
  const a = new THREE.Color(), b = new THREE.Color();
  for (let i = 0; i < 64; i++) {
    const t = i / 63;
    let k = 0;
    while (k < stops.length - 2 && t > stops[k + 1][0]) k++;
    const [t0, c0, a0] = stops[k], [t1, c1, a1] = stops[k + 1];
    const f = THREE.MathUtils.clamp((t - t0) / (t1 - t0), 0, 1);
    a.setHex(c0).lerp(b.setHex(c1), f);
    table.set([a.r, a.g, a.b, a0 + (a1 - a0) * f], i * 4);
  }
  return table;
}

// 2x2 atlas of ragged noise flames: soft centre, torn wispy edges and dark
// gaps, so overlapping flames read as fire rather than round blobs.
function flameTexture() {
  const size = 256, cell = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(size, size);
  const lattice = new Float32Array(64 * 64);
  let seed = 11;
  for (let i = 0; i < lattice.length; i++) lattice[i] = (seed = seed * 16807 % 2147483647) / 2147483647;
  const smooth = t => t * t * (3 - 2 * t);
  function noise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = smooth(x - xi), yf = smooth(y - yi);
    const at = (i, j) => lattice[((j & 63) * 64) + (i & 63)];
    const top = at(xi, yi) + (at(xi + 1, yi) - at(xi, yi)) * xf;
    const bottom = at(xi, yi + 1) + (at(xi + 1, yi + 1) - at(xi, yi + 1)) * xf;
    return top + (bottom - top) * yf;
  }
  const fbm = (x, y) => noise(x, y) * 0.55 + noise(x * 2.1, y * 2.1) * 0.3 + noise(x * 4.3, y * 4.3) * 0.15;
  for (let c = 0; c < 4; c++) {
    const ox = (c % 2) * cell, oy = Math.floor(c / 2) * cell;
    for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) {
      const u = x / cell * 2 - 1, v = y / cell * 2 - 1;
      const r = Math.hypot(u, v * 0.85);
      const n = fbm(x / 14 + c * 9, y / 14 + c * 5);
      const density = 1.15 - r * 1.25 + (n - 0.5) * 1.3;
      const edge = Math.max(0, 1 - Math.pow(Math.max(0, r - 0.55) / 0.45, 2));
      const alpha = Math.max(0, Math.min(1, density * 1.4)) * edge;
      const i = ((oy + y) * size + ox + x) * 4;
      image.data[i] = image.data[i + 1] = image.data[i + 2] = 255;
      image.data[i + 3] = alpha * alpha * 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return new THREE.CanvasTexture(canvas);
}

function glowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.2, 'rgba(255,255,255,.6)');
  gradient.addColorStop(0.5, 'rgba(255,255,255,.15)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

function createPool(scene, { count, map, ramp, blending = THREE.AdditiveBlending, stretch = false, order = 0, occlusion = 0 }) {
  const quad = new THREE.PlaneGeometry(1, 1);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = quad.index;
  geometry.setAttribute('position', quad.attributes.position);
  geometry.setAttribute('uv', quad.attributes.uv);
  const place = new Float32Array(count * 4), tint = new Float32Array(count * 4);
  const spin = new Float32Array(count * 2), motion = new Float32Array(count * 3);
  const attribute = (array, size) => new THREE.InstancedBufferAttribute(array, size).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('place', attribute(place, 4));
  geometry.setAttribute('tint', attribute(tint, 4));
  geometry.setAttribute('spin', attribute(spin, 2));
  geometry.setAttribute('motion', attribute(motion, 3));
  geometry.instanceCount = count;
  const material = new THREE.ShaderMaterial({
    uniforms: { map: { value: map }, occlusion: { value: occlusion } },
    defines: stretch ? { STRETCH: '' } : {},
    transparent: true, depthWrite: false,
    // Occluding fire is premultiplied: it adds light and also dims what is
    // behind it, so flames stay saturated against a bright room.
    ...(occlusion ? { blending: THREE.CustomBlending, blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor, premultipliedAlpha: true } : { blending }),
    vertexShader: `
      attribute vec4 place; attribute vec4 tint; attribute vec2 spin; attribute vec3 motion;
      varying vec2 vUv; varying vec4 vTint;
      void main() {
        vTint = tint;
        vec4 view = viewMatrix * vec4(place.xyz, 1.);
        vec2 corner = position.xy;
        #ifdef STRETCH
          // Sparks streak along their screen-space velocity.
          vec2 dir = (viewMatrix * vec4(motion, 0.)).xy;
          float speed = length(dir);
          vec2 along = speed > 1e-4 ? dir / speed : vec2(0., 1.);
          vec2 across = vec2(-along.y, along.x);
          view.xy += across * corner.x * place.w + along * corner.y * (place.w + speed * .03);
          vUv = uv;
        #else
          float c = cos(spin.x), s = sin(spin.x);
          view.xy += mat2(c, s, -s, c) * corner * place.w;
          vUv = (uv + vec2(mod(spin.y, 2.), floor(spin.y / 2.))) * .5;
        #endif
        gl_Position = projectionMatrix * view;
      }`,
    fragmentShader: `
      uniform sampler2D map; uniform float occlusion; varying vec2 vUv; varying vec4 vTint;
      void main() {
        float alpha = texture2D(map, vUv).a * vTint.a;
        if (alpha < .003) discard;
        gl_FragColor = vec4(vTint.rgb, alpha);
        #include <colorspace_fragment>
        if (occlusion > 0.) gl_FragColor = vec4(gl_FragColor.rgb * alpha, alpha * occlusion);
      }`
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = order;
  scene.add(mesh);

  const table = rampTable(ramp);
  const pos = new Float32Array(count * 3), vel = new Float32Array(count * 3);
  const life = new Float32Array(count), duration = new Float32Array(count);
  const size0 = new Float32Array(count), size1 = new Float32Array(count);
  const gain = new Float32Array(count), drag = new Float32Array(count), lift = new Float32Array(count);
  const spinRate = new Float32Array(count);
  let cursor = 0;

  function emit(p, v, lifetime, startSize, endSize, strength = 1, damping = 1, buoyancy = 0) {
    const i = cursor;
    cursor = (cursor + 1) % count;
    pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
    vel[i * 3] = v.x; vel[i * 3 + 1] = v.y; vel[i * 3 + 2] = v.z;
    life[i] = duration[i] = lifetime;
    size0[i] = startSize; size1[i] = endSize;
    gain[i] = strength; drag[i] = damping; lift[i] = buoyancy;
    spin[i * 2] = Math.random() * TAU;
    spin[i * 2 + 1] = Math.floor(Math.random() * 4);
    spinRate[i] = (Math.random() - 0.5) * 2.5;
  }

  function update(dt) {
    for (let i = 0; i < count; i++) {
      if (life[i] <= 0) { place[i * 4 + 3] = 0; tint[i * 4 + 3] = 0; continue; }
      life[i] -= dt;
      if (life[i] <= 0) { place[i * 4 + 3] = 0; tint[i * 4 + 3] = 0; continue; }
      const t = 1 - life[i] / duration[i];
      const damping = Math.exp(-drag[i] * dt);
      const j = i * 3;
      vel[j] *= damping; vel[j + 1] = vel[j + 1] * damping + lift[i] * dt; vel[j + 2] *= damping;
      pos[j] += vel[j] * dt; pos[j + 1] += vel[j + 1] * dt; pos[j + 2] += vel[j + 2] * dt;
      place[i * 4] = pos[j]; place[i * 4 + 1] = pos[j + 1]; place[i * 4 + 2] = pos[j + 2];
      place[i * 4 + 3] = size0[i] + (size1[i] - size0[i]) * Math.sqrt(t);
      const k = Math.min(63, Math.floor(t * 63)) * 4;
      tint[i * 4] = table[k]; tint[i * 4 + 1] = table[k + 1]; tint[i * 4 + 2] = table[k + 2];
      tint[i * 4 + 3] = table[k + 3] * gain[i];
      spin[i * 2] += spinRate[i] * dt;
      motion[j] = vel[j]; motion[j + 1] = vel[j + 1]; motion[j + 2] = vel[j + 2];
    }
    for (const name of ['place', 'tint', 'spin', 'motion']) geometry.attributes[name].needsUpdate = true;
  }

  function reset() { life.fill(0); place.fill(0); tint.fill(0); geometry.attributes.place.needsUpdate = true; }
  return { emit, update, reset };
}

export function createFireVFX(scene) {
  const puff = flameTexture(), glowMap = glowTexture();
  const smoke = createPool(scene, { count: 360, map: puff, ramp: SMOKE, blending: THREE.NormalBlending, order: 1 });
  const fire = createPool(scene, { count: 1800, map: puff, ramp: FIRE, order: 2, occlusion: 0.45 });
  const sparks = createPool(scene, { count: 420, map: glowMap, ramp: SPARK, stretch: true, order: 3 });

  // Soft halos drawn fresh each frame for the charging ball, shots and flashes.
  const glows = Array.from({ length: 16 }, () => {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowMap, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    sprite.visible = false;
    sprite.renderOrder = 4;
    scene.add(sprite);
    return sprite;
  });
  let glowCursor = 0;
  function glow(position, size, hex, opacity) {
    const sprite = glows[glowCursor++];
    if (!sprite) return;
    sprite.visible = true;
    sprite.position.copy(position);
    sprite.scale.set(size, size, 1);
    sprite.material.color.setHex(hex);
    sprite.material.opacity = opacity;
  }

  const flashes = Array.from({ length: 3 }, () => {
    const light = new THREE.PointLight(0xff7a22, 0, 9, 2);
    scene.add(light);
    return { light, life: 0, power: 0, position: new THREE.Vector3() };
  });

  const p = new THREE.Vector3(), v = new THREE.Vector3(), dir = new THREE.Vector3(), swirl = new THREE.Vector3();
  let bodyEmission = 0, feedEmission = 0, emberEmission = 0, time = 0;
  const flicker = (offset = 0) => 0.86 + 0.14 * Math.sin(time * 23 + offset) * Math.sin(time * 7.3 + offset * 2);

  function begin() {
    for (const sprite of glows) sprite.visible = false;
    glowCursor = 0;
  }

  function charge(center, palms, radius, power, motion, dt) {
    glow(center, radius * (6 + power * 2) * flicker(), 0xff4a0c, 0.22 + power * 0.18);
    glow(center, radius * 1.5 * flicker(1), 0xffd890, 0.7);

    // The ball itself: flames born inside it that swirl and lick upward.
    bodyEmission += dt * (70 + power * 110 + motion * 40);
    while (bodyEmission >= 1) {
      bodyEmission--;
      p.randomDirection().multiplyScalar(Math.cbrt(Math.random()) * radius * 0.45).add(center);
      swirl.subVectors(p, center).cross(UP).multiplyScalar(3 + motion * 5);
      v.randomDirection().multiplyScalar(0.06).add(swirl);
      v.y += 0.08 + power * 0.12;
      fire.emit(p, v, 0.2 + Math.random() * 0.22, radius * (1.1 + Math.random() * 0.5), radius * 0.3, 0.55, 3, 0.8 + power * 0.6);
    }

    // Fire pulled off each palm into the ball; stronger the harder you pump.
    feedEmission += dt * (25 + motion * 180);
    while (feedEmission >= 1) {
      feedEmission--;
      const palm = palms[Math.random() < 0.5 ? 0 : 1];
      const lifetime = 0.16 + Math.random() * 0.1;
      p.randomDirection().multiplyScalar(0.012).add(palm);
      v.subVectors(center, p).divideScalar(lifetime);
      v.x += (Math.random() - 0.5) * 0.12; v.y += (Math.random() - 0.5) * 0.12; v.z += (Math.random() - 0.5) * 0.12;
      sparks.emit(p, v, lifetime, 0.004, 0.003, 0.9, 0, 0);
    }

    emberEmission += dt * (5 + power * 22);
    while (emberEmission >= 1) {
      emberEmission--;
      p.randomDirection().multiplyScalar(radius * 0.8).add(center);
      v.randomDirection().multiplyScalar(0.35);
      v.y += 0.5;
      sparks.emit(p, v, 0.45 + Math.random() * 0.45, 0.0035, 0.002, 1, 1.2, 0.4);
    }
  }

  function release(center, direction, power) {
    for (let i = 0; i < 36; i++) {
      v.randomDirection().multiplyScalar(0.7).addScaledVector(direction, 1.5 + Math.random() * 1.5);
      fire.emit(center, v, 0.18 + Math.random() * 0.16, 0.05, 0.12 + power * 0.08, 0.6, 5, 0.8);
    }
    for (let i = 0; i < 14; i++) {
      v.randomDirection().multiplyScalar(1.2).addScaledVector(direction, 2.5);
      sparks.emit(center, v, 0.25 + Math.random() * 0.2, 0.003, 0.002, 1, 2, -1);
    }
  }

  // Trail is spawned by distance travelled, so it stays continuous at any
  // shot speed or headset refresh rate.
  function projectile(state, from, to, velocity, radius, power) {
    glow(to, radius * 6 * flicker(3), 0xff4a0c, 0.45);
    glow(to, radius * 1.6 * flicker(4), 0xffe2a8, 0.9);
    const distance = from.distanceTo(to);
    state.fire = (state.fire || 0) + distance / 0.016;
    while (state.fire >= 1) {
      state.fire--;
      p.lerpVectors(from, to, Math.random()).add(v.randomDirection().multiplyScalar(radius * 0.35));
      v.randomDirection().multiplyScalar(0.15 + power * 0.2).addScaledVector(velocity, 0.03);
      v.y += 0.1;
      fire.emit(p, v, 0.2 + Math.random() * 0.22, radius * (1.7 + Math.random() * 0.6), radius * (3 + power * 2), 0.42, 3, 1.4);
    }
    state.smoke = (state.smoke || 0) + distance / 0.07;
    while (state.smoke >= 1) {
      state.smoke--;
      p.lerpVectors(from, to, Math.random());
      v.randomDirection().multiplyScalar(0.1);
      smoke.emit(p, v, 0.7 + Math.random() * 0.4, radius * 1.2, radius * (3.2 + power * 1.5), 0.4, 2, 0.45);
    }
    state.sparks = (state.sparks || 0) + distance / 0.1;
    while (state.sparks >= 1) {
      state.sparks--;
      p.lerpVectors(from, to, Math.random());
      v.randomDirection().multiplyScalar(1.3).addScaledVector(velocity, 0.05);
      sparks.emit(p, v, 0.25 + Math.random() * 0.3, 0.003, 0.0015, 1, 1.5, -3);
    }
  }

  function impact(point, normal, power) {
    const scale = 1.6 + power * 1.2;
    const outward = () => {
      dir.randomDirection();
      if (dir.dot(normal) < 0) dir.reflect(normal);
      return dir.addScaledVector(normal, 0.5).normalize();
    };
    // Dense bright core that blooms in place.
    for (let i = 0; i < 18; i++) {
      p.copy(point).addScaledVector(normal, 0.08).add(v.randomDirection().multiplyScalar(0.06 * scale));
      v.copy(outward()).multiplyScalar(0.4);
      fire.emit(p, v, 0.3 + Math.random() * 0.25, 0.2 * scale, 0.5 * scale, 0.75, 3, 1);
    }
    // Rolling fireball that throws out, slows and rises.
    for (let i = 0; i < 80 + power * 80; i++) {
      p.copy(point).addScaledVector(normal, 0.05);
      v.copy(outward()).multiplyScalar((1.5 + Math.random() * 4) * (1 + power * 0.6));
      fire.emit(p, v, 0.5 + Math.random() * 0.6, 0.1 * scale, (0.3 + Math.random() * 0.25) * scale, 0.6, 4.5, 1.8);
    }
    for (let i = 0; i < 26 + power * 20; i++) {
      p.copy(point).addScaledVector(normal, 0.12);
      v.copy(outward()).multiplyScalar((0.4 + Math.random() * 1.3) * (1 + power * 0.4));
      smoke.emit(p, v, 1.6 + Math.random() * 1.2, 0.18 * scale, (0.6 + Math.random() * 0.4) * scale, 0.85, 2.2, 0.55);
    }
    for (let i = 0; i < 45 + power * 55; i++) {
      v.copy(outward()).multiplyScalar(2.5 + Math.random() * 5);
      sparks.emit(point, v, 0.4 + Math.random() * 0.6, 0.004, 0.002, 1, 0.8, -6);
    }
    const flash = flashes.find(f => f.life <= 0) || flashes[0];
    flash.life = 0.6;
    flash.power = power;
    flash.position.copy(point).addScaledVector(normal, 0.3);
    flash.light.position.copy(flash.position);
  }

  function update(dt, now) {
    time = now;
    for (const flash of flashes) {
      flash.life = Math.max(0, flash.life - dt);
      const f = flash.life / 0.6;
      flash.light.intensity = f * f * (25 + flash.power * 40);
      if (f > 0.5) glow(flash.position, (1.2 + flash.power) * (1.6 - f), 0xffc070, (f - 0.5) * 1.8);
    }
    smoke.update(dt); fire.update(dt); sparks.update(dt);
  }

  function reset() {
    smoke.reset(); fire.reset(); sparks.reset(); begin();
    bodyEmission = feedEmission = emberEmission = 0;
    for (const flash of flashes) { flash.life = 0; flash.light.intensity = 0; }
  }

  return { begin, charge, release, projectile, impact, update, reset, flicker };
}
