import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {wetnessAfter,advanceDay,daylight,approachAngle,windDisplacement,basinFog} from '../src/environment-math';
import {createEnvironment} from '../src/environment';
import {capturePhotoPNG,applyPhotoView} from '../src/photo-camera';
import {captureDocument,decodeProject} from '../src/project';
import {editorFixture} from './fixture';
import type {RenderingSystem} from '../src/rendering';
import type {SavedViewpoint} from '../src/world';

test('rain accumulates moisture, dry weather releases it slowly and integration is independent of FPS',()=>{
    const values:number[]=[];for(const fps of [10,60,144]){let wet=0;for(let i=0;i<fps*20;i++)wet=wetnessAfter(wet,1,1/fps);values.push(wet);}
    for(const wet of values)assert.ok(Math.abs(wet-values[0])<1e-12);assert.ok(values[0]>.8);
    const drying=wetnessAfter(values[0],0,20);assert.ok(drying>.65&&drying<values[0]);assert.equal(wetnessAfter(values[0],0,0),values[0]);assert.equal(wetnessAfter(0,0,20),0);
});
test('daylight crosses sunrise, noon, sunset and midnight continuously and wraps at the chosen duration',()=>{
    assert.ok(Math.abs(daylight(6).sunEl)<1e-10);assert.equal(daylight(12).sunEl,58);assert.ok(Math.abs(daylight(18).sunEl)<1e-10);assert.equal(daylight(0).sunEl,-58);
    assert.equal(advanceDay(23,60,24),0);assert.deepEqual(daylight(24),daylight(0));
    assert.ok(approachAngle(359,1,.1)>359);assert.ok(approachAngle(1,359,.1)<1);assert.equal(approachAngle(12,180,0),12);
});
test('wind pins plant roots, respects calm and world direction and stays deterministic',()=>{
    assert.deepEqual(windDisplacement(0,10,20,2,3,90),[0,0]);assert.deepEqual(windDisplacement(8,10,20,2,0,90),[0,0]);
    const east=windDisplacement(8,10,20,2,2,90),north=windDisplacement(8,10,20,2,2,0);assert.ok(Math.abs(east[0])>.01);assert.ok(Math.abs(east[1])<1e-12);assert.ok(Math.abs(north[0])<1e-12);assert.ok(Math.abs(north[1]-east[0])<1e-12);
    assert.deepEqual(windDisplacement(8,10,20,2,2,90),east);assert.notDeepEqual(windDisplacement(8,10,20,3,2,90),east);
});
test('fog follows basins and independent shore levels instead of covering hilltops uniformly',()=>{
    assert.ok(basinFog(10,[30,30,30,30],0).strength>.9);assert.equal(basinFog(40,[20,20,20,20],0).strength,0);assert.ok(basinFog(21,[21,21,21,21],20).strength>.4);
    const f=editorFixture();f.model.heights.fill(30);f.terrain.updateMeshAll();f.model.state.water=0;
    const render={fog:new T.FogExp2(0xaabbcc),camera:f.render.camera} as RenderingSystem,env=createEnvironment(f.model,f.terrain,render,f.materials.environment);
    env.update(1,1);const plain=f.materials.environment.fogData.slice();assert.ok(f.model.state.wetness>0);
    f.model.world.waterBodies=[...f.model.world.waterBodies,{id:'lake',kind:'lake',level:29,width:1,wave:0,opacity:.7,points:[[-70,-70],[70,-70],[70,70],[-70,70]]}];env.update(0,0);assert.notDeepEqual(f.materials.environment.fogData,plain);
    f.model.state.fogIntensity=0;env.update(0,0);assert.equal(f.materials.environment.uniforms.uEnvLowFog.value,0);
});
const view:SavedViewpoint={id:'view-one',name:'Озеро',position:[12,20,40],target:[0,10,0],fov:47,roll:12,exposure:.65};
test('saved viewpoints and weather memory round-trip through format 8 and share undo with world edits',()=>{
    const f=editorFixture();Object.assign(f.model.state,{dayTime:23.5,dayCycle:true,dayDuration:12,wetness:.7,lowFog:1.2});const before=captureDocument(f.model);
    f.edits.replaceWorld({viewpoints:[view]},'Ракурс');const saved=decodeProject(f.storage.projectJSON());assert.equal(saved.version,11);assert.deepEqual(saved.world.viewpoints,[view]);assert.equal(saved.state.wetness,.7);assert.equal(saved.state.dayCycle,true);
    f.history.undo();assert.deepEqual(captureDocument(f.model),before);f.history.redo();assert.deepEqual(f.model.world.viewpoints,[view]);
});
test('legacy projects migrate missing weather settings and viewpoints; invalid new data is rejected atomically',async()=>{
    const f=editorFixture(),data=JSON.parse(f.storage.projectJSON());data.version=7;delete data.world.viewpoints;for(const key of ['dayTime','dayCycle','dayDuration','lowFog','wetness'])delete data.state[key];
    const migrated=decodeProject(JSON.stringify(data));assert.deepEqual(migrated.world.viewpoints,[]);assert.equal(migrated.state.wetness,0);assert.equal(migrated.state.dayCycle,false);
    const before=captureDocument(f.model),bad=JSON.parse(f.storage.projectJSON());bad.world.viewpoints=[{...view,fov:180}];await assert.rejects(f.storage.loadProjectText(JSON.stringify(bad)));assert.deepEqual(captureDocument(f.model),before);
    for(const key of ['dayTime','lowFog','wetness','dayDuration']){const p=JSON.parse(f.storage.projectJSON());p.state[key]=-1;assert.throws(()=>decodeProject(JSON.stringify(p)));}
    const missing=JSON.parse(f.storage.projectJSON());delete missing.world.viewpoints;assert.throws(()=>decodeProject(JSON.stringify(missing)));
});
test('a saved photographic camera restores its composition, lens and roll',()=>{
    const camera=new T.PerspectiveCamera(),target=new T.Vector3();applyPhotoView(camera,target,view);assert.deepEqual(camera.position.toArray(),view.position);assert.deepEqual(target.toArray(),view.target);assert.equal(camera.fov,47);
    const direction=camera.getWorldDirection(new T.Vector3()),expected=target.clone().sub(camera.position).normalize();assert.ok(direction.distanceTo(expected)<1e-12);assert.ok(Math.abs(camera.rotation.z)>.01);
});
test('regenerating vegetation cannot reuse a saved viewpoint ID',()=>{
    const f=editorFixture();f.vegetation.scatter();const id=f.model.world.objects.find(o=>o.source==='scatter')!.id;
    f.model.world.objects=[];f.edits.replaceWorld({viewpoints:[{...view,id}]});f.vegetation.scatter();assert.ok(f.model.world.objects.length>0);assert.equal(f.model.world.objects.some(o=>o.id===id),false);assert.equal(decodeProject(f.storage.projectJSON()).world.viewpoints[0].id,id);
});
function fakeRenderer(fail=false){let size=new T.Vector2(800,450),ratio=1.25;const draws:number[][]=[];
    const renderer={capabilities:{maxTextureSize:4096},getSize(out:T.Vector2){return out.copy(size);},getPixelRatio(){return ratio;},setPixelRatio(r:number){ratio=r;},setSize(w:number,h:number){size.set(w,h);},render(){draws.push([size.x,size.y,ratio]);},domElement:{toBlob(callback:(b:Blob|null)=>void){callback(fail?null:new Blob(['PNG'],{type:'image/png'}));}}} as unknown as T.WebGLRenderer;
    return {renderer,draws,get size(){return size;},get ratio(){return ratio;}};
}
test('PNG export renders at the requested size and restores the screen buffer after success or failure',async()=>{
    for(const failure of [false,true]){const f=fakeRenderer(failure),camera=new T.PerspectiveCamera(55,16/9);const task=capturePhotoPNG(f.renderer,camera,new T.Scene(),1920);if(failure)await assert.rejects(task);else assert.equal((await task).type,'image/png');assert.deepEqual(f.draws,[[1920,1080,1]]);assert.deepEqual(f.size.toArray(),[800,450]);assert.equal(f.ratio,1.25);assert.equal(camera.aspect,16/9);}
    const f=fakeRenderer();await assert.rejects(capturePhotoPNG(f.renderer,new T.PerspectiveCamera(55,16/9),new T.Scene(),8000));assert.equal(f.draws.length,0);
});
