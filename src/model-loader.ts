import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

export const LEGACY_SPEC_GLOSS='KHR_materials_pbrSpecularGlossiness';
interface TextureInfo {index:number;texCoord?:number;extensions?:Record<string,unknown>;}
interface LegacyMaterial {diffuseFactor?:number[];diffuseTexture?:TextureInfo;specularFactor?:number[];specularGlossinessTexture?:TextureInfo;glossinessFactor?:number;}
/** RGB is specular color in sRGB; only linear alpha encodes glossiness. */
export function glossToRoughness(pixels:Uint8ClampedArray,glossiness:number){
    if(!Number.isFinite(glossiness)||glossiness<0||glossiness>1)throw new Error('Некорректный блеск материала');
    const result=new Uint8ClampedArray(pixels.length);
    for(let i=0;i<pixels.length;i+=4){result[i]=255;result[i+1]=Math.round(255-glossiness*pixels[i+3]);result[i+2]=0;result[i+3]=255;}
    return result;
}
export function createModelLoader(manager=new T.LoadingManager()){
    return new GLTFLoader(manager).register(parser=>{
        const legacy=new Map<number,LegacyMaterial>(),canvases=new Map<string,Promise<HTMLCanvasElement>>();
        function roughness(source:T.Texture,factor:number){
            const key=source.source.uuid+'/'+factor;let canvas=canvases.get(key);
            if(!canvas){canvas=Promise.resolve().then(()=>{
                const image=source.image as CanvasImageSource&{width:number;height:number},c=document.createElement('canvas');c.width=image.width;c.height=image.height;
                if(!c.width||!c.height)throw new Error('Не удалось прочитать текстуру блеска');
                const context=c.getContext('2d',{willReadFrequently:true});if(!context)throw new Error('Не удалось преобразовать текстуру материала');
                context.drawImage(image,0,0);const data=context.getImageData(0,0,c.width,c.height);data.data.set(glossToRoughness(data.data,factor));context.putImageData(data,0,0);return c;
            });canvases.set(key,canvas);}
            return canvas.then(image=>{const map=source.clone();map.source=new T.Source(image);map.colorSpace=T.NoColorSpace;map.userData={...source.userData,mimeType:'image/png'};map.needsUpdate=true;return map;});
        }
        return {
            name:LEGACY_SPEC_GLOSS,
            beforeRoot(){
                parser.json.materials?.forEach((material:Record<string,any>,index:number)=>{
                    const old=material.extensions?.[LEGACY_SPEC_GLOSS] as LegacyMaterial|undefined;if(!old)return;legacy.set(index,old);
                    // Khronos' spec/gloss mapping: IOR=0 gives F0=1, scaled by the
                    // original specular RGB. Keep the diffuse image/factor and alpha intact.
                    material.pbrMetallicRoughness={baseColorFactor:old.diffuseFactor??[1,1,1,1],...(old.diffuseTexture?{baseColorTexture:old.diffuseTexture}:{}),metallicFactor:0,roughnessFactor:1-(old.glossinessFactor??1)};
                    material.extensions.KHR_materials_ior={ior:0};
                    material.extensions.KHR_materials_specular={specularColorFactor:old.specularFactor??[1,1,1],...(old.specularGlossinessTexture?{specularColorTexture:old.specularGlossinessTexture}:{})};
                    delete material.extensions[LEGACY_SPEC_GLOSS];
                });
                if(legacy.size){parser.json.extensionsUsed=[...new Set([...(parser.json.extensionsUsed??[]).filter((s:string)=>s!==LEGACY_SPEC_GLOSS),'KHR_materials_ior','KHR_materials_specular'])];if(parser.json.extensionsRequired)parser.json.extensionsRequired=parser.json.extensionsRequired.filter((s:string)=>s!==LEGACY_SPEC_GLOSS);}
                return null;
            },
            async extendMaterialParams(index:number,params:Record<string,any>){
                const old=legacy.get(index);if(!old?.specularGlossinessTexture)return;
                const scratch:Record<string,T.Texture>={};await parser.assignTexture(scratch,'map',old.specularGlossinessTexture,T.SRGBColorSpace);
                if(!scratch.map)throw new Error('Не удалось загрузить текстуру блеска материала');
                params.roughnessMap=await roughness(scratch.map,old.glossinessFactor??1);params.roughness=1;
            },
            afterRoot(){
                // GLTFLoader otherwise resolves failed images as null and silently renders white.
                for(const [item,reference]of parser.associations){
                    if(!(item instanceof T.Material)||reference.materials===undefined)continue;
                    const def=parser.json.materials[reference.materials],pbr=def.pbrMetallicRoughness??{},spec=def.extensions?.KHR_materials_specular??{};
                    const slots=[['map',pbr.baseColorTexture],['normalMap',def.normalTexture],['aoMap',def.occlusionTexture],['emissiveMap',def.emissiveTexture],['roughnessMap',pbr.metallicRoughnessTexture],['specularColorMap',spec.specularColorTexture]] as const;
                    for(const [slot,info]of slots){if(slot!=='map'&&!(item instanceof T.MeshStandardMaterial))continue;if(info&&!(item as unknown as Record<string,unknown>)[slot])throw new Error('Не удалось загрузить текстуру материала «'+(def.name??reference.materials)+'» ('+slot+'). Для glTF выберите также изображения и BIN.');}
                }return null;
            },
        };
    });
}
