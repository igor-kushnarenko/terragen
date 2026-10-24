import {SIZE,type EditorModel} from './state';
import {sampleHeight} from './trail-math';
import type {LandscapePoint,WorldRoute} from './world';
import {waterLevelAt} from './water-math';

/** Only connect existing, walkable dry ground. Never build land bridges between islands. */
export function worldPaths(model:EditorModel,enabled:boolean){
    const count=65,cell=SIZE/(count-1),h=model.heights,N=model.N,water=model.state.water;
    const heights=new Float32Array(count*count),safe=new Uint8Array(count*count),seen=new Uint8Array(count*count);
    const point=(k:number):[number,number]=>[(k%count/(count-1)-.5)*SIZE,(Math.floor(k/count)/(count-1)-.5)*SIZE];
    for(let k=0;k<safe.length;k++){
        const [x,z]=point(k),y=sampleHeight(h,N,x,z);heights[k]=y;
        if(k%count<2||k%count>count-3||k<count*2||k>=count*(count-2)||y<waterLevelAt(water,model.world.waterBodies,x,z)+2)continue;
        const slope=Math.max(Math.abs(sampleHeight(h,N,x+3,z)-sampleHeight(h,N,x-3,z)),Math.abs(sampleHeight(h,N,x,z+3)-sampleHeight(h,N,x,z-3)))/6;
        safe[k]=Number(slope<.3);
    }
    const neighbours=(k:number)=>[k-1,k+1,k-count,k+count].filter(v=>v>=0&&v<safe.length&&safe[v]&&Math.abs(heights[k]-heights[v])/cell<.3);
    let largest:number[]=[];
    for(let k=0;k<safe.length;k++)if(safe[k]&&!seen[k]){
        const component=[k];seen[k]=1;
        for(let i=0;i<component.length;i++)for(const next of neighbours(component[i]))if(!seen[next]){seen[next]=1;component.push(next);}
        if(component.length>largest.length)largest=component;
    }
    if(!largest.length)return {landmarks:[] as LandscapePoint[],routes:[] as WorldRoute[]};
    const start=largest.reduce((a,b)=>Math.hypot(...point(a))<Math.hypot(...point(b))?a:b),parents=new Int32Array(safe.length).fill(-1),distance=new Int32Array(safe.length).fill(-1),queue=[start];distance[start]=0;
    for(let i=0;i<queue.length;i++)for(const next of neighbours(queue[i]))if(distance[next]<0){distance[next]=distance[queue[i]]+1;parents[next]=queue[i];queue.push(next);}
    const landmarks:LandscapePoint[]=[{id:'world-start',name:'Начало прогулки',kind:'glade',position:point(start),radius:6}],routes:WorldRoute[]=[];
    if(!enabled)return {landmarks,routes};
    const goals=[...queue].filter(k=>distance[k]>=4).sort((a,b)=>distance[b]-distance[a]);
    for(const goal of [goals[0],goals.find(k=>goals[0]!==undefined&&Math.hypot(...point(k).map((v,i)=>v-point(goals[0])[i]))>100)]){
        if(goal===undefined)continue;let path:number[]=[];for(let k=goal;k!==-1;k=parents[k])path.push(k);path.reverse();path=path.slice(0,25);
        const points=path.map(point);
        // Check the full corridor at terrain-cell spacing, not just the graph vertices.
        let valid=true;
        for(let i=1;i<points.length&&valid;i++){
            const a=points[i-1],b=points[i],dx=b[0]-a[0],dz=b[1]-a[1],steps=Math.ceil(cell/Math.max(1,SIZE/N/2));
            for(let j=0;j<=steps;j++){const t=j/steps,x=a[0]+dx*t,z=a[1]+dz*t;
                for(const offset of [-2,0,2]){const xx=x-dz/cell*offset,zz=z+dx/cell*offset;if(sampleHeight(h,N,xx,zz)<waterLevelAt(water,model.world.waterBodies,xx,zz)+1)valid=false;}
            }
        }
        if(!valid)continue;
        const index=routes.length+1;landmarks.push({id:'world-view-'+index,name:index===1?'Видовая точка':'Тихое место',kind:'viewpoint',position:points.at(-1)!,radius:6});
        routes.push({id:'world-route-'+index,name:'Прогулочный маршрут '+index,kind:'trail',source:'composition',width:3,points,surface:model.world.preset==='desert'||model.world.preset==='archipelago'?'sand':'soil'});
    }
    return {landmarks,routes};
}
