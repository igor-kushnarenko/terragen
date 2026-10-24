import {createEditor} from '../src/editor';
import {openWorldRepository} from '../src/world-library';
import {defaultWorldRequest} from '../src/world-generation';
import {animatedFixtureGLB} from './animated-fixture';
import {jungleDefaults} from '../src/jungle-settings';

const errors:string[]=[],runs:unknown[]=[];let frames=0,published=0;
window.addEventListener('error',e=>errors.push(e.message));window.addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
const oldError=console.error;console.error=(...args:unknown[])=>{errors.push(args.map(String).join(' '));oldError(...args);};
const editor=createEditor({repository:()=>openWorldRepository(indexedDB,'terrain-editor-animation-check'),onFrame(){frames++;if(performance.now()-published>1000)publish();}});window.terrainEditor=editor;
const panel=document.createElement('aside');panel.id='animationCheck';panel.style.cssText='position:fixed;left:105px;top:125px;z-index:10;width:250px;padding:14px;border:1px solid #658251;border-radius:10px;background:#17251fed;color:#d4e8c3;font:12px/1.5 system-ui;max-height:65vh;overflow:auto';document.body.append(panel);
const title=document.createElement('strong');title.textContent='Проверка скелетной анимации';panel.append(title);
const actions=document.createElement('div');actions.className='btns';panel.append(actions);
const result=document.createElement('pre');result.id='animationCheckResult';result.style.cssText='font:10px/1.5 monospace;white-space:pre-wrap';panel.append(result);
function publish(){published=performance.now();result.textContent=JSON.stringify({busy:editor.busy,objects:editor.world.objects.length,animated:editor.statistics.vegetation.animated,frames,errors,runs},null,2);}
function button(text:string,action:()=>unknown){const b=document.createElement('button');b.type='button';b.className='btn';b.textContent=text;b.onclick=()=>Promise.resolve(action()).catch(e=>{errors.push(String(e));publish();});actions.append(b);}
let packageBlob:Blob|undefined;
button('Сохранить и открыть проект',async()=>{packageBlob=await editor.buildProjectBlob();await editor.loadProjectFile(packageBlob);runs.push({reload:true,bytes:packageBlob.size});publish();});
button('Общий вид моделей',()=>{const h=editor.getH(0,0);editor.setView(4,h+3.8,9,0,h+1.3,0);});
const toggle=document.createElement('button');toggle.textContent='Проверка анимации';toggle.className='btn';toggle.style.cssText='position:fixed;left:105px;bottom:60px;z-index:10';toggle.onclick=()=>panel.hidden=!panel.hidden;document.body.append(toggle);
async function demo(){
    await editor.generateWorld({...defaultWorldRequest(),preset:'jungle',N:128,seed:2026,areaSize:.25,plants:false,routes:false,jungle:{...jungleDefaults('clearing'),atmosphere:false}});
    const asset=await editor.importModel([new File([await animatedFixtureGLB()],'Скелетный манекен.glb')],'animated','none');
    editor.worldActions.replaceWorld({assets:[asset],objects:[]});const first=editor.worldActions.addObject(asset.id,-1.6,0)!,second=editor.worldActions.addObject(asset.id,1.6,0)!;
    editor.worldActions.updateObject(second,{animation:{clip:1,playing:false,speed:1,loop:'repeat',time:.5},tint:.7});
    const h=editor.getH(0,0);editor.setView(4,h+3.8,9,0,h+1.3,0);runs.push({imported:true,first,second});publish();
}
void editor.ready.then(demo).catch(e=>{errors.push(String(e));publish();});
