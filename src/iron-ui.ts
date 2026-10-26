import {createIronControls} from './iron-controls';
import {applyIronSettings} from './iron-editor';
import {ironDefaults,type IronSettings} from './iron-settings';
import type {EditorModel} from './state';
import type {TerrainSystem} from './terrain';
import type {HistorySystem} from './history';
import type {VegetationSystem} from './vegetation';
import type {MaterialsSystem} from './materials';
import type {Feedback} from './feedback';
export function createIronInterface(model:EditorModel,terrain:TerrainSystem,history:HistorySystem,vegetation:VegetationSystem,materials:MaterialsSystem,feedback:Feedback,create:(settings:IronSettings)=>void){
    const el=<K extends keyof HTMLElementTagNameMap>(tag:K,host:HTMLElement,text='')=>{const n=document.createElement(tag);n.textContent=text;host.append(n);return n;};
    const root=el('details',document.getElementById('panel')!);root.id='ironSettings';el('summary',root,'Железные острова');
    const fields=el('fieldset',root);fields.className='jungle-fields';
    const form=createIronControls(fields,ironDefaults(),()=>{},false,false);
    el('p',root,'Применение обновляет океан, атмосферу и растения. Геология сохраняется; параметры островов доступны при создании нового архипелага.').className='hint';
    const apply=el('button',root,'Применить океан и атмосферу');apply.type='button';apply.className='btn primary';
    const newWorld=el('button',root,'Новый архипелаг');newWorld.type='button';newWorld.className='btn';newWorld.onclick=()=>create(form.read());
    let signature='';function sync(){const s=model.world.recipe?.iron,key=JSON.stringify([model.world.preset,s]);if(key!==signature){signature=key;form.sync(s??ironDefaults());}fields.disabled=model.busy;apply.disabled=model.busy||model.world.preset!=='iron-islands';newWorld.disabled=model.busy;}
    apply.onclick=()=>{try{const result=applyIronSettings(model,terrain,history,vegetation,materials,form.read());feedback.syncAllUI();feedback.setStatus(result.plantsChanged?'Океан, атмосфера и растения обновлены.':'Океан и атмосфера обновлены.');}catch(e){feedback.setStatus(e instanceof Error?e.message:String(e));}};
    feedback.uiSync.ironSettings=sync;sync();
}
