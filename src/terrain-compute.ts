import type {IronSettings} from './iron-settings';
import { fbm, makeSimplex, mulberry32, smoothstep } from './noise';
import { SIZE, type EditorState } from './state';
import {createCoastlineField} from './coastline';
import {smoothRelief} from './terrain-smoothing';
import {generationOctaveLimit,terrainSharpness} from './generation-settings';
import {createMountainField} from './mountain-field';
import {generateWorldTerrain} from './world-terrain';
import type {WorldPresetId} from './world';
import type {JungleSettings} from './jungle-settings';
import type {TaigaSettings} from './taiga-settings';
export type Progress = (fraction: number) => void;
export function generateHeightmap(s: EditorState, progress: Progress = () => {}, preset?:WorldPresetId,jungle?:JungleSettings,taiga?:TaigaSettings,iron?:IronSettings) {
    if(preset)return generateWorldTerrain(s,preset,progress,jungle,taiga,iron);
    const N = s.N, n = N + 1;
    const area = s.areaSize, cropped = area < 1;
    const coastline=s.island||cropped?createCoastlineField(s.seed):undefined;
    const nz = makeSimplex(s.seed), nzW = makeSimplex(s.seed + 101), nzM = makeSimplex(s.seed + 303);
    const H = new Float32Array(n * n),regions=new Float32Array(n*n),mountains=new Float32Array(n*n);
    const shores=coastline?new Float32Array(n*n):undefined,histogram=new Uint32Array(512);
    const baseF = 1.8 / s.scale;
    const octaves=Math.min(s.octaves,generationOctaveLimit(s)),sharp=terrainSharpness(s.sharp);
    const gain=sharp**.7;
    const mountainField=createMountainField(s.seed+202,sharp);
    let samples=0;
    for (let j = 0; j < n; j++) {
        if (j % 8 === 0) progress(j / n * .65);
        const v = (j / N - 0.5) / area;
        for (let i = 0; i < n; i++) {
            const u = (i / N - 0.5) / area;
            const x = u * baseF, y = v * baseF;
            // Macro shapes stay fixed when detail changes. Warp bends them at
            // large wavelengths instead of adding uncontrolled fine folds.
            const wx = fbm(nzW, x * .55 + 3.1, y * .55 + 7.7, 2), wy = fbm(nzW, x * .55 - 5.3, y * .55 + 1.9, 2);
            const px = x + s.warp * wx * .3, py = y + s.warp * wy * .3;
            const base = nz(px,py)*.5+.5;
            const cont = nzM(x*.35-7.7,y*.35+2.2)*.5+.5;
            const ridge=mountainField(px,py);
            let detail=0;
            // Fixed amplitudes: adding an octave adds detail without
            // renormalizing the existing mountains to a different height.
            for(let o=1;o<octaves;o++)detail+=nz(px*2**o+o*3.1,py*2**o-o*1.7)*.42**o;
            const k=j*n+i,region=Math.max(0,Math.min(1,nzM(x*.45+11.3,y*.45-4.1)*.5+.5));
            regions[k]=region;H[k]=.18*(.7*base+.3*cont)+.055*detail;
            mountains[k]=.82*ridge;
            if(shores)shores[k]=coastline!(u,v)*SIZE*area;
            if(!shores||shores[k]>0){histogram[Math.min(511,Math.floor(region*512))]++;samples++;}
        }
    }
    // A percentile of a separate regional field makes "mountain coverage"
    // describe area, independent of the seed's noise range or peak height.
    const target=(1-s.mountains)*samples;let count=0,threshold=0;
    for(let bin=0;bin<histogram.length;bin++){
        if(count+histogram[bin]>=target){threshold=(bin+(histogram[bin]?(target-count)/histogram[bin]:0))/512;break;}
        count+=histogram[bin];
    }
    for (let k = 0; k < H.length; k++) {
        const mask=s.mountains===0?0:s.mountains===1?1:smoothstep(threshold-.1,threshold+.1,regions[k]);
        H[k]=Math.max(0,Math.min(1,H[k]+mask*mountains[k]))*s.height*gain;
    }
    progress(.72);
    // Only the low/mid range is strongly rounded. At maximum sharpness a small
    // filter removes sampling noise while keeping pointed, steep ridges.
    const smoothingMetres=(8*(1-sharp)**1.6+1.4*sharp)*area;
    const result=smoothRelief(H,N,Math.max(.7-.4*sharp,smoothingMetres/(SIZE/N)));
    progress(.85);
    for(let k=0;k<result.length;k++){
        let height=s.water+3+result[k];
        if (shores) {
            const u = (k % n / N - 0.5) / area, v = (Math.floor(k / n) / N - 0.5) / area;
            const distance=shores[k];
            const seabed = s.water - Math.max(8, s.height * 0.08);
            if(distance>0){
                // A coastal transition, not a cap on every inland peak. With
                // zero relief the interior is an exactly flat dry plateau.
                const beach=Math.max(12*area,SIZE/N),inland=Math.max((48+Math.min(100,s.height*.35))*area,3*SIZE/N);
                height=s.water+3*smoothstep(0,beach,distance)+result[k]*smoothstep(beach,inland,distance);
            }else{
                const depth=s.water-seabed;
                height=s.water-depth*(1-Math.exp(distance*.22/depth));
            }
            const offshore=smoothstep(.46,.5,Math.hypot(u,v));
            height+=(seabed-height)*offshore;
        }
        result[k] = height;
    }
    progress(1);
    return result;
}
function buildErosionBrush(R: number) {
    const offs: number[] = [], ws: number[] = [];
    let sum = 0;
    for (let dy = -R; dy <= R; dy++)
        for (let dx = -R; dx <= R; dx++) {
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d < R) {
                const w = 1 - d / R;
                offs.push(dx, dy);
                ws.push(w);
                sum += w;
            }
        }
    return { offs: Int32Array.from(offs), ws: Float32Array.from(ws.map(w => w / sum)) };
}
function hydraulicChunk(map: Float32Array, count: number, rnd: () => number, brush: ReturnType<typeof buildErosionBrush>, eroS: number, N: number) {
    const n = N + 1;
    const inertia = 0.05, capF = 3, minCap = 0.01, depS = 0.3, evap = 0.012, grav = 4, maxLife = 40;
    const lim = N - 1;
    const offs = brush.offs, ws = brush.ws, bl = ws.length;
    for (let c = 0; c < count; c++) {
        let px = rnd() * lim, py = rnd() * lim, dirX = 0, dirY = 0, speed = 1, water = 1, sed = 0;
        for (let life = 0; life < maxLife; life++) {
            const nx = px | 0, ny = py | 0, u = px - nx, v = py - ny, k = ny * n + nx;
            const h00 = map[k], h10 = map[k + 1], h01 = map[k + n], h11 = map[k + n + 1];
            const gx = (h10 - h00) * (1 - v) + (h11 - h01) * v, gy = (h01 - h00) * (1 - u) + (h11 - h10) * u;
            const hOld = h00 * (1 - u) * (1 - v) + h10 * u * (1 - v) + h01 * (1 - u) * v + h11 * u * v;
            dirX = dirX * inertia - gx * (1 - inertia);
            dirY = dirY * inertia - gy * (1 - inertia);
            const len = Math.sqrt(dirX * dirX + dirY * dirY);
            if (len < 1e-9)
                break;
            dirX /= len;
            dirY /= len;
            px += dirX;
            py += dirY;
            if (px < 0 || px >= lim || py < 0 || py >= lim)
                break;
            const mx2 = px | 0, my2 = py | 0, u2 = px - mx2, v2 = py - my2, k2 = my2 * n + mx2;
            const hNew = map[k2] * (1 - u2) * (1 - v2) + map[k2 + 1] * u2 * (1 - v2) + map[k2 + n] * (1 - u2) * v2 + map[k2 + n + 1] * u2 * v2;
            const dH = hNew - hOld;
            const cap = Math.max(-dH * speed * water * capF, minCap);
            if (sed > cap || dH > 0) {
                const dep = dH > 0 ? Math.min(dH, sed) : (sed - cap) * depS;
                sed -= dep;
                map[k] += dep * (1 - u) * (1 - v);
                map[k + 1] += dep * u * (1 - v);
                map[k + n] += dep * (1 - u) * v;
                map[k + n + 1] += dep * u * v;
            }
            else {
                const ero = Math.min((cap - sed) * eroS, -dH);
                for (let b = 0; b < bl; b++) {
                    const xx = nx + offs[b * 2], yy = ny + offs[b * 2 + 1];
                    if (xx < 0 || yy < 0 || xx > N || yy > N)
                        continue;
                    const kk = yy * n + xx, we = ero * ws[b], dS = map[kk] < we ? map[kk] : we;
                    map[kk] -= dS;
                    sed += dS;
                }
            }
            speed = Math.sqrt(Math.max(0, speed * speed - dH * grav));
            water *= (1 - evap);
        }
    }
}
function thermalPass(map: Float32Array, talus: number, N: number) {
    const n = N + 1;
    const d8 = [1, 0, -1, 0, 0, 1, 0, -1, 1, 1, -1, -1, 1, -1, -1, 1];
    for (let j = 1; j < N; j++)
        for (let i = 1; i < N; i++) {
            const k = j * n + i, h = map[k];
            let best = -1, bestD = 0;
            for (let q = 0; q < 8; q++) {
                const kk = (j + d8[q * 2 + 1]) * n + (i + d8[q * 2]);
                const diff = (h - map[kk]) / (q < 4 ? 1 : 1.41421);
                if (diff > bestD) {
                    bestD = diff;
                    best = kk;
                }
            }
            if (best >= 0 && bestD > talus) {
                const mv = (bestD - talus) * 0.25;
                map[k] -= mv;
                map[best] += mv;
            }
        }
}
export function erodeHeightmap(settings: EditorState, seed: number, heights: Float32Array, progress: Progress = () => {}) {
    const N = settings.N;
    let base = Infinity, max = -Infinity;
    for (const height of heights) { base = Math.min(base, height); max = Math.max(max, height); }
    const hs = Math.max(max - base, 1), map = new Float32Array(heights.length);
    for (let i = 0; i < map.length; i++) map[i] = (heights[i] - base) / hs;
    const total = erosionDroplets(settings);
    const rnd = mulberry32(seed), brush = buildErosionBrush(N > 256 ? 4 : 3);
    let done = 0;
    while (done < total) {
        const count = Math.min(6000, total - done);
        hydraulicChunk(map, count, rnd, brush, settings.erosionStrength, N);
        done += count; progress(done / total * 0.85);
    }
    const talus = Math.tan(45 * Math.PI / 180) * (SIZE / N) / hs;
    for (let pass = 0; pass < settings.thermal; pass++) {
        thermalPass(map, talus, N); progress(0.85 + 0.15 * (pass + 1) / settings.thermal);
    }
    for (let i = 0; i < map.length; i++) map[i] = map[i] * hs + base;
    progress(1); return map;
}
export function erosionDroplets(settings: EditorState) {
    return Math.round(settings.droplets * 1000 * (settings.N / 256) ** 2 / (settings.N > 256 ? 2 : 1));
}
