import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createModel } from '../src/state';
import { createWalkSimulation, FixedStepClock } from '../src/physics';
import { decodeProject } from '../src/project';
import { editorFixture } from './fixture';
test('automatic walking has the same distance at different rendering frequencies', () => {
    for (const fps of [1, 10, 30, 60, 144]) {
        const model = createModel(); model.state.water = -10;
        const simulation = createWalkSimulation(model, () => 0), clock = new FixedStepClock(); simulation.walk.autoWalking = true;
        for (let frame = 0; frame < fps * 2; frame++) clock.advance(1 / fps, simulation.step);
        assert.ok(Math.abs(simulation.walk.feet.z + 9) < 1e-8);
    }
});
test('automatic walking stops before an unsafe point and does not resume by itself', () => {
    const model = createModel(); model.state.water = -10;
    const simulation = createWalkSimulation(model, () => 0, (_x, z) => z > -1); simulation.walk.autoWalking = true;
    const clock = new FixedStepClock(); clock.advance(1, simulation.step);
    assert.equal(simulation.walk.autoWalking, false); assert.ok(simulation.walk.feet.z > -1);
    const position = simulation.walk.feet.clone(); clock.advance(1, simulation.step); assert.deepEqual(simulation.walk.feet, position);
});
test('pausing holds the camera pose and clearing input stops automatic walking', () => {
    const model = createModel(); model.state.water = -10;
    const simulation = createWalkSimulation(model, () => 0); simulation.walk.autoWalking = true;
    simulation.walk.paused = true; simulation.walk.feet.y = 3; simulation.walk.vy = -2; simulation.synchronize();
    const before = simulation.capture(); simulation.step(1 / 120); assert.deepEqual(simulation.capture(), before);
    simulation.clearKeys(); assert.equal(simulation.walk.autoWalking, false);
});
test('restoring a saved start preserves location and pauses automatic walking', () => {
    const simulation = createWalkSimulation(createModel(), () => 30);
    simulation.walk.start = simulation.walk.feet.clone().set(12, 30, 16); simulation.walk.autoWalking = true;
    const pose = simulation.capture(); simulation.restore(pose);
    assert.deepEqual(simulation.walk.start?.toArray(), [12, 30, 16]); assert.equal(simulation.walk.autoWalking, false);
});
test('FOV is saved, validated and undoable; older projects receive the default', () => {
    const { model, edits, history, storage } = editorFixture();
    edits.setWalkSettings({ fov: 95, speed: 6, sensitivity: 0.004, bob: false });
    assert.equal(decodeProject(storage.projectJSON()).walkSettings.fov, 95);
    history.undo(); assert.equal(model.walkSettings.fov, 70); history.redo(); assert.equal(model.walkSettings.fov, 95);
    const data = JSON.parse(storage.projectJSON()); delete data.walkSettings.fov; assert.equal(decodeProject(JSON.stringify(data)).walkSettings.fov, 70);
    for (const fov of [0, 150, 'wide', null]) { data.walkSettings.fov = fov; assert.throws(() => decodeProject(JSON.stringify(data)), /walkSettings.fov/); }
});
test('saved start and automatic-walk data are fully validated before project loading', async () => {
    const { storage, model } = editorFixture(); const data = JSON.parse(storage.projectJSON());
    data.view.walk = { on: false, feet: [0, 30, 0], yaw: 0, pitch: 0, vy: 0, grounded: true, swim: false, bob: 0, saved: null, start: [10, 30, 20], autoWalking: true };
    assert.deepEqual(decodeProject(JSON.stringify(data)).view.walk?.start, [10, 30, 20]);
    const original = model.heights.slice(); data.view.walk.start = [600, 30, 0];
    await assert.rejects(storage.loadProjectText(JSON.stringify(data)), /view.walk.start/); assert.deepEqual(model.heights, original);
    data.view.walk.start = null; data.view.walk.autoWalking = 'yes'; assert.throws(() => decodeProject(JSON.stringify(data)), /autoWalking/);
});
