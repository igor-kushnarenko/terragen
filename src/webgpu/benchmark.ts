/** Completion throughput, deliberately independent of requestAnimationFrame/vsync. */
export type BackendId = 'webgl' | 'tsl-webgl' | 'webgpu';
export const BACKENDS: readonly BackendId[] = ['webgl', 'tsl-webgl', 'webgpu'];
export const LABELS: Record<BackendId, string> = {
    webgl: 'WebGL · GLSL', 'tsl-webgl': 'WebGL · TSL', webgpu: 'WebGPU · TSL',
};
export const BENCHMARK = { width: 960, height: 540, seed: 31031, warmup: 24, batches: 24, batchSize: 4, time: 12 } as const;
export function quantile(values: readonly number[], fraction: number) {
    if (!values.length || values.some(v => !Number.isFinite(v) || v < 0)) throw new Error('Некорректные замеры');
    if (fraction < 0 || fraction > 1 || !Number.isFinite(fraction)) throw new Error('Некорректный квантиль');
    const sorted = [...values].sort((a, b) => a - b), index = (sorted.length - 1) * fraction;
    const lower = Math.floor(index), upper = Math.ceil(index);
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}
export function summarize(samples: readonly number[]) {
    const median = quantile(samples, .5), p95 = quantile(samples, .95);
    return { medianMs: median, p95Ms: p95, throughputFps: median > 0 ? 1000 / median : null };
}
export interface BenchmarkDriver {
    render(time: number): void;
    /** Must wait for this renderer's GPU queue, rather than just submit commands. */
    finish(): Promise<void>;
}
export async function measure(driver: BenchmarkDriver, signal: AbortSignal, progress: (done: number, total: number) => void,
    yieldUI: () => Promise<void> = () => new Promise(resolve => setTimeout(resolve, 0)), now: () => number = () => performance.now()) {
    const check = () => signal.throwIfAborted();
    for (let i = 0; i < BENCHMARK.warmup; i++) {
        check(); driver.render(BENCHMARK.time + i / 60);
        if ((i + 1) % BENCHMARK.batchSize === 0) { await driver.finish(); await yieldUI(); }
    }
    const samples: number[] = [];
    for (let batch = 0; batch < BENCHMARK.batches; batch++) {
        check();
        const start = now();
        for (let i = 0; i < BENCHMARK.batchSize; i++) driver.render(BENCHMARK.time + (batch * BENCHMARK.batchSize + i) / 60);
        await driver.finish();
        samples.push((now() - start) / BENCHMARK.batchSize);
        progress(batch + 1, BENCHMARK.batches);
        await yieldUI();
    }
    check(); return { ...summarize(samples), samples };
}
export function assertBackend(requested: BackendId, native: boolean) {
    if (requested === 'webgpu' && !native) throw new Error('WebGPU недоступен: браузер выбрал WebGL. Результат WebGPU не записан.');
    if (requested !== 'webgpu' && native) throw new Error('Неожиданный графический API');
}
export function comparePixels(a: Uint8ClampedArray, b: Uint8ClampedArray) {
    if (!a.length || a.length !== b.length || a.length % 4) throw new Error('Размеры снимков не совпадают');
    let absolute = 0, squared = 0;
    for (let i = 0; i < a.length; i++) if (i % 4 !== 3) { const d = a[i] - b[i]; absolute += Math.abs(d); squared += d * d; }
    const channels = a.length / 4 * 3;
    return { mae255: absolute / channels, rmse255: Math.sqrt(squared / channels) };
}
