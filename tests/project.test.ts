import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editorFixture } from './fixture';
import { captureDocument, bytesToBase64, decodeProject } from '../src/project';

test('format 7 round-trips objects, metadata, seeds, operations and walk settings', async () => {
    const { model, edits, storage } = editorFixture();
    edits.addObject('pine', 12, 20);
    edits.setSeeds({ erosion: 44, scatter: 55, brush: 66 }); edits.setWalkSettings({ speed: 6, sensitivity: 0.004 });
    edits.replaceWorld({ biomes: [{ id: 'forest-1', name: 'Лес', kind: 'forest', center: [0, 0], radius: 100 }],
        routes: [{ id: 'trail-1', name: 'Тропа', kind: 'trail', points: [[0, 0], [5, 5]], width: 1 }] });
    const before = captureDocument(model), json = storage.projectJSON();
    assert.equal(JSON.parse(json).version,11);
    edits.removeObject(model.world.objects[0].id);
    await storage.loadProjectText(json); assert.deepEqual(captureDocument(model), before);
});
test('old format 1 migrates and regenerates its scatter once', async () => {
    const { model, storage } = editorFixture();
    const data = JSON.parse(storage.projectJSON());
    const old = { app: data.app, version: 1, size: data.size, state: data.state, heights: data.heights, splatRes: data.splatRes, splat: data.splat,
        camera: { pos: [1, 2, 3], target: [0, 0, 0] }, scatter: true };
    const migrated = decodeProject(JSON.stringify(old)); assert.equal(migrated.version,11); assert.equal(migrated.legacyScatter, true);
    await storage.loadProjectText(JSON.stringify(old));
    assert.ok(model.world.objects.length > 0); assert.equal(JSON.parse(storage.projectJSON()).version,11);
});
test('invalid files do not mutate buffers, settings, camera or either history stack', async () => {
    const fixture = editorFixture(), { model, storage, history, render } = fixture;
    fixture.edits.addObject('rock', 0, 0); history.undo();
    const document = captureDocument(model), undo = history.undoDepth, redo = history.redoDepth, camera = render.camera.position.toArray();
    const original = JSON.parse(storage.projectJSON());
    const cases: ((data: typeof original) => void)[] = [
        data => { data.version = 999; }, data => { data.state.N = 999999; }, data => { data.state.scale = 0; },
        data => { data.heights = 'bad'; }, data => { data.splat = ''; }, data => { data.seeds.scatter = -1; },
        data => { data.walkSettings.speed = 'fast'; }, data => { data.view.camera.pos = [1, 2]; },
        data => { data.world.routes = [{ id: 'route-1', kind: 'trail', name: 'Bad', points: [[0, 0]], width: 2 }]; },
        data => { data.world.waterBodies[0].level = 900; }, data => { data.operations[0].algorithmVersion = 99; },
        data => {
            const bytes = Uint8Array.from(atob(data.heights), char => char.charCodeAt(0));
            new DataView(bytes.buffer).setFloat32(0, NaN, true); data.heights = bytesToBase64(bytes);
        },
    ];
    for (const change of cases) {
        const invalid = structuredClone(original); change(invalid);
        await assert.rejects(storage.loadProjectText(JSON.stringify(invalid)), /Неверный проект/);
        assert.deepEqual(captureDocument(model), document); assert.equal(history.undoDepth, undo); assert.equal(history.redoDepth, redo);
        assert.deepEqual(render.camera.position.toArray(), camera);
    }
});
test('loading a project is one undoable operation, including its camera', async () => {
    const { model, storage, edits, history, render } = editorFixture();
    const first = captureDocument(model), camera = render.camera.position.toArray();
    edits.addObject('rock', 12, 34); render.camera.position.set(10, 20, 30); const json = storage.projectJSON();
    history.undo(); render.camera.position.fromArray(camera);
    await storage.loadProjectText(json); assert.equal(model.world.objects.length, 1);
    history.undo(); assert.deepEqual(captureDocument(model), first); assert.deepEqual(render.camera.position.toArray(), camera);
    history.redo(); assert.equal(model.world.objects.length, 1); assert.deepEqual(render.camera.position.toArray(), [10, 20, 30]);
});
test('a saved walk pose keeps velocity and return-to-editor camera', () => {
    const { storage } = editorFixture(); const data = JSON.parse(storage.projectJSON());
    data.view.walk = { on: true, feet: [1, 20, 2], yaw: 0.5, pitch: 0.1, vy: 2, grounded: false, swim: false, bob: 3,
        saved: { pos: [-300, 200, 500], target: [0, 30, 0], near: 0.5 } };
    const decoded = decodeProject(JSON.stringify(data)); assert.equal(decoded.view.walk?.vy, 2); assert.equal(decoded.view.walk?.on, true);
});
test('invalid object edits are rejected before history or the world changes', () => {
    const { edits, model, history } = editorFixture(); const id = edits.addObject('rock', 0, 0)!;
    const before = captureDocument(model), depth = history.undoDepth;
    assert.throws(() => edits.updateObject(id, { scale: [0, 1, 1] }), /Неверный проект/);
    assert.deepEqual(captureDocument(model), before); assert.equal(history.undoDepth, depth);
});
