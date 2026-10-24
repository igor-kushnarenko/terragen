import {createEditor} from '../src/editor';
import {openWorldRepository} from '../src/world-library';
const panel=document.createElement('section');panel.id='stormCheck';panel.setAttribute('aria-label','Проверка прибоя и Армагеддона');panel.innerHTML='<strong>Прибой · свободные руки · Армагеддон</strong><p>Отдельная библиотека проверки. Все эффекты и управление — модули рабочего редактора.</p>';document.body.append(panel);
const style=document.createElement('style');style.textContent='#stormCheck{position:fixed;top:86px;right:12px;z-index:45;width:315px;max-height:70vh;overflow:auto;padding:12px;background:#13242eef;color:#f0f4fc;border:1px solid #6a93a0;border-radius:10px;font:12px/1.5 system-ui}#stormCheck button{margin:3px}#stormCheck p{margin:6px 0}';document.head.append(style);
const status=document.createElement('p'),stats=document.createElement('p'),errors=document.createElement('p');panel.append(status,stats,errors);const messages:string[]=[];window.addEventListener('error',e=>{messages.push(e.message);errors.textContent=messages.join('\n');});window.addEventListener('unhandledrejection',e=>{messages.push(String(e.reason));errors.textContent=messages.join('\n');});const error=console.error;console.error=(...args:unknown[])=>{messages.push(args.map(String).join(' '));errors.textContent=messages.join('\n');error(...args);};
type Phase='warmup'|'baseline'|'storm'|'recovery';
let last=0,minGap=Infinity,maxGap=-Infinity,graphicsLost=false,run:{phase:Phase;start:number;frames:number[];cpu:number[]}|undefined;
const performanceReport:unknown[]=[];
const editor=createEditor({repository:()=>openWorldRepository(indexedDB,'terrain-editor-storm-check'),onFrame(t,elapsed,_c,cpu){
    if(run){run.frames.push(elapsed*1000);run.cpu.push(cpu);if(!run.start)run.start=t;
        status.textContent=`Замер: ${run.phase} · ${((t-run.start)/1000).toFixed(1)} с`;
        if(t-run.start>({warmup:8000,baseline:8000,storm:20000,recovery:8000}[run.phase])){
            const values=run.frames.slice(1).sort((a,b)=>a-b),cpus=run.cpu.slice(1).sort((a,b)=>a-b);
            performanceReport.push({phase:run.phase,frames:values.length,meanMs:values.reduce((a,b)=>a+b,0)/values.length,p95Ms:values[Math.floor(values.length*.95)],maxMs:values.at(-1),over100ms:values.filter(v=>v>100).length,cpuP95:cpus[Math.floor(cpus.length*.95)],cpuMax:cpus.at(-1),programs:editor.statistics.programs,scenarios:editor.scenarios.statistics,collisions:editor.statistics.collisionUpdates,contacts:editor.statistics.contacts});
            const phase=run.phase==='warmup'?'baseline':run.phase==='baseline'?'storm':run.phase==='storm'?'recovery':null;
            if(phase==='storm')editor.scenarios.launchArmageddon(16016);if(phase==='recovery')editor.scenarios.stop();
            run=phase?{phase,start:0,frames:[],cpu:[]}:undefined;if(!run)status.textContent='Замер завершён. Скачайте проверку.';
        }
    }
    if(t-last<200)return;last=t;const gap=editor.waterSurface.sample(3,0).level-editor.getH(3,0);minGap=Math.min(minGap,gap);maxGap=Math.max(maxGap,gap);const s=editor.scenarios.statistics;stats.textContent=`Ветер ${editor.state.windSpeed} · вода над пляжем: ${minGap.toFixed(2)}…${maxGap.toFixed(2)} м · руки: ${editor.walkSettings.equippedLight} · в полёте ${s.activeFlights}, максимум ${s.peakFlights}, ударов ${s.impacts} · частицы ${s.particles}/${s.capacity} · программы ${editor.statistics.programs}`;
}});
const canvas=document.querySelector<HTMLCanvasElement>('#view canvas')!;
canvas.addEventListener('webglcontextlost',()=>{graphicsLost=true;run=undefined;const message='Замер недействителен: потерян WebGL-контекст. Перезагрузите проверку.';messages.push(message);errors.textContent=message;status.textContent=message;});
function button(text:string,fn:()=>unknown){const b=document.createElement('button');b.textContent=text;b.className='btn';b.onclick=()=>{try{Promise.resolve(fn()).catch(e=>status.textContent=String(e));}catch(e){status.textContent=String(e);}};panel.append(b);return b;}
async function load(example='storm-coast'){editor.scenarios.stop();editor.photo.exit();await editor.loadProjectText(await(await fetch('/examples/'+example+'.json')).text());minGap=Infinity;maxGap=-Infinity;status.textContent=example==='storm-coast'?'Мир готов. Проверка прибоя идёт в точке на сухом пляже x=3, z=0.':'Проверка ударов по суше: сетка 512, 3000 деревьев.';}
const reload=button('Загрузить побережье',load);reload.disabled=true;
button('Штормовой прибой',()=>{editor.scenarios.stop();editor.photo.exit();editor.setWalk(false);editor.state.windSpeed=3;editor.state.wave=1.2;editor.setView(38,25,50,-25,16.4,5);editor.syncAllUI();});
button('Слабый ветер',()=>{editor.state.windSpeed=.3;editor.syncAllUI();});
button('Прогулка по пляжу',()=>{editor.scenarios.stop();editor.photo.exit();editor.setWalk(false);editor.setWalkView(45,0,90,-.12);});
button('Армагеддон · проверка',()=>{editor.photo.exit();editor.setWalk(false);editor.setWalkView(80,0,90,.4);editor.scenarios.launchArmageddon(16016);});
button('Обзор метеоритов',()=>{const entries=editor.scenarios.statistics.meteors.filter(m=>m.phase==='flight');if(!entries.length)return;const p=entries.map(m=>m.position),center=p[0].map((_,axis)=>p.reduce((s,v)=>s+v[axis],0)/p.length),span=Math.max(100,...p.map(v=>Math.hypot(v[0]-center[0],v[1]-center[1],v[2]-center[2]))),distance=span*2.5;editor.photo.enter();editor.photo.recall({id:'meteor-overview',name:'Метеоритный дождь',position:[center[0]+distance*.55,center[1]+distance*.55,center[2]+distance],target:center as [number,number,number],fov:65,roll:0,exposure:.6});});
button('Остановить сценарий',()=>editor.scenarios.stop());
button('Замер производительности',async()=>{run=undefined;await load();editor.photo.exit();editor.setWalk(false);editor.setWalkView(80,0,90,.4);performanceReport.length=0;run={phase:'warmup',start:0,frames:[],cpu:[]};});
button('Замер ударов по суше',async()=>{run=undefined;await load('impact-forest');editor.photo.exit();editor.setWalk(false);editor.setWalkView(80,0,90,.4);performanceReport.length=0;run={phase:'warmup',start:0,frames:[],cpu:[]};});
button('Скачать проверку',()=>{const a=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify({version:'0.16.2',renderValid:!graphicsLost,wind:editor.state.windSpeed,beach:{minGap,maxGap},equipment:editor.walkSettings,scenarios:editor.scenarios.statistics,collisions:editor.statistics.collisionUpdates,contacts:editor.statistics.contacts,performance:performanceReport,errors:messages},null,2)],{type:'application/json'}));a.href=url;a.download='storm-armageddon-check.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
button('Скрыть проверку',()=>panel.hidden=true);
void editor.ready.then(async()=>{await load();reload.disabled=false;});
