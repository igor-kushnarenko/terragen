import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAutosave } from '../src/autosave';
import type { SavedWorld, WorldRepository } from '../src/world-library';
import { decodeProject } from '../src/project';
import { editorFixture } from './fixture';
import {createMemoryAssetRepository} from '../src/asset-vault';

function memoryRepository() {
    const worlds = new Map<string, SavedWorld>(); let last: string | undefined;
    const repository: WorldRepository = {
        ...createMemoryAssetRepository(),
        async list() { return [...worlds.values()].map(({ project: _project, ...summary }) => structuredClone(summary)); },
        async get(id) { return structuredClone(worlds.get(id)); }, async last() { return structuredClone(worlds.get(last!)); },
        async put(world) { worlds.set(world.id, structuredClone(world)); last = world.id; },
        async select(id) { if (!worlds.has(id)) throw new Error('Missing world'); last = id; },
        async remove(id) { worlds.delete(id); if (last === id) last = undefined; }, close() {},
    };
    return { repository, worlds };
}
function setup(repository: WorldRepository) {
    const fixture = editorFixture(); let next = 0;
    const autosave = createAutosave({ ...fixture, repository: async () => repository, preview: () => 'data:image/png;base64,preview',
        viewKey: () => JSON.stringify(fixture.render.camera.position.toArray()), id: () => 'world-' + next++,
        newWorld: async () => { fixture.history.transaction('Новый мир', () => { fixture.model.heights.fill(12); }); return true; },
    });
    return { ...fixture, autosave };
}

test('autosave persists committed edits, preview and camera and restores the last session', async t => {
    const { repository, worlds } = memoryRepository(), first = setup(repository); t.after(() => first.autosave.dispose());
    assert.equal(await first.autosave.initialize(), false);
    first.edits.addObject('pine', 2, 3); first.render.camera.position.set(1, 2, 3);
    await first.autosave.saveNow();
    const world = worlds.get(first.autosave.status.id)!;
    assert.equal(decodeProject(world.project).world.objects.length, 1); assert.ok(world.preview);
    const restored = setup(repository); t.after(() => restored.autosave.dispose());
    assert.equal(await restored.autosave.initialize(), true);
    assert.deepEqual(restored.model.heights, first.model.heights); assert.deepEqual(restored.model.world, first.model.world);
    assert.deepEqual(restored.render.camera.position.toArray(), [1, 2, 3]); assert.equal(restored.history.undoDepth, 0);
});

test('unfinished transactions and busy operations are never autosaved', async t => {
    const { repository, worlds } = memoryRepository(), fixture = setup(repository); t.after(() => fixture.autosave.dispose());
    await fixture.autosave.initialize(); const edit = fixture.history.begin('Мазок')!;
    fixture.model.heights[0] += 10;
    assert.equal(await fixture.autosave.saveNow(true), false); assert.equal(worlds.size, 0);
    edit.commit(); fixture.model.busy = true;
    assert.equal(await fixture.autosave.saveNow(), false); assert.equal(worlds.size, 0);
    fixture.model.busy = false; assert.equal(await fixture.autosave.saveNow(), true); assert.equal(worlds.size, 1);
});

test('edits made during a pending database write are saved in order', async t => {
    const { repository, worlds } = memoryRepository(), fixture = setup(repository); t.after(() => fixture.autosave.dispose());
    await fixture.autosave.initialize();
    const original = repository.put; let release!: () => void;
    repository.put = async world => { await new Promise<void>(resolve => { release = resolve; }); await original(world); };
    fixture.edits.addObject('pine', 1, 2); const saving = fixture.autosave.saveNow();
    fixture.edits.addObject('rock', 3, 4); release(); await saving;
    assert.match(fixture.autosave.status.message, /несохранённые/);
    repository.put = original; await fixture.autosave.saveNow();
    assert.equal(decodeProject(worlds.get(fixture.autosave.status.id)!.project).world.objects.length, 2);
});

test('quota errors keep the previous save and later retry captures current edits', async t => {
    const { repository, worlds } = memoryRepository(), fixture = setup(repository); t.after(() => fixture.autosave.dispose());
    await fixture.autosave.initialize(); await fixture.autosave.saveNow(true);
    const before = structuredClone(worlds.get(fixture.autosave.status.id));
    const original = repository.put; repository.put = async () => { throw new DOMException('quota', 'QuotaExceededError'); };
    fixture.edits.addObject('rock', 3, 4);
    await assert.rejects(fixture.autosave.saveNow(), /quota/); assert.deepEqual(worlds.get(fixture.autosave.status.id), before);
    assert.match(fixture.autosave.status.message, /Недостаточно места/);
    repository.put = original; await fixture.autosave.saveNow(); assert.equal(decodeProject(worlds.get(fixture.autosave.status.id)!.project).world.objects.length, 1);
});

test('copy, rename, opening and deletion keep world identities and the last-session pointer consistent', async t => {
    const { repository, worlds } = memoryRepository(), fixture = setup(repository); t.after(() => fixture.autosave.dispose());
    await fixture.autosave.initialize(); await fixture.autosave.saveNow(true); const firstId = fixture.autosave.status.id;
    await fixture.autosave.saveCopy('Лес'); const copyId = fixture.autosave.status.id;
    fixture.autosave.rename('Остров'); fixture.edits.addObject('pine', 5, 6); await fixture.autosave.saveNow();
    assert.equal(worlds.get(copyId)!.name, 'Остров'); assert.equal(worlds.size, 2);
    await fixture.autosave.open(firstId); assert.equal(fixture.model.world.objects.length, 0); assert.equal((await repository.last())!.id, firstId);
    await assert.rejects(fixture.autosave.remove(firstId), /другой мир/);
    await fixture.autosave.remove(copyId); assert.equal(worlds.size, 1);
});

test('invalid saved sessions are preserved and never silently overwritten', async t => {
    const { repository, worlds } = memoryRepository(); await repository.put({ id: 'broken', name: 'Повреждённый', updatedAt: 1, project: '{}', preview: '' });
    const fixture = setup(repository); t.after(() => fixture.autosave.dispose());
    const before = fixture.model.heights.slice(); assert.equal(await fixture.autosave.initialize(), false);
    fixture.edits.addObject('rock', 1, 2); assert.equal(await fixture.autosave.saveNow(true), false);
    assert.equal(worlds.size, 1); assert.equal(worlds.get('broken')!.project, '{}'); assert.deepEqual(fixture.model.heights, before);
    assert.match(fixture.autosave.status.message, /не восстановлена/);
});

test('a failed write after new-world generation restores the previous scene and library identity', async t => {
    const { repository, worlds } = memoryRepository(), fixture = setup(repository); t.after(() => fixture.autosave.dispose());
    await fixture.autosave.initialize(); await fixture.autosave.saveNow(true);
    const previous = fixture.model.heights.slice(), id = fixture.autosave.status.id, put = repository.put; let count = 0;
    repository.put = async world => { if (++count === 2) throw new Error('write failure'); await put(world); };
    await assert.rejects(fixture.autosave.newWorld(), /write failure/);
    assert.deepEqual(fixture.model.heights, previous); assert.equal(fixture.autosave.status.id, id); assert.equal(worlds.size, 1);
});

test('storage unavailability leaves the editor usable and reports the limitation', async t => {
    const fixture = editorFixture(), autosave = createAutosave({ ...fixture, repository: async () => { throw new Error('denied'); }, preview: () => '', viewKey: () => '', newWorld: async () => true, id: () => 'id' });
    t.after(autosave.dispose); assert.equal(await autosave.initialize(), false); assert.equal(autosave.status.available, false);
    assert.match(autosave.status.message, /недоступно/); fixture.edits.addObject('pine', 2, 3); assert.equal(fixture.model.world.objects.length, 1);
});
