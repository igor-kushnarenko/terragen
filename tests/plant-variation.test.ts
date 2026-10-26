import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {BUILTIN_INFO} from '../src/model-shapes';
import {getModel} from '../src/model-library';
import {modelLOD} from '../src/model-lod';
import {plantIdentity,plantModelLOD,variedPlant,plantPoint,plantObjectBounds,plantTrunkHull} from '../src/plant-models';
import {PLANT_MORPHS,plantWeights,setPlantMorph,enablePlantRaycast} from '../src/plant-variation';
import {editorFixture} from './fixture';
import type {WorldObject} from '../src/world';
import {createCollisions,initializeRapier} from '../src/collisions';

const plant=(id:string,asset='oak'):WorldObject=>({id,asset,source:'manual',position:[0,25,0],rotation:[0,0,0],scale:[1,1,1],tint:1,groundOffset:0,followTerrain:false});
test('plant identity is deterministic across moves, copies, undo and portable project reload',async()=>{
    const first=plant('unique-a'),copy=plant('unique-b');assert.deepEqual(plantWeights(plantIdentity(first)),plantWeights(plantIdentity({...first,position:[20,25,10]})));assert.notDeepEqual(plantWeights(plantIdentity(first)),plantWeights(plantIdentity(copy)));
    const samples=new Set(Array.from({length:1000},(_,i)=>JSON.stringify(plantWeights('oak/tree-'+i))));assert.equal(samples.size,1000);
    const f=editorFixture();f.edits.replaceWorld({objects:[first]});const bounds=plantObjectBounds(f.model.world.objects[0]).clone(),id=f.edits.duplicateObjects([first.id])[0];assert.notDeepEqual(plantWeights('oak/'+id),plantWeights(plantIdentity(first)));f.history.undo();assert.deepEqual(plantObjectBounds(f.model.world.objects[0]),bounds);
    const other=editorFixture();await other.storage.loadProjectFile(await f.storage.buildProjectBlob());assert.deepEqual(plantObjectBounds(other.model.world.objects[0]),bounds);
});
test('all built-in living plant types retain their triangle budgets, roots and placement bounds at every LOD',()=>{
    for(const asset of Object.keys(BUILTIN_INFO).filter(variedPlant)){
        const model=getModel(asset),root=plantPoint(plant('a',asset),new T.Vector3());assert.ok(root.length()<1e-9,asset+' root');
        for(const level of [0,1,2]){
            const raw=modelLOD(asset,level),parts=plantModelLOD(asset,level);assert.equal(parts.length,raw.length);
            for(let k=0;k<parts.length;k++){
                const geometry=parts[k].geometry;assert.equal(geometry.attributes.position.count,raw[k].geometry.attributes.position.count);assert.equal(geometry.morphAttributes.position.length,PLANT_MORPHS);assert.equal(raw[k].geometry.morphAttributes.position,undefined);
                assert.equal(plantModelLOD(asset,level)[k].geometry,geometry,'shared across instances');
                for(const target of geometry.morphAttributes.position)for(let i=0;i<target.count;i++){
                    const p=new T.Vector3().fromBufferAttribute(target,i);assert.ok(Number.isFinite(p.length()),asset);assert.ok(model.bounds.clone().expandByScalar(.0001).containsPoint(p),asset+' stays in footprint');
                }
            }
        }
    }
    assert.equal(variedPlant('rock'),false);assert.equal(variedPlant('model-imported-tree'),false);assert.equal(plantModelLOD('cabin')[0].geometry,getModel('cabin').parts[0].geometry);
});
test('CPU trunk shapes and all rendered LOD morphs use the same deformation field',()=>{
    for(const asset of ['oak','pine','taiga-spruce','jungle-canopy']){
        if(!Object.hasOwn(BUILTIN_INFO,asset))continue;
        const item=plant('morph-agreement',asset),weights=plantWeights(plantIdentity(item));
        for(const level of [0,1,2])for(const [k,part]of plantModelLOD(asset,level).entries()){
            const original=modelLOD(asset,level)[k],mesh=new T.Mesh(part.geometry,part.material);mesh.morphTargetInfluences=weights;
            for(let i=0;i<original.geometry.attributes.position.count;i+=17){const raw=new T.Vector3().fromBufferAttribute(original.geometry.attributes.position,i),cpu=plantPoint(item,raw),gpu=mesh.getVertexPosition(i,new T.Vector3());assert.ok(cpu.distanceTo(gpu)<.00002,asset+' LOD '+level);}
        }
    }
});
test('instance morphs share geometry/draw batches, preserve row identity and release their private textures',()=>{
    const f=editorFixture(),objects=Array.from({length:24},(_,i)=>({...plant('plant-'+i,'pine'),position:[5+i%6,25,5+Math.floor(i/6)] as [number,number,number]}));f.edits.replaceWorld({objects});
    const meshes=f.render.scene.children.filter(o=>o instanceof T.InstancedMesh) as T.InstancedMesh[];assert.equal(meshes.length,plantModelLOD('pine').length*3);assert.ok(meshes.every(m=>m.count===24));
    const proxy=new T.Mesh(meshes[0].geometry,meshes[0].material);meshes[0].getMorphAt(3,proxy);const weights=plantWeights(plantIdentity(objects[3]));weights.forEach((w,i)=>assert.ok(Math.abs(w-proxy.morphTargetInfluences![i])<1e-7));
    let disposed=0;for(const mesh of meshes)mesh.morphTexture!.addEventListener('dispose',()=>disposed++);f.vegetation.rebuild();assert.equal(disposed,meshes.length);assert.equal((f.render.scene.children.find(o=>o instanceof T.InstancedMesh) as T.InstancedMesh).geometry,meshes[0].geometry);
});
test('instance picking matches the actual blended surface rather than the undeformed template',()=>{
    const part=plantModelLOD('oak').at(-1)!,batch=new T.InstancedMesh(part.geometry,part.material,2);enablePlantRaycast(batch);
    const refs=[0,1].map(i=>{batch.setMatrixAt(i,new T.Matrix4().makeTranslation(i*12,0,0));setPlantMorph(batch,i,'oak/pick-'+i);const mesh=new T.Mesh(part.geometry,part.material);batch.getMorphAt(i,mesh);mesh.position.x=i*12;mesh.updateMatrixWorld();return mesh;});
    batch.updateMatrixWorld();batch.computeBoundingSphere();let hits=0;
    for(let i=0;i<2;i++)for(let y=2;y<9;y+=1.1)for(let x=-2.5;x<3;x+=.8){const caster=new T.Raycaster(new T.Vector3(i*12+x,y,8),new T.Vector3(0,0,-1));const expected=caster.intersectObject(refs[i]),actual=caster.intersectObject(batch);assert.equal(actual.length,expected.length);if(actual.length){hits++;assert.ok(Math.abs(actual[0].distance-expected[0].distance)<1e-6);assert.equal(actual[0].instanceId,i);}}
    assert.ok(hits>10);batch.dispose();
});
test('bent tree trunks have a bounded collision envelope and remain solid for walking',async t=>{
    await initializeRapier();const f=editorFixture();f.model.heights.fill(0);f.model.state.water=-1000;f.terrain.updateMeshAll();f.materials.updateWater();
    const item=plant('bent-trunk','pine');item.position=[0,0,0];f.edits.replaceWorld({objects:[item]});const hull=plantTrunkHull(item);assert.equal(hull.length,5*8*3);assert.ok([...hull].every(Number.isFinite));
    const collisions=createCollisions(f.model,f.terrain);t.after(collisions.dispose);
    const y=getModel('pine').bounds.max.y*.45,center=plantPoint(item,new T.Vector3(0,y,0)),ray=new T.Ray(center.clone().add(new T.Vector3(5,0,0)),new T.Vector3(-1,0,0)),hit=collisions.teleportHit(ray,6);
    assert.ok(hit);assert.ok(hit!.point.distanceTo(center)<.8);assert.equal(hit!.safe,false);
});
