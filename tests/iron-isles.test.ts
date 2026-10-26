import test from 'node:test';
import assert from 'node:assert/strict';
import {createModel} from '../src/state';
import {ironDefaults,IRON_VARIANTS,IRON_LIMITS,IRON_TERRAIN_KEYS,validateIron,type IronVariant} from '../src/iron-settings';
import {createIronHeightField,ironPuddles} from '../src/iron-terrain';
import {worldSettings,defaultWorldRequest,createWorldGeneration} from '../src/world-generation';
import {computeTerrainJob} from '../src/terrain-pipeline';
import {editorFixture} from './fixture';
import {captureDocument,decodeProject} from '../src/project';
import {applyIronSettings} from '../src/iron-editor';
import {createIronHabitat,ironSurfaceMap} from '../src/iron-habitat';
import {ironSurfSites} from '../src/iron-surf';
import {getModel} from '../src/model-library';
import {foliagePoints} from '../src/fine-foliage';
import {IRON_PLANTS,IRON_ROCKS,makeIronModel} from '../src/iron-models';

const request=(variant:IronVariant='isles')=>({...defaultWorldRequest(),preset:'iron-islands' as const,iron:ironDefaults(variant),N:128,erosion:0 as const,routes:false});
function fixture(){const f=editorFixture();return {...f,generator:createWorldGeneration(f.model,f.terrain,f.materials,f.vegetation,f.history,f.feedback,{async run(j,p){return computeTerrainJob(j,p);},cancel(){}})};}

test('coastal models have valid lighting normals, opaque shared materials and progressively cheaper LODs',()=>{
    for(const id of Object.keys({...IRON_PLANTS,...IRON_ROCKS}) as (keyof typeof IRON_PLANTS|keyof typeof IRON_ROCKS)[]){
        let previous=Infinity;
        for(let level=0;level<3;level++){
            const root=makeIronModel(id,level);assert.equal(root.children.length,1);
            const mesh=root.children[0] as import('three').Mesh<import('three').BufferGeometry,import('three').MeshStandardMaterial>,g=mesh.geometry,n=g.attributes.normal;
            assert.equal(mesh.material.transparent,false);assert.ok(g.attributes.position.count<=previous);previous=g.attributes.position.count;
            for(let i=0;i<n.count;i++)assert.ok(Math.hypot(n.getX(i),n.getY(i),n.getZ(i))>.9,id+' has nonzero lighting normals');
            g.dispose();mesh.material.dispose();
        }
    }
});

test('all five Iron Isles presets reproduce geology with deep open sea, steep walls and plateau treads',()=>{
    for(const variant of Object.keys(IRON_VARIANTS) as IronVariant[]){
        const r=request(variant),s=worldSettings(createModel().state,r),progress:number[]=[],job={kind:'terrain' as const,settings:s,preset:r.preset,seed:s.seed,iron:r.iron,worldErosion:0 as const};
        const h=computeTerrainJob(job,p=>progress.push(p));assert.deepEqual(h,computeTerrainJob(job));assert.ok(h.every(Number.isFinite));
        const dry=h.filter(v=>v>s.water+1).length/h.length;assert.ok(dry>.04&&dry<.7,variant+' land fraction '+dry);
        assert.ok(Math.min(...h)<s.water-r.iron.oceanDepth*.8);assert.ok(Math.max(...h)>s.water+r.iron.cliffHeight*.5);
        let walls=0,plateaus=0;
        for(let z=1;z<128;z++)for(let x=1;x<128;x++){const k=z*129+x;if(h[k]<=s.water+3)continue;const grade=Math.hypot(h[k+1]-h[k-1],h[k+129]-h[k-129])/16;if(grade>1.5)walls++;if(grade<.15)plateaus++;}
        assert.ok(walls>15,variant+' has cliff faces');assert.ok(plateaus>15,variant+' has walkable plateau treads');
        assert.equal(progress.at(-1),1);for(let i=1;i<progress.length;i++)assert.ok(progress[i]>=progress[i-1]);
    }
});

test('geological controls affect terrain while weather, ocean appearance and plants preserve the cached heightfield',async()=>{
    const f=fixture(),r=request();let calls=0;
    const generator=createWorldGeneration(f.model,f.terrain,f.materials,f.vegetation,f.history,f.feedback,{async run(j,p){calls++;return computeTerrainJob(j,p);},cancel(){}});
    const a=await generator.preview(r);
    await generator.preview({...r,iron:{...r.iron,windStrength:3,rainIntensity:1,seaFoam:2,vegetationDensity:.9}});assert.equal(calls,1);
    for(const key of IRON_TERRAIN_KEYS){
        const limits=IRON_LIMITS[key],value=r.iron[key]===limits[1]?limits[0]:limits[1];
        const b=await generator.preview({...r,iron:{...r.iron,[key]:value}});assert.notDeepEqual(a,b,key+' changes geology');
    }
    const s=worldSettings(createModel().state,r),height=createIronHeightField(s,r.iron),coarse=computeTerrainJob({kind:'terrain',settings:{...s,N:64},preset:r.preset,seed:s.seed,iron:r.iron,worldErosion:0});
    for(let z=0;z<=64;z++)for(let x=0;x<=64;x++)assert.ok(Math.abs(coarse[z*65+x]-height((x/64-.5)*1024,(z/64-.5)*1024))<.00002);
});

test('Iron Isles weather updates are undoable without rebuilding terrain, scatter or static collider inputs',async()=>{
    const f=fixture();await f.generator.generate(request());
    const before=captureDocument(f.model),heights=f.model.heights,objects=f.model.world.objects,revision=f.model.terrainRevision,depth=f.history.undoDepth;
    const next={...f.model.world.recipe!.iron!,windStrength:2.9,rainIntensity:.75,seaFoam:1.8,seaSpray:1,waveRoughness:1};
    const result=applyIronSettings(f.model,f.terrain,f.history,f.vegetation,f.materials,next);
    assert.equal(result.plantsChanged,false);assert.strictEqual(f.model.heights,heights);assert.strictEqual(f.model.world.objects,objects);assert.equal(f.model.terrainRevision,revision);assert.equal(f.model.state.windSpeed,2.9);assert.equal(f.history.undoDepth,depth+1);
    assert.deepEqual(decodeProject(f.storage.projectJSON()).world.recipe!.iron,next);
    const after=captureDocument(f.model);f.history.undo();assert.deepEqual(captureDocument(f.model),before);f.history.redo();assert.deepEqual(captureDocument(f.model),after);
});

test('sparse coastal plants stay dry and low, cover follows shelter and manual objects and stacks survive replanting',async()=>{
    const f=fixture();await f.generator.generate({...request(),N:256});
    const plants=f.model.world.objects.filter(o=>getModel(o.asset).category==='shrub');assert.ok(plants.length>5);assert.ok(plants.length<500);
    assert.ok(f.model.world.objects.every(o=>getModel(o.asset).category!=='tree'));
    for(const p of plants){assert.ok(f.terrain.getH(p.position[0],p.position[2])>f.model.state.water+1.4);assert.ok(getModel(p.asset).bounds.max.y*p.scale[1]<1.5);}
    const manual={...plants[0],id:'manual-plant',source:'manual' as const};f.model.world.objects=[...f.model.world.objects,manual];
    const rocks=f.model.world.objects.filter(o=>getModel(o.asset).category==='rock'),h=f.model.heights;
    applyIronSettings(f.model,f.terrain,f.history,f.vegetation,f.materials,{...f.model.world.recipe!.iron!,vegetationDensity:.6,grassCoverage:.7});
    assert.strictEqual(f.model.heights,h);assert.deepEqual(f.model.world.objects.find(o=>o.id==='manual-plant'),manual);for(const rock of rocks)assert.deepEqual(f.model.world.objects.find(o=>o.id===rock.id),rock);
    const habitat=createIronHabitat(f.model,f.terrain),sheltered:number[]=[],exposed:number[]=[];
    for(let z=-450;z<450;z+=15)for(let x=-450;x<450;x+=15){const e=habitat.sample(x,z);if(e.dry&&e.ny>.9){(e.shelter>.1?sheltered:exposed).push(e.vegetation);}}
    assert.ok(exposed.length>0);assert.ok(ironSurfaceMap(f.model).some(v=>v>0));
    const wet=foliagePoints(f.model,{getH:()=>f.model.state.water-3,getNormalY:()=>1},0,0);assert.equal(wet.length,0);
});

test('spray sites lie on the edited coastline with bounded budgets and puddles use existing inland water bodies',async()=>{
    const f=fixture();await f.generator.generate({...request(),N:256});
    const sites=ironSurfSites(f.model,f.terrain.getH);assert.ok(sites.length>10&&sites.length<=256);
    for(const p of sites){assert.ok(Math.abs(f.terrain.getH(p.x,p.z)-f.model.state.water)<.1);assert.ok(Math.abs(Math.hypot(p.dx,p.dz)-1)<1e-6);}
    const puddles=ironPuddles(f.model.state,f.model.world.recipe!.iron!);assert.ok(puddles.length>0&&puddles.length<=3);
    for(const p of puddles){assert.equal(p.kind,'lake');assert.ok(p.level>f.model.state.water+10);assert.ok(p.depth!<1);}
    f.model.heights.fill(f.model.state.water-30);f.terrain.updateMeshAll();assert.equal(ironSurfSites(f.model,f.terrain.getH).length,0);
    f.model.world.preset='desert';assert.equal(ironSurfaceMap(f.model).some(v=>v!==0),false);
});

test('Iron Isles settings reject invalid documents before mutation and old Iron Isles worlds still load',async()=>{
    const f=fixture();await f.generator.generate({...request(),N:32});const before=captureDocument(f.model),raw=JSON.parse(f.storage.projectJSON());
    for(const bad of [{...ironDefaults(),islandCount:3.5},{...ironDefaults(),surfaceWetness:2},{...ironDefaults(),windStrength:NaN},{...ironDefaults(),variant:'unknown'}])assert.throws(()=>validateIron(bad));
    for(const mutate of [(d:any)=>d.world.recipe.iron.islandSize=-1,(d:any)=>delete d.world.recipe.iron.cloudCoverage,(d:any)=>d.world.recipe.iron.variant='oops']){const d=structuredClone(raw);mutate(d);await assert.rejects(f.storage.loadProjectText(JSON.stringify(d)),/Неверный проект/);assert.deepEqual(captureDocument(f.model),before);}
    delete raw.world.recipe.iron;assert.equal(decodeProject(JSON.stringify(raw)).world.preset,'iron-islands');
});
