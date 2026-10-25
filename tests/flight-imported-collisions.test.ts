import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {collisionShipGLB} from '../verification/collision-ship';
import {initializeRapier,createCollisions} from '../src/collisions';
import {createWalkSimulation,FixedStepClock} from '../src/physics';
import {editorFixture} from './fixture';
import {getModel} from '../src/model-library';
import {decodeProject} from '../src/project';
await initializeRapier();
(globalThis as any).FileReader=class{result:any;onloadend?:()=>void;async readAsArrayBuffer(blob:Blob){this.result=await blob.arrayBuffer();this.onloadend?.();}async readAsDataURL(blob:Blob){this.result='data:'+blob.type+';base64,'+Buffer.from(await blob.arrayBuffer()).toString('base64');this.onloadend?.();}};
function advance(sim:ReturnType<typeof createWalkSimulation>,seconds:number,fps=60){const clock=new FixedStepClock();for(let n=0;n<seconds*fps;n++)clock.advance(1/fps,sim.step);}

test('flight hovers, ascends, descends and falls under gravity after switching off at all frame rates',()=>{
    const results:T.Vector3[]=[];
    for(const fps of [10,30,60,144]){
        const f=editorFixture();f.model.state.water=-1000;const sim=createWalkSimulation(f.model,()=>0);sim.walk.feet.set(0,10,0);sim.setFlying(true);
        advance(sim,1,fps);assert.equal(sim.walk.feet.y,10);sim.keys.Space=true;sim.keys.KeyW=true;advance(sim,1,fps);assert.ok(sim.walk.feet.y>15);assert.ok(sim.walk.feet.z<0);
        sim.clearKeys();sim.keys.ShiftLeft=true;advance(sim,.5,fps);assert.ok(sim.walk.feet.y<18);
        results.push(sim.walk.feet.clone());sim.setFlying(false);advance(sim,5,fps);assert.ok(Math.abs(sim.walk.feet.y)<1e-6);assert.equal(sim.walk.grounded,true);
    }
    for(const p of results)assert.ok(p.distanceTo(results[0])<1e-6);
});

test('long falls remain bounded and serializable',()=>{
    const f=editorFixture();f.model.state.water=-1000;const sim=createWalkSimulation(f.model,()=>0);sim.walk.feet.set(0,50000,0);sim.setFlying(false);advance(sim,60);assert.ok(sim.walk.vy>=-80);assert.ok(sim.walk.feet.y>0);
});

test('flying pose survives project persistence; legacy poses default to gravity',()=>{
    const f=editorFixture(),sim=createWalkSimulation(f.model,()=>0);sim.walk.on=true;sim.walk.saved={pos:new T.Vector3(),target:new T.Vector3(),near:.5};sim.walk.feet.set(0,50,0);sim.setFlying(true);
    f.storage.bindView(()=>({camera:{pos:[0,51,0],target:[0,51,-1],rotation:[0,0,0],near:.1},walk:sim.capture()}),()=>{});
    const data=JSON.parse(f.storage.projectJSON());assert.equal(decodeProject(JSON.stringify(data)).view.walk?.flying,true);
    sim.restore(decodeProject(JSON.stringify(data)).view.walk!);assert.equal(sim.walk.flying,true);
    delete data.view.walk.flying;sim.restore(decodeProject(JSON.stringify(data)).view.walk!);assert.equal(sim.walk.flying,false);
    data.view.walk.flying='yes';assert.throws(()=>decodeProject(JSON.stringify(data)));
});


test('a dense imported ship supports both decks, open doors, walls and a ceiling, including during flight',async t=>{
    const f=editorFixture();f.model.state.water=-1000;f.model.heights.fill(0);f.terrain.updateMeshAll();f.materials.updateWater();
    const asset=await f.storage.importModel([new File([await collisionShipGLB()],'ship.glb')],'structure','mesh');
    f.edits.replaceWorld({assets:[asset]});assert.ok(getModel(asset.id).parts.reduce((sum,p)=>sum+p.geometry.attributes.position.count,0)>100000);
    const id=f.edits.addObject(asset.id,0,0)!;f.edits.updateObject(id,{followTerrain:false,position:[0,10,0]});
    const collisions=createCollisions(f.model,f.terrain);t.after(collisions.dispose);
    const sim=createWalkSimulation(f.model,f.terrain.getH,()=>true,collisions.motion),top=10+getModel(asset.id).bounds.max.y;
    sim.walk.feet.set(0,top+6,0);advance(sim,3);assert.ok(Math.abs(sim.walk.feet.y-top)<.08,'land on upper deck');
    sim.walk.feet.set(0,10.1,0);sim.walk.vy=0;sim.clearKeys();advance(sim,.5);assert.ok(Math.abs(sim.walk.feet.y-10)<.08,'stand on lower deck, not convex hull');
    sim.keys.KeyD=true;advance(sim,2);assert.ok(sim.walk.feet.x<3.2,'solid side wall');
    sim.walk.feet.set(0,10.1,0);sim.clearKeys();sim.keys.KeyW=true;advance(sim,1.2);assert.ok(sim.walk.feet.z<-5,'pass through the open doorway');
    sim.walk.feet.set(0,11,0);sim.setFlying(true);sim.keys.Space=true;advance(sim,1);assert.ok(sim.walk.feet.y<top-1.5,'cannot fly through ceiling');
    sim.clearKeys();sim.keys.KeyD=true;advance(sim,2);assert.ok(sim.walk.feet.x<3.2,'cannot fly through wall');
    sim.setFlying(false);advance(sim,2);assert.ok(Math.abs(sim.walk.feet.y-10)<.08);
    const none=await f.storage.prepareModelCollision(asset.id,'none');f.edits.replaceWorld({assets:[none]});assert.ok(collisions.motion.ground(0,0,top+.1)<1);
    f.history.undo();assert.ok(Math.abs(collisions.motion.ground(0,0,top+.1)-top)<.05,'undo restores precise collisions');
    const receiver=editorFixture();await receiver.storage.loadProjectFile(await f.storage.buildProjectBlob());assert.equal(receiver.model.world.assets[0].collider,'mesh');
});
