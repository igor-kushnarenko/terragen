import * as THREE from 'three';
import type { MaterialsSystem } from './materials';
import { clamp } from './noise';
import type { RenderingSystem } from './rendering';
import { HALF, SIZE, type EditorModel } from './state';
import { createTerrainChunks, type TerrainChunks } from './terrain-chunks';
export function createTerrain(model: EditorModel, render: Pick<RenderingSystem, 'scene'>, materials: MaterialsSystem) {
    let geo: THREE.BufferGeometry;
    let terrain: THREE.Mesh;
    let chunks: TerrainChunks | undefined;
    let heightTex: THREE.DataTexture | null = null;
    let heightHalf: Uint16Array;
    let physicsHeights:Float32Array;
    function buildTerrain() {
        model.terrainRevision++;
        model.n = model.N + 1;
        model.cell = SIZE / model.N;
        physicsHeights=new Float32Array(model.n*model.n);
        if (terrain) {
            render.scene.remove(terrain);
            chunks?.dispose();
            geo.dispose();
        }
        geo = new THREE.BufferGeometry();
        const pos = new Float32Array(model.n * model.n * 3), nor = new Float32Array(model.n * model.n * 3);
        for (let j = 0; j < model.n; j++)
            for (let i = 0; i < model.n; i++) {
                const k = (j * model.n + i) * 3;
                pos[k] = -HALF + i * model.cell;
                pos[k + 1] = 0;
                pos[k + 2] = -HALF + j * model.cell;
                nor[k + 1] = 1;
            }
        const idx = new Uint32Array(model.N * model.N * 6);
        let q = 0;
        for (let j = 0; j < model.N; j++)
            for (let i = 0; i < model.N; i++) {
                const a = j * model.n + i, b = (j + 1) * model.n + i, c = j * model.n + i + 1, d = (j + 1) * model.n + i + 1;
                idx[q++] = a;
                idx[q++] = b;
                idx[q++] = c;
                idx[q++] = b;
                idx[q++] = d;
                idx[q++] = c;
            }
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
        geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3).setUsage(THREE.DynamicDrawUsage));
        geo.setIndex(new THREE.BufferAttribute(idx, 1));
        geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), SIZE);
        geo.boundingBox = new THREE.Box3(new THREE.Vector3(-HALF, -500, -HALF), new THREE.Vector3(HALF, 1500, HALF));
        terrain = new THREE.Mesh(geo, materials.terrainMat);
        terrain.castShadow = true;
        terrain.receiveShadow = true;
        // Full-resolution geometry stays authoritative for physics, export and editing.
        // Rendering uses separate stitched LOD chunks.
        chunks = createTerrainChunks(model,render.scene,materials.terrainMat,geo);
        // текстура высот для шейдера воды (half float — фильтруемая в WebGL2)
        if (heightTex)
            heightTex.dispose();
        heightHalf = new Uint16Array(model.n * model.n);
        heightTex = new THREE.DataTexture(heightHalf, model.n, model.n, THREE.RedFormat, THREE.HalfFloatType);
        heightTex.magFilter = THREE.LinearFilter;
        heightTex.minFilter = THREE.LinearFilter;
        heightTex.needsUpdate = true;
        if (materials.waterMat) {
            materials.waterMat.uniforms.uHeight.value = heightTex;
            materials.waterMat.uniforms.uN.value = model.N;
        }
        if (model.heights.length !== model.n * model.n)
            model.heights = new Float32Array(model.n * model.n);
    }
    function setRange(attr: THREE.BufferAttribute, start: number, count: number) {
        if (attr.addUpdateRange) {
            attr.clearUpdateRanges();
            attr.addUpdateRange(start, count);
        }
        attr.needsUpdate = true;
    }
    // Обновить вершины/нормали в прямоугольнике [i0..i1]x[j0..j1]
    function updateMeshRect(i0: number, j0: number, i1: number, j1: number) {
        model.terrainRevision++;
        i0 = clamp(i0 - 1, 0, model.N);
        j0 = clamp(j0 - 1, 0, model.N);
        i1 = clamp(i1 + 1, 0, model.N);
        j1 = clamp(j1 + 1, 0, model.N);
        const pos = geo.attributes.position.array, nor = geo.attributes.normal.array;
        for (let j = j0; j <= j1; j++) {
            const jm = j > 0 ? j - 1 : 0, jp = j < model.N ? j + 1 : model.N;
            for (let i = i0; i <= i1; i++) {
                const k = j * model.n + i;
                pos[k * 3 + 1] = model.heights[k];
                // Rapier's structured heightfield stores z rows inside x columns.
                physicsHeights[i*model.n+j]=model.heights[k];
                const im = i > 0 ? i - 1 : 0, ip = i < model.N ? i + 1 : model.N;
                const dx = (model.heights[j * model.n + ip] - model.heights[j * model.n + im]) / ((ip - im) * model.cell);
                const dz = (model.heights[jp * model.n + i] - model.heights[jm * model.n + i]) / ((jp - jm) * model.cell);
                const l = 1 / Math.sqrt(dx * dx + 1 + dz * dz);
                nor[k * 3] = -dx * l;
                nor[k * 3 + 1] = l;
                nor[k * 3 + 2] = -dz * l;
            }
        }
        const start = j0 * model.n * 3, count = (j1 - j0 + 1) * model.n * 3;
        setRange(geo.attributes.position as THREE.BufferAttribute, start, count);
        setRange(geo.attributes.normal as THREE.BufferAttribute, start, count);
        chunks?.update(i0,j0,i1,j1);
    }
    function recomputeRange() {
        let mn = Infinity, mx = -Infinity;
        for (let i = 0; i < model.heights.length; i++) {
            const h = model.heights[i];
            if (h < mn)
                mn = h;
            if (h > mx)
                mx = h;
        }
        model.minH = mn;
        model.maxH = mx;
        if (geo) {
            geo.boundingBox = new THREE.Box3(new THREE.Vector3(-HALF, mn, -HALF), new THREE.Vector3(HALF, mx, HALF));
            geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, (mn + mx) / 2, 0), Math.hypot(HALF, HALF, (mx - mn) / 2));
        }
    }
    function updateMeshAll() { updateMeshRect(0, 0, model.N, model.N); recomputeRange(); updateHeightTex(); }
    function updateHeightTex() {
        const toHalf = THREE.DataUtils.toHalfFloat;
        for (let i = 0; i < model.heights.length; i++)
            heightHalf[i] = toHalf(clamp(model.heights[i], -60000, 60000));
        if (heightTex)
            heightTex.needsUpdate = true;
    }
    // Билинейная выборка высоты в мировых координатах
    function getH(x: number, z: number) {
        let fx = (x + HALF) / model.cell, fz = (z + HALF) / model.cell;
        fx = clamp(fx, 0, model.N - 1e-4);
        fz = clamp(fz, 0, model.N - 1e-4);
        const i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j, k = j * model.n + i;
        const a = model.heights[k], b = model.heights[k + 1], c = model.heights[k + model.n], d = model.heights[k + model.n + 1];
        return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
    }
    // Exact height of the two triangles used by the terrain mesh and Rapier.
    function getSurfaceH(x: number, z: number) {
        const fx=clamp((x+HALF)/model.cell,0,model.N),fz=clamp((z+HALF)/model.cell,0,model.N);
        const i=Math.min(Math.floor(fx),model.N-1),j=Math.min(Math.floor(fz),model.N-1),tx=fx-i,tz=fz-j,k=j*model.n+i;
        const a=model.heights[k],b=model.heights[k+1],c=model.heights[k+model.n],d=model.heights[k+model.n+1];
        return tx+tz<=1 ? a+(b-a)*tx+(c-a)*tz : d+(c-d)*(1-tx)+(b-d)*(1-tz);
    }
    function getNormalY(x: number, z: number) { const e = model.cell; const dx = (getH(x + e, z) - getH(x - e, z)) / (2 * e), dz = (getH(x, z + e) - getH(x, z - e)) / (2 * e); return 1 / Math.sqrt(dx * dx + 1 + dz * dz); }
    // Пересечение луча с картой высот (ray-march + бисекция): быстрее Raycaster по 130k+ треугольникам
    function raycastTerrain(ray: THREE.Ray) {
        const o = ray.origin, d = ray.direction;
        const top = model.maxH + 2;
        let t = 0;
        if (o.y > top) {
            if (d.y >= 0)
                return null;
            t = (o.y - top) / -d.y;
        }
        const tMax = 8000;
        let prevT = t;
        for (let it = 0; it < 3000 && t < tMax; it++) {
            const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
            const inside = x >= -HALF && x <= HALF && z >= -HALF && z <= HALF;
            if (!inside) {
                if ((x < -HALF && d.x < 0) || (x > HALF && d.x > 0) || (z < -HALF && d.z < 0) || (z > HALF && d.z > 0))
                    return null;
            }
            else {
                const h = getSurfaceH(x, z);
                if (y <= h) {
                    let a = prevT, b = t;
                    for (let k = 0; k < 14; k++) {
                        const m = (a + b) * 0.5;
                        const px = o.x + d.x * m, pz = o.z + d.z * m;
                        if (o.y + d.y * m <= getSurfaceH(px, pz))
                            b = m;
                        else
                            a = m;
                    }
                    return new THREE.Vector3(o.x + d.x * b, o.y + d.y * b, o.z + d.z * b);
                }
                if (y > top && d.y >= 0)
                    return null;
            }
            prevT = t;
            const above = inside ? (y - getSurfaceH(x, z)) : 5;
            t += clamp(above * 0.45, 0.25, model.cell * 3);
        }
        return null;
    }
    return { buildTerrain, updateMeshAll, updateMeshRect, updateHeightTex, recomputeRange, getH, getSurfaceH, getNormalY, raycastTerrain,
        updateView(camera: THREE.Camera, brush: THREE.Vector3 | null = null,viewportHeight=720) { chunks?.updateView(camera,brush,viewportHeight); },
        get chunks() { return chunks?.chunks ?? []; }, get statistics(){ return chunks?.statistics; },
        get geo() { return geo; }, get physicsHeights(){return physicsHeights;},get terrain() { return terrain; }, get heightTex() { return heightTex; } };
}
export type TerrainSystem = ReturnType<typeof createTerrain>;
