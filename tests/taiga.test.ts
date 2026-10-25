import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Mesh} from 'three';
import {taigaWorld} from '../verification/taiga-world';
import {taigaDefaults,TAIGA_VARIANTS,TAIGA_LIMITS,validateTaiga} from '../src/taiga-settings';
import {TAIGA_PLANTS,makeTaigaPlant,type TaigaPlantId} from '../src/taiga-models';
import {scatterObjects} from '../src/scatter';
import {getModel} from '../src/model-library';
import {modelLOD} from '../src/model-lod';
import {waterLevelAt,waterSignedDistance} from '../src/water-math';
import {taigaSurfaceMaps} from '../src/taiga-surface';
import {foliagePoints,taigaGroundContext} from '../src/fine-foliage';
import {applyDocument,captureDocument,decodeProject} from '../src/project';
import {editorFixture} from './fixture';
import {applyTaigaSettings} from '../src/taiga-editor';
import {taigaRegion} from '../src/taiga-habitat';
import {createWorldGeneration,defaultWorldRequest} from '../src/world-generation';
import {computeTerrainJob} from '../src/terrain-pipeline';
import {objectFootprint,FootprintIndex} from '../src/ecology';

test('taiga is reproducible across seeds, gently rolling and stratified, with root spacing',()=>{
    for(const seed of [424242,71,2026]){
        const f=taigaWorld(taigaDefaults(),seed),trees=f.model.world.objects.filter(o=>getModel(o.asset).category==='tree');
        assert.deepEqual(scatterObjects(f.model,f.terrain).objects,f.model.world.objects);
        assert.ok(f.stats.canopy>70&&f.stats.understory>10&&f.stats.bushes>10&&f.stats.deadwood>0,JSON.stringify(f.stats));
        assert.ok(f.stats.relief90<20);assert.equal(f.model.state.snowLine,500);assert.equal(f.model.world.recipe?.taiga?.snowCoverage,0);
        const adults=trees.filter(o=>!o.asset.includes('young')&&!o.asset.includes('dead')&&!['taiga-birch','taiga-aspen','taiga-rowan'].includes(o.asset));
        const heights=adults.map(o=>o.scale[1]*getModel(o.asset).bounds.max.y);assert.ok(heights.every(h=>h>=14&&h<=45.01));assert.ok(Math.max(...heights)-Math.min(...heights)>10);
        for(let i=0;i<adults.length;i++)for(let j=i+1;j<adults.length;j++)assert.ok(Math.hypot(adults[i].position[0]-adults[j].position[0],adults[i].position[2]-adults[j].position[2])>=4.04);
    }
});

test('all five presets validate and have distinct species, density, ground and water',()=>{
    const worlds=Object.keys(TAIGA_VARIANTS).map(id=>taigaWorld(taigaDefaults(id as keyof typeof TAIGA_VARIANTS)));
    const [spruce,pine,larch,swamp,winter]=worlds;
    const fraction=(f:typeof spruce,id:string)=>f.model.world.objects.filter(o=>o.asset===id).length/f.stats.canopy;
    assert.ok(fraction(pine,'taiga-pine')>.65);assert.ok(fraction(larch,'taiga-larch')>.65);
    assert.ok(spruce.stats.canopy>larch.stats.canopy*1.3);assert.ok(swamp.stats.bog>spruce.stats.bog*2);assert.ok(swamp.stats.waterBodies>=4);
    const channel=swamp.model.world.waterBodies.find(b=>b.kind==='river')!;
    for(const [x,z]of channel.points.slice(2,-2))assert.ok(swamp.terrain.getH(x,z)<waterLevelAt(swamp.model.state.water,swamp.model.world.waterBodies,x,z)+.25);
    for(const f of worlds)for(const o of f.model.world.objects){
        if(getModel(o.asset).category!=='tree'&&getModel(o.asset).category!=='shrub')continue;
        const [x,y,z]=o.position;assert.ok(y>waterLevelAt(f.model.state.water,f.model.world.waterBodies,x,z)+.5);
        for(const b of f.model.world.waterBodies)if(b.kind!=='ocean')assert.ok(waterSignedDistance(b,x,z).signed<-.8);
    }
    const s=taigaSurfaceMaps(spruce.model),p=taigaSurfaceMaps(pine.model),w=taigaSurfaceMaps(winter.model),sum=(bytes:Uint8Array,c:number)=>bytes.reduce((n,v,i)=>n+(i%4===c?v:0),0);
    assert.ok(sum(s.cover,0)>sum(p.cover,0)*2);assert.ok(sum(p.cover,1)>sum(s.cover,1)*3);assert.equal(sum(s.cover,2),0);assert.ok(sum(w.cover,2)>1000000);
});

test('taiga controls change actual populations and invalid values cannot enter projects',async()=>{
    const base=taigaDefaults(),full=taigaWorld(base),empty=taigaWorld({...base,forestDensity:0,understoryDensity:0,shrubDensity:0,deadwoodAmount:0,boulderDensity:0});assert.equal(empty.stats.objects,0);
    const thin=taigaWorld({...base,coniferDensity:.2});assert.ok(thin.stats.canopy<full.stats.canopy*.5);
    const deciduous=taigaWorld({...base,coniferDensity:0,deciduousRatio:1});assert.ok(deciduous.stats.canopy>0);assert.ok(deciduous.model.world.objects.filter(o=>o.asset!=='taiga-dead-tree'&&getModel(o.asset).category==='tree'&&!o.asset.includes('young')).every(o=>['taiga-birch','taiga-aspen','taiga-rowan'].includes(o.asset)));
    const loaded=decodeProject(full.project());assert.deepEqual(loaded.world,full.model.world);
    for(const [key,[min,max]]of Object.entries(TAIGA_LIMITS))for(const value of [min-.01,max+.01,NaN,Infinity,'0.5',null])assert.throws(()=>validateTaiga({...base,[key]:value}));
    for(const patch of [{season:'monsoon'},{variant:'alpine'},{water:1}])assert.throws(()=>validateTaiga({...base,...patch}));
    const raw=JSON.parse(full.project());raw.world.recipe.taiga.moisture=5;const editor=editorFixture(),before=captureDocument(editor.model);await assert.rejects(editor.storage.loadProjectText(JSON.stringify(raw)));assert.deepEqual(captureDocument(editor.model),before);
    delete raw.world.recipe.taiga;assert.equal(decodeProject(JSON.stringify(raw)).world.preset,'taiga');
});

test('all boreal models are finite, opaque, merged, with progressively cheaper tree and shrub LODs',()=>{
    for(const id of Object.keys(TAIGA_PLANTS) as TaigaPlantId[]){
        const triangles:number[]=[];
        for(let level=0;level<3;level++){
            const root=makeTaigaPlant(id,level);assert.ok(root.children.length<=2);let count=0;
            root.traverse(o=>{if(o instanceof Mesh){const g=o.geometry;assert.ok(g.attributes.position.array.every(Number.isFinite));count+=(g.index?.count??g.attributes.position.count)/3;for(const m of Array.isArray(o.material)?o.material:[o.material]){assert.equal(m.transparent,false);m.dispose();}g.dispose();}});triangles.push(count);
        }
        if(TAIGA_PLANTS[id].category==='tree'||TAIGA_PLANTS[id].category==='shrub')assert.ok(triangles[2]<triangles[0]*.5,id+': '+triangles);
        if(TAIGA_PLANTS[id].category==='tree'&&id!=='taiga-dead-tree')assert.ok(triangles[2]<triangles[0]*.1,id+' distant tree budget: '+triangles);
        assert.equal(makeTaigaPlant(id,2).children.length,1,'one distant draw part');
        assert.ok(modelLOD(id,2).length<=2);
    }
});

test('seasons and ground settings preserve trees and terrain; local edits preserve outside objects',()=>{
    const source=taigaWorld(),f=editorFixture();applyDocument(f.model,captureDocument(source.model));f.terrain.buildTerrain();f.terrain.updateMeshAll();f.vegetation.rebuild();
    const objects=f.model.world.objects,heights=f.model.heights;let rebuilt=0;const vegetation={...f.vegetation,rebuild(){rebuilt++;f.vegetation.rebuild();}};
    applyTaigaSettings(f.model,f.terrain,f.history,vegetation,f.materials,{...taigaDefaults(),season:'winter',snowCoverage:.9,atmosphericFog:.4,mossCoverage:.2});
    assert.equal(f.model.world.objects,objects);assert.equal(f.model.heights,heights);assert.equal(rebuilt,0);assert.equal(f.model.world.recipe?.taiga?.season,'winter');
    f.history.undo();assert.equal(f.model.world.recipe?.taiga?.season,'summer');f.history.redo();assert.equal(f.model.world.recipe?.taiga?.season,'winter');
    f.model.world.biomes.push({id:'local-taiga',name:'Сосняк',kind:'taiga',center:[0,0],radius:45,taiga:taigaDefaults()});
    const outside=f.model.world.objects.filter(o=>Math.hypot(o.position[0],o.position[2])>=45),oldFog=f.model.state.fog;
    const cabin={id:'manual-cabin',asset:'cabin',source:'manual' as const,position:[0,f.terrain.getH(0,0),0] as [number,number,number],rotation:[0,0,0] as [number,number,number],scale:[2,2,2] as [number,number,number],groundOffset:0,followTerrain:true,tint:1};f.model.world.objects.push(cabin);
    applyTaigaSettings(f.model,f.terrain,f.history,f.vegetation,f.materials,{...taigaDefaults('pine'),terrainVariation:1},'local-taiga');
    for(const o of outside)assert.equal(f.model.world.objects.find(n=>n.id===o.id),o);assert.equal(f.model.world.objects.find(n=>n.id===cabin.id),cabin);assert.equal(f.model.state.fog,oldFog);
    const occupied=new FootprintIndex();occupied.insert(objectFootprint(cabin,f.terrain));
    for(const o of f.model.world.objects.filter(o=>o.source==='scatter'&&Math.hypot(o.position[0],o.position[2])<45))assert.equal(occupied.overlaps(objectFootprint(o,f.terrain,false),.1),false);
    assert.ok(taigaRegion(f.model.world,42,0).weight>0);assert.deepEqual(decodeProject(f.storage.projectJSON()).world.biomes,f.model.world.biomes);
    const center=taigaRegion(f.model.world,0,0).settings!,edge=taigaRegion(f.model.world,44,0).settings!;
    assert.equal(center.moisture,.24);assert.ok(edge.moisture>center.moisture&&edge.moisture<.78,'local habitat parameters feather into the surrounding taiga');
});

test('near-camera boreal floor is deterministic, seasonal, and includes real litter and seedlings',()=>{
    const f=taigaWorld(),ctx=taigaGroundContext(f.model,f.terrain),kinds=new Set<number>();let summer=0,winter=0;
    for(let z=-4;z<4;z++)for(let x=-4;x<4;x++){
        const first=foliagePoints(f.model,f.terrain,x,z,undefined,undefined,undefined,ctx);assert.deepEqual(foliagePoints(f.model,f.terrain,x,z,undefined,undefined,undefined,ctx),first);summer+=first.length;first.forEach(p=>kinds.add(p.kind));
    }
    f.model.world.recipe!.taiga={...taigaDefaults(),season:'winter',snowCoverage:.95};const cold=taigaGroundContext(f.model,f.terrain);
    for(let z=-4;z<4;z++)for(let x=-4;x<4;x++)winter+=foliagePoints(f.model,f.terrain,x,z,undefined,undefined,undefined,cold).length;
    assert.ok(winter<summer*.25);assert.ok(kinds.has(10)&&kinds.has(12)&&kinds.has(3));
});

test('terrain preview cache includes wetlands and relief but excludes plants and seasons; generation is reversible',async()=>{
    const f=editorFixture();let jobs=0;const generation=createWorldGeneration(f.model,f.terrain,f.materials,f.vegetation,f.history,f.feedback,{async run(j,p){jobs++;return computeTerrainJob(j,p);},cancel(){}});
    const taiga=taigaDefaults(),request={...defaultWorldRequest(),preset:'taiga' as const,N:128,areaSize:.25,taiga};
    await generation.preview(request);await generation.preview({...request,taiga:{...taiga,forestDensity:.1,season:'winter',snowCoverage:.9}});assert.equal(jobs,1);
    await generation.preview({...request,taiga:{...taiga,terrainVariation:1.5}});assert.equal(jobs,2);
    await generation.preview({...request,taiga:{...taiga,bogFrequency:.9}});assert.equal(jobs,3);
    await generation.preview({...request,taiga:{...taiga,water:false}});assert.equal(jobs,4);
    const before=captureDocument(f.model),depth=f.history.undoDepth;assert.equal(await generation.generate(request),true);assert.equal(f.history.undoDepth,depth+1);
    assert.deepEqual(f.model.world.recipe?.taiga,taiga);const after=captureDocument(f.model);f.history.undo();assert.deepEqual(captureDocument(f.model),before);f.history.redo();assert.deepEqual(captureDocument(f.model),after);
});
