import type { EditorModel } from './state';
import type { HistorySystem } from './history';
import type { StorageSystem } from './storage';
import type { SavedWorld, WorldRepository, WorldSummary } from './world-library';
export interface AutosaveStatus { available: boolean; saving: boolean; name: string; id: string; message: string; }
interface Options {
    model: EditorModel; history: HistorySystem; storage: Pick<StorageSystem, 'projectJSON' | 'loadProjectText'>;
    repository: () => Promise<WorldRepository>; preview: () => string; viewKey: () => string;
    newWorld: () => Promise<boolean>; id?: () => string;
}
export function createAutosave(options: Options) {
    const { model, history, storage } = options;
    const uid = options.id ?? (() => crypto.randomUUID());
    let repository: WorldRepository | undefined, initialized = false, paused = false, switching = false, transition = false;
    let dirty = false, revision = 0, timer: ReturnType<typeof setTimeout> | undefined, periodic: ReturnType<typeof setInterval> | undefined;
    let writing: Promise<boolean> | undefined, lastView = '';
    const status: AutosaveStatus = { available: false, saving: false, id: uid(), name: 'Мир ' + model.state.seed, message: 'Открытие библиотеки…' };
    const listeners = new Set<() => void>();
    const notify = () => listeners.forEach(listener => listener());
    const report = (message: string) => { status.message = message; notify(); };
    const errorMessage = (error: unknown) => error instanceof DOMException && error.name === 'QuotaExceededError'
        ? 'Недостаточно места. Экспортируйте полный проект .terrain и освободите место в библиотеке.'
        : String(error instanceof Error ? error.message : error);
    function schedule(delay = 1500) { clearTimeout(timer); timer = setTimeout(() => { void saveNow().catch(error => report('Автосохранение: ' + errorMessage(error))); }, delay); }
    function markDirty() {
        if (!initialized || paused || switching) return;
        dirty = true; revision++;
        if (repository) { report('Есть несохранённые изменения'); schedule(); }
    }
    async function saveNow(force = false): Promise<boolean> {
        clearTimeout(timer);
        if (writing) { await writing; return saveNow(force); }
        if (!repository || !initialized || paused || switching) return false;
        if (model.busy || history.editing) { if (dirty || force) schedule(500); return false; }
        if (!dirty && !force) return true;
        const capturedRevision = revision;
        // Capture synchronously; edits made while IndexedDB is committing get a later save.
        const world: SavedWorld = { id: status.id, name: status.name, updatedAt: Date.now(), project: storage.projectJSON(), preview: options.preview(),assetKeys:assetKeys() };
        const capturedView = options.viewKey();
        status.saving = true; report('Сохранение…');
        writing = (async () => {
            try {
                await repository!.put(world,force);
                dirty = revision !== capturedRevision;
                lastView = capturedView;
                report(dirty ? 'Есть несохранённые изменения' : (force?'Сохранено в «Мои миры» ':'Сессия сохранена ') + new Date(world.updatedAt).toLocaleTimeString('ru-RU'));
                if (dirty) schedule();
                return true;
            } catch (error) { dirty = true; report('Автосохранение: ' + errorMessage(error)); throw error; }
            finally { status.saving = false; writing = undefined; notify(); }
        })();
        return writing;
    }
    async function initialize() {
        try { repository = await options.repository(); status.available = true; }
        catch (error) { initialized = true; report('Автосохранение недоступно: ' + errorMessage(error)); return false; }
        let restored = false,migrate=false;
        try {
            const world = await repository.last();
            if (world) {
                model.busy = false;
                migrate=await storage.loadProjectText(world.project);
                history.clear(); status.id = world.id; status.name = world.name; restored = true;
            }
            report(restored ? 'Последняя сессия восстановлена' : 'Автосохранение включено');
        } catch (error) {
            // Keep an invalid saved session intact until the user chooses another world.
            paused = true; report('Сессия не восстановлена: ' + errorMessage(error));
        }
        initialized = true; lastView = options.viewKey();
        periodic = setInterval(() => {
            if (!paused && options.viewKey() !== lastView && !dirty) markDirty();
            if (dirty && !writing) void saveNow().catch(() => {});
        }, 15000);
        // Lazy, recoverable migration: the old embedded record stays intact if the write fails.
        if(migrate&&restored){dirty=true;revision++;await saveNow().catch(()=>{});}
        return restored;
    }
    const unsubscribe = history.onChange(markDirty);
    const assetKeys=()=>[...new Set(model.world.assets.map(a=>a.blob))];
    async function switchWorld(change: () => Promise<void | boolean>) {
        if (transition || model.busy || history.editing) throw new Error('Дождитесь завершения текущей операции');
        if (!repository) throw new Error('Библиотека недоступна');
        transition = true;
        try {
            if (!paused) {
                dirty=true; revision++;
                if (!await saveNow()) throw new Error('Текущий мир ещё не сохранён');
                while (dirty) if (!await saveNow()) throw new Error('Текущий мир ещё не сохранён');
            }
            // A library write can fail after generation. Keep the previous scene and identity recoverable.
            const previous = { project: storage.projectJSON(), id: status.id, name: status.name, paused, updatedAt:Date.now(), preview:options.preview(),assetKeys:assetKeys() };
            const restoreHistory = history.checkpoint();
            switching = true; clearTimeout(timer);
            try {
                if (await change() !== false) history.clear();
                paused = false; dirty = false; lastView = options.viewKey();
            }
            catch (error) {
                await storage.loadProjectText(previous.project);
                restoreHistory();
                status.id = previous.id; status.name = previous.name; paused = previous.paused;
                try { if(!previous.paused)await repository.put(previous,false); } catch { /* Original error is more useful. */ }
                throw error;
            }
            finally { switching = false; notify(); }
        } finally { transition = false; }
    }
    return {
        initialize, markDirty, saveNow,
        get status() { return { ...status }; },
        onChange(listener: () => void) { listeners.add(listener); listener(); return () => listeners.delete(listener); },
        async list(): Promise<WorldSummary[]> { return repository ? repository.list() : []; },
        async open(id: string) {
            await switchWorld(async () => {
                const world = await repository!.get(id);
                if (!world) throw new Error('Мир не найден');
                await repository!.select(id); const migrated=await storage.loadProjectText(world.project);
                if(migrated)await repository!.put({...world,project:storage.projectJSON(),assetKeys:assetKeys()},false);
                status.id = id; status.name = world.name; report('Мир открыт');
            });
        },
        async saveCopy(name: string) {
            await switchWorld(async () => {
                const world = { id: uid(), name: name.trim().slice(0, 128) || 'Копия мира', updatedAt: Date.now(), project: storage.projectJSON(), preview: options.preview(),assetKeys:assetKeys() };
                await repository!.put(world,false); status.id = world.id; status.name = world.name; report('Копия готова. Нажмите «Сохранить сейчас», чтобы добавить её в список');
            });
        },
        async newWorld() {
            await switchWorld(async () => {
                if (!await options.newWorld()) return false;
                const world = { id: uid(), name: 'Мир ' + model.state.seed, updatedAt: Date.now(), project: storage.projectJSON(), preview: options.preview(),assetKeys:assetKeys() };
                await repository!.put(world,false); status.id = world.id; status.name = world.name; report('Новый мир создан. В список он попадёт после «Сохранить сейчас»');
            });
        },
        rename(name: string) { if (name.trim() && !switching) { status.name = name.trim().slice(0, 128); markDirty(); } },
        async remove(id: string) {
            if (id === status.id) throw new Error('Сначала откройте другой мир');
            await repository?.remove(id); notify();
        },
        dispose() { unsubscribe(); clearTimeout(timer); clearInterval(periodic); repository?.close(); },
    };
}
export type AutosaveSystem = ReturnType<typeof createAutosave>;
