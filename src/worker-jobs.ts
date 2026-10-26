import type {IronSettings} from './iron-settings';
import type { EditorState } from './state';
import type { HeightFeature } from './landscape-compute';
import type { WaterBody, WorldRoute,WorldPresetId } from './world';
import type {JungleSettings} from './jungle-settings';
import type {TaigaSettings} from './taiga-settings';
export interface TerrainJob { kind: 'terrain' | 'erosion' | 'shape' | 'water'; settings: EditorState; seed: number; heights?: Float32Array; features?: HeightFeature[]; routes?: WorldRoute[]; waterBodies?: WaterBody[]; preset?:WorldPresetId;worldErosion?:0|1|2;jungle?:JungleSettings;taiga?:TaigaSettings;iron?:IronSettings; }
export type WorkerReply = { type: 'progress'; fraction: number } | { type: 'result'; heights: Float32Array } | { type: 'error'; message: string };
export interface JobRunner {
    run(job: TerrainJob, progress: (fraction: number) => void): Promise<Float32Array>;
    cancel(): void;
}
export class OperationCancelled extends Error { constructor() { super('Операция отменена'); this.name = 'OperationCancelled'; } }
export interface JobWorker {
    onmessage: ((event: MessageEvent<WorkerReply>) => void) | null;
    onerror: ((event: ErrorEvent) => void) | null;
    onmessageerror: ((event: MessageEvent) => void) | null;
    postMessage(job: TerrainJob, transfer: Transferable[]): void;
    terminate(): void;
}
// A fresh worker owns each operation. Termination stops even a tight compute loop.
export function createJobRunner(factory: () => JobWorker): JobRunner {
    let cancelCurrent: (() => void) | undefined;
    return {
        run(job, progress) {
            if (cancelCurrent) return Promise.reject(new Error('Операция уже выполняется'));
            return new Promise((resolve, reject) => {
                let worker: JobWorker;
                try { worker = factory(); } catch (error) { reject(error); return; }
                let finished = false;
                const finish = (error?: unknown, heights?: Float32Array) => {
                    if (finished) return;
                    finished = true; worker.terminate(); cancelCurrent = undefined;
                    worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null;
                    if (error) reject(error); else resolve(heights!);
                };
                cancelCurrent = () => finish(new OperationCancelled());
                worker.onmessage = ({ data }) => {
                    if (finished) return;
                    try {
                        if (data.type === 'progress') progress(data.fraction);
                        else if (data.type === 'error') finish(new Error(data.message));
                        else if (data.type === 'result') {
                            if (!(data.heights instanceof Float32Array) || data.heights.length !== (job.settings.N + 1) ** 2 || !data.heights.every(h => Number.isFinite(h) && Math.abs(h) <= 60000))
                                throw new Error('Некорректный результат фоновой операции');
                            finish(undefined, data.heights);
                        }
                    } catch (error) { finish(error); }
                };
                worker.onerror = event => { event.preventDefault(); finish(new Error(event.message || 'Ошибка Web Worker')); };
                worker.onmessageerror = () => finish(new Error('Не удалось прочитать результат Web Worker'));
                try {
                    // Never transfer the live terrain buffer: cancellation must leave it intact.
                    const heights = job.heights?.slice();
                    worker.postMessage({ ...job, settings: { ...job.settings }, heights }, heights ? [heights.buffer] : []);
                } catch (error) { finish(error); }
            });
        },
        cancel() { cancelCurrent?.(); },
    };
}
