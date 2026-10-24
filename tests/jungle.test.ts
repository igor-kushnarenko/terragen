import {test} from 'node:test';
import assert from 'node:assert/strict';
import {jungleWorld} from '../verification/jungle-world';
import {jungleDefaults,validateJungle} from '../src/jungle-settings';
import {jungleBranches,jungleVines,JUNGLE_PLANTS,makeJunglePlant,type JunglePlantId} from '../src/jungle-models';
import {getModel} from '../src/model-library';
import {modelLOD} from '../src/model-lod';
import {decodeProject,captureDocument,applyDocument} from '../src/project';
import {waterLevelAt,waterSignedDistance} from '../src/water-math';
import {foliagePoints} from '../src/fine-foliage';
import {scatterJungle} from '../src/jungle-scatter';
import {jungleRegion} from '../src/jungle-habitat';
import {applyJungleSettings} from '../src/jungle-editor';
import {editorFixture} from './fixture';
import {createWorldGeneration,defaultWorldRequest} from '../src/world-generation';
import {computeTerrainJob} from '../src/terrain-pipeline';

test('dense jungle repeats by seed, has four strata and 75–95% projected crown cover',()=>{
    for(const seed of [424242,2026,71]){
        const f=jungleWorld(jungleDefaults(),seed,1,64);
        assert.ok(f.stats.coverage>=.75&&f.stats.coverage<=.95,`${seed}: ${f.stats.coverage}`);
        assert.ok(f.stats.relief90<35,'gentle default relief');assert.ok(f.stats.emergents>20&&f.stats.emergents<f.stats.canopy*.03);
        assert.ok(f.model.world.objects.length<=20000);assert.ok(f.stats.bushes>100&&f.stats.understory>100);
        assert.ok(f.model.world.objects.some(o=>o.asset==='jungle-banana'));assert.ok(f.model.world.objects.some(o=>o.asset==='jungle-log'));
        for(const h of f.stats.emergentHeight)assert.ok(h>=35&&h<=55,'emergent scale');for(const h of f.stats.canopyHeight)assert.ok(h>=15&&h<=35,'canopy scale');
        assert.deepEqual(scatterJungle(f.model,f.terrain).objects,f.model.world.objects,'authored object transforms repeat exactly');
    }
});

test('three variants share a generator but produce river habitat and a sunlit clearing',()=>{
    const dense=jungleWorld(jungleDefaults('dense')),river=jungleWorld(jungleDefaults('river')),clearing=jungleWorld(jungleDefaults('clearing'));
    assert.ok(dense.stats.coverage>clearing.stats.coverage+.12);assert.ok(clearing.stats.clearingCoverage<.4,'an actual open clearing');
    assert.equal(clearing.stats.waterBodies,0);assert.equal(river.stats.waterBodies,2);
    assert.ok(river.model.world.waterBodies[1].width>dense.model.world.waterBodies[1].width);
    assert.ok(river.stats.bushes>dense.stats.bushes,'moist bank undergrowth');
    const channel=river.model.world.waterBodies.find(b=>b.kind==='river')!;
    for(const [x,z]of channel.points.slice(2,-2)){const level=waterLevelAt(river.model.state.water,river.model.world.waterBodies,x,z);assert.ok(river.terrain.getH(x,z)<level,'actual carved river below the water mesh');}
    for(const object of river.model.world.objects){
        const [x,y,z]=object.position;assert.ok(y>=waterLevelAt(river.model.state.water,river.model.world.waterBodies,x,z),'dry plant base');
        if(getModel(object.asset).category==='tree')assert.ok(waterSignedDistance(channel,x,z).signed<-.8,'trunks stay out of the channel');
    }
});

test('jungle canopy roots have clearance while crowns can overlap; manual structures stay untouched',()=>{
    const f=jungleWorld(jungleDefaults(),1234,.25,128),trees=f.model.world.objects.filter(o=>o.asset.startsWith('jungle-canopy'));
    let crownsOverlap=false;
    for(let i=0;i<trees.length;i++)for(let j=i+1;j<trees.length;j++){
        const distance=Math.hypot(trees[i].position[0]-trees[j].position[0],trees[i].position[2]-trees[j].position[2]);
        assert.ok(distance>=4.64,'independent trunk and root footprints');if(distance<12)crownsOverlap=true;
    }
    assert.ok(crownsOverlap,'canopy overlap is intentional');
    const cabin={id:'manual-cabin',asset:'cabin',source:'manual' as const,position:[0,f.terrain.getH(0,0),0] as [number,number,number],rotation:[0,0,0] as [number,number,number],scale:[2,2,2] as [number,number,number],groundOffset:0,followTerrain:true,tint:1};
    f.model.world.objects.push(cabin);const next=scatterJungle(f.model,f.terrain).objects;assert.equal(next.find(o=>o.id===cabin.id),cabin);
    for(const o of next.filter(o=>o.asset.startsWith('jungle-canopy')))assert.ok(Math.hypot(o.position[0],o.position[2])>8,'the building footprint is excluded');
});

test('vines start on real branches and all tropical LODs are opaque, merged and progressively cheaper',()=>{
    for(const id of Object.keys(JUNGLE_PLANTS) as JunglePlantId[]){
        const triangles:number[]=[];
        for(let level=0;level<3;level++){
            const root=makeJunglePlant(id,level);assert.ok(root.children.length<=2);
            let count=0;root.traverse(o=>{if('geometry'in o){const mesh=o as import('three').Mesh;count+=(mesh.geometry.index?.count??mesh.geometry.attributes.position.count)/3;assert.ok(mesh.geometry.attributes.position.array.every(Number.isFinite));for(const m of Array.isArray(mesh.material)?mesh.material:[mesh.material])assert.equal(m.transparent,false);mesh.geometry.dispose();}});triangles.push(count);
        }
        if(id.startsWith('jungle-canopy')||id.startsWith('jungle-emergent'))assert.ok(triangles[2]<triangles[0]/4,id+' LOD budget');
        for(const vine of jungleVines(id)){assert.ok(jungleBranches(id).some(b=>b.end.every((n,i)=>n===vine.anchor[i])));assert.deepEqual(vine.points[0],vine.anchor);assert.ok(vine.points.every(p=>p[1]>0));}
        assert.ok(modelLOD(id,2).length<=2);
    }
});

test('ground vegetation is reproducible and becomes sparser beneath the actual canopy',()=>{
    const f=jungleWorld(jungleDefaults(),424242,.25,128);let shaded=0,open=0,fungi=0;
    for(let z=-3;z<=3;z++)for(let x=-3;x<=3;x++){
        const first=foliagePoints(f.model,f.terrain,x,z);assert.deepEqual(foliagePoints(f.model,f.terrain,x,z),first);
        shaded+=first.length;fungi+=first.filter(p=>p.kind===5).length;
        const objects=f.model.world.objects;f.model.world.objects=[];open+=foliagePoints(f.model,f.terrain,x,z).length;f.model.world.objects=objects;
        for(const p of first)assert.ok(p.y>waterLevelAt(f.model.state.water,f.model.world.waterBodies,p.x,p.z)+.6);
    }
    assert.ok(shaded<open*.8,`${shaded} shaded vs ${open} open`);assert.ok(fungi>0,'damp shaded mushrooms');
});

test('jungle settings survive projects and reject invalid input without changing the current world',async()=>{
    const j={...jungleDefaults('river'),canopy:.8,vines:.35,haze:.5},f=jungleWorld(j),project=f.project(),loaded=decodeProject(project);
    assert.deepEqual(loaded.world.recipe?.jungle,j);assert.deepEqual(loaded.world.objects,f.model.world.objects);
    const raw=JSON.parse(project);for(const value of [NaN,Infinity,-1,2])assert.throws(()=>validateJungle({...j,canopy:value}));
    raw.world.recipe.jungle.vines=4;assert.throws(()=>decodeProject(JSON.stringify(raw)),/Неверный проект/);
    const editor=editorFixture(),before=captureDocument(editor.model);await assert.rejects(editor.storage.loadProjectText(JSON.stringify(raw)));assert.deepEqual(captureDocument(editor.model),before);
    delete raw.world.recipe.jungle;assert.equal(decodeProject(JSON.stringify(raw)).world.preset,'jungle','old jungle metadata still loads');
});

test('appearance changes do not rebuild trees or heights, and local jungle updates preserve outside objects',()=>{
    const source=jungleWorld(jungleDefaults(),424242,.25,64),f=editorFixture();applyDocument(f.model,captureDocument(source.model));f.terrain.buildTerrain();f.terrain.updateMeshAll();f.vegetation.rebuild();
    let rebuilds=0;const vegetation={...f.vegetation,rebuild(){rebuilds++;f.vegetation.rebuild();}};
    const objects=f.model.world.objects,heights=f.model.heights,revision=f.model.terrainRevision;
    const result=applyJungleSettings(f.model,f.terrain,f.history,vegetation,f.materials,{...jungleDefaults(),haze:.7});
    assert.equal(result.plantsChanged,false);assert.equal(rebuilds,0);assert.equal(f.model.world.objects,objects);assert.equal(f.model.heights,heights);assert.equal(f.model.terrainRevision,revision);
    const haze=f.model.world.recipe!.jungle!.haze;assert.equal(haze,.7);f.history.undo();assert.equal(f.model.world.recipe!.jungle!.haze,.3);f.history.redo();assert.equal(f.model.world.recipe!.jungle!.haze,.7);
    const afterHistory=f.model.terrainRevision;
    f.model.world.biomes.push({id:'local-jungle',name:'Локальные джунгли',kind:'jungle',center:[0,0],radius:40,jungle:jungleDefaults()});
    const outside=f.model.world.objects.filter(o=>Math.hypot(o.position[0],o.position[2])>=40);let regionRebuilds=0;
    const regional={...f.vegetation,refreshRegions(){regionRebuilds++;}};
    applyJungleSettings(f.model,f.terrain,f.history,regional,f.materials,{...jungleDefaults('clearing'),canopy:.4},'local-jungle');
    assert.equal(regionRebuilds,1);for(const o of outside)assert.equal(f.model.world.objects.find(n=>n.id===o.id),o);assert.equal(f.model.terrainRevision,afterHistory,'a regional plant edit preserves the terrain');
    assert.ok(jungleRegion(f.model.world,39,0).weight>.05,'local feathered habitat');
});

test('changing only plant settings reuses terrain previews; relief and streams invalidate them',async()=>{
    const f=editorFixture();let jobs=0;const generation=createWorldGeneration(f.model,f.terrain,f.materials,f.vegetation,f.history,f.feedback,{async run(job,p){jobs++;return computeTerrainJob(job,p);},cancel(){}});
    const request={...defaultWorldRequest(),preset:'jungle' as const,N:128,jungle:jungleDefaults()};await generation.preview(request);
    await generation.preview({...request,jungle:{...request.jungle,canopy:.5,vines:.1,haze:.9}});assert.equal(jobs,1);
    await generation.preview({...request,jungle:{...request.jungle,microrelief:1.5}});assert.equal(jobs,2);
    await generation.preview({...request,jungle:{...request.jungle,streams:false}});assert.equal(jobs,3);
});
