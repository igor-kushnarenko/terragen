import type { Feedback } from './feedback';
import type { HistorySystem } from './history';
import { recordOperation } from './operations';
import { type EditorModel } from './state';
import type { TerrainSystem } from './terrain';
import type { VegetationSystem } from './vegetation';
import { erosionDroplets } from './terrain-compute';
import { OperationCancelled, type JobRunner } from './worker-jobs';
import {TERRAIN_ALGORITHM} from './generation-settings';
import {isWorldPreset} from './world-recipes';

export function createGeneration(model: EditorModel, feedback: Feedback, history: HistorySystem, terrain: TerrainSystem, vegetation: VegetationSystem, jobs: JobRunner, beforeStart = () => {}) {
    async function execute(kind: 'terrain' | 'erosion', apply: () => void, skipUndo = false, prepare?: () => void) {
        if (model.busy) return false;
        beforeStart();
        const label = kind === 'terrain' ? 'Генерация рельефа' : 'Эрозия';
        const edit = history.begin(label);
        if (!edit) return false;
        const start = performance.now();
        try {
            prepare?.();
            const settings = { ...model.state }, seed = kind === 'terrain' ? settings.seed : model.seeds.erosion;
            feedback.setBusy(true); feedback.setProgress(0); feedback.setStatus(label + '…');
            const heights = await jobs.run({ kind, settings, seed, heights: kind === 'erosion' ? model.heights : undefined,preset:kind==='terrain'&&isWorldPreset(model.world.preset)?model.world.preset:undefined }, feedback.setProgress);
            model.heights = new Float32Array(heights);
            if (kind === 'terrain') {
                model.N = settings.N; model.seeds.terrain = seed;
                recordOperation(model, kind, seed, { N: settings.N, scale: settings.scale, height: settings.height, octaves: settings.octaves, sharp: settings.sharp, warp: settings.warp, mountains: settings.mountains, island: settings.island, areaSize: settings.areaSize }, TERRAIN_ALGORITHM);
            } else {
                recordOperation(model, kind, seed, { N: settings.N, droplets: settings.droplets, thermal: settings.thermal, erosionStrength: settings.erosionStrength });
            }
            apply();
            if (skipUndo) edit.discard(); else edit.commit();
            feedback.setProgress(1);
            const detail = kind === 'erosion' ? `${erosionDroplets(settings).toLocaleString('ru-RU')} капель` : `${settings.N}×${settings.N}`;
            feedback.setStatus(`${label}: ${detail} · сид ${seed} · ${((performance.now() - start) / 1000).toFixed(1)} с`);
            return true;
        } catch (error) {
            edit.rollback(); feedback.setProgress(0);
            if (error instanceof OperationCancelled) { feedback.setStatus(label + ' отменена'); return false; }
            throw error;
        } finally { feedback.setBusy(false); feedback.syncAllUI(); }
    }
    return {
        runGeneration: (apply: () => void, skipUndo = false, prepare?: () => void) => execute('terrain', apply, skipUndo, prepare),
        runErosion: () => execute('erosion', () => { terrain.updateMeshAll(); vegetation.snapScatter(); }),
        cancelOperation: jobs.cancel,
    };
}
export type GenerationSystem = ReturnType<typeof createGeneration>;
