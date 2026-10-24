import { createEditor } from '../src/editor';
import { openWorldRepository } from '../src/world-library';
import { decodeProject } from '../src/project';
import { RouteDriver } from './route-driver';
import { createWalkWorld, WALK_DB, WALK_STOPS } from './walk-world';
import { walkMetrics, type WalkFrame } from './walk-metrics';
import { QUALITY_PROFILES, type QualityId } from '../src/quality';

const card=document.createElement('section');card.id='walkCheck';card.setAttribute('aria-label','Проверка прогулочного сценария');
card.innerHTML='<strong>Проверка: лес → озеро → видовая точка</strong><p>Отдельная библиотека проверки. Персонажа ведёт контроллер маршрута; движение и столкновения рассчитывает редактор.</p><div class="qa-actions"></div><label>Профиль <select id="qaQuality" aria-label="Профиль проверки"></select></label><p id="qaStatus" role="status">Инициализация…</p><p id="qaPosition"></p><p id="qaResume"></p><div id="qaResults"></div>';
document.body.append(card);
const hideCheck=document.createElement('button');hideCheck.textContent='Скрыть панель проверки';hideCheck.className='btn';hideCheck.onclick=()=>{card.hidden=true;};card.append(hideCheck);
const style=document.createElement('style');style.textContent='#walkCheck{position:fixed;top:65px;right:12px;z-index:40;width:355px;max-height:70vh;overflow:auto;padding:14px;background:#14251fee;border:1px solid #4b7461;border-radius:10px;color:#e1eee5;font:12px/1.5 system-ui}#walkCheck p{margin:6px 0}#walkCheck .qa-actions{display:flex;gap:5px;flex-wrap:wrap;margin:8px 0}#walkCheck select{margin:6px}#walkCheck button{font:inherit}#walkCheck table{font-size:11px;width:100%}#walkCheck td{padding:3px;border-bottom:1px solid #3b5147}body.photo-mode #walkCheck{display:block!important}@media(max-width:800px){#walkCheck{width:300px;font-size:11px;max-height:55vh}}';document.head.append(style);
const status=document.getElementById('qaStatus')!,position=document.getElementById('qaPosition')!,resume=document.getElementById('qaResume')!,results=document.getElementById('qaResults')!;
const quality=document.getElementById('qaQuality') as HTMLSelectElement;
for(const [id,profile]of Object.entries(QUALITY_PROFILES)){const option=document.createElement('option');option.value=id;option.textContent=profile.name;quality.append(option);}quality.value='balanced';
function button(name:string,action:()=>void|Promise<void>){const b=document.createElement('button');b.textContent=name;b.className='btn';b.disabled=true;b.onclick=()=>{Promise.resolve(action()).catch(e=>{status.textContent=String(e);running=false;editor.walk.autoWalking=false;lock(false);});};card.querySelector('.qa-actions')!.append(b);return b;}
type Run={quality:QualityId;profileSettings:typeof QUALITY_PROFILES[QualityId];when:string;frames:WalkFrame[];metrics:ReturnType<typeof walkMetrics>;distance:number;reached:string[];status:string;canvas:[number,number];visibility:string;focusChanges:number;adapter:string;userAgent:string;preview:ReturnType<typeof createEditor>['statistics']['preview'];};
let editor:ReturnType<typeof createEditor>,driver:RouteDriver|undefined,running=false,warmup=0,lastUI=0,pauseAtLake=false,seenLake=false,primed=false;
let frames:WalkFrame[]=[],runs:Run[]=[],runStart=0,focusChanges=0,activeQuality:QualityId='balanced';
const reached=new Set<string>();
let expectedResume:{feet:number[];yaw:number;objects:number;quality:QualityId;fingerprint:string}|undefined;
let restoration:{passed:boolean;errorMetres:number;worldMatches:boolean}|undefined;
async function fingerprint(text:string){
    const p=JSON.parse(text),bytes=new TextEncoder().encode(JSON.stringify([p.heights,p.splat,p.splatDetail,p.world,p.seeds,p.operations,p.walkSettings]));
    const hash=await crypto.subtle.digest('SHA-256',bytes);return Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
}
const prepare=button('Загрузить сценарий',()=>loadScenario());
const start=button('Пройти маршрут',()=>{pauseAtLake=false;return begin();});
const save=button('Сохранить у озера',()=>{pauseAtLake=true;return begin();});
const proceed=button('Продолжить маршрут',()=>begin(true));
const cancel=button('Остановить',()=>stop('Остановлено пользователем'));
const exportButton=button('Скачать результаты',()=>exportReport());
const reload=button('Перезагрузить проверку',()=>{location.reload();});
function lock(value:boolean){for(const b of [prepare,start,save,proceed,reload])b.disabled=value;quality.disabled=value;cancel.disabled=!value;exportButton.disabled=!runs.length;}
function nearestIndex(){const points=editor.world.routes[0].points;let index=1,best=Infinity;for(let i=1;i<points.length;i++){const d=Math.hypot(points[i][0]-editor.walk.feet.x,points[i][1]-editor.walk.feet.z);if(d<best){best=d;index=i;}}return index;}
async function loadScenario(){
    if(running)stop('Остановлено');lock(true);status.textContent='Загрузка проверочного мира…';
    sessionStorage.removeItem('walk-check-resume');
    await editor.loadProjectText(createWalkWorld().project);editor.autosave.rename('Проверка · лес → озеро → видовая точка');
    editor.worldActions.setPreferences({quality:quality.value as QualityId});editor.walk.paused=false;editor.walk.autoWalking=false;editor.walk.pitch=-.08;
    await editor.autosave.saveNow(true);status.textContent='Сценарий готов. Можно пройти маршрут вручную или запустить проверку.';lock(false);
}
async function begin(continueRoute=false){
    if(running)return;
    if(!continueRoute)await loadScenario();
    else if(!editor.world.routes.some(r=>r.id==='walk-route'))throw new Error('Сначала загрузите сценарий');
    editor.worldActions.setPreferences({quality:quality.value as QualityId});activeQuality=quality.value as QualityId;
    editor.walk.on=true;editor.walk.paused=false;
    editor.syncUI('walkPresentation');
    driver=new RouteDriver(editor.world.routes.find(r=>r.id==='walk-route')!.points,editor.walk);driver.start(continueRoute?nearestIndex():1);
    editor.walk.autoWalking=false;
    frames=[];reached.clear();seenLake=continueRoute&&editor.walk.feet.x>-22;primed=false;focusChanges=0;warmup=performance.now()+3000;runStart=performance.now();running=true;lock(true);
    status.textContent='Прогрев 3 с, затем проход с записью реального времени кадров…';
}
function stop(reason:string){
    if(!running)return;running=false;editor.walk.autoWalking=false;editor.walk.paused=true;
    const canvas=document.querySelector<HTMLCanvasElement>('#view canvas')!,gl=canvas.getContext('webgl2'),ext=gl?.getExtension('WEBGL_debug_renderer_info');
    const run:Run={quality:activeQuality,profileSettings:QUALITY_PROFILES[activeQuality],when:new Date().toISOString(),frames:frames.slice(),metrics:walkMetrics(frames),distance:driver?.distance??0,reached:[...reached],status:reason,
        canvas:[canvas.width,canvas.height],visibility:document.visibilityState,focusChanges,adapter:gl&&ext?String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)):'нет данных',userAgent:navigator.userAgent,preview:editor.statistics.preview};
    runs.push(run);status.textContent=reason+` · ${run.distance.toFixed(1)} м · ${run.metrics.fps.toFixed(1)} FPS · p95 ${run.metrics.p95Ms.toFixed(1)} мс`;
    results.replaceChildren();const table=document.createElement('table');
    for(const r of runs){const row=document.createElement('tr');for(const text of [QUALITY_PROFILES[r.quality].name,r.metrics.fps.toFixed(1)+' FPS','p95 '+r.metrics.p95Ms.toFixed(1)+' мс',r.status]){const cell=document.createElement('td');cell.textContent=text;row.append(cell);}table.append(row);}results.append(table);lock(false);
}
async function checkpoint(){
    stop('Озеро: сохранение и проверка возобновления');pauseAtLake=false;
    const text=editor.projectJSON(),project=decodeProject(text);expectedResume={feet:[...project.view.walk!.feet],yaw:project.view.walk!.yaw,objects:project.world.objects.length,quality:project.state.quality,fingerprint:await fingerprint(text)};
    await editor.autosave.saveNow(true);
    const repository=await openWorldRepository(indexedDB,WALK_DB),saved=await repository.last();repository.close();
    if(!saved)throw new Error('Сохранение не найдено');
    sessionStorage.setItem('walk-check-resume',JSON.stringify({expected:expectedResume,previous:runs}));
    resume.textContent=`Сохранено в IndexedDB: x ${expectedResume.feet[0].toFixed(2)}, z ${expectedResume.feet[2].toFixed(2)}. Нажмите «Перезагрузить проверку».`;
}
function exportReport(){const blob=new Blob([JSON.stringify({task:32,restoration,method:'Real editor requestAnimationFrame wall intervals, Rapier 120Hz. 3s warmup excluded. cpuMs is animate wall duration including CPU and driver submission, with no explicit GPU wait. Frames >50/100ms retained. No synthetic WebGPU lab.',runs},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='walk-scenario-results.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
editor=createEditor({repository:()=>openWorldRepository(indexedDB,WALK_DB),beforePhysics(){
    if(!running||performance.now()<warmup||!driver)return;
    if(!primed){primed=true;editor.walk.autoWalking=true;reached.add('Лес');}
    driver.step();
    if(driver.blocked){stop(driver.blocked);return;}
    if(driver.complete){reached.add('Видовая точка');editor.walk.pitch=-.15;editor.walk.yaw=Math.atan2(editor.walk.feet.x+5,editor.walk.feet.z);stop('Маршрут пройден');}
},onFrame(timestamp,elapsed,counters,cpuMs){
    if(!editor)return;
    const p=editor.walk.feet;
    if(timestamp-lastUI>250){position.textContent=`x ${p.x.toFixed(2)} · z ${p.z.toFixed(2)} · h ${p.y.toFixed(2)} м · ${editor.walk.swim?'в воде':editor.walk.grounded?'опора':'в воздухе'}`;lastUI=timestamp;}
    if(!running||performance.now()<warmup)return;
    if(elapsed>0)frames.push({dtMs:elapsed*1000,cpuMs,...counters,x:p.x,y:p.y,z:p.z});
    if(!seenLake&&Math.hypot(p.x-WALK_STOPS[1].point[0],p.z-WALK_STOPS[1].point[1])<1.2){seenLake=true;reached.add('Озеро');if(pauseAtLake){void checkpoint().catch(e=>{status.textContent=String(e);});return;}}
    if(performance.now()-runStart>90000)stop('Тайм-аут: маршрут не завершён');
}});
void(async()=>{
    await editor.ready;
    const previous=sessionStorage.getItem('walk-check-resume');
    if(previous){
        const remembered=JSON.parse(previous);expectedResume=remembered.expected;runs=remembered.previous;
        editor.walk.paused=true;
        const p=editor.walk.feet,expected=expectedResume!;
        const error=Math.hypot(p.x-expected.feet[0],p.y-expected.feet[1],p.z-expected.feet[2]);
        const worldMatches=await fingerprint(editor.projectJSON())===expected.fingerprint;
        const valid=worldMatches&&error<.02&&Math.abs(editor.walk.yaw-expected.yaw)<1e-6&&editor.world.objects.length===expected.objects&&editor.state.quality===expected.quality;
        restoration={passed:valid,errorMetres:error,worldMatches};
        sessionStorage.removeItem('walk-check-resume');
        resume.textContent=`Восстановление ${valid?'ПРОЙДЕНО':'ОШИБКА'} · отклонение ${error.toFixed(6)} м · мир ${worldMatches?'совпадает':'изменён'} · объекты ${editor.world.objects.length}/${expected.objects}`;
        status.textContent='Сессия проверки восстановлена. Можно продолжить путь.';quality.value=editor.state.quality;editor.walk.paused=true;
    }else status.textContent='Готово. Загрузите проверочный мир.';
    lock(false);
})().catch(e=>{status.textContent=String(e);});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&running)stop('Прервано: вкладка скрыта');});
// The automated route owns its steering, independent of keyboard focus. A hidden tab still invalidates the run.
window.addEventListener('blur',()=>{if(running){primed=false;focusChanges++;}});
