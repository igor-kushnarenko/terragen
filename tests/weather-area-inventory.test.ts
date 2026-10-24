import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Scene,PerspectiveCamera,Vector3} from 'three';
import {createModel,HALF,SIZE} from '../src/state';
import {generateHeightmap,erodeHeightmap} from '../src/terrain-compute';
import {weatherStrengths,skyFogAmount} from '../src/atmosphere-settings';
import {createWalkLights} from '../src/walk-lights';
import {decodeProject,captureDocument} from '../src/project';
import {editorFixture} from './fixture';
import {createLandscape} from '../src/landscape';
import {shapeLandscape} from '../src/landscape-compute';
import {checkRoutes} from '../src/trail-earthworks';
import type {JobRunner} from '../src/worker-jobs';

test('empty hands hide the prop and both lights, persist, and can be undone before equipping again',()=>{
    const f=editorFixture(),scene=new Scene(),camera=new PerspectiveCamera(),lights=createWalkLights(f.model,scene,camera);f.edits.setWalkSettings({equippedLight:'lantern',lightEnabled:true});lights.update(0,true);assert.ok(lights.held.visible&&lights.lantern.visible);
    f.edits.setWalkSettings({equippedLight:'none',lightEnabled:false});lights.update(.1,true);assert.equal(lights.held.visible,false);assert.equal(lights.flashlight.visible,false);assert.equal(lights.lantern.visible,false);assert.equal(decodeProject(f.storage.projectJSON()).walkSettings.equippedLight,'none');
    f.history.undo();lights.update(0,true);assert.equal(lights.lantern.visible,true);f.history.redo();lights.update(0,true);assert.equal(lights.held.visible,false);f.edits.setWalkSettings({equippedLight:'flashlight',lightEnabled:true});lights.update(0,true);assert.equal(lights.flashlight.visible,true);lights.dispose();
});
test('weather strength disables all fog and precipitation and scales rain and snow independently of the preset',()=>{
    assert.deepEqual(weatherStrengths(.0005,.0032,1,0,0,0),{fog:0,rain:0,snow:0});
    const normal=weatherStrengths(.0005,.0032,1,0,1,1),strong=weatherStrengths(.0005,.0032,1,0,2,2);
    assert.equal(strong.rain,2);assert.ok(Math.abs(normal.fog-.0032*1.15)<1e-12);assert.equal(strong.fog,.55);
    assert.equal(weatherStrengths(.0005,0,0,1,.3,1).snow,.3);
    assert.equal(weatherStrengths(.0005,0,0,0,2,1).rain,0);
    assert.equal(weatherStrengths(.0005,0,0,0,1,0).fog,0);
});

test('maximum fog obscures objects beyond four metres in every weather while the lower half stays unchanged',()=>{
    for(const weatherFog of [0,.0008,.0018,.0025,.0032]){
        const baseline=weatherStrengths(.00003,weatherFog,0,0,1,1).fog;
        assert.equal(weatherStrengths(.00003,weatherFog,0,0,1,.5).fog,baseline*.5);
        let previous=0;
        for(let i=0;i<=40;i++){const fog=weatherStrengths(.00003,weatherFog,0,0,1,i/20).fog;assert.ok(fog>=previous);previous=fog;}
        const maximum=weatherStrengths(.00003,weatherFog,0,0,1,2).fog;
        assert.equal(skyFogAmount(0,0),0);assert.equal(skyFogAmount(maximum,1),1);
        assert.ok(Math.exp(-maximum*maximum*4*4)<.01);
        assert.ok(Math.exp(-maximum*maximum)>.7);
    }
});

test('small terrain stays inside its footprint, is surrounded by seabed and scales up to the full map deterministically',()=>{
    const model=createModel(),s=model.state;s.N=128;s.island=false;
    for(const size of [.125,.25,.5,1]){
        s.areaSize=size;const h=generateHeightmap(s);assert.deepEqual(generateHeightmap(s),h);
        let dry=0;for(let j=0;j<=s.N;j++)for(let i=0;i<=s.N;i++){
            const x=i/s.N*SIZE-HALF,z=j/s.N*SIZE-HALF,y=h[j*(s.N+1)+i];
            assert.ok(Number.isFinite(y));if(y>s.water)dry++;
            if(size<1&&Math.hypot(x,z)>=HALF*size)assert.ok(y<s.water-5);
        }
        assert.ok(dry>0);if(size===1)assert.ok(dry>h.length*.5);
    }
});

test('presets fit their complete route network on a small island and undo restores its size and terrain',async()=>{
    const jobs:JobRunner={async run(job,p){return job.kind==='terrain'?generateHeightmap(job.settings,p):job.kind==='shape'?shapeLandscape(job.settings,job.heights!,job.features,job.routes,job.waterBodies,p):erodeHeightmap(job.settings,job.seed,job.heights!,p);},cancel(){}};
    for(const seed of [1337,17,456])for(const preset of ['forest','coast','mountains','valley'] as const){
        const f=editorFixture(jobs);f.model.N=f.model.state.N=256;f.model.state.seed=f.model.seeds.terrain=seed;f.terrain.buildTerrain();f.model.heights=generateHeightmap(f.model.state);f.terrain.updateMeshAll();f.model.state.areaSize=.125;
        const before=captureDocument(f.model),landscape=createLandscape(f.model,f.terrain,f.materials,f.vegetation,f.history,f.feedback,jobs);
        assert.equal(await landscape.generatePreset(preset),true,preset);
        assert.equal(f.model.world.landmarks.length,5);assert.equal(f.model.world.routes.length,4);
        checkRoutes(f.model,f.model.world.routes,f.model.heights,true);
        for(const p of f.model.world.landmarks)assert.ok(Math.hypot(...p.position)<64,preset);
        assert.equal(new Set(f.model.world.landmarks.map(p=>p.position.join(','))).size,5);
        for(let j=0;j<=256;j++)for(let i=0;i<=256;i++)if(Math.hypot(i*4-HALF,j*4-HALF)>=64)assert.ok(f.model.heights[j*257+i]<f.model.state.water);
        f.history.undo();assert.deepEqual(captureDocument(f.model),before);
    }
});

test('held lights follow the camera, differ in coverage, respect quality and remain off outside walking',()=>{
    const model=createModel(),scene=new Scene(),camera=new PerspectiveCamera();camera.position.set(10,25,30);camera.rotation.set(-.2,.7,0,'YXZ');
    const lights=createWalkLights(model,scene,camera);model.walkSettings.lightEnabled=true;
    lights.update(.1,true);assert.equal(lights.flashlight.visible,true);assert.equal(lights.lantern.visible,false);assert.equal(lights.flashlight.castShadow,true);
    const view=camera.getWorldDirection(new Vector3()),beam=lights.flashlight.target.position.clone().sub(lights.flashlight.position).normalize();
    assert.ok(view.dot(beam)>.999);assert.ok(lights.flashlight.position.distanceTo(camera.position)<1);
    model.walkSettings.equippedLight='lantern';lights.update(.1,true);assert.equal(lights.flashlight.visible,false);assert.equal(lights.lantern.visible,true);assert.ok(lights.lantern.position.distanceTo(camera.position)<1);
    assert.ok(lights.lantern.color.r>lights.lantern.color.b);assert.equal(lights.lantern.distance,18);
    model.state.quality='low';lights.update(.1,true);assert.equal(lights.lantern.castShadow,false);
    model.walkSettings.lightEnabled=false;lights.update(.1,true);assert.equal(lights.lantern.visible,false);
    model.walkSettings.lightEnabled=true;lights.update(.1,false);assert.equal(lights.held.visible,false);assert.equal(lights.lantern.visible,false);assert.equal(lights.flashlight.visible,false);
    assert.equal(model.walkSettings.lightEnabled,true);lights.dispose();assert.equal(scene.children.includes(lights.lantern),false);
});

test('format 6 saves weather, territory size and equipment; format 5 migrates and invalid new data is rejected atomically',async()=>{
    const f=editorFixture();f.model.state.areaSize=.25;f.model.state.precipitation=1.75;f.model.state.fogIntensity=.2;f.model.walkSettings.equippedLight='lantern';f.model.walkSettings.lightEnabled=true;
    const text=f.storage.projectJSON(),saved=decodeProject(text);assert.equal(saved.version,11);assert.equal(saved.state.areaSize,.25);assert.equal(saved.state.precipitation,1.75);assert.equal(saved.state.fogIntensity,.2);assert.equal(saved.walkSettings.equippedLight,'lantern');assert.equal(saved.walkSettings.lightEnabled,true);
    const old=JSON.parse(text);old.version=5;for(const key of ['areaSize','precipitation','fogIntensity'])delete old.state[key];delete old.walkSettings.equippedLight;delete old.walkSettings.lightEnabled;
    const migrated=decodeProject(JSON.stringify(old));assert.equal(migrated.state.areaSize,1);assert.equal(migrated.state.fogIntensity,1);assert.equal(migrated.state.precipitation,1);assert.equal(migrated.walkSettings.lightEnabled,false);
    const before=captureDocument(f.model);
    for(const mutate of [
        (d:any)=>{d.state.areaSize=0;},(d:any)=>{d.state.areaSize=2;},(d:any)=>{d.state.precipitation=-1;},(d:any)=>{d.state.fogIntensity=3;},
        (d:any)=>{delete d.state.areaSize;},(d:any)=>{d.walkSettings.equippedLight='unknown';},(d:any)=>{d.walkSettings.lightEnabled='yes';},(d:any)=>{delete d.walkSettings.lightEnabled;},
    ]){const d=JSON.parse(text);mutate(d);await assert.rejects(f.storage.loadProjectText(JSON.stringify(d)),/Неверный проект/);assert.deepEqual(captureDocument(f.model),before);}
});
