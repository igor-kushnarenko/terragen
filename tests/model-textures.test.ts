import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {base64Binary,readGLB} from '../src/asset-format';
import {BUILTIN_GLB} from '../src/builtin-models';
import {createModelLoader,glossToRoughness,LEGACY_SPEC_GLOSS} from '../src/model-loader';
import {getModel,prepareModelAssets} from '../src/model-library';
import {describeAsset} from '../src/asset-vault';
import {captureDocument} from '../src/project';
import {editorFixture} from './fixture';
import type {ModelAsset} from '../src/world';

Object.defineProperty(globalThis,'FileReader',{configurable:true,value:class {result:unknown;onloadend?:()=>void;async readAsArrayBuffer(blob:Blob){this.result=await blob.arrayBuffer();this.onloadend?.();}async readAsDataURL(blob:Blob){this.result=`data:${blob.type};base64,${Buffer.from(await blob.arrayBuffer()).toString('base64')}`;this.onloadend?.();}}});
Object.defineProperty(globalThis,'ProgressEvent',{configurable:true,value:class extends Event{constructor(type:string,init:ProgressEventInit){super(type);Object.assign(this,init);}}});
function gltf(material:unknown){
    const binary=base64Binary(BUILTIN_GLB.boulder),view=new DataView(binary),json=readGLB(binary),offset=20+view.getUint32(12,true),length=view.getUint32(offset,true);
    return JSON.stringify({...json,extensionsUsed:[LEGACY_SPEC_GLOSS],extensionsRequired:[LEGACY_SPEC_GLOSS],materials:[material],buffers:[{byteLength:length,uri:'data:application/octet-stream;base64,'+Buffer.from(binary.slice(offset+8,offset+8+length)).toString('base64')}]});
}
const legacy=()=>({name:'Legacy skin',doubleSided:true,alphaMode:'BLEND',extensions:{[LEGACY_SPEC_GLOSS]:{diffuseFactor:[.2,.4,.6,.5],specularFactor:[.13,.25,.5],glossinessFactor:.7}}});

test('legacy spec/gloss factors become a physical material with diffuse color, opacity and F0 intact',async()=>{
    const parsed=await createModelLoader().parseAsync(gltf(legacy()),'');let material:T.MeshPhysicalMaterial|undefined;parsed.scene.traverse(o=>{if(o instanceof T.Mesh)material=o.material as T.MeshPhysicalMaterial;});
    assert.ok(material instanceof T.MeshPhysicalMaterial);assert.deepEqual(material.color.toArray(),[.2,.4,.6]);assert.equal(material.opacity,.5);assert.equal(material.transparent,true);assert.equal(material.side,T.DoubleSide);assert.equal(material.metalness,0);assert.equal(material.ior,1000);assert.deepEqual(material.specularColor.toArray(),[.13,.25,.5]);assert.ok(Math.abs(material.roughness-.3)<1e-6);
    assert.equal(parsed.parser.json.materials[0].extensions[LEGACY_SPEC_GLOSS],undefined);assert.ok(parsed.parser.json.extensionsUsed.includes('KHR_materials_specular'));
});

test('glossiness converts linear alpha into the roughness green channel without modifying specular RGB',()=>{
    const original=new Uint8ClampedArray([20,40,60,0,90,100,120,128,150,170,210,255]),before=original.slice(),converted=glossToRoughness(original,.5);
    assert.deepEqual([...converted],[255,255,0,255,255,191,0,255,255,128,0,255]);assert.deepEqual(original,before);assert.throws(()=>glossToRoughness(original,NaN));
});

test('a failed referenced image rejects the import instead of publishing a white material',async()=>{
    const data=JSON.parse(gltf({pbrMetallicRoughness:{baseColorTexture:{index:0}}}));delete data.extensionsUsed;delete data.extensionsRequired;data.images=[{uri:'missing-image.png'}];data.textures=[{source:0}];
    await assert.rejects(createModelLoader().parseAsync(JSON.stringify(data),''),/текстуру|document|self/);
});

test('unlit materials do not require the normal textures they intentionally ignore',async()=>{
    const data=JSON.parse(gltf({extensions:{KHR_materials_unlit:{}},normalTexture:{index:0}}));data.extensionsUsed=['KHR_materials_unlit'];delete data.extensionsRequired;data.images=[{uri:'unused-normal.png'}];data.textures=[{source:0}];const loaded=await createModelLoader().parseAsync(JSON.stringify(data),'');assert.ok(loaded.scene);
});

test('replacing a model preserves placed instances, works at the asset limit and is reversible',async()=>{
    const f=editorFixture(),bytes=base64Binary(BUILTIN_GLB.boulder),stored=await describeAsset(new Blob([bytes])),asset:ModelAsset={id:'custom-original',name:'Old white model',category:'rock',collider:'convex',blob:stored.key,byteLength:bytes.byteLength};
    const assets=Array.from({length:20},(_,i)=>({...asset,id:i?'custom-other-'+i:asset.id}));await prepareModelAssets(assets,f.vault,new Map([[stored.key,stored.blob]]));f.edits.replaceWorld({assets});const id=f.edits.addObject(asset.id,8,9)!;f.edits.updateObject(id,{scale:[2,3,4],rotation:[0,.6,0]});const objects=structuredClone(f.model.world.objects);
    const replacement=await f.storage.importModel([new File([gltf(legacy())],'restored.gltf')],'rock','convex',asset.id);f.edits.replaceWorld({assets:f.model.world.assets.map(a=>a.id===asset.id?{...replacement,id:asset.id}:a)},'Заменить модель');
    assert.equal(f.model.world.assets.length,20);assert.deepEqual(f.model.world.objects,objects);assert.deepEqual((getModel(asset.id).parts[0].material as T.MeshPhysicalMaterial).color.toArray(),[.2,.4,.6]);f.history.undo();assert.equal(f.model.world.assets[0].blob,stored.key);f.history.redo();assert.equal(f.model.world.assets[0].blob,replacement.blob);
    const before=captureDocument(f.model);await assert.rejects(f.storage.importModel([new File(['bad'],'invalid.glb')],'rock','convex',asset.id));assert.deepEqual(captureDocument(f.model),before);assert.equal(f.model.busy,false);
});
