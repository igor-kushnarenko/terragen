import {createEditor} from '../src/editor';
import {openWorldRepository} from '../src/world-library';
import {WORLD_PRESET_IDS,type WorldPresetId} from '../src/world';
import {WORLD_PRESETS} from '../src/world-recipes';
import {defaultWorldRequest} from '../src/world-generation';

const panel=document.createElement('section');panel.id='worldStudioCheck';panel.style.setProperty('display','block','important');panel.innerHTML='<strong>Проверка миров 0.18</strong><div id="worldCheckActions"></div><pre id="worldCheckResult">Загрузка…</pre>';document.body.append(panel);
const style=document.createElement('style');style.textContent='#worldStudioCheck{position:fixed;right:12px;bottom:12px;z-index:180;width:260px;max-height:52vh;overflow:auto;background:#17291feb;border:1px solid #617660;border-radius:7px;padding:10px;font:11px/1.4 system-ui}#worldStudioCheck button{margin:2px}#worldCheckResult{white-space:pre-wrap;font-size:10px}';document.head.append(style);
const errors:string[]=[],runs:unknown[]=[];let elapsed=0,frames=0;
window.addEventListener('error',e=>errors.push(e.message));window.addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
const oldError=console.error;console.error=(...args:unknown[])=>{errors.push(args.map(String).join(' '));oldError(...args);};
const editor=createEditor({repository:()=>openWorldRepository(indexedDB,'terrain-editor-world-studio-check'),onFrame(_t,dt){frames++;elapsed+=dt;if(elapsed>1){elapsed=0;publish();}}});
const result=document.querySelector('#worldCheckResult')!,canvas=document.querySelector<HTMLCanvasElement>('#view canvas')!;canvas.addEventListener('webglcontextlost',()=>errors.push('webglcontextlost'));
function publish(){result.textContent=JSON.stringify({preset:editor.world.preset,seed:editor.state.seed,N:editor.state.N,busy:editor.busy,objects:editor.world.objects.length,species:[...new Set(editor.world.objects.map(o=>o.asset))],weather:editor.state.weather,sunEl:editor.state.sunEl,routes:editor.world.routes.length,frames,errors,runs},null,2);}
function button(name:string,fn:()=>unknown){const b=document.createElement('button');b.textContent=name;b.className='btn';b.onclick=()=>Promise.resolve(fn()).catch(e=>{errors.push(String(e));publish();});document.querySelector('#worldCheckActions')!.append(b);}
function overview(){editor.photo.exit();editor.setWalk(false);editor.setView(650,380,650,0,35,0);}
async function load(preset:WorldPresetId){
    if(editor.busy)return;editor.photo.exit();editor.setWalk(false);const started=performance.now();
    const ok=await editor.generateWorld({...defaultWorldRequest(),preset});runs.push({preset,ok,ms:Math.round(performance.now()-started),objects:editor.world.objects.length});overview();publish();
}
for(const preset of WORLD_PRESET_IDS)button('Проверить '+WORLD_PRESETS[preset].name,()=>load(preset));
button('Обзор',overview);button('На земле',()=>{const p=editor.world.landmarks[0]?.position??[0,0];editor.setWalkView(p[0],p[1],45,0);editor.walk.paused=true;});
button('Скрыть проверку',()=>panel.style.setProperty('display','none','important'));
void editor.ready.then(()=>{overview();publish();}).catch(e=>errors.push(String(e)));
