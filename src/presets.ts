import type { EditorState } from './state';
import type { LegacyPresetId } from './world';

export const LANDSCAPE_PRESETS: Record<LegacyPresetId, { name: string; description: string; settings: Partial<EditorState>; trees: number[] }> = {
    forest: { name: 'Лес', description: 'Мягкие холмы, лесная подстилка, смешанный лес, влажные поляны и тёплый рассеянный свет.',
        settings: { height: 110, scale: 1.4, mountains: 0.25, sharp: 1.2, warp: 0.35, island: false, water: 5, snowLine: 260, rockSlope: 0.4, treeDensity: 0.45, rockDensity: 0.12, soilMoisture: 0.78, clearingAmount: 0.3, foliageDensity: 0.8, sunEl: 32, sunAz: 135, fog: 0.3, weather: 'partly', windSpeed: 0.35, wave: 0.4, exposure: 0.6 }, trees: [0.5, 0.7, 1.2, 1.1] },
    coast: { name: 'Побережье', description: 'Остров с широкими пляжами, песком, прибрежными скалами и редкими соснами.',
        settings: { height: 90, scale: 1.8, mountains: 0.2, sharp: 1.1, warp: 0.3, island: true, water: 18, snowLine: 260, rockSlope: 0.27, treeDensity: 0.12, rockDensity: 0.25, soilMoisture: 0.3, clearingAmount: 0.55, foliageDensity: 0.45, sunEl: 24, sunAz: 220, fog: 0.15, weather: 'clear', windSpeed: 0.8, wave: 1.3, exposure: 0.6 }, trees: [1.7, 0.15, 0.25, 0.5] },
    mountains: { name: 'Горы', description: 'Скалистые хребты, снег на вершинах, хвойные леса ниже и прохладная атмосфера.',
        settings: { height: 230, scale: 1.1, mountains: 0.8, sharp: 4.2, warp: 0.45, island: false, water: 3, snowLine: 160, rockSlope: 0.24, treeDensity: 0.22, rockDensity: 0.5, soilMoisture: 0.42, clearingAmount: 0.4, foliageDensity: 0.45, sunEl: 30, sunAz: 160, fog: 0.25, weather: 'partly', windSpeed: 0.7, wave: 0.3, exposure: 0.55 }, trees: [1.1, 1.6, 0.2, 0.1] },
    valley: { name: 'Долины', description: 'Плавный рельеф, луговые долины, цветы, берёзовые рощи и спокойный утренний свет.',
        settings: { height: 100, scale: 1.8, mountains: 0.3, sharp: 1.3, warp: 0.3, island: false, water: 4, snowLine: 240, rockSlope: 0.38, treeDensity: 0.2, rockDensity: 0.1, soilMoisture: 0.65, clearingAmount: 0.7, foliageDensity: 0.9, sunEl: 20, sunAz: 115, fog: 0.3, weather: 'clear', windSpeed: 0.25, wave: 0.3, exposure: 0.62 }, trees: [0.3, 0.25, 1.5, 1.0] },
};
export const BIOME_TREES = { forest: LANDSCAPE_PRESETS.forest.trees, coast: LANDSCAPE_PRESETS.coast.trees,
    mountains: LANDSCAPE_PRESETS.mountains.trees, valley: LANDSCAPE_PRESETS.valley.trees, meadow: [0.4, 0.2, 1, 1], jungle:[.1,.1,.2,2] };
