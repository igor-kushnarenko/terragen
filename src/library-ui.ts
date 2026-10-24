import type { AutosaveSystem } from './autosave';
import type { Feedback } from './feedback';
import type { EditorModel } from './state';
export function createLibraryInterface(autosave: AutosaveSystem, model: EditorModel, feedback: Feedback,onNewWorld:()=>unknown=autosave.newWorld) {
    const section = document.createElement('details'); section.id = 'worldLibrary'; section.open = true;
    const summary = document.createElement('summary'); summary.textContent = 'Библиотека миров'; section.append(summary);
    const name = document.createElement('input'); name.type = 'text'; name.maxLength = 128; name.setAttribute('aria-label', 'Название мира'); section.append(name);
    const status = document.createElement('div'); status.className = 'hint'; status.id = 'autosaveStatus'; status.setAttribute('aria-live', 'polite'); section.append(status);
    const buttons = document.createElement('div'); buttons.className = 'btns'; section.append(buttons);
    const list = document.createElement('div'); list.className = 'world-list'; section.append(list);
    const libraryButtons: HTMLButtonElement[] = [];
    let working = false, refreshing = 0;
    function button(parent: HTMLElement, label: string, action: () => unknown | Promise<unknown>) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'btn'; button.textContent = label;
        button.addEventListener('click', async () => {
            if (working || model.busy) return;
            working = true; synchronize();
            try { await action(); await refresh(); }
            catch (error) { feedback.setStatus('Библиотека: ' + String(error instanceof Error ? error.message : error)); }
            finally { working = false; synchronize(); }
        });
        parent.append(button); libraryButtons.push(button); return button;
    }
    button(buttons, 'Сохранить сейчас', () => autosave.saveNow(true));
    button(buttons, 'Сохранить копию', () => autosave.saveCopy((name.value || autosave.status.name) + ' — копия'));
    button(buttons, 'Новый мир', onNewWorld);
    button(buttons, 'Обновить список', refresh);
    name.addEventListener('input', () => autosave.rename(name.value));
    function synchronize() {
        const current = autosave.status;
        if (document.activeElement !== name) name.value = current.name;
        status.textContent = current.message;
        name.disabled = !current.available || working || model.busy;
        for (const button of libraryButtons) button.disabled = !current.available || working || model.busy || button.dataset.worldId === current.id;
    }
    async function refresh() {
        const ticket = ++refreshing, worlds = await autosave.list();
        if (ticket !== refreshing) return;
        // Keep only the four permanent controls in this collection.
        libraryButtons.splice(4); list.replaceChildren();
        if (!worlds.length) { const hint = document.createElement('div'); hint.className = 'hint'; hint.textContent = 'Сохранённые миры появятся здесь.'; list.append(hint); }
        for (const world of worlds) {
            const card = document.createElement('article'); card.className = 'world-card';
            const image = document.createElement('img'); image.alt = 'Карта мира «' + world.name + '»'; image.width = 240; image.height = 160;
            if (/^data:image\/png;base64,/.test(world.preview)) image.src = world.preview;
            const title = document.createElement('strong'); title.textContent = world.name;
            const date = document.createElement('div'); date.className = 'hint'; date.textContent = new Date(world.updatedAt).toLocaleString('ru-RU');
            card.append(image, title, date); list.append(card);
            const controls = document.createElement('div'); controls.className = 'btns'; card.append(controls);
            const open = button(controls, 'Открыть', () => autosave.open(world.id)); open.dataset.worldId = world.id;
            const remove = button(controls, 'Удалить', () => autosave.remove(world.id)); remove.dataset.worldId = world.id;
        }
        synchronize();
    }
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    autosave.onChange(() => {
        synchronize();
        if (autosave.status.saving || autosave.status.message === 'Есть несохранённые изменения') return;
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => { void refresh().catch(error => feedback.setStatus('Библиотека: ' + String(error))); }, 100);
    });
    feedback.uiSync.library = synchronize;
    const panel = document.getElementById('panel')!;
    panel.insertBefore(section, panel.querySelector('details'));
}
