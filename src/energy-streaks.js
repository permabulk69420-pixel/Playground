import * as THREE from 'three';

// Real moving emitters with position history. Trails follow where each emitter
// actually travelled in world space; there are no drifting billboard sheets.
export function createEnergyStreaks(scene) {
  const count=26, historyLength=28, sides=5;
  const up=new THREE.Vector3(0,1,0),right=new THREE.Vector3(),forward=new THREE.Vector3();
  const axis=new THREE.Vector3(),cross=new THREE.Vector3(),other=new THREE.Vector3();
  const previousHead=new THREE.Vector3();
  const gold=new THREE.Color(0xffc476),white=new THREE.Color(0xfff6dd),blue=new THREE.Color(0x78ddff);
  let started=false, strength=0, storedPower=0;
  const emitters=Array.from({length:count},(_,i)=>({
    phase:i*2.399963,speed:1.4+(i*.317%1)*.9,spin:i%4===0?-1:1,
    radius:.55+(i*.731%1)*.37,level:-1.08+(i*.413%1)*.9,
    head:new THREE.Vector3(),history:Array.from({length:historyLength},()=>new THREE.Vector3()),
    color:i%5===0?blue.clone():gold.clone(),age:0
  }));
  const vertices=count*historyLength*sides;
  const positions=new Float32Array(vertices*3),colors=new Float32Array(vertices*3),indices=[];
  for(let e=0;e<count;e++)for(let j=0;j<historyLength-1;j++)for(let k=0;k<sides;k++){
    const a=(e*historyLength+j)*sides+k,b=(e*historyLength+j)*sides+(k+1)%sides;
    indices.push(a,b,a+sides,b,b+sides,a+sides);
  }
  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.BufferAttribute(positions,3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color',new THREE.BufferAttribute(colors,3).setUsage(THREE.DynamicDrawUsage));geo.setIndex(indices);
  const material=new THREE.MeshBasicMaterial({vertexColors:true,transparent:true,
    blending:THREE.AdditiveBlending,depthWrite:false,toneMapped:false});
  const trails=new THREE.Mesh(geo,material);trails.name='energy-streak-trails';trails.frustumCulled=false;trails.visible=false;scene.add(trails);
  const heads=new THREE.InstancedMesh(new THREE.SphereGeometry(1,8,6),new THREE.MeshBasicMaterial({
    color:0xfff4cc,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false,toneMapped:false}),count);
  heads.name='energy-streak-heads';heads.frustumCulled=false;heads.visible=false;scene.add(heads);
  const dummy=new THREE.Object3D(),tangent=new THREE.Vector3(),normal=new THREE.Vector3(),binormal=new THREE.Vector3(),color=new THREE.Color();
  let historyClock=0;

  function place(e,i,head,palms){
    const a=e.phase;
    if(i<16){
      // Differently tilted loops distribute trajectories in front, behind and
      // at both sides, from hips to shoulders, rather than scrolling sideways.
      e.head.copy(head).addScaledVector(right,Math.cos(a)*e.radius)
        .addScaledVector(forward,Math.sin(a)*e.radius);
      e.head.y=Math.max(.18,head.y+e.level+Math.sin(a+i*.8)*.26);
    }else{
      const side=i%2;
      axis.copy(palms[side]).sub(head).addScaledVector(right,side?-.2:.2);axis.y+=.5;
      if(axis.lengthSq()<.001)axis.copy(forward);axis.normalize();
      cross.crossVectors(axis,up);if(cross.lengthSq()<.001)cross.copy(right);cross.normalize();
      other.crossVectors(axis,cross).normalize();
      const radius=.09+(i*.37%1)*.055;
      e.head.copy(palms[side]).addScaledVector(axis,-.025-(.5+.5*Math.sin(a*.5+i))*.15)
        .addScaledVector(cross,Math.cos(a)*radius).addScaledVector(other,Math.sin(a)*radius);
    }
  }
  function update(active,power,palms,head,facing,time,dt){
    if(active)storedPower=power;
    strength=THREE.MathUtils.lerp(strength,active?.4+.6*power:0,1-Math.exp(-dt*(active?9:8)));
    if(strength<.01){trails.visible=heads.visible=false;started=false;return;}
    forward.copy(facing);forward.y=0;if(forward.lengthSq()<.001)forward.set(0,0,-1);forward.normalize();right.crossVectors(forward,up).normalize();
    const fresh=!started||previousHead.distanceToSquared(head)>1;
    previousHead.copy(head);started=true;
    historyClock+=dt;
    const record=historyClock>=1/90;
    if(record)historyClock%=1/90;
    for(let i=0;i<count;i++){
      const e=emitters[i];
      e.phase+=dt*e.spin*e.speed*(i<16?1:2.5)*(.75+storedPower*.7);
      place(e,i,head,palms);
      if(fresh){for(const p of e.history)p.copy(e.head);e.age=0;}
      if(record){for(let j=historyLength-1;j>0;j--)e.history[j].copy(e.history[j-1]);e.history[0].copy(e.head);e.age++;}
      dummy.position.copy(e.head);dummy.scale.setScalar((i<16?.0045:.0035)*strength);dummy.updateMatrix();heads.setMatrixAt(i,dummy.matrix);
      for(let j=0;j<historyLength;j++){
        const p=j===0?e.head:e.history[j];
        tangent.subVectors(j===0?e.head:e.history[j-1],e.history[Math.min(historyLength-1,j+1)]);
        if(tangent.lengthSq()<1e-8)tangent.copy(up);tangent.normalize();
        normal.crossVectors(tangent,up);if(normal.lengthSq()<.001)normal.copy(right);normal.normalize();binormal.crossVectors(tangent,normal);
        const fade=Math.pow(1-j/(historyLength-1),1.65)*strength;
        const radius=(i<16?.0028:.0019)*(.4+.6*fade);
        color.copy(e.color).lerp(white,Math.pow(1-j/(historyLength-1),6)*.7).multiplyScalar(fade);
        for(let k=0;k<sides;k++){
          const at=((i*historyLength+j)*sides+k)*3,angle=k/sides*Math.PI*2;
          positions[at]=p.x+normal.x*Math.cos(angle)*radius+binormal.x*Math.sin(angle)*radius;
          positions[at+1]=p.y+normal.y*Math.cos(angle)*radius+binormal.y*Math.sin(angle)*radius;
          positions[at+2]=p.z+normal.z*Math.cos(angle)*radius+binormal.z*Math.sin(angle)*radius;
          color.toArray(colors,at);
        }
      }
    }
    geo.attributes.position.needsUpdate=true;geo.attributes.color.needsUpdate=true;heads.instanceMatrix.needsUpdate=true;
    trails.visible=heads.visible=true;
  }
  function release(power){storedPower=power;}
  function reset(){strength=0;started=false;historyClock=0;trails.visible=heads.visible=false;}
  return {update,release,reset};
}
