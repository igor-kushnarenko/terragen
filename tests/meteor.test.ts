import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { editorFixture } from './fixture';
import { applyMeteorImpact, createMeteorPlan, isFlammable, meteorContact, meteorDimensions,meteorRadius,MIN_METEOR_RADIUS,MAX_METEOR_RADIUS, type MeteorPlan } from '../src/meteor-impact';
import { createWalkScenarios } from '../src/walk-scenarios';
import { createWaterRendering } from '../src/water-rendering';
import { captureDocument, decodeProject } from '../src/project';
import type { RenderingSystem } from '../src/rendering';
import type { ControlsSystem } from '../src/controls';
import type { NatureAudio } from '../src/nature-audio';
import type { WorldObject } from '../src/world';
import { createCollisions, initializeRapier } from '../src/collisions';
import {contactMap,createContactShading,CONTACT_RES} from '../src/contact-shading';

function flatWorld() {
    const f = editorFixture(); f.model.N=f.model.state.N=128;f.terrain.buildTerrain();f.model.heights.fill(40);f.terrain.updateMeshAll();return f;
}
const plan: MeteorPlan={seed:71,radius:4,start:[-100,250,-100],target:[0,40,0],duration:6};
function object(id:string,asset:string,x:number,z=0,y=40):WorldObject {
    return {id,asset,source:'manual',position:[x,y,z],rotation:[0,0,0],scale:[1,1,1],groundOffset:0,followTerrain:y===40,tint:1};
}
test('meteor seeds reproduce size and trajectory; targets and entire paths stay in the world',()=>{
    const f=flatWorld(),seeds=new Set<string>();
    for(let seed=0;seed<100;seed++){
        const p=createMeteorPlan(f.model,f.terrain,[500,40,500],seed);assert.deepEqual(p,createMeteorPlan(f.model,f.terrain,[500,40,500],seed));
        assert.ok(p.radius>=MIN_METEOR_RADIUS&&p.radius<=MAX_METEOR_RADIUS);assert.ok(p.start[1]>f.model.maxH);assert.ok(p.duration>=5&&p.duration<=7);
        for(const point of [p.start,p.target])assert.ok(Math.abs(point[0])<512&&Math.abs(point[2])<512);
        seeds.add(JSON.stringify([p.radius,p.start,p.target]));
    }
    assert.equal(seeds.size,100);assert.ok(meteorDimensions(8,8).craterRadius>meteorDimensions(2,8).craterRadius);
});
test('meteor distribution includes pebble-sized bodies and rare giants without turning every small hit into a huge crater',()=>{
    assert.equal(meteorRadius(0),.2);assert.ok(Math.abs(meteorRadius(1)-24)<1e-10);
    const sizes=Array.from({length:1000},(_,i)=>meteorRadius(i/1000));assert.ok(sizes.filter(r=>r<1.5).length>250);assert.ok(sizes.filter(r=>r>9).length<110);assert.ok(Math.max(...sizes)>23);
    assert.ok(meteorDimensions(.2,4).craterRadius<meteorDimensions(1.5,4).craterRadius/3);assert.ok(meteorDimensions(24,4).craterRadius>100);
});
test('swept contact finds a ridge and local lake before the intended endpoint',()=>{
    const f=flatWorld();
    const terrain={getH:(x:number)=>Math.abs(x)<5?150:40};
    const hit=meteorContact(f.model,terrain,[-100,200,0],[100,40,0])!;assert.ok(hit[0]<5&&hit[0]>-6);assert.equal(hit[1],150);
    f.model.world.waterBodies.push({id:'lake',kind:'lake',level:80,points:[[-20,-20],[20,-20],[20,20],[-20,20]],width:1,opacity:.7,wave:1});
    const lakeHit=meteorContact(f.model,f.terrain,[0,120,0],[0,40,0])!;assert.equal(lakeHit[1],80);
});
test('a giant meteor contacts the surface with its lower edge before its centre buries in the ground',()=>{
    const f=flatWorld(),from:[number,number,number]=[0,80,0],to:[number,number,number]=[0,50,0];assert.equal(meteorContact(f.model,f.terrain,from,to),null);assert.deepEqual(meteorContact(f.model,f.terrain,from,to,24),[0,40,0]);
});
test('impact excavates a bounded bowl and rim, destroys nearby models and chars only dry flammable ones',()=>{
    const f=flatWorld();f.model.world.objects=[object('core','cabin',0),object('burn','pine',38),object('stone','ruins',45),object('far','pine',160),object('flying','log',0,0,200)];
    f.model.world.groups=[{id:'g',name:'Два объекта',objectIds:['core','burn']}];
    const before=f.model.heights.slice(),result=applyMeteorImpact(f.model,f.terrain,plan);
    assert.equal(result.destroyed,1);assert.equal(result.fires.length,1);assert.equal(result.fires[0].id,'burn');
    assert.equal(f.model.world.objects.find(o=>o.id==='burn')!.tint,.24);assert.equal(f.model.world.objects.find(o=>o.id==='stone')!.tint,1);assert.equal(f.model.world.groups.length,0);
    assert.ok(f.terrain.getH(0,0)<35);assert.ok(f.terrain.getH(32,0)>40);assert.equal(f.terrain.getH(160,0),40);
    for(let j=0;j<f.model.n;j++)for(let i=0;i<f.model.n;i++)if(Math.hypot(-512+i*f.model.cell,-512+j*f.model.cell)>result.craterRadius*1.35)assert.equal(f.model.heights[j*f.model.n+i],before[j*f.model.n+i]);
    assert.ok(f.model.splatDetail.some(v=>v>0));assert.equal(isFlammable('pier'),true);assert.equal(isFlammable('arch'),false);
});
test('water impacts deform the bed, suppress fires and preserve submerged surroundings outside the blast',()=>{
    const f=flatWorld();f.model.state.water=60;f.model.world.waterBodies[0].level=60;f.model.world.objects=[object('wood','log',38)];
    const result=applyMeteorImpact(f.model,f.terrain,{...plan,target:[0,60,0]});assert.equal(result.underwater,true);assert.equal(result.fires.length,0);assert.ok(f.terrain.getH(0,0)<40);assert.equal(f.model.world.objects[0].tint,1);
});
test('impact terrain, paint, objects and groups save and undo/redo as one transaction',()=>{
    const f=flatWorld();f.model.world.objects=[object('a','pine',0),object('b','cabin',38)];f.model.world.groups=[{id:'g',name:'Лес',objectIds:['a','b']}];
    const before=captureDocument(f.model);f.history.transaction('Метеорит',()=>{const r=applyMeteorImpact(f.model,f.terrain,plan);f.terrain.updateMeshRect(...r.rect);f.terrain.recomputeRange();f.vegetation.rebuild();});
    const after=captureDocument(f.model);assert.equal(f.history.undoDepth,1);const saved=decodeProject(f.storage.projectJSON());assert.deepEqual(saved.heights,after.heights);assert.deepEqual(saved.world,after.world);
    f.history.undo();assert.deepEqual(captureDocument(f.model),before);f.history.redo();assert.deepEqual(captureDocument(f.model),after);
});
test('Rapier removes destroyed obstacles and follows the new crater floor, including after undo',async()=>{
    await initializeRapier();const f=flatWorld();f.model.world.objects=[object('core','rock',0),object('survivor','pine',70)];
    const collisions=createCollisions(f.model,f.terrain);collisions.ensure();assert.equal(collisions.colliderCount,4);
    f.history.transaction('Метеорит',()=>{const r=applyMeteorImpact(f.model,f.terrain,plan);f.terrain.updateMeshRect(...r.rect);f.terrain.recomputeRange();f.vegetation.rebuild();});
    collisions.ensure();assert.equal(collisions.colliderCount,3);assert.ok(collisions.motion.ground(0,0,40)<35);
    f.history.undo();collisions.ensure();assert.equal(collisions.colliderCount,4);assert.ok(collisions.motion.ground(0,0,40)>=40);collisions.dispose();
});
function scenarioFixture(compileAsync?:RenderingSystem['renderer']['compileAsync']){
    const f=flatWorld(),walk={on:true,paused:false,feet:new Vector3(0,40,0)},input={walk,clearKeys(){},setPaused(v:boolean){walk.paused=v;}} as unknown as ControlsSystem;
    const render={...f.render,renderer:{domElement:{height:720},compileAsync}} as unknown as RenderingSystem;
    const sound={events:[] as string[],unlock:async()=>{},meteor(kind:string){this.events.push(kind);},moveMeteor(){},pauseMeteor(){},stopMeteor(){}};
    const scenarios=createWalkScenarios(f.model,render,f.terrain,f.vegetation,f.materials,f.history,input,sound as unknown as NatureAudio,f.feedback);
    return {...f,walk,scenarios,sound};
}
test('Armageddon launches simultaneous meteors, continues in random bursts and keeps a bounded shared effect budget',()=>{
    const f=scenarioFixture();assert.equal(f.scenarios.launchArmageddon(2026),true);assert.equal(f.scenarios.launch(1),false);assert.ok(f.scenarios.statistics.activeFlights>=2);
    for(let i=0;i<120*28;i++){f.scenarios.update(1/120);const s=f.scenarios.statistics;assert.ok(s.activeFlights<=4);assert.ok(s.meteors.length<=8);assert.ok(s.particles<=s.capacity);assert.ok(s.capacity<=840);}
    const s=f.scenarios.statistics;assert.equal(s.mode,'armageddon');assert.ok(s.spawned>8);assert.ok(s.impacts>4);assert.ok(s.peakFlights>=2);assert.ok(f.scenarios.active);assert.ok(f.model.operations.filter(o=>o.kind==='meteor').length===s.impacts);
    const saved=decodeProject(f.storage.projectJSON());assert.deepEqual(saved.operations,f.model.operations);f.scenarios.stop();assert.equal(f.scenarios.statistics.capacity,0);assert.equal(f.render.scene.children.some(o=>o.name==='Walk scenario: meteor'),false);
});
test('Armageddon pauses every meteor and produces the same ordered impacts at different rendering frequencies',()=>{
    const outcomes=[];
    for(const fps of [10,30,144]){const f=scenarioFixture();f.scenarios.launchArmageddon(821);const before=f.scenarios.statistics;
        f.walk.paused=true;f.scenarios.update(1);assert.deepEqual(f.scenarios.statistics,before);f.walk.paused=false;f.scenarios.update(1,0,true);assert.deepEqual(f.scenarios.statistics,before);
        for(let i=0;i<fps*16;i++)f.scenarios.update(1/fps);outcomes.push({heights:f.model.heights.slice(),operations:structuredClone(f.model.operations),spawned:f.scenarios.statistics.spawned});f.scenarios.stop();}
    for(const o of outcomes)assert.deepEqual(o,outcomes[0]);
});

test('meteor bursts reuse a fixed scene light count through flight, impact and repeated starts',()=>{
    const f=scenarioFixture(),lights=()=>{let n=0;f.render.scene.traverse(o=>{if((o as any).isPointLight)n++;});return n;};
    const count=lights();assert.equal(count,1);
    for(let run=0;run<2;run++){f.scenarios.launchArmageddon(16016);for(let i=0;i<180;i++){f.scenarios.update(.1);assert.equal(lights(),count);}assert.ok(f.scenarios.statistics.impacts>2);f.scenarios.stop();assert.equal(lights(),count);assert.equal((f.render.scene.getObjectByName('Scenario illumination') as any).intensity,0);}
});

test('explosion and ring shaders are prepared before the first impact',()=>{
    const prepared:any[]=[];const f=scenarioFixture((async(root,_camera,target)=>{assert.equal(target,f.render.scene);prepared.push(root);return root;}) as RenderingSystem['renderer']['compileAsync']);
    f.scenarios.launchArmageddon(16016);assert.equal(f.scenarios.statistics.impacts,0);assert.equal(prepared.length,f.scenarios.statistics.activeFlights);
    assert.ok(prepared.every(root=>root.children.some((o:any)=>o.geometry?.type==='RingGeometry'&&o.material.forceSinglePass)));f.scenarios.stop();
});

test('impact refresh preserves distant instance buffers and matches a full vegetation rebuild',()=>{
    const f=flatWorld();f.model.world.objects=[object('core','cabin',0),object('burn','pine',38),object('far','pine',300)];f.vegetation.rebuild();
    const meshes=()=>f.render.scene.children.filter(o=>o.name.startsWith('Objects '));
    const far=meshes().filter(o=>o.name.includes('2,0/'));assert.ok(far.length>0);
    const result=applyMeteorImpact(f.model,f.terrain,plan);f.terrain.updateMeshRect(...result.rect);f.vegetation.refreshRegions([result.rect]);
    assert.ok(far.every(o=>meshes().includes(o)));
    const snapshot=()=>meshes().map((o:any)=>({name:o.name,count:o.count,matrix:Array.from(o.instanceMatrix.array),color:Array.from(o.instanceColor.array)})).sort((a,b)=>a.name.localeCompare(b.name));
    const local=snapshot();f.vegetation.rebuild();assert.deepEqual(snapshot(),local);
});

test('local contact shading matches a full calculation after coalesced impacts and falls back after an unrelated edit',()=>{
    const f=flatWorld();f.model.world.objects=[object('core','cabin',0),object('burn','pine',38),object('far','pine',300)];f.vegetation.rebuild();
    const contacts=createContactShading(f.model,f.terrain,f.materials.terrainUniforms.uContactMap),bytes=()=>(f.materials.terrainUniforms.uContactMap.value as any).image.data;
    contacts.update();assert.deepEqual(bytes(),contactMap(f.model,f.terrain));
    for(const x of [0,100]){const r=applyMeteorImpact(f.model,f.terrain,{...plan,target:[x,40,0]});f.terrain.updateMeshRect(...r.rect);f.vegetation.refreshRegions([r.rect]);contacts.invalidateRegions([r.rect]);}
    contacts.update();assert.deepEqual(bytes(),contactMap(f.model,f.terrain));assert.equal(contacts.statistics.localUpdates,1);assert.ok(contacts.statistics.pixels<CONTACT_RES**2);
    f.model.heights[0]+=12;f.terrain.updateMeshRect(0,0,0,0);const r=applyMeteorImpact(f.model,f.terrain,plan);f.terrain.updateMeshRect(...r.rect);contacts.invalidateRegions([r.rect]);contacts.update();
    assert.equal(contacts.statistics.fullUpdates,2);assert.deepEqual(bytes(),contactMap(f.model,f.terrain));contacts.dispose();
});
test('stopping Armageddon preserves consequences and the whole sequence can be undone to the original world',()=>{
    const f=scenarioFixture(),before=captureDocument(f.model);f.scenarios.launchArmageddon(91);for(let i=0;i<180;i++)f.scenarios.update(.1);assert.ok(f.history.undoDepth>0);const after=captureDocument(f.model);f.scenarios.stop();assert.deepEqual(captureDocument(f.model),after);
    while(f.history.undoDepth)f.history.undo();assert.deepEqual(captureDocument(f.model),before);
});
test('scenario pauses for menus/photo/busy state, lands exactly once at different FPS and cleans effects',()=>{
    const outcomes=[];
    for(const fps of [10,30,60,144]){
        const f=scenarioFixture();assert.equal(f.scenarios.launch(54),true);assert.equal(f.scenarios.launch(55),false);
        f.walk.paused=true;f.scenarios.update(1);assert.equal(f.scenarios.statistics.time,0);f.walk.paused=false;
        f.scenarios.update(1,0,true);assert.equal(f.scenarios.statistics.time,0);f.model.busy=true;f.scenarios.update(1);assert.equal(f.scenarios.statistics.time,0);f.model.busy=false;
        for(let i=0;i<fps*9;i++)f.scenarios.update(1/fps);
        assert.equal(f.scenarios.statistics.phase,'aftermath');assert.equal(f.history.undoDepth,1);assert.deepEqual(f.sound.events,['flight','impact']);
        assert.ok(f.scenarios.statistics.particles<=f.scenarios.statistics.capacity);outcomes.push(f.model.heights.slice());
        f.scenarios.stop();assert.equal(f.scenarios.statistics.particles,0);assert.equal(f.render.scene.children.some(o=>o.name==='Walk scenario: meteor'),false);
    }
    for(const heights of outcomes)assert.deepEqual(heights,outcomes[0]);
});
test('leaving walk or replacing/editing the world cancels flight without damaging the new world',()=>{
    for(const kind of ['exit','replace','terrain'] as const){const f=scenarioFixture();f.scenarios.launch(9);
        if(kind==='exit')f.walk.on=false;else if(kind==='replace')f.model.world.objects=[];else f.terrain.updateMeshAll();
        const before=captureDocument(f.model);f.scenarios.update(.1);assert.equal(f.scenarios.active,false);assert.equal(f.history.undoDepth,0);assert.deepEqual(captureDocument(f.model),before);
    }
});
test('reflection preference persists, defaults for older saves and frees/recreates the reflection target',()=>{
    const f=flatWorld(),render=f.render as unknown as RenderingSystem,water=createWaterRendering(f.model,render,f.materials);
    f.model.busy=true;water.update(0);assert.equal(water.statistics.reflectionSize,256);
    f.model.busy=false;f.edits.setPreferences({waterReflections:false});f.model.busy=true;water.update(0);assert.equal(water.statistics.reflectionSize,0);assert.equal(f.materials.waterUniforms.uReflectionsEnabled.value,0);assert.equal(f.materials.waterUniforms.uReflectionOn.value,0);
    f.model.busy=false;assert.equal(decodeProject(f.storage.projectJSON()).state.waterReflections,false);
    f.model.busy=false;f.history.undo();f.model.busy=true;water.update(0);assert.equal(water.statistics.reflectionSize,256);
    f.model.busy=false;const data=JSON.parse(f.storage.projectJSON());delete data.state.waterReflections;assert.equal(decodeProject(JSON.stringify(data)).state.waterReflections,true);
    data.state.waterReflections='off';assert.throws(()=>decodeProject(JSON.stringify(data)),/waterReflections/);
    f.model.state.quality='low';water.update(0);assert.equal(water.statistics.reflectionSize,0);assert.equal(f.materials.waterUniforms.uReflectionsEnabled.value,1);water.dispose();
});
