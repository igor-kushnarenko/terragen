import {mulberry32} from './noise';

interface Summit {x:number;z:number;radius:number;aspect:number;cos:number;sin:number;height:number;phase:number;}
/** Two-dimensional summits avoid the thin walls produced by abs(noise)'s
 * entire zero contours. Overlapping, irregular bases create passes and valleys. */
export function createMountainField(seed:number,sharpness:number){
    const features=new Map<string,Summit>(),neighborhoods=new Map<string,Summit[]>();
    const rounding=.015+.22*(1-sharpness)**2,range=Math.sqrt(1+rounding*rounding)-rounding;
    const exponent=1+2.4*sharpness**1.6;
    function summit(x:number,z:number){
        const key=x+','+z,cached=features.get(key);if(cached)return cached;
        const random=mulberry32(seed^Math.imul(x,0x632be5ab)^Math.imul(z,0x85157af5)),angle=random()*Math.PI*2;
        const p={x:x+.1+random()*.8,z:z+.1+random()*.8,radius:.7+random()*.5,aspect:.7+random()*.65,cos:Math.cos(angle),sin:Math.sin(angle),height:.3+.7*random()**.6,phase:random()*Math.PI*2};
        features.set(key,p);return p;
    }
    return(x:number,z:number)=>{
        x*=3;z*=3;
        const cx=Math.floor(x),cz=Math.floor(z),key=cx+','+cz;
        let peaks=neighborhoods.get(key);
        if(!peaks){
            // Bound caches even for imported legacy settings with very small scales.
            if(neighborhoods.size>4096){neighborhoods.clear();features.clear();}
            peaks=[];for(let j=-2;j<=2;j++)for(let i=-2;i<=2;i++)peaks.push(summit(cx+i,cz+j));neighborhoods.set(key,peaks);
        }
        let height=0;
        for(const p of peaks){
            const dx=x-p.x,dz=z-p.z;
            const u0=(dx*p.cos+dz*p.sin)*p.aspect/p.radius,v0=(-dx*p.sin+dz*p.cos)/(p.aspect*p.radius);
            if(u0*u0+v0*v0>1.4)continue;
            const u=u0+.06*(Math.sin(v0*4+p.phase)-Math.sin(p.phase)),v=v0+.06*(Math.sin(u0*3-p.phase)+Math.sin(p.phase)),d2=u*u+v*v;
            if(d2>=1)continue;
            const distance=(Math.sqrt(d2+rounding*rounding)-rounding)/range;
            height=Math.max(height,p.height*(1-distance)**exponent);
        }
        return height;
    };
}
