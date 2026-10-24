import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {BALLOON,type BalloonState,type BalloonPose} from './balloon-state';
import type {BalloonBody} from './balloon-body';

/** Merged fittings keep the complete aircraft below fifteen draw calls. */
export function createBalloonView(scene:THREE.Scene,s:BalloonState,body:BalloonBody,quality:string){
    const root=new THREE.Group(),basket=new THREE.Group(),envelope=new THREE.Group(),anchor=new THREE.Group();root.name='balloon-scenario';root.add(basket,envelope,anchor);scene.add(root);
    const materials:THREE.Material[]=[],geometries:THREE.BufferGeometry[]=[];
    const material=(color:number,metalness=0)=>{const m=new THREE.MeshStandardMaterial({color,roughness:.82,metalness});materials.push(m);return m;};
    const wood=material(0x9d683a),steel=material(0x42494a,.55),tanks=material(0xacaa94,.4);
    function merged(parent:THREE.Group,parts:THREE.BufferGeometry[],m:THREE.Material){const geo=mergeGeometries(parts,false)!;parts.forEach(g=>g.dispose());geometries.push(geo);const mesh=new THREE.Mesh(geo,m);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;}
    const box=(x:number,y:number,z:number,sx:number,sy:number,sz:number)=>new THREE.BoxGeometry(sx,sy,sz).translate(x,y,z);
    const wooden=[box(0,-.59,0,1.9,.24,1.56)];
    for(const z of [-.74,.74])for(let y=-.39;y<.52;y+=.12)wooden.push(box(0,y,z,1.8,.09,.09));
    for(const x of [-.9,.9])for(let y=-.39;y<.52;y+=.12)wooden.push(box(x,y,0,.09,.09,1.45));
    for(const x of [-.88,.88])for(const z of [-.72,.72])wooden.push(box(x,0,z,.12,1.15,.12));
    merged(basket,wooden,wood);
    const frame:THREE.BufferGeometry[]=[];
    for(const x of [-.68,.68])for(const z of [-.55,.55])frame.push(new THREE.CylinderGeometry(.035,.035,2.1,6).translate(x,1,z));
    frame.push(box(0,2,0,1.5,.08,1.3),new THREE.CylinderGeometry(.22,.17,.4,10).translate(0,2.1,0));merged(basket,frame,steel);
    merged(basket,[...[-.58,.58].map(x=>new THREE.CylinderGeometry(.18,.18,.72,10).translate(x,-.1,.45)),box(.57,-.13,-.4,.38,.65,.35)],tanks);
    merged(anchor,[box(0,0,0,.15,.65,.15),box(0,-.18,0,.7,.12,.12),box(-.32,-.1,0,.12,.24,.12),box(.32,-.1,0,.12,.24,.12)],steel);
    const segments=quality==='low'?24:quality==='high'?64:48;
    const profile=[new THREE.Vector2(1.2,-13.3),new THREE.Vector2(2,-11.5),new THREE.Vector2(4,-9),new THREE.Vector2(6.5,-5.5),new THREE.Vector2(8.4,-1),new THREE.Vector2(8.8,3),new THREE.Vector2(8,7),new THREE.Vector2(5.8,10.5),new THREE.Vector2(2.7,12.6),new THREE.Vector2(0,13.1)];
    const volume=profile.slice(1).reduce((v,p,i)=>{const a=profile[i];return v+Math.PI/3*(p.y-a.y)*(a.x*a.x+a.x*p.x+p.x*p.x);},0),radiusScale=Math.sqrt(BALLOON.volume/volume);profile.forEach(p=>p.x*=radiusScale);
    const indexed=new THREE.LatheGeometry(profile,segments),geo=indexed.toNonIndexed();indexed.dispose();const p=geo.getAttribute('position'),uv=geo.getAttribute('uv'),colors:number[]=[],c=new THREE.Color();
    for(let i=0;i<p.count;i++){const stripe=Math.min(15,Math.floor(uv.getX(i)*16));c.setHex(stripe%4===0?0xeac98b:stripe%2===0?0xc35f36:0x2e7778);colors.push(c.r,c.g,c.b);}
    geo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geometries.push(geo);
    const fabric=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.92,side:THREE.DoubleSide});materials.push(fabric);const shell=new THREE.Mesh(geo,fabric);shell.castShadow=quality!=='low';shell.receiveShadow=true;envelope.add(shell);
    // Preserve the dyed panels when the burner lights the fabric from inside.
    fabric.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\n totalEmissiveRadiance *= vColor.rgb;');};fabric.customProgramCacheKey=()=> 'balloon-fabric-colour-v1';
    const flameMat=new THREE.MeshBasicMaterial({color:0xffa42d,transparent:true,opacity:.8,depthWrite:false});materials.push(flameMat);
    const flameGeo=new THREE.ConeGeometry(.22,2.6,8);geometries.push(flameGeo);const flame=new THREE.Mesh(flameGeo,flameMat);flame.position.y=3.4;basket.add(flame);
    const light=new THREE.PointLight(0xffb16a,0,27,2);light.position.y=3.8;basket.add(light);
    const lineGeo=new THREE.BufferGeometry(),linePositions=new Float32Array((4*2+24*2)*3);lineGeo.setAttribute('position',new THREE.BufferAttribute(linePositions,3));geometries.push(lineGeo);
    const lineMat=new THREE.LineBasicMaterial({color:0x514635});materials.push(lineMat);const ropes=new THREE.LineSegments(lineGeo,lineMat);ropes.frustumCulled=false;root.add(ropes);
    const dropsGeo=new THREE.BufferGeometry(),dropsPositions=new Float32Array(32*3);dropsGeo.setAttribute('position',new THREE.BufferAttribute(dropsPositions,3));geometries.push(dropsGeo);const dropsMat=new THREE.PointsMaterial({color:0x94d9df,size:.08,transparent:true,opacity:.6,depthWrite:false});materials.push(dropsMat);const drops=new THREE.Points(dropsGeo,dropsMat);drops.frustumCulled=false;drops.visible=false;root.add(drops);
    const q=new THREE.Quaternion(),v=new THREE.Vector3();
    function pose(group:THREE.Group,a:BalloonPose,b:BalloonPose,t:number){group.position.fromArray(a.position).lerp(v.fromArray(b.position),t);group.quaternion.fromArray(a.rotation).slerp(q.fromArray(b.rotation),t);}
    function update(alpha:number,ballast=0){
        pose(basket,body.previous.basket,s.basket,alpha);pose(envelope,body.previous.envelope,s.envelope,alpha);pose(anchor,body.previous.anchor,s.anchor,alpha);
        anchor.visible=!s.broken;let n=0;
        const append=(p:THREE.Vector3)=>{linePositions[n++]=p.x;linePositions[n++]=p.y;linePositions[n++]=p.z;};
        for(const x of [-.68,.68])for(const z of [-.55,.55]){append(basket.localToWorld(new THREE.Vector3(x,2,z)));append(envelope.localToWorld(new THREE.Vector3(x*1.1,-13.3,z*1.1)));}
        const start=basket.localToWorld(new THREE.Vector3(1.08,-.25,0)),end=anchor.position,d=start.distanceTo(end),sag=Math.min(3,Math.sqrt(Math.max(0,s.ropeLength*s.ropeLength-d*d))*.3);
        if(s.anchorOut&&!s.broken)for(let i=0;i<24;i++)for(const t of [i/24,(i+1)/24])append(new THREE.Vector3().lerpVectors(start,end,t).add(new THREE.Vector3(0,-Math.sin(t*Math.PI)*sag,0)));
        lineGeo.setDrawRange(0,n/3);lineGeo.attributes.position.needsUpdate=true;
        drops.visible=ballast>0;for(let i=0;i<32&&ballast>0;i++){const t=(1-ballast)+i/80;dropsPositions[i*3]=basket.position.x+1+Math.sin(i*8.1)*t*.2;dropsPositions[i*3+1]=basket.position.y-.1-4.9*t*t;dropsPositions[i*3+2]=basket.position.z+Math.cos(i*4.7)*t*.2;}dropsGeo.attributes.position.needsUpdate=true;
        flame.visible=body.metrics.power>.01;flame.scale.y=.4+body.metrics.power*(1+.08*Math.sin(s.time*37));light.intensity=body.metrics.power*170;fabric.emissive.setHex(0xff8833);fabric.emissiveIntensity=body.metrics.power*.16;
    }
    return {basket,envelope,update,get drawCalls(){return 7+(drops.visible?1:0);},dispose(){root.removeFromParent();light.dispose();geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());}};
}
