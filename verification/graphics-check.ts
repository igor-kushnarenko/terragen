import {createEditor} from '../src/editor';
import {openWorldRepository} from '../src/world-library';
import type {FrameCounters} from '../src/performance';
import type {WorldObject} from '../src/world';
import {bytesToBase64} from '../src/project';
import {QUALITY_PROFILES,type QualityId} from '../src/quality';

// Same production renderer, fixed projects, camera, profile and warmup on both builds.
const panel=document.createElement('section');panel.id='graphicsCheck';
panel.innerHTML='<strong>Графика · сравнение при одинаковой нагрузке</strong><div id="graphicsActions"></div><p id="graphicsStatus">Загрузка…</p><pre id="graphicsResults"></pre><p id="graphicsErrors"></p>';
document.body.append(panel);
// Photo mode intentionally hides every unrelated top-level element. Keep this
// diagnostic panel available until its explicit Hide button is pressed.
panel.style.setProperty('display','block','important');
const style=document.createElement('style');style.textContent='#graphicsCheck{position:fixed;right:10px;top:65px;z-index:80;width:340px;max-height:70vh;overflow:auto;background:#14251fe8;padding:12px;border:1px solid #5c7868;border-radius:8px;color:#edf4eb;font:12px/1.4 system-ui}#graphicsCheck button{margin:3px}#graphicsResults{white-space:pre-wrap;font-size:10px}body.walk-mode #graphicsCheck,body.photo-mode #graphicsCheck{display:block!important}';document.head.append(style);
const status=document.querySelector('#graphicsStatus')!,output=document.querySelector('#graphicsResults')!,errorText=document.querySelector('#graphicsErrors')!;
const errors:string[]=[];let valid=true,graphicsLost=false,scene='forest';
function reportError(message:string){errors.push(message);errorText.textContent=errors.join('\n');}
window.addEventListener('error',e=>reportError(e.message));window.addEventListener('unhandledrejection',e=>reportError(String(e.reason)));
const originalError=console.error;console.error=(...values:unknown[])=>{reportError(values.map(String).join(' '));originalError(...values);};
type Frame=FrameCounters&{ms:number;cpu:number};
type Run={phase:'warmup'|'baseline'|'storm'|'recovery';start:number;frames:Frame[];storm:boolean};
let run:Run|undefined;const results:unknown[]=[];
const quantile=(a:number[],q:number)=>a.slice().sort((x,y)=>x-y)[Math.min(a.length-1,Math.floor(a.length*q))]??0;
const mean=(a:number[])=>a.reduce((x,y)=>x+y,0)/Math.max(1,a.length);
const editor=createEditor({repository:()=>openWorldRepository(indexedDB,'terrain-editor-graphics-check'),onFrame(t,dt,c,cpu){
    if(!run)return;if(!run.start)run.start=t;
    run.frames.push({...c,ms:dt*1000,cpu});
    status.textContent=`${scene} · ${run.phase} · ${((t-run.start)/1000).toFixed(1)} с`;
    if(t-run.start<({warmup:4000,baseline:8000,storm:20000,recovery:4000}[run.phase]))return;
    const frames=run.frames.slice(1),ms=frames.map(f=>f.ms),cpus=frames.map(f=>f.cpu);
    results.push({scene,phase:run.phase,frames:frames.length,meanMs:mean(ms),p95Ms:quantile(ms,.95),maxMs:Math.max(...ms),over100ms:ms.filter(x=>x>100).length,cpuP95:quantile(cpus,.95),calls:mean(frames.map(f=>f.calls)),triangles:mean(frames.map(f=>f.triangles)),programs:editor.statistics.programs,foliage:editor.statistics.foliage,scenarios:editor.scenarios.statistics.impacts});
    const next=run.phase==='warmup'?'baseline':run.phase==='baseline'&&run.storm?'storm':run.phase==='storm'?'recovery':undefined;
    if(next==='storm')editor.scenarios.launchArmageddon(16016);if(next==='recovery')editor.scenarios.stop();
    const storm=run.storm;run=next?{phase:next,start:0,frames:[],storm}:undefined;
    publish();if(!run)status.textContent='Замер завершён';
}});
const canvas=document.querySelector<HTMLCanvasElement>('#view canvas')!;
canvas.addEventListener('webglcontextlost',()=>{valid=false;graphicsLost=true;run=undefined;reportError('Потеря WebGL-контекста: результат недействителен, требуется перезагрузка');publish();});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&run){valid=false;run=undefined;reportError('Вкладка скрыта: результат недействителен');publish();}});
function publish(){
    const gl=canvas.getContext('webgl2'),ext=gl?.getExtension('WEBGL_debug_renderer_info');
    output.textContent=JSON.stringify({version:'0.17.0',renderValid:valid&&!graphicsLost,scene,canvas:[canvas.width,canvas.height],quality:editor.state.quality,visibility:document.visibilityState,adapter:gl&&ext?String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)):'unavailable',errors,results},null,2);
}
async function load(kind:string){
    run=undefined;editor.scenarios.stop();editor.photo.exit();editor.setWalk(false);scene=kind;
    const raw=JSON.parse(await(await fetch('/examples/'+(kind==='coast'?'storm-coast':'impact-forest')+'.json')).text());
    if(kind==='gallery'){
        raw.N=raw.state.N=128;raw.heights=bytesToBase64(new Uint8Array(new Float32Array(129*129).fill(30).buffer));raw.world.routes=[];raw.world.biomes=[];raw.world.landmarks=[];raw.world.groups=[];
        const objects:WorldObject[]=[];
        ['pine','spruce','birch','oak','bush','rock','boulder'].forEach((asset,i)=>objects.push({id:'gallery-'+asset,asset,source:'manual',position:[(i-3)*6,30,0],rotation:[0,.4,0],scale:[1,1,1],tint:1,followTerrain:true,groundOffset:0}));
        raw.world.objects=objects;Object.assign(raw.state,{water:0,showFoliage:false,fog:0,fogIntensity:0,lowFog:0,wetness:0,weather:'clear'});
        raw.world.waterBodies=[{id:'ocean',kind:'ocean',level:0,points:[],width:1,opacity:raw.state.waterOpacity,wave:raw.state.wave}];
    }
    Object.assign(raw.state,{quality:'balanced',dayCycle:false,sunEl:38,sunAz:135,exposure:.55,windSpeed:.3,soundEnabled:false});
    await editor.loadProjectText(JSON.stringify(raw));quality.value='balanced';editor.updateSun(true);editor.walk.autoWalking=false;
    if(kind==='gallery'){editor.photo.enter();editor.photo.recall({id:'gallery-view',name:'Модели',position:[19,36,29],target:[0,34,0],fov:55,roll:0,exposure:.55});}
    else{editor.setWalkView(80,0,90,.4);editor.walk.paused=true;}
    status.textContent='Готово: '+kind;publish();
}
function button(label:string,fn:()=>unknown){const button=document.createElement('button');button.textContent=label;button.className='btn';button.onclick=()=>{Promise.resolve(fn()).catch(e=>reportError(String(e)));};document.querySelector('#graphicsActions')!.append(button);return button;}
button('Лес',()=>load('forest'));button('Побережье',()=>load('coast'));button('Модели',()=>load('gallery'));
function begin(storm:boolean){if(graphicsLost||document.hidden)throw new Error('Нужны действительный WebGL-контекст и видимая вкладка');results.length=0;valid=true;run={phase:'warmup',start:0,frames:[],storm};}
button('Замер 12 с',()=>begin(false));button('Замер с Армагеддоном',()=>begin(true));
const quality=document.createElement('select');quality.setAttribute('aria-label','Профиль проверки графики');
for(const [id,profile]of Object.entries(QUALITY_PROFILES)){const option=document.createElement('option');option.value=id;option.textContent=profile.name;quality.append(option);}quality.value='balanced';
quality.onchange=()=>{if(run)return;editor.worldActions.setPreferences({quality:quality.value as QualityId});publish();};document.querySelector('#graphicsActions')!.append(quality);
for(const [label,elevation]of [['День',38],['Закат',4],['Ночь',-25]] as const)button(label,()=>{
    editor.state.sunEl=elevation;editor.updateSun(true);
    const freeze=document.querySelector<HTMLInputElement>('#photoControls input[type=checkbox]');if(editor.photo.active&&freeze)freeze.checked=false;
});
button('Скрыть проверку',()=>{panel.hidden=true;panel.style.setProperty('display','none','important');});
void editor.ready.then(()=>load('forest')).catch(e=>reportError(String(e)));
