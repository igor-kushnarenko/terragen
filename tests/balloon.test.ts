import {test} from 'node:test';
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import {initializeRapier,createCollisions} from '../src/collisions';
import {BALLOON,createBalloonState,validateBalloon} from '../src/balloon-state';
import {sampleAtmosphere,type AirSample} from '../src/atmosphere';
import {aerodynamicDrag,thermalStep,neutralTemperature,balloonPayload,releaseBallast,ropeForce} from '../src/balloon-physics';
import {createBalloonBody} from '../src/balloon-body';
import {FixedStepClock} from '../src/physics';
import {editorFixture} from './fixture';
import {captureDocument,decodeProject} from '../src/project';
import {findBalloonSite} from '../src/balloon-site';
import {createBalloonView} from '../src/balloon-view';
import {Scene} from 'three';
import {buildProjectPackage,readProjectPackage} from '../src/project-package';
await initializeRapier();
const air:AirSample={temperature:291.15,pressure:101325,density:101325/(287.05*291.15),wind:[0,0,0],rain:0};
function rig(height=0,sample=air){
    const s=createBalloonState([0,height,0],[3,0,0],47);s.started=s.seated=true;s.moored=false;s.burner=0;
    const world=new RAPIER.World({x:0,y:0,z:0});world.createCollider(RAPIER.ColliderDesc.cuboid(500,.2,500).setTranslation(0,-.2,0));
    const b=createBalloonBody(s,()=>sample,()=>0,()=>-1000);b.participant.attach(world);
    function step(dt:number){world.timestep=dt;b.participant.beforeStep(dt);world.step();b.participant.afterStep();}
    return {s,b,world,step,run(seconds:number,fps=60){const clock=new FixedStepClock();for(let i=0;i<seconds*fps;i++)clock.advance(1/fps,step);},dispose(){b.participant.detach();world.free();}};
}
test('atmosphere is seeded, continuous across layers and wind changes with height',()=>{
    const state=editorFixture().model.state;state.windSpeed=1;
    const a=sampleAtmosphere(state,15,20,40,10,8),b=sampleAtmosphere(state,15,20,40,10,8);assert.deepEqual(a,b);assert.notDeepEqual(a,sampleAtmosphere(state,21,20,40,10,8));
    const near=sampleAtmosphere(state,15,20,180.001,10,8),other=sampleAtmosphere(state,15,20,179.999,10,8);assert.ok(Math.hypot(...near.wind.map((v,i)=>v-other.wind[i]))<.001);
    assert.notDeepEqual(a.wind,sampleAtmosphere(state,15,20,500,10,8).wind);assert.ok(a.density>1&&a.density<1.4);
});
test('heating has inertia; vent and rain cool; empty fuel cannot heat; maximum temperature is bounded',()=>{
    const s=createBalloonState([0,0,0],[3,0,0],1);s.started=true;s.burner=1;const initial=s.temperature;
    thermalStep(s,air,1/120,0);assert.ok(s.temperature>initial&&s.temperature<initial+.1);assert.ok(s.fuel<45);
    const dry=structuredClone(s),wet=structuredClone(s);dry.burner=wet.burner=0;thermalStep(dry,air,1,0);thermalStep(wet,{...air,rain:1},1,0,false,true);assert.ok(wet.temperature<dry.temperature);
    s.fuel=0;const before=s.temperature;thermalStep(s,air,1,0,true);assert.ok(s.temperature<before);s.fuel=45;s.temperature=BALLOON.maxTemperature;thermalStep(s,air,1,0,true);assert.ok(s.temperature<=BALLOON.maxTemperature);
});
test('neutral heat balances complete payload; drag uses only relative velocity; ballast has no impulse',()=>{
    const s=createBalloonState([0,0,0],[3,0,0],1);s.seated=true;s.temperature=neutralTemperature(air,balloonPayload(s));
    const t=thermalStep(s,air,0,0);const basket=balloonPayload(s)-BALLOON.envelopeMass;assert.ok(Math.abs(t.lift-basket*9.81)<1e-8);
    assert.deepEqual(aerodynamicDrag({...air,wind:[4,1,-2]},[4,1,-2]),[0,0,0]);assert.ok(aerodynamicDrag(air,[4,0,0])[0]<0);
    const v=[...s.basket.velocity],mass=balloonPayload(s);assert.equal(releaseBallast(s,5),5);assert.equal(balloonPayload(s),mass-5);assert.deepEqual(s.basket.velocity,v);assert.equal(releaseBallast(s,-2),0);
    assert.equal(ropeForce(4,5,10),0);assert.ok(ropeForce(6,5,0)>0);
});
test('Rapier flight is stable across render rates and responds gradually to the burner',()=>{
    const runs:number[][]=[];
    for(const fps of [30,60,144]){const r=rig();try{r.s.temperature=neutralTemperature(air,balloonPayload(r.s));r.s.burner=1;r.run(20,fps);runs.push([...r.s.basket.position,r.s.temperature,r.s.fuel]);assert.ok(r.s.basket.position[1]>3,JSON.stringify(r.s.basket));assert.ok(Math.hypot(...r.s.basket.angular)<2);}finally{r.dispose();}}
    for(const p of runs)for(let i=0;i<p.length;i++)assert.ok(Math.abs(p[i]-runs[0][i])<1e-5,JSON.stringify(runs));
});
test('basket lands on terrain and an overhead collider blocks the envelope',()=>{
    const r=rig(2);try{r.s.temperature=air.temperature;r.run(6);assert.ok(r.s.basket.position[1]>.6&&r.s.basket.position[1]<.85,JSON.stringify(r.s.basket.position));assert.equal(r.b.metrics.grounded,true);}finally{r.dispose();}
    const roof=rig();try{roof.world.createCollider(RAPIER.ColliderDesc.cuboid(30,.5,30).setTranslation(0,29,0));roof.s.burner=1;roof.s.temperature=390;roof.run(15);assert.ok(roof.s.envelope.position[1]+8<29.2);}finally{roof.dispose();}
});
test('free anchor is a falling body, ground hook is finite, and winch spends energy',()=>{
    const r=rig(18);try{r.s.moored=true;r.b.dropAnchor();r.run(1);assert.ok(r.s.anchor.position[1]<r.s.basket.position[1]-2);assert.equal(r.s.hooked,false);r.run(10);assert.ok(r.s.anchor.position[1]>.15);const energy=r.s.battery;r.s.winch='raise';r.run(3);assert.ok(r.s.battery<energy);assert.ok(r.s.ropeLength<22);}finally{r.dispose();}
});
test('participant cleanup and rebuild do not leak bodies or joints',()=>{
    const r=rig();try{assert.equal(r.world.bodies.len(),3);assert.equal(r.world.impulseJoints.len(),4);r.b.participant.detach();assert.equal(r.world.bodies.len(),0);assert.equal(r.world.impulseJoints.len(),0);for(let i=0;i<8;i++){r.b.participant.attach(r.world);r.step(1/120);r.b.participant.detach();}assert.equal(r.world.bodies.len(),0);assert.equal(r.world.colliders.len(),1);}finally{r.dispose();}
});
test('balloon project state round-trips, old projects migrate, invalid flight loads are atomic',async()=>{
    const f=editorFixture();f.model.balloon=createBalloonState([0,2,0],[3,2,0],1);const json=f.storage.projectJSON();assert.deepEqual(decodeProject(json).balloon,f.model.balloon);const snapshot=captureDocument(f.model);
    for(const mutate of [(s:any)=>s.temperature=500,(s:any)=>s.basket.rotation=[0,0,0,0],(s:any)=>s.fuel=-1,(s:any)=>s.options.bindings.boost='KeyE',(s:any)=>s.options.bindings.vent='Space',(s:any)=>s.hooked=true]){const d=JSON.parse(json);mutate(d.balloon);await assert.rejects(f.storage.loadProjectText(JSON.stringify(d)),/balloon/);assert.deepEqual(captureDocument(f.model),snapshot);}
    const old=JSON.parse(json);old.version=10;delete old.balloon;assert.equal(decodeProject(JSON.stringify(old)).balloon,null);assert.equal(validateBalloon(null),null);
});
test('launch site checks water, slope, full canopy and exact selection',()=>{
    const f=editorFixture();f.model.heights.fill(30);f.model.state.water=0;f.model.world.objects=[];f.terrain.updateMeshAll();assert.deepEqual(findBalloonSite(f.model,f.terrain.getH,[0,30,0],true),[0,30,0]);
    f.edits.addObject('pine',5,0);assert.equal(findBalloonSite(f.model,f.terrain.getH,[0,30,0],true),null);assert.ok(findBalloonSite(f.model,f.terrain.getH,[0,30,0]));
    f.model.state.water=40;assert.equal(findBalloonSite(f.model,f.terrain.getH,[0,30,0]),null);
});
test('drift tends toward the wind speed and height assistant uses the ordinary burner',()=>{
    const r=rig(150,{...air,wind:[4,0,0]});try{r.s.temperature=neutralTemperature(air,balloonPayload(r.s));r.s.burner=BALLOON.heatTransfer*(r.s.temperature-air.temperature)/BALLOON.heatPower;r.run(60);assert.ok(r.s.basket.velocity[0]>3&&r.s.basket.velocity[0]<4.5,JSON.stringify(r.s.basket));}finally{r.dispose();}
    const assisted=rig();try{assisted.s.temperature=neutralTemperature(air,balloonPayload(assisted.s));assisted.s.options.assist=true;assisted.run(120);assert.ok(assisted.s.basket.position[1]>15&&assisted.s.basket.position[1]<55,JSON.stringify(assisted.s.basket));assert.ok(assisted.s.fuel<45);}finally{assisted.dispose();}
});
test('winch stalls under excessive load and does not consume imaginary energy',()=>{
    const r=rig(50);try{r.s.moored=true;r.b.dropAnchor();r.s.anchor.position=[0,1,0];r.b.bodies.anchor!.setTranslation({x:0,y:1,z:0},true);r.s.ropeLength=1;r.s.winch='raise';const energy=r.s.battery;r.step(1/120);assert.equal(r.b.metrics.winchStalled,true);assert.equal(r.s.battery,energy);}finally{r.dispose();}
});
test('nearby crown colliders are bounded and removed along with the flight',()=>{
    const world=new RAPIER.World({x:0,y:0,z:0}),s=createBalloonState([0,0,0],[3,0,0],1);let nearby=true;
    const b=createBalloonBody(s,()=>air,()=>0,()=>-1000,()=>nearby?Array.from({length:120},(_,i)=>({key:String(i),position:[i*3,20,0],half:[1,3,1]})):[]);
    b.participant.attach(world);b.participant.beforeStep(1/120);assert.equal(b.canopyCount,96);assert.equal(world.colliders.len(),104);
    nearby=false;b.participant.beforeStep(.3);assert.equal(b.canopyCount,0);assert.equal(world.colliders.len(),8);b.participant.detach();assert.equal(world.colliders.len(),0);world.free();
});
test('visual quality changes complexity; removal releases geometry, materials and light',()=>{
    const r=rig(),scene=new Scene();try{const low=createBalloonView(scene,r.s,r.b,'low'),small=low.envelope.children[0] as any,count=small.geometry.attributes.position.count;let disposed=0;small.geometry.addEventListener('dispose',()=>disposed++);low.update(.5,1);assert.equal(low.drawCalls,8);low.dispose();assert.equal(scene.children.length,0);assert.equal(disposed,1);const high=createBalloonView(scene,r.s,r.b,'high');assert.ok((high.envelope.children[0] as any).geometry.attributes.position.count>count);high.dispose();}finally{r.dispose();}
});
test('shared collision world preserves flight across rebuilds and removes the actor on stop',()=>{
    const f=editorFixture();f.model.heights.fill(0);f.model.state.water=-1000;f.terrain.updateMeshAll();const c=createCollisions(f.model,f.terrain),s=createBalloonState([0,0,0],[3,0,0],1),b=createBalloonBody(s,()=>air,f.terrain.getH,()=>-1000);
    try{c.ensure();const base=c.colliderCount;c.bindDynamic(b.participant);c.setPassenger(true);c.stepWater(1/120,()=>({height:-1000,normal:{x:0,y:1,z:0},velocity:{x:0,y:0,z:0}}) as any);assert.equal(c.colliderCount,base+8);const before=[...s.basket.position];c.rebuild();assert.equal(c.colliderCount,base+8);assert.deepEqual(s.basket.position,before);c.bindDynamic(undefined);assert.equal(c.colliderCount,base);}finally{c.dispose();}
});
test('portable packages retain the flight and continue to accept version 10 manifests',async()=>{
    const f=editorFixture();f.model.balloon=createBalloonState([0,30,0],[3,30,0],3);const text=f.storage.projectJSON(),file=await buildProjectPackage(text,f.vault);assert.deepEqual((await readProjectPackage(file)).project.balloon,f.model.balloon);
    const old=JSON.parse(text);old.version=10;delete old.balloon;const legacy=await readProjectPackage(await buildProjectPackage(JSON.stringify(old),f.vault));assert.equal(legacy.project.sourceVersion,10);assert.equal(legacy.project.balloon,null);
});
test('flight boundary keeps the coupled bodies and the saved state within the map',()=>{
    const r=rig(80);try{for(const key of ['basket','envelope','anchor'] as const){r.s[key].position[0]+=505;r.s[key].velocity=[30,0,0];r.b.bodies[key]!.setTranslation({x:r.s[key].position[0],y:r.s[key].position[1],z:0},true);r.b.bodies[key]!.setLinvel({x:30,y:0,z:0},true);}r.run(.2);assert.ok(r.s.basket.position[0]<=506);assert.equal(r.b.metrics.boundaryHit,true);assert.ok(validateBalloon(r.s));assert.ok(Math.abs(r.s.envelope.position[0]-r.s.basket.position[0])<1);}finally{r.dispose();}
});
