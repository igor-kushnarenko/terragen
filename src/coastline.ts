import {fbm,makeSimplex,mulberry32,smoothstep} from './noise';
import {SIZE,type EditorState} from './state';

// Smooth Boolean operations round the joins of bays and peninsulas rather than
// leaving corners where two analytic outlines intersect.
const union=(a:number,b:number,width:number)=>{const h=Math.max(0,width-Math.abs(a-b))/width;return Math.max(a,b)+h*h*width*.25;};
const intersection=(a:number,b:number,width:number)=>-union(-a,-b,width);

/** Approximate signed shore distance in coordinates relative to the chosen map area. */
export function createCoastlineField(seed:number){
    const random=mulberry32(seed^0x5eac01),noise=makeSimplex(seed^0x2b9d63);
    const angle=random()*Math.PI*2,stretch=.85+random()*.3;
    const bays=Array.from({length:3},(_,i)=>({angle:angle+i*Math.PI*2/3+(random()-.5)*.3,width:.07+random()*.025}));
    const peninsulas=Array.from({length:2},(_,i)=>({angle:angle+Math.PI/3+i*Math.PI,width:.035+random()*.02,length:.39+random()*.04}));
    const islands=bays.slice(0,2).map(b=>({x:Math.cos(b.angle)*.43,z:Math.sin(b.angle)*.43,radius:.025+random()*.012,aspect:.75+random()*.5}));
    return (u:number,v:number)=>{
        const r=Math.hypot(u,v);
        const x=u+.018*noise(u*4+11,v*4-7),z=v+.018*noise(u*4-23,v*4+13);
        let field=.335-Math.hypot(x*stretch,z/stretch)+fbm(noise,u*4+3,v*4-5,2)*.055;
        for(const p of peninsulas){
            const along=x*Math.cos(p.angle)+z*Math.sin(p.angle),across=-x*Math.sin(p.angle)+z*Math.cos(p.angle);
            const nearest=Math.max(.22,Math.min(p.length,along));
            const taper=1-.5*smoothstep(.23,p.length,nearest);
            const bend=.025*Math.sin((nearest-.22)*14+p.angle)*(smoothstep(.2,.3,nearest));
            const width=p.width*taper*(1+noise(nearest*12+7,p.angle)*.15);
            field=union(field,width-Math.hypot(along-nearest,across-bend),.03);
        }
        for(const b of bays){
            const along=u*Math.cos(b.angle)+v*Math.sin(b.angle),across=-u*Math.sin(b.angle)+v*Math.cos(b.angle);
            const cut=(Math.hypot((along-.385)/.18,across/b.width)-1)*b.width;
            field=intersection(field,cut,.022);
        }
        // Keep enough connected interior for composition; offshore islands remain separated by bays.
        field=union(field,.225-r,.025);
        for(const island of islands){
            const ix=(u-island.x)/island.radius,iz=(v-island.z)/island.radius;
            const shore=island.radius*(1-Math.hypot(ix*island.aspect,iz/island.aspect)+noise(ix*.85+17,iz*.85-9)*.12);
            field=Math.max(field,shore);
        }
        return intersection(field,.475-r,.012);
    };
}
export function createCoastline(seed:number){const distance=createCoastlineField(seed);return(u:number,v:number)=>smoothstep(-.018,.018,distance(u,v));}

/** Shared coast for recipes: lower the land into a beach without filling existing seas or fjords. */
export function createCoastalHeight(s:EditorState){
    const shore=createCoastlineField(s.seed),cell=SIZE/s.N;
    const beach=Math.max(12*s.areaSize,cell),inland=Math.max(64*s.areaSize,3*cell),depth=Math.max(8,22*s.areaSize);
    return (height:number,u:number,v:number)=>{
        const distance=shore(u,v)*SIZE*s.areaSize;
        const coast=distance>0
            ?s.water+3*smoothstep(0,beach,distance)+Math.max(0,height-s.water-3)*smoothstep(beach,inland,distance)
            :s.water-depth*(1-Math.exp(distance*.22/depth));
        // Retain underwater channels, island gaps and the biome's original inland relief.
        return Math.min(height,coast);
    };
}
