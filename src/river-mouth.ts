import {createCoastlineField} from './coastline';
import {SIZE,type EditorState} from './state';
import {waterPath} from './water-math';
import type {WaterBody,Vec2} from './world';

/** Extend the downstream reach through a coastal outlet, with a short falling sheet above sea level. */
export function connectRiverToSea(s:EditorState,body:WaterBody):WaterBody{
    if(body.kind!=='river'||body.outlet!==undefined||body.points.length<2||body.level<s.water)return body;
    const points=body.flowDirection===-1?[...body.points].reverse():[...body.points];
    const last=points.at(-1)!,previous=points.at(-2)!,length=Math.hypot(last[0]-previous[0],last[1]-previous[1]);
    if(length<.01)return body;
    const dx=(last[0]-previous[0])/length,dz=(last[1]-previous[1])/length,size=SIZE*s.areaSize,shore=createCoastlineField(s.seed);
    const distance=(p:Vec2)=>shore(p[0]/size,p[1]/size)*size;
    const step=Math.max(1,Math.min(4,body.width/2)),margin=(body.bankWidth??8)+body.width/2+SIZE/s.N;
    let lip:Vec2|undefined,end:Vec2|undefined;
    for(let travel=step;travel<=size;travel+=step){
        const p:Vec2=[last[0]+dx*travel,last[1]+dz*travel];
        if(Math.max(Math.abs(p[0]),Math.abs(p[1]))>SIZE/2-step)break;
        const d=distance(p);if(!lip&&d<=margin)lip=p;
        if(d<-Math.max(body.width,SIZE/s.N)){end=p;break;}
    }
    if(!lip||!end)return body;
    const levels=points.map(p=>waterPath(body,...p).level),lastLevel=levels.at(-1)!;
    if(lastLevel<s.water)return body;
    points.push(lip);levels.push(lastLevel);
    const outlet=points.length-1,drop=lastLevel-s.water,available=Math.hypot(end[0]-lip[0],end[1]-lip[1]);
    if(drop>.75){
        // A compact ballistic arc, sampled explicitly so even coarse terrain renders the fall.
        const run=Math.min(available*.7,Math.max(.4,Math.min(body.width*.35,drop*.3)));
        for(const t of [.25,.5,.75,1]){points.push([lip[0]+dx*run*t,lip[1]+dz*run*t]);levels.push(lastLevel-drop*t*t);}
    }
    points.push(end);levels.push(s.water);
    return {...body,points,pointLevels:levels,outlet,flowDirection:1,endLevel:s.water};
}
