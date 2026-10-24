import {MAX_ASSET_BYTES,readGLB} from './asset-format';
import type {ModelAsset} from './world';

export interface StoredAsset {key:string;blob:Blob;}
export interface AssetRepository {
    getAsset(key:string):Promise<Blob|undefined>;
    putAssets(assets:StoredAsset[]):Promise<void>;
}
export const validAssetKey=(key:unknown):key is string=>typeof key==='string'&&/^sha256:[a-f0-9]{64}$/.test(key);
export async function describeAsset(blob:Blob):Promise<StoredAsset>{
    if(blob.size>MAX_ASSET_BYTES)throw new Error('GLB должен быть не больше 64 МБ');
    const bytes=await blob.arrayBuffer();readGLB(bytes);
    const digest=await crypto.subtle.digest('SHA-256',bytes);
    const key='sha256:'+Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');
    return {key,blob};
}
export function createMemoryAssetRepository():AssetRepository{
    const blobs=new Map<string,Blob>();
    return {async getAsset(key){return blobs.get(key);},async putAssets(assets){for(const a of assets)blobs.set(a.key,a.blob);}};
}
/** Binary payloads live here, never in document/history snapshots. Blob is immutable. */
export function createAssetVault(repository?:()=>Promise<AssetRepository>){
    const memory=createMemoryAssetRepository(),verified=new Map<string,Blob>(),persisted=new Set<string>();
    let connection:Promise<AssetRepository>|undefined;
    const repo=()=>connection??=(repository?repository():Promise.resolve(memory));
    return {
        async resolve(asset:Pick<ModelAsset,'blob'|'byteLength'|'name'>,provided?:Map<string,Blob>){
            const cached=verified.get(asset.blob);
            if(cached){if(cached.size!==asset.byteLength)throw new Error('Неверный размер модели: '+asset.name);return cached;}
            const supplied=provided?.get(asset.blob),blob=supplied??await(await repo()).getAsset(asset.blob);
            if(!blob)throw new Error('Модель «'+asset.name+'» отсутствует в библиотеке. Загрузите полный проект .terrain.');
            if(blob.size!==asset.byteLength)throw new Error('Неверный размер модели: '+asset.name);
            const checked=await describeAsset(blob);
            if(checked.key!==asset.blob)throw new Error('Повреждены данные модели: '+asset.name);
            verified.set(asset.blob,blob);if(!supplied)persisted.add(asset.blob);
            return blob;
        },
        async persist(assets:StoredAsset[]){
            const unique=[...new Map(assets.map(a=>[a.key,a])).values()].filter(a=>!persisted.has(a.key));
            if(!unique.length)return;
            // The repository commits the whole batch or none of it.
            await(await repo()).putAssets(unique);
            for(const a of unique){persisted.add(a.key);verified.set(a.key,a.blob);}
        },
    };
}
export type AssetVault=ReturnType<typeof createAssetVault>;
