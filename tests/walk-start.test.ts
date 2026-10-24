import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createModel } from '../src/state';
import { createWalkStart } from '../src/walk-start';
import type { WorldObject } from '../src/world';
const object = (asset: WorldObject['asset'], patch: Partial<WorldObject> = {}): WorldObject => ({
    id: asset, asset, source: 'manual', position: [0, 30, 0], rotation: [0, 0, 0], scale: [1, 1, 1], groundOffset: 0, followTerrain: true, tint: 1, ...patch,
});
test('starts require dry ground across the footprint and a slope below 35 degrees', () => {
    const model = createModel();
    assert.equal(createWalkStart(model, () => 30).assess(0, 0).safe, true);
    assert.match(createWalkStart(model, () => 10).assess(0, 0).reason, /Вода/);
    assert.equal(createWalkStart(model, x => 30 + Math.tan(Math.PI / 6) * x).assess(0, 0).safe, true);
    assert.match(createWalkStart(model, x => 30 + x).assess(0, 0).reason, /Крутой склон/);
    assert.match(createWalkStart(model, x => x > 0.5 ? 10 : 30).assess(0, 0).reason, /Вода/);
});
test('spawn checks reject world edges and non-finite coordinates', () => {
    const starts = createWalkStart(createModel(), () => 30);
    for (const [x, z] of [[511, 0], [-511, 0], [0, 511], [NaN, 0], [Infinity, 0]]) assert.equal(starts.assess(x, z).safe, false);
});
test('rotated and scaled rocks and trees block spawn, but elevated objects do not', () => {
    const model = createModel(), starts = createWalkStart(model, () => 30);
    model.world.objects = [object('rock', { rotation: [0, Math.PI / 4, 0], scale: [4, 1, 1] })];
    assert.match(starts.assess(2, 2).reason, /камень/); assert.equal(starts.assess(10, 10).safe, true);
    model.world.objects = [object('pine')]; assert.match(starts.assess(0, 0).reason, /дерево/);
    model.world.objects = [object('rock', { followTerrain: false, position: [0, 100, 0] })]; assert.equal(starts.assess(0, 0).safe, true);
});
test('obstacles follow terrain edits and invisible scatter does not block start', () => {
    const model = createModel(); let height = 30; const starts = createWalkStart(model, () => height);
    model.world.objects = [object('rock', { source: 'scatter' })]; assert.equal(starts.assess(0, 0).safe, false);
    height = 50; assert.equal(starts.assess(0, 0).safe, false);
    model.state.showScatter = false; assert.equal(starts.assess(0, 0).safe, true);
    model.world.objects = [object('rock')]; assert.equal(starts.assess(0, 0).safe, false);
    model.world.objects = []; assert.equal(starts.assess(0, 0).safe, true);
});
test('nearest-start search is deterministic and returns no point for a flooded world', () => {
    const model = createModel(), starts = createWalkStart(model, x => x < 20 ? 10 : 30);
    const first = starts.nearest(0, 0); assert.ok(first?.safe); assert.deepEqual(starts.nearest(0, 0), first);
    assert.ok(first.point[0] >= 20); assert.equal(createWalkStart(model, () => 0).nearest(0, 0), null);
});
test('very large obstacles are indexed without allocating unbounded spatial bins', () => {
    const model = createModel(); model.world.objects = [object('rock', { scale: [100, 100, 100] })];
    const starts = createWalkStart(model, () => 30); assert.equal(starts.assess(0, 0).safe, false); assert.equal(starts.assess(300, 300).safe, true);
});
