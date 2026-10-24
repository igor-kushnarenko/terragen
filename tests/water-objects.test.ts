import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Matrix4,Vector3} from 'three';
import {editorFixture} from './fixture';
import {waterAt,waterLevelAt,waterPath,validWaterOutline} from '../src/water-math';
import {waterGeometry} from '../src/water-geometry';
import {carveWater} from '../src/water-compute';
import {createWaterEdits} from '../src/water-edits';
import {captureDocument,decodeProject} from '../src/project';
import {OperationCancelled} from '../src/worker-jobs';
import {expandSelection,transformedObjects} from '../src/object-transforms';
import {createWalkSimulation,FixedStepClock} from '../src/physics';
import type {WaterBody} from '../src/world';

const lake:WaterBody={id:'upper-lake',name:'Верхнее озеро',kind:'lake',level:30,width:1,depth:5,bankWidth:12,bankSurface:'gravel',opacity:.7,wave:.5,points:[[-64,-64],[64,-64],[64,64],[-64,64]]};
const river:WaterBody={id:'river',kind:'river',level:30,endLevel:20,width:20,depth:4,flowDirection:1,flowSpeed:1.5,opacity:.7,wave:.5,points:[[100,0],[200,0]]};
const jobs={async run(job:any,progress:(n:number)=>void){return carveWater(job.settings,job.heights,job.waterBodies,progress);},cancel(){}};

test('independent water levels, sloped current and reversed flow agree at each coordinate',()=>{
    const bodies=[lake,river];assert.equal(waterLevelAt(0,bodies,0,0),30);assert.equal(waterLevelAt(0,bodies,150,0),25);assert.equal(waterLevelAt(0,bodies,150,12),0);
    assert.equal(waterAt(0,bodies,150,0).dx,1.5);assert.equal(waterAt(0,bodies,0,0).dx,0);
    const reversed={...river,flowDirection:-1 as const};assert.equal(waterPath(reversed,100,0).level,20);assert.equal(waterPath(reversed,200,0).level,30);assert.equal(waterAt(0,[reversed],150,0).dx,-1.5);
    bodies.push({...lake,id:'higher',level:40});assert.equal(waterLevelAt(0,bodies,0,0),40);
});
test('water meshes preserve independent levels and current attributes without downward triangles',()=>{
    for(const body of [lake,river,{...river,flowDirection:-1 as const}]){
        const geometry=waterGeometry(body),p=geometry.attributes.position,index=geometry.index!;
        for(let i=0;i<p.count;i++)assert.ok(Math.abs(p.getY(i)-waterPath(body,p.getX(i),p.getZ(i)).level)<1e-5);
        for(let i=0;i<index.count;i+=3){const a=new Vector3().fromBufferAttribute(p,index.getX(i)),b=new Vector3().fromBufferAttribute(p,index.getX(i+1)),c=new Vector3().fromBufferAttribute(p,index.getX(i+2));assert.ok(b.sub(a).cross(c.sub(a)).y>0);}
        assert.equal(geometry.attributes.aFlow.count,p.count);geometry.dispose();
    }
});
test('water earthworks and bank paint commit and undo together; removal preserves the bed',async()=>{
    const f=editorFixture();f.model.heights.fill(40);f.terrain.updateMeshAll();const before=captureDocument(f.model);
    const edits=createWaterEdits(f.model,f.terrain,f.vegetation,f.materials,f.history,f.feedback,jobs);
    assert.equal(await edits.upsert(lake),true);assert.equal(f.terrain.getH(0,0),25);assert.equal(f.terrain.getH(200,200),40);assert.ok(f.model.splatDetail.some(n=>n>0));assert.equal(f.model.operations.at(-1)?.kind,'water');
    const after=captureDocument(f.model);f.history.undo();assert.deepEqual(captureDocument(f.model),before);f.history.redo();assert.deepEqual(captureDocument(f.model),after);
    edits.remove(lake.id);assert.equal(f.model.world.waterBodies.length,1);assert.equal(f.terrain.getH(0,0),25);f.history.undo();assert.deepEqual(captureDocument(f.model),after);
});
test('invalid or cancelled water editing leaves the entire document and history unchanged',async()=>{
    const f=editorFixture(),before=captureDocument(f.model),edits=createWaterEdits(f.model,f.terrain,f.vegetation,f.materials,f.history,f.feedback,{async run(){throw new OperationCancelled();},cancel(){}});
    assert.equal(validWaterOutline('lake',[[0,0],[10,10],[0,10],[10,0]]),false);assert.equal(validWaterOutline('river',[[0,0],[0,0]]),false);
    await assert.rejects(edits.upsert({...river,endLevel:31}));assert.deepEqual(captureDocument(f.model),before);
    assert.equal(await edits.upsert(lake),false);assert.deepEqual(captureDocument(f.model),before);assert.equal(f.model.busy,false);assert.equal(f.history.undoDepth,0);
});
test('swimmers float on local water and river drift is stable across rendering frequencies',()=>{
    const positions:Vector3[]=[];
    for(const fps of [10,60,144]){const f=editorFixture();f.model.world.waterBodies=[...f.model.world.waterBodies,{...river,level:30,endLevel:30}];const sim=createWalkSimulation(f.model,()=>0);sim.walk.feet.set(150,30-f.model.walkSettings.eyeHeight+.25,0);const clock=new FixedStepClock();for(let i=0;i<fps*2;i++)clock.advance(1/fps,sim.step);assert.equal(sim.walk.swim,true);positions.push(sim.walk.feet.clone());}
    for(const p of positions){assert.ok(Math.abs(p.x-153)<1e-5);assert.ok(p.distanceTo(positions[0])<1e-5);}
});
test('group transforms, duplicate and deletion persist and undo as whole edits',()=>{
    const f=editorFixture(),a=f.edits.addObject('cabin',0,0)!,b=f.edits.addObject('arch',20,0)!;
    const group=f.edits.groupObjects([a,b],'Поселение');assert.deepEqual(expandSelection(f.model.world,[a]),[a,b]);
    const items=transformedObjects(f.model.world.objects,new Matrix4().makeTranslation(4,2,-3));f.edits.replaceWorld({objects:items},'Сдвинуть группу');assert.equal(f.model.world.objects[1].position[0],24);
    const copies=f.edits.duplicateObjects([a]);assert.equal(copies.length,2);assert.equal(f.model.world.groups.length,2);assert.notEqual(f.model.world.groups[1].id,group);
    const saved=decodeProject(f.storage.projectJSON());assert.equal(saved.version,11);assert.deepEqual(saved.world.groups,f.model.world.groups);
    f.edits.removeObjects([copies[0]]);assert.equal(f.model.world.objects.length,2);assert.equal(f.model.world.groups.length,1);f.history.undo();assert.equal(f.model.world.objects.length,4);
    f.edits.ungroupObjects(copies);assert.equal(f.model.world.groups.length,1);f.history.undo();assert.equal(f.model.world.groups.length,2);
    assert.throws(()=>transformedObjects(items,new Matrix4().makeScale(-1,1,1)));assert.throws(()=>transformedObjects(items,new Matrix4().makeTranslation(1024,0,0)));
});
test('format 7 validates references and water before loading; format 6 gains empty groups',async()=>{
    const f=editorFixture(),id=f.edits.addObject('cave',0,0)!,data=JSON.parse(f.storage.projectJSON());data.version=6;delete data.world.groups;assert.deepEqual(decodeProject(JSON.stringify(data)).world.groups,[]);
    data.version=7;data.world.groups=[{id:'bad',name:'Bad',objectIds:[id,'missing']}];const before=captureDocument(f.model);await assert.rejects(f.storage.loadProjectText(JSON.stringify(data)));assert.deepEqual(captureDocument(f.model),before);
    data.world.groups=[];data.world.waterBodies.push({...lake,points:[[0,0],[10,10],[0,10],[10,0]]});assert.throws(()=>decodeProject(JSON.stringify(data)));
});
