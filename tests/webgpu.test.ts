import test from 'node:test';
import assert from 'node:assert/strict';
import { BENCHMARK, assertBackend, comparePixels, measure, quantile, summarize } from '../src/webgpu/benchmark';
import { LOADS, createLabScene, height, placements } from '../src/webgpu/scene';
import { MeshStandardMaterial } from 'three';

test('benchmark uses interpolated quantiles without mutating input', () => {
    const samples = [5, 1, 3, 2];
    assert.equal(quantile(samples, .5), 2.5); assert.ok(Math.abs(quantile(samples, .95) - 4.7) < 1e-10);
    assert.deepEqual(samples, [5, 1, 3, 2]); assert.equal(summarize([10, 10]).throughputFps, 100);
    for (const values of [[], [NaN], [-1]]) assert.throws(() => summarize(values));
});
test('benchmark excludes warmup, completes every measured batch and yields to cancellation', async () => {
    let frames = 0, completes = 0, ticks = 0, progress = 0;
    const result = await measure({ render() { frames++; }, async finish() { completes++; ticks += 8; } }, new AbortController().signal,
        done => { progress = done; }, async () => { ticks += 100; }, () => ticks);
    assert.equal(frames, BENCHMARK.warmup + BENCHMARK.batches * BENCHMARK.batchSize);
    assert.equal(completes, BENCHMARK.warmup / BENCHMARK.batchSize + BENCHMARK.batches);
    assert.equal(result.medianMs, 2); assert.equal(result.samples.length, BENCHMARK.batches); assert.equal(progress, BENCHMARK.batches);
    const abort = new AbortController();
    await assert.rejects(measure({ render() { abort.abort(); }, async finish() {} }, abort.signal, () => {}, async () => {}), { name: 'AbortError' });
});
test('WebGL fallback cannot be reported as native WebGPU', () => {
    assert.throws(() => assertBackend('webgpu', false)); assert.throws(() => assertBackend('tsl-webgl', true));
    assert.doesNotThrow(() => assertBackend('webgpu', true)); assert.doesNotThrow(() => assertBackend('webgl', false));
});
test('image comparison ignores alpha and rejects unequal dimensions', () => {
    assert.deepEqual(comparePixels(new Uint8ClampedArray([0, 0, 0, 255]), new Uint8ClampedArray([3, 3, 3, 0])), { mae255: 3, rmse255: 3 });
    assert.throws(() => comparePixels(new Uint8ClampedArray(4), new Uint8ClampedArray(8)));
});
test('both workloads have reproducible complete placements above water', () => {
    for (const setting of Object.values(LOADS)) for (const count of [setting.trees, setting.grass]) {
        const a = placements(count, BENCHMARK.seed, 65), b = placements(count, BENCHMARK.seed, 65);
        assert.equal(a.length, count); assert.deepEqual(a, b); assert.ok(a.every(p => p.y > 1.1 && p.y === height(p.x, p.z)));
        assert.notDeepEqual(a, placements(count, BENCHMARK.seed + 1, 65));
    }
});
test('scene keeps geometry counts and instancing stable across material implementations', () => {
    const make = () => createLabScene({ ground: new MeshStandardMaterial(), plant: new MeshStandardMaterial(), water: new MeshStandardMaterial() }, 'small');
    const a = make(), b = make();
    assert.equal(a.objects, 4); assert.equal(a.instances, 1580);
    assert.deepEqual(a.plantMeshes[0].instanceMatrix.array, b.plantMeshes[0].instanceMatrix.array);
    assert.deepEqual(a.camera.matrixWorld.elements, b.camera.matrixWorld.elements);
    a.dispose(); b.dispose();
});
