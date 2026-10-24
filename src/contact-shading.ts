import * as T from 'three';
import {objectFootprint,type Footprint} from './ecology';
import {getModel} from './model-library';
import {HALF,SIZE,type EditorModel} from './state';
import type {TerrainSystem} from './terrain';
import type {WorldObject} from './world';

export const CONTACT_RES=256;
const TILE=32,NEIGHBOURS=[[-8,0],[8,0],[0,-8],[0,8],[-16,-16],[16,16],[-16,16],[16,-16]].map(([x,z])=>[x,z,1/Math.hypot(x,z)]);
type Rect=readonly [number,number,number,number];
type Ground=Pick<TerrainSystem,'getH'>;
type Shadow={item:WorldObject;footprint:Footprint;ground:number};
function shadowsFor(model:EditorModel,terrain:Ground,previous=new Map<string,Shadow>()){
    const shadows=new Map<string,Shadow>();
    for(const item of model.world.objects){
        if(item.source==='scatter'&&!model.state.showScatter)continue;
        const asset=getModel(item.asset);if(asset.category==='shrub'||asset.category==='bridge')continue;
        const old=previous.get(item.id),ground=terrain.getH(item.position[0],item.position[2]);
        if(old?.item===item){const dy=item.followTerrain?ground-old.ground:0;shadows.set(item.id,{item,ground,footprint:dy?{...old.footprint,minY:old.footprint.minY+dy,maxY:old.footprint.maxY+dy}:old.footprint});}
        else shadows.set(item.id,{item,ground,footprint:objectFootprint(item,terrain,false)});
    }
    return shadows;
}
function renderRegion(terrain:Ground,data:Uint8Array,shadows:Iterable<Shadow>,[x0,z0,x1,z1]:Rect){
    for(let z=z0;z<=z1;z++)for(let x=x0;x<=x1;x++){
        const wx=-HALF+(x+.5)*SIZE/CONTACT_RES,wz=-HALF+(z+.5)*SIZE/CONTACT_RES,h=terrain.getH(wx,wz);let blocked=0;
        for(const [dx,dz,inverse]of NEIGHBOURS)blocked+=Math.max(0,Math.min(1,(terrain.getH(wx+dx,wz+dz)-h)*inverse));
        data[z*CONTACT_RES+x]=Math.round(blocked/8*100);
    }
    for(const {footprint:p}of shadows){
        const cx=(p.x+HALF)/SIZE*CONTACT_RES-.5,cz=(p.z+HALF)/SIZE*CONTACT_RES-.5,r=Math.min(18,Math.max(4.5,p.radius+1.2))/SIZE*CONTACT_RES;
        const left=Math.max(x0,Math.floor(cx-r)),right=Math.min(x1,Math.ceil(cx+r)),top=Math.max(z0,Math.floor(cz-r)),bottom=Math.min(z1,Math.ceil(cz+r));
        if(left>right||top>bottom||p.minY>terrain.getH(p.x,p.z)+1)continue;
        for(let z=top;z<=bottom;z++)for(let x=left;x<=right;x++){const w=Math.max(0,1-Math.hypot(x-cx,z-cz)/r);data[z*CONTACT_RES+x]=Math.min(210,data[z*CONTACT_RES+x]+w*w*200);}
    }
}
export function contactMap(model:EditorModel,terrain:Ground){
    const data=new Uint8Array(CONTACT_RES*CONTACT_RES);renderRegion(terrain,data,shadowsFor(model,terrain).values(),[0,0,CONTACT_RES-1,CONTACT_RES-1]);return data;
}
export function createContactShading(model:EditorModel,terrain:TerrainSystem,uniform:{value:T.Texture}){
    const bytes=new Uint8Array(CONTACT_RES*CONTACT_RES),texture=new T.DataTexture(bytes,CONTACT_RES,CONTACT_RES,T.RedFormat);
    texture.magFilter=texture.minFilter=T.LinearFilter;texture.needsUpdate=true;uniform.value=texture;
    let revision=-1,objects:typeof model.world.objects|undefined,show=false,elapsed=1,shadows=new Map<string,Shadow>();
    let pending:{revision:number;full:boolean;rects:Rect[]}|undefined;
    const statistics={fullUpdates:0,localUpdates:0,pixels:0,lastUpdateMs:0};
    function invalidateRegions(rects:readonly Rect[]){
        if(revision<0)return;
        const expected=pending?.revision??revision;
        pending={revision:model.terrainRevision,full:!!pending?.full||model.terrainRevision!==expected+rects.length,rects:[...pending?.rects??[],...rects]};
    }
    function update(dt=1){
        elapsed+=dt;if(model.state.quality==='low'||model.state.contactAO===0)return;
        if(revision===model.terrainRevision&&objects===model.world.objects&&show===model.state.showScatter)return;
        if(revision>=0&&elapsed<.25)return;
        const started=performance.now(),next=shadowsFor(model,terrain,shadows);statistics.pixels=0;
        if(pending&&!pending.full&&pending.revision===model.terrainRevision&&show===model.state.showScatter){
            const tiles=new Set<string>();
            function mark(x0:number,z0:number,x1:number,z1:number){
                if(x1<-HALF||z1<-HALF||x0>HALF||z0>HALF)return;
                const cell=(v:number)=>Math.floor(Math.max(0,Math.min(CONTACT_RES-1,(v+HALF)/SIZE*CONTACT_RES-.5))/TILE);
                for(let z=cell(z0);z<=cell(z1);z++)for(let x=cell(x0);x<=cell(x1);x++)tiles.add(x+','+z);
            }
            const padding=16+model.cell*2;
            for(const [i0,j0,i1,j1]of pending.rects)mark(-HALF+i0*model.cell-padding,-HALF+j0*model.cell-padding,-HALF+i1*model.cell+padding,-HALF+j1*model.cell+padding);
            const markShadow=(s:Shadow)=>{const p=s.footprint;mark(p.x-19,p.z-19,p.x+19,p.z+19);};
            for(const [id,old]of shadows)if(next.get(id)?.item!==old.item){markShadow(old);const n=next.get(id);if(n)markShadow(n);}
            for(const [id,n]of next)if(!shadows.has(id))markShadow(n);
            for(const key of tiles){const [x,z]=key.split(',').map(Number);renderRegion(terrain,bytes,next.values(),[x*TILE,z*TILE,(x+1)*TILE-1,(z+1)*TILE-1]);statistics.pixels+=TILE*TILE;}
            statistics.localUpdates++;
        }else{renderRegion(terrain,bytes,next.values(),[0,0,CONTACT_RES-1,CONTACT_RES-1]);statistics.pixels=CONTACT_RES**2;statistics.fullUpdates++;}
        shadows=next;pending=undefined;texture.needsUpdate=true;revision=model.terrainRevision;objects=model.world.objects;show=model.state.showScatter;elapsed=0;statistics.lastUpdateMs=performance.now()-started;
    }
    return {update,invalidateRegions,get statistics(){return {...statistics};},dispose(){texture.dispose();}};
}
