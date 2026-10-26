import {GRAPHIC_FILTERS} from './graphic-filters';
import {MIN_AREA_SIZE,AREA_SIZE_STEP,territoryLabel} from './territory-size';
import { modelEntries,getModel } from './model-library';
import type { ModelAsset } from './world';
import type { BrushSystem } from './brushes';
import type { ControlsSystem } from './controls';
import type { WorldEdits } from './edits';
import type { Feedback } from './feedback';
import type { GenerationSystem } from './generation';
import type { HistorySystem, HistoryTransaction } from './history';
import type { LightingSystem } from './lighting';
import type { MaterialsSystem } from './materials';
import type { RenderingSystem } from './rendering';
import type { EditorState } from './state';
import { RESOLUTIONS, TOOLS, type EditorActions, type EditorModel, type ToolId } from './state';
import type { StorageSystem } from './storage';
import type { VegetationSystem } from './vegetation';
import type { WeatherSystem } from './weather';
import { deriveSeeds, type OperationSeeds, type WalkSettings } from './world';
import { QUALITY_PROFILES } from './quality';
import type { NatureAudio } from './nature-audio';
import {generationOctaveLimit} from './generation-settings';
import {jungleDefaults,JUNGLE_VARIANTS,type JungleVariant} from './jungle-settings';
import {taigaDefaults,TAIGA_VARIANTS,type TaigaVariant} from './taiga-settings';
type NumericKey = {
    [K in keyof EditorState]: EditorState[K] extends number ? K : never;
}[keyof EditorState];
type BooleanKey = {
    [K in keyof EditorState]: EditorState[K] extends boolean ? K : never;
}[keyof EditorState];
type Attributes = Record<string, string | number | EventListener>;
export function createInterface(model: EditorModel, feedback: Feedback, actions: EditorActions, history: HistorySystem, generation: GenerationSystem, materials: MaterialsSystem, render: RenderingSystem, brushes: BrushSystem, lighting: LightingSystem, vegetation: VegetationSystem, storage: StorageSystem, input: ControlsSystem, weather: WeatherSystem, edits: WorldEdits,audio:NatureAudio) {
    const panel = document.getElementById('panel')!;
    const toolListeners = new Set<(tool: ToolId) => void>();
    function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attributes = {}, parent?: HTMLElement) {
        const e = document.createElement(tag);
        for (const [k, v] of Object.entries(attrs)) {
            if (k === 'text')
                e.textContent = String(v);
            else if (k === 'html')
                e.innerHTML = String(v);
            else if (k.startsWith('on') && typeof v === 'function')
                e.addEventListener(k.slice(2), v);
            else
                e.setAttribute(k, String(v));
        }
        parent?.appendChild(e);
        return e;
    }
    function section(title: string, open = true) {
        const d = el('details', {}, panel);
        if (open)
            d.open = true;
        el('summary', { text: title }, d);
        return d;
    }
    function slider(parent: HTMLElement, key: NumericKey, label: string, min: number, max: number, step: number, onChange: (() => unknown) | null, fmt: (value: number) => string | number = v => v) {
        const row = el('div', { class: 'row' }, parent);
        el('label', { text: label, title: label }, row);
        const inp = el('input', { type: 'range', min, max, step, 'data-key': key,'aria-label':label }, row);
        const val = el('span', { class: 'val' }, row);
        const sync = () => { inp.value = String(model.state[key]); val.textContent = String(fmt(model.state[key])); };
        let edit: HistoryTransaction | undefined;
        inp.addEventListener('input', () => {
            if (model.busy) {
                sync();
                return;
            }
            if (!edit?.active)
                edit = history.begin(label);
            model.state[key] = parseFloat(inp.value);
            val.textContent = String(fmt(model.state[key]));
            onChange?.();
        });
        inp.addEventListener('change', () => { edit?.commit(); edit = undefined; });
        inp.addEventListener('blur', () => { edit?.commit(); edit = undefined; });
        feedback.uiSync[key] = sync;
        sync();
        return inp;
    }
    function checkbox(parent: HTMLElement, key: BooleanKey, label: string, onChange?: () => unknown) {
        const lab = el('label', { class: 'chk' }, parent);
        const inp = el('input', { type: 'checkbox' }, lab);
        el('span', { text: label }, lab);
        inp.addEventListener('change', () => { history.transaction(label, () => { model.state[key] = inp.checked; onChange?.(); }); feedback.syncUI(key); });
        feedback.uiSync[key] = () => inp.checked = model.state[key];
        feedback.uiSync[key]();
    }
    function button(parent: HTMLElement, text: string, onClick: () => unknown, cls = '') {
        return el('button', { class: 'btn ' + cls, text, onclick: () => {
            try { Promise.resolve(onClick()).catch(error => feedback.setStatus('Ошибка: ' + String(error instanceof Error ? error.message : error))); }
            catch (error) { feedback.setStatus('Ошибка: ' + String(error instanceof Error ? error.message : error)); }
        } }, parent);
    }
    el('h1', { html: '⛰ Редактор ландшафта <small>open world</small>' }, panel);
    // --- Генерация
    const sGen = section('Рельеф текущего мира',false);sGen.id='terrainSettings';
    {
        const row = el('div', { class: 'row' }, sGen);
        el('label', { text: 'Сид' }, row);
        const inp = el('input', { type: 'number', min: 0, max: 0xffffffff, step: 1,'aria-label':'Сид' }, row);
        inp.addEventListener('change', () => {
            const value = Number(inp.value);
            if (Number.isInteger(value) && value >= 0 && value <= 0xffffffff)
                edits.setSeeds({ terrain: value }, true);
            feedback.syncUI('seed');
        });
        button(row, '🎲', () => actions.generateAll(false, () => {
            const seed = crypto.getRandomValues(new Uint32Array(1))[0];
            model.state.seed = seed;
            model.seeds = deriveSeeds(seed);
            feedback.syncAllUI();
        })).title = 'Случайный сид';
        feedback.uiSync.seed = () => inp.value = String(model.state.seed);
        feedback.uiSync.seed();
        const row2 = el('div', { class: 'row' }, sGen);
        el('label', { text: 'Сетка (сегменты)' }, row2);
        const sel = el('select', {'aria-label':'Сетка (сегменты)'}, row2);
        for (const v of RESOLUTIONS)
            el('option', { value: v, text: `${v}×${v}` }, sel);
        sel.addEventListener('change', () => {
            if (model.busy) {
                sel.value = String(model.N);
                return;
            }
            Promise.resolve(actions.generateAll(false, () => { model.state.N = +sel.value; })).catch(error => feedback.setStatus('Ошибка: ' + String(error))); 
        });
        feedback.uiSync.N = () => sel.value = String(model.state.N);
        feedback.uiSync.N();
        el('span', {}, row2);
    }
    slider(sGen, 'areaSize', 'Размер территории', MIN_AREA_SIZE, 1, AREA_SIZE_STEP, syncOctaveRange, territoryLabel);
    el('p', { class: 'hint', text: 'Размер по ширине карты: от островка 128 м до всей карты 1024 м. Применяется при генерации и создании пресета. Уменьшенная территория окружена водой; для маленьких островов удобнее сетка 256/512.' }, sGen);
    slider(sGen, 'scale', 'Масштаб', 0.3, 3, 0.05, syncOctaveRange, v => `${v.toFixed(2)}×`).title='Больше значение — крупнее горные массивы и долины. Вертикальная высота задаётся отдельно.';
    slider(sGen, 'height', 'Высота, м', 0, 400, 5, null, v => v.toFixed(0)).title='Предельный подъём над равниной. 0 — плоская суша; острота и доля гор определяют, где и насколько используется эта высота.';
    const octavesSlider=slider(sGen, 'octaves', 'Октавы', 1, 9, 1, null);
    const originalOctaveSync=feedback.uiSync.octaves;
    const octaveHint=el('p',{class:'hint'},sGen);
    function syncOctaveRange(){
        const limit=generationOctaveLimit(model.state),used=Math.min(limit,model.state.octaves);
        octavesSlider.max=String(limit);octavesSlider.value=String(used);octavesSlider.parentElement!.querySelector('.val')!.textContent=String(used);
        octaveHint.textContent=`Октавы добавляют мелкие детали. Для выбранных сетки, площади и масштаба доступны 1–${limit}. Более плотная сетка позволяет добавить детали.`;
    }
    feedback.uiSync.octaves=()=>{originalOctaveSync();syncOctaveRange();};feedback.uiSync.generationSettings=syncOctaveRange;syncOctaveRange();
    slider(sGen, 'sharp', 'Острота гор', 0, 5, 0.1, null, v => v.toFixed(1)).title='0 — плоская равнина; 1 — мягкие холмы; 2–3 — горные массивы; 4–5 — крутые склоны и острые вершины.';
    el('p',{class:'hint',text:'Острота: 0 — равнина · 1 — холмы · 2–3 — горы · 4–5 — острые пики. При включённом острове берег и морское дно сохраняются.'},sGen);
    slider(sGen, 'mountains', 'Доля гор', 0, 1, 0.01, null, v => `${Math.round(v*100)}%`).title='Доля суши, занятая горными областями: 0% — только низкие холмы; 100% — горные массивы по всей суше. Острота 0 отключает весь рельеф.';
    slider(sGen, 'warp', 'Искажение (warp)', 0, 2, 0.05, null, v => v.toFixed(2)).title='0 — исходная форма; больше значение — сильнее изгибаются хребты и долины. Высота задаётся отдельно.';
    checkbox(sGen, 'island', 'Остров (естественные берега)');
    el('p', {class:'hint',text:'Параметры применяются кнопкой «Сгенерировать». Высота равнины — 3 м над водой; ползунок высоты задаёт дополнительный подъём. Сид повторяет тот же мир при тех же параметрах. На сетке 256/512 пики и берега подробнее.'}, sGen);
    {
        const b = el('div', { class: 'btns' }, sGen);
        button(b, 'Сгенерировать', () => actions.generateAll(), 'primary').id = 'btnGen';
    }
    // --- Эрозия
    const sEro = section('Дополнительная эрозия',false);sEro.id='erosionSettings';
    slider(sEro, 'droplets', 'Капли, тыс.', 10, 600, 10, null, v => v.toFixed(0));
    slider(sEro, 'erosionStrength', 'Сила размыва', 0.02, 0.5, 0.01, null, v => v.toFixed(2));
    slider(sEro, 'thermal', 'Термич. проходы', 0, 60, 1, null);
    {
        const b = el('div', { class: 'btns' }, sEro);
        button(b, 'Эрозия', () => generation.runErosion(), 'primary').id = 'btnErode';
    }

    el('div', { class: 'hint', text: 'Гидравлическая эрозия каплями размывает долины и русла, термическая — осыпает слишком крутые склоны.' }, sEro);
    // --- Кисти
    const sBr = section('Кисти');
    sBr.id = 'brushSettings';
    const toolGrid = el('div', { class: 'tools' }, sBr);
    const toolBtns = {} as Record<ToolId, HTMLButtonElement>;
    TOOLS.forEach(([id, name], i) => { toolBtns[id] = button(toolGrid, name, () => setTool(id)); toolBtns[id].title = `${name} (${i + 1})`; toolBtns[id].dataset.tool = id; toolBtns[id].setAttribute('aria-label', name); });
    const layerLabel = el('div', { class: 'hint', text: 'Слой текстуры:' }, sBr);
    const layerGrid = el('div', { class: 'layers' }, sBr);
    const layerBtns: HTMLButtonElement[] = [];
    ['Трава', 'Скала', 'Песок', 'Снег', 'Ластик', 'Подстилка', 'Почва', 'Гравий', 'Мох'].forEach((nm, i) => layerBtns.push(button(layerGrid, nm, () => { model.state.layer = i; refreshTools(); })));
    slider(sBr, 'radius', 'Радиус, м', 2, 200, 1, () => materials.terrainUniforms.uBrushRadius.value = model.state.radius, v => v.toFixed(0));
    slider(sBr, 'strength', 'Сила', 0.02, 1, 0.01, null, v => v.toFixed(2));
    slider(sBr, 'falloff', 'Мягкость края', 0, 1, 0.01, () => materials.terrainUniforms.uBrushFalloff.value = model.state.falloff, v => v.toFixed(2));
    {
        const b = el('div', { class: 'btns' }, sBr);
        button(b, '↶ Отменить', history.undo).id = 'btnUndo';
        button(b, '↷ Повторить', history.redo).id = 'btnRedo';
    }
    function setTool(id: ToolId) { input.cancelTerrainTool(); model.state.tool = id; render.setLeftButton(); refreshTools(); }
    function refreshTools() {
        for (const [id] of TOOLS) {
            toolBtns[id].classList.toggle('active', model.state.tool === id);
            toolBtns[id].setAttribute('aria-pressed', String(model.state.tool === id));
        }
        layerBtns.forEach((b, i) => b.classList.toggle('active', model.state.layer === i));
        const show = model.state.tool === 'paint';
        layerGrid.style.display = show ? '' : 'none';
        layerLabel.style.display = show ? '' : 'none';
        const c = model.state.tool === 'paint' ? brushes.LAYER_COLORS[model.state.layer] : brushes.BRUSH_COLORS[model.state.tool];
        materials.terrainUniforms.uBrushColor.value.setRGB(c[0], c[1], c[2]);
        for (const listener of toolListeners) listener(model.state.tool);
    }
    // --- Материалы
    const sMat = section('Материалы', false);
    sMat.id = 'materialSettings';
    slider(sMat, 'groundDetail', 'Микрорельеф', 0, 2, 0.05, materials.updateMaterial, v => v.toFixed(2));
    slider(sMat, 'snowLine', 'Граница снега, м', 10, 400, 1, materials.updateMaterial, v => v.toFixed(0));
    slider(sMat, 'rockSlope', 'Уклон скал', 0.08, 0.7, 0.01, materials.updateMaterial, v => v.toFixed(2));
    el('div', { class: 'hint', text: 'Авто-раскраска: песок у воды, трава, земля, скалы на крутых склонах (трипланарно), снег на вершинах.' }, sMat);
    {
        const b = el('div', { class: 'btns' }, sMat);
        button(b, 'Очистить ручную покраску', () => history.transaction('Очистить покраску', () => { model.splat.fill(0); model.splatDetail.fill(0); materials.splatTex.needsUpdate = true; materials.detailTex.needsUpdate = true; feedback.setStatus('Ручная покраска очищена'); }));
    }
    // --- Вода
    const sWat = section('Вода', false);
    sWat.id = 'oceanSettings';
    el('p',{class:'hint',text:'Эти параметры управляют морем. Для независимых водоёмов используйте раздел «Озёра и реки».'},sWat);
    slider(sWat, 'water', 'Уровень воды, м', -20, 200, 0.5, () => { materials.updateWater(); vegetation.snapScatter(); }, v => v.toFixed(1));
    slider(sWat, 'waterOpacity', 'Непрозрачность', 0.2, 1, 0.01, materials.updateWater, v => v.toFixed(2));
    slider(sWat, 'wave', 'Волны', 0, 3, 0.05, materials.updateWater, v => v.toFixed(2));
    const clarityRow=el('label',{text:'Прозрачность моря, м'},sWat),clarity=el('input',{type:'number',min:.2,max:40,step:.5,'aria-label':'Прозрачность моря, м'},clarityRow);
    clarity.onchange=()=>{try{edits.replaceWorld({waterBodies:model.world.waterBodies.map(b=>b.kind==='ocean'?{...b,clarity:Number(clarity.value)}:b)},'Прозрачность моря');materials.updateWater();}catch(e){feedback.setStatus(String(e));}feedback.syncUI('oceanClarity');};
    feedback.uiSync.oceanClarity=()=>clarity.value=String(model.world.waterBodies.find(b=>b.kind==='ocean')?.clarity??12);feedback.syncUI('oceanClarity');
    el('p',{class:'hint',text:'Прозрачность — расстояние видимости дна. Сильный ветер создаёт высокое длинное волнение. На мелководье волны ломаются и набегают на берег; «Волны = 0» оставляет воду спокойной. Профиль качества регулирует сетку, преломление, отражения и число кругов от касаний.'},sWat);
    // --- Небо и свет
    const sSky = section('Небо и освещение', false);
    sSky.id = 'skySettings';
    const manualSun=()=>{model.state.dayCycle=false;lighting.updateSun();feedback.syncUI('dayCycle');};
    slider(sSky, 'sunAz', 'Азимут солнца', 0, 360, 1, manualSun, v => v.toFixed(0) + '°');
    slider(sSky, 'sunEl', 'Высота солнца', -60, 89, 0.5, manualSun, v => v.toFixed(1) + '°');
    slider(sSky,'dayTime','Время суток',0,23.95,.05,()=>lighting.setTime(model.state.dayTime),v=>`${String(Math.floor(v)).padStart(2,'0')}:${String(Math.floor((v%1)*60)).padStart(2,'0')}`);
    checkbox(sSky,'dayCycle','Смена дня и ночи',()=>{if(model.state.dayCycle)lighting.setTime(model.state.dayTime);});
    slider(sSky,'dayDuration','Длительность суток, мин',2,120,1,null,v=>v.toFixed(0));
    el('p',{class:'hint',text:'Время суток задаёт условный суточный цикл. Свет, небо и звёзды меняются плавно. Ручная настройка высоты или азимута солнца отключает автоматический цикл.'},sSky);
    slider(sSky, 'fog', 'Базовый туман', 0, 1, 0.01, lighting.updateFog, v => v.toFixed(2));
    checkbox(sSky, 'shadows', 'Тени', lighting.updateShadows);
    const graphics=section('Качество графики',false);
    graphics.id = 'graphicsSettings';
    const quality=el('select',{'aria-label':'Профиль качества'},graphics);
    for(const [id,profile]of Object.entries(QUALITY_PROFILES))el('option',{value:id,text:profile.name},quality);
    quality.onchange=()=>edits.setPreferences({quality:quality.value as EditorState['quality']});feedback.uiSync.quality=()=>quality.value=model.state.quality;feedback.uiSync.quality();
    const filterLabel=el('label',{text:'Графический фильтр'},graphics),filter=el('select',{'aria-label':'Графический фильтр'},filterLabel);
    for(const [id,name]of Object.entries(GRAPHIC_FILTERS))el('option',{value:id,text:name},filter);
    filter.onchange=()=>edits.setPreferences({graphicFilter:filter.value as EditorState['graphicFilter']});feedback.uiSync.graphicFilter=()=>filter.value=model.state.graphicFilter;feedback.uiSync.graphicFilter();
    checkbox(graphics,'waterReflections','Отражения в воде');
    slider(graphics,'exposure','Экспозиция',0.2,2,0.05,null,v=>v.toFixed(2));
    slider(graphics,'contactAO','Контактное затемнение',0,0.6,0.02,materials.updateMaterial,v=>v.toFixed(2));
    el('div',{class:'hint',text:'Профиль задаёт разрешение, дальность деталей и качество теней. Экономный отключает тени и контактное затемнение; вода отражает небо. Сбалансированный и высокий добавляют отражение сцены 256/512 и детали мелководья. В прогулке тени сосредоточены возле камеры.'},graphics);
    // --- Растительность
    const sVeg = section('Растительность', false);
    sVeg.id = 'vegetationSettings';
    el('div',{id:'vegetationBrushPanel'},sVeg);
    checkbox(sVeg, 'showFoliage', 'Трава, цветы, папоротники и мох');
    slider(sVeg, 'foliageDensity', 'Мелкая растительность', 0, 1, 0.05, null, v => v.toFixed(2));
    slider(sVeg, 'foliageDistance', 'Дальность травы, м', 10, 80, 5, null);
    slider(sVeg, 'treeDensity', 'Плотность деревьев', 0, 1, 0.01, null, v => v.toFixed(2));
    slider(sVeg, 'rockDensity', 'Плотность камней', 0, 1, 0.01, null, v => v.toFixed(2));
    slider(sVeg,'soilMoisture','Влажность почвы',0,1,0.05,null,v=>v.toFixed(2));
    slider(sVeg,'clearingAmount','Выраженность полян',0,1,0.05,null,v=>v.toFixed(2));
    checkbox(sVeg, 'showScatter', 'Показывать', () => { vegetation.setVisibilityScatter(); materials.updateForestCover(); });
    {
        const b = el('div', { class: 'btns' }, sVeg);
        button(b, 'Расставить растительность', () => history.transaction('Расстановка объектов', () => { vegetation.scatter(); feedback.syncAllUI(); }), 'primary').id = 'btnScatter';
        button(b, 'Убрать', () => history.transaction('Убрать расстановку', () => { vegetation.clearScatter(); feedback.syncAllUI(); feedback.setStatus('Растительность убрана'); }));
    }
        el('div', { class: 'hint', text: 'Леса, опушки и поляны учитывают биомы, влажность и уклон. Новая расстановка сохраняет ручные объекты, избегает пересечений и оставляет тропы свободными. После изменения параметров нажмите «Расставить растительность».' }, sVeg);
    const sSeeds = section('Сиды операций', false);
    sSeeds.id = 'seedSettings';
    for (const [key, label] of [['erosion', 'Эрозия'], ['scatter', 'Растительность'], ['brush', 'Кисть «Шум»'], ['composition', 'Композиция']] as [
        keyof OperationSeeds,
        string
    ][]) {
        const row = el('div', { class: 'row' }, sSeeds);
        el('label', { text: label }, row);
        const field = el('input', { type: 'number', min: 0, max: 0xffffffff, step: 1, 'data-seed': key }, row);
        field.addEventListener('change', () => {
            const value = Number(field.value);
            if (Number.isInteger(value) && value >= 0 && value <= 0xffffffff)
                edits.setSeeds({ [key]: value });
            feedback.syncUI('seed-' + key);
        });
        feedback.uiSync['seed-' + key] = () => { field.value = String(model.seeds[key]); };
        feedback.syncUI('seed-' + key);
    }
    el('div', { class: 'hint', text: 'Одинаковые сид, параметры и исходный рельеф дают одинаковый результат. Сиды и журнал операций сохраняются в проекте.' }, sSeeds);
    const quickObjects = section('Добавление объектов', false);
    quickObjects.id = 'quickObjects';
    const objectButtons = el('div', {class:'btns'}, quickObjects);
    for(const [asset,label]of [['pine','Добавить дерево'],['rock','Добавить камень']] as const)button(objectButtons,label,()=>{
        const id=edits.addObject(asset,Math.max(-512,Math.min(512,render.controls.target.x)),Math.max(-512,Math.min(512,render.controls.target.z)));
        if(id)input.selectObject(id);
    });
    const library = section('Библиотека моделей', false);
    library.id = 'modelSettings';
    const placement = el('div',{class:'asset-placement'},library);
    el('label',{for:'placementModel',text:'Модель для размещения'},placement);
    const assetSelect = el('select', { id:'placementModel','aria-label': 'Модель для размещения' }, placement);
    const syncAssets = () => {
        const selected = assetSelect.value; assetSelect.replaceChildren();
        for (const asset of modelEntries(model.world)) el('option', { value: asset.id, text: asset.name+(asset.rig?' · анимация':'') }, assetSelect);
        if (modelEntries(model.world).some(asset => asset.id === selected)) assetSelect.value = selected;
    };
    feedback.uiSync.assets = syncAssets; syncAssets();
    button(placement, 'Разместить выбранную модель', () => {
        const x = Math.max(-512, Math.min(512, render.controls.target.x)), z = Math.max(-512, Math.min(512, render.controls.target.z));
        const id = edits.addObject(assetSelect.value, x, z); if (id) input.selectObject(id);
    });
    const imports = el('div',{class:'asset-import'},library);
    el('h3',{text:'Своя модель'},imports);
    el('p',{class:'hint',text:'GLB / glTF · скелеты и анимации · без лимитов размера и сложности'},imports);
    el('label',{for:'importModelCategory',text:'Категория'},imports);
    const category = el('select', { id:'importModelCategory','aria-label': 'Категория импортируемой модели' }, imports);
    for (const [id, label] of [['tree','Дерево'],['shrub','Куст'],['rock','Камень'],['wood','Природный объект'],['bridge','Мост / настил'],['structure','Постройка / пещера'],['animated','Персонаж / анимированный объект']]) el('option', { value: id, text: label }, category);
    category.value='structure';
    const collision=el('select',{'aria-label':'Коллизии импортируемой модели'},imports);
    for(const [value,text]of [['mesh','Точная геометрия: палубы, стены, проходы'],['convex','Выпуклая оболочка'],['trunk','Ствол'],['none','Без коллизий']])el('option',{value,text},collision);
    collision.value='mesh';
    button(imports,'Применить коллизии к выбранной модели',async()=>{
        const asset=await storage.prepareModelCollision(assetSelect.value,collision.value as ModelAsset['collider']);
        edits.replaceWorld({assets:model.world.assets.map(a=>a.id===asset.id?asset:a)},'Коллизии модели');
        feedback.setStatus('Коллизии модели обновлены');
    });
    let importingModel = false;
    function chooseImport(replaceId?:string) {
        if (importingModel || model.busy) return;
        const picker = document.createElement('input'); picker.type = 'file'; picker.multiple = true; picker.accept = '.glb,.gltf,.bin,image/*'; picker.hidden = true; document.body.append(picker);
        picker.addEventListener('cancel', () => picker.remove(), { once: true });
        picker.onchange = async () => {
            try {
                if (model.busy || !picker.files?.length) return;
                importingModel = true; importButton.disabled = true;
                feedback.setStatus('Загрузка модели…');
                const kind = (replaceId?model.world.assets.find(a=>a.id===replaceId)!.category:category.value) as ModelAsset['category'];
                const imported = await storage.importModel([...picker.files], kind, collision.value as ModelAsset['collider'],replaceId);
                const asset=replaceId?{...imported,id:replaceId}:imported;
                if (model.busy) throw new Error('Дождитесь завершения операции и повторите импорт');
                edits.replaceWorld({ assets: replaceId?model.world.assets.map(a=>a.id===replaceId?asset:a):[...model.world.assets, asset] }, replaceId?'Заменить модель':'Импорт модели'); assetSelect.value = asset.id;
                const ready=getModel(asset.id);feedback.setStatus(replaceId?'Модель обновлена. Положение, масштаб и настройки экземпляров сохранены.':ready.rig?`Модель импортирована · костей: ${ready.rig.bones} · клипов: ${ready.rig.clips.length}. Разместите её в сцене.`:'Модель импортирована. Разместите её в сцене.');
            } catch (error) { feedback.setStatus('Импорт модели: ' + String(error instanceof Error ? error.message : error)); }
            finally { importingModel = false; importButton.disabled = false; picker.remove();syncReplacement(); }
        }; picker.click();
    }
    const importButton = button(imports, 'Импорт GLB / glTF', () => chooseImport());
    const replaceButton=button(imports,'Заменить выбранную модель из файла',()=>{const id=assetSelect.value;if(model.world.assets.some(a=>a.id===id))chooseImport(id);});
    function syncReplacement(){replaceButton.disabled=importingModel||model.busy||!model.world.assets.some(a=>a.id===assetSelect.value);}
    assetSelect.addEventListener('change',syncReplacement);feedback.uiSync.modelReplacement=syncReplacement;syncReplacement();
    el('p',{class:'hint',text:'Замена обновляет все экземпляры выбранной модели, сохраняя их положение и масштаб. Действие можно отменить.'},imports);
    el('div', { class: 'hint', text: 'Скелеты и клипы определяются автоматически. После размещения выберите объект: клип, пауза, скорость и повтор доступны в его параметрах. Коллизии по умолчанию точные; для анимации используется исходная поза. Для glTF выберите также BIN и текстуры. Лимиты размера, числа моделей, частей, вершин, костей и клипов сняты. Фактический объём зависит от памяти и хранилища браузера. Полный проект .terrain включает модели и анимации для работы офлайн.' }, library);
    const biomeSection=section('Локальные биомы',false),biomeKind=el('select',{'aria-label':'Вид биома'},biomeSection);biomeSection.id='biomeSettings';
    for(const [id,name]of [['forest','Лес'],['meadow','Луг / поляна'],['coast','Побережье'],['mountains','Горы'],['valley','Долина'],['taiga','Тайга / Boreal Forest'],['jungle','Джунгли / Tropical Jungle']])el('option',{value:id,text:name},biomeKind);
    const biomeRadius=el('input',{type:'number',min:10,max:512,value:100,'aria-label':'Радиус биома, м'},biomeSection);
    const jungleVariant=el('select',{'aria-label':'Вариант локальных джунглей'},biomeSection);jungleVariant.hidden=true;
    for(const [id,variant]of Object.entries(JUNGLE_VARIANTS))el('option',{value:id,text:variant.name},jungleVariant);
    const taigaVariant=el('select',{'aria-label':'Вариант локальной тайги'},biomeSection);taigaVariant.hidden=true;
    for(const [id,variant]of Object.entries(TAIGA_VARIANTS))el('option',{value:id,text:variant.name},taigaVariant);
    biomeKind.addEventListener('change',()=>{jungleVariant.hidden=biomeKind.value!=='jungle';taigaVariant.hidden=biomeKind.value!=='taiga';});
    button(biomeSection,'Добавить биом в центре вида',()=>{
        const kind=biomeKind.value as typeof model.world.biomes[number]['kind'];let id=1;const entities=[...model.world.biomes,...model.world.objects,...model.world.routes,...model.world.waterBodies,...model.world.groups,...model.world.viewpoints];while(entities.some(b=>b.id===`biome-${id}`))id++;
        edits.replaceWorld({biomes:[...model.world.biomes,{id:`biome-${id}`,name:kind==='jungle'?JUNGLE_VARIANTS[jungleVariant.value as JungleVariant].name:kind==='taiga'?TAIGA_VARIANTS[taigaVariant.value as TaigaVariant].name:biomeKind.selectedOptions[0].text,kind,center:[Math.max(-512,Math.min(512,render.controls.target.x)),Math.max(-512,Math.min(512,render.controls.target.z))],radius:Number(biomeRadius.value),...(kind==='jungle'?{jungle:jungleDefaults(jungleVariant.value as JungleVariant)}:{}),...(kind==='taiga'?{taiga:taigaDefaults(taigaVariant.value as TaigaVariant)}:{})}]},'Добавить биом');
    });
    const biomeList=el('div',{class:'hint'},biomeSection);feedback.uiSync.biomes=()=>biomeList.textContent=model.world.biomes.map(b=>`${b.name} · ${b.radius} м`).join('; ')||'Заданных биомов нет — используется естественное распределение.';feedback.uiSync.biomes();
    button(biomeSection,'Убрать последний биом',()=>edits.replaceWorld({biomes:model.world.biomes.slice(0,-1)},'Убрать биом'));
    const soundSection=section('Природный звук',false);
    soundSection.id = 'soundSettings';
    checkbox(soundSection,'soundEnabled','Звук в прогулке',()=>void audio.unlock());
    slider(soundSection,'soundVolume','Общая громкость',0,1,0.05,null,v=>`${Math.round(v*100)}%`);
    slider(soundSection,'ambienceVolume','Окружение',0,1,0.05,null,v=>`${Math.round(v*100)}%`);
    slider(soundSection,'footstepVolume','Шаги',0,1,0.05,null,v=>`${Math.round(v*100)}%`);
    el('div',{class:'hint','data-audio-status':'',text:audio.status},soundSection);
    feedback.uiSync.audioState=()=>document.querySelectorAll<HTMLElement>('[data-audio-status]').forEach(e=>e.textContent=audio.status);
    // --- Файлы
    const sFile = section('Файлы', false);
    sFile.id = 'fileSettings';
    {
        const b = el('div', { class: 'btns' }, sFile);
        button(b, 'Экспорт PNG (16 бит)', storage.exportPNG16);
        button(b, 'Импорт PNG', () => storage.pickFile('image/png,image/*', storage.importHeightmap));
        const b2 = el('div', { class: 'btns' }, sFile);
        button(b2, 'Сохранить проект .terrain', storage.saveProject);
        button(b2, 'Загрузить проект', () => storage.pickFile('.terrain,.json,application/json,application/x-terrain-project', storage.loadProjectFile));
        el('div',{class:'hint',text:'Полный проект .terrain переносит мир вместе с моделями. Старые JSON-проекты также открываются.'},sFile);
        const b3 = el('div', { class: 'btns' }, sFile);
        button(b3, 'Экспорт OBJ', storage.exportOBJ);
    }
    // --- Камера
    const sCam = section('Камера', false);
    sCam.id = 'cameraSettings';
    checkbox(sCam, 'fly', 'Полёт WASD / QE (Shift — быстрее)');
    {
        const b = el('div', { class: 'btns' }, sCam);
        button(b, 'Сбросить вид', input.resetCamera);
        const wb = button(b, '🚶 Режим прогулки (P)', () => input.setWalk(!input.walk.on), 'primary');
        wb.id = 'btnWalk';
        button(b, 'Выбрать точку старта', input.chooseStart).id = 'btnChooseStart';
        feedback.uiSync.walkBtn = () => { wb.textContent = input.walk.on ? '✖ Выйти из прогулки (P)' : '🚶 Режим прогулки (P)'; };
    }
    el('div', { class: 'hint', text: 'P — начать на безопасной площадке. «Выбрать точку старта» — начать кликом по местности. В прогулке: E — панель редактора, Esc — настройки, R — автопрогулка, P — выход.' }, sCam);
    const sWalk = section('Настройки прогулки', false);
    sWalk.id = 'walkSettings';
    for (const [key, label, min, max, step] of [
        ['speed', 'Скорость, м/с', 0.1, 30, 0.1], ['sprint', 'Множитель бега', 1, 5, 0.1],
        ['eyeHeight', 'Высота глаз, м', 0.5, 3, 0.1], ['jumpSpeed', 'Сила прыжка', 0, 30, 0.1],
        ['sensitivity', 'Мышь', 0.0001, 0.02, 0.0001], ['fov', 'Угол обзора, °', 45, 110, 1],
    ] as [
        Exclude<keyof WalkSettings, 'bob'>,
        string,
        number,
        number,
        number
    ][]) {
        const row = el('div', { class: 'row' }, sWalk);
        el('label', { text: label }, row);
        const field = el('input', { type: 'number', min, max, step, 'data-walk': key }, row);
        field.addEventListener('change', () => {
            try {
                edits.setWalkSettings({ [key]: Number(field.value) });
            }
            catch (error) {
                feedback.setStatus(error instanceof Error ? error.message : String(error));
            }
            feedback.syncUI('walk-' + key);
        });
        feedback.uiSync['walk-' + key] = () => { field.value = String(model.walkSettings[key]); };
        feedback.syncUI('walk-' + key);
    }
    const bobLabel = el('label', { class: 'chk' }, sWalk), bob = el('input', { type: 'checkbox' }, bobLabel);
    el('span', { text: 'Покачивание камеры' }, bobLabel);
    bob.addEventListener('change', () => { edits.setWalkSettings({ bob: bob.checked }); feedback.syncUI('walk-bob'); });
    feedback.uiSync['walk-bob'] = () => { bob.checked = model.walkSettings.bob; };
    feedback.syncUI('walk-bob');
    // --- Погода
    const sWeather = section('Погода', true);
    sWeather.id = 'weatherSettings';
    {
        const row = el('div', { class: 'row' }, sWeather);
        el('label', { text: 'Погода' }, row);
        const sel = el('select', { id: 'weatherSel' }, row);
        for (const [id, w] of Object.entries(weather.WEATHERS))
            el('option', { value: id, text: w.name }, sel);
        sel.addEventListener('change', () => {
            history.transaction('Погода', () => { weather.setWeather(sel.value); feedback.setStatus('Погода: ' + weather.WEATHERS[model.state.weather].name); });
            feedback.syncUI('weather');
            sel.blur();
        });
        feedback.uiSync.weather = () => sel.value = model.state.weather;
        feedback.uiSync.weather();
        el('span', {}, row);
    }
    slider(sWeather, 'precipitation', 'Сила осадков', 0, 2, 0.05, null, v => `${Math.round(v * 100)}%`);
    slider(sWeather, 'fogIntensity', 'Сила тумана', 0, 2, 0.05, null, v => `${Math.round(v * 100)}%`);
    slider(sWeather,'lowFog','Туман в низинах',0,2,.05,null,v=>`${Math.round(v*100)}%`);
    const wetnessLabel=el('p',{class:'hint','aria-live':'off'},sWeather);feedback.uiSync.environmentStatus=()=>wetnessLabel.textContent=`Влажность поверхностей: ${Math.round(model.state.wetness*100)}%`;feedback.uiSync.environmentStatus();
    el('p',{class:'hint',text:'Ветер качает растения; 0 отключает движение. Земля, камни и постройки намокают под дождём и медленно сохнут после него. Туман в низинах учитывает форму рельефа и уровни озёр. Смена дня и ночи настраивается в «Небо и освещение».'},sWeather);
    el('p', { class: 'hint', text: 'Осадки регулируют дождь, грозовой дождь и снег. 0% отключает эффект, 100% — обычная сила. Туман выше 100% быстро уплотняется; при 200% видимость — около 3–4 м при любой погоде. Сила тумана применяется и к погоде, и к базовому туману.' }, sWeather);
    slider(sWeather, 'windDir', 'Направление ветра', 0, 360, 1, null, v => v.toFixed(0) + '°');
    slider(sWeather, 'windSpeed', 'Сила ветра', 0, 3, 0.05, null, v => v.toFixed(2));
    el('div', { class: 'hint', text: 'Смена погоды плавная (~3 с). Время суток — ползунок «Высота солнца» в разделе «Небо и освещение»: ниже ~10° появляются звёзды.' }, sWeather);
    const sExperimental = section('Эксперименты', false);
    sExperimental.id = 'experimentalSettings';
    const labName = location.protocol === 'file:' ? 'webgpu_lab_standalone.html' : 'webgpu_lab.html';
    const labUrl = new URL(labName, location.href).href;
    el('a', { class: 'btn experiment-link', href: labUrl, target: '_blank', rel: 'noopener', text: 'Лаборатория WebGPU ↗' }, sExperimental);
    el('a', { class: 'hint experiment-link', href: labUrl, text: 'Открыть в этой вкладке' }, sExperimental);
    el('p', { class: 'hint', text: 'Сравнение земли, растений и воды на WebGL и WebGPU в отдельной сцене.' }, sExperimental);
    return { setTool, refreshTools, onToolChange(listener: (tool: ToolId) => void) { toolListeners.add(listener); return () => toolListeners.delete(listener); } };
}
export type InterfaceSystem = ReturnType<typeof createInterface>;
