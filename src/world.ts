import type {JungleSettings} from './jungle-settings';
import type {TaigaSettings} from './taiga-settings';
export const MAX_WORLD_OBJECTS = 20000;
export const MAX_ANIMATED_OBJECTS = 128;
export interface ObjectAnimation {
    clip:number;
    playing:boolean;
    speed:number;
    loop:'repeat'|'once';
    /** Authored start/paused time. Playback does not mutate the document each frame. */
    time:number;
    /** Changes only on an explicit seek/restart, including replay of a finished one-shot. */
    restart?:number;
}
export type Vec3 = [
    number,
    number,
    number
];
export type Vec2 = [
    number,
    number
];
export interface WorldObject {
    id: string;
    asset: string;
    source: 'manual' | 'scatter' | 'composition';
    position: Vec3;
    rotation: Vec3;
    scale: Vec3;
    groundOffset: number;
    followTerrain: boolean;
    tint: number;
    /** A dynamic prop; the authored transform remains its saved spawn pose. */
    floating?: boolean;
    density?: number;
    animation?:ObjectAnimation;
}
export interface BiomeRegion {
    id: string;
    name: string;
    kind: 'forest' | 'coast' | 'mountains' | 'meadow' | 'valley' | 'jungle' | 'taiga';
    center: Vec2;
    radius: number;
    source?: 'composition';
    jungle?:JungleSettings;
    taiga?:TaigaSettings;
}
export interface WorldRoute {
    id: string;
    name: string;
    kind: 'trail' | 'road';
    points: Vec2[];
    width: number;
    controlPoints?: Vec2[];
    curve?: 'centripetal';
    surface?: 'soil' | 'gravel' | 'sand';
    maxGrade?: number;
    source?: 'manual' | 'composition';
}
export type LegacyPresetId = 'forest' | 'coast' | 'mountains' | 'valley';
export const WORLD_PRESET_IDS = ['archipelago','desert','taiga','iron-islands','fjords','jungle'] as const;
export type WorldPresetId = typeof WORLD_PRESET_IDS[number];
export type LandscapePresetId = LegacyPresetId | WorldPresetId;
export interface WorldRecipe {version:1;seed:number;erosion:0|1|2;plants:boolean;routes:boolean;jungle?:JungleSettings;taiga?:TaigaSettings;}
export interface LandscapePoint {
    id: string; name: string; kind: 'glade' | 'valley' | 'viewpoint' | 'landmark';
    position: Vec2; radius: number;
}
export interface WaterBody {
    /** Visibility/absorption distance in metres. Older projects use a type-specific default. */
    clarity?: number;
    id: string;
    kind: 'ocean' | 'lake' | 'river';
    points: Vec2[];
    level: number;
    opacity: number;
    wave: number;
    width: number;
    name?: string;
    endLevel?: number;
    flowSpeed?: number;
    flowDirection?: 1 | -1;
    depth?: number;
    bankWidth?: number;
    bankSurface?: 'sand' | 'gravel';
    controlPoints?: Vec2[];
}
export interface ObjectGroup { id: string; name: string; objectIds: string[]; }
export interface SavedViewpoint {id:string;name:string;position:Vec3;target:Vec3;fov:number;roll:number;exposure:number;}
export interface ModelAsset {
    id: string; name: string; blob: string; byteLength: number;
    /** The binary is the untouched source GLB; normalize its hierarchy when loading. */
    normalize?:boolean;
    category: 'tree' | 'shrub' | 'rock' | 'wood' | 'bridge' | 'structure' | 'animated';
    collider: 'trunk' | 'convex' | 'mesh' | 'none';
}
export interface WorldData {
    preset: LandscapePresetId | null;
    recipe?: WorldRecipe;
    landmarks: LandscapePoint[];
    assets: ModelAsset[];
    objects: WorldObject[];
    groups: ObjectGroup[];
    viewpoints: SavedViewpoint[];
    biomes: BiomeRegion[];
    routes: WorldRoute[];
    waterBodies: WaterBody[];
}
export interface WalkSettings {
    equippedLight: 'none' | 'flashlight' | 'lantern';
    lightEnabled: boolean;
    speed: number;
    sprint: number;
    swimSpeed: number;
    eyeHeight: number;
    gravity: number;
    jumpSpeed: number;
    sensitivity: number;
    fov: number;
    bob: boolean;
}
export interface OperationSeeds {
    terrain: number;
    erosion: number;
    scatter: number;
    brush: number;
    composition: number;
}
export interface OperationRecord {
    kind: 'terrain' | 'erosion' | 'scatter' | 'noise' | 'preset' | 'composition' | 'trail' | 'water' | 'meteor';
    seed: number;
    algorithmVersion: 1 | 2 | 3 | 4 | 5 | 6;
    parameters: Record<string, number | boolean>;
}
export function deriveSeeds(seed: number): OperationSeeds {
    return { terrain: seed >>> 0, erosion: (Math.imul(seed, 7) + 13) >>> 0, scatter: (Math.imul(seed, 31) + 7) >>> 0, brush: (seed ^ 9001) >>> 0, composition: (seed ^ 0x63ac85e9) >>> 0 };
}
export const DEFAULT_WALK_SETTINGS: WalkSettings = {
    equippedLight: 'flashlight', lightEnabled: false,
    speed: 4.5, sprint: 2.2, swimSpeed: 1.6, eyeHeight: 1.7,
    gravity: 22, jumpSpeed: 7, sensitivity: 0.0022, fov: 70, bob: true,
};
export function createWorld(): WorldData {
    return { preset: null, landmarks: [], assets: [], objects: [], groups: [], viewpoints: [], biomes: [], routes: [], waterBodies: [{ id: 'ocean', kind: 'ocean', points: [], level: 16, opacity: 0.7, wave: 1, width: 1 }] };
}
