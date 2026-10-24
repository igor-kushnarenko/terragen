import {test} from 'node:test';
import assert from 'node:assert/strict';
import {editorFixture} from './fixture';
import {createLandscape} from '../src/landscape';
import {LANDSCAPE_PRESETS} from '../src/presets';
import {shapeLandscape} from '../src/landscape-compute';
import {generateHeightmap,erodeHeightmap} from '../src/terrain-compute';
import {trailCurve,RouteIndex,controlPointHit} from '../src/trail-math';
import {Ray,Vector3} from 'three';
import {checkRoutes} from '../src/trail-earthworks';
import {captureDocument,decodeProject} from '../src/project';
import {biomeMaterialMap,BIOME_MAP_SIZE} from '../src/biome-materials';
import {createWorld,deriveSeeds,type LandscapePresetId} from '../src/world';
import {createEcology} from '../src/ecology';
import {scatterObjects} from '../src/scatter';
import {OperationCancelled,type JobRunner} from '../src/worker-jobs';
function fixture(jobs:JobRunner={async run(job,p){return job.kind==='terrain'?generateHeightmap(job.settings,p):job.kind==='shape'?shapeLandscape(job.settings,job.heights!,job.features,job.routes,job.waterBodies,p):erodeHeightmap(job.settings,job.seed,job.heights!,p);},cancel(){}}){
    const f=editorFixture(jobs);return {...f,landscape:createLandscape(f.model,f.terrain,f.materials,f.vegetation,f.history,f.feedback,jobs)};
}
test('four presets create a deterministic connected landscape with walkable trails and coherent settings',async()=>{
    for(const preset of Object.keys(LANDSCAPE_PRESETS) as LandscapePresetId[]){
        const f=fixture();assert.equal(await f.landscape.generatePreset(preset),true,preset);
        assert.equal(f.model.world.preset,preset);assert.equal(f.model.world.landmarks.length,5);assert.equal(f.model.world.routes.length,4);
        checkRoutes(f.model,f.model.world.routes,f.model.heights,true);
        const snapshot=captureDocument(f.model);assert.equal(await f.landscape.generatePreset(preset),true);assert.deepEqual(captureDocument(f.model).heights,snapshot.heights);assert.deepEqual(f.model.world,snapshot.world);
        const loaded=decodeProject(f.storage.projectJSON());assert.deepEqual(loaded.world,f.model.world);assert.equal(loaded.version,11);
    }
});
test('trail earthworks, paint and clearance commit as one edit and round-trip through undo and redo',async()=>{
    const f=fixture();f.model.state.water=0;f.model.world.waterBodies[0].level=0;f.model.heights.fill(30);f.terrain.updateMeshAll();
    f.edits.addObject('pine',0,0);const before=captureDocument(f.model),depth=f.history.undoDepth;
    assert.equal(await f.landscape.buildTrail({name:'Тропа',controls:[[-150,-30],[0,0],[150,30]],width:8,surface:'gravel',maxGrade:0.3}),true);
    assert.equal(f.history.undoDepth,depth+1);assert.equal(f.model.world.objects.length,0);assert.ok(f.model.splatDetail.some((v,i)=>i%4===2&&v>0));
    checkRoutes(f.model,f.model.world.routes,f.model.heights,true);const after=captureDocument(f.model);
    f.history.undo();assert.deepEqual(captureDocument(f.model),before);f.history.redo();assert.deepEqual(captureDocument(f.model),after);
});
test('water and authored solid obstacles reject a trail without changing the document',async()=>{
    const f=fixture();f.model.heights.fill(30);f.terrain.updateMeshAll();f.edits.addObject('boulder',0,0);let before=captureDocument(f.model);
    const draft={name:'Тропа',controls:[[-100,0],[100,0]] as [number,number][],width:8,surface:'soil' as const,maxGrade:0.3};
    await assert.rejects(f.landscape.buildTrail(draft),/препятствие/);assert.deepEqual(captureDocument(f.model),before);
    f.model.world.objects=[];f.model.state.water=35;f.model.world.waterBodies[0].level=35;before=captureDocument(f.model);
    await assert.rejects(f.landscape.buildTrail(draft),/воду/);assert.deepEqual(captureDocument(f.model),before);assert.equal(f.model.busy,false);
});
test('automatic composition preserves authored trees and takes its trails around them',async()=>{
    const f=fixture(),id=f.edits.addObject('pine',0,0)!;assert.equal(await f.landscape.generatePreset('forest'),true);
    assert.ok(f.model.world.objects.some(o=>o.id===id));checkRoutes(f.model,f.model.world.routes,f.model.heights,true,true);
});
test('cancellation rolls back preset settings, terrain, entities, seeds and history',async()=>{
    const jobs:JobRunner={async run(){throw new OperationCancelled();},cancel(){}};const f=fixture(jobs),before=captureDocument(f.model),depth=f.history.undoDepth;
    assert.equal(await f.landscape.generatePreset('coast'),false);assert.deepEqual(captureDocument(f.model),before);assert.equal(f.history.undoDepth,depth);assert.equal(f.model.busy,false);
});
test('cancellation after the new terrain has been computed restores the previous world completely',async()=>{
    let count=0;const jobs:JobRunner={async run(job,p){if(++count===2)throw new OperationCancelled();return generateHeightmap(job.settings,p);},cancel(){}};
    const f=fixture(jobs),before=captureDocument(f.model),depth=f.history.undoDepth;
    assert.equal(await f.landscape.generatePreset('mountains'),false);assert.equal(count,2);assert.deepEqual(captureDocument(f.model),before);assert.equal(f.history.undoDepth,depth);
});
test('a curved trail corrects steep terrain and checks the actual triangle gradients across its width',async()=>{
    const f=fixture();f.model.state.water=-20;f.model.world.waterBodies[0].level=-20;
    for(let j=0;j<f.model.n;j++)for(let i=0;i<f.model.n;i++)f.model.heights[j*f.model.n+i]=40+(i>16?150:0)+Math.sin(i)*12;
    f.terrain.updateMeshAll();const before=f.model.heights.slice();
    assert.equal(await f.landscape.buildTrail({name:'Серпантин',controls:[[-240,-40],[-60,60],[120,20],[250,-30]],width:10,maxGrade:0.25,surface:'soil'}),true);
    assert.notDeepEqual(f.model.heights,before);checkRoutes(f.model,f.model.world.routes,f.model.heights,true);
});
test('a new crossing trail keeps the entire previously graded network passable',async()=>{
    const f=fixture();f.model.state.water=-20;f.model.world.waterBodies[0].level=-20;
    for(let j=0;j<f.model.n;j++)for(let i=0;i<f.model.n;i++)f.model.heights[j*f.model.n+i]=40+i*5+j*2;
    f.terrain.updateMeshAll();
    await f.landscape.buildTrail({name:'Восток',controls:[[-240,0],[240,0]],width:8,maxGrade:0.3,surface:'gravel'});
    await f.landscape.buildTrail({name:'Север',controls:[[0,-240],[0,240]],width:8,maxGrade:0.18,surface:'soil'});
    assert.equal(f.model.world.routes.length,2);checkRoutes(f.model,f.model.world.routes,f.model.heights,true);
});
test('preset compositions connect all five places across several independent seeds',async()=>{
    for(const preset of Object.keys(LANDSCAPE_PRESETS) as LandscapePresetId[])for(const seed of [17,456,9001]){
        const f=fixture();f.edits.setSeeds({terrain:seed},true);assert.equal(await f.landscape.generatePreset(preset).catch(error=>{throw new Error(`${preset}, seed ${seed}: ${error.message}`);}),true,`${preset}, seed ${seed}`);
        checkRoutes(f.model,f.model.world.routes,f.model.heights,true);
        const edges=f.model.world.routes;const reached=new Set<string>([JSON.stringify(f.model.world.landmarks[0].position)]);
        for(let i=0;i<5;i++)for(const edge of edges){const a=JSON.stringify(edge.points[0]),b=JSON.stringify(edge.points.at(-1));if(reached.has(a))reached.add(b);if(reached.has(b))reached.add(a);}
        for(const point of f.model.world.landmarks)assert.ok(reached.has(JSON.stringify(point.position)));
    }
});
test('curve sampling keeps endpoints, avoids duplicate points and corridor indexing matches exact local distances',()=>{
    const curve=trailCurve([[-100,0],[0,50],[100,0]],2);assert.deepEqual(curve[0],[-100,0]);assert.deepEqual(curve.at(-1),[100,0]);assert.ok(curve.length>100);
    const index=new RouteIndex([{id:'a',name:'A',kind:'trail',width:8,points:curve}]);assert.ok(index.clearance(0,50)<-3.9);assert.equal(index.clearance(400,400),Infinity);
    assert.deepEqual(trailCurve([[0,0],[0,0],[40,0]],2),trailCurve([[0,0],[40,0]],2));
});
test('a raised curve marker is picked by its visible sphere rather than the ground behind it',()=>{
    const controls:[number,number][]=[[-10,0],[0,0],[10,0]],origin=new Vector3(15,20,30),center=new Vector3(0,3,0),ray=new Ray(origin,center.clone().sub(origin).normalize());
    assert.equal(controlPointHit(ray,controls,()=>0,3),1);assert.equal(controlPointHit(new Ray(origin,new Vector3(0,1,0)),controls,()=>0,3),-1);
});
test('biome recipes blend materials locally and keep clearings free from the global preset',()=>{
    const world=createWorld();world.preset='forest';world.biomes=[{id:'c',name:'Полянa',kind:'meadow',center:[0,0],radius:90},{id:'b',name:'Берег',kind:'coast',center:[200,0],radius:80}];
    const data=biomeMaterialMap(world),pixel=(x:number,z:number,c:number)=>data[(Math.floor((z+512)/1024*BIOME_MAP_SIZE)*BIOME_MAP_SIZE+Math.floor((x+512)/1024*BIOME_MAP_SIZE))*4+c];
    assert.equal(pixel(0,0,0),0);assert.ok(pixel(200,0,1)>250);assert.equal(pixel(-300,0,0),255);
    const f=fixture();f.model.heights.fill(30);f.terrain.updateMeshAll();f.model.world.biomes=[{id:'global',name:'Лес',kind:'forest',center:[0,0],radius:1024},world.biomes[0]];
    const ecology=createEcology(f.model,f.terrain);assert.equal(ecology.sample(0,0).kind,'meadow');assert.equal(ecology.sample(0,0).forest,0);
});
test('a sparse coast biome still places trees and favors coastal pines',()=>{
    const f=fixture();f.model.heights.fill(30);f.terrain.updateMeshAll();f.model.state.water=18;f.model.state.snowLine=260;f.model.state.treeDensity=0.03;f.model.state.rockDensity=0;
    f.model.world.preset='coast';f.model.world.biomes=[{id:'coast',name:'Берег',kind:'coast',center:[0,0],radius:1024}];
    const result=scatterObjects(f.model,f.terrain),trees=result.objects.filter(o=>['pine','spruce','oak','birch'].includes(o.asset));
    assert.ok(trees.length>100);assert.ok(trees.filter(o=>o.asset==='pine').length>trees.length/2);
});
test('format 4 migrates new fields and malformed curve, landmark and preset data are rejected atomically',async()=>{
    const f=fixture(),data=JSON.parse(f.storage.projectJSON());data.version=4;delete data.world.preset;delete data.world.landmarks;delete data.seeds.composition;
    const old=decodeProject(JSON.stringify(data));assert.equal(old.version,11);assert.deepEqual(old.world.landmarks,[]);assert.equal(old.seeds.composition,deriveSeeds(data.state.seed).composition);
    for(const patch of [{preset:'unknown'},{landmarks:[{id:'x',name:'X',kind:'viewpoint',position:[Infinity,0],radius:20}]},{routes:[{id:'r',name:'R',kind:'trail',width:8,points:[[0,0],[20,20]],controlPoints:[[0,0]],curve:'centripetal'}]}]){
        const modern=JSON.parse(f.storage.projectJSON());Object.assign(modern.world,patch);const before=captureDocument(f.model);await assert.rejects(f.storage.loadProjectText(JSON.stringify(modern)));assert.deepEqual(captureDocument(f.model),before);
    }
});
