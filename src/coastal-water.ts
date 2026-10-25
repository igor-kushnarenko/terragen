import {createCoastlineField} from './coastline';
import {SIZE,type EditorState} from './state';
import type {WaterBody,Vec2} from './world';

/** Keep generated inland water and its banks on land, rather than building dams across new bays. */
export function fitCoastalWater(s:EditorState,bodies:WaterBody[]):WaterBody[]{
    if(s.areaSize===1&&!s.island)return bodies;
    const shore=createCoastlineField(s.seed),size=SIZE*s.areaSize,cell=SIZE/s.N;
    return bodies.flatMap(body=>{
        if(body.kind==='ocean')return [body];
        const margin=(body.bankWidth??8)+cell+(body.kind==='river'?body.width/2:0);
        const inland=([x,z]:Vec2)=>shore(x/size,z/size)*size>margin;
        if(body.kind==='lake'){
            if(body.points.every(inland))return [body];
            // A bay can replace a former basin. Move its lake inland, keeping its
            // shape and size, instead of losing the wetland character of the biome.
            const cx=body.points.reduce((sum,p)=>sum+p[0],0)/body.points.length;
            const cz=body.points.reduce((sum,p)=>sum+p[1],0)/body.points.length;
            for(let step=1;step<=10;step++){
                const points=body.points.map(([x,z]):Vec2=>[x-cx*step/10,z-cz*step/10]);
                if(points.every(inland))return [{...body,points}];
            }
            return [];
        }
        // Choose the longest continuous inland reach; never join disconnected reaches across sea.
        let start=0,bestStart=0,bestEnd=0;
        for(let i=0;i<=body.points.length;i++){
            if(i<body.points.length&&inland(body.points[i]))continue;
            if(i-start>bestEnd-bestStart){bestStart=start;bestEnd=i;}
            start=i+1;
        }
        if(bestEnd-bestStart<2)return [];
        const drop=(body.endLevel??body.level)-body.level;
        return [{...body,points:body.points.slice(bestStart,bestEnd),
            level:body.level+drop*bestStart/(body.points.length-1),
            endLevel:body.level+drop*(bestEnd-1)/(body.points.length-1)}];
    });
}
