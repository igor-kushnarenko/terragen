import test from 'node:test';
import assert from 'node:assert/strict';
import {Vector3,Ray} from 'three';
import {vrStick,createVREdges,vrHorizontal,traceVRTeleport,vrFailure} from '../src/vr-input';
import {createWalkSimulation,FixedStepClock} from '../src/physics';
import {effectiveQuality,qualityProfile} from '../src/quality';
import {createCollisions,initializeRapier} from '../src/collisions';
import {collisionShipGLB} from '../verification/collision-ship';
import {editorFixture} from './fixture';
import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {VR_QUALITY_PROFILES} from '../src/quality';
import {readVRQuality,saveVRQuality,VR_QUALITY_KEY,readVRRayPitch,saveVRRayPitch,DEFAULT_VR_RAY_PITCH} from '../src/vr-preferences';
import {createFineFoliage} from '../src/fine-foliage';
import {createVRPointer,vrPointerRay,bindPICOResponses} from '../src/vr-controller';
import {PICO_CONTROLLER_GLB} from '../src/vr-controller-assets';
import {base64Binary,readGLB} from '../src/asset-format';
import {createWaterRendering} from '../src/water-rendering';
import type {RenderingSystem} from '../src/rendering';

test('VR thumbsticks reject drift, retain analog speed and use xr-standard stick axes',()=>{
    assert.deepEqual(vrStick(undefined),{x:0,y:0});assert.deepEqual(vrStick({axes:[0,0,.1,-.05]}),{x:0,y:0});
    assert.deepEqual(vrStick({axes:[1,1,0,-1]}),{x:0,y:-1});assert.deepEqual(vrStick({axes:[0,-1]}),{x:0,y:-1});
    assert.ok(Math.abs(vrStick({axes:[0,.59]}).y-.5)<1e-9);
    const diagonal=vrStick({axes:[1,1]});assert.ok(Math.abs(Math.hypot(diagonal.x,diagonal.y)-1)<1e-9);
    assert.deepEqual(vrStick({axes:[NaN,Infinity]}),{x:0,y:0});
});
test('VR turns require centering and buttons fire once per press',()=>{
    const edges=createVREdges();assert.equal(edges.snap(1),-Math.PI/6);assert.equal(edges.snap(1),0);assert.equal(edges.snap(-1),0);assert.equal(edges.snap(0),0);assert.equal(edges.snap(-1),Math.PI/6);
    assert.equal(edges.pressed('flight',true),true);assert.equal(edges.pressed('flight',true),false);assert.equal(edges.pressed('flight',false),false);assert.equal(edges.pressed('flight',true),true);
    edges.reset();assert.equal(edges.snap(-1),Math.PI/6);
});
test('tracked walking and origin compensation use the same heading',()=>{
    const d=vrHorizontal({x:1,z:0},Math.PI/2);assert.ok(Math.abs(d.x)<1e-9);assert.ok(Math.abs(d.z+1)<1e-9);assert.equal(d.y,0);
});
test('teleport arc stops at the first obstacle and rejects unsafe destinations',()=>{
    for(const safe of [true,false]){
        const trace=traceVRTeleport(new Vector3(0,1.7,0),new Vector3(0,0,-1),(ray,distance)=>{
            const t=-ray.origin.y/ray.direction.y;if(t<0||t>distance)return null;return {point:ray.at(t,new Vector3()),safe};
        });
        assert.ok(trace.points.length<56);assert.ok(trace.points.at(-1)!.z<0);assert.equal(!!trace.target,safe);assert.ok(Math.abs(trace.points.at(-1)!.y)<1e-9);
    }
    assert.equal(traceVRTeleport(new Vector3(),new Vector3(0,0,-1),()=>null).target,null);
});
test('VR analog movement is proportional and preserves fixed-step physics',()=>{
    const positions:Vector3[]=[];
    for(const fps of [30,60,90,144]){
        const f=editorFixture();f.model.state.water=-1000;const sim=createWalkSimulation(f.model,()=>0),clock=new FixedStepClock();sim.walk.feet.set(0,0,0);
        for(let i=0;i<fps;i++)clock.advance(1/fps,dt=>sim.step(dt,{forward:.5,right:0,up:0}));
        assert.ok(Math.abs(sim.walk.feet.z+f.model.walkSettings.speed*.5)<1e-7);positions.push(sim.walk.feet.clone());
        sim.setFlying(true);sim.step(.1,{forward:0,right:0,up:1});const y=sim.walk.feet.y;sim.step(.1,{forward:0,right:0,up:0});assert.equal(sim.walk.feet.y,y);sim.setFlying(false);sim.step(.1);assert.ok(sim.walk.feet.y<y);
    }
    for(const position of positions)assert.ok(position.distanceTo(positions[0])<1e-7);
});
test('VR graphics budget is transient and restores saved desktop quality',()=>{
    const f=editorFixture();f.model.state.quality='high';f.model.xrActive=true;assert.equal(effectiveQuality(f.model),'low');assert.equal(qualityProfile(f.model).shadowSize,0);
    assert.equal(f.model.state.quality,'high');assert.ok(!f.storage.projectJSON().includes('xrActive'));f.model.xrActive=false;assert.equal(effectiveQuality(f.model),'high');
});
test('VR quality mode improves resolution, materials and shadows independently of desktop settings',()=>{
    const f=editorFixture();f.model.state.quality='balanced';f.model.xrActive=true;
    const low=qualityProfile(f.model);f.model.xrQuality='quality';const high=qualityProfile(f.model);
    assert.equal(effectiveQuality(f.model),'high');assert.ok(high.surfaceOctaves>low.surfaceOctaves);assert.equal(high.shadowSize,2048);
    assert.ok(high.objectDistances[0]>low.objectDistances[0]);assert.equal(VR_QUALITY_PROFILES.quality.framebufferScale,1);assert.ok(VR_QUALITY_PROFILES.quality.foveation<VR_QUALITY_PROFILES.economy.foveation);
    assert.equal(f.model.state.quality,'balanced');assert.ok(!f.storage.projectJSON().includes('xrQuality'));f.model.xrActive=false;assert.equal(effectiveQuality(f.model),'balanced');
});
test('VR quality preference survives visits and handles unavailable browser storage',()=>{
    const values=new Map<string,string>(),storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);}};
    assert.equal(readVRQuality(storage),'economy');saveVRQuality(storage,'quality');assert.equal(readVRQuality(storage),'quality');
    values.set(VR_QUALITY_KEY,'corrupt');assert.equal(readVRQuality(storage),'economy');
    assert.equal(readVRQuality({getItem(){throw new Error('blocked');}}),'economy');assert.doesNotThrow(()=>saveVRQuality({setItem(){throw new Error('blocked');}},'quality'));
});
test('both VR quality modes keep mono reflection/refraction captures disabled',()=>{
    const f=editorFixture();f.model.xrActive=true;f.model.state.waterReflections=true;
    const renderer={getDrawingBufferSize(){throw new Error('monocular capture');},getRenderTarget(){throw new Error('monocular capture');}};
    const water=createWaterRendering(f.model,{...f.render,renderer} as unknown as RenderingSystem,f.materials);
    for(const quality of ['quality','economy','quality'] as const){f.model.xrQuality=quality;water.update(0);assert.equal(water.statistics.reflectionSize,0);assert.equal(f.materials.waterUniforms.uReflectionOn.value,0);assert.equal(f.materials.waterUniforms.uRefractionOn.value,0);}
    water.dispose();
});
test('selection and the visible laser share the calibrated model axis, independently of runtime aim',()=>{
    const rig=new T.Group(),grip=new T.Group(),nativeAim=new T.Group(),pointer=createVRPointer(0);rig.add(grip,nativeAim);grip.add(pointer.root);
    rig.position.set(3,4,5);rig.rotation.y=.6;grip.position.set(.3,1.4,-.4);nativeAim.rotation.x=Math.PI/4;
    for(const pitch of [0,-.4,.4]){
        grip.rotation.set(pitch,.2,.1);const ray=vrPointerRay(pointer.root),expected=new T.Vector3(0,0,-1).transformDirection(grip.matrixWorld);
        assert.ok(ray.direction.distanceTo(expected)<1e-9);assert.ok(ray.origin.distanceTo(grip.getWorldPosition(new T.Vector3()))>.05);
        const tip=pointer.line.localToWorld(new T.Vector3(0,0,-1));assert.ok(tip.distanceTo(ray.at(pointer.line.scale.z,new T.Vector3()))<1e-8);
    }
    grip.rotation.set(0,0,0);const ray=vrPointerRay(pointer.root);nativeAim.updateWorldMatrix(true,false);assert.ok(ray.direction.angleTo(new T.Vector3(0,0,-1).transformDirection(nativeAim.matrixWorld))>.7);
});
test('default laser corrects grip inclination, supports vertical aiming and remembers calibration',()=>{
    const grip=new T.Group(),pointer=createVRPointer();grip.add(pointer.root);grip.rotation.x=T.MathUtils.degToRad(40);
    assert.ok(Math.abs(vrPointerRay(pointer.root).direction.y)<1e-9);grip.rotation.x+=.3;assert.ok(vrPointerRay(pointer.root).direction.y>.2);
    let saved:string|null=null;const storage={getItem:()=>saved,setItem:(_key:string,value:string)=>{saved=value;}};
    assert.equal(readVRRayPitch(storage),DEFAULT_VR_RAY_PITCH);saveVRRayPitch(storage,-30);assert.equal(readVRRayPitch(storage),-30);
    for(const bad of ['','NaN','Infinity','200']){saved=bad;assert.equal(readVRRayPitch(storage),DEFAULT_VR_RAY_PITCH);}
});
test('changing the VR quality rebuilds existing nearby foliage with the new density',()=>{
    const f=editorFixture();f.model.heights.fill(25);f.terrain.updateMeshAll();f.model.xrActive=true;f.model.state.foliageDensity=1;
    const camera=new T.PerspectiveCamera();camera.position.set(0,27,0);const foliage=createFineFoliage(f.model,f.terrain,f.render.scene);foliage.update(camera,.1);
    const old=f.render.scene.children.filter(o=>o instanceof T.InstancedMesh);assert.ok(old.length>0);f.model.xrQuality='quality';foliage.update(camera,.1);
    assert.ok(old.every(mesh=>!f.render.scene.children.includes(mesh)));assert.ok(foliage.statistics.instances>0);foliage.dispose();
});
test('bundled PICO 4 Ultra controllers have offline textures and working trigger and thumbstick response nodes',async()=>{
    (globalThis as any).ProgressEvent=class{constructor(_type:string,init:object){Object.assign(this,init);}};
    for(const hand of ['left','right'] as const){
        const binary=base64Binary(PICO_CONTROLLER_GLB[hand]),doc=readGLB(binary) as any;
        assert.ok(doc.images.every((image:any)=>image.bufferView!==undefined&&!image.uri));assert.ok(doc.buffers.every((buffer:any)=>!buffer.uri));
        // Geometry and authored response poses can be checked in Node without a JPEG decoder.
        const length=new DataView(binary).getUint32(12,true);doc.buffers[0].uri='data:application/octet-stream;base64,'+Buffer.from(binary,28+length).toString('base64');
        for(const mesh of doc.meshes)for(const primitive of mesh.primitives)delete primitive.material;
        const gltf=await new GLTFLoader().parseAsync(JSON.stringify(doc),'');let meshes=0;gltf.scene.traverse(o=>{if(o instanceof T.Mesh)meshes++;});assert.ok(meshes>=8);
        const size=new T.Box3().setFromObject(gltf.scene).getSize(new T.Vector3());assert.ok(size.y>.1&&size.y<.2);assert.ok(size.z>.1&&size.z<.2);
        const update=bindPICOResponses(gltf.scene,hand);update(undefined);const trigger=gltf.scene.getObjectByName('xr_standard_trigger_pressed_value')!,neutral=trigger.quaternion.clone();
        update({buttons:Array.from({length:6},()=>({value:1,pressed:true,touched:true})),axes:[0,0,1,-1]});
        assert.ok(trigger.quaternion.angleTo(neutral)>.1);
        const stick=gltf.scene.getObjectByName('xr_standard_thumbstick_xaxis_pressed_value')!,max=gltf.scene.getObjectByName('xr_standard_thumbstick_xaxis_pressed_max')!;assert.ok(stick.quaternion.angleTo(max.quaternion)<1e-6);
    }
});
test('teleportation lands on imported decks and rejects walls, sea and insufficient headroom',async t=>{
    await initializeRapier();
    (globalThis as any).FileReader=class{result:any;onloadend?:()=>void;async readAsArrayBuffer(blob:Blob){this.result=await blob.arrayBuffer();this.onloadend?.();}};
    const f=editorFixture();f.model.state.water=-1000;f.model.heights.fill(0);f.terrain.updateMeshAll();f.materials.updateWater();
    const asset=await f.storage.importModel([new File([await collisionShipGLB(false)],'ship.glb')],'structure','mesh');f.edits.replaceWorld({assets:[asset]});
    const id=f.edits.addObject(asset.id,0,0)!;f.edits.updateObject(id,{followTerrain:false,position:[0,10,0]});const collisions=createCollisions(f.model,f.terrain);t.after(collisions.dispose);
    const top=collisions.teleportHit(new Ray(new Vector3(0,30,0),new Vector3(0,-1,0)),30);assert.equal(top?.safe,true);assert.ok(top!.point.y>10);
    const wall=collisions.teleportHit(new Ray(new Vector3(0,11,0),new Vector3(1,0,0)),10);assert.equal(wall?.safe,false);
    f.model.walkSettings.eyeHeight=8;const cramped=collisions.teleportHit(new Ray(new Vector3(0,10.5,0),new Vector3(0,-1,0)),1);assert.equal(cramped?.safe,false);
    f.model.state.water=100;assert.equal(collisions.teleportHit(new Ray(new Vector3(0,30,0),new Vector3(0,-1,0)),30)?.safe,false);
});
test('VR connection errors include actionable instructions',()=>{
    assert.match(vrFailure(new DOMException('denied','NotAllowedError')),/Разрешите/);assert.match(vrFailure(new DOMException('no runtime','NotSupportedError')),/OpenXR/);
});
