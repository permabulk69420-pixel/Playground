import * as THREE from 'three';

// Glowing energy ribbons that orbit the caster while charging. Every trail is
// sampled from the emitter's own path function rather than recorded history,
// so the curves stay perfectly smooth at any frame rate.
export function createEnergyStreaks(scene) {
  const bodyCount = 22, palmCount = 10, count = bodyCount + palmCount, samples = 48;
  const up = new THREE.Vector3(0, 1, 0), right = new THREE.Vector3(), forward = new THREE.Vector3();
  const axis = new THREE.Vector3(), cross = new THREE.Vector3(), other = new THREE.Vector3();
  const point = new THREE.Vector3(), next = new THREE.Vector3(), dir = new THREE.Vector3();
  const gold = new THREE.Color(0xffc15e), ember = new THREE.Color(0xff5a14), hot = new THREE.Color(0xfff1c8);
  let strength = 0, storedPower = 0, burst = 0, time = 0;
  const emitters = Array.from({ length: count }, (_, i) => ({
    phase: i * 2.399963, speed: 1.3 + (i * 0.317 % 1) * 0.8, spin: i % 3 === 0 ? -1 : 1,
    radius: 1.0 + (i * 0.731 % 1) * 0.9, tilt: (i * 0.529 % 1 - 0.5) * 0.9,
    rise: i * 0.618 % 1, wobble: 0.08 + (i * 0.413 % 1) * 0.1
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
      out.y = head.y - 1.45 + climb * 2.1 + Math.sin(a + i) * e.wobble + Math.cos(a) * e.tilt * 0.3;
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
      const baseWidth = (palm ? 0.012 : 0.045) * (0.65 + 0.35 * storedPower);
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
          dummy.scale.setScalar((palm ? 0.007 : 0.022) * strength * visible);
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
  return { update, release, reset };
}
