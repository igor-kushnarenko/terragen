import { Box3, Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { getModel } from './model-library';
import { clamp, fbm, makeSimplex, smoothstep } from './noise';
import type { EditorModel } from './state';
import type { TerrainSystem } from './terrain';
import type { BiomeRegion, Vec2, WorldObject, WorldRoute } from './world';
import { RouteIndex } from './trail-math';
import {waterLevelAt} from './water-math';
import {isWorldPreset} from './world-recipes';

export function nearestOnSegment(x: number, z: number, a: Vec2, b: Vec2): Vec2 {
    const dx = b[0] - a[0], dz = b[1] - a[1], length = dx * dx + dz * dz;
    const t = length ? clamp(((x - a[0]) * dx + (z - a[1]) * dz) / length, 0, 1) : 0;
    return [a[0] + dx * t, a[1] + dz * t];
}
export function routeClearance(routes: WorldRoute[], x: number, z: number) {
    let distance = Infinity;
    for (const route of routes) for (let i = 1; i < route.points.length; i++) {
        const p = nearestOnSegment(x, z, route.points[i - 1], route.points[i]);
        distance = Math.min(distance, Math.hypot(x - p[0], z - p[1]) - route.width / 2);
    }
    return distance;
}
export function insidePolygon(x: number, z: number, points: Vec2[]) {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const a = points[i], b = points[j];
        if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
}
export type EcologyTerrain = Pick<TerrainSystem, 'getH' | 'getNormalY'>;
export function createEcology(model: EditorModel, terrain: EcologyTerrain) {
    let routeVersion: WorldRoute[] | undefined, routes = new RouteIndex([]);
    let seed = -1, forestNoise = makeSimplex(0), wetNoise = makeSimplex(1), gladeNoise = makeSimplex(2);
    function sample(x: number, z: number) {
        if (seed !== model.seeds.scatter) {
            seed = model.seeds.scatter; forestNoise = makeSimplex(seed ^ 0x4759); wetNoise = makeSimplex(seed ^ 0x93ab); gladeNoise = makeSimplex(seed ^ 0x5142);
        }
        const h = terrain.getH(x, z), ny = terrain.getNormalY(x, z), elevation = Math.max(0, h - model.state.water);
        let localWater = waterLevelAt(model.state.water,model.world.waterBodies,x,z), riverWetness = 0;
        for (const body of model.world.waterBodies) {
            if (body.kind === 'river') for (let i = 1; i < body.points.length; i++) {
                const p = nearestOnSegment(x, z, body.points[i - 1], body.points[i]), d = Math.hypot(x - p[0], z - p[1]);
                riverWetness = Math.max(riverWetness, 1 - smoothstep(body.width / 2, body.width / 2 + 30, d));
            }
        }
        const basin = Math.max(0, (terrain.getH(x + 16, z) + terrain.getH(x - 16, z) + terrain.getH(x, z + 16) + terrain.getH(x, z - 16)) / 4 - h);
        const moisture = clamp(model.state.soilMoisture * 0.6 + (fbm(wetNoise, x * 0.008, z * 0.008, 3) + 1) * 0.15
            + (1 - smoothstep(3, 35, elevation)) * 0.27 + Math.min(basin / 25, 0.16) + riverWetness * 0.25, 0, 1);
        const field = (fbm(forestNoise, x * 0.008, z * 0.008, 3) + 1) * 0.5;
        const glade = smoothstep(0.53 - model.state.clearingAmount * 0.1, 0.7 - model.state.clearingAmount * 0.12, (fbm(gladeNoise, x * 0.014, z * 0.014, 2) + 1) * 0.5) * model.state.clearingAmount;
        let forest = smoothstep(0.35, 0.63, field + (moisture - 0.5) * 0.22) * (1 - glade * 1.6);
        let kind: BiomeRegion['kind'] = elevation < 7 ? 'coast' : h > model.state.snowLine - 22 || ny < 0.8 ? 'mountains' : forest > 0.4 ? 'forest' : 'meadow';
        let strongest = 0;
        for (const biome of model.world.biomes) {
            const weight = 1 - smoothstep(biome.radius * 0.65, biome.radius, Math.hypot(x - biome.center[0], z - biome.center[1]));
            const target = biome.kind === 'jungle' ? .95 : biome.kind === 'forest'||biome.kind==='taiga' ? 0.85 : biome.kind === 'mountains' ? 0.2 : biome.kind === 'coast' ? 0.08 : biome.kind === 'valley' ? 0.18 : 0;
            forest = forest * (1 - weight) + target * weight;
            if (weight > 0 && weight >= strongest) { strongest = weight; kind = biome.kind; }
        }
        // A biome specifies habitat, not a uniform plantation. New recipes retain
        // the seeded forest patches, glades and humidity inside the biome mask.
        if(isWorldPreset(model.world.preset))forest*=(.06+.94*smoothstep(.3,.66,field))*(1-glade*1.35)*(.7+moisture*.3);
        forest = clamp(forest, 0, 1) * smoothstep(0.82, 0.95, ny) * (1 - smoothstep(model.state.snowLine - 36, model.state.snowLine - 12, h));
        if (h <= localWater + 1) forest = 0;
        return { h, ny, moisture, forest, edge: 4 * forest * (1 - forest), glade, kind, dry: h > localWater + 0.8, water: localWater };
    }
    return { sample, pathClearance: (x: number, z: number) => { if(routeVersion!==model.world.routes){routeVersion=model.world.routes;routes=new RouteIndex(routeVersion);}return routes.clearance(x,z); } };
}
export type EcologySystem = ReturnType<typeof createEcology>;
export interface Footprint { x: number; z: number; radius: number; minY: number; maxY: number; item?: WorldObject; }
export function objectFootprint(item: WorldObject, terrain: Pick<TerrainSystem, 'getH'>, canopy = true): Footprint {
    const asset = getModel(item.asset), y = item.followTerrain ? terrain.getH(item.position[0], item.position[2]) + item.groundOffset : item.position[1];
    const box = asset.bounds;
    const matrix = new Matrix4().compose(new Vector3(item.position[0], y, item.position[2]), new Quaternion().setFromEuler(new Euler(...item.rotation)), new Vector3(...item.scale));
    const bounds = new Box3();
    for (const x of [box.min.x, box.max.x]) for (const yy of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) bounds.expandByPoint(new Vector3(x, yy, z).applyMatrix4(matrix));
    const cx = (bounds.min.x + bounds.max.x) / 2, cz = (bounds.min.z + bounds.max.z) / 2;
    const radius = canopy || asset.category !== 'tree' ? Math.hypot(bounds.max.x - cx, bounds.max.z - cz) : Math.max(0.35, Math.min(box.max.x - box.min.x, box.max.z - box.min.z) * 0.07 * Math.max(item.scale[0], item.scale[2]));
    return { x: canopy ? cx : item.position[0], z: canopy ? cz : item.position[2], radius, minY: bounds.min.y, maxY: bounds.max.y, item };
}
/** Discs cover transformed model bounds; a fixed grid keeps placement checks local. */
export class FootprintIndex {
    private cells = new Map<string, Footprint[]>();
    private large: Footprint[] = [];
    private cell = 16;
    insert(p: Footprint) {
        if (p.radius > 64) { this.large.push(p); return; }
        for (let z = Math.floor((p.z - p.radius) / this.cell); z <= Math.floor((p.z + p.radius) / this.cell); z++)
            for (let x = Math.floor((p.x - p.radius) / this.cell); x <= Math.floor((p.x + p.radius) / this.cell); x++) {
                const key = x + ',' + z, list = this.cells.get(key) ?? []; list.push(p); this.cells.set(key, list);
            }
    }
    query(x: number, z: number, radius = 0) {
        const result = new Set(this.large);
        for (let j = Math.floor((z - radius) / this.cell); j <= Math.floor((z + radius) / this.cell); j++)
            for (let i = Math.floor((x - radius) / this.cell); i <= Math.floor((x + radius) / this.cell); i++)
                for (const p of this.cells.get(i + ',' + j) ?? []) result.add(p);
        return [...result];
    }
    overlaps(p: Footprint, gap = 0.35) {
        return this.query(p.x, p.z, p.radius + gap).some(other => Math.hypot(other.x - p.x, other.z - p.z) < other.radius + p.radius + gap && p.maxY > other.minY && p.minY < other.maxY);
    }
}
