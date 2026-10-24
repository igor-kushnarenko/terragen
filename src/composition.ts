import { mulberry32, clamp } from './noise';
import { HALF, SIZE, type EditorState } from './state';
import { localWater, type HeightFeature } from './landscape-compute';
import { sampleHeight, trailCurve } from './trail-math';
import type { BiomeRegion, LandscapePoint, Vec2, WorldData, WorldObject, WorldRoute } from './world';
export interface PathObstacle { x:number; z:number; radius:number; }
export function worldId(world:WorldData) {
    const ids=new Set([...world.objects,...world.groups,...world.viewpoints,...world.biomes,...world.routes,...world.waterBodies,...world.landmarks].map(p=>p.id));
    return (base:string)=>{let id=base,index=1;while(ids.has(id))id=base+'-'+index++;ids.add(id);return id;};
}
export function planComposition(settings:EditorState,heights:Float32Array,seed:number,world:WorldData,obstacles:PathObstacle[]=[]){
    const random=mulberry32(seed),angle=random()*Math.PI*2,cos=Math.cos(angle),sin=Math.sin(angle),id=worldId(world);
    const scale=settings.areaSize,extent=HALF*scale;
    const rotate=(x:number,z:number):Vec2=>[(x*cos-z*sin)*scale,(x*sin+z*cos)*scale];
    function location(target:Vec2,high=false):Vec2{
        let best=target,score=Infinity;
        const coastal=high&&world.preset==='coast';
        const margin=Math.max(80*scale,SIZE/settings.N*2+8*scale);
        if(margin>=extent)throw new Error('Для маленького острова нужна более подробная сетка: выберите 128, 256 или 512.');
        function consider(x:number,z:number){
            x=clamp(x,-extent+margin,extent-margin);z=clamp(z,-extent+margin,extent-margin);const h=sampleHeight(heights,settings.N,x,z);
            if(h<localWater(settings.water,world.waterBodies,x,z)+3 || obstacles.some(o=>Math.hypot(x-o.x,z-o.z)<o.radius+30*scale))return;
            let waterDistance=1000;
            if(coastal)for(const distance of [20,40,60,80].map(d=>d*scale))for(let direction=0;direction<8;direction++){
                const a=direction/8*Math.PI*2;if(sampleHeight(heights,settings.N,x+Math.cos(a)*distance,z+Math.sin(a)*distance)<=settings.water+0.5)waterDistance=Math.min(waterDistance,distance);
            }
            const value=coastal?Math.hypot(x-target[0],z-target[1])*0.12+waterDistance*3-h*0.05:Math.hypot(x-target[0],z-target[1])*(high?0.25:1)+(high?-h:Math.abs(h-(settings.water+settings.height*0.25))*0.35);
            if(value<score){score=value;best=[x,z];}
        }
        for(let j=-4;j<=4;j++)for(let i=-4;i<=4;i++)consider(target[0]+i*18*scale,target[1]+j*18*scale);
        if(score===Infinity||coastal)for(let z=-extent+margin;z<=extent-margin;z+=20*scale)for(let x=-extent+margin;x<=extent-margin;x+=20*scale)consider(x,z);
        if(score===Infinity)throw new Error('Для композиции не хватает свободной сухой местности. Измените сид или уровень воды.');
        return best;
    }
    const landmarks:LandscapePoint[]=[
        {id:id('composition-glade-a'),name:'Большая поляна',kind:'glade',position:location(rotate(-210,-110)),radius:54*scale},
        {id:id('composition-glade-b'),name:'Тихая поляна',kind:'glade',position:location(rotate(160,-150)),radius:40*scale},
        {id:id('composition-valley'),name:'Зелёная долина',kind:'valley',position:location(rotate(0,0)),radius:110*scale},
        {id:id('composition-view'),name:'Видовая площадка',kind:'viewpoint',position:location(rotate(210,170),true),radius:30*scale},
        {id:id('composition-landmark'),name:'Каменный ориентир',kind:'landmark',position:location(rotate(-130,190)),radius:22*scale},
    ];
    const valley=landmarks[2],floor=Math.max(settings.water+5,sampleHeight(heights,settings.N,...valley.position)*0.78);
    const features:HeightFeature[]=[{kind:'valley',points:[rotate(-190,0),valley.position,rotate(190,25)],radius:105*scale,height:floor}];
    for(const p of landmarks)if(p.kind!=='valley')features.push({kind:'pad',points:[p.position],radius:p.radius,height:Math.max(settings.water+5,sampleHeight(heights,settings.N,...p.position))});
    const biomes:BiomeRegion[]=landmarks.map(p=>({id:id(p.id+'-biome'),name:p.name,kind:p.kind==='valley'?'valley':'meadow',center:p.position,radius:p.kind==='viewpoint'?45*scale:p.radius,source:'composition'}));
    const p=landmarks[4].position,objects:WorldObject[]=[{id:id('composition-stone'),asset:'boulder',source:'composition',position:[clamp(p[0]+Math.max(6,25*scale),-extent+4,extent-4),0,p[1]],rotation:[0,angle,0],scale:[3.5*scale,4.5*scale,3.5*scale],groundOffset:-0.5*scale,followTerrain:true,tint:1.05}];
    return {landmarks,features,biomes,objects,edges:[[0,2],[2,1],[2,3],[2,4]] as [number,number][]};
}
class Queue {
    private items:{node:number;cost:number}[]=[];
    push(node:number,cost:number){let i=this.items.length;this.items.push({node,cost});while(i){const p=(i-1)>>1;if(this.items[p].cost<=cost)break;this.items[i]=this.items[p];i=p;}this.items[i]={node,cost};}
    pop(){const head=this.items[0],tail=this.items.pop()!;if(this.items.length){let i=0;while(i*2+1<this.items.length){let c=i*2+1;if(c+1<this.items.length&&this.items[c+1].cost<this.items[c].cost)c++;if(tail.cost<=this.items[c].cost)break;this.items[i]=this.items[c];i=c;}this.items[i]=tail;}return head;}
    get length(){return this.items.length;}
}
/** A* favors gentle dry terrain, keeping solid authored objects outside the corridor. */
export function connectPoints(settings:EditorState,heights:Float32Array,world:WorldData,start:Vec2,end:Vec2,width:number,obstacles:PathObstacle[]):Vec2[]{
    const extent=HALF*settings.areaSize,count=65,cell=extent*2/(count-1),size=count*count,margin=Math.max(2,Math.ceil((width/2+SIZE/settings.N*2+2)/cell));
    const index=(p:Vec2)=>clamp(Math.round((p[1]+extent)/cell),margin,count-1-margin)*count+clamp(Math.round((p[0]+extent)/cell),margin,count-1-margin);
    const a=index(start),b=index(end),cost=new Float64Array(size).fill(Infinity),parent=new Int32Array(size).fill(-1),closed=new Uint8Array(size),H=new Float32Array(size),blocked=new Uint8Array(size);
    for(let k=0;k<size;k++){const x=-extent+k%count*cell,z=-extent+Math.floor(k/count)*cell;H[k]=sampleHeight(heights,settings.N,x,z);
        blocked[k]=Number(k%count<margin||k%count>count-1-margin||Math.floor(k/count)<margin||Math.floor(k/count)>count-1-margin||H[k]<=localWater(settings.water,world.waterBodies,x,z)+1||obstacles.some(o=>Math.hypot(x-o.x,z-o.z)<o.radius+width/2+Math.max(2,cell*0.7)));}
    blocked[a]=blocked[b]=0;const queue=new Queue();cost[a]=0;queue.push(a,0);
    while(queue.length){const current=queue.pop().node;if(closed[current])continue;closed[current]=1;if(current===b)break;
        const x=current%count,z=Math.floor(current/count);
        for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++){
            if(!dx&&!dz||x+dx<0||x+dx>=count||z+dz<0||z+dz>=count)continue;
            const next=(z+dz)*count+x+dx;if(blocked[next]||closed[next]||dx&&dz&&(blocked[z*count+x+dx]||blocked[(z+dz)*count+x]))continue;
            const distance=Math.hypot(dx,dz)*cell,grade=Math.abs(H[next]-H[current])/distance,value=cost[current]+distance*(1+grade*grade*14)+Math.abs(H[next]-H[current])*2;
            if(value<cost[next]){cost[next]=value;parent[next]=current;queue.push(next,value+Math.hypot(next%count-b%count,Math.floor(next/count)-Math.floor(b/count))*cell);}
        }
    }
    if(!Number.isFinite(cost[b]))throw new Error('Не удалось связать композицию сухими маршрутами: вода или препятствия перекрывают путь.');
    const path:Vec2[]=[];for(let k=b;k!==-1;k=parent[k])path.push([-extent+k%count*cell,-extent+Math.floor(k/count)*cell]);path.reverse();path[0]=start;path[path.length-1]=end;
    // Preserve turns; discard collinear grid nodes without cutting across obstacles.
    const controls=path.filter((p,i)=>!i||i===path.length-1||(p[0]-path[i-1][0])*(path[i+1][1]-p[1])!==(p[1]-path[i-1][1])*(path[i+1][0]-p[0]));
    if(controls.length>64)throw new Error('Маршрут слишком сложный: уменьшите число препятствий.');
    return controls;
}
export function compositionRoutes(settings:EditorState,heights:Float32Array,world:WorldData,plan:ReturnType<typeof planComposition>,obstacles:PathObstacle[]):WorldRoute[]{
    const id=worldId(world);
    const width=Math.max(2,8*settings.areaSize);
    return plan.edges.map(([a,b],i)=>{
        const controlPoints=connectPoints(settings,heights,world,plan.landmarks[a].position,plan.landmarks[b].position,width,obstacles);
        return {id:id('composition-trail-'+i),name:plan.landmarks[a].name+' — '+plan.landmarks[b].name,kind:'trail',width,controlPoints,curve:'centripetal',points:trailCurve(controlPoints,Math.max(1,SIZE/settings.N/2)),surface:world.preset==='coast'?'sand':'gravel',maxGrade:Math.tan(20*Math.PI/180),source:'composition'};
    });
}
