import * as T from 'three';
export const FINE_PLANT_IDS=['grass','flowers','fern','moss','jungle-herb','jungle-fungi','jungle-seedling','jungle-fern','taiga-lichen','taiga-sphagnum','taiga-litter','taiga-cones','taiga-seedling'] as const;
export const isFinePlantAsset=(id:string)=>FINE_PLANT_IDS.includes(id as typeof FINE_PLANT_IDS[number]);
export function plantGeometry(kind: number) {
    const vertices: number[] = [], colors: number[] = [];
    function triangle(a: number[], b: number[], c: number[], color: number) {
        vertices.push(...a, ...b, ...c); const rgb = new T.Color(color);
        for (let i = 0; i < 3; i++) colors.push(rgb.r, rgb.g, rgb.b);
    }
    if(kind===8||kind===9){
        for(let i=0;i<14;i++){const a=i*2.39996,r=.07+(i%4)*.055,x=Math.cos(a)*r,z=Math.sin(a)*r,h=kind===9?.10:.14;
            for(let k=0;k<3;k++){const b=a+k*2.1;triangle([x,.02,z],[x+Math.cos(b)*.07,h*(.6+(i%3)*.2),z+Math.sin(b)*.07],[x+Math.cos(b+.8)*.10,.02,z+Math.sin(b+.8)*.10],kind===9?(i%2?0x7b8651:0x8f9258):(i%2?0xa7ac95:0x8b9983));}}
    }else if(kind===10){
        for(let i=0;i<18;i++){const a=i*2.39996,x=Math.cos(i*7)*.3,z=Math.sin(i*9)*.3;triangle([x,.015,z],[x+.015,.02,z+.01],[x+Math.cos(a)*.18,.02,z+Math.sin(a)*.18],i%3?0x82734e:0x635b40);}
        triangle([-.35,.02,-.1],[.3,.03,.14],[.32,.055,.10],0x70614a);
    }else if(kind===11){
        for(let i=0;i<7;i++){const a=i/7*Math.PI*2,b=(i+1)/7*Math.PI*2;triangle([0,.18,0],[Math.cos(a)*.065,.02,Math.sin(a)*.065],[Math.cos(b)*.065,.02,Math.sin(b)*.065],i%2?0x857153:0x6e5b41);}
    }else if(kind===12){
        triangle([-.018,0,0],[.018,0,0],[0,1.3,0],0x7c6d51);
        for(let j=0;j<5;j++)for(let i=0;i<5;i++){const a=i*1.257+j*2.4,r=.4*(1-j/5),y=.28+j*.2;for(const s of [-1,1])triangle([0,y+.04,0],[Math.cos(a)*r,y-.1,Math.sin(a)*r],[Math.cos(a+s*.65)*r*.6,y-.02,Math.sin(a+s*.65)*r*.6],i%2?0x526d4b:0x3d6045);}
    }else if(kind===5){
        for(let m=0;m<3;m++){
            const x=(m-1)*.11,z=(m%2)*.12,y=.14+m*.035;
            triangle([x-.015,0,z],[x+.015,0,z],[x,y,z],0xb4a687);
            for(let i=0;i<8;i++){const a=i/8*Math.PI*2,b=(i+1)/8*Math.PI*2;triangle([x,y+.035,z],[x+Math.cos(a)*.085,y,z+Math.sin(a)*.085],[x+Math.cos(b)*.085,y,z+Math.sin(b)*.085],m%2?0x9d7f50:0xb69463);}
        }
    }else if(kind===4||kind===6||kind===7){
        const count=kind===6?4:kind===7?8:6;
        for(let i=0;i<count;i++){
            const a=i*2.39996,length=kind===6?.19:kind===7?.75:.42,width=kind===7?.14:kind===6?.07:.15;
            const h=kind===6?.18:kind===7?.55:.32;
            const base=[0,kind===6?.13:.04,0],tip=[Math.cos(a)*length,h*.65,Math.sin(a)*length],mid=[Math.cos(a)*length*.45,h,Math.sin(a)*length*.45];
            const left=[mid[0]-Math.sin(a)*width,mid[1]-.06,mid[2]+Math.cos(a)*width],right=[mid[0]+Math.sin(a)*width,mid[1]-.06,mid[2]-Math.cos(a)*width];
            triangle(base,left,mid,0x496f37);triangle(base,mid,right,0x5a803e);triangle(mid,left,tip,0x4e7c3e);triangle(mid,tip,right,0x608944);
            if(kind===7)for(let k=1;k<=4;k++){const t=k/5,r=length*t,y=h*Math.sin(t*Math.PI)*.9;for(const sign of [-1,1])triangle([Math.cos(a)*r,y,Math.sin(a)*r],[Math.cos(a)*r-Math.sin(a)*.20*sign,y-.06,Math.sin(a)*r+Math.cos(a)*.20*sign],[Math.cos(a)*(r+.10),y+.02,Math.sin(a)*(r+.10)],0x47723a);}
        }
    } else if (kind === 0) {
        for (let i = 0; i < 5; i++) { const angle = i * 2.4, x = Math.cos(angle) * 0.13, z = Math.sin(angle) * 0.13; triangle([x - 0.04, 0, z], [x + 0.04, 0, z], [x + Math.cos(angle) * 0.19, 0.30 + i * 0.045, z + Math.sin(angle) * 0.19], i%2?0x74804c:0x617548); }
    } else if (kind === 1) {
        triangle([-0.015, 0, 0], [0.015, 0, 0], [0, 0.5, 0], 0x517c37);
        for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2, b = (i + 1) / 6 * Math.PI * 2; triangle([0, 0.51, 0], [Math.cos(a) * 0.1, 0.46, Math.sin(a) * 0.1], [Math.cos(b) * 0.1, 0.46, Math.sin(b) * 0.1], i % 2 ? 0xefdc84 : 0xc0a6e0); }
    } else if (kind === 2) {
        for (let branch = 0; branch < 5; branch++) {
            const a = branch * 2.4;
            for (let leaf = 0; leaf < 5; leaf++) {
                const r = 0.07 + leaf * 0.085, x = Math.cos(a) * r, z = Math.sin(a) * r, y = 0.12 + Math.sin(r * 4) * 0.3;
                triangle([x, y, z], [x - Math.sin(a) * 0.13, y - 0.04, z + Math.cos(a) * 0.13], [x + Math.cos(a) * 0.08, y + 0.04, z + Math.sin(a) * 0.08], 0x417b39);
                triangle([x, y, z], [x + Math.sin(a) * 0.13, y - 0.04, z - Math.cos(a) * 0.13], [x + Math.cos(a) * 0.08, y + 0.04, z + Math.sin(a) * 0.08], 0x4d883f);
            }
        }
    } else {
        for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2, b = (i + 1) / 8 * Math.PI * 2; triangle([0, 0.05, 0], [Math.cos(a) * 0.27, 0.015, Math.sin(a) * 0.27], [Math.cos(b) * 0.27, 0.015, Math.sin(b) * 0.27], 0x477333); }
    }
    const geometry = new T.BufferGeometry(); geometry.setAttribute('position', new T.Float32BufferAttribute(vertices, 3)); geometry.setAttribute('color', new T.Float32BufferAttribute(colors, 3)); geometry.computeVertexNormals(); return geometry;
}
