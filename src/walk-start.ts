import { getModel } from './model-library';
import { Box3, Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { HALF, type EditorModel } from './state';
import type { Vec3, WorldObject } from './world';
import {waterLevelAt} from './water-math';
export const WALK_BODY_RADIUS = 0.45;
export const MAX_START_SLOPE = 35;
export interface StartAssessment { safe: boolean; point: Vec3; slope: number; reason: string; }
export function createWalkStart(model: EditorModel, getH: (x: number, z: number) => number) {
    type Obstacle = { item: WorldObject; bounds: Box3 };
    const bins = new Map<string, Obstacle[]>(), large: Obstacle[] = [];
    let objects: WorldObject[] | undefined;
    const cell = 16, key = (x: number, z: number) => `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
    function refresh() {
        if (objects === model.world.objects) return;
        objects = model.world.objects; bins.clear(); large.length = 0;
        for (const item of objects) {
            const modelAsset = getModel(item.asset);
            if (modelAsset.collider === 'none') continue;
            const bounds = modelAsset.bounds.clone();
            bounds.applyMatrix4(new Matrix4().compose(new Vector3(item.position[0], 0, item.position[2]),
                new Quaternion().setFromEuler(new Euler(...item.rotation)), new Vector3(...item.scale)));
            bounds.expandByVector(new Vector3(WALK_BODY_RADIUS, 0, WALK_BODY_RADIUS));
            const obstacle = { item, bounds };
            const x0 = Math.floor(bounds.min.x / cell), x1 = Math.floor(bounds.max.x / cell), z0 = Math.floor(bounds.min.z / cell), z1 = Math.floor(bounds.max.z / cell);
            if ((x1 - x0 + 1) * (z1 - z0 + 1) > 256) { large.push(obstacle); continue; }
            for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
                const id = `${x},${z}`, list = bins.get(id) ?? []; list.push(obstacle); bins.set(id, list);
            }
        }
    }
    function assess(x: number, z: number): StartAssessment {
        const height = getH(x, z), point: Vec3 = [x, height, z];
        const fail = (reason: string, slope = 0): StartAssessment => ({ safe: false, point, slope, reason });
        if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(height) || Math.abs(x) > HALF - 2 || Math.abs(z) > HALF - 2) return fail('Слишком близко к краю мира');
        // Check the whole footprint, not just the center of a bank or sharp ridge.
        const radius = 0.75, e = Math.max(0.5, Math.min(2, model.cell / 2));
        let slope = 0;
        for (const [dx, dz] of [[0, 0], [radius, 0], [-radius, 0], [0, radius], [0, -radius]]) {
            const px = x + dx, pz = z + dz, h = getH(px, pz);
            if (h <= waterLevelAt(model.state.water,model.world.waterBodies,px,pz) + 0.3) return fail('Вода или слишком близко к берегу');
            const gx = (getH(px + e, pz) - getH(px - e, pz)) / (2 * e), gz = (getH(px, pz + e) - getH(px, pz - e)) / (2 * e);
            slope = Math.max(slope, Math.atan(Math.hypot(gx, gz)) * 180 / Math.PI, Math.atan(Math.abs(h - height) / (Math.hypot(dx, dz) || 1)) * 180 / Math.PI);
        }
        if (slope > MAX_START_SLOPE) return fail(`Крутой склон: ${slope.toFixed(0)}° (максимум ${MAX_START_SLOPE}°)`, slope);
        refresh();
        for (const { item, bounds } of [...(bins.get(key(x, z)) ?? []), ...large]) {
            if (item.source === 'scatter' && !model.state.showScatter) continue;
            if (item.source === 'scatter' && getH(item.position[0], item.position[2]) < waterLevelAt(model.state.water,model.world.waterBodies,item.position[0],item.position[2]) + 0.5) continue;
            const y = item.followTerrain ? getH(item.position[0], item.position[2]) + item.groundOffset : item.position[1];
            if (x >= bounds.min.x && x <= bounds.max.x && z >= bounds.min.z && z <= bounds.max.z && height + model.walkSettings.eyeHeight + 0.25 >= bounds.min.y + y && height <= bounds.max.y + y)
                return fail(`Здесь ${getModel(item.asset).category==='tree'?'дерево':getModel(item.asset).category==='rock'?'камень':getModel(item.asset).name.toLowerCase()}: выберите свободную площадку`, slope);
        }
        return { safe: true, point, slope, reason: `Можно начать прогулку · уклон ${slope.toFixed(0)}°` };
    }
    function nearest(x: number, z: number): StartAssessment | null {
        x = Math.max(-HALF + 2, Math.min(HALF - 2, x)); z = Math.max(-HALF + 2, Math.min(HALF - 2, z));
        const origin = assess(x, z); if (origin.safe) return origin;
        // Deterministic rings: bounded work, including entirely flooded maps.
        for (let radius = 4; radius <= HALF * 2; radius += 8) {
            const samples = Math.min(96, Math.max(16, Math.ceil(2 * Math.PI * radius / 8)));
            for (let i = 0; i < samples; i++) {
                const angle = i / samples * Math.PI * 2, px = x + Math.cos(angle) * radius, pz = z + Math.sin(angle) * radius;
                if (Math.abs(px) > HALF - 2 || Math.abs(pz) > HALF - 2) continue;
                const candidate = assess(px, pz); if (candidate.safe) return candidate;
            }
        }
        return null;
    }
    return { assess, nearest };
}
export type WalkStartSystem = ReturnType<typeof createWalkStart>;
