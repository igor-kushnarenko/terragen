import * as THREE from 'three';
import type { MaterialsSystem } from './materials';
import { clamp, fbm, makeSimplex } from './noise';
import { recordOperation } from './operations';
import { HALF, SIZE, SPLAT_RES, type EditorModel } from './state';
import type { TerrainSystem } from './terrain';
import type { VegetationSystem } from './vegetation';
export function createBrush(model: EditorModel, terrain: TerrainSystem, materials: MaterialsSystem, vegetation: VegetationSystem) {
    const interaction = { mouseInside: false, painting: false, flattenH: 0, hoverHit: null as THREE.Vector3 | null, strokeDirty: false, texTimer: 0 };
    const BRUSH_COLORS = { raise: [1, 0.75, 0.2], lower: [0.3, 0.7, 1], smooth: [0.5, 1, 0.5], flatten: [1, 0.5, 1], noise: [1, 0.4, 0.3], paint: [1, 1, 1], camera: [1, 1, 1] };
    const LAYER_COLORS = [[0.4, 1, 0.3], [0.75, 0.7, 0.65], [1, 0.9, 0.5], [0.85, 0.95, 1], [1, 0.3, 0.3], [0.5, 0.3, 0.1], [0.6, 0.4, 0.2], [0.65, 0.65, 0.6], [0.25, 0.6, 0.2]];
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    let noiseSeed = model.seeds.brush, noiseBrush = makeSimplex(noiseSeed);
    let onStrokeEnd = () => { };
    function brushWeight(t: number) {
        const inner = 1 - model.state.falloff;
        if (t <= inner)
            return 1;
        const x = (t - inner) / (1 - inner + 1e-6);
        return 1 - x * x * (3 - 2 * x);
    }
    function applyBrush(hit: THREE.Vector3, dt: number) {
        if (model.busy)
            return;
        if (model.seeds.brush !== noiseSeed) {
            noiseSeed = model.seeds.brush;
            noiseBrush = makeSimplex(noiseSeed);
        }
        const tool = model.state.tool, r = model.state.radius, st = model.state.strength;
        if (tool === 'paint')
            return paintSplat(hit, dt);
        if (tool === 'camera')
            return;
        const i0 = Math.max(0, Math.floor((hit.x - r + HALF) / model.cell)), i1 = Math.min(model.N, Math.ceil((hit.x + r + HALF) / model.cell));
        const j0 = Math.max(0, Math.floor((hit.z - r + HALF) / model.cell)), j1 = Math.min(model.N, Math.ceil((hit.z + r + HALF) / model.cell));
        if (i0 > i1 || j0 > j1)
            return;
        let src: Float32Array | null = null, sw = 0;
        if (tool === 'smooth') { // копия области: сглаживание без направленного смещения
            sw = i1 - i0 + 3;
            src = new Float32Array(sw * (j1 - j0 + 3));
            for (let j = j0 - 1; j <= j1 + 1; j++)
                for (let i = i0 - 1; i <= i1 + 1; i++)
                    src[(j - j0 + 1) * sw + (i - i0 + 1)] = model.heights[clamp(j, 0, model.N) * model.n + clamp(i, 0, model.N)];
        }
        const rate = st * dt;
        if (tool === 'noise')
            recordOperation(model, 'noise', noiseSeed, { x: hit.x, z: hit.z, dt, radius: r, strength: st, falloff: model.state.falloff, N: model.N });
        for (let j = j0; j <= j1; j++) {
            const z = -HALF + j * model.cell;
            for (let i = i0; i <= i1; i++) {
                const x = -HALF + i * model.cell;
                const d = Math.hypot(x - hit.x, z - hit.z);
                if (d > r)
                    continue;
                const w = brushWeight(d / r), k = j * model.n + i;
                switch (tool) {
                    case 'raise':
                        model.heights[k] += rate * 45 * w;
                        break;
                    case 'lower':
                        model.heights[k] -= rate * 45 * w;
                        break;
                    case 'smooth': {
                        const a = (j - j0 + 1) * sw + (i - i0 + 1);
                        if (!src)
                            break;
                        const avg = (src[a] * 4 + src[a - 1] * 2 + src[a + 1] * 2 + src[a - sw] * 2 + src[a + sw] * 2 + src[a - sw - 1] + src[a - sw + 1] + src[a + sw - 1] + src[a + sw + 1]) / 16;
                        model.heights[k] += (avg - model.heights[k]) * clamp(rate * 12 * w, 0, 1);
                        break;
                    }
                    case 'flatten':
                        model.heights[k] += (interaction.flattenH - model.heights[k]) * clamp(rate * 6 * w, 0, 1);
                        break;
                    case 'noise': {
                        const f = 6 / r;
                        const nv = fbm(noiseBrush, x * f, z * f, 3) + 0.5 * fbm(noiseBrush, x * f * 4 + 7, z * f * 4, 2);
                        model.heights[k] += nv * rate * 40 * w;
                        break;
                    }
                }
                if (model.heights[k] > model.maxH)
                    model.maxH = model.heights[k];
                if (model.heights[k] < model.minH)
                    model.minH = model.heights[k];
            }
        }
        terrain.updateMeshRect(i0, j0, i1, j1);
        interaction.strokeDirty = true;
    }
    function paintSplat(hit: THREE.Vector3, dt: number) {
        const r = model.state.radius, tx = SIZE / SPLAT_RES, layer = model.state.layer, amt = model.state.strength * dt * 4;
        const i0 = Math.max(0, Math.floor((hit.x - r + HALF) / tx)), i1 = Math.min(SPLAT_RES - 1, Math.ceil((hit.x + r + HALF) / tx));
        const j0 = Math.max(0, Math.floor((hit.z - r + HALF) / tx)), j1 = Math.min(SPLAT_RES - 1, Math.ceil((hit.z + r + HALF) / tx));
        const v = new Array<number>(8).fill(0), selected = layer > 4 ? layer - 1 : layer;
        for (let j = j0; j <= j1; j++)
            for (let i = i0; i <= i1; i++) {
                const x = -HALF + (i + 0.5) * tx, z = -HALF + (j + 0.5) * tx;
                const d = Math.hypot(x - hit.x, z - hit.z);
                if (d > r)
                    continue;
                const a = clamp(amt * brushWeight(d / r), 0, 1), k = (j * SPLAT_RES + i) * 4;
                for (let c = 0; c < 8; c++)
                    v[c] = (c < 4 ? model.splat[k + c] : model.splatDetail[k + c - 4]) / 255;
                if (layer === 4) {
                    for (let c = 0; c < 8; c++)
                        v[c] *= (1 - a);
                }
                else {
                    v[selected] += a * (1 - v[selected]);
                    let others = 0;
                    for (let c = 0; c < 8; c++)
                        if (c !== selected)
                            others += v[c];
                    const room = 1 - v[selected];
                    if (others > room && others > 0) {
                        const f = room / others;
                        for (let c = 0; c < 8; c++)
                            if (c !== selected)
                                v[c] *= f;
                    }
                }
                for (let c = 0; c < 8; c++)
                    (c < 4 ? model.splat : model.splatDetail)[k + (c % 4)] = Math.round(clamp(v[c], 0, 1) * 255);
            }
        materials.splatTex.needsUpdate = true; materials.detailTex.needsUpdate = true;
    }
    function endStroke() {
        if (!interaction.painting)
            return;
        interaction.painting = false;
        if (interaction.strokeDirty) {
            terrain.recomputeRange();
            terrain.updateHeightTex();
            vegetation.snapScatter();
            interaction.strokeDirty = false;
        }
        onStrokeEnd();
    }
    return { interaction, raycaster, mouse, applyBrush, endStroke, BRUSH_COLORS, LAYER_COLORS, bindEndStroke(callback: () => void) { onStrokeEnd = callback; } };
}
export type BrushSystem = ReturnType<typeof createBrush>;
