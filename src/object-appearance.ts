import type {Color} from 'three';
import type {WorldObject} from './world';
import {isNaturalAsset} from './natural-models';

function hash(text:string){let value=2166136261;for(let i=0;i<text.length;i++)value=Math.imul(value^text.charCodeAt(i),16777619);return value>>>0;}
/** Derived from immutable identity, never camera distance, iteration order or animation time. */
export function objectColor(item:Pick<WorldObject,'id'|'asset'|'tint'>,target:Color){
    if(!isNaturalAsset(item.asset))return target.setRGB(item.tint,item.tint,item.tint);
    const h=hash(item.id+'/'+item.asset),warm=(h&255)/255-.5,light=((h>>>8)&255)/255-.5;
    return target.setRGB(item.tint*(1+warm*.12+light*.08),item.tint*(1+light*.08),item.tint*(1-warm*.12+light*.08));
}
/** Real document scales: physics, path clearance, editing and export see the same proportions. */
export function naturalScale(asset:string,size:number,x:number,z:number):[number,number,number]{
    if(!isNaturalAsset(asset))return [size,size,size];
    const h=hash(asset+'/'+x.toFixed(4)+'/'+z.toFixed(4)),a=(h&255)/255-.5,b=((h>>>8)&255)/255-.5;
    return [size*(1+a*.16),size*(1+b*.22),size*(1-a*.12)];
}
