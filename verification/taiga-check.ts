import {createEditor} from '../src/editor';
import {openWorldRepository} from '../src/world-library';
import {defaultWorldRequest} from '../src/world-generation';
import {taigaDefaults,TAIGA_VARIANTS,type TaigaVariant} from '../src/taiga-settings';

const errors:string[]=[],runs:unknown[]=[];let published=0;
window.addEventListener('error',e=>errors.push(e.message));window.addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
const oldError=console.error;console.error=(...args:unknown[])=>{errors.push(args.map(String).join(' '));oldError(...args);};
const editor=createEditor({repository:()=>openWorldRepository(indexedDB,'terrain-editor-taiga-check'),onFrame(){if(performance.now()-published>1000)publish();}});window.terrainEditor=editor;
const panel=document.createElement('aside');panel.id='taigaCheck';panel.setAttribute('aria-label','Проверка тайги');
panel.style.cssText='position:fixed;left:105px;top:130px;z-index:10;width:280px;padding:15px;border:1px solid #658251;border-radius:10px;background:#17251fed;color:#d4e8c3;font:12px/1.5 system-ui;max-height:65vh;overflow:auto';document.body.append(panel);
const title=document.createElement('strong');title.textContent='Проверка тайги';panel.append(title);
const actions=document.createElement('div');actions.className='btns';panel.append(actions);
const result=document.createElement('pre');result.id='taigaCheckResult';result.style.cssText='font:10px/1.5 monospace;white-space:pre-wrap';panel.append(result);
function publish(){published=performance.now();const w=editor.world;result.textContent=JSON.stringify({preset:w.preset,taiga:w.recipe?.taiga,busy:editor.busy,objects:w.objects.length,waterBodies:w.waterBodies.length,statistics:editor.statistics,errors,runs},null,2);}
function button(name:string,action:()=>unknown){const b=document.createElement('button');b.className='btn';b.textContent=name;b.type='button';b.onclick=()=>{Promise.resolve(action()).catch(e=>{errors.push(String(e));publish();});};actions.append(b);}
function overview(){editor.setWalk(false);editor.photo.exit();editor.setView(-145,105,180,0,20,0);}
async function load(variant:TaigaVariant,areaSize=.25){
    if(editor.busy)return;editor.setWalk(false);editor.photo.exit();const start=performance.now();
    await editor.generateWorld({...defaultWorldRequest(),preset:'taiga',seed:424242,N:256,areaSize,taiga:taigaDefaults(variant)});
    if(areaSize===1)editor.setView(-480,220,550,0,25,0);else overview();
    runs.push({variant,areaSize,ms:Math.round(performance.now()-start),objects:editor.world.objects.length});publish();
}
for(const [id,preset]of Object.entries(TAIGA_VARIANTS))button(preset.name,()=>load(id as TaigaVariant));
button('Обзор',overview);
button('Среди стволов',()=>{editor.setWalk(false);const p=editor.world.landmarks[0]?.position??[0,0],h=editor.getH(...p);editor.setView(p[0],h+2.2,p[1],p[0]+35,h+6,p[1]+35);});
button('Вся карта',()=>load('spruce',1));
button('Экономный',()=>editor.worldActions.setPreferences({quality:'low'}));
button('Сбалансированный',()=>editor.worldActions.setPreferences({quality:'balanced'}));
button('Сохранить и восстановить',async()=>{const text=editor.projectJSON(),before=JSON.stringify(editor.world);await editor.loadProjectText(text);runs.push({roundtrip:before===JSON.stringify(editor.world)});publish();});
button('Отменить',()=>{editor.undo();publish();});button('Повторить',()=>{editor.redo();publish();});
const toggle=document.createElement('button');toggle.textContent='Проверка';toggle.className='btn';toggle.style.cssText='position:fixed;left:105px;bottom:60px;z-index:10';toggle.onclick=()=>panel.hidden=!panel.hidden;document.body.append(toggle);
void editor.ready.then(()=>load('spruce')).catch(e=>{errors.push(String(e));publish();});
