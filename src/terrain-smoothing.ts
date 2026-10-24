/** A small, resolution-aware Gaussian removes detail the height grid cannot
 * represent. Applied before coast shaping, so small islands are not blurred away. */
export function smoothRelief(heights:Float32Array,N:number,sigma:number){
    const n=N+1,radius=Math.ceil(sigma*3),kernel:number[]=[];
    let sum=0;
    for(let d=-radius;d<=radius;d++){const weight=Math.exp(-d*d/(2*sigma*sigma));kernel.push(weight);sum+=weight;}
    for(let i=0;i<kernel.length;i++)kernel[i]/=sum;
    const intermediate=new Float32Array(heights.length),result=new Float32Array(heights.length);
    for(let j=0;j<n;j++)for(let i=0;i<n;i++){
        let height=0;for(let d=-radius;d<=radius;d++)height+=heights[j*n+Math.max(0,Math.min(N,i+d))]*kernel[d+radius];
        intermediate[j*n+i]=height;
    }
    for(let j=0;j<n;j++)for(let i=0;i<n;i++){
        let height=0;for(let d=-radius;d<=radius;d++)height+=intermediate[Math.max(0,Math.min(N,j+d))*n+i]*kernel[d+radius];
        result[j*n+i]=height;
    }
    return result;
}
