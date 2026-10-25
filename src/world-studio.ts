import {WORLD_PRESETS,isWorldPreset} from './world-recipes';
import {WORLD_PRESET_IDS,type WorldPresetId} from './world';
import {worldSettings,type WorldGeneration,type WorldRequest} from './world-generation';
import type {EditorModel} from './state';
import type {Feedback} from './feedback';
import {OperationCancelled} from './worker-jobs';
import {presetArt} from './preset-art';
import {createJungleControls} from './jungle-controls';
import {jungleDefaults,type JungleSettings} from './jungle-settings';
import {createTaigaControls} from './taiga-controls';
import {taigaDefaults,type TaigaSettings} from './taiga-settings';

export function createWorldStudio(model:EditorModel,generation:WorldGeneration,feedback:Feedback,create:()=>Promise<unknown>){
    const panel=document.getElementById('panel')!;
    const el=<K extends keyof HTMLElementTagNameMap>(tag:K,parent:HTMLElement,text='')=>{const e=document.createElement(tag);e.textContent=text;parent.append(e);return e;};
    const root=el('details',panel);root.id='worldStudio';root.open=true;el('summary',root,'Миры');
    const tabs=el('div',root);tabs.className='world-tabs';tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Создание и хранение миров');
    const pages=new Map<string,HTMLElement>(),tabButtons=new Map<string,HTMLButtonElement>();
    function selectTab(id:string){root.open=true;for(const [key,page]of pages){page.hidden=key!==id;tabButtons.get(key)!.setAttribute('aria-selected',String(key===id));tabButtons.get(key)!.tabIndex=key===id?0:-1;}}
    for(const [id,name]of [['new','Создать'],['saved','Мои миры']]){
        const b=el('button',tabs,name);b.type='button';b.setAttribute('role','tab');b.id='world-tab-'+id;b.setAttribute('aria-controls','world-page-'+id);b.onclick=()=>selectTab(id);tabButtons.set(id,b);
        const p=el('section',root);p.id='world-page-'+id;p.setAttribute('role','tabpanel');p.setAttribute('aria-labelledby',b.id);pages.set(id,p);
    }
    tabs.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const id=e.key==='Home'?'new':e.key==='End'?'saved':tabButtons.get('new')!.getAttribute('aria-selected')==='true'?'saved':'new';selectTab(id);tabButtons.get(id)!.focus();});
    const newPage=pages.get('new')!,library=pages.get('saved')!;
    const librarySection=document.getElementById('worldLibrary');if(librarySection)library.append(librarySection);
    const heading=panel.querySelector('h1');if(heading)panel.prepend(heading);if(heading)heading.after(root);else panel.prepend(root);
    el('p',newPage,'Выберите мир. Рельеф, растения и атмосфера будут настроены вместе.').className='world-intro';
    const cards=el('div',newPage);cards.className='world-preset-grid';const cardButtons=new Map<WorldPresetId,HTMLButtonElement>();
    let selected:WorldPresetId='archipelago',ticket=0,working=false,lastDocument='';
    const description=el('div',newPage);description.className='world-recipe-description';
    const fieldset=el('fieldset',newPage);fieldset.className='world-form';el('legend',fieldset,'Параметры мира');
    function row(name:string){const label=el('label',fieldset);label.className='world-form-row';el('span',label,name);return label;}
    const seedRow=row('Сид'),seed=el('input',seedRow);seed.type='number';seed.min='0';seed.max=String(0xffffffff);seed.step='1';seed.value='1337';seed.setAttribute('aria-label','Сид нового мира');
    const dice=el('button',seedRow,'↻');dice.type='button';dice.title='Выбрать новый сид без запуска генерации';dice.setAttribute('aria-label','Случайный сид нового мира');dice.onclick=()=>{seed.value=String(crypto.getRandomValues(new Uint32Array(1))[0]);invalidate();};
    const size=el('select',row('Размер территории'));size.setAttribute('aria-label','Размер нового мира');
    for(const [value,name]of [[.125,'128 м · островок'],[.25,'256 м'],[.5,'512 м'],[.75,'768 м'],[1,'1024 м · вся карта']] as const){const o=el('option',size,name);o.value=String(value);}size.value='1';
    const resolution=el('select',row('Детальность рельефа'));resolution.setAttribute('aria-label','Детальность нового мира');
    for(const [value,name]of [[128,'Быстрая · 128'],[256,'Обычная · 256'],[512,'Подробная · 512']] as const){const o=el('option',resolution,name);o.value=String(value);}resolution.value='256';
    const jungleGroup=el('div',fieldset);jungleGroup.className='jungle-creation-controls';jungleGroup.hidden=true;
    const jungleForm=createJungleControls(jungleGroup,jungleDefaults(),invalidate,true);
    const taigaGroup=el('div',fieldset);taigaGroup.className='jungle-creation-controls';taigaGroup.hidden=true;
    const taigaForm=createTaigaControls(taigaGroup,taigaDefaults(),invalidate,true);
    const extra=el('details',fieldset);extra.className='world-advanced';el('summary',extra,'Настроить рецепт');
    const erosionLabel=el('label',extra,'Естественная обработка'),erosion=el('select',erosionLabel);erosion.setAttribute('aria-label','Эрозия нового мира');
    for(const [value,name]of [[0,'Без эрозии'],[1,'Мягкая · рекомендуется'],[2,'Выраженная']] as const){const o=el('option',erosion,name);o.value=String(value);}erosion.value='1';
    function checkbox(name:string){const l=el('label',extra);l.className='chk';const input=el('input',l);input.type='checkbox';input.checked=true;el('span',l,name);input.setAttribute('aria-label',name);return input;}
    const plants=checkbox('Добавить растения и камни'),routes=checkbox('Добавить прогулочные маршруты');
    const terrainFields=new Map<string,HTMLInputElement>();
    for(const [key,label,min,max,step]of [['height','Высота',0,400,5],['scale','Масштаб',.3,3,.05],['sharp','Острота',0,5,.1],['mountains','Доля гор',0,1,.05],['warp','Изгибы рельефа',0,2,.05]] as const){
        const l=el('label',extra);l.className='world-range';el('span',l,label);const input=el('input',l);input.type='range';input.min=String(min);input.max=String(max);input.step=String(step);input.setAttribute('aria-label',label+' нового мира');const value=el('output',l);input.oninput=()=>{value.value=input.value;invalidate();};terrainFields.set(key,input);
    }
    const actions=el('div',newPage);actions.className='btns world-create-actions';
    const preview=el('button',actions,'Показать эскиз');preview.className='btn';preview.type='button';preview.id='btnPreviewWorld';
    const generate=el('button',actions,'Создать мир');generate.className='btn primary';generate.type='button';generate.id='btnCreateWorld';
    const notice=el('p',newPage,'Текущий мир сохранится в библиотеке. Эрозия, растения и атмосфера применяются автоматически.');notice.className='hint';
    const previewBox=el('figure',newPage);previewBox.className='world-preview';previewBox.hidden=true;
    const canvas=el('canvas',previewBox);canvas.width=canvas.height=65;canvas.setAttribute('role','img');canvas.setAttribute('aria-label','Эскиз рельефа выбранного мира');
    const caption=el('figcaption',previewBox);caption.setAttribute('aria-live','polite');
    function invalidate(){ticket++;if(generation.previewing)generation.cancel();previewBox.hidden=true;}
    function setPreset(id:WorldPresetId){
        selected=id;invalidate();const recipe=WORLD_PRESETS[id];
        jungleGroup.hidden=id!=='jungle';if(id==='jungle')jungleForm.sync(jungleDefaults());
        taigaGroup.hidden=id!=='taiga';if(id==='taiga')taigaForm.sync(taigaDefaults());
        description.replaceChildren();el('strong',description,recipe.name);el('p',description,recipe.description);el('p',description,recipe.plantsLabel).className='hint';el('p',description,recipe.climate).className='world-climate';
        for(const [key,input]of terrainFields){input.value=String(recipe.settings[key as keyof typeof recipe.settings]);(input.nextElementSibling as HTMLOutputElement).value=input.value;}
        for(const [key,b]of cardButtons)b.setAttribute('aria-pressed',String(key===id));
    }
    for(const id of WORLD_PRESET_IDS){const recipe=WORLD_PRESETS[id],b=el('button',cards);b.type='button';b.className='world-preset-card';b.style.setProperty('--world-color',recipe.color);b.setAttribute('aria-label','Пресет '+recipe.name);b.setAttribute('aria-pressed','false');
        const icon=el('span',b);icon.innerHTML=presetArt(id);icon.className='world-preset-icon';icon.setAttribute('aria-hidden','true');el('strong',b,recipe.name);b.onclick=()=>setPreset(id);cardButtons.set(id,b);
    }
    function request():WorldRequest{if(!seed.value.trim())throw new Error('Укажите сид мира или нажмите кнопку случайного сида');return {preset:selected,seed:Number(seed.value),N:Number(resolution.value),areaSize:Number(size.value),erosion:Number(erosion.value) as 0|1|2,plants:plants.checked,routes:routes.checked,...(selected==='jungle'?{jungle:jungleForm.read()}:{}),...(selected==='taiga'?{taiga:taigaForm.read()}:{}),terrain:Object.fromEntries([...terrainFields].map(([key,input])=>[key,Number(input.value)]))};}
    for(const input of [seed,size,resolution,erosion,plants,routes])input.addEventListener('change',invalidate);
    const rgb=(hex:number)=>[(hex>>16)&255,(hex>>8)&255,hex&255];
    preview.onclick=async()=>{
        if(model.busy||generation.previewing)return;const current=++ticket,recipe=WORLD_PRESETS[selected];previewBox.hidden=false;caption.textContent='Расчёт эскиза…';preview.disabled=true;generate.disabled=true;
        try{
            const r=request(),settings=worldSettings(model.state,r),heights=await generation.preview(r,p=>{if(current===ticket)caption.textContent='Эскиз… '+Math.round(p*100)+'%';});if(current!==ticket)return;
            const context=canvas.getContext('2d')!,image=context.createImageData(65,65),sea=rgb(recipe.waterDeep),land=rgb(selected==='desert'?0xd3b37b:selected==='iron-islands'?0x687575:0x819968);let dry=0;
            heights.forEach((h,k)=>{const water=h<settings.water,depth=Math.min(1,Math.abs(h-settings.water)/30),base=water?sea:land,shade=water?.9-depth*.25:.8+Math.min(.35,(h-settings.water)/Math.max(20,settings.height)*.5);if(!water)dry++;
                for(let c=0;c<3;c++)image.data[k*4+c]=Math.min(255,base[c]*shade);image.data[k*4+3]=255;});context.putImageData(image,0,0);caption.textContent=recipe.name+' · сид '+r.seed+' · суша '+Math.round(dry/heights.length*100)+'%. Эскиз 64×64, до эрозии.';
        }catch(error){if(!(error instanceof OperationCancelled)){caption.textContent=String(error instanceof Error?error.message:error);feedback.setStatus(caption.textContent);}}
        finally{preview.disabled=generate.disabled=model.busy;}
    };
    generate.onclick=async()=>{if(model.busy||generation.previewing||working)return;working=true;synchronize();try{worldSettings(model.state,request());await create();}catch(error){feedback.setStatus(String(error instanceof Error?error.message:error));}finally{working=false;synchronize();}};
    function synchronize(){
        fieldset.disabled=model.busy||working;for(const b of cardButtons.values())b.disabled=model.busy||working;
        preview.disabled=generate.disabled=model.busy||working||generation.previewing;
        const documentKey=JSON.stringify([model.world.preset,model.state.seed,model.state.N,model.state.areaSize,model.world.recipe]);
        if(lastDocument!==documentKey){lastDocument=documentKey;if(isWorldPreset(model.world.preset)){
                setPreset(model.world.preset);for(const [key,input]of terrainFields){input.value=String(model.state[key as keyof typeof model.state]);(input.nextElementSibling as HTMLOutputElement).value=input.value;}
            }
            seed.value=String(model.state.seed);
            if(![...resolution.options].some(o=>o.value===String(model.state.N))){const o=el('option',resolution,'Текущая · '+model.state.N);o.value=String(model.state.N);}
            if(![...size.options].some(o=>o.value===String(model.state.areaSize))){const o=el('option',size,Math.round(model.state.areaSize*1024)+' м');o.value=String(model.state.areaSize);}
            resolution.value=String(model.state.N);size.value=String(model.state.areaSize);
            const saved=model.world.recipe;if(saved){erosion.value=String(saved.erosion);plants.checked=saved.plants;routes.checked=saved.routes;if(saved.jungle)jungleForm.sync(saved.jungle);if(saved.taiga)taigaForm.sync(saved.taiga);}
        }
    }
    setPreset('archipelago');selectTab('new');feedback.uiSync.worldCreation=synchronize;synchronize();
    function reveal(id:string){selectTab(id);root.dispatchEvent(new Event('workspace-reveal',{bubbles:true}));}
    return {request,selectNew(){reveal('new');},selectSaved(){reveal('saved');},selectJungle(settings:JungleSettings=jungleDefaults()){setPreset('jungle');jungleForm.sync(settings);reveal('new');},selectTaiga(settings:TaigaSettings=taigaDefaults()){setPreset('taiga');taigaForm.sync(settings);reveal('new');}};
}
export type WorldStudio=ReturnType<typeof createWorldStudio>;
