import type {EditorModel, ToolId} from './state';
import type {Feedback} from './feedback';
import type {InterfaceSystem} from './ui';
import type {ControlsSystem} from './controls';
import type {RenderingSystem} from './rendering';
import type {AutosaveSystem} from './autosave';
import './workspace.css';

const paths = {
    mountain: '<path d="m2 19 7-13 4 7 3-5 6 11H2Z"/><path d="m6.8 10.2 2.2 2.3 2.1-2.2M14.3 10.8l1.7 2.1 1.8-2"/>',
    world: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z"/>',
    landscape: '<path d="m2 19 7-13 4 7 3-5 6 11H2Z"/><path d="m6 12 3 2 2-2"/>',
    environment: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
    objects: '<path d="m12 3 9 5v9l-9 5-9-5V8l9-5Z"/><path d="m3 8 9 5 9-5m-9 5v9M7.5 5.5l9 5"/>',
    settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
    camera: '<path d="m5 3 15 9-7 2-3 7L5 3Z"/>',
    raise: '<path d="m3 19 6-10 4 5 3-4 5 9H3ZM12 2v6m-3-3 3-3 3 3"/>',
    lower: '<path d="m3 19 6-6 4 3 3-4 5 7H3ZM12 2v7m-3-3 3 3 3-3"/>',
    smooth: '<path d="M3 15c3-10 6 10 9 0s6 10 9 0M3 7h18"/>',
    flatten: '<path d="M3 16h18M8 5l4 5 4-5m-4 5V2M5 21h14"/>',
    noise: '<path d="m2 17 3-6 3 3 4-9 4 11 3-6 3 7M3 21h18"/>',
    paint: '<path d="m14 3 7 7-9 9-7-7 9-9ZM5 12l7 7M3 17s-2 3 0 4 4-2 4-2"/>',
    undo: '<path d="m9 4-6 6 6 6M3 10h10a7 7 0 0 1 7 7v3"/>',
    redo: '<path d="m15 4 6 6-6 6m6-6h-10a7 7 0 0 0-7 7v3"/>',
    photo: '<rect x="3" y="6" width="18" height="15" rx="3"/><path d="m8 6 2-3h4l2 3"/><circle cx="12" cy="13" r="4"/>',
    walk: '<circle cx="14" cy="4" r="2"/><path d="m7 21 3-7 4 3v4M6 12l3-4 4 1 3 4h4m-7-4-3 5"/>',
    export: '<path d="M12 16V3m-4 4 4-4 4 4M4 14v6h16v-6"/>',
    save: '<path d="M4 3h13l4 4v14H3V3h1Zm3 0v6h9V3M7 21v-8h10v8"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>',
    focus: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/><circle cx="12" cy="12" r="3"/>',
    chevron: '<path d="m8 10 4 4 4-4"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4m0 3h.01"/>',
} as const;
type Icon = keyof typeof paths;
function icon(name: Icon) { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`; }

type WorkspaceId = 'world' | 'landscape' | 'environment' | 'objects' | 'settings';
const workspaces: {id: WorkspaceId; name: string; description: string; sections: [string, string][]}[] = [
    {id:'world', name:'Мир', description:'Начните с места, которое хочется исследовать.', sections:[['worldStudio','Создать или открыть мир']]},
    {id:'landscape', name:'Ландшафт', description:'Придайте своему миру характер.', sections:[['brushSettings','Скульптинг и текстуры'],['waterBodySettings','Озёра и реки'],['trailSettings','Тропы и маршруты'],['terrainSettings','Генерация рельефа'],['erosionSettings','Эрозия'],['biomeSettings','Локальные биомы'],['compositionSettings','Композиция и пресеты']]},
    {id:'environment', name:'Окружение', description:'Свет, погода и настроение вашего мира.', sections:[['weatherSettings','Погода и ветер'],['skySettings','Небо и освещение'],['oceanSettings','Океан и волны'],['materialSettings','Поверхность земли'],['soundSettings','Звуки природы']]},
    {id:'objects', name:'Объекты', description:'Наполните ландшафт жизнью и деталями.', sections:[['modelSettings','Библиотека моделей'],['objectSettings','Выбор и трансформация'],['vegetationSettings','Растительность'],['jungleSettings','Тропические джунгли'],['quickObjects','Быстрое добавление']]},
    {id:'settings', name:'Настройки', description:'Настройте редактор под себя.', sections:[['graphicsSettings','Качество графики'],['cameraSettings','Камера и прогулка'],['walkSettings','Управление персонажем'],['seedSettings','Сиды операций'],['experimentalSettings','Эксперименты']]},
];

/** Compose the existing controls into a single workspace; their listeners and history stay intact. */
export function createWorkspace(model: EditorModel, feedback: Feedback, ui: InterfaceSystem, input: ControlsSystem, render: RenderingSystem, autosave: AutosaveSystem) {
    const panel = document.getElementById('panel')!;
    const el = <K extends keyof HTMLElementTagNameMap>(tag: K, parent: HTMLElement, className = '', text = '') => {
        const element = document.createElement(tag); element.className = className; element.textContent = text; parent.append(element); return element;
    };
    function button(parent: HTMLElement, name: string, glyph: Icon, action: () => unknown, className = '') {
        const b = el('button', parent, 'workspace-button ' + className); b.type = 'button'; b.innerHTML = icon(glyph);
        el('span', b, '', name); b.setAttribute('aria-label', name); b.title = name;
        b.onclick = () => { input.clearKeys(); try { Promise.resolve(action()).catch(error => feedback.setStatus(String(error instanceof Error ? error.message : error))); } catch(error) { feedback.setStatus(String(error)); } };
        return b;
    }
    document.body.classList.add('editor-workspace');
    panel.querySelector('h1')?.remove();
    const header = el('header', document.body, 'app-header'); header.id = 'appHeader';
    const brand = el('a', header, 'app-brand'); brand.href = '#'; brand.setAttribute('aria-label', 'GenTerrain — миры'); brand.innerHTML = icon('mountain');
    el('strong', brand, '', 'GenTerrain'); brand.onclick = e => { e.preventDefault(); navigate('world'); };
    const identity = el('div', header, 'project-identity');
    const name = document.querySelector<HTMLInputElement>('#worldLibrary input[aria-label="Название мира"]')!;
    identity.append(name); name.title = 'Название проекта — нажмите, чтобы изменить';
    const saveStatus = document.getElementById('autosaveStatus')!; identity.append(saveStatus);
    const nav = el('nav', header, 'workspace-nav'); nav.setAttribute('aria-label','Рабочие пространства'); nav.setAttribute('role','tablist');
    const tabs = new Map<WorkspaceId, HTMLButtonElement>();
    for (const w of workspaces.filter(w => w.id !== 'settings')) {
        const b = button(nav, w.name, w.id, () => navigate(w.id)); b.id = 'workspace-tab-' + w.id;
        b.setAttribute('role','tab'); b.setAttribute('aria-controls','workspace-' + w.id); tabs.set(w.id, b);
    }
    const actions = el('div', header, 'header-actions');
    const searchButton = button(actions, 'Найти инструмент', 'search', () => openCommands(), 'icon-button'); searchButton.title += ' · Ctrl+K';
    const save = button(actions, 'Сохранить', 'save', () => autosave.saveNow(true), 'icon-button'); save.title += ' · Ctrl+S';
    const photo = document.getElementById('photoBtn')!; photo.className = 'workspace-button icon-button'; photo.innerHTML = icon('photo'); photo.setAttribute('aria-label','Фоторежим'); photo.title = 'Фоторежим · F8'; actions.append(photo);
    button(actions, 'Прогулка', 'walk', () => input.setWalk(true), 'walk-entry').title = 'Исследовать мир · P';
    const fileDialog = el('dialog', document.body, 'workspace-dialog export-dialog'); fileDialog.id = 'exportDialog';
    const fileHeading = el('div', fileDialog, 'dialog-heading'); el('h2', fileHeading, '', 'Файлы и экспорт').id = 'exportTitle'; fileDialog.setAttribute('aria-labelledby','exportTitle');
    button(fileHeading, 'Закрыть', 'close', () => fileDialog.close(), 'icon-button');
    el('p', fileDialog, 'dialog-description', 'Продолжите работу на другом устройстве или перенесите ландшафт в свой проект.');
    const fileSection = document.getElementById('fileSettings') as HTMLDetailsElement;
    fileSection.open = true; fileSection.classList.add('inspector-section'); fileDialog.append(fileSection);
    button(actions, 'Экспорт', 'export', () => fileDialog.showModal(), 'export-entry');
    const settings = button(actions, 'Настройки', 'settings', () => navigate('settings'), 'icon-button'); settings.setAttribute('aria-controls','workspace-settings');
    const help = document.getElementById('helpBtn')!; help.className = 'workspace-button icon-button'; help.innerHTML = icon('help'); help.setAttribute('aria-label','Справка'); actions.append(help);

    const inspectorHeader = el('div', panel, 'inspector-heading');
    const headingText = el('div', inspectorHeader); const eyebrow = el('span', headingText, 'eyebrow', 'РАБОЧЕЕ ПРОСТРАНСТВО');
    const title = el('h1', headingText); title.id = 'inspectorTitle';
    button(inspectorHeader, 'Свернуть панель', 'panel', () => input.walk.on ? input.setWalkPanel(false) : togglePanel(), 'icon-button');
    const description = el('p', panel, 'inspector-description');
    const walkWorkspace = el('select',panel,'walk-workspace-select'); walkWorkspace.setAttribute('aria-label','Рабочее пространство в прогулке');
    for (const w of workspaces) { const option = el('option',walkWorkspace,'',w.name); option.value = w.id; }
    walkWorkspace.onchange = () => navigate(walkWorkspace.value as WorkspaceId);
    const selectWrap = el('div', panel, 'inspector-select');
    const selector = el('select', selectWrap); selector.setAttribute('aria-label','Инструмент раздела');
    const content = el('div', panel, 'inspector-content');
    const pages = new Map<WorkspaceId, HTMLElement>();
    const remembered = new Map<WorkspaceId, string>();
    for (const w of workspaces) {
        const page = el('section', content, 'workspace-page'); page.id = 'workspace-' + w.id;
        page.setAttribute('role','tabpanel'); page.setAttribute('aria-label',w.name); if (tabs.has(w.id)) page.setAttribute('aria-labelledby','workspace-tab-' + w.id);
        pages.set(w.id, page); remembered.set(w.id, w.sections[0][0]);
        for (const [id] of w.sections) {
            const section = document.getElementById(id) as HTMLDetailsElement | null;
            if (!section) continue;
            section.classList.add('inspector-section'); section.open = true; page.append(section);
        }
    }
    const worldActions = panel.querySelector<HTMLElement>('.world-create-actions')!;
    worldActions.classList.add('world-sticky-actions'); panel.append(worldActions);
    const panelFoot = el('div', panel, 'inspector-footer');
    el('span', panelFoot, 'live-dot'); el('span', panelFoot, '', 'Автосохранение проекта');
    button(panelFoot, 'Найти инструмент', 'search', () => openCommands(), 'icon-button');

    const viewportBar = el('div', document.body, 'viewport-bar'); viewportBar.id = 'viewportBar';
    const viewLabel = el('div', viewportBar, 'viewport-label'); el('span', viewLabel, 'live-dot'); el('span', viewLabel, '', 'ПЕРСПЕКТИВА');
    const worldInfo = el('span', viewLabel, 'viewport-world-info');
    const viewActions = el('div', viewportBar, 'viewport-actions');
    button(viewActions, 'Общий вид', 'focus', input.resetCamera, 'viewport-action');
    const panelToggle = button(viewActions, 'Параметры', 'panel', () => togglePanel(), 'viewport-action'); panelToggle.setAttribute('aria-controls','panel');
    const toolDock = el('nav', document.body, 'tool-dock'); toolDock.id = 'toolDock'; toolDock.setAttribute('aria-label','Инструменты ландшафта');
    for (const tool of panel.querySelectorAll<HTMLButtonElement>('[data-tool]')) {
        const id = tool.dataset.tool as ToolId, label = tool.getAttribute('aria-label')!;
        tool.className = 'workspace-button tool-button'; tool.innerHTML = icon(id); el('span', tool, '', label); toolDock.append(tool);
    }
    const undoDock = el('div', toolDock, 'dock-history');
    for (const [id, label, glyph] of [['btnUndo','Отменить','undo'],['btnRedo','Повторить','redo']] as const) {
        const b = document.getElementById(id)!; b.className = 'workspace-button icon-button'; b.innerHTML = icon(glyph); b.setAttribute('aria-label',label); undoDock.append(b);
    }
    const brushSection = document.getElementById('brushSettings')!;
    const brushIntro = el('div',brushSection,'brush-intro'); brushSection.prepend(brushIntro);
    const brushGlyph = el('span',brushIntro,'brush-intro-icon');
    const brushText = el('div',brushIntro); const brushName = el('strong',brushText); const brushDescription = el('p',brushText);
    const brushDescriptions: Record<ToolId,string> = {
        camera:'Выберите кисть на панели слева или нажмите 2–7. Перетаскивайте ЛКМ по рельефу, чтобы рисовать.',
        raise:'Поднимайте землю плавными мазками. Радиус определяет размер кисти, сила — скорость изменения.',
        lower:'Создавайте долины и впадины. Удерживайте ЛКМ и ведите кисть по ландшафту.',
        smooth:'Смягчайте резкие переходы и соединяйте формы. Мягкий край делает мазок плавнее.',
        flatten:'Создавайте ровные площадки. Высота берётся из точки, в которой начат мазок.',
        noise:'Добавляйте мелкие неровности и естественные детали. Уменьшите силу для деликатной обработки.',
        paint:'Наносите материал выбранного слоя. Ластик возвращает автоматическую окраску поверхности.',
    };
    function syncBrush(tool:ToolId) {
        brushGlyph.innerHTML = icon(tool); brushName.textContent = document.querySelector(`[data-tool="${tool}"]`)!.getAttribute('aria-label'); brushDescription.textContent = brushDescriptions[tool];
        for (const row of brushSection.querySelectorAll<HTMLElement>('.row')) row.hidden = tool === 'camera';
    }
    for (const section of panel.querySelectorAll<HTMLElement>('.inspector-section:not(#worldStudio)')) {
        const hints = [...section.querySelectorAll<HTMLElement>(':scope > .hint')].filter(h => (h.textContent?.length ?? 0) > 130);
        if (!hints.length) continue;
        const guide = el('details',section,'context-guide'); el('summary',guide,'','Как это работает'); for (const hint of hints) guide.append(hint);
    }
    const navigationHint = el('div', document.body, 'navigation-hint'); navigationHint.id = 'navigationHint';
    navigationHint.innerHTML = '<span><kbd>ПКМ</kbd> вращение</span><span><kbd>СКМ</kbd> перемещение</span><span><kbd>Колесо</kbd> масштаб</span>';
    const toolHint = el('span', navigationHint, 'active-tool-hint');
    const footer = el('footer', document.body, 'app-footer'); footer.id = 'appFooter';
    el('span', footer, 'live-dot'); const status = document.getElementById('status')!; status.setAttribute('role','status'); footer.append(status);
    const metrics = el('div', footer, 'footer-metrics'); const mapSize = el('span', metrics);
    const diagnostic = el('details', metrics, 'diagnostics'); const diagnosticSummary = el('summary', diagnostic);
    diagnosticSummary.title = 'Производительность сцены'; diagnosticSummary.append(document.getElementById('fps')!); el('span', diagnosticSummary, '', 'FPS');
    const hud = document.getElementById('hud')!; diagnostic.append(hud);
    const coord = document.getElementById('coord')!; const coords = el('span', metrics, 'footer-coordinates'); coords.append(coord);
    const counters = ['frameTime','objects','calls','tris','chunks'].map(id => document.getElementById(id)!);
    hud.replaceChildren();
    for (const [i,label] of ['Кадр, мс','Объекты','Вызовы отрисовки','Треугольники','Чанки'].entries()) {
        const row = el('div',hud,'diagnostic-row'); el('span',row,'',label); row.append(counters[i]);
    }

    const commands = el('dialog', document.body, 'workspace-dialog command-dialog'); commands.id = 'commandDialog'; commands.setAttribute('aria-label','Поиск инструментов');
    const commandHead = el('div', commands, 'command-search'); commandHead.innerHTML = icon('search');
    const search = el('input', commandHead); search.type = 'search'; search.placeholder = 'Что хотите сделать?'; search.setAttribute('aria-label','Поиск инструментов');
    button(commandHead, 'Закрыть поиск', 'close', () => commands.close(), 'icon-button');
    const results = el('div', commands, 'command-results'); results.setAttribute('aria-label','Результаты поиска');
    el('p', commands, 'command-footer', '↑ ↓ выбор · Enter открыть · Esc закрыть');
    const commandItems = workspaces.flatMap(w => w.sections.map(([id, label]) => ({label, group:w.name, glyph:w.id as Icon, action:() => navigate(w.id,id)})));
    commandItems.push(
        {label:'Файлы, импорт и экспорт', group:'Проект', glyph:'export', action:() => fileDialog.showModal()},
        {label:'Начать прогулку', group:'Исследовать', glyph:'walk', action:() => input.setWalk(true)},
        {label:'Фоторежим', group:'Исследовать', glyph:'photo', action:() => photo.click()},
        {label:'Сохранить проект', group:'Проект', glyph:'save', action:() => { save.click(); }},
        {label:'Справка и горячие клавиши', group:'Помощь', glyph:'help', action:() => help.click()},
    );
    let commandIndex = 0;
    function filterCommands() {
        results.replaceChildren(); commandIndex = 0;
        const query = search.value.trim().toLocaleLowerCase('ru');
        for (const item of commandItems.filter(i => (i.label + ' ' + i.group).toLocaleLowerCase('ru').includes(query))) {
            const b = button(results, item.label, item.glyph, () => { commands.close(); item.action(); }, 'command-result'); el('small',b,'',item.group);
        }
        if (!results.childElementCount) el('p',results,'empty-search','Ничего не найдено. Попробуйте другое слово.');
        results.querySelector('button')?.classList.add('selected');
    }
    function openCommands() { input.clearKeys(); search.value = ''; filterCommands(); commands.showModal(); search.focus(); }
    search.addEventListener('input',filterCommands);
    commands.addEventListener('keydown', e => {
        const buttons = [...results.querySelectorAll<HTMLButtonElement>('button')];
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault(); if (!buttons.length) return;
            commandIndex = (commandIndex + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
            buttons.forEach((b,i) => b.classList.toggle('selected',i === commandIndex)); buttons[commandIndex].scrollIntoView({block:'nearest'});
        } else if (e.key === 'Enter' && e.target === search) { e.preventDefault(); buttons[commandIndex]?.click(); }
    });
    for (const dialog of [fileDialog,commands]) dialog.addEventListener('click', e => { if (e.target === dialog) { const r = dialog.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close(); } });

    let active: WorkspaceId = 'world';
    const syncWorldActions = () => { worldActions.hidden = active !== 'world' || document.getElementById('world-page-new')!.hidden; };
    new MutationObserver(syncWorldActions).observe(document.getElementById('world-page-new')!,{attributes:true,attributeFilter:['hidden']});
    function togglePanel(force?: boolean) {
        document.body.classList.toggle('inspector-collapsed', force === undefined ? !document.body.classList.contains('inspector-collapsed') : !force);
        panelToggle.setAttribute('aria-expanded',String(!document.body.classList.contains('inspector-collapsed')));
    }
    function navigate(id: WorkspaceId, sectionId?: string, cancelTool = true) {
        const w = workspaces.find(w => w.id === id)!;
        if (cancelTool && (active !== id || sectionId && sectionId !== remembered.get(id))) ui.setTool('camera');
        active = id; if (sectionId) remembered.set(id,sectionId);
        walkWorkspace.value = id;
        document.body.dataset.workspace = id; syncWorldActions();
        for (const [key,page] of pages) page.hidden = key !== id;
        for (const [key,tab] of tabs) { tab.setAttribute('aria-selected',String(key === id)); tab.tabIndex = key === id || id === 'settings' && key === 'world' ? 0 : -1; }
        settings.setAttribute('aria-pressed',String(id === 'settings')); title.textContent = w.name; description.textContent = w.description;
        eyebrow.textContent = id === 'settings' ? 'ПРЕДПОЧТЕНИЯ' : 'РАБОЧЕЕ ПРОСТРАНСТВО';
        selector.replaceChildren();
        for (const [value,label] of w.sections) { const option = el('option',selector,'',label); option.value = value; }
        selector.value = remembered.get(id)!; selectWrap.hidden = w.sections.length === 1;
        for (const [key] of w.sections) { const section = document.getElementById(key); if (section) section.hidden = key !== selector.value; }
        content.scrollTop = 0; togglePanel(true); input.clearKeys();
    }
    selector.onchange = () => navigate(active,selector.value);
    nav.addEventListener('keydown',e => {
        if (!['ArrowLeft','ArrowRight','Home','End'].includes(e.key)) return;
        e.preventDefault(); const ids = [...tabs.keys()], focused = ids.find(id => tabs.get(id) === e.target), index = ids.indexOf(focused ?? active);
        const next = e.key === 'Home' ? 0 : e.key === 'End' ? ids.length-1 : (index + (e.key === 'ArrowRight' ? 1 : -1) + ids.length) % ids.length;
        navigate(ids[next]); tabs.get(ids[next])!.focus();
    });
    panel.addEventListener('workspace-reveal',e => {
        const section = (e.target as HTMLElement).closest('.inspector-section');
        const w = workspaces.find(w => w.sections.some(([id]) => id === section?.id)); if (w && section) navigate(w.id,section.id,false);
    });
    ui.onToolChange(tool => {
        syncBrush(tool);
        if (tool !== 'camera') navigate('landscape','brushSettings',false);
        toolHint.textContent = tool === 'camera' ? 'Камера' : `${document.querySelector(`[data-tool="${tool}"]`)?.getAttribute('aria-label')} · ЛКМ рисовать · [ ] радиус`;
    });
    window.addEventListener('keydown',e => {
        if ((e.ctrlKey || e.metaKey) && e.code === 'KeyK' && !input.walk.on && !document.body.classList.contains('photo-mode')) { e.preventDefault(); e.stopImmediatePropagation(); if (commands.open) commands.close(); else openCommands(); }
        if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS') { e.preventDefault(); save.click(); }
    },{capture:true});
    document.addEventListener('focusin',e => { if ((e.target as HTMLElement).closest('input, select, dialog')) input.clearKeys(); });
    function syncWorkspace() { worldInfo.textContent = `${model.state.N} × ${model.state.N}`; mapSize.textContent = `${Math.round(model.state.areaSize * 1024)} × ${Math.round(model.state.areaSize * 1024)} м`; save.disabled = !autosave.status.available || autosave.status.saving || model.busy; }
    feedback.uiSync.workspace = syncWorkspace;
    autosave.onChange(() => { syncWorkspace(); identity.classList.toggle('saving',autosave.status.saving); identity.classList.toggle('unsaved',autosave.status.message === 'Есть несохранённые изменения'); });
    const modeObserver = new MutationObserver(() => {
        if (input.walk.on || document.body.classList.contains('photo-mode')) { commands.close(); fileDialog.close(); }
        if (input.walk.on && status.parentElement !== document.body) document.body.append(status);
        else if (!input.walk.on && status.parentElement !== footer) footer.insertBefore(status,metrics);
    });
    modeObserver.observe(document.body,{attributes:true,attributeFilter:['class']});
    const helpBox = document.querySelector<HTMLElement>('#help .box')!; helpBox.setAttribute('role','dialog'); helpBox.setAttribute('aria-modal','true'); helpBox.setAttribute('aria-label','Управление редактором');
    navigate('world'); ui.setTool('camera'); syncWorkspace(); render.resizeViewport(); feedback.updateUndoButtons();
    return {navigate,togglePanel};
}
