import TerrainWorker from './terrain.worker?worker&inline';
import { createJobRunner } from './worker-jobs';
// Inline worker makes both the normal build and the single-file offline build self-contained.
export const createTerrainJobs = () => createJobRunner(() => new TerrainWorker());
