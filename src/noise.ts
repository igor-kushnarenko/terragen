export function mulberry32(a: number) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;
const GX = [1, -1, 1, -1, 1, -1, 0, 0], GY = [1, 1, -1, -1, 0, 0, 1, -1];
export function makeSimplex(seed: number) {
    const rnd = mulberry32(seed >>> 0);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++)
        p[i] = i;
    for (let i = 255; i > 0; i--) {
        const j = (rnd() * (i + 1)) | 0;
        const t = p[i];
        p[i] = p[j];
        p[j] = t;
    }
    const perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++)
        perm[i] = p[i & 255];
    return function (x: number, y: number) {
        const s = (x + y) * F2;
        const i = Math.floor(x + s), j = Math.floor(y + s);
        const t = (i + j) * G2;
        const x0 = x - (i - t), y0 = y - (j - t);
        const i1 = x0 > y0 ? 1 : 0, j1 = 1 - i1;
        const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2, x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
        const ii = i & 255, jj = j & 255;
        let n0 = 0, n1 = 0, n2 = 0;
        let t0 = 0.5 - x0 * x0 - y0 * y0;
        if (t0 > 0) {
            const g = perm[ii + perm[jj]] & 7;
            t0 *= t0;
            n0 = t0 * t0 * (GX[g] * x0 + GY[g] * y0);
        }
        let t1 = 0.5 - x1 * x1 - y1 * y1;
        if (t1 > 0) {
            const g = perm[ii + i1 + perm[jj + j1]] & 7;
            t1 *= t1;
            n1 = t1 * t1 * (GX[g] * x1 + GY[g] * y1);
        }
        let t2 = 0.5 - x2 * x2 - y2 * y2;
        if (t2 > 0) {
            const g = perm[ii + 1 + perm[jj + 1]] & 7;
            t2 *= t2;
            n2 = t2 * t2 * (GX[g] * x2 + GY[g] * y2);
        }
        return 70 * (n0 + n1 + n2);
    };
}
export function fbm(nz: (x: number, y: number) => number, x: number, y: number, oct: number) {
    let s = 0, a = 0.5, f = 1, norm = 0;
    for (let o = 0; o < oct; o++) {
        s += a * nz(x * f, y * f);
        norm += a;
        a *= 0.5;
        f *= 2.0;
    }
    return s / norm;
}
export function ridged(nz: (x: number, y: number) => number, x: number, y: number, oct: number, sharp: number) {
    let s = 0, a = 1, f = 1, norm = 0;
    // A differentiable crest has a rounded summit. abs(noise) had a cusp at
    // every zero crossing; multiplying successive octaves made these into needles.
    const t=Math.min(1,Math.max(0,sharp/5));
    const rounding = .008+.192*(1-t)**2, range = Math.sqrt(1 + rounding * rounding) - rounding;
    const exponent = .8 + 4.8*t*t;
    for (let o = 0; o < oct; o++) {
        const noise = nz(x * f + o * 3.7, y * f - o * 1.3);
        const r = Math.pow(Math.max(0, 1 - (Math.sqrt(noise * noise + rounding * rounding) - rounding) / range), exponent);
        s += r * a;
        norm += a;
        a *= 0.32;
        f *= 2;
    }
    return s / norm;
}
export const smoothstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const clamp = (x: number, a: number, b: number) => x < a ? a : x > b ? b : x;
