import type { EditorModel } from './state';
export const QUALITY_PROFILES = {
    low: { name: 'Экономный', pixelRatio: 0.75, surfaceOctaves: 1, shadowSize: 0, shadowRadius: 150, terrainDistances: [65, 150] as const, objectDistances: [75, 190] as const, foliageDistance: 25, foliageDensity: 0.5, contact: 0, groundDetail: 0.5 },
    balanced: { name: 'Сбалансированный', pixelRatio: 1.25, surfaceOctaves: 2, shadowSize: 2048, shadowRadius: 110, terrainDistances: [100, 280] as const, objectDistances: [130, 320] as const, foliageDistance: 50, foliageDensity: 0.85, contact: 1, groundDetail: 1 },
    high: { name: 'Высокий', pixelRatio: 1.75, surfaceOctaves: 4, shadowSize: 4096, shadowRadius: 80, terrainDistances: [160, 400] as const, objectDistances: [190, 440] as const, foliageDistance: 80, foliageDensity: 1, contact: 1, groundDetail: 1 },
} as const;
export type QualityId = keyof typeof QUALITY_PROFILES;
export const WATER_PROFILES = {
    low:{reflectionSize:0,reflectionInterval:1,detail:0,foam:.45,refractionScale:.35,oceanSegments:64,spacing:6,impacts:8,rainRate:3},
    balanced:{reflectionSize:256,reflectionInterval:.08,detail:1,foam:.8,refractionScale:.5,oceanSegments:96,spacing:3,impacts:16,rainRate:8},
    high:{reflectionSize:512,reflectionInterval:.04,detail:2,foam:1,refractionScale:.75,oceanSegments:128,spacing:2,impacts:24,rainRate:14},
} as const;
export function qualityProfile(model: EditorModel) { return QUALITY_PROFILES[model.state.quality]; }
export function chooseLOD(distance: number, current: number, thresholds: readonly [number, number], hysteresis = 0.12) {
    if (current === 0 && distance < thresholds[0] * (1 + hysteresis)) return 0;
    if (current === 1 && distance >= thresholds[0] * (1 - hysteresis) && distance < thresholds[1] * (1 + hysteresis)) return 1;
    if (current === 2 && distance >= thresholds[1] * (1 - hysteresis)) return 2;
    return distance < thresholds[0] ? 0 : distance < thresholds[1] ? 1 : 2;
}
