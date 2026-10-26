import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Box3} from 'three';
import {editorFixture} from './fixture';
import {WORLD_PRESET_IDS} from '../src/world';
import {WORLD_PRESETS} from '../src/world-recipes';
import {createWorldGeneration,defaultWorldRequest,worldSettings} from '../src/world-generation';
import {computeTerrainJob} from '../src/terrain-pipeline';
import {createModel} from '../src/state';
import {captureDocument,decodeProject} from '../src/project';
import {OperationCancelled,type JobRunner} from '../src/worker-jobs';
import {WORLD_PLANTS,makeWorldPlant} from '../src/world-models';
import {getModel} from '../src/model-library';
import {createEcology} from '../src/ecology';
import {WORLD_TERRAIN_ALGORITHM} from '../src/generation-settings';

function components(h:Float32Array,N:number,level:number){
    const seen=new Uint8Array(h.length),sizes:number[]=[],n=N+1;
    for(let k=0;k<h.length;k++)if(!seen[k]&&h[k]>level+1){const queue=[k];seen[k]=1;for(let i=0;i<queue.length;i++){const at=queue[i];for(const next of [at-1,at+1,at-n,at+n])if(next>=0&&next<h.length&&!seen[next]&&h[next]>level+1){seen[next]=1;queue.push(next);}}sizes.push(queue.length);}
    return sizes.filter(s=>s>8);
}
function fixture(jobs?:JobRunner){const f=editorFixture();return {...f,generator:createWorldGeneration(f.model,f.terrain,f.materials,f.vegetation,f.history,f.feedback,jobs??{async run(j,p){return computeTerrainJob(j,p);},cancel(){}})};}

test('six recipes produce different deterministic macro landforms and appropriate land/water coverage',()=>{
    const base=createModel().state,signatures=new Set<string>();
    for(const preset of WORLD_PRESET_IDS){
        const settings=worldSettings(base,{...defaultWorldRequest(),preset,N:128,erosion:0}),job={kind:'terrain' as const,settings,preset,seed:settings.seed,worldErosion:0 as const};
        const h=computeTerrainJob(job);assert.deepEqual(computeTerrainJob(job),h,preset);assert.ok(h.every(Number.isFinite));
        const dry=h.filter(y=>y>settings.water+1).length/h.length;signatures.add(Array.from(h.filter((_,i)=>i%67===0)).join(','));
        if(['archipelago','iron-islands'].includes(preset)){assert.ok(dry>.03&&dry<.55,preset+' dry '+dry);assert.ok(components(h,128,settings.water).length>=3,preset+' islands');}
        if(preset==='fjords')assert.ok(dry>.2&&dry<.9,'fjords land/water');
        if(['desert','taiga','jungle'].includes(preset))assert.ok(dry>.95,preset);
    }
    assert.equal(signatures.size,6);
});

test('single-worker erosion stages are reproducible, monotonic and change the terrain',()=>{
    const settings=worldSettings(createModel().state,{...defaultWorldRequest(),preset:'taiga',N:64}),progress:number[]=[];
    const job={kind:'terrain' as const,settings,preset:'taiga' as const,seed:settings.seed,worldErosion:1 as const};
    const heights=computeTerrainJob(job,p=>progress.push(p));assert.deepEqual(computeTerrainJob(job),heights);assert.notDeepEqual(computeTerrainJob({...job,worldErosion:0}),heights);
    assert.equal(progress.at(-1),1);for(let i=1;i<progress.length;i++)assert.ok(progress[i]>=progress[i-1]);
});

test('preview is isolated, cached, invalidated by terrain settings and bounded in memory',async()=>{
    let calls=0;const f=fixture({async run(j,p){calls++;return computeTerrainJob(j,p);},cancel(){}}),before=captureDocument(f.model),depth=f.history.undoDepth,r={...defaultWorldRequest(),N:128};
    const a=await f.generator.preview(r);a.fill(-999);const b=await f.generator.preview(r);assert.ok(b.some(v=>v!==-999));assert.equal(calls,1);
    f.model.state.exposure=.8;await f.generator.preview(r);assert.equal(calls,1,'appearance is not part of the terrain cache key');f.model.state.exposure=before.state.exposure;
    await f.generator.preview({...r,terrain:{height:160}});assert.equal(calls,2);
    for(let seed=1;seed<7;seed++)await f.generator.preview({...r,seed});assert.equal(f.generator.cacheSize,4);
    assert.deepEqual(captureDocument(f.model),before);assert.equal(f.history.undoDepth,depth);
});

test('world creation is one reversible edit and saves species, recipe, atmosphere and route corridors',async()=>{
    const f=fixture(),before=captureDocument(f.model),depth=f.history.undoDepth;
    assert.equal(await f.generator.generate({...defaultWorldRequest(),preset:'archipelago',N:128}),true);
    assert.equal(f.history.undoDepth,depth+1);assert.equal(f.model.world.preset,'archipelago');assert.equal(f.model.world.recipe?.version,1);
    assert.ok(f.model.world.objects.some(o=>o.asset==='palm'));assert.ok(f.model.world.landmarks.length>0);
    assert.equal(f.model.state.weather,WORLD_PRESETS.archipelago.settings.weather);
    assert.ok(f.model.world.objects.every(o=>['palm','coastal-bush','rock','boulder'].includes(o.asset)));
    for(const route of f.model.world.routes)for(const [x,z]of route.points)assert.ok(f.terrain.getH(x,z)>f.model.state.water+1);
    const after=captureDocument(f.model),loaded=decodeProject(f.storage.projectJSON());assert.equal(loaded.version,11);assert.deepEqual(loaded.world,f.model.world);
    assert.equal(loaded.operations.find(op=>op.kind==='preset')?.algorithmVersion,WORLD_TERRAIN_ALGORITHM);
    f.history.undo();assert.deepEqual(captureDocument(f.model),before);f.history.redo();assert.deepEqual(captureDocument(f.model),after);
});

test('cancellation preserves the previous complete document, seeds and undo history',async()=>{
    const f=fixture({async run(){throw new OperationCancelled();},cancel(){}}),before=captureDocument(f.model),depth=f.history.undoDepth;
    assert.equal(await f.generator.generate({...defaultWorldRequest(),preset:'jungle'}),false);assert.deepEqual(captureDocument(f.model),before);assert.equal(f.history.undoDepth,depth);assert.equal(f.model.busy,false);
});

test('all six populated worlds validate at the full-map boundary and contain their own plants',async()=>{
    for(const preset of WORLD_PRESET_IDS){
        const f=fixture();assert.equal(await f.generator.generate({...defaultWorldRequest(),preset,N:64}),true,preset);
        const world=decodeProject(f.storage.projectJSON()).world;
        assert.ok(world.objects.every(o=>Math.abs(o.position[0])<=512&&Math.abs(o.position[2])<=512),preset);
        const species=preset==='iron-islands'?WORLD_PRESETS[preset].shrubs:WORLD_PRESETS[preset].trees;
        assert.ok(world.objects.some(o=>species.includes(o.asset)),preset+' species');
        if(preset==='iron-islands')assert.ok(world.objects.every(o=>getModel(o.asset).category!=='tree'),'Iron Isles has no forests');
    }
});

test('plant-free generation disables both authored scatter and automatic near-camera foliage',async()=>{
    const f=fixture();assert.equal(await f.generator.generate({...defaultWorldRequest(),preset:'desert',N:64,plants:false,routes:false}),true);
    assert.equal(f.model.world.objects.length,0);assert.equal(f.model.state.showFoliage,false);assert.equal(f.model.state.showScatter,false);assert.equal(f.model.world.routes.length,0);
});

test('new recipe metadata is fully validated before loading and version 8 still loads',async()=>{
    const f=fixture();await f.generator.generate({...defaultWorldRequest(),N:64,plants:false});const raw=JSON.parse(f.storage.projectJSON()),before=captureDocument(f.model);
    for(const change of [(d:any)=>delete d.world.recipe,(d:any)=>d.world.recipe.version=2,(d:any)=>d.world.recipe.seed=-1,(d:any)=>d.world.recipe.erosion=.5,(d:any)=>d.world.recipe.routes='yes']){
        const d=structuredClone(raw);change(d);await assert.rejects(f.storage.loadProjectText(JSON.stringify(d)),/Неверный проект/);assert.deepEqual(captureDocument(f.model),before);
    }
    const old=JSON.parse(editorFixture().storage.projectJSON());old.version=8;delete old.world.recipe;assert.equal(decodeProject(JSON.stringify(old)).version,11);
});

test('new opaque species have valid envelopes and no more than two draw parts per LOD',()=>{
    for(const id of Object.keys(WORLD_PLANTS) as (keyof typeof WORLD_PLANTS)[]){
        assert.ok(getModel(id));for(let level=0;level<3;level++){
            const model=makeWorldPlant(id,level),box=new Box3().setFromObject(model);assert.ok(!box.isEmpty()&&box.max.y>0,id);assert.ok(model.children.length<=2,id);
            model.traverse(o=>{if('geometry'in o){const mesh=o as import('three').Mesh;assert.ok(mesh.geometry.getAttribute('position').array.every(Number.isFinite));mesh.geometry.dispose();const materials=Array.isArray(mesh.material)?mesh.material:[mesh.material];for(const m of materials){assert.equal(m.transparent,false);m.dispose();}}});
        }
    }
});

test('a global taiga biome retains groves and clearings instead of uniform coverage',()=>{
    const f=fixture();f.model.world.preset='taiga';f.model.heights.fill(30);f.terrain.updateMeshAll();
    f.model.world.biomes=[{id:'taiga',name:'Тайга',kind:'forest',center:[0,0],radius:1024}];
    const ecology=createEcology(f.model,f.terrain),values:number[]=[];
    for(let z=-400;z<=400;z+=40)for(let x=-400;x<=400;x+=40)values.push(ecology.sample(x,z).forest);
    assert.ok(Math.max(...values)>.6);assert.ok(Math.min(...values)<.1);
    assert.ok(values.filter(v=>v<.2).length>20);assert.ok(values.filter(v=>v>.5).length>20);
});
