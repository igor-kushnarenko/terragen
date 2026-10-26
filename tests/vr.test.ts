import test from 'node:test';
import assert from 'node:assert/strict';
import {Vector3,Ray} from 'three';
import {vrStick,createVREdges,vrHorizontal,traceVRTeleport,vrFailure} from '../src/vr-input';
import {createWalkSimulation,FixedStepClock} from '../src/physics';
import {effectiveQuality,qualityProfile} from '../src/quality';
import {createCollisions,initializeRapier} from '../src/collisions';
import {collisionShipGLB} from '../verification/collision-ship';
import {editorFixture} from './fixture';

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
