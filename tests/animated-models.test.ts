import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {animatedFixtureGLB} from '../verification/animated-fixture';
import {editorFixture} from './fixture';
import {getModel,modelEntries} from '../src/model-library';
import {captureDocument,decodeProject} from '../src/project';
import {readGLB,base64Binary} from '../src/asset-format';
import {BUILTIN_GLB} from '../src/builtin-models';

// GLTFExporter uses the browser FileReader API; the importer/exporter otherwise run unchanged.
Object.defineProperty(globalThis,'FileReader',{configurable:true,value:class {result:unknown;onloadend?:()=>void;async readAsArrayBuffer(blob:Blob){this.result=await blob.arrayBuffer();this.onloadend?.();}async readAsDataURL(blob:Blob){this.result=`data:${blob.type};base64,${Buffer.from(await blob.arrayBuffer()).toString('base64')}`;this.onloadend?.();}}});
async function fixture(kind:'skin'|'node'|'morph'='skin'){
    const f=editorFixture(),bytes=await animatedFixtureGLB(kind),asset=await f.storage.importModel([new File([bytes],'animated-'+kind+'.glb')],'tree','trunk');
    f.edits.replaceWorld({assets:[asset]});const id=f.edits.addObject(asset.id,0,0)!;return {...f,asset,id,bytes};
}
function actor(f:ReturnType<typeof editorFixture>,id:string){return f.render.scene.children.find(o=>o.name==='Animated object '+id)!;}
function skin(root:T.Object3D){let result:T.SkinnedMesh|undefined;root.traverse(o=>{if(o instanceof T.SkinnedMesh)result=o;});return result!;}
const close=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-5,`${a} != ${b}`);

test('actual GLB import preserves source bytes, bones and clips while normalization remains an outer transform',async()=>{
    const f=await fixture(),t=getModel(f.asset.id);assert.equal(f.asset.category,'animated');assert.equal(f.asset.collider,'trunk');assert.equal(t.rig?.bones,2);assert.equal(t.rig?.clips.length,2);close(t.bounds.min.y,0);close(t.bounds.max.y,1.8);
    const bytes=await(await f.vault.resolve(f.asset)).arrayBuffer(),json=readGLB(bytes);assert.deepEqual(new Uint8Array(bytes),new Uint8Array(f.bytes));assert.equal(f.asset.normalize,true);assert.equal((json.skins as unknown[]).length,1);assert.equal((json.animations as unknown[]).length,2);
    const loaded=await new GLTFLoader().parseAsync(bytes,'');assert.equal(loaded.animations[0].name,'Покачивание');const mesh=skin(loaded.scene);assert.equal(mesh.skeleton.bones.length,2);
    const mixer=new T.AnimationMixer(loaded.scene);mixer.clipAction(loaded.animations[0]).play();mixer.update(.5);close(mesh.skeleton.bones[1].quaternion.z,Math.sin(.65/2));
    const sourceMixer=new T.AnimationMixer(t.rig!.root);sourceMixer.clipAction(t.rig!.clips[0]).play();sourceMixer.update(.5);t.rig!.root.updateMatrixWorld(true);loaded.scene.updateMatrixWorld(true);
    const source=skin(t.rig!.root),a=new T.Vector3(),b=new T.Vector3();for(let i=0;i<mesh.geometry.attributes.position.count;i++){source.getVertexPosition(i,a).applyMatrix4(source.matrixWorld);mesh.getVertexPosition(i,b).applyMatrix4(mesh.matrixWorld).applyMatrix4(t.rig!.root.matrixWorld);assert.ok(a.distanceTo(b)<1e-5,'outer normalization preserves deformed vertices');}sourceMixer.stopAllAction();sourceMixer.uncacheRoot(t.rig!.root);
    loaded.scene.updateMatrixWorld(true);const bounds=new T.Box3().setFromObject(loaded.scene,true);assert.ok(bounds.max.y>1&&bounds.max.y<2.5,'normalization does not destroy skin bind matrices');
});

test('copies own bones, actions and materials while sharing geometry; playback leaves the document unchanged',async()=>{
    const f=await fixture(),copy=f.edits.duplicateObjects([f.id])[0];f.edits.updateObject(copy,{animation:{clip:1,playing:false,speed:1,loop:'repeat',time:.5}});
    const first=skin(actor(f,f.id)),second=skin(actor(f,copy)),template=skin(getModel(f.asset.id).rig!.root);
    assert.notEqual(first.skeleton,second.skeleton);assert.notEqual(first.skeleton.bones[1],second.skeleton.bones[1]);assert.equal(first.geometry,second.geometry);assert.notEqual(first.material,second.material);
    const before=captureDocument(f.model),secondPosition=second.skeleton.bones[0].position.clone();f.vegetation.updateAnimations(.5);
    assert.ok(first.skeleton.bones[1].quaternion.z>.2);assert.equal(second.skeleton.bones[1].quaternion.z,0);assert.deepEqual(second.skeleton.bones[0].position,secondPosition);assert.equal(template.skeleton.bones[1].quaternion.z,0);
    assert.deepEqual(captureDocument(f.model),before);assert.equal(f.vegetation.statistics.animated.instances,2);
});

test('pause, seek, speed, loop and one-shot playback work without restarting on a transform or tint edit',async()=>{
    const f=await fixture();f.vegetation.updateAnimations(.25);const root=actor(f,f.id);f.edits.updateObject(f.id,{tint:.7});assert.equal(actor(f,f.id),root);close(f.vegetation.animationState(f.id)!.time,.25);
    const settings={clip:0,playing:false,speed:2,loop:'repeat' as const,time:.5};f.edits.updateObject(f.id,{animation:settings});f.vegetation.updateAnimations(1);close(f.vegetation.animationState(f.id)!.time,.5);
    f.edits.updateObject(f.id,{animation:{...settings,playing:true}});f.vegetation.updateAnimations(.25);close(f.vegetation.animationState(f.id)!.time,1);
    f.edits.updateObject(f.id,{animation:{...settings,playing:true,loop:'once',time:0}});f.vegetation.updateAnimations(3);close(f.vegetation.animationState(f.id)!.time,2);assert.equal(f.vegetation.animationState(f.id)!.playing,false);
    f.edits.updateObject(f.id,{tint:.9});assert.equal(f.vegetation.animationState(f.id)!.playing,false,'an unrelated edit must not replay a finished clip');
    f.edits.updateObject(f.id,{animation:{...settings,playing:true,loop:'once',time:0,restart:1}});f.vegetation.updateAnimations(.125);close(f.vegetation.animationState(f.id)!.time,.25,'explicit replay starts again at zero');
    f.edits.updateObject(f.id,{animation:{...settings,playing:true,time:0}});f.vegetation.updateAnimations(1.25);close(f.vegetation.animationState(f.id)!.time,.5);
    f.edits.updateObject(f.id,{animation:{...settings,clip:-1,time:0}});close(skin(root).skeleton.bones[1].quaternion.z,0);
});

test('animated objects stay selectable in their posed geometry; removal frees private resources and retains shared geometry',async()=>{
    const f=await fixture();f.edits.updateObject(f.id,{animation:{clip:0,playing:false,speed:1,loop:'repeat',time:.5}});
    const root=actor(f,f.id),mesh=skin(root),box=new T.Box3().setFromObject(root,true),center=box.getCenter(new T.Vector3());
    assert.equal(f.vegetation.pick(new T.Ray(center.clone().add(new T.Vector3(0,0,10)),new T.Vector3(0,0,-1)))?.id,f.id);
    let textures=0,materials=0,geometries=0;mesh.skeleton.computeBoneTexture();mesh.skeleton.boneTexture!.addEventListener('dispose',()=>textures++);(mesh.material as T.Material).addEventListener('dispose',()=>materials++);mesh.geometry.addEventListener('dispose',()=>geometries++);
    f.edits.removeObject(f.id);assert.equal(root.parent,null);assert.equal(f.vegetation.statistics.animated.instances,0);assert.equal(textures,1);assert.equal(materials,1);assert.equal(geometries,0);
    f.history.undo();assert.equal(f.vegetation.statistics.animated.instances,1);assert.notEqual(actor(f,f.id),root);
});

test('animation settings and complete rigs survive portable project reload and undo; invalid clips reject atomically',async()=>{
    const f=await fixture(),settings={clip:1,playing:false,speed:.7,loop:'once' as const,time:.4};f.edits.updateObject(f.id,{animation:settings});
    assert.deepEqual(decodeProject(f.storage.projectJSON()).world.objects[0].animation,settings);
    const receiver=editorFixture();await receiver.storage.loadProjectFile(await f.storage.buildProjectBlob());assert.deepEqual(receiver.model.world,f.model.world);close(receiver.vegetation.animationState(f.id)!.time,.4);
    receiver.history.undo();assert.equal(receiver.vegetation.statistics.animated.instances,0);receiver.history.redo();assert.equal(receiver.vegetation.statistics.animated.instances,1);
    const before=captureDocument(receiver.model),raw=JSON.parse(receiver.storage.projectJSON());raw.world.objects[0].animation.clip=12;await assert.rejects(receiver.storage.loadProjectText(JSON.stringify(raw)),/клип/);assert.deepEqual(captureDocument(receiver.model),before);
    for(const patch of [{speed:NaN},{speed:0},{time:-1},{playing:'true'},{loop:'invalid'},{clip:-2}]){const bad=JSON.parse(receiver.storage.projectJSON());Object.assign(bad.world.objects[0].animation,patch);assert.throws(()=>decodeProject(JSON.stringify(bad)));}
});

test('animated instances are no longer capped at 128; static imports continue using instancing',async()=>{
    const f=await fixture(),object=f.model.world.objects[0];
    assert.doesNotThrow(()=>f.edits.replaceWorld({objects:Array.from({length:129},(_,i)=>({...structuredClone(object),id:'actor-'+i}))}));
    const asset=await f.storage.importModel([new File([base64Binary(BUILTIN_GLB.boulder)],'static.glb')],'rock','convex');f.edits.replaceWorld({assets:[...f.model.world.assets,asset]});const id=f.edits.addObject(asset.id,8,8)!;
    assert.equal(getModel(asset.id).rig,undefined);assert.equal(f.vegetation.animationState(id),null);assert.ok(f.render.scene.children.some(o=>o instanceof T.InstancedMesh));assert.equal(modelEntries(f.model.world).filter(t=>t.rig).length,1);
});

test('node and morph target animations retain their tracks and advance through the same instance player',async()=>{
    for(const kind of ['node','morph'] as const){const f=await fixture(kind),root=actor(f,f.id);f.vegetation.updateAnimations(.5);const mesh=root.getObjectByName(kind==='node'?'MovingMesh':'MorphMesh') as T.Mesh;assert.ok(kind==='node'?mesh.quaternion.z>.1:mesh.morphTargetInfluences![0]>.1);}
});

test('a rig without animation clips keeps its skin and can be placed in its bind pose',async()=>{
    const f=editorFixture(),asset=await f.storage.importModel([new File([await animatedFixtureGLB('skin',false)],'rig-only.glb')],'tree','trunk');f.edits.replaceWorld({assets:[asset]});const id=f.edits.addObject(asset.id,0,0)!;
    assert.equal(getModel(asset.id).rig?.clips.length,0);assert.equal(skin(actor(f,id)).skeleton.bones.length,2);assert.equal(f.vegetation.animationState(id)!.clip,-1);assert.equal(f.vegetation.animationState(id)!.playing,false);
});
