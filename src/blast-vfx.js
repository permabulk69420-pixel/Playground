import * as THREE from 'three';
import { createEnergyStreaks } from './energy-streaks.js';

// Value noise shared by the plasma, fire sheets and shock fronts. The effects
// use actual 3D surfaces plus per-eye billboards; no screen-space bloom pass.
const NOISE = `
float hash(vec3 p) { p=fract(p*.3183099+vec3(.1,.2,.3)); p*=17.; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float noise3(vec3 p) {
 vec3 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
 return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
 mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
}
float fbm(vec3 p) { return noise3(p)*.57+noise3(p*2.03+3.7)*.28+noise3(p*4.11-2.1)*.15; }
`;
const sphere = new THREE.SphereGeometry(1, 48, 32);
const TAU = Math.PI * 2;
const up = new THREE.Vector3(0, 1, 0);

export function createPlasmaOrb(texture) {
  const group = new THREE.Group();
  const uniforms = { time: { value: 0 }, power: { value: 0 } };
  const core = new THREE.Mesh(sphere, new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `${NOISE}
      uniform float time; varying vec3 vP; varying vec3 vN; varying vec3 vV;
      void main() {
        vP=position;
        float n=fbm(position*3.+vec3(0,-time*1.9,time*.4));
        vec3 p=position*(.86+n*.18);
        vec4 view=modelViewMatrix*vec4(p,1.);
        vN=normalize(normalMatrix*normal); vV=-view.xyz;
        gl_Position=projectionMatrix*view;
      }`,
    fragmentShader: `${NOISE}
      uniform float time; uniform float power; varying vec3 vP; varying vec3 vN; varying vec3 vV;
      void main() {
        vec3 flow=vP*3.2+vec3(time*.35,-time*1.9,time*.25);
        float warp=fbm(flow);
        float n=fbm(flow*1.6+vec3(warp*3.,-warp*2.5,warp));
        float facing=abs(dot(normalize(vN),normalize(vV)));
        // Fireballs read hottest through the middle and cool toward the limb;
        // noise carves darker roiling cells out of that gradient.
        float heat=clamp(facing*.8+(n-.5)*1.2,0.,1.);
        vec3 color=mix(vec3(.35,.02,.002),vec3(2.2,.42,.03),smoothstep(.05,.5,heat));
        color=mix(color,vec3(2.6,1.15,.2),smoothstep(.5,.85,heat));
        color=mix(color,vec3(3.,2.3,1.1),smoothstep(.88,1.,heat));
        float fissure=pow(1.-abs(warp*2.-1.),10.);
        color+=fissure*vec3(1.6,.7,.1)*(1.-heat*.5);
        gl_FragColor=vec4(color*(.7+power*.25),1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`
  }));
  group.add(core);
  const shells = [];
  for (let layer = 0; layer < 2; layer++) {
    const shell = new THREE.Mesh(sphere, new THREE.ShaderMaterial({
      uniforms: { ...uniforms, layer: { value: layer } }, transparent: true,
      depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide,
      vertexShader: `${NOISE}
        uniform float time; uniform float layer; varying vec3 vP; varying vec3 vN; varying vec3 vV;
        void main() {
          vP=position;
          float n=fbm(position*3.2+vec3(time*.5,-time*3.2,layer*9.));
          float lift=max(position.y,0.)*.35;
          float spikes=pow(n,2.)*(.55+lift);
          vec3 p=position*(1.03+layer*.2+spikes);
          p.y+=pow(n,3.)*lift*.9;
          vec4 view=modelViewMatrix*vec4(p,1.); vV=-view.xyz; vN=normalize(normalMatrix*normal);
          gl_Position=projectionMatrix*view;
        }`,
      fragmentShader: `${NOISE}
        uniform float time; uniform float power; uniform float layer;
        varying vec3 vP; varying vec3 vN; varying vec3 vV;
        void main() {
          vec3 p=vP*5.+vec3(time*.6,-time*2.8,layer*7.);
          float n=fbm(p+fbm(p*.8)*2.);
          float filaments=pow(1.-abs(n*2.-1.),18.);
          float facing=abs(dot(normalize(vN),normalize(vV)));
          float edge=smoothstep(0.,.2,facing);
          float alpha=(filaments*.35+smoothstep(.45,.8,n)*.3)*edge*(1.-layer*.4);
          if(alpha<.015)discard;
          vec3 color=mix(vec3(1.4,.12,.004),vec3(2.4,1.1,.2),filaments+smoothstep(.6,.9,n)*.5);
          gl_FragColor=vec4(color,alpha*(.75+power*.25));
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`
    }));
    group.add(shell); shells.push(shell);
  }
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    toneMapped: false, opacity: .45 }));
  glow.scale.set(6, 6, 1); group.add(glow);
  group.visible = false;
  return { group, uniforms, glow, shells };
}

export function createShockwave() {
  return new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: { progress: { value: 0 }, seed: { value: Math.random()*20 } },
    transparent: true, side: THREE.DoubleSide, depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: `varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `${NOISE}
      uniform float progress; uniform float seed; varying vec2 vUv;
      void main(){
        vec2 p=vUv*2.-1.; float r=length(p);
        float n=fbm(vec3(p*9.,seed+progress*3.));
        float front=exp(-pow((r-.76+(n-.5)*.07)/.045,2.));
        float wake=exp(-pow((r-.65)/.16,2.))*smoothstep(.36,.68,n)*.65;
        float a=(front+wake)*pow(1.-progress,1.2);
        if(a<.005)discard;
        gl_FragColor=vec4(mix(vec3(1.,.13,.012),vec3(2.,1.1,.38),front),a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`
  }));
}

// Camera-facing noise puffs. Fire is additive and cools from white-yellow to
// red as it ages; smoke is alpha-blended so it can darken the room behind it.
function makeParticlePool(scene, { count, smoke = false }) {
  const geometry = new THREE.PlaneGeometry(1, 1);
  const parameters = new Float32Array(count * 4);
  geometry.setAttribute('aLife', new THREE.InstancedBufferAttribute(parameters, 4).setUsage(THREE.DynamicDrawUsage));
  const fireColor = `
        float heat=clamp(density*1.1-age*.85+vLife.w*.25,0.,1.);
        vec3 color=mix(vec3(.55,.03,.003),vec3(2.,.36,.015),smoothstep(.05,.4,heat));
        color=mix(color,vec3(2.8,1.35,.3),smoothstep(.4,.8,heat));
        color=mix(color,vec3(3.2,2.4,1.2),smoothstep(.85,1.,heat));
        gl_FragColor=vec4(color,a);`;
  const smokeColor = `
        vec3 color=mix(vec3(.05,.045,.04),vec3(.16,.14,.13),n);
        gl_FragColor=vec4(color,a*.55);`;
  const material = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 } }, transparent: true, depthWrite: false,
    blending: smoke ? THREE.NormalBlending : THREE.AdditiveBlending,
    vertexShader: `
      attribute vec4 aLife; varying vec2 vUv; varying vec4 vLife;
      void main(){
        vLife=aLife; vUv=uv;
        vec4 center=modelViewMatrix*instanceMatrix*vec4(0.,0.,0.,1.);
        float size=length(instanceMatrix[0].xyz);
        float a=aLife.z; mat2 rot=mat2(cos(a),-sin(a),sin(a),cos(a));
        center.xy+=rot*position.xy*size;
        gl_Position=projectionMatrix*center;
      }`,
    fragmentShader: `${NOISE}
      uniform float time; varying vec2 vUv; varying vec4 vLife;
      void main(){
        vec2 p=vUv*2.-1.; float age=vLife.x; float seed=vLife.y;
        vec3 flow=vec3(p*2.6+vec2(0.,age*2.5),seed);
        float n=fbm(flow+vec3(0.,-time*1.2,0.)+fbm(flow*1.7)*.8);
        float density=1.-length(p)+(n-.5)*.9;
        float boundary=1.-smoothstep(.7,1.,length(p));
        float a=smoothstep(.0,.4,density)*boundary*smoothstep(0.,.08,age)*pow(1.-age,${smoke ? '1.1' : '1.6'})*vLife.w;
        if(a<.008)discard;
        ${smoke ? smokeColor : fireColor}
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`
  });
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.frustumCulled = false;
  // Smoke sits behind the flames it rises from.
  mesh.renderOrder = smoke ? 1 : 2;
  scene.add(mesh);
  const particles = Array.from({length:count},()=>({ life:0, duration:1, size:0, gain:1,
    p:new THREE.Vector3(), v:new THREE.Vector3(), seed:Math.random()*40, spin:0 }));
  const dummy = new THREE.Object3D();
  const buoyancy = smoke ? .35 : .9, drag = smoke ? 1.6 : 2.4, growth = smoke ? 2.2 : 1.1;
  let cursor = 0;
  function emit(p,v,size,life,gain=1) {
    const f=particles[cursor++%count]; f.p.copy(p); f.v.copy(v);
    f.size=size; f.life=f.duration=life; f.gain=gain; f.spin=(Math.random()-.5)*3;
  }
  function update(dt,time) {
    material.uniforms.time.value=time;
    for(let i=0;i<count;i++) {
      const f=particles[i]; f.life=Math.max(0,f.life-dt);
      const age=1-f.life/f.duration;
      if(f.life>0) { f.p.addScaledVector(f.v,dt); f.v.multiplyScalar(Math.exp(-dt*drag)); f.v.y+=dt*buoyancy; }
      dummy.position.copy(f.p); dummy.scale.setScalar(f.life>0?f.size*(.6+age*growth):0);
      dummy.updateMatrix(); mesh.setMatrixAt(i,dummy.matrix);
      parameters.set([age,f.seed,f.spin*age+f.seed,f.gain],i*4);
    }
    mesh.instanceMatrix.needsUpdate=true; geometry.attributes.aLife.needsUpdate=true;
  }
  function reset(){for(const f of particles)f.life=0;}
  return {emit,update,reset};
}

function makePalmStreams(scene) {
  const paths=12, segments=32, vertices=paths*(segments+1)*2;
  const positions=new Float32Array(vertices*3), tangents=new Float32Array(vertices*3);
  const uvs=new Float32Array(vertices*2), weights=new Float32Array(vertices);
  const indices=[];
  for(let path=0;path<paths;path++)for(let i=0;i<=segments;i++) {
    const at=(path*(segments+1)+i)*2;
    uvs.set([0,i/segments,1,i/segments],at*2);
    if(i<segments)indices.push(at,at+1,at+2,at+1,at+3,at+2);
  }
  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.BufferAttribute(positions,3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('normal',new THREE.BufferAttribute(tangents,3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('uv',new THREE.BufferAttribute(uvs,2));
  geo.setAttribute('width',new THREE.BufferAttribute(weights,1).setUsage(THREE.DynamicDrawUsage));
  geo.setIndex(indices);
  const uniforms={time:{value:0},power:{value:0},motion:{value:0}};
  const mesh=new THREE.Mesh(geo,new THREE.ShaderMaterial({uniforms,
    transparent:true,blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide,
    vertexShader:`
      attribute float width; varying vec2 vUv;
      void main(){
        vUv=uv;
        vec3 side=normalize(cross(normalize(cameraPosition-position),normal));
        vec3 p=position+side*(uv.x-.5)*width;
        gl_Position=projectionMatrix*viewMatrix*vec4(p,1.);
      }`,
    fragmentShader:`
      uniform float time; uniform float power; uniform float motion; varying vec2 vUv;
      void main(){
        float edge=abs(vUv.x*2.-1.);
        float core=exp(-edge*edge*36.);
        float halo=exp(-edge*edge*5.);
        float flow=pow(.5+.5*sin(vUv.y*36.-time*(18.+motion*26.)),5.);
        float fade=smoothstep(0.,.09,vUv.y)*(1.-smoothstep(.92,1.,vUv.y));
        vec3 color=mix(vec3(1.2,.12,.006),vec3(2.6,1.9,.75),core);
        float alpha=(core*.9+halo*.2)*(0.4+flow*.6)*fade*(.55+motion*.45);
        gl_FragColor=vec4(color,alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`
  }));
  mesh.frustumCulled=false; mesh.visible=false; scene.add(mesh);
  const axis=new THREE.Vector3(), tangent=new THREE.Vector3(), bitangent=new THREE.Vector3();
  const p=new THREE.Vector3(), next=new THREE.Vector3(), dir=new THREE.Vector3();
  function update(active,palms,center,power,motion,time) {
    mesh.visible=active;if(!active)return;
    uniforms.time.value=time;uniforms.power.value=power;uniforms.motion.value=motion;
    for(let path=0;path<paths;path++) {
      const start=palms[path%2];
      axis.subVectors(center,start).normalize();tangent.crossVectors(axis,up);
      if(tangent.lengthSq()<.001)tangent.set(1,0,0);tangent.normalize();bitangent.crossVectors(axis,tangent);
      const phase=path*2.39996+time*(path%2?2.2:-2.2);
      function at(t,out){
        const radius=(.012+Math.sin(t*Math.PI)*(.05+power*.06))*(1.-t*.45);
        const angle=phase+t*(5.+power*5.);
        out.lerpVectors(start,center,t).addScaledVector(tangent,Math.cos(angle)*radius)
          .addScaledVector(bitangent,Math.sin(angle)*radius);
      }
      for(let i=0;i<=segments;i++) {
        const t=i/segments;at(t,p);at(t+.002,next);dir.subVectors(next,p).normalize();
        const vi=(path*(segments+1)+i)*2;
        for(let side=0;side<2;side++) {
          p.toArray(positions,(vi+side)*3);dir.toArray(tangents,(vi+side)*3);
          weights[vi+side]=(.014+power*.014)*(0.6+Math.sin(t*Math.PI)*.4);
        }
      }
    }
    geo.attributes.position.needsUpdate=true;geo.attributes.normal.needsUpdate=true;geo.attributes.width.needsUpdate=true;
  }
  return {update,reset(){mesh.visible=false;}};
}

export function createBlastAtmosphere(scene) {
  const fire=makeParticlePool(scene,{count:700}), smoke=makeParticlePool(scene,{count:260,smoke:true});
  const streams=makePalmStreams(scene), aura=createEnergyStreaks(scene);
  const lights=Array.from({length:2},()=>{const light=new THREE.PointLight(0xff7319,0,8,2);scene.add(light);return {light,life:0,power:0};});
  const p=new THREE.Vector3(),v=new THREE.Vector3(),n=new THREE.Vector3();
  let emission=0;
  function charge(active,palms,center,power,motion,time,dt,radius,head,forward) {
    aura.update(active,power,palms,head,forward,time,dt);
    streams.update(active,palms,center,power,motion,time);
    if(!active){emission=0;return;}
    // Flames lick off the top of the ball and curl upward.
    emission+=dt*(18+power*30+motion*20);
    while(emission>=1){
      emission--;n.randomDirection();n.y=Math.abs(n.y)*.7+.3;n.normalize();
      p.copy(center).addScaledVector(n,radius*.75);
      v.copy(n).multiplyScalar(.08+power*.12);v.y+=.12+power*.15;
      fire.emit(p,v,radius*(.5+Math.random()*.45),.2+Math.random()*.2,.28+power*.14);
    }
  }
  function trail(start,end,velocity,power,dt,record,radius) {
    record.fireEmission=(record.fireEmission||0)+dt*(140+power*110);
    while(record.fireEmission>=1){record.fireEmission--;
      p.lerpVectors(start,end,Math.random());
      v.randomDirection().multiplyScalar(.2+power*.3).addScaledVector(velocity,-.03);
      fire.emit(p,v,radius*(1.2+Math.random()*.9),.14+Math.random()*.2,.6);
    }
    record.smokeEmission=(record.smokeEmission||0)+dt*(35+power*25);
    while(record.smokeEmission>=1){record.smokeEmission--;
      p.lerpVectors(start,end,Math.random());
      v.randomDirection().multiplyScalar(.08).addScaledVector(velocity,-.01);
      smoke.emit(p,v,radius*(.9+Math.random()*.6),.5+Math.random()*.4,.25);
    }
  }
  function burst(center,power,normal) {
    for(let i=0;i<70+power*60;i++){
      v.randomDirection();if(normal&&v.dot(normal)<0)v.reflect(normal);
      const speed=Math.random();
      p.copy(center).addScaledVector(v,.05);
      v.multiplyScalar(.6+speed*(2.2+power*3));
      fire.emit(p,v,(.22+(1-speed)*.3)*(1+power*.9),.4+Math.random()*.6,.9);
    }
    for(let i=0;i<24+power*24;i++){
      v.randomDirection();if(normal&&v.dot(normal)<0)v.reflect(normal);
      p.copy(center).addScaledVector(v,.15);
      v.multiplyScalar(.4+Math.random()*(.8+power));v.y+=.25;
      smoke.emit(p,v,(.35+Math.random()*.3)*(1+power*.8),1.4+Math.random()*1.2,.7);
    }
    const flash=lights.find(f=>f.life<=0)||lights[0];
    flash.life=.7;flash.power=power;flash.light.position.copy(center);
    if(normal)flash.light.position.addScaledVector(normal,.35);
  }
  function release(center,dir,power){
    aura.release(power);
    for(let i=0;i<30;i++){
      v.randomDirection().multiplyScalar(.6).addScaledVector(dir,1.4);
      fire.emit(center,v,.05+power*.07,.16+Math.random()*.12,.5);
    }
    for(let i=0;i<8;i++){
      v.randomDirection().multiplyScalar(.15).addScaledVector(dir,.3);
      smoke.emit(center,v,.06+power*.05,.5+Math.random()*.3,.2);
    }
  }
  function update(dt,time){
    fire.update(dt,time);smoke.update(dt,time);
    for(const f of lights){f.life=Math.max(0,f.life-dt);f.light.intensity=Math.pow(f.life/.7,2)*(20+f.power*40);}
  }
  function reset(){fire.reset();smoke.reset();streams.reset();aura.reset();emission=0;for(const f of lights){f.life=0;f.light.intensity=0;}}
  return {charge,trail,burst,release,update,reset};
}
