import {test} from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {base64Binary,MAX_ASSET_BYTES,MAX_ASSET_TOTAL,readGLB} from '../src/asset-format';
import {BUILTIN_GLB} from '../src/builtin-models';
import {createAssetVault,createMemoryAssetRepository,describeAsset} from '../src/asset-vault';
import {prepareModelAssets,modelEntries} from '../src/model-library';
import {captureDocument,decodeProject,validateWorld} from '../src/project';
import {buildProjectPackage,readProjectPackage} from '../src/project-package';
import {openWorldRepository,type WorldRepository} from '../src/world-library';
import {createAutosave} from '../src/autosave';
import type {ModelAsset} from '../src/world';
import {editorFixture} from './fixture';

const binary=()=>base64Binary(BUILTIN_GLB.boulder);
async function assetFixture(repository=createMemoryAssetRepository(),bytes=binary()){
    const vault=createAssetVault(async()=>repository),f=editorFixture(undefined,vault),stored=await describeAsset(new Blob([bytes],{type:'model/gltf-binary'}));
    const asset:ModelAsset={id:'custom-storage',name:'Камень',category:'rock',collider:'convex',blob:stored.key,byteLength:stored.blob.size};
    await prepareModelAssets([asset],vault,new Map([[stored.key,stored.blob]]));f.edits.replaceWorld({assets:[asset]});f.edits.addObject(asset.id,5,10);
    return {...f,asset,repository};
}
function paddedGLB(size=9*1024*1024){
    const bytes=binary(),result=new Uint8Array(size),view=new DataView(result.buffer);
    result.set(new Uint8Array(bytes));view.setUint32(8,size,true);view.setUint32(bytes.byteLength,size-bytes.byteLength-8,true);view.setUint32(bytes.byteLength+4,0x54534554,true);
    return result.buffer;
}
function autosaveFor(f:ReturnType<typeof editorFixture>,repository:WorldRepository){
    let id=0;return createAutosave({...f,repository:async()=>repository,preview:()=>'',viewKey:()=>'',newWorld:async()=>true,id:()=>String(id++)});
}

test('9 MB GLB payload is stored once; history, editing and autosave never serialize or reread its bytes',async t=>{
    const repo=await openWorldRepository(new IDBFactory());t.after(()=>repo.close());
    let writes=0,reads=0;const put=repo.putAssets,get=repo.getAsset;
    repo.putAssets=async assets=>{writes+=assets.length;await put(assets);};repo.getAsset=async key=>{reads++;return get(key);};
    const f=await assetFixture(repo,paddedGLB()),autosave=autosaveFor(f,repo);t.after(()=>autosave.dispose());
    assert.equal(await autosave.initialize(),false);await autosave.saveNow(true);
    const baseline=f.storage.projectJSON().length;
    for(let i=0;i<5;i++){f.edits.updateObject(f.model.world.objects[0].id,{tint:.8+i*.01});await autosave.saveNow();}
    f.history.undo();f.history.redo();await autosave.saveNow();
    const snapshot=captureDocument(f.model),json=f.storage.projectJSON(),saved=await repo.last();
    assert.equal(writes,1);assert.equal(reads,0);assert.ok(json.length<baseline+1000);
    assert.ok(!('glb'in snapshot.world.assets[0]));assert.ok(!JSON.stringify(snapshot.world).includes(BUILTIN_GLB.boulder.slice(0,100)));
    assert.deepEqual(saved?.assetKeys,[f.asset.blob]);assert.equal(decodeProject(saved!.project).world.assets[0].byteLength,9*1024*1024);
    assert.equal((await repo.getAsset(f.asset.blob))!.size,9*1024*1024);
});

test('two model IDs and copied worlds share one binary while selection preserves both IDs',async t=>{
    const repo=await openWorldRepository(new IDBFactory());t.after(()=>repo.close());const f=await assetFixture(repo);
    const second={...f.asset,id:'custom-second',name:'Ещё камень'};f.edits.replaceWorld({assets:[f.asset,second]});
    const entries=modelEntries(f.model.world);assert.equal(entries.find(a=>a.id===second.id)?.name,second.name);
    const autosave=autosaveFor(f,repo);t.after(()=>autosave.dispose());await autosave.initialize();await autosave.saveNow(true);await autosave.saveCopy('Копия');
    const worlds=await repo.list();assert.equal(worlds.length,2);
    for(const world of worlds)assert.deepEqual((await repo.get(world.id))!.assetKeys,[f.asset.blob]);
    const pack=await readProjectPackage(await f.storage.buildProjectBlob());assert.equal(pack.provided.size,1);
});

test('full binary project imports into a fresh library and its models survive undo/redo and reopening',async t=>{
    const f=await assetFixture(),file=await f.storage.buildProjectBlob();
    assert.equal(new TextDecoder().decode(await file.slice(0,8).arrayBuffer()),'TERRAIN\0');
    const factory=new IDBFactory(),repo=await openWorldRepository(factory,'portable');t.after(()=>repo.close());
    const restored=editorFixture(undefined,createAssetVault(async()=>repo)),before=captureDocument(restored.model);
    await restored.storage.loadProjectFile(file);assert.deepEqual(restored.model.world,f.model.world);
    restored.history.undo();assert.deepEqual(captureDocument(restored.model),before);restored.history.redo();assert.deepEqual(restored.model.world,f.model.world);
    const autosave=autosaveFor(restored,repo);t.after(()=>autosave.dispose());await autosave.initialize();await autosave.saveNow(true);
    const reopened=editorFixture(undefined,createAssetVault(async()=>repo));await reopened.storage.loadProjectText((await repo.last())!.project);
    assert.deepEqual(reopened.model.world,f.model.world);assert.ok(await repo.getAsset(f.asset.blob));
});

test('missing references and damaged binary packages leave scene, view and history unchanged',async()=>{
    const f=await assetFixture(),empty=editorFixture(),before=captureDocument(empty.model);
    await assert.rejects(empty.storage.loadProjectText(f.storage.projectJSON()),/отсутствует/);assert.deepEqual(captureDocument(empty.model),before);assert.equal(empty.history.undoDepth,0);
    const bytes=new Uint8Array(await(await f.storage.buildProjectBlob()).arrayBuffer());bytes[bytes.length-1]^=1;
    await assert.rejects(empty.storage.loadProjectFile(new Blob([bytes])),/повреждённый/);assert.deepEqual(captureDocument(empty.model),before);assert.equal(empty.history.undoDepth,0);assert.equal(empty.model.busy,false);
    await assert.rejects(empty.storage.loadProjectFile(new Blob([bytes.subarray(0,-100)])));assert.deepEqual(captureDocument(empty.model),before);
});

test('bad metadata, mismatched sizes and model/world budgets are checked without payloads',()=>{
    assert.equal(MAX_ASSET_BYTES,64*1024*1024);assert.equal(MAX_ASSET_TOTAL,512*1024*1024);
    assert.doesNotThrow(()=>readGLB(paddedGLB(MAX_ASSET_BYTES)));
    assert.throws(()=>readGLB(new ArrayBuffer(MAX_ASSET_BYTES+4)),/64 МБ/);
    const f=editorFixture(),asset=(i:number):ModelAsset=>({id:'custom-'+i,name:'Модель',category:'rock',collider:'none',blob:'sha256:'+i.toString(16).padStart(64,'0'),byteLength:MAX_ASSET_BYTES});
    assert.doesNotThrow(()=>validateWorld({...f.model.world,assets:Array.from({length:8},(_,i)=>asset(i))},f.model.state));
    assert.throws(()=>validateWorld({...f.model.world,assets:Array.from({length:9},(_,i)=>asset(i))},f.model.state),/512 МБ/);
    assert.throws(()=>validateWorld({...f.model.world,assets:[{...asset(0),byteLength:MAX_ASSET_BYTES+1}]},f.model.state),/byteLength/);
    assert.throws(()=>validateWorld({...f.model.world,assets:[{...asset(0),blob:'https://example.com/tree.glb'}]},f.model.state),/blob/);
    assert.throws(()=>validateWorld({...f.model.world,assets:[asset(0),{...asset(1),blob:asset(0).blob,byteLength:20}]},f.model.state),/byteLength/);
});

test('a v1 database and embedded format 9 migrate lazily without losing the previous save',async t=>{
    const factory=new IDBFactory(),legacy=JSON.parse(editorFixture().storage.projectJSON());legacy.version=9;
    legacy.world.assets=[{id:'custom-legacy',name:'Старый камень',category:'rock',collider:'convex',glb:BUILTIN_GLB.boulder}];
    const oldText=JSON.stringify(legacy);
    await new Promise<void>((resolve,reject)=>{
        const request=factory.open('old',1);request.onupgradeneeded=()=>{request.result.createObjectStore('worlds',{keyPath:'id'});request.result.createObjectStore('session',{keyPath:'key'});};
        request.onsuccess=()=>{const db=request.result,tx=db.transaction(['worlds','session'],'readwrite');tx.objectStore('worlds').put({id:'old',name:'Старый мир',updatedAt:1,preview:'',project:oldText});tx.objectStore('session').put({key:'last',id:'old'});tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};request.onerror=()=>reject(request.error);
    });
    const repo=await openWorldRepository(factory,'old');t.after(()=>repo.close());assert.equal((await repo.last())!.project,oldText);
    const f=editorFixture(undefined,createAssetVault(async()=>repo)),autosave=autosaveFor(f,repo);t.after(()=>autosave.dispose());
    assert.equal(await autosave.initialize(),true);
    const saved=(await repo.last())!,asset=f.model.world.assets[0];assert.equal(saved.id,'old');assert.equal(saved.name,'Старый мир');assert.ok(!saved.project.includes('"glb"'));assert.equal(JSON.parse(saved.project).version,11);
    assert.ok(await repo.getAsset(asset.blob));assert.deepEqual(saved.assetKeys,[asset.blob]);assert.equal(f.history.undoDepth,0);
});

test('blob write failure never publishes a partially imported world or loses the previous record',async t=>{
    const repo=await openWorldRepository(new IDBFactory());t.after(()=>repo.close());const f=await assetFixture(),receiver=editorFixture(undefined,createAssetVault(async()=>repo)),before=captureDocument(receiver.model);
    await repo.put({id:'before',name:'Прежний',updatedAt:1,preview:'',project:receiver.storage.projectJSON()});
    repo.putAssets=async()=>{throw new DOMException('quota','QuotaExceededError');};
    await assert.rejects(receiver.storage.loadProjectFile(await f.storage.buildProjectBlob()),/quota/);
    assert.deepEqual(captureDocument(receiver.model),before);assert.equal(receiver.history.undoDepth,0);assert.equal((await repo.last())!.id,'before');assert.equal(receiver.model.busy,false);
});

test('world and session pointer cannot commit with a missing binary reference',async t=>{
    const repo=await openWorldRepository(new IDBFactory());t.after(()=>repo.close());
    await repo.put({id:'a',name:'A',updatedAt:1,preview:'',project:'{}'});
    await assert.rejects(repo.put({id:'b',name:'B',updatedAt:2,preview:'',project:'{}',assetKeys:['sha256:'+'1'.repeat(64)]}));
    assert.equal((await repo.last())!.id,'a');assert.equal(await repo.get('b'),undefined);
});

test('packages reject duplicate records, trailing bytes and unsupported versions',async()=>{
    const f=await assetFixture(),file=await f.storage.buildProjectBlob(),bytes=new Uint8Array(await file.arrayBuffer());
    await assert.rejects(readProjectPackage(new Blob([bytes,new Uint8Array(1)])),/повреждённый/);
    const future=bytes.slice();new DataView(future.buffer).setUint32(8,2,true);await assert.rejects(readProjectPackage(new Blob([future])),/повреждённый/);
    const duplicate=bytes.slice();new DataView(duplicate.buffer).setUint32(16,2,true);await assert.rejects(readProjectPackage(new Blob([duplicate])),/повреждённый/);
    const receiver=editorFixture();await assert.rejects(buildProjectPackage(f.storage.projectJSON(),receiver.vault),/отсутствует/);
});

test('an aborted binary batch leaves no partial payloads in IndexedDB',async t=>{
    const repo=await openWorldRepository(new IDBFactory());t.after(()=>repo.close());const stored=await describeAsset(new Blob([binary()]));
    await assert.rejects(repo.putAssets([stored,{key:'bad',blob:stored.blob}]));assert.equal(await repo.getAsset(stored.key),undefined);
});

test('failed metadata migration keeps the embedded save recoverable and retries without losing the loaded world',async t=>{
    const repo=await openWorldRepository(new IDBFactory());t.after(()=>repo.close());
    const legacy=JSON.parse(editorFixture().storage.projectJSON());legacy.version=9;legacy.world.assets=[{id:'custom-old',name:'Старый',category:'rock',collider:'none',glb:BUILTIN_GLB.boulder}];
    const text=JSON.stringify(legacy);await repo.put({id:'old',name:'Старый мир',updatedAt:1,preview:'',project:text});
    const put=repo.put;repo.put=async()=>{throw new DOMException('quota','QuotaExceededError');};
    const f=editorFixture(undefined,createAssetVault(async()=>repo)),autosave=autosaveFor(f,repo);t.after(()=>autosave.dispose());
    assert.equal(await autosave.initialize(),true);assert.equal(f.model.world.assets[0].name,'Старый');assert.equal((await repo.last())!.project,text);assert.equal(autosave.status.id,'old');assert.match(autosave.status.message,/Недостаточно места/);
    repo.put=put;await autosave.saveNow();assert.equal(JSON.parse((await repo.last())!.project).version,11);assert.ok(!(await repo.last())!.project.includes('"glb"'));
});

test('a corrupted stored Blob is rejected even if its key and byte length match',async t=>{
    const repo=await openWorldRepository(new IDBFactory());t.after(()=>repo.close());const f=await assetFixture(repo);
    const data=new Uint8Array(await(await repo.getAsset(f.asset.blob))!.arrayBuffer());data[data.length-1]^=1;
    await repo.putAssets([{key:f.asset.blob,blob:new Blob([data])}]);
    const target=editorFixture(undefined,createAssetVault(async()=>repo)),before=captureDocument(target.model);
    await assert.rejects(target.storage.loadProjectText(f.storage.projectJSON()),/Повреждены/);assert.deepEqual(captureDocument(target.model),before);
});
