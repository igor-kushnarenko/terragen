import type * as T from 'three';

export const GRAPHIC_FILTERS={none:'Без фильтра',monochrome:'Чёрно-белое кино',atlantic:'Северная Атлантика',film35:'Плёнка 35 мм',expedition:'Старая экспедиция'} as const;
export type GraphicFilter=keyof typeof GRAPHIC_FILTERS;
export const FILTER_CODES:Record<GraphicFilter,number>={none:0,monochrome:1,atlantic:2,film35:3,expedition:4};
export interface FilterOptions {intensity:number;grain:boolean;}

/** Applied after lighting, fog and output conversion, including custom water/sky shaders.
 * Shared uniforms avoid shader recompilation when switching looks. Offscreen captures
 * retain colour so reflections and underwater compositing are graded only once. */
export function createGraphicFilters(renderer:T.WebGLRenderer,read:()=>GraphicFilter,options:()=>FilterOptions=()=>({intensity:1,grain:false})){
    const amount={value:0},mode={value:0},grain={value:0},time={value:0},bound=new WeakSet<T.Material>();
    function decorate(material:T.Material){
        if(bound.has(material))return;bound.add(material);
        const previous=material.onBeforeCompile.bind(material),key=material.customProgramCacheKey();
        material.onBeforeCompile=(shader,r)=>{
            previous(shader,r);Object.assign(shader.uniforms,{uTerragenMonochrome:amount,uTerragenLook:mode,uTerragenGrain:grain,uTerragenFilmTime:time});
            const end=shader.fragmentShader.lastIndexOf('}');
            if(end<0)return;
            shader.fragmentShader='uniform float uTerragenMonochrome,uTerragenLook,uTerragenGrain,uTerragenFilmTime;\n'+shader.fragmentShader.slice(0,end)+`
if(uTerragenMonochrome>0.0){
    vec3 source=max(gl_FragColor.rgb,vec3(0.0));
    float luminance=dot(source,vec3(.2126,.7152,.0722));
    float shadows=1.0-smoothstep(.08,.65,luminance);
    float highlights=smoothstep(.45,.95,luminance);
    vec3 graded=source;
    if(uTerragenLook<1.5){
        graded=vec3(clamp((luminance-.5)*1.08+.5,0.0,1.0));
    }else if(uTerragenLook<2.5){
        // Cold sea light, muted greens, deep but readable rock shadows.
        graded=mix(vec3(luminance),source,.58);
        graded=(graded-.5)*1.10+.5;
        graded*=mix(vec3(.87,.97,1.09),vec3(.98,1.0,1.02),highlights);
        graded+=vec3(-.008,.003,.012)*shadows;
    }else if(uTerragenLook<3.5){
        // Film shoulder softens highlights; a lifted toe retains dark detail.
        graded=mix(vec3(luminance),source,.88);
        graded=graded*.92+.025;
        graded+=vec3(.030,.014,-.008)*highlights;
        graded+=vec3(-.008,.002,.012)*shadows;
    }else{
        // Faded expedition stock: earthy colour, warm light, olive shadows.
        graded=mix(vec3(luminance),source,.62)*.88+.045;
        graded+=vec3(.045,.023,-.022)*highlights;
        graded+=vec3(.004,.012,-.008)*shadows;
    }
    if(uTerragenGrain>0.0&&uTerragenLook>2.5){
        vec2 cell=gl_FragCoord.xy+vec2(uTerragenFilmTime*37.0,uTerragenFilmTime*13.0);
        float noise=fract(sin(dot(cell,vec2(12.9898,78.233)))*43758.5453)-.5;
        graded+=vec3(noise*.025*uTerragenGrain*(1.0-highlights*.65));
    }
    gl_FragColor.rgb=mix(source,clamp(graded,0.0,1.0),uTerragenMonochrome);
}
`+shader.fragmentShader.slice(end);
        };
        material.customProgramCacheKey=()=>key+'/graphic-filters-v2';material.needsUpdate=true;
    }
    const original=renderer.render.bind(renderer);
    renderer.render=(scene,camera)=>{
        scene.traverse(object=>{const materials=(object as T.Mesh).material;if(materials)for(const material of Array.isArray(materials)?materials:[materials])decorate(material);});
        const target=renderer.getRenderTarget();
        const screen=target===null||renderer.xr?.enabled&&renderer.xr.isPresenting&&(target as T.WebGLRenderTarget&{isXRRenderTarget?:boolean}).isXRRenderTarget;
        const previous=[amount.value,mode.value,grain.value,time.value],look=read(),settings=options();
        amount.value=screen&&look!=='none'?Math.max(0,Math.min(1,settings.intensity)):0;mode.value=FILTER_CODES[look];
        grain.value=settings.grain&&!renderer.xr?.isPresenting?1:0;time.value=Math.floor(performance.now()/48)%1024;
        try{original(scene,camera);}finally{[amount.value,mode.value,grain.value,time.value]=previous;}
    };
    return {decorate};
}
