import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editorFixture } from './fixture';
import { captureDocument, decodeProject } from '../src/project';
import { MAX_WORLD_OBJECTS, type WorldObject } from '../src/world';
import { Vector3 } from 'three';

test('known-change transactions retain undo, redo, atomic rollback and redo after a failed edit',()=>{
    const f=editorFixture(),before=captureDocument(f.model);
    f.history.transactionChanged('Удар',()=>{f.model.heights[0]-=2;f.model.splatDetail[0]=255;});const after=captureDocument(f.model);
    f.history.undo();assert.deepEqual(captureDocument(f.model),before);f.history.redo();assert.deepEqual(captureDocument(f.model),after);f.history.undo();
    assert.throws(()=>f.history.transactionChanged('Ошибка',()=>{f.model.heights[0]=999;f.model.world.objects=[];throw new Error('cancel');}),/cancel/);
    assert.deepEqual(captureDocument(f.model),before);assert.equal(f.history.undoDepth,0);assert.equal(f.history.redoDepth,1);f.history.redo();assert.deepEqual(captureDocument(f.model),after);
});

test('erosion with a saved seed is exactly repeatable on the same input', async () => {
    const { model, generation, history } = editorFixture();
    model.state.droplets = 10; model.state.thermal = 2;
    model.seeds.erosion = 123456;
    await generation.runErosion(); const first = model.heights.slice();
    const record = structuredClone(model.operations.at(-1));
    history.undo(); await generation.runErosion();
    assert.deepEqual(model.heights, first); assert.deepEqual(model.operations.at(-1), record);
    assert.equal(record?.seed, 123456);
});
test('scatter is repeatable and its exact object transforms survive undo and redo', () => {
    const { model, terrain, vegetation, history } = editorFixture();
    model.heights.fill(25); terrain.updateMeshAll(); model.state.treeDensity = 0.01; model.state.rockDensity = 0.01;
    history.transaction('Расстановка', () => vegetation.scatter());
    const objects = structuredClone(model.world.objects); assert.ok(objects.length > 0);
    history.undo(); assert.equal(model.world.objects.length, 0);
    history.redo(); assert.deepEqual(model.world.objects, objects);
    vegetation.scatter(); assert.deepEqual(model.world.objects, objects);
});
test('add, transform and remove objects share the history with terrain edits', () => {
    const { edits, model, history } = editorFixture();
    const id = edits.addObject('rock', 0, 0)!;
    edits.updateObject(id, { position: [20, 0, 30], scale: [2, 2, 2] });
    const moved = structuredClone(model.world.objects[0]);
    edits.removeObject(id); assert.equal(model.world.objects.length, 0);
    history.undo(); assert.deepEqual(model.world.objects[0], moved);
    history.undo(); assert.equal(model.world.objects[0].position[0], 0);
    history.undo(); assert.equal(model.world.objects.length, 0);
    history.redo(); history.redo(); history.redo(); assert.equal(model.world.objects.length, 0);
});
test('biomes, routes, water bodies and walk settings participate in undo', () => {
    const { edits, model, history } = editorFixture();
    const before = captureDocument(model);
    edits.replaceWorld({ biomes: [{ id: 'biome-1', name: 'Лес', kind: 'forest', center: [0, 0], radius: 100 }],
        routes: [{ id: 'trail-1', name: 'Тропа', kind: 'trail', points: [[0, 0], [10, 10]], width: 2 }],
        waterBodies: [...model.world.waterBodies, { id: 'lake-1', kind: 'lake', points: [[0, 0], [10, 0], [0, 10]], level: 20, opacity: 0.7, wave: 0.2, width: 1 }] });
    edits.setWalkSettings({ speed: 8, bob: false });
    history.undo(); assert.deepEqual(model.walkSettings, before.walkSettings);
    history.undo(); assert.deepEqual(model.world, before.world);
    history.redo(); history.redo(); assert.equal(model.walkSettings.speed, 8); assert.equal(model.world.routes.length, 1);
});
test('a new edit clears redo and a slider transaction becomes one undo step', () => {
    const { model, history, edits } = editorFixture();
    const edit = history.begin('Высота')!;
    model.state.height = 180; model.state.height = 200; model.state.height = 220; edit.commit();
    assert.equal(history.undoDepth, 1); history.undo(); assert.equal(model.state.height, 170);
    assert.equal(history.redoDepth, 1); edits.addObject('pine', 0, 0); assert.equal(history.redoDepth, 0);
});
test('failed erosion rolls back the entire document and creates no history entry', async () => {
    const { model, generation, history, feedback } = editorFixture();
    model.state.droplets = 10;
    const before = captureDocument(model);
    feedback.setProgress = () => { throw new Error('test failure'); };
    await assert.rejects(generation.runErosion(), /test failure/);
    assert.deepEqual(captureDocument(model), before); assert.equal(model.busy, false); assert.equal(history.undoDepth, 0);
});
test('flush cannot commit a still-running asynchronous transaction', () => {
    const { model, history } = editorFixture();
    const edit = history.begin('Работа')!; model.busy = true; model.heights[0] += 1;
    history.flush(); assert.equal(edit.active, true); assert.equal(history.undoDepth, 0);
    edit.commit(); model.busy = false; assert.equal(history.undoDepth, 1);
});

test('noise brush is reproducible with its seed and records the operation', () => {
    const { model, terrain, brushes, history } = editorFixture();
    model.state.tool = 'noise'; model.seeds.brush = 77;
    const hit = new Vector3(0, terrain.getH(0, 0), 0);
    history.transaction('Шум', () => brushes.applyBrush(hit, 0.1)); const first = model.heights.slice();
    assert.equal(model.operations.at(-1)?.seed, 77);
    history.undo(); history.transaction('Шум', () => brushes.applyBrush(hit, 0.1));
    assert.deepEqual(model.heights, first);
    history.undo(); model.seeds.brush = 78; brushes.applyBrush(hit, 0.1);
    assert.notDeepEqual(model.heights, first);
});

test('changing the master seed derives and saves all child seeds as one edit', () => {
    const { model, edits, history } = editorFixture(); const original = { ...model.seeds };
    edits.setSeeds({ terrain: 123 }, true);
    assert.equal(model.state.seed, 123); assert.notDeepEqual(model.seeds, original); assert.equal(history.undoDepth, 1);
    history.undo(); assert.deepEqual(model.seeds, original); assert.equal(model.state.seed, 1337);
    history.redo(); assert.equal(model.state.seed, 123);
});

test('scatter keeps unique IDs even when authored entities use generated-looking IDs', () => {
    const { model, terrain, vegetation, storage } = editorFixture();
    model.heights.fill(25); terrain.updateMeshAll(); model.state.treeDensity = 0.01; model.state.rockDensity = 0.01;
    model.world.objects = [{ id: 'scatter-pine-0', asset: 'rock', source: 'manual', position: [0, 25, 0], rotation: [0, 0, 0], scale: [1, 1, 1], groundOffset: 0, followTerrain: true, tint: 1 }];
    model.world.biomes = [{ id: 'scatter-rock-0', name: 'Лес', kind: 'forest', center: [0, 0], radius: 100 }];
    vegetation.scatter();
    assert.equal(new Set(model.world.objects.map(item => item.id)).size, model.world.objects.length);
    assert.equal(model.world.objects[0].id, 'scatter-pine-0');
    assert.doesNotThrow(() => decodeProject(storage.projectJSON()));
});

test('scatter never exceeds the serializable world object limit', () => {
    const { model, terrain, vegetation, storage } = editorFixture();
    model.heights.fill(25); terrain.updateMeshAll();
    const object: WorldObject = { id: 'manual-0', asset: 'rock', source: 'manual', position: [0, 25, 0], rotation: [0, 0, 0], scale: [1, 1, 1], groundOffset: 0, followTerrain: true, tint: 1 };
    model.world.objects = Array.from({ length: MAX_WORLD_OBJECTS }, (_, i) => ({ ...structuredClone(object), id: `manual-${i}` }));
    vegetation.scatter(); assert.equal(model.world.objects.length, MAX_WORLD_OBJECTS);
    assert.doesNotThrow(() => decodeProject(storage.projectJSON()));
});
