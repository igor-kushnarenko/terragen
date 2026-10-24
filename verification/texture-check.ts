import {createEditor} from '../src/editor';
import {openWorldRepository} from '../src/world-library';
import {defaultWorldRequest} from '../src/world-generation';
import {jungleDefaults} from '../src/jungle-settings';
import {getModel} from '../src/model-library';
import {readProjectPackage} from '../src/project-package';
import {readGLB} from '../src/asset-format';
import * as T from 'three';

const errors:string[]=[],runs:unknown[]=[];let published=0;
window.addEventListener('error',e=>errors.push(e.message));window.addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
const original=console.error;console.error=(...args:unknown[])=>{errors.push(args.map(String).join(' '));original(...args);};
const editor=createEditor({repository:()=>openWorldRepository(indexedDB,'terrain-editor-texture-check'),onFrame(){if(performance.now()-published>1000)publish();}});window.terrainEditor=editor;
const panel=document.createElement('aside');panel.id='textureCheck';panel.style.cssText='position:fixed;left:105px;top:125px;z-index:10;width:285px;padding:14px;border:1px solid #658251;border-radius:10px;background:#17251fed;color:#d4e8c3;font:12px/1.5 system-ui;max-height:65vh;overflow:auto';document.body.append(panel);
const actions=document.createElement('div');actions.className='btns';panel.append(actions);const result=document.createElement('pre');result.id='textureCheckResult';result.style.cssText='font:10px/1.5 monospace;white-space:pre-wrap';panel.append(result);
function publish(){published=performance.now();result.textContent=JSON.stringify({busy:editor.busy,errors,runs},null,2);}
function button(text:string,action:()=>unknown){const b=document.createElement('button');b.className='btn';b.textContent=text;b.onclick=()=>Promise.resolve(action()).catch(e=>{errors.push(String(e));publish();});actions.append(b);}
button('Статический динозавр',()=>load('tyrant_king_-_tyrannosaurus.glb'));
button('Анимированный динозавр',()=>load('animated_3d_tyrannosaurus_rex_dinosaur_loop.glb'));
button('Сохранить и открыть',async()=>{const blob=await editor.buildProjectBlob(),packed=await readProjectPackage(blob),asset=editor.world.assets[0],json=readGLB(await packed.provided!.get(asset.blob)!.arrayBuffer());await editor.loadProjectFile(blob);runs.push({reload:true,bytes:blob.size,materials:json.materials,extensions:json.extensionsUsed});publish();});
const toggle=document.createElement('button');toggle.className='btn';toggle.textContent='Проверка текстур';toggle.style.cssText='position:fixed;left:105px;bottom:60px;z-index:10';toggle.onclick=()=>panel.hidden=!panel.hidden;document.body.append(toggle);
async function load(name:string){
    const response=await fetch('/verification/texture-input/'+name);if(!response.ok)throw new Error('Положите исходный GLB в verification/texture-input/');
    const asset=await editor.importModel([new File([await response.arrayBuffer()],name)],'rock','convex');editor.worldActions.replaceWorld({assets:[asset],objects:[]});
    const id=editor.worldActions.addObject(asset.id,0,0)!,template=getModel(asset.id),size=template.bounds.getSize(new T.Vector3()),scale=template.rig?1:3;
    editor.worldActions.updateObject(id,{scale:[scale,scale,scale]});const h=editor.getH(0,0),distance=Math.max(size.x,size.y,size.z)*scale;editor.setView(distance*.6,h+distance*.48,distance*.8,0,h+size.y*scale*.45,0);
    const materials=new Set(template.parts.flatMap(p=>Array.isArray(p.material)?p.material:[p.material]));runs.push({name,bytes:asset.byteLength,animated:!!template.rig,materials:[...materials].map(m=>{const p=m as T.MeshPhysicalMaterial,image=p.map?.image as {width:number;height:number}|undefined;return {name:p.name,map:!!p.map,normal:!!p.normalMap,specular:!!p.specularColorMap,roughness:!!p.roughnessMap,colorSize:image?[image.width,image.height]:null};})});publish();
}
void editor.ready.then(async()=>{await editor.generateWorld({...defaultWorldRequest(),preset:'jungle',N:128,seed:2026,areaSize:.25,plants:false,routes:false,jungle:{...jungleDefaults('clearing'),atmosphere:false}});await load('tyrant_king_-_tyrannosaurus.glb');}).catch(e=>{errors.push(String(e));publish();});
