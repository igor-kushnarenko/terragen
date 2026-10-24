import {createEditor} from '../src/editor';
import {openWorldRepository} from '../src/world-library';
import type {QualityId} from '../src/quality';
const panel=document.createElement('section');panel.id='waterCheck';panel.setAttribute('aria-label','Проверка живой воды');panel.innerHTML='<strong>Живая вода · этапы 1–3</strong><p>Отдельная библиотека проверки. Вода, плавучесть и контроллер персонажа — рабочие модули редактора.</p>';
document.body.append(panel);const style=document.createElement('style');style.textContent='#waterCheck{position:fixed;z-index:45;right:12px;top:65px;width:310px;background:#102724ee;color:#e3f6ed;padding:14px;border:1px solid #408b76;border-radius:10px;font:12px/1.5 system-ui;max-height:75vh;overflow:auto}#waterCheck button{margin:3px}#waterCheck p{margin:6px 0}';document.head.append(style);
const status=document.createElement('p'),info=document.createElement('p'),errors=document.createElement('p');errors.id='waterErrors';panel.append(status,info,errors);const messages:string[]=[];
window.addEventListener('error',e=>{messages.push(e.message);errors.textContent=messages.join('\n');});window.addEventListener('unhandledrejection',e=>{messages.push(String(e.reason));errors.textContent=messages.join('\n');});
const original=console.error;console.error=(...args:unknown[])=>{messages.push(args.map(String).join(' '));errors.textContent=messages.join('\n');original(...args);};
let last=0;const editor=createEditor({repository:()=>openWorldRepository(indexedDB,'terrain-editor-water-check'),onFrame(t){if(t-last<500)return;last=t;const s=editor.statistics.water;info.textContent=`${editor.statistics.fps.toFixed(0)} FPS · отражения ${s.captures} · преломления ${s.refractions} (${s.refractionSize.join('×')}) · круги ${s.impacts} · брызги ${s.splashes} · предметы ${s.floating} · под водой ${s.underwater?'да':'нет'}`;}});
function button(label:string,fn:()=>unknown){const b=document.createElement('button');b.textContent=label;b.className='btn';b.onclick=()=>{try{Promise.resolve(fn()).catch(e=>status.textContent=String(e));}catch(e){status.textContent=String(e);}};panel.append(b);return b;}
async function load(){await editor.loadProjectText(await(await fetch('/examples/living-water.json')).text());status.textContent='Пример загружен. Ползунки воды и ветра находятся в редакторе.';}
const ready=button('Загрузить пример',load);ready.disabled=true;
button('Озеро',()=>{editor.photo.exit();editor.setWalk(false);editor.setView(32,24.2,62,-4,20,-24);});
button('Река',()=>{editor.setWalk(false);editor.setView(121,29.5,-64,113,27,-83);});
button('Море',()=>{editor.setWalk(false);editor.setView(-380,7,-380,-430,5,-440);});
button('Под водой',()=>{editor.setWalk(false);editor.photo.enter();editor.photo.recall({id:'underwater',name:'Подводная проверка',position:[-20,18,0],target:[-5,17,-25],fov:65,roll:0,exposure:.65});});
button('Круги и брызги',()=>{editor.photo.exit();editor.setWalk(false);editor.setWalkView(-30,45,0,-.1);editor.walk.feet.set(-20,18.55,10);editor.walk.yaw=0;editor.walk.autoWalking=true;editor.syncUI('walkPresentation');});
button('Плавающие брёвна',()=>{editor.photo.exit();editor.setWalk(false);editor.setWalkView(-30,45,0,-.1);editor.walk.feet.set(-25,21.5,35);editor.walk.yaw=-.25;editor.walk.pitch=-.1;editor.walk.autoWalking=false;editor.syncUI('walkPresentation');});
button('Дождь',()=>{editor.setWeather('rain');editor.state.precipitation=1;editor.syncAllUI();});
button('Ясно',()=>{editor.setWeather('clear');editor.syncAllUI();});
button('Отражения вкл/выкл',()=>editor.worldActions.setPreferences({waterReflections:!editor.state.waterReflections}));
for(const [quality,label]of [['low','Экономный'],['balanced','Сбалансированный'],['high','Высокий']] as const)button(label,()=>editor.worldActions.setPreferences({quality:quality as QualityId}));
button('Скачать отчёт',()=>{const a=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify({version:'0.15.0',water:editor.statistics.water,statistics:editor.statistics,errors:messages,quality:editor.state.quality,when:new Date().toISOString()},null,2)],{type:'application/json'}));a.href=url;a.download='water-browser-check.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
button('Скрыть панель проверки',()=>panel.hidden=true);
void editor.ready.then(async()=>{await load();ready.disabled=false;});
