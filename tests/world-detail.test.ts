import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PerspectiveCamera,Vector3} from 'three';
import {editorFixture} from './fixture';
import {scatterObjects} from '../src/scatter';
import {createEcology,objectFootprint,routeClearance} from '../src/ecology';
import {terrainChunkIndices} from '../src/chunk-grid';
import {modelLOD} from '../src/model-lod';
import {chooseLOD,QUALITY_PROFILES} from '../src/quality';
import {contactMap} from '../src/contact-shading';
import {decodeProject,captureDocument} from '../src/project';
import {foliagePoints} from '../src/fine-foliage';

function flat(){const f=editorFixture();f.model.heights.fill(30);f.terrain.updateMeshAll();f.model.state.treeDensity=0.025;f.model.state.rockDensity=0.02;return f;}
test('ecological scattering repeats from the seed, preserves manual objects and changes with moisture',()=>{
    const f=flat();f.edits.addObject('bridge',0,0);const a=scatterObjects(f.model,f.terrain),b=scatterObjects(f.model,f.terrain);assert.deepEqual(a,b);assert.ok(a.counts.trees>40);assert.equal(a.objects[0].source,'manual');
    f.model.state.soilMoisture=0.05;assert.notDeepEqual(scatterObjects(f.model,f.terrain).objects,a.objects);
});
test('generated models avoid one another, transformed manual objects and the full width of paths',()=>{
    const f=flat(),id=f.edits.addObject('boulder',0,0)!;f.edits.updateObject(id,{scale:[8,3,5],rotation:[0,0.8,0]});
    f.model.world.routes=[{id:'trail',name:'Тропа',kind:'trail',width:8,points:[[-512,0],[0,0],[512,100]]}];
    const {objects}=scatterObjects(f.model,f.terrain),footprints=objects.map(item=>objectFootprint(item,f.terrain));assert.ok(objects.length>40);
    for(let i=1;i<footprints.length;i++){
        const p=footprints[i];assert.ok(routeClearance(f.model.world.routes,p.x,p.z)>=p.radius+0.8-1e-5);
        for(let j=0;j<i;j++) {const q=footprints[j];if(p.maxY>q.minY&&p.minY<q.maxY)assert.ok(Math.hypot(p.x-q.x,p.z-q.z)>=p.radius+q.radius+0.35-1e-5);}
    }
});
test('forest and meadow biomes produce forest interiors and clearings with smooth edges',()=>{
    const f=flat(),e=createEcology(f.model,f.terrain);f.model.world.biomes=[{id:'forest',name:'Лес',kind:'forest',center:[-200,0],radius:110},{id:'meadow',name:'Луг',kind:'meadow',center:[200,0],radius:110}];
    assert.ok(e.sample(-200,0).forest>0.8);assert.equal(e.sample(200,0).forest,0);
    const result=scatterObjects(f.model,f.terrain);assert.equal(result.objects.filter(item=>['pine','spruce','birch','oak'].includes(item.asset)&&Math.hypot(item.position[0]-200,item.position[2])<70).length,0);
    f.model.state.water=40;assert.equal(e.sample(-200,0).dry,false);assert.equal(scatterObjects(f.model,f.terrain).counts.trees,0);
});
test('all terrain LODs retain identical full-resolution boundary vertices and upward winding',()=>{
    for(const step of [1,2,4]){
        const indices=terrainChunkIndices(32,step),used=new Set(indices);assert.ok(indices.length<=32*32*6);
        for(let i=0;i<=32;i++){assert.ok(used.has(i));assert.ok(used.has(32*33+i));assert.ok(used.has(i*33));assert.ok(used.has(i*33+32));}
        for(let i=0;i<indices.length;i+=3){const [a,b,c]=[indices[i],indices[i+1],indices[i+2]],ax=a%33,az=Math.floor(a/33),bx=b%33,bz=Math.floor(b/33),cx=c%33,cz=Math.floor(c/33);assert.ok((bz-az)*(cx-ax)-(bx-ax)*(cz-az)>0);}
    }
});
test('neighboring terrain chunks share positions and normals after editing at a boundary',()=>{
    const f=flat();f.model.N=f.model.state.N=128;f.terrain.buildTerrain();
    for(let z=0;z<f.model.n;z++)for(let x=0;x<f.model.n;x++)f.model.heights[z*f.model.n+x]=30+Math.sin(x*0.3)*Math.cos(z*0.2)*12;
    f.terrain.updateMeshAll();f.model.heights[20*f.model.n+64]+=6;f.terrain.updateMeshRect(64,20,64,20);
    const a=f.terrain.chunks.find(c=>c.i===0&&c.j===0)!.mesh.geometry,b=f.terrain.chunks.find(c=>c.i===64&&c.j===0)!.mesh.geometry;
    for(let z=0;z<=64;z++)for(const name of ['position','normal'])for(let k=0;k<3;k++)assert.equal(a.attributes[name].array[(z*65+64)*3+k],b.attributes[name].array[z*65*3+k]);
});
test('chunk LOD and frustum selection reduce rendered terrain while leaving physics and export intact',()=>{
    const f=flat();f.model.N=f.model.state.N=128;f.terrain.buildTerrain();f.model.heights.fill(30);f.terrain.updateMeshAll();const before=f.storage.buildOBJ(),positions=f.terrain.geo.attributes.position.array.slice();
    const camera=new PerspectiveCamera(55,1.5,0.1,5000);camera.position.set(0,350,1000);camera.lookAt(0,30,0);f.terrain.updateView(camera);
    assert.ok(f.terrain.statistics!.levels[2]>0);assert.ok(f.terrain.statistics!.triangles<128*128*2);assert.deepEqual(f.terrain.geo.attributes.position.array,positions);assert.equal(f.storage.buildOBJ(),before);
    camera.lookAt(0,350,2000);f.terrain.updateView(camera);assert.equal(f.terrain.statistics!.visible,0);
});
test('tree and rock LODs reduce triangles while bridges keep the same geometry',()=>{
    for(const asset of ['pine','birch','oak','boulder']){const count=(level:number)=>modelLOD(asset,level).reduce((n,p)=>n+(p.geometry.index?.count??p.geometry.attributes.position.count)/3,0);assert.ok(count(2)<count(0));}
    assert.equal(modelLOD('bridge',2),modelLOD('bridge',0));assert.equal(chooseLOD(105,0,[100,200]),0);assert.equal(chooseLOD(115,0,[100,200]),1);assert.equal(chooseLOD(95,1,[100,200]),1);
    assert.ok(QUALITY_PROFILES.low.foliageDistance<QUALITY_PROFILES.high.foliageDistance);
});
test('fine plants do not occupy paths or declared flooded lakes',()=>{
    const f=flat();f.model.world.routes=[{id:'trail',name:'Тропа',kind:'trail',width:6,points:[[0,6],[12,6]]}];
    const points=foliagePoints(f.model,f.terrain,0,0);assert.ok(points.length>0);for(const p of points)assert.ok(routeClearance(f.model.world.routes,p.x,p.z)>=0.45);
    f.model.world.waterBodies.push({id:'lake',kind:'lake',level:35,points:[[0,0],[12,0],[12,12],[0,12]],width:1,opacity:0.7,wave:0});assert.equal(foliagePoints(f.model,f.terrain,0,0).length,0);
});
test('contact shading is moderate, responds to grounded objects and excludes floating props',()=>{
    const f=flat(),plain=contactMap(f.model,f.terrain);assert.equal(Math.max(...plain),0);const id=f.edits.addObject('rock',0,0)!;assert.ok(Math.max(...contactMap(f.model,f.terrain))>0);
    f.edits.updateObject(id,{followTerrain:false,position:[0,50,0]});assert.deepEqual(contactMap(f.model,f.terrain),plain);
});
test('format 3 migrates quality and audio defaults; new settings round-trip and undo atomically',()=>{
    const f=flat(),legacy=JSON.parse(f.storage.projectJSON());legacy.version=3;
    for(const key of ['soilMoisture','clearingAmount','quality','exposure','contactAO','soundEnabled','soundVolume','ambienceVolume','footstepVolume'])delete legacy.state[key];
    const migrated=decodeProject(JSON.stringify(legacy));assert.equal(migrated.version,11);assert.equal(migrated.state.quality,'balanced');assert.equal(migrated.state.soundEnabled,true);
    const before=captureDocument(f.model);f.edits.setPreferences({quality:'low',soundVolume:0.25,soilMoisture:0.8});assert.equal(decodeProject(f.storage.projectJSON()).state.soundVolume,0.25);f.history.undo();assert.deepEqual(captureDocument(f.model),before);
    assert.throws(()=>f.edits.setPreferences({soundVolume:5}));assert.deepEqual(captureDocument(f.model),before);
    legacy.state.quality='ultra';assert.throws(()=>decodeProject(JSON.stringify(legacy)),/quality/);
});
