import type { Object3D, Scene } from 'three';
export interface FrameCounters {
    triangles: number;
    calls: number;
    objects: number;
}
export interface FrameSample extends FrameCounters {
    fps: number;
    frameTimeMs: number;
}
/** Frame intervals use wall time; simulation time must never enter this meter. */
export class FrameMeter {
    private lastTimestamp: number | undefined;
    private elapsedMs = 0;
    private frames = 0;
    private calls = 0;
    private triangles = 0;
    constructor(private readonly intervalMs = 500) { }
    reset() {
        this.lastTimestamp = undefined;
        this.elapsedMs = this.frames = this.calls = this.triangles = 0;
    }
    record(timestampMs: number, counters: FrameCounters): FrameSample | undefined {
        const last = this.lastTimestamp;
        this.lastTimestamp = timestampMs;
        if (last === undefined || timestampMs <= last)
            return;
        this.elapsedMs += timestampMs - last;
        this.frames++;
        this.calls += counters.calls;
        this.triangles += counters.triangles;
        if (this.elapsedMs < this.intervalMs)
            return;
        const sample = {
            fps: this.frames * 1000 / this.elapsedMs,
            frameTimeMs: this.elapsedMs / this.frames,
            triangles: Math.round(this.triangles / this.frames),
            calls: Math.round(this.calls / this.frames),
            objects: counters.objects,
        };
        this.elapsedMs = this.frames = this.calls = this.triangles = 0;
        return sample;
    }
}
/** Counts visible renderable scene objects, including individual mesh instances.
 * This is a scene census, not a GPU/frustum-culling statistic. */
export function countSceneObjects(scene: Scene): number {
    let count = 0;
    scene.traverseVisible((object: Object3D) => {
        const renderable = object as Object3D & {
            isInstancedMesh?: boolean;
            count?: number;
            isMesh?: boolean;
            isLine?: boolean;
            isPoints?: boolean;
            isSprite?: boolean;
        };
        if (renderable.isInstancedMesh)
            count += renderable.count ?? 0;
        else if (renderable.isMesh || renderable.isLine || renderable.isPoints || renderable.isSprite)
            count++;
    });
    return count;
}
