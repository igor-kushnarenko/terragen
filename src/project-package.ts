import {describeAsset,type AssetVault} from './asset-vault';
import {decodeProject,type DecodedProject} from './project';

const MAGIC=new TextEncoder().encode('TERRAIN\0'),HEADER=20,RECORD=68,MAX_JSON=32*1024*1024;
/** A small JSON manifest followed by binary GLBs. Blob parts avoid Base64 copies. */
export async function buildProjectPackage(text:string,vault:AssetVault):Promise<Blob>{
    const project=decodeProject(text),assets=[...new Map(project.world.assets.map(a=>[a.blob,a])).values()];
    const json=new TextEncoder().encode(text),header=new Uint8Array(HEADER),view=new DataView(header.buffer);
    if(json.length>MAX_JSON)throw new Error('Манифест проекта больше 32 МБ');
    header.set(MAGIC);view.setUint32(8,1,true);view.setUint32(12,json.length,true);view.setUint32(16,assets.length,true);
    const parts:BlobPart[]=[header,json];
    for(const asset of assets){
        const blob=await vault.resolve(asset),record=new Uint8Array(RECORD);
        record.set(new TextEncoder().encode(asset.blob.slice(7)));new DataView(record.buffer).setUint32(64,blob.size,true);
        parts.push(record,blob);
    }
    return new Blob(parts,{type:'application/x-terrain-project'});
}
export async function readProjectPackage(file:Blob):Promise<{project:DecodedProject;provided:Map<string,Blob>}>{
    const fail=():never=>{throw new Error('Неверный или повреждённый проект .terrain');};
    if(file.size<HEADER)fail();
    const header=new Uint8Array(await file.slice(0,HEADER).arrayBuffer()),view=new DataView(header.buffer);
    if(!MAGIC.every((v,i)=>header[i]===v)||view.getUint32(8,true)!==1)fail();
    const jsonLength=view.getUint32(12,true),count=view.getUint32(16,true);
    if(jsonLength>MAX_JSON||HEADER+jsonLength+count*RECORD>file.size)fail();
    const project=decodeProject(await file.slice(HEADER,HEADER+jsonLength).text());
    if(![10,11].includes(project.sourceVersion)||project.embeddedAssets.length)fail();
    const expected=new Map(project.world.assets.map(a=>[a.blob,a.byteLength])),provided=new Map<string,Blob>();
    if(expected.size!==count)fail();let offset=HEADER+jsonLength;
    for(let i=0;i<count;i++){
        if(offset+RECORD>file.size)fail();
        const record=await file.slice(offset,offset+RECORD).arrayBuffer(),bytes=new DataView(record),key='sha256:'+new TextDecoder().decode(record.slice(0,64)),length=bytes.getUint32(64,true);
        offset+=RECORD;
        if(expected.get(key)!==length||provided.has(key)||offset+length>file.size)fail();
        const blob=file.slice(offset,offset+length,'model/gltf-binary');
        if((await describeAsset(blob)).key!==key)fail();
        provided.set(key,blob);offset+=length;
    }
    if(offset!==file.size)fail();return {project,provided};
}
