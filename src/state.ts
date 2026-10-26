import type {GraphicFilter} from './graphic-filters';
import { createWorld, DEFAULT_WALK_SETTINGS, deriveSeeds, type OperationRecord } from './world';
import type { QualityId, VRQualityId } from './quality';
import type {BalloonState} from './balloon-state';
export const SIZE = 1024;
export const RESOLUTIONS = [16, 32, 64, 128, 256, 512] as const;
export const HALF = SIZE / 2;
export const SPLAT_RES = 512;
export const UNDO_LIMIT = 30;
export type ToolId = 'camera' | 'raise' | 'lower' | 'smooth' | 'flatten' | 'noise' | 'paint';
export type WeatherId = 'clear' | 'partly' | 'overcast' | 'fog' | 'rain' | 'storm' | 'snow';
export const TOOLS: [
    ToolId,
    string
][] = [['camera', 'Камера'], ['raise', 'Поднять'], ['lower', 'Опустить'], ['smooth', 'Сгладить'], ['flatten', 'Выровнять'], ['noise', 'Шум'], ['paint', 'Текстура']];
export interface EditorState {
    N: number;
    seed: number;
    scale: number;
    height: number;
    octaves: number;
    sharp: number;
    warp: number;
    mountains: number;
    island: boolean;
    areaSize: number;
    droplets: number;
    thermal: number;
    erosionStrength: number;
    tool: ToolId;
    layer: number;
    radius: number;
    strength: number;
    falloff: number;
    snowLine: number;
    rockSlope: number;
    water: number;
    waterOpacity: number;
    waterReflections: boolean;
    wave: number;
    sunAz: number;
    sunEl: number;
    dayTime: number;
    dayCycle: boolean;
    dayDuration: number;
    lowFog: number;
    wetness: number;
    fog: number;
    shadows: boolean;
    treeDensity: number;
    rockDensity: number;
    showScatter: boolean;
    fly: boolean;
    weather: WeatherId;
    precipitation: number;
    fogIntensity: number;
    windDir: number;
    windSpeed: number;
    groundDetail: number;
    foliageDensity: number;
    foliageDistance: number;
    showFoliage: boolean;
    soilMoisture: number;
    clearingAmount: number;
    quality: QualityId;
    exposure: number;
    graphicFilter: GraphicFilter;
    filterIntensity:number;
    filmGrain:boolean;
    contactAO: number;
    soundEnabled: boolean;
    soundVolume: number;
    ambienceVolume: number;
    footstepVolume: number;
}
export interface EditorActions {
    generateAll(skipUndo?: boolean, prepare?: () => void): Promise<boolean> | void;
    applyAll(): void;
}
export function createModel() {
    const state: EditorState = {
        N: 256, seed: 1337, scale: 1, height: 170, octaves: 5, sharp: 2.5, warp: 0.6, mountains: 0.55, island: true, areaSize: 1,
        droplets: 200, thermal: 15, erosionStrength: 0.12,
        tool: 'raise', layer: 0, radius: 40, strength: 0.5, falloff: 0.6,
        snowLine: 118, rockSlope: 0.32, water: 16, waterOpacity: 0.7, waterReflections: true, wave: 1,
        sunAz: 140, sunEl: 28, dayTime: 10, dayCycle: false, dayDuration: 20, lowFog: .5, wetness: 0, fog: 0.35, shadows: true,
        treeDensity: 0.45, rockDensity: 0.4, showScatter: true, fly: true,
        weather: 'clear', precipitation: 1, fogIntensity: 1, windDir: 45, windSpeed: 0.5, groundDetail: 1, foliageDensity: 0.65, foliageDistance: 45, showFoliage: true,
        soilMoisture: 0.55, clearingAmount: 0.4, quality: 'balanced', graphicFilter:'none', filterIntensity:1, filmGrain:true, exposure: 0.55, contactAO: 0.3,
        soundEnabled: true, soundVolume: 0.65, ambienceVolume: 0.75, footstepVolume: 0.8,
    };
    return {
        state, N: state.N, n: state.N + 1, cell: SIZE / state.N,
        heights: new Float32Array((state.N + 1) ** 2),
        splat: new Uint8Array(SPLAT_RES * SPLAT_RES * 4),
        splatDetail: new Uint8Array(SPLAT_RES * SPLAT_RES * 4),
        terrainRevision: 0,
        // Session-only: never changes the world's saved graphics preferences.
        xrActive: false,
        xrQuality: 'economy' as VRQualityId,
        world: createWorld(), seeds: deriveSeeds(state.seed),
        operations: [] as OperationRecord[], walkSettings: { ...DEFAULT_WALK_SETTINGS },balloon:null as BalloonState|null,
        maxH: 1, minH: 0, busy: false,
    };
}
export type EditorModel = ReturnType<typeof createModel>;
