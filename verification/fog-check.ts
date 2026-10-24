import {createEditor} from '../src/editor';
import {openWorldRepository} from '../src/world-library';

// Production scene and water captures; never opens the user's world library.
const panel=document.createElement('aside');panel.id='fogCheck';panel.style.setProperty('display','block','important');
panel.innerHTML='<strong>Туман и непрерывность облаков</strong><div id="fogActions"></div><pre id="fogResult">Загрузка…</pre>';
document.body.append(panel);
const style=document.createElement('style');style.textContent='#fogCheck{position:fixed;right:12px;top:12px;z-index:200;background:#14251fed;color:#edf4eb;padding:12px;border-radius:8px;font:12px/1.5 system-ui;width:310px}#fogCheck button{margin:3px}#fogResult{white-space:pre-wrap;font-size:10px}';document.head.append(style);
const result=document.querySelector('#fogResult')!,errors:string[]=[];
window.addEventListener('error',e=>errors.push(e.message));window.addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
const previousError=console.error;console.error=(...args:unknown[])=>{errors.push(args.map(String).join(' '));previousError(...args);};
let elapsed=0,view='coast',horizon=false,frames=0;
const editor=createEditor({repository:()=>openWorldRepository(indexedDB,'terrain-editor-fog-check'),onFrame(_t,dt){elapsed+=dt;frames++;if(elapsed>1){elapsed=0;publish();}}});
const canvas=document.querySelector<HTMLCanvasElement>('#view canvas')!;
canvas.addEventListener('webglcontextlost',()=>errors.push('webglcontextlost'));
function publish(){
    const gl=canvas.getContext('webgl2')!,band:number[][]=[];
    if(horizon){
        // Flat sea view, no objects: compare the sky immediately above the horizon
        // with fully fogged water immediately below it (screen-output RGB).
        for(const fraction of [.48,.50,.52,.54,.56,.58]){
            const pixels=new Uint8Array(64*4);gl.readPixels(Math.floor(canvas.width/2)-32,Math.floor(canvas.height*fraction),64,1,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
            band.push([0,1,2].map(c=>Math.round(pixels.reduce((sum,v,i)=>sum+(i%4===c?v:0),0)/64)));
        }
    }
    result.textContent=JSON.stringify({view,weather:editor.state.weather,fogIntensity:editor.state.fogIntensity,quality:editor.state.quality,frames,band,errors,programs:editor.statistics.programs,calls:editor.statistics.calls},null,2);
}
function button(label:string,fn:()=>unknown){const b=document.createElement('button');b.textContent=label;b.className='btn';b.onclick=()=>{Promise.resolve(fn()).then(publish).catch(e=>errors.push(String(e)));};document.querySelector('#fogActions')!.append(b);}
function camera(kind:string){
    view=kind;horizon=kind==='sea'||kind==='outside';
    const position:[number,number,number]=kind==='sea'?[1800,19,1800]:kind==='outside'?[6000,19,1800]:kind==='above'?[1800,1500,1800]:[0,22,460];
    const target:[number,number,number]=kind==='coast'?[0,22,0]:[position[0],position[1]+(kind==='above'?-450:0),position[2]-1000];
    editor.photo.recall({id:'fog-'+kind,name:kind,position,target,fov:65,roll:0,exposure:.55});
}
for(const [label,id]of [['Ясно','clear'],['Облака','partly'],['Пасмурно','overcast'],['Туман','fog'],['Шторм','storm']] as const)button(label,()=>editor.setWeather(id));
for(const [label,strength]of [['Туман 0%',0],['Туман 50%',.5],['Туман 100%',1],['Туман 200%',2]] as const)button(label,()=>{editor.state.fogIntensity=strength;});
for(const [label,kind]of [['Берег','coast'],['Море','sea'],['За картой','outside'],['Над облаками','above']] as const)button(label,()=>camera(kind));
for(const [label,quality]of [['Экономный','low'],['Высокий','high']] as const)button(label,()=>editor.worldActions.setPreferences({quality}));
button('Ночь',()=>{editor.state.sunEl=-25;editor.updateSun(true);});button('День',()=>{editor.state.sunEl=32;editor.updateSun(true);});
button('Скрыть',()=>panel.style.setProperty('display','none','important'));
void editor.ready.then(async()=>{
    const raw=JSON.parse(await(await fetch('/examples/storm-coast.json')).text());
    Object.assign(raw.state,{weather:'fog',fogIntensity:1,fog:.12,precipitation:0,windSpeed:.3,lowFog:0,soundEnabled:false,dayCycle:false,quality:'balanced'});
    await editor.loadProjectText(JSON.stringify(raw));editor.updateSun(true);editor.photo.enter();
    const freeze=document.querySelector<HTMLInputElement>('#photoControls input[type=checkbox]');if(freeze)freeze.checked=false;
    camera('coast');publish();
}).catch(e=>errors.push(String(e)));
