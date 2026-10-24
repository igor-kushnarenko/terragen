import { clamp } from './noise';

export const SKY_FOG_HEIGHT = 90;
export const SKY_FOG_MIN_ELEVATION = .005;
export const CLOUD_ALTITUDE = 750;
export const ATMOSPHERE_RADIUS = 6_371_000;

/** Longer optical paths towards the horizon, without a separate density threshold. */
export function skyFogAmount(density: number, directionY: number) {
    const path = SKY_FOG_HEIGHT / Math.max(SKY_FOG_MIN_ELEVATION, directionY);
    return 1 - Math.exp(-(Math.max(0, density) ** 2) * path ** 2);
}

/** Positive ray/spherical-cloud-layer intersection, also valid above the clouds. */
export function cloudLayerDistance(height: number, directionY: number) {
    const b = (ATMOSPHERE_RADIUS + height) * directionY;
    const c = (height - CLOUD_ALTITUDE) * (2 * ATMOSPHERE_RADIUS + height + CLOUD_ALTITUDE);
    const discriminant = b * b - c;
    if (discriminant < 0) return null;
    const root = Math.sqrt(discriminant), far = -b + root;
    if (far <= 0) return null;
    // Avoid subtracting almost equal values when looking up from ground level.
    return c <= 0 ? (b > 0 ? -c / (b + root) : far) : c / far;
}

export function weatherStrengths(baseFog: number, weatherFog: number, rain: number, snow: number, precipitation: number, fogIntensity: number) {
    const strength = clamp(precipitation, 0, 2);
    const fogStrength = clamp(fogIntensity, 0, 2);
    const normalFog = (Math.max(baseFog, weatherFog) + weatherFog * 0.15) * fogStrength;
    // Keep 0–100% unchanged. Above 100%, smoothly approach dense local fog
    // independently of the weather preset. FogExp2 leaves <1% contrast at 4 m.
    const denseBlend = Math.pow(Math.max(0, fogStrength - 1), 3);
    return {
        fog: normalFog + (0.55 - normalFog) * denseBlend,
        rain: clamp(rain, 0, 1) * strength,
        snow: clamp(snow, 0, 1) * strength,
    };
}
