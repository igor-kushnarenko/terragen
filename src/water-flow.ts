import * as T from 'three';
import type {EditorModel} from './state';
import type {WaterBody} from './world';
import {waterBounds,waterPath,waterLevelAt} from './water-math';
import {getModel} from './model-library';
export interface FlowObstacle{x:number;z:number;radius:number;}
/** Bounded potential flow around submerged trunks/rocks, not a hydraulic river solver. */
export function obstacleFlow(x:number,z:number,dx:number,dz:number,obstacles:readonly FlowObstacle[]){
    let vx=dx,vz=dz;const speed=Math.hypot(dx,dz);if(!speed)return new T.Vector2();
    for(const o of obstacles){const rx=x-o.x,rz=z-o.z,d=Math.hypot(rx,rz);if(d>o.radius*5)continue;
        const distance=Math.max(d,o.radius),nx=d>1e-6?rx/d:1,nz=d>1e-6?rz/d:0,k=o.radius*o.radius/(distance*distance),radial=dx*nx+dz*nz;
        vx+=k*(dx-2*radial*nx);vz+=k*(dz-2*radial*nz);
        if(d<o.radius*.9)return new T.Vector2();
    }
    const length=Math.hypot(vx,vz),cap=speed*1.8;if(length>cap){vx*=cap/length;vz*=cap/length;}return new T.Vector2(vx,vz);
}
export function createWaterFlow(model:EditorModel,getH:(x:number,z:number)=>number){
    const maps=new Map<string,{texture:T.DataTexture;bounds:T.Vector4;data:Float32Array;size:number}>();
    let objects:typeof model.world.objects|undefined,bodies:typeof model.world.waterBodies|undefined,revision=-1,showScatter=false;
    function rebuild(){
        for(const m of maps.values())m.texture.dispose();maps.clear();const obstacles:FlowObstacle[]=[];
        for(const o of model.world.objects){if(o.floating||o.source==='scatter'&&!model.state.showScatter)continue;const asset=getModel(o.asset);
            if(o.asset==='pier'){const rotation=new T.Quaternion().setFromEuler(new T.Euler(...o.rotation));for(const x of [-1.5,1.5])for(const z of [-3.5,0,3.5]){const p=new T.Vector3(x,-.25,z).multiply(new T.Vector3(...o.scale)).applyQuaternion(rotation).add(new T.Vector3(...o.position)),level=waterLevelAt(model.state.water,model.world.waterBodies,p.x,p.z);if(p.y-1.5*o.scale[1]<level&&p.y+1.5*o.scale[1]>level)obstacles.push({x:p.x,z:p.z,radius:.18*Math.max(o.scale[0],o.scale[2])});}continue;}
            if(asset.collider==='none'||asset.category==='bridge'||asset.category==='structure')continue;
            const b=asset.bounds,size=b.getSize(new T.Vector3()),y=o.followTerrain?getH(o.position[0],o.position[2])+o.groundOffset:o.position[1];
            const radius=asset.collider==='trunk'?.22*Math.max(o.scale[0],o.scale[2]):Math.max(size.x*o.scale[0],size.z*o.scale[2])*.4;
            if(y+b.min.y*o.scale[1]<Math.max(model.state.water,...model.world.waterBodies.map(b=>b.level))+1)obstacles.push({x:o.position[0],z:o.position[2],radius});
        }
        for(const body of model.world.waterBodies){if(body.kind!=='river')continue;const b=waterBounds(body,2),size=64,data=new Float32Array(size*size*2),packed=new Uint16Array(data.length),bounds=new T.Vector4(b.minX,b.minZ,b.maxX-b.minX,b.maxZ-b.minZ);
            // Cull obstacle work before rasterizing each small local flow map.
            const nearby=obstacles.filter(o=>o.x+o.radius*5>b.minX&&o.x-o.radius*5<b.maxX&&o.z+o.radius*5>b.minZ&&o.z-o.radius*5<b.maxZ);
            for(let j=0;j<size;j++)for(let i=0;i<size;i++){const x=b.minX+(i+.5)/size*bounds.z,z=b.minZ+(j+.5)/size*bounds.w,p=waterPath(body,x,z),speed=body.flowSpeed??.6,f=obstacleFlow(x,z,p.dx*speed,p.dz*speed,nearby),k=(j*size+i)*2;data[k]=f.x;data[k+1]=f.y;packed[k]=T.DataUtils.toHalfFloat(f.x);packed[k+1]=T.DataUtils.toHalfFloat(f.y);data[k]=T.DataUtils.fromHalfFloat(packed[k]);data[k+1]=T.DataUtils.fromHalfFloat(packed[k+1]);}
            const texture=new T.DataTexture(packed,size,size,T.RGFormat,T.HalfFloatType);texture.minFilter=texture.magFilter=T.LinearFilter;texture.needsUpdate=true;maps.set(body.id,{texture,bounds,data,size});
        }
        objects=model.world.objects;bodies=model.world.waterBodies;revision=model.terrainRevision;showScatter=model.state.showScatter;
    }
    function ensure(){if(objects!==model.world.objects||bodies!==model.world.waterBodies||revision!==model.terrainRevision||showScatter!==model.state.showScatter)rebuild();}
    function sample(body:WaterBody,x:number,z:number,dx:number,dz:number){ensure();const map=maps.get(body.id);if(!map)return new T.Vector2(dx,dz);const b=map.bounds,n=map.size,fx=Math.max(0,Math.min(n-1,(x-b.x)/b.z*n-.5)),fz=Math.max(0,Math.min(n-1,(z-b.y)/b.w*n-.5)),i=Math.floor(fx),j=Math.floor(fz),tx=fx-i,tz=fz-j;
        const read=(a:number,c:number,k:number)=>map.data[(Math.min(n-1,c)*n+Math.min(n-1,a))*2+k];
        const at=(k:number)=>T.MathUtils.lerp(T.MathUtils.lerp(read(i,j,k),read(i+1,j,k),tx),T.MathUtils.lerp(read(i,j+1,k),read(i+1,j+1,k),tx),tz);return new T.Vector2(at(0),at(1));
    }
    return {ensure,sample,map(body:WaterBody){ensure();return maps.get(body.id);},dispose(){for(const m of maps.values())m.texture.dispose();maps.clear();}};
}
