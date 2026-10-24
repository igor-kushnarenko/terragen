import * as T from 'three';
import {createModelLoader} from './model-loader';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BUILTIN_GLB } from './builtin-models';
import { BUILTIN_INFO, makeBuiltinModel, type BuiltinAsset } from './model-shapes';
import { base64Binary, MAX_ASSET_BYTES, readGLB, validateGLTF } from './asset-format';
import {describeAsset,type AssetVault} from './asset-vault';
import {MAX_ANIMATED_OBJECTS,type ModelAsset,type WorldData} from './world';
export interface ModelTemplate { id: string; name: string; category: ModelAsset['category']; collider: ModelAsset['collider']; bounds: T.Box3; parts: { geometry: T.BufferGeometry; material: T.Material | T.Material[] }[]; rig?:{root:T.Group;clips:T.AnimationClip[];bones:number;skinnedMeshes:number}; }
const templates = new Map<string, ModelTemplate>(), prepared = new Map<string, ModelTemplate>();
const assetKey = (asset: ModelAsset) => asset.blob + '/' + asset.category + '/' + asset.collider+'/'+!!asset.normalize;
function template(id: string, name: string, category: ModelAsset['category'], collider: ModelAsset['collider'], scene: T.Object3D, normalize = false, clips:T.AnimationClip[]=[]): ModelTemplate {
    let bones=0,skinnedMeshes=0,morph=false;scene.traverse(o=>{if(o instanceof T.Bone)bones++;if(o instanceof T.SkinnedMesh)skinnedMeshes++;if(o instanceof T.Mesh&&o.morphTargetInfluences?.length)morph=true;});
    if(bones>512||clips.length>128)throw new Error('Лимит модели: 512 костей и 128 клипов');
    for(const clip of clips)if(!clip.validate()||!Number.isFinite(clip.duration)||clip.duration<=0||clip.duration>86400||clip.tracks.some(track=>!Array.from(track.times).every(Number.isFinite)||!Array.from(track.values).every(v=>typeof v==='number'&&Number.isFinite(v))))throw new Error('Некорректный анимационный клип');
    scene.updateMatrixWorld(true); const box = new T.Box3().setFromObject(scene,true), size = box.getSize(new T.Vector3());
    if (box.isEmpty() || !Number.isFinite(size.length()) || size.length() < 1e-6) throw new Error('В модели нет геометрии');
    const factor = normalize ? (category === 'tree'&&size.y>1e-6 ? 8 / size.y : category==='animated'&&size.y>1e-6?1.8/size.y:(category === 'bridge' || category === 'structure' ? 10 : category === 'wood' ? 4 : category === 'shrub' ? 1.5 : 2) / Math.max(size.x, size.y, size.z)) : 1;
    const transform = new T.Matrix4().makeScale(factor, factor, factor).multiply(new T.Matrix4().makeTranslation(-(box.min.x + box.max.x) / 2, normalize ? -box.min.y : 0, -(box.min.z + box.max.z) / 2));
    const parts: ModelTemplate['parts'] = []; let vertices = 0;
    scene.traverse(object => {
        if (!(object instanceof T.Mesh)) return;
        vertices += object.geometry.attributes.position.count;
        const geometry = object.geometry.clone();
        // A static rest-pose proxy remains available to existing bounds/collision consumers.
        // The renderable hierarchy below keeps the original skin attributes and bind matrices.
        if(object instanceof T.SkinnedMesh||object.morphTargetInfluences?.length){const p=geometry.attributes.position.clone(),v=new T.Vector3();for(let i=0;i<p.count;i++){object.getVertexPosition(i,v);p.setXYZ(i,v.x,v.y,v.z);}geometry.setAttribute('position',p);geometry.deleteAttribute('skinIndex');geometry.deleteAttribute('skinWeight');geometry.morphAttributes={};}
        geometry.applyMatrix4(new T.Matrix4().multiplyMatrices(transform, object.matrixWorld));
        if (!geometry.attributes.normal) geometry.computeVertexNormals();
        parts.push({ geometry, material: object.material });
    });
    if (!parts.length || parts.length > 64 || vertices > 100000) throw new Error('Лимит модели: 64 части и 100 000 вершин');
    const merged: ModelTemplate['parts'] = [], groups = new Map<string, typeof parts>();
    for (const part of parts) {
        if (Array.isArray(part.material)) { merged.push(part); continue; }
        const key = part.material.uuid + Object.keys(part.geometry.attributes).sort().join(',');
        const list = groups.get(key) ?? []; list.push(part); groups.set(key, list);
    }
    for (const group of groups.values()) {
        const geometries = group.map(part => part.geometry.index ? part.geometry.toNonIndexed() : part.geometry);
        const geometry = mergeGeometries(geometries);
        if (!geometry) throw new Error('Несовместимые части модели');
        merged.push({ geometry, material: group[0].material });
        group.forEach(part => part.geometry.dispose()); geometries.forEach(part => part.dispose());
    }
    const bounds = new T.Box3(); merged.forEach(part => { part.geometry.computeBoundingBox(); bounds.union(part.geometry.boundingBox!); });
    let rig:ModelTemplate['rig'];
    if(skinnedMeshes||clips.length||morph){const root=new T.Group();root.name='GenTerrainModel';transform.decompose(root.position,root.quaternion,root.scale);root.add(scene);root.updateMatrixWorld(true);rig={root,clips,bones,skinnedMeshes};}
    return { id, name, category, collider, bounds, parts: merged,...(rig?{rig}:{}) };
}
for (const id of Object.keys(BUILTIN_INFO) as BuiltinAsset[]) {
    const info = BUILTIN_INFO[id]; templates.set(id, template(id, info.name, info.category, info.collider, makeBuiltinModel(id)));
}
export function getModel(id: string) { const model = templates.get(id); if (!model) throw new Error('Модель не загружена: ' + id); return model; }
export function modelEntries(world: WorldData) {
    const entries=new Map<string,ModelTemplate>();
    for (const asset of world.assets ?? []) {
        const cached = prepared.get(assetKey(asset));
        if (!cached) throw new Error('Модель не подготовлена: ' + asset.name);
        entries.set(asset.id, { ...cached,id:asset.id, name: asset.name });
    }
    let animated=0;
    for(const o of world.objects){const t=entries.get(o.asset)??templates.get(o.asset);if(t?.rig&&++animated>MAX_ANIMATED_OBJECTS)throw new Error('Не больше '+MAX_ANIMATED_OBJECTS+' анимированных объектов в мире');if(o.animation&&(!t?.rig||o.animation.clip>=t.rig.clips.length))throw new Error('Анимационный клип объекта не найден: '+o.id);}
    for(const [id,t]of entries)templates.set(id,t);
    return [...Object.keys(BUILTIN_INFO), ...(world.assets ?? []).map(asset => asset.id)].map(getModel);
}
let builtinsReady: Promise<void> | undefined;
export function initializeModelLibrary() {
    return builtinsReady ??= (async () => {
        for (const [id, data] of Object.entries(BUILTIN_GLB)) {
            const scene = (await createModelLoader().parseAsync(base64Binary(data), '')).scene, info = BUILTIN_INFO[id as BuiltinAsset];
            templates.set(id, template(id, info.name, info.category, info.collider, scene));
        }
    })();
}
export async function prepareModelAssets(assets: ModelAsset[],vault:AssetVault,provided?:Map<string,Blob>) {
    const pending = new Map<string, ModelTemplate>();
    const binaries=new Map<string,Blob>();
    for (const asset of assets) {
        const blob=await vault.resolve(asset,provided);binaries.set(asset.blob,blob);
        const key = assetKey(asset); if (prepared.has(key)||pending.has(key)) continue;
        const bytes = await blob.arrayBuffer();
        const loaded = await createModelLoader().parseAsync(bytes, '');
        const ready = template(asset.id, asset.name, asset.category, asset.collider, loaded.scene,!!asset.normalize,loaded.animations);
        pending.set(key, ready);
    }
    await vault.persist([...binaries].map(([key,blob])=>({key,blob})));
    for (const [key, value] of pending) prepared.set(key, value);
}
export async function importModel(files: File[], category: ModelAsset['category'], collider: ModelAsset['collider'],vault:AssetVault,accept:(asset:ModelAsset)=>void=()=>{}): Promise<ModelAsset> {
    const main = files.find(file => /\.(glb|gltf)$/i.test(file.name));
    if (!main) throw new Error('Выберите GLB или glTF вместе с ресурсами');
    if (files.reduce((sum, file) => sum + file.size, 0) > MAX_ASSET_BYTES) throw new Error('Сумма файлов модели не должна превышать 64 МБ');
    const bytes = await main.arrayBuffer(), isBinary = /\.glb$/i.test(main.name);
    const input=isBinary?readGLB(bytes,true):JSON.parse(new TextDecoder().decode(bytes));if(!isBinary)validateGLTF(input,true);
    // Self-contained GLB already is the portable container. Re-encoding its images
    // can lose quality and exceed the size budget even when the source fits.
    const preserve=isBinary&&['buffers','images'].every(key=>((input[key]??[]) as {uri?:string}[]).every(item=>!item.uri||item.uri.startsWith('data:')));
    const urls: string[] = [], manager = new T.LoadingManager();
    manager.setURLModifier(url => {
        if (url.startsWith('data:') || url.startsWith('blob:')) return url;
        if (/^(https?:|\/\/|file:|blob:)/i.test(url)) throw new Error('Сетевые ресурсы модели запрещены');
        const name = decodeURIComponent(url).replace(/\\/g, '/').split('/').pop();
        const matches = files.filter(file => file.name === name);
        if (matches.length !== 1) throw new Error('Ресурс модели не найден или неоднозначен: ' + name);
        const local = URL.createObjectURL(matches[0]); urls.push(local); return local;
    });
    try {
        const loaded = await createModelLoader(manager).parseAsync(isBinary ? bytes : new TextDecoder().decode(bytes), '');
        let animated=loaded.animations.length>0;loaded.scene.traverse(o=>{if(o instanceof T.SkinnedMesh||o instanceof T.Mesh&&o.morphTargetInfluences?.length)animated=true;});
        if(animated){category='animated';collider='none';}
        const id = 'custom-' + crypto.randomUUID(), name = main.name.replace(/\.(glb|gltf)$/i, '').slice(0, 128);
        const ready = template(id, name, category, collider, loaded.scene, true,loaded.animations);
        const root = ready.rig?.root??new T.Group(); if(!ready.rig)ready.parts.forEach(part => root.add(new T.Mesh(part.geometry, part.material)));
        const glb = preserve?bytes:await new GLTFExporter().parseAsync(root, { binary: true,animations:ready.rig?.clips??[] });
        if (!(glb instanceof ArrayBuffer)) throw new Error('Ошибка упаковки GLB'); readGLB(glb);
        const stored=await describeAsset(new Blob([glb],{type:'model/gltf-binary'}));
        const asset={id,name,category,collider,blob:stored.key,byteLength:glb.byteLength,...(preserve?{normalize:true}:{})};
        accept(asset);await vault.persist([stored]);
        prepared.set(assetKey(asset),ready);return asset;
    } finally { urls.forEach(url => URL.revokeObjectURL(url)); }
}
