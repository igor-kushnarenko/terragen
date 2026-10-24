import {validAssetKey,type AssetRepository,type StoredAsset} from './asset-vault';
import {MAX_ASSET_BYTES} from './asset-format';
export interface SavedWorld { id: string; name: string; updatedAt: number; project: string; preview: string; assetKeys?:string[]; }
export type WorldSummary = Omit<SavedWorld, 'project'>;
export interface WorldRepository extends AssetRepository {
    list(): Promise<WorldSummary[]>;
    get(id: string): Promise<SavedWorld | undefined>;
    last(): Promise<SavedWorld | undefined>;
    put(world: SavedWorld): Promise<void>;
    select(id: string): Promise<void>;
    remove(id: string): Promise<void>;
    close(): void;
}
export const WORLD_DB_NAME = 'terrain-editor-worlds';
export function openWorldRepository(factory: IDBFactory = indexedDB, databaseName = WORLD_DB_NAME): Promise<WorldRepository> {
    return new Promise((resolve, reject) => {
        const request = factory.open(databaseName, 2);
        let blocked = false;
        request.onupgradeneeded = () => {
            const db = request.result;
            if(!db.objectStoreNames.contains('worlds'))db.createObjectStore('worlds', { keyPath: 'id' });
            if(!db.objectStoreNames.contains('session'))db.createObjectStore('session', { keyPath: 'key' });
            if(!db.objectStoreNames.contains('assets'))db.createObjectStore('assets',{keyPath:'key'});
        };
        request.onerror = () => reject(request.error ?? new Error('Не удалось открыть IndexedDB'));
        request.onblocked = () => { blocked = true; reject(new Error('Библиотека занята другой вкладкой. Закройте её и перезагрузите редактор.')); };
        request.onsuccess = () => {
            const db = request.result;
            if (blocked) { db.close(); return; }
            db.onversionchange = () => db.close();
            function transaction<T>(mode: IDBTransactionMode, action: (worlds: IDBObjectStore, session: IDBObjectStore, result: (value: T) => void) => void): Promise<T> {
                return new Promise((done, fail) => {
                    const tx = db.transaction(['worlds', 'session','assets'], mode);
                    let value: T;
                    tx.oncomplete = () => done(value);
                    tx.onabort = () => fail(tx.error ?? new Error('Запись в IndexedDB отменена'));
                    tx.onerror = () => {}; // The abort event carries the transaction failure.
                    try { action(tx.objectStore('worlds'), tx.objectStore('session'), result => { value = result; }); }
                    catch (error) { tx.abort(); fail(error); }
                });
            }
            const repository: WorldRepository = {
                getAsset:key=>transaction('readonly',(worlds,_session,result)=>{
                    const read=worlds.transaction.objectStore('assets').get(key);read.onsuccess=()=>result(read.result?.blob);
                }),
                putAssets:entries=>transaction('readwrite',(worlds,_session,result)=>{
                    const assets=worlds.transaction.objectStore('assets');
                    for(const entry of entries){
                        if(!validAssetKey(entry.key)||!(entry.blob instanceof Blob)||entry.blob.size>MAX_ASSET_BYTES)throw new Error('Неверные данные модели');
                        assets.put(entry satisfies StoredAsset);
                    }
                    result(undefined);
                }),
                list: () => transaction('readonly', (worlds, _session, result) => {
                    const items: WorldSummary[] = [], cursor = worlds.openCursor();
                    cursor.onsuccess = () => {
                        const item = cursor.result;
                        if (!item) { result(items.sort((a, b) => b.updatedAt - a.updatedAt)); return; }
                        const { id, name, updatedAt, preview } = item.value as SavedWorld;
                        items.push({ id, name, updatedAt, preview }); item.continue();
                    };
                }),
                get: id => transaction('readonly', (worlds, _session, result) => { const read = worlds.get(id); read.onsuccess = () => result(read.result); }),
                last: () => transaction('readonly', (worlds, session, result) => {
                    const read = session.get('last');
                    read.onsuccess = () => {
                        if (!read.result) { result(undefined); return; }
                        const world = worlds.get(read.result.id); world.onsuccess = () => result(world.result);
                    };
                }),
                // The world and the last-session pointer either both commit or neither commits.
                put: world => transaction('readwrite', (worlds, session, result) => {
                    const keys=[...new Set(world.assetKeys??[])];let pending=keys.length;
                    const write=()=>{worlds.put(world);session.put({key:'last',id:world.id});result(undefined);};
                    if(!pending){write();return;}
                    const assets=worlds.transaction.objectStore('assets');
                    for(const key of keys){
                        if(!validAssetKey(key))throw new Error('Неверная ссылка на модель');
                        const read=assets.getKey(key);read.onsuccess=()=>{if(read.result===undefined){txAbort(assets);return;}if(--pending===0)write();};
                    }
                }),
                select: id => transaction('readwrite', (worlds, session, result) => {
                    const read = worlds.get(id); read.onsuccess = () => {
                        if (!read.result) { txAbort(session); return; }
                        session.put({ key: 'last', id }); result(undefined);
                    };
                }),
                remove: id => transaction('readwrite', (worlds, session, result) => {
                    worlds.delete(id); const read = session.get('last');
                    read.onsuccess = () => { if (read.result?.id === id) session.delete('last'); result(undefined); };
                }),
                close: () => db.close(),
            };
            resolve(repository);
        };
    });
}
function txAbort(store: IDBObjectStore) { store.transaction.abort(); }
