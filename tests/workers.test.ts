import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createJobRunner, OperationCancelled, type JobWorker, type TerrainJob, type WorkerReply } from '../src/worker-jobs';
import { createModel } from '../src/state';
import { erodeHeightmap, generateHeightmap } from '../src/terrain-compute';
import { editorFixture } from './fixture';
import { captureDocument } from '../src/project';

class FakeWorker implements JobWorker {
    onmessage: JobWorker['onmessage'] = null; onerror: JobWorker['onerror'] = null; onmessageerror: JobWorker['onmessageerror'] = null;
    job?: TerrainJob; terminated = false;
    postMessage(job: TerrainJob, transfer: Transferable[]) { this.job = structuredClone(job, { transfer }); }
    terminate() { this.terminated = true; }
    reply(data: WorkerReply) { this.onmessage?.({ data } as MessageEvent<WorkerReply>); }
}
const settings = () => ({ ...createModel().state, N: 32, droplets: 10, thermal: 2 });

test('worker transfers a copy and cancellation ignores late results and allows a fresh job', async () => {
    const workers: FakeWorker[] = [], jobs = createJobRunner(() => { const worker = new FakeWorker(); workers.push(worker); return worker; });
    const heights = new Float32Array(33 ** 2).fill(10);
    const first = jobs.run({ kind: 'erosion', settings: settings(), seed: 44, heights }, () => {});
    assert.equal(heights.byteLength, 33 ** 2 * 4); assert.notEqual(workers[0].job!.heights!.buffer, heights.buffer);
    const late = workers[0].onmessage!; jobs.cancel();
    await assert.rejects(first, OperationCancelled); assert.equal(workers[0].terminated, true);
    const second = jobs.run({ kind: 'terrain', settings: settings(), seed: 1337 }, () => {});
    late({ data: { type: 'result', heights: heights.fill(999) } } as MessageEvent<WorkerReply>);
    workers[1].reply({ type: 'result', heights: new Float32Array(33 ** 2).fill(25) });
    assert.equal((await second)[0], 25); assert.equal(workers[1].terminated, true);
});

test('worker failures and invalid results release the worker instead of applying data', async () => {
    const worker = new FakeWorker(), jobs = createJobRunner(() => worker);
    const result = jobs.run({ kind: 'terrain', settings: settings(), seed: 1 }, () => {});
    worker.reply({ type: 'result', heights: new Float32Array(4) });
    await assert.rejects(result, /Некорректный/); assert.equal(worker.terminated, true);
    const failure = jobs.run({ kind: 'terrain', settings: settings(), seed: 1 }, () => {});
    worker.reply({ type: 'error', message: 'Compute failure' }); await assert.rejects(failure, /Compute failure/);
});

test('generation and erosion report monotonic progress and remain deterministic', () => {
    const progress: number[] = [], s = settings();
    const heights = generateHeightmap(s, fraction => progress.push(fraction));
    assert.deepEqual(heights, generateHeightmap(s)); assert.equal(progress.at(-1), 1);
    assert.ok(progress.every((value, i) => i === 0 || value >= progress[i - 1]));
    progress.length = 0;
    const eroded = erodeHeightmap(s, 44, heights, fraction => progress.push(fraction));
    assert.deepEqual(eroded, erodeHeightmap(s, 44, heights)); assert.equal(progress.at(-1), 1);
    assert.ok(progress.every((value, i) => i === 0 || value >= progress[i - 1]));
    assert.notDeepEqual(eroded, heights);
});

test('cancelled generation rolls back grid, seeds, paint, objects, operations and both history stacks', async () => {
    const worker = new FakeWorker(), jobs = createJobRunner(() => worker);
    const { model, generation, edits, history, terrain } = editorFixture(jobs);
    edits.addObject('rock', 2, 3); history.undo(); model.splat[0] = 127;
    const before = captureDocument(model), undo = history.undoDepth, redo = history.redoDepth;
    const task = generation.runGeneration(() => { terrain.buildTerrain(); terrain.updateMeshAll(); }, false, () => { model.state.N = 512; model.state.seed = 66; });
    assert.equal(model.busy, true); assert.deepEqual(model.heights, before.heights);
    generation.cancelOperation(); assert.equal(await task, false);
    assert.deepEqual(captureDocument(model), before); assert.equal(model.busy, false);
    assert.equal(history.undoDepth, undo); assert.equal(history.redoDepth, redo);
});

test('successful asynchronous generation commits exactly once and can be undone', async () => {
    const worker = new FakeWorker(), jobs = createJobRunner(() => worker);
    const { model, generation, history, terrain } = editorFixture(jobs), before = captureDocument(model);
    const task = generation.runGeneration(() => { terrain.buildTerrain(); terrain.updateMeshAll(); }, false, () => { model.state.N = 64; });
    history.flush(); assert.equal(history.undoDepth, 0);
    worker.reply({ type: 'result', heights: generateHeightmap(worker.job!.settings) });
    assert.equal(await task, true); assert.equal(history.undoDepth, 1); assert.equal(model.n, 65);
    history.undo(); assert.deepEqual(captureDocument(model), before);
});
