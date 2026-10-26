import type * as T from 'three';

export const GRAPHIC_FILTERS={none:'Без фильтра',monochrome:'Чёрно-белое кино'} as const;
export type GraphicFilter=keyof typeof GRAPHIC_FILTERS;

/** Applied after lighting, fog and output conversion, including custom water/sky shaders.
 * Shared uniforms avoid shader recompilation when switching looks. Offscreen captures
 * retain colour so reflections and underwater compositing are graded only once. */
export function createGraphicFilters(renderer:T.WebGLRenderer,read:()=>GraphicFilter){
    const amount={value:0},bound=new WeakSet<T.Material>();
    function decorate(material:T.Material){
        if(bound.has(material))return;bound.add(material);
        const previous=material.onBeforeCompile.bind(material),key=material.customProgramCacheKey();
        material.onBeforeCompile=(shader,r)=>{
            previous(shader,r);shader.uniforms.uTerragenMonochrome=amount;
            const end=shader.fragmentShader.lastIndexOf('}');
            if(end<0)return;
            shader.fragmentShader='uniform float uTerragenMonochrome;\n'+shader.fragmentShader.slice(0,end)+`
if(uTerragenMonochrome>.5){
    float luminance=dot(max(gl_FragColor.rgb,vec3(0.0)),vec3(.2126,.7152,.0722));
    // A gentle film contrast curve preserves white clouds and dark rock detail.
    float film=clamp((luminance-.5)*1.08+.5,0.0,1.0);
    gl_FragColor.rgb=vec3(film);
}
`+shader.fragmentShader.slice(end);
        };
        material.customProgramCacheKey=()=>key+'/graphic-filters-v1';material.needsUpdate=true;
    }
    const original=renderer.render.bind(renderer);
    renderer.render=(scene,camera)=>{
        scene.traverse(object=>{const materials=(object as T.Mesh).material;if(materials)for(const material of Array.isArray(materials)?materials:[materials])decorate(material);});
        const target=renderer.getRenderTarget();
        const screen=target===null||renderer.xr?.enabled&&renderer.xr.isPresenting&&(target as T.WebGLRenderTarget&{isXRRenderTarget?:boolean}).isXRRenderTarget;
        const previous=amount.value;amount.value=screen&&read()==='monochrome'?1:0;
        try{original(scene,camera);}finally{amount.value=previous;}
    };
    return {decorate};
}
