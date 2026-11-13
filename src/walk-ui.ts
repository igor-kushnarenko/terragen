import type { ControlsSystem } from './controls';
import type { WorldEdits } from './edits';
import type { EditorModel } from './state';
import type { Feedback } from './feedback';
import type { NatureAudio } from './nature-audio';
import { QUALITY_PROFILES } from './quality';
import type { WalkScenarios } from './walk-scenarios';
export function createWalkInterface(model: EditorModel, input: ControlsSystem, edits: WorldEdits, feedback: Feedback,audio:NatureAudio,scenarios:WalkScenarios) {
    function element<K extends keyof HTMLElementTagNameMap>(tag: K, parent: HTMLElement, text = '') {
        const item = document.createElement(tag); item.textContent = text; parent.append(item); return item;
    }
    const bar = element('nav', document.body); bar.id = 'walkControls'; bar.setAttribute('aria-label', 'Управление прогулкой'); bar.hidden = true;
    element('strong', bar, '🚶 Прогулка');
    function button(parent: HTMLElement, text: string, action: () => void) {
        const item = element('button', parent, text); item.className = 'btn'; item.type = 'button'; item.onclick = action; return item;
    }
    const flight = button(bar,'Полёт · G',input.toggleFlight);
    const automatic = button(bar, 'Автопрогулка · R', input.toggleAutoWalk);
    const soundButton=button(bar,'🔊 Звук',()=>{edits.setPreferences({soundEnabled:!model.state.soundEnabled});void audio.unlock();});
    function toggleLight(){if(!model.busy)edits.setWalkSettings({equippedLight:'flashlight',lightEnabled:!model.walkSettings.lightEnabled});}
    const lightButton=button(bar,'Свет · F',toggleLight);
    const panelButton = button(bar, 'Панель · E', input.toggleWalkPanel);
    const scenariosButton=button(bar,'Сценарии',()=>{input.setPaused(true);scenarioSection.open=true;scenarioSection.scrollIntoView({block:'nearest'});launchScenario.focus({preventScroll:true});});
    scenariosButton.setAttribute('aria-controls','walkScenarios');
    panelButton.setAttribute('aria-controls', 'panel');
    button(bar, 'Настройки · Esc', () => input.setPaused(true));
    button(bar, 'В редактор · P', () => input.setWalk(false));
    const hint = element('div', document.body); hint.id = 'walkHint'; hint.hidden = true;
    const scenarioHint=element('div',document.body);scenarioHint.id='walkScenarioHint';scenarioHint.hidden=true;
    const crosshair = element('div', document.body); crosshair.id = 'walkCrosshair'; crosshair.setAttribute('aria-hidden', 'true'); crosshair.hidden = true;
    input.bindWalkToolKeys(event=>{
        if(input.walkPanel.open||input.walk.paused)return false;
        if(event.code==='KeyF'){toggleLight();return true;}
        return false;
    });
    const picker = element('div', document.body); picker.id = 'pickStartHint'; picker.hidden = true;
    const pickText = element('span', picker); pickText.setAttribute('aria-live', 'polite');
    button(picker, 'Отменить выбор · Esc', input.cancelPick);
    const backdrop = element('div', document.body); backdrop.id = 'walkMenu'; backdrop.hidden = true;
    const menu = element('section', backdrop); menu.className = 'walk-menu-card'; menu.setAttribute('role', 'dialog'); menu.setAttribute('aria-modal', 'true'); menu.setAttribute('aria-labelledby', 'walkMenuTitle');
    element('h2', menu, 'Настройки прогулки').id = 'walkMenuTitle';
    element('p', menu, 'Прогулка приостановлена. Закройте меню, чтобы продолжить.').className = 'hint';
    const fields: [HTMLInputElement, keyof typeof model.walkSettings][] = [];
    for (const [key, label, min, max, step] of [
        ['sensitivity', 'Чувствительность мыши', 0.0001, 0.02, 0.0001], ['speed', 'Скорость ходьбы, м/с', 0.1, 30, 0.1], ['fov', 'Угол обзора, °', 45, 110, 1],
    ] as const) {
        const row = element('label', menu, label); row.className = 'walk-setting';
        const field = element('input', row); field.type = 'number'; field.min = String(min); field.max = String(max); field.step = String(step);
        field.setAttribute('aria-label', label); fields.push([field, key]);
        field.addEventListener('change', () => {
            try { edits.setWalkSettings({ [key]: Number(field.value) }); }
            catch (error) { feedback.setStatus(String(error instanceof Error ? error.message : error)); }
            field.value = String(model.walkSettings[key]);
        });
    }
    const bobLabel = element('label', menu); bobLabel.className = 'chk';
    const bob = element('input', bobLabel); bob.type = 'checkbox'; element('span', bobLabel, 'Покачивание камеры');
    bob.addEventListener('change', () => edits.setWalkSettings({ bob: bob.checked }));
    const reflectionsRow=element('label',menu);reflectionsRow.className='chk';
    const reflections=element('input',reflectionsRow);reflections.type='checkbox';element('span',reflectionsRow,'Отражения в воде (высокое качество)');
    reflections.onchange=()=>edits.setPreferences({waterReflections:reflections.checked});
    const qualityRow=element('label',menu,'Качество графики');qualityRow.className='walk-setting';const quality=element('select',qualityRow);quality.setAttribute('aria-label','Качество графики в прогулке');
    for(const [id,profile]of Object.entries(QUALITY_PROFILES)){const option=element('option',quality,profile.name);option.value=id;}
    quality.onchange=()=>edits.setPreferences({quality:quality.value as typeof model.state.quality});
    const soundRow=element('label',menu);soundRow.className='chk';const sound=element('input',soundRow);sound.type='checkbox';element('span',soundRow,'Природный звук');sound.onchange=()=>{edits.setPreferences({soundEnabled:sound.checked});void audio.unlock();};
    const audioFields:HTMLInputElement[]=[];
    for(const [key,label]of [['soundVolume','Общая громкость в прогулке'],['ambienceVolume','Громкость окружения'],['footstepVolume','Громкость шагов']] as const){
        const row=element('label',menu,label);row.className='walk-setting';const field=element('input',row);field.type='range';field.min='0';field.max='1';field.step='0.05';field.setAttribute('aria-label',label);field.dataset.preference=key;audioFields.push(field);field.onchange=()=>edits.setPreferences({[key]:Number(field.value)});
    }
    const audioState=element('p',menu,audio.status);audioState.className='hint';audioState.setAttribute('data-audio-status','');
    const scenarioSection=element('details',menu);scenarioSection.id='walkScenarios';scenarioSection.open=true;
    element('summary',scenarioSection,'Сценарии');
    const meteorCard=element('article',scenarioSection);meteorCard.className='scenario-card';
    element('h3',meteorCard,'☄ Падение метеорита');
    element('p',meteorCard,'Случайный размер и направление полёта, грохот, дымный след, разрушения и пожары. Размер кратера зависит от метеорита.').className='hint';
    const scenarioStatus=element('p',meteorCard);scenarioStatus.setAttribute('role','status');scenarioStatus.className='scenario-status';
    const scenarioButtons=element('div',meteorCard);scenarioButtons.className='btns';
    const launchScenario=button(scenarioButtons,'Запустить',()=>scenarios.launch());launchScenario.classList.add('primary');launchScenario.id='btnMeteor';
    const stopScenario=button(scenarioButtons,'Завершить сценарий',()=>scenarios.stop());stopScenario.id='btnStopScenario';
    element('p',meteorCard,'Меню и фоторежим приостанавливают сценарий. Кратер и повреждения сохраняются в мире; отмена — Ctrl+Z в редакторе.').className='hint';
    const armageddonCard=element('article',scenarioSection);armageddonCard.className='scenario-card';element('h3',armageddonCard,'☄☄ Армагеддон');
    element('p',armageddonCard,'Непрерывный метеоритный дождь со случайными паузами, направлениями и группами падений. Несколько метеоритов могут лететь одновременно. Диаметры — от 0,4 до 48 м; самые крупные встречаются редко.').className='hint';
    const armageddonStatus=element('p',armageddonCard);armageddonStatus.className='scenario-status';armageddonStatus.setAttribute('role','status');
    const armageddonButtons=element('div',armageddonCard);armageddonButtons.className='btns';const launchArmageddon=button(armageddonButtons,'Запустить Армагеддон',()=>scenarios.launchArmageddon());launchArmageddon.classList.add('primary');launchArmageddon.id='btnArmageddon';
    const stopArmageddon=button(armageddonButtons,'Остановить Армагеддон',()=>scenarios.stop());stopArmageddon.id='btnStopArmageddon';
    element('p',armageddonCard,'Работает до остановки. Меню и фоторежим ставят дождь на паузу; выход в редактор завершает его. Последствия каждого удара можно отменить.').className='hint';
    function syncScenarios(){scenarioStatus.textContent=armageddonStatus.textContent=scenarios.status;launchScenario.disabled=launchArmageddon.disabled=scenarios.active||model.busy;stopScenario.disabled=stopArmageddon.disabled=!scenarios.active;scenariosButton.setAttribute('aria-pressed',String(scenarios.active));scenarioHint.hidden=!scenarios.active||!input.walk.on||input.walk.paused;scenarioHint.textContent=scenarios.guidance;}
    scenarios.bindStatus(syncScenarios);feedback.uiSync.walkScenarios=syncScenarios;
    const buttons = element('div', menu); buttons.className = 'btns';
    const resume = button(buttons, 'Продолжить прогулку', () => input.setPaused(false));
    button(buttons, 'Выбрать другой старт', input.chooseStart);
    button(buttons, 'Вернуться в редактор', () => input.setWalk(false));
    const panel = document.getElementById('panel')!;
    panel.setAttribute('role', 'region'); panel.setAttribute('aria-label', 'Панель редактора');
    const panelHeader = document.createElement('div'); panelHeader.className = 'walk-panel-header'; panelHeader.hidden = true; panel.prepend(panelHeader);
    const closePanel = button(panelHeader, 'Продолжить прогулку · E', () => input.setWalkPanel(false));
    element('p', panelHeader, 'Персонаж стоит на месте. Изменения сразу видны в сцене. E или Esc — закрыть панель.').className = 'hint';
    let menuWasOpen = false;
    let panelWasOpen = false;
    input.bindPresentation(() => {
        const { walk, picking, walkPanel } = input;
        const panelOpen = walk.on && walkPanel.open;
        document.body.classList.toggle('walk-mode', walk.on); document.body.classList.toggle('picking-start', picking.on);
        document.body.classList.toggle('walk-panel-open', panelOpen);
        panel.hidden = walk.on && !panelOpen; panel.inert = panel.hidden; panelHeader.hidden = !panelOpen;
        panelButton.setAttribute('aria-expanded', String(panelOpen)); panelButton.textContent = panelOpen ? 'Скрыть панель · E' : 'Панель · E';
        bar.hidden = !walk.on; hint.hidden = !walk.on || panelOpen; crosshair.hidden = !walk.on || walk.paused;
        backdrop.hidden = !walk.on || !walk.paused || panelOpen; picker.hidden = !picking.on;
        const lightOn=model.walkSettings.lightEnabled;
        lightButton.textContent=lightOn?'Выключить фонарик · F':'Фонарик · F';lightButton.setAttribute('aria-pressed',String(lightOn));lightButton.disabled=model.busy;
        flight.setAttribute('aria-pressed',String(input.walk.flying));flight.textContent=input.walk.flying?'Гравитация · G':'Полёт · G';flight.disabled=walk.paused||model.busy;
        bar.querySelector('strong')!.textContent=walk.flying?'Полёт':'🚶 Прогулка';
        automatic.setAttribute('aria-pressed', String(walk.autoWalking)); automatic.textContent = walk.autoWalking ? 'Остановить · R' : 'Автопрогулка · R'; automatic.disabled = walk.paused || model.busy||walk.flying;
        hint.textContent = walk.flying?'WASD — полёт · Пробел — вверх · Shift — вниз · Ctrl — ускорение · G — гравитация · E — панель':walk.autoWalking ? 'Автопрогулка · мышь — обзор · R или WASD — остановить · E — панель · Esc — меню'
            : 'WASD — идти · Shift — бег · Пробел — прыжок · F — свет · E — панель · Esc — меню';
        const reason = picking.assessment?.reason ?? 'Кликните по местности: зелёный маркер — безопасный старт';
        if (pickText.textContent !== reason) pickText.textContent = reason;
        pickText.classList.toggle('unsafe', !!picking.assessment && !picking.assessment.safe);
        for (const [field, key] of fields) if (document.activeElement !== field) field.value = String(model.walkSettings[key]);
        bob.checked = model.walkSettings.bob;
        reflections.checked=model.state.quality==='high'&&model.state.waterReflections;reflections.disabled=model.state.quality!=='high';syncScenarios();
        soundButton.textContent=model.state.soundEnabled?'🔊 Звук':'🔇 Звук';soundButton.setAttribute('aria-pressed',String(model.state.soundEnabled));
        quality.value=model.state.quality;sound.checked=model.state.soundEnabled;for(const field of audioFields)if(document.activeElement!==field)field.value=String(model.state[field.dataset.preference as 'soundVolume']);
        const opened = !backdrop.hidden;
        if (opened && !menuWasOpen) resume.focus({ preventScroll: true });
        menuWasOpen = opened;
        if (panelOpen && !panelWasOpen) closePanel.focus({ preventScroll: true });
        panelWasOpen = panelOpen;
    });
    backdrop.addEventListener('keydown', event => {
        if (event.key !== 'Tab') return;
        const focusable = [...menu.querySelectorAll<HTMLElement>('button,input,select')].filter(item => !(item as HTMLInputElement).disabled);
        const first = focusable[0], last = focusable.at(-1)!;
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
}
