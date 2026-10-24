import {createEditor} from '../src/editor';
import {openWorldRepository} from '../src/world-library';
import {defaultWorldRequest} from '../src/world-generation';
import {jungleDefaults,JUNGLE_VARIANTS,type JungleVariant} from '../src/jungle-settings';

const errors:string[]=[],runs:unknown[]=[];
window.addEventListener('error',e=>errors.push(e.message));window.addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
const oldError=console.error;console.error=(...args:unknown[])=>{errors.push(args.map(String).join(' '));oldError(...args);};
const editor=createEditor({repository:()=>openWorldRepository(indexedDB,'terrain-editor-jungle-check'),onFrame(){if(performance.now()-published>1000)publish();}});
window.terrainEditor=editor;
let published=0;
const panel=document.createElement('aside');panel.id='jungleCheck';panel.setAttribute('aria-label','Проверка джунглей');
panel.style.cssText='position:fixed;left:105px;top:130px;z-index:10;width:270px;padding:15px;border:1px solid #658251;border-radius:10px;background:#17251fed;color:#d4e8c3;font:12px/1.5 system-ui;max-height:65vh;overflow:auto';document.body.append(panel);
const title=document.createElement('strong');title.textContent='Проверка тропических джунглей';panel.append(title);
const actions=document.createElement('div');actions.className='btns';panel.append(actions);
const result=document.createElement('pre');result.id='jungleCheckResult';result.style.cssText='font:10px/1.5 monospace;white-space:pre-wrap';panel.append(result);
function publish(){published=performance.now();const world=editor.world;result.textContent=JSON.stringify({preset:world.preset,variant:world.recipe?.jungle?.variant,busy:editor.busy,objects:world.objects.length,waterBodies:world.waterBodies.length,statistics:editor.statistics,errors,runs},null,2);}
function button(name:string,action:()=>unknown){const b=document.createElement('button');b.className='btn';b.textContent=name;b.type='button';b.onclick=()=>{Promise.resolve(action()).catch(e=>{errors.push(String(e));publish();});};actions.append(b);return b;}
function overview(){editor.setWalk(false);editor.photo.exit();editor.setView(-145,115,180,0,25,0);}
async function load(variant:JungleVariant){
    if(editor.busy)return;editor.setWalk(false);editor.photo.exit();const start=performance.now();
    await editor.generateWorld({...defaultWorldRequest(),preset:'jungle',seed:424242,N:256,areaSize:.25,jungle:jungleDefaults(variant)});
    overview();runs.push({variant,ms:Math.round(performance.now()-start),objects:editor.world.objects.length});publish();
}
for(const [id,preset]of Object.entries(JUNGLE_VARIANTS))button(preset.name,()=>load(id as JungleVariant));
button('Обзор',overview);
button('Под пологом',()=>{editor.setWalk(false);const p=editor.world.landmarks[0]?.position??[0,0],h=editor.getH(...p);editor.setView(p[0],h+2,p[1],p[0]+45,h+7,p[1]+40);});
button('У ручья',()=>{editor.setWalk(false);const b=editor.world.waterBodies.find(b=>b.kind==='river');if(!b)return;const p=b.points[Math.floor(b.points.length/2)],h=editor.getH(p[0]+9,p[1]);editor.setView(p[0]+9,h+3,p[1],p[0]-25,h+5,p[1]+25);});
button('Экономный',()=>{editor.worldActions.setPreferences({quality:'low'});publish();});
button('Сбалансированный',()=>{editor.worldActions.setPreferences({quality:'balanced'});publish();});
const toggle=document.createElement('button');toggle.textContent='Проверка';toggle.className='btn';toggle.style.cssText='position:fixed;left:105px;bottom:60px;z-index:10';toggle.onclick=()=>panel.hidden=!panel.hidden;document.body.append(toggle);
void editor.ready.then(()=>load('dense')).catch(e=>{errors.push(String(e));publish();});
