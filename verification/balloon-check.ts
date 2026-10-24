import {createEditor} from '../src/editor';
import {openWorldRepository} from '../src/world-library';
import {bytesToBase64} from '../src/project';
import type {WorldObject} from '../src/world';
const errors:string[]=[];window.addEventListener('error',e=>errors.push(e.message));window.addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
const originalError=console.error;console.error=(...v:unknown[])=>{errors.push(v.map(String).join(' '));originalError(...v);};
const frameTimes:number[]=[],cpu:number[]=[];let measure=false;
const editor=createEditor({repository:()=>openWorldRepository(indexedDB,'terrain-editor-balloon-check'),onFrame(_t,dt,_c,ms){if(measure&&dt>0){frameTimes.push(dt*1000);cpu.push(ms);if(cpu.length>600){frameTimes.shift();cpu.shift();}}}});
const panel=document.createElement('section');panel.id='balloonCheck';panel.innerHTML='<strong>Проверка полёта · 0.20</strong>';panel.style.cssText='display:block!important;position:fixed;left:12px;bottom:55px;z-index:90;width:265px;background:#152520ed;border:1px solid #748a6e;padding:10px;color:#e7ebdf;font:11px/1.4 system-ui;max-height:44vh;overflow:auto';document.body.append(panel);
const result=document.createElement('pre');result.id='balloonCheckResult';result.style.cssText='white-space:pre-wrap;font:10px/1.3 monospace';panel.append(result);
let restored=false,stored=false,comparison=false;
function button(text:string,fn:()=>unknown){const b=document.createElement('button');b.className='btn';b.textContent=text;b.onclick=()=>{Promise.resolve(fn()).catch(e=>errors.push(String(e)));};panel.insertBefore(b,result);}
button('Тестовая площадка',async()=>{
    await editor.ready;editor.balloon.stop();editor.setWalk(false);
    const raw=JSON.parse(editor.projectJSON()),N=128,heights=new Float32Array((N+1)**2);raw.N=raw.state.N=N;
    for(let z=0;z<=N;z++)for(let x=0;x<=N;x++){const px=x/N*1024-512,pz=z/N*1024-512,r=Math.hypot(px,pz);heights[z*(N+1)+x]=px< -95?30+(px+95)*.4:r<65?30:30+Math.sin((r-65)*.019)**2*40;}
    raw.heights=bytesToBase64(new Uint8Array(heights.buffer));raw.balloon=null;raw.world.assets=[];raw.world.groups=[];raw.world.routes=[];raw.world.biomes=[];raw.world.landmarks=[];raw.world.preset=null;delete raw.world.recipe;
    const objects:WorldObject[]=[];for(let i=0;i<40;i++){const a=i/40*Math.PI*2,r=42+(i%3)*5;objects.push({id:'balloon-tree-'+i,asset:i%3?'pine':'birch',source:'manual',position:[Math.cos(a)*r,30,Math.sin(a)*r],rotation:[0,a,0],scale:[1,1,1],followTerrain:true,groundOffset:0,tint:1});}raw.world.objects=objects;
    Object.assign(raw.state,{water:8,quality:'balanced',dayCycle:false,sunEl:24,sunAz:140,exposure:.65,windSpeed:.05,fog:.001,fogIntensity:.1,lowFog:0,weather:'clear',showFoliage:true});raw.world.waterBodies=[{id:'ocean',kind:'ocean',level:8,points:[],width:1,opacity:raw.state.waterOpacity,wave:raw.state.wave}];raw.view.walk=null;
    await editor.loadProjectText(JSON.stringify(raw));editor.updateSun(true);editor.setWalkView(3,0,90,-8);editor.balloon.launch([0,30,0]);editor.balloon.approach();measure=true;
});
button('Сохранить и восстановить полёт',async()=>{
    const before=structuredClone(editor.balloon.state);await editor.autosave.saveNow(true);stored=true;await editor.loadProjectText(editor.projectJSON());restored=editor.walk.paused;comparison=JSON.stringify(before)===JSON.stringify(editor.balloon.state);
});
button('Ночной полёт',()=>{editor.state.sunEl=-14;editor.state.dayCycle=false;editor.updateSun(true);editor.balloon.setting('external',true);});
button('Дневной полёт',()=>{editor.state.sunEl=24;editor.state.dayCycle=false;editor.updateSun(true);editor.balloon.setting('external',true);});
button('Скрыть проверку',()=>{panel.hidden=true;panel.style.setProperty('display','none','important');});
const mean=(v:number[])=>v.reduce((a,b)=>a+b,0)/Math.max(1,v.length),p95=(v:number[])=>v.slice().sort((a,b)=>a-b)[Math.floor(v.length*.95)]??0;
setInterval(()=>{result.textContent=JSON.stringify({ready:!editor.busy,flight:editor.balloon.statistics,paused:editor.walk.paused,canBoard:editor.balloon.canBoard,metrics:editor.balloon.metrics?{power:editor.balloon.metrics.power,agl:editor.balloon.metrics.agl,tension:editor.balloon.metrics.tension,grounded:editor.balloon.metrics.grounded}:null,stored,restored,comparison,frames:cpu.length,meanMs:mean(frameTimes).toFixed(2),cpuP95:p95(cpu).toFixed(2),calls:editor.statistics.calls,colliders:editor.statistics.colliders,audio:editor.statistics.audio,errors},null,2);},500);

