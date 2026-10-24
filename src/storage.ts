import { prepareModelAssets,importModel,modelEntries } from './model-library';
import {createAssetVault,describeAsset,type AssetVault} from './asset-vault';
import {buildProjectPackage,readProjectPackage} from './project-package';
import type {ModelAsset} from './world';
interface HeightmapMetadata {
    minH: number;
    maxH: number;
    size: number;
    water: number;
}
interface DecodedHeightmap {
    w: number;
    h: number;
    vals: Float32Array;
    meta: HeightmapMetadata | null;
    bits: number;
}
import * as THREE from 'three';
import type { Feedback } from './feedback';
import type { HistorySystem } from './history';
import type { MaterialsSystem } from './materials';
import { applyDocument, decodeProject, encodeProject, PROJECT_VERSION,validateWorld, type ProjectView,type DecodedProject } from './project';
import { SIZE, type EditorActions, type EditorModel } from './state';
import type { TerrainSystem } from './terrain';
import type { VegetationSystem } from './vegetation';
export function createStorage(model: EditorModel, terrain: TerrainSystem, feedback: Feedback, history: HistorySystem, materials: MaterialsSystem, vegetation: VegetationSystem, render: {
    camera: THREE.Camera;
    controls: {
        target: THREE.Vector3;
    };
}, actions: EditorActions,vault:AssetVault=createAssetVault()) {
    const CRC_TABLE = (() => {
        const t = new Uint32Array(256);
        for (let i = 0; i < 256; i++) {
            let c = i;
            for (let k = 0; k < 8; k++)
                c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
            t[i] = c >>> 0;
        }
        return t;
    })();
    function crc32(bytes: Uint8Array) {
        let c = 0xFFFFFFFF;
        for (let i = 0; i < bytes.length; i++)
            c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
        return (c ^ 0xFFFFFFFF) >>> 0;
    }
    async function zlibDeflate(data: Uint8Array<ArrayBuffer>) { return new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer()); }
    async function zlibInflate(data: Uint8Array<ArrayBuffer>) { return new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer()); }
    function pngChunk(type: string, data: Uint8Array) {
        const out = new Uint8Array(12 + data.length);
        const dv = new DataView(out.buffer);
        dv.setUint32(0, data.length);
        for (let i = 0; i < 4; i++)
            out[4 + i] = type.charCodeAt(i);
        out.set(data, 8);
        dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
        return out;
    }
    async function encodePNG16() {
        terrain.recomputeRange();
        const w = model.n, h = model.n, raw = new Uint8Array(h * (1 + w * 2));
        const range = Math.max(model.maxH - model.minH, 1e-6);
        for (let j = 0; j < h; j++) {
            const ro = j * (1 + w * 2);
            raw[ro] = 0;
            for (let i = 0; i < w; i++) {
                const v = Math.round((model.heights[j * model.n + i] - model.minH) / range * 65535);
                raw[ro + 1 + i * 2] = v >> 8;
                raw[ro + 2 + i * 2] = v & 255;
            }
        }
        const ihdr = new Uint8Array(13);
        const dv = new DataView(ihdr.buffer);
        dv.setUint32(0, w);
        dv.setUint32(4, h);
        ihdr[8] = 16;
        ihdr[9] = 0;
        ihdr[10] = 0;
        ihdr[11] = 0;
        ihdr[12] = 0;
        const meta = new TextEncoder().encode('terrain\0' + JSON.stringify({ minH: model.minH, maxH: model.maxH, size: SIZE, water: model.state.water }));
        const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', ihdr), pngChunk('tEXt', meta), pngChunk('IDAT', await zlibDeflate(raw)), pngChunk('IEND', new Uint8Array(0))];
        return new Blob(parts, { type: 'image/png' });
    }
    async function exportPNG16() {
        download(await encodePNG16(), `heightmap_${model.n}x${model.n}_16bit.png`);
        feedback.setStatus(`Экспортирована карта высот ${model.n}×${model.n}, 16 бит (мин ${model.minH.toFixed(1)} м, макс ${model.maxH.toFixed(1)} м)`);
    }
    async function decodePNG(buf: ArrayBuffer): Promise<DecodedHeightmap | null> {
        const b = new Uint8Array(buf);
        const dv = new DataView(buf);
        if (b[0] !== 137 || b[1] !== 80 || b[2] !== 78 || b[3] !== 71)
            throw new Error('not png');
        let off = 8, w = 0, h = 0, bd = 0, ct = 0, il = 0, meta: HeightmapMetadata | null = null;
        const idat: Uint8Array[] = [];
        while (off + 8 <= b.length) {
            const len = dv.getUint32(off), type = String.fromCharCode(b[off + 4], b[off + 5], b[off + 6], b[off + 7]);
            const data = b.subarray(off + 8, off + 8 + len);
            if (type === 'IHDR') {
                w = dv.getUint32(off + 8);
                h = dv.getUint32(off + 12);
                bd = b[off + 16];
                ct = b[off + 17];
                il = b[off + 20];
            }
            else if (type === 'IDAT')
                idat.push(data);
            else if (type === 'tEXt') {
                const s = new TextDecoder('latin1').decode(data);
                const z = s.indexOf('\0');
                if (s.slice(0, z) === 'terrain') {
                    try {
                        meta = JSON.parse(s.slice(z + 1));
                    }
                    catch (e) {
                        meta = null;
                    }
                }
            }
            else if (type === 'IEND')
                break;
            off += 12 + len;
        }
        const chans = { 0: 1, 2: 3, 4: 2, 6: 4 }[ct];
        if (!chans || il !== 0 || (bd !== 8 && bd !== 16))
            return null; // остальные варианты декодирует браузер (8 бит)
        const total = idat.reduce((a, c) => a + c.length, 0);
        const comp = new Uint8Array(total);
        let o = 0;
        for (const c of idat) {
            comp.set(c, o);
            o += c.length;
        }
        const raw = await zlibInflate(comp);
        const bpp = chans * bd / 8, stride = w * bpp;
        const out = new Uint8Array(h * stride);
        const vals = new Float32Array(w * h);
        for (let y = 0; y < h; y++) {
            const ft = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
            for (let x = 0; x < stride; x++) {
                const a = x >= bpp ? out[dst + x - bpp] : 0, up = y > 0 ? out[dst - stride + x] : 0, c = (x >= bpp && y > 0) ? out[dst - stride + x - bpp] : 0;
                let v = raw[src + x];
                if (ft === 1)
                    v += a;
                else if (ft === 2)
                    v += up;
                else if (ft === 3)
                    v += (a + up) >> 1;
                else if (ft === 4) {
                    const p = a + up - c, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c);
                    v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? up : c);
                }
                out[dst + x] = v & 255;
            }
            for (let x = 0; x < w; x++)
                vals[y * w + x] = bd === 16 ? ((out[dst + x * bpp] << 8) | out[dst + x * bpp + 1]) / 65535 : out[dst + x * bpp] / 255;
        }
        return { w, h, vals, meta, bits: bd };
    }
    async function decodeViaCanvas(file: Blob): Promise<DecodedHeightmap> {
        const bmp = await createImageBitmap(file);
        const c = document.createElement('canvas');
        c.width = bmp.width;
        c.height = bmp.height;
        const ctx = c.getContext('2d')!;
        ctx.drawImage(bmp, 0, 0);
        const d = ctx.getImageData(0, 0, c.width, c.height).data;
        const vals = new Float32Array(c.width * c.height);
        for (let i = 0; i < vals.length; i++)
            vals[i] = d[i * 4] / 255;
        return { w: c.width, h: c.height, vals, meta: null, bits: 8 };
    }
    async function importHeightmap(file: File) {
        if (model.busy)
            throw new Error('Дождитесь завершения операции');
        let img: DecodedHeightmap | null = null;
        try {
            img = await decodePNG(await file.arrayBuffer());
        }
        catch (e) {
            img = null;
        }
        if (!img)
            img = await decodeViaCanvas(file);
        const lo = img.meta ? img.meta.minH : 0, hi = img.meta ? img.meta.maxH : model.state.height;
        if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi < lo || lo < -60000 || hi > 60000 || !img.vals.every(Number.isFinite))
            throw new Error('Неверные высоты в PNG');
        if (img.meta && (!Number.isFinite(img.meta.water) || img.meta.water < -1000 || img.meta.water > 5000))
            throw new Error('Неверный уровень воды в PNG');
        const imported = new Float32Array(model.heights.length);
        for (let j = 0; j < model.n; j++)
            for (let i = 0; i < model.n; i++) {
                const fx = i / model.N * (img.w - 1), fy = j / model.N * (img.h - 1);
                const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(x0 + 1, img.w - 1), y1 = Math.min(y0 + 1, img.h - 1), tx = fx - x0, ty = fy - y0;
                const v = (img.vals[y0 * img.w + x0] * (1 - tx) + img.vals[y0 * img.w + x1] * tx) * (1 - ty) + (img.vals[y1 * img.w + x0] * (1 - tx) + img.vals[y1 * img.w + x1] * tx) * ty;
                imported[j * model.n + i] = lo + v * (hi - lo);
            }
        history.transaction('Импорт карты высот', () => {
            model.heights.set(imported);
            if (img.meta && typeof img.meta.water === 'number') {
                model.state.water = img.meta.water;
                feedback.syncUI('water');
                materials.updateWater();
            }
            terrain.updateMeshAll();
            vegetation.snapScatter();
        });
        feedback.setStatus(`Импортирована карта ${img.w}×${img.h} (${img.bits} бит)${img.meta ? ', с метаданными высот' : ''}`);
    }
    let captureView = (): ProjectView => ({ camera: { pos: render.camera.position.toArray() as [
                number,
                number,
                number
            ], target: render.controls.target.toArray() as [
                number,
                number,
                number
            ],
            rotation: [render.camera.rotation.x, render.camera.rotation.y, render.camera.rotation.z], near: (render.camera as THREE.PerspectiveCamera).near ?? 0.5 }, walk: null });
    let restoreView = (view: ProjectView) => {
        render.camera.position.fromArray(view.camera.pos);
        render.controls.target.fromArray(view.camera.target);
        render.camera.rotation.set(...view.camera.rotation);
        if ('near' in render.camera) {
            (render.camera as THREE.PerspectiveCamera).near = view.camera.near;
            (render.camera as THREE.PerspectiveCamera).updateProjectionMatrix();
        }
    };
    history.bindView(() => captureView(), view => restoreView(view));
    function projectJSON() { if (model.busy)
        throw new Error('Дождитесь завершения операции'); return encodeProject(model, captureView()); }
    async function buildProjectBlob(){history.flush();return buildProjectPackage(projectJSON(),vault);}
    async function saveProject() {
        const seed=model.state.seed,blob=await buildProjectBlob();
        download(blob, `terrain_project_${seed}.terrain`);
        feedback.setStatus('Проект с моделями сохранён (.terrain, формат '+PROJECT_VERSION+')');
    }
    let loading=false;
    async function loadProject(parse:()=>Promise<{project:DecodedProject;provided?:Map<string,Blob>}>){
        if(model.busy||loading)throw new Error('Дождитесь завершения операции');
        history.flush();loading=true;feedback.setBusy(true);
        try{
        const {project,provided=new Map<string,Blob>()}=await parse();
        for(const legacy of project.embeddedAssets){
            const stored=await describeAsset(legacy.blob),asset=project.world.assets.find(a=>a.id===legacy.id)!;
            asset.blob=stored.key;provided.set(stored.key,stored.blob);
        }
        project.world=validateWorld(project.world,project.state,false,false,false);
        await prepareModelAssets(project.world.assets,vault,provided);
        modelEntries(project.world);
        feedback.setBusy(false);
        history.transaction('Загрузка проекта', () => {
            applyDocument(model, project);
            terrain.buildTerrain();
            materials.splatTex.needsUpdate = true; materials.detailTex.needsUpdate = true;
            terrain.updateMeshAll();
            if (project.legacyScatter)
                vegetation.scatter(false);
            else
                vegetation.rebuild();
            actions.applyAll();
            feedback.syncAllUI();
            restoreView(project.view);
        }, true);
        feedback.setStatus('Проект загружен (формат '+PROJECT_VERSION+')');
        return project.sourceVersion<PROJECT_VERSION;
        }finally{loading=false;feedback.setBusy(false);feedback.syncAllUI();}
    }
    const loadProjectText=(text:string)=>loadProject(async()=>({project:decodeProject(text)}));
    const loadProjectFile=(file:Blob)=>loadProject(async()=>{
        const signature=new Uint8Array(await file.slice(0,8).arrayBuffer());
        if(new TextDecoder().decode(signature)==='TERRAIN\0')return readProjectPackage(file);
        if(file.size>32*1024*1024)throw new Error('JSON проекта больше 32 МБ. Используйте полный проект .terrain.');
        return {project:decodeProject(await file.text())};
    });
    async function importAsset(files:File[],category:ModelAsset['category'],collider:ModelAsset['collider'],replaceId?:string){
        if(model.busy||loading)throw new Error('Дождитесь завершения операции');
        if(replaceId&&!model.world.assets.some(a=>a.id===replaceId))throw new Error('Модель для замены не найдена');
        history.flush();feedback.setBusy(true);
        try{return await importModel(files,category,collider,vault,asset=>{
            validateWorld({...model.world,assets:replaceId?model.world.assets.map(a=>a.id===replaceId?{...asset,id:replaceId}:a):[...model.world.assets,asset]},model.state,false,false,false);
        });}finally{feedback.setBusy(false);feedback.syncAllUI();}
    }
    function bindView(capture: () => ProjectView, restore: (view: ProjectView) => void) {
        captureView = capture;
        restoreView = restore;
    }
    function buildOBJ() {
        const pos = terrain.geo.attributes.position.array, nor = terrain.geo.attributes.normal.array, idx = terrain.geo.index!.array;
        const out = ['# Terrain Editor OBJ export', `# ${model.n}x${model.n} vertices, size ${SIZE} m`, 'o Terrain'];
        for (let k = 0; k < model.n * model.n; k++)
            out.push(`v ${pos[k * 3].toFixed(3)} ${pos[k * 3 + 1].toFixed(3)} ${pos[k * 3 + 2].toFixed(3)}`);
        for (let j = 0; j < model.n; j++)
            for (let i = 0; i < model.n; i++)
                out.push(`vt ${(i / model.N).toFixed(5)} ${(1 - j / model.N).toFixed(5)}`);
        for (let k = 0; k < model.n * model.n; k++)
            out.push(`vn ${nor[k * 3].toFixed(4)} ${nor[k * 3 + 1].toFixed(4)} ${nor[k * 3 + 2].toFixed(4)}`);
        for (let t = 0; t < idx.length; t += 3) {
            const a = idx[t] + 1, b = idx[t + 1] + 1, c = idx[t + 2] + 1;
            out.push(`f ${a}/${a}/${a} ${b}/${b}/${b} ${c}/${c}/${c}`);
        }
        return out.join('\n') + '\n';
    }
    function exportOBJ() {
        download(new Blob([buildOBJ()], { type: 'text/plain' }), `terrain_${model.n}x${model.n}.obj`);
        feedback.setStatus(`OBJ экспортирован: ${(model.n * model.n).toLocaleString('ru-RU')} вершин, ${(model.N * model.N * 2).toLocaleString('ru-RU')} треугольников`);
    }
    function download(blob: Blob, name: string) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 3000); }
    function pickFile(accept: string, cb: (file: File) => unknown | Promise<unknown>) {
        const picker = document.createElement('input');
        picker.type = 'file';
        picker.accept = accept;
        picker.style.display = 'none';
        document.body.appendChild(picker);
        picker.addEventListener('cancel', () => picker.remove(), { once: true });
        picker.onchange = async () => {
            try {
                if (picker.files?.[0])
                    await cb(picker.files[0]);
            }
            catch (error) {
                console.warn(error);
                feedback.setStatus('Ошибка: ' + (error instanceof Error ? error.message : String(error)));
            }
            finally {
                picker.remove();
            }
        };
        picker.click();
    }
    return { buildOBJ, encodePNG16, decodePNG, projectJSON, loadProjectText,loadProjectFile,buildProjectBlob,importModel:importAsset, importHeightmap, exportPNG16, exportOBJ, saveProject, pickFile, bindView, };
}
export type StorageSystem = ReturnType<typeof createStorage>;
