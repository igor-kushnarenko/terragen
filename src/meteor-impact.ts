import { objectFootprint } from './ecology';
import { getModel } from './model-library';
import { clamp, mulberry32, smoothstep } from './noise';
import { HALF, SIZE, SPLAT_RES, type EditorModel } from './state';
import type { TerrainSystem } from './terrain';
import { waterLevelAt } from './water-math';
import type { Vec3 } from './world';

export interface MeteorPlan {
    seed: number;
    radius: number;
    start: Vec3;
    target: Vec3;
    duration: number;
}
export interface FireSite { id: string; position: Vec3; size: number; }
export const MIN_METEOR_RADIUS=.2,MAX_METEOR_RADIUS=24;
export function meteorRadius(random:number){
    const t=clamp(random,0,1);
    return t<.3?MIN_METEOR_RADIUS+1.1*(t/.3)**1.5:t<.9?1.3+7.7*((t-.3)/.6)**1.6:9+15*((t-.9)/.1)**.7;
}
export function meteorDimensions(radius: number, cell: number) {
    // Even a coarse height grid needs enough vertices to describe a depression.
    const small=smoothstep(.2,1.5,radius),craterRadius = Math.max(radius * 5 + 8*small, cell * Math.min(1.6,.55+radius*.3));
    return { craterRadius, depth: radius * 1.4 + small, blastRadius: craterRadius * .85, heatRadius: craterRadius * 1.9 };
}
export function isFlammable(asset: string) {
    return ['tree', 'shrub', 'wood', 'bridge'].includes(getModel(asset).category) || asset === 'cabin' || asset === 'pier';
}
export function meteorSurface(model: EditorModel, terrain: Pick<TerrainSystem, 'getH'>, x: number, z: number) {
    return Math.max(terrain.getH(x, z), waterLevelAt(model.state.water, model.world.waterBodies, x, z));
}
/** Sweep the whole segment, so a fast meteor cannot skip a ridge or a lake. */
export function meteorContact(model: EditorModel, terrain: Pick<TerrainSystem, 'getH'>, from: Vec3, to: Vec3,radius=0): Vec3 | null {
    const steps = Math.max(1, Math.ceil(Math.hypot(to[0] - from[0], to[2] - from[2]) / Math.min(2, model.cell / 2)));
    const point = (t: number): Vec3 => from.map((v, i) => v + (to[i] - v) * t) as Vec3;
    for (let i = 0; i <= steps; i++) {
        const p = point(i / steps);
        if (p[1]-radius > meteorSurface(model, terrain, p[0], p[2])) continue;
        let a = Math.max(0, (i - 1) / steps), b = i / steps;
        for (let n = 0; n < 16; n++) {
            const m = (a + b) / 2, q = point(m);
            if (q[1]-radius > meteorSurface(model, terrain, q[0], q[2])) a = m; else b = m;
        }
        const hit = point(b); hit[1] = meteorSurface(model, terrain, hit[0], hit[2]); return hit;
    }
    return null;
}
export function createMeteorPlan(model: EditorModel, terrain: Pick<TerrainSystem, 'getH'>, observer: Vec3, seed: number): MeteorPlan {
    const random = mulberry32(seed), radius = meteorRadius(random());
    const margin = meteorDimensions(radius, model.cell).craterRadius * 1.4 + 4;
    const angle = random() * Math.PI * 2, distance = 65 + margin + random() * 95;
    const x = clamp(observer[0] + Math.cos(angle) * distance, -HALF + margin, HALF - margin);
    const z = clamp(observer[2] + Math.sin(angle) * distance, -HALF + margin, HALF - margin);
    const target: Vec3 = [x, meteorSurface(model, terrain, x, z), z];
    const direction = random() * Math.PI * 2, run = 140 + random() * 220;
    const start: Vec3 = [clamp(x + Math.cos(direction) * run, -HALF + 2, HALF - 2), Math.max(model.maxH, target[1]) + 160 + random() * 140, clamp(z + Math.sin(direction) * run, -HALF + 2, HALF - 2)];
    return { seed: seed >>> 0, radius, start, target: meteorContact(model, terrain, start, target) ?? target, duration: 5 + random() * 2 };
}
/** Persistent consequences are committed together by the caller's history transaction. */
export function applyMeteorImpact(model: EditorModel, terrain: Pick<TerrainSystem, 'getH'>, plan: MeteorPlan) {
    const [x, y, z] = plan.target, dimensions = meteorDimensions(plan.radius, model.cell);
    const { craterRadius, depth } = dimensions;
    const water = waterLevelAt(model.state.water, model.world.waterBodies, x, z), underwater = water > terrain.getH(x, z) + .5;
    const blastRadius = dimensions.blastRadius * (underwater ? .55 : 1), heatRadius = underwater ? 0 : dimensions.heatRadius;
    const destroyed = new Set<string>(), fires: FireSite[] = [];
    // Evaluate bounds against the old ground before the crater changes foundations.
    model.world.objects = model.world.objects.flatMap(item => {
        if (item.source === 'scatter' && !model.state.showScatter) return [item];
        const p = objectFootprint(item, terrain), horizontal = Math.max(0, Math.hypot(p.x - x, p.z - z) - p.radius);
        const vertical = Math.max(p.minY - y, 0, y - p.maxY), distance = Math.hypot(horizontal, vertical);
        if (distance < blastRadius) { destroyed.add(item.id); return []; }
        if (distance < heatRadius && isFlammable(item.asset) && p.maxY > waterLevelAt(model.state.water, model.world.waterBodies, p.x, p.z) + .5) {
            fires.push({ id: item.id, position: [p.x, Math.max(p.minY, terrain.getH(p.x, p.z)) + .3, p.z], size: clamp((p.maxY - p.minY) * .5, 1.2, 7) });
            return [{ ...item, tint: Math.max(.1, item.tint * .24) }];
        }
        return [item];
    });
    model.world.groups = model.world.groups.map(g => ({ ...g, objectIds: g.objectIds.filter(id => !destroyed.has(id)) })).filter(g => g.objectIds.length >= 2);
    const reach = craterRadius * 1.35;
    const i0 = clamp(Math.floor((x - reach + HALF) / model.cell), 0, model.N), i1 = clamp(Math.ceil((x + reach + HALF) / model.cell), 0, model.N);
    const j0 = clamp(Math.floor((z - reach + HALF) / model.cell), 0, model.N), j1 = clamp(Math.ceil((z + reach + HALF) / model.cell), 0, model.N);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const q = Math.hypot(-HALF + i * model.cell - x, -HALF + j * model.cell - z) / craterRadius;
        if (q > 1.35) continue;
        const bowl = q < 1 ? -depth * (1 - q * q) ** 2 : 0;
        const rim = depth * .2 * Math.exp(-(((q - 1) / .16) ** 2)) * smoothstep(.65, 1, q) * (1 - smoothstep(1.15, 1.35, q));
        const k = j * model.n + i; model.heights[k] = clamp(model.heights[k] + bowl + rim, -59900, 59900);
    }
    const pixel = SIZE / SPLAT_RES;
    for (let j = clamp(Math.floor((z - reach + HALF) / pixel), 0, SPLAT_RES - 1); j <= Math.min(SPLAT_RES - 1, Math.ceil((z + reach + HALF) / pixel)); j++)
        for (let i = clamp(Math.floor((x - reach + HALF) / pixel), 0, SPLAT_RES - 1); i <= Math.min(SPLAT_RES - 1, Math.ceil((x + reach + HALF) / pixel)); i++) {
            const q = Math.hypot(-HALF + (i + .5) * pixel - x, -HALF + (j + .5) * pixel - z) / craterRadius;
            const alpha = 1 - smoothstep(.9, 1.35, q); if (!alpha) continue;
            const k = (j * SPLAT_RES + i) * 4;
            for (let c = 0; c < 4; c++) { model.splat[k + c] *= 1 - alpha; model.splatDetail[k + c] *= 1 - alpha; }
            model.splatDetail[k + (q < .75 ? 2 : 1)] += Math.round(alpha * 255);
        }
    // Correct fire origins to the new surface, and extinguish sites flooded by the crater.
    const dryFires = fires.filter(site => terrain.getH(site.position[0], site.position[2]) > waterLevelAt(model.state.water, model.world.waterBodies, site.position[0], site.position[2]) + .3);
    for (const site of dryFires) site.position[1] = Math.max(site.position[1], terrain.getH(site.position[0], site.position[2]) + .3);
    return { ...dimensions, underwater, destroyed: destroyed.size, fires: dryFires, rect: [i0, j0, i1, j1] as const };
}
export type MeteorImpact = ReturnType<typeof applyMeteorImpact>;
