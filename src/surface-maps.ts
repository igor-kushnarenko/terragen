import {DataArrayTexture,RGBAFormat,UnsignedByteType,LinearFilter,LinearMipmapLinearFilter,NoColorSpace,RepeatWrapping} from 'three';
export const SURFACE_TILE=128;
const clamp=(n:number)=>Math.min(1,Math.max(0,n));
const hash=(x:number,y:number,seed:number)=>{let n=Math.imul(x+seed*17,374761393)^Math.imul(y-seed*11,668265263);n=Math.imul(n^(n>>>13),1274126177);return ((n^(n>>>16))>>>0)/4294967296;};
function noiseGrid(size:number,seed:number){return Float32Array.from({length:size*size},(_,i)=>hash(i%size,Math.floor(i/size),seed));}
function periodicNoise(grid:Float32Array,size:number,x:number,y:number){
    const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy,u=fx*fx*(3-2*fx),v=fy*fy*(3-2*fy);
    const sample=(a:number,b:number)=>grid[((b%size+size)%size)*size+(a%size+size)%size];
    return (sample(ix,iy)*(1-u)+sample(ix+1,iy)*u)*(1-v)+(sample(ix,iy+1)*(1-u)+sample(ix+1,iy+1)*u)*v;
}

/** All structure is baked once. The eight 128² layers and their GPU sampling budget stay unchanged. */
let baked:{albedo:Uint8Array;detail:Uint8Array}|undefined;
function bakeSurfaceMaps(){
    const side=SURFACE_TILE,albedo=new Uint8Array(side*side*8*4),detail=new Uint8Array(albedo.length);
    const palettes=[[114,124,75],[139,135,123],[188,174,139],[229,232,230],[102,88,61],[118,99,75],[143,139,125],[97,117,69]];
    const leaves=Array.from({length:24},(_,i)=>{const angle=hash(i,1,14)*Math.PI*2;return {x:hash(i,2,14)*side,y:hash(i,3,14)*side,c:Math.cos(angle),s:Math.sin(angle),length:5+hash(i,4,14)*7,width:2+hash(i,5,14)*3,tone:hash(i,6,14)};});
    const grass=Array.from({length:46},(_,i)=>{const angle=hash(i,1,2)*Math.PI*2;return {x:hash(i,2,2)*side,y:hash(i,3,2)*side,c:Math.cos(angle),s:Math.sin(angle),length:3+hash(i,4,2)*8};});
    const stones=Array.from({length:144},(_,i)=>[hash(i%12,Math.floor(i/12),9),hash(i%12,Math.floor(i/12),10),hash(i%12,Math.floor(i/12),11)]);
    const delta=(n:number)=>n-Math.round(n/side)*side;
    for(let layer=0;layer<8;layer++){
        const broad=noiseGrid(4,layer+1),mid=noiseGrid(16,layer+31),fine=noiseGrid(64,layer+61),base=palettes[layer];
        for(let y=0;y<side;y++)for(let x=0;x<side;x++){
            const u=x/side,v=y/side,n0=periodicNoise(broad,4,u*4,v*4),n1=periodicNoise(mid,16,u*16,v*16),n2=periodicNoise(fine,64,u*64,v*64),grain=hash(x,y,layer);
            let h=.45+(n1-.5)*.13+(n2-.5)*.06,shade=.89+n0*.13+n1*.07+(grain-.5)*.035,rough=.91;
            let r=base[0],g=base[1],b=base[2];
            if(layer===0){
                for(const blade of grass){const dx=delta(x-blade.x),dy=delta(y-blade.y),along=dx*blade.c+dy*blade.s,across=-dx*blade.s+dy*blade.c;
                    const line=clamp(.9-Math.abs(across+along*along*.018))*clamp(blade.length-Math.abs(along));
                    shade+=line*.12;h+=line*.065;
                }
                r*=.94+n0*.10;b*=.93+n1*.10;
            }else if(layer===1){
                const wave=Math.sin(v*Math.PI*12+Math.sin(u*Math.PI*4)*.75+n0*.55),seam=Math.pow(clamp(1-Math.abs(wave)*8),2);
                h=.36+n0*.23+n1*.13+n2*.035-seam*.13;shade=.83+n0*.17+n1*.11-seam*.16;
                r+=n1*7;g+=n1*4;rough=.78+n2*.12;
            }else if(layer===2){
                const ripple=.5+.5*Math.sin(v*Math.PI*20+Math.sin(u*Math.PI*2)*.8);
                h=.44+ripple*.055+(n2-.5)*.045;shade=.92+(n0-.5)*.09+(grain-.5)*.07+ripple*.025;rough=.86+n2*.08;
            }else if(layer===3){
                h=.45+(n0-.5)*.07+(n2-.5)*.035;shade=.96+(n0-.5)*.045+(grain-.5)*.018;rough=.64+n2*.17;
            }else if(layer===4){
                for(const leaf of leaves){const dx=delta(x-leaf.x),dy=delta(y-leaf.y),a=(dx*leaf.c+dy*leaf.s)/leaf.length,c=(-dx*leaf.s+dy*leaf.c)/leaf.width;
                    const edge=clamp((1-a*a-c*c)*5);if(!edge)continue;
                    const vein=clamp(1-Math.abs(c)*9),crease=Math.sin(a*22+c*7)*.025;
                    r+=(133+leaf.tone*24-r)*edge;g+=(105+leaf.tone*15-g)*edge;b+=(63+leaf.tone*9-b)*edge;
                    h=h*(1-edge)+(.6+vein*.1+crease)*edge;shade*=1-edge*.06+vein*.09;
                }
                rough=.94;
            }else if(layer===5){
                const grit=clamp((n2-.68)*4),pore=clamp((.22-grain)*3);
                shade=.88+n0*.13+n1*.09+grit*.13-pore*.05;h=.42+n1*.12+grit*.13-pore*.025;rough=.87+n2*.10;
            }else if(layer===6){
                // The tile boundary runs through stone interiors rather than cell borders.
                const px=u*12+2.37,py=v*12+3.61;let first=99,second=99,tone=0;
                for(let j=-1;j<=1;j++)for(let i=-1;i<=1;i++){
                    const cx=Math.floor(px)+i,cy=Math.floor(py)+j,s=stones[((cy+12)%12)*12+(cx+12)%12],d=Math.hypot(px-cx-s[0],py-cy-s[1]);
                    if(d<first){second=first;first=d;tone=s[2];}else if(d<second)second=d;
                }
                const edge=clamp((second-first)*8),cap=clamp(1-first*1.1);h=.24+edge*.24+cap*.17;shade=.60+edge*.25+cap*.12;
                r*=.9+tone*.18;g*=.92+tone*.12;b*=.91+tone*.10;rough=.78+n2*.16;
            }else{
                const cushion=clamp((n1-.3)*1.8);h=.35+cushion*.27+n2*.035;shade=.86+n0*.11+cushion*.12;rough=.98;
            }
            const offset=(layer*side*side+y*side+x)*4;
            albedo.set([Math.round(r*shade),Math.round(g*shade),Math.round(b*shade),255],offset);
            detail.set([Math.round(clamp(h)*255),Math.round(clamp(rough)*255),0,255],offset);
        }
    }
    return {albedo,detail};
}
export function createSurfaceMaps(){
    const pixels=baked??=bakeSurfaceMaps();
    const texture=(bytes:Uint8Array)=>{
        const map=new DataArrayTexture(bytes,SURFACE_TILE,SURFACE_TILE,8);map.format=RGBAFormat;map.type=UnsignedByteType;map.colorSpace=NoColorSpace;
        map.wrapS=map.wrapT=RepeatWrapping;map.magFilter=LinearFilter;map.minFilter=LinearMipmapLinearFilter;map.generateMipmaps=true;map.needsUpdate=true;return map;
    };
    return {albedo:texture(pixels.albedo),detail:texture(pixels.detail)};
}
