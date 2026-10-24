import {createEditor} from '../src/editor';
import {openWorldRepository} from '../src/world-library';
import {base64Binary,binaryBase64} from '../src/asset-format';
import {BUILTIN_GLB} from '../src/builtin-models';

const panel=document.createElement('section');panel.id='assetStorageCheck';panel.style.cssText='position:fixed;right:12px;bottom:12px;z-index:180;width:310px;background:#17291feb;border:1px solid #617660;border-radius:7px;padding:10px;font:12px/1.4 system-ui';
const title=document.createElement('strong');title.textContent='Проверка моделей · 0.19';panel.append(title);document.body.append(panel);
const errors:string[]=[];window.addEventListener('error',e=>errors.push(e.message));window.addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
const repository=()=>connection??=openWorldRepository(indexedDB,'terrain-editor-assets-check');let connection:ReturnType<typeof openWorldRepository>|undefined;
const editor=createEditor({repository});
function button(label:string,action:()=>unknown){const b=document.createElement('button');b.className='btn';b.textContent=label;b.onclick=()=>Promise.resolve(action()).then(publish).catch(e=>{errors.push(String(e));void publish();});panel.append(b);}
const result=document.createElement('pre');result.style.cssText='white-space:pre-wrap;max-height:240px;overflow:auto;font-size:11px';panel.append(result);
async function publish(){
    const world=editor.world,assets=world.assets;let stored=0;
    for(const a of new Map(assets.map(a=>[a.blob,a])).values())stored+=(await(await repository()).getAsset(a.blob))?.size??0;
    result.textContent=JSON.stringify({assets:assets.map(a=>({name:a.name,bytes:a.byteLength,key:a.blob.slice(0,22)+'…'})),objects:world.objects.length,metadataBytes:JSON.stringify(assets).length,storedBytes:stored,inlineGLB:editor.projectJSON().includes('"glb"'),undo:editor.undoDepth,errors},null,2);
}
button('Загрузить старый JSON с моделью 9 МБ',async()=>{
    await editor.ready;editor.setWalk(false);const original=base64Binary(BUILTIN_GLB.boulder),bytes=new Uint8Array(9*1024*1024),view=new DataView(bytes.buffer);
    bytes.set(new Uint8Array(original));view.setUint32(8,bytes.length,true);view.setUint32(original.byteLength,bytes.length-original.byteLength-8,true);view.setUint32(original.byteLength+4,0x54534554,true);
    const json=JSON.parse(editor.projectJSON());json.version=9;json.world.assets=[{id:'custom-nine',name:'Камень 9 МБ',category:'rock',collider:'convex',glb:binaryBase64(bytes.buffer)}];
    json.world.objects=[{id:'manual-check',asset:'custom-nine',source:'manual',position:[0,editor.getH(0,0),0],rotation:[0,0,0],scale:[3,3,3],groundOffset:0,followTerrain:true,tint:1}];json.world.groups=[];
    await editor.loadProjectText(JSON.stringify(json));await editor.autosave.saveNow(true);const h=editor.getH(0,0);editor.setView(25,h+18,25,0,h+2,0);
});
button('Изменить объект',()=>{const o=editor.world.objects.find(o=>o.asset.startsWith('custom-'));if(o)editor.worldActions.updateObject(o.id,{tint:o.tint>.8?.7:1});});
button('Проверить хранилище',publish);
button('Убрать проверку',()=>panel.remove());
void editor.ready.then(publish);
