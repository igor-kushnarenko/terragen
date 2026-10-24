import type {EditorModel} from './state';
import {FootprintIndex,objectFootprint} from './ecology';
import {createWalkStart} from './walk-start';
import {waterLevelAt} from './water-math';
import type {Vec3} from './world';
const caches=new WeakMap<EditorModel,{objects:EditorModel['world']['objects'];revision:number;visible:boolean;index:FootprintIndex}>();
export function balloonObstacles(model:EditorModel,getH:(x:number,z:number)=>number){
    let cached=caches.get(model);if(cached&&cached.objects===model.world.objects&&cached.revision===model.terrainRevision&&cached.visible===model.state.showScatter)return cached.index;
    const index=new FootprintIndex();
    for(const item of model.world.objects){if(item.source==='scatter'&&!model.state.showScatter)continue;const p=objectFootprint(item,{getH});if(p.maxY-p.minY>.7)index.insert(p);}
    cached={objects:model.world.objects,revision:model.terrainRevision,visible:model.state.showScatter,index};caches.set(model,cached);return index;
}

/** Search is bounded and uses a spatial index, including the whole canopy. */
export function findBalloonSite(model:EditorModel,getH:(x:number,z:number)=>number,origin:Vec3,exact=false):Vec3|null{
    const index=balloonObstacles(model,getH),starts=createWalkStart(model,getH);
    function assess(x:number,z:number):Vec3|null{
        if(Math.abs(x)>480||Math.abs(z)>480)return null;
        const h=getH(x,z);if(!starts.assess(x,z).safe)return null;
        for(let i=0;i<12;i++){
            const a=i*Math.PI/6,px=x+Math.cos(a)*2,pz=z+Math.sin(a)*2,y=getH(px,pz);
            if(Math.abs(y-h)>.42||y<=waterLevelAt(model.state.water,model.world.waterBodies,px,pz)+.5)return null;
        }
        if(index.overlaps({x,z,radius:10,minY:h+.2,maxY:h+33},.4))return null;
        return [x,h,z];
    }
    const first=assess(origin[0],origin[2]);if(first||exact)return first;
    for(let r=10;r<=240;r+=10)for(let i=0,n=Math.min(64,Math.ceil(r*.7));i<n;i++){
        const a=i/n*Math.PI*2,point=assess(origin[0]+Math.cos(a)*r,origin[2]+Math.sin(a)*r);if(point)return point;
    }
    return null;
}
