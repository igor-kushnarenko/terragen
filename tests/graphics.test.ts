import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Box3,Color,InstancedMesh,Matrix4,Quaternion,Vector3} from 'three';
import {initializeModelLibrary,getModel} from '../src/model-library';
import {modelLOD} from '../src/model-lod';
import {objectColor,naturalScale} from '../src/object-appearance';
import {createSurfaceMaps} from '../src/surface-maps';
import {editorFixture} from './fixture';
import {decodeProject} from '../src/project';

// Budgets captured from the shipped 0.16.2 GLBs, rather than from the new generator.
const budgets={pine:[112,44,32],spruce:[128,44,32],birch:[344,80,40],oak:[272,80,40],bush:[560,20,20],rock:[80,20,20],boulder:[80,20,20]};
test('natural models stay within the previous triangle budgets and use at most two opaque batches per LOD',async()=>{
    await initializeModelLibrary();
    for(const [id,limits]of Object.entries(budgets))for(let level=0;level<3;level++){
        const parts=modelLOD(id,level),triangles=parts.reduce((sum,p)=>sum+(p.geometry.index?.count??p.geometry.attributes.position.count)/3,0);
        assert.ok(triangles<=limits[level],`${id} LOD ${level}: ${triangles} > ${limits[level]}`);assert.ok(parts.length<=(id==='bush'||id==='rock'||id==='boulder'?1:2));
        for(const part of parts){
            const colors=part.geometry.getAttribute('color');for(let i=0;i<colors.count;i++)for(const value of [colors.getX(i),colors.getY(i),colors.getZ(i)])assert.ok(Number.isFinite(value)&&value>=0&&value<=1,'valid GLB vertex color');
            const materials=Array.isArray(part.material)?part.material:[part.material];for(const m of materials){assert.equal(m.transparent,false);assert.equal(m.alphaTest,0);}
        }
    }
});
test('all natural LODs retain the original center, full height, footprint and material palette',()=>{
    for(const id of Object.keys(budgets)){
        const full=getModel(id).bounds;
        const palette=modelLOD(id,0).map(p=>(Array.isArray(p.material)?p.material[0]:p.material) as unknown as {color:Color});
        for(let level=1;level<3;level++){
            const parts=modelLOD(id,level),box=new Box3();for(const p of parts){p.geometry.computeBoundingBox();box.union(p.geometry.boundingBox!);}
            assert.ok(box.min.distanceTo(full.min)<1e-5,id+' min');assert.ok(box.max.distanceTo(full.max)<1e-5,id+' max');
            parts.forEach((p,i)=>{const material=(Array.isArray(p.material)?p.material[0]:p.material) as unknown as {color:Color};assert.ok(material.color.equals(palette[i].color));});
        }
    }
});
test('appearance stays stable across rebuilds and LODs; imported models retain the specified tint',()=>{
    const item={id:'tree-123',asset:'pine',tint:.9},color=objectColor(item,new Color()).toArray();
    for(let i=0;i<3;i++)assert.deepEqual(objectColor({...item},new Color()).toArray(),color);
    assert.notDeepEqual(objectColor({...item,id:'tree-124'},new Color()).toArray(),color);
    assert.deepEqual(objectColor({...item,asset:'custom-user-model'},new Color()).toArray(),[.9,.9,.9]);
    assert.deepEqual(naturalScale('pine',1,12,23),naturalScale('pine',1,12,23));
    assert.notEqual(naturalScale('pine',1,12,23)[0],naturalScale('pine',1,12,23)[1]);
});
test('scattered proportions are saved, restored and rendered with the same transforms used by physics',()=>{
    const f=editorFixture();f.model.heights.fill(30);f.terrain.updateMeshAll();f.model.state.treeDensity=.01;f.vegetation.scatter();
    const objects=f.model.world.objects,roundtrip=decodeProject(f.storage.projectJSON());assert.ok(objects.some(o=>o.scale[0]!==o.scale[1]));
    assert.deepEqual(roundtrip.world.objects,objects);
    const item=objects[0],matrix=new Matrix4();let checked=0;
    // Instanced transforms are checked against saved positions/scales, independent of proxy geometry.
    for(const mesh of f.render.scene.children){if(!(mesh instanceof InstancedMesh))continue;for(let i=0;i<mesh.count;i++){mesh.getMatrixAt(i,matrix);const p=new Vector3(),s=new Vector3();matrix.decompose(p,new Quaternion(),s);if(p.distanceTo(new Vector3(...item.position))<1e-4){assert.ok(s.distanceTo(new Vector3(...item.scale))<1e-5);checked++;}}}
    assert.ok(checked>=3);
});
test('richer surface maps retain the previous one MiB pixel budget and independent mipmapped layers',()=>{
    const maps=createSurfaceMaps();assert.equal(maps.albedo.image.data!.byteLength+maps.detail.image.data!.byteLength,1048576);
    assert.equal(maps.albedo.image.depth,8);assert.equal(maps.detail.image.depth,8);maps.albedo.dispose();maps.detail.dispose();
});
