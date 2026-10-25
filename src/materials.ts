import { createSurfaceMaps } from './surface-maps';
import { getModel } from './model-library';
import { qualityProfile } from './quality';
import { biomeMaterialMap, BIOME_MAP_SIZE } from './biome-materials';
import * as THREE from 'three';
import type { RenderingSystem } from './rendering';
import { SIZE, SPLAT_RES, type EditorModel } from './state';
import {waterAt} from './water-math';
import {createEnvironmentMaterials} from './environment-materials';
import {waterExtraUniforms,waterVertexShader,waterFragmentShader} from './water-shader';
import {worldPreset} from './world-recipes';
import {oceanGeometry} from './water-geometry';
import {waveSettings} from './water-surface';
import {jungleSurfaceMap,JUNGLE_MAP_SIZE} from './jungle-surface';
import {isJunglePlant} from './jungle-models';
import {taigaSurfaceMaps,TAIGA_MAP_SIZE} from './taiga-surface';
export function createMaterials(model: EditorModel, render: Pick<RenderingSystem, 'scene'>) {
    const environment=createEnvironmentMaterials();
    const splatTex = new THREE.DataTexture(model.splat, SPLAT_RES, SPLAT_RES, THREE.RGBAFormat, THREE.UnsignedByteType);
    splatTex.magFilter = THREE.LinearFilter;
    splatTex.minFilter = THREE.LinearFilter;
    splatTex.needsUpdate = true;
    const maps = createSurfaceMaps();
    const biomeTex=new THREE.DataTexture(biomeMaterialMap(model.world),BIOME_MAP_SIZE,BIOME_MAP_SIZE,THREE.RGBAFormat);
    biomeTex.magFilter=biomeTex.minFilter=THREE.LinearFilter;biomeTex.needsUpdate=true;
    const jungleTex=new THREE.DataTexture(jungleSurfaceMap(model),JUNGLE_MAP_SIZE,JUNGLE_MAP_SIZE,THREE.RGBAFormat);
    jungleTex.magFilter=jungleTex.minFilter=THREE.LinearFilter;jungleTex.needsUpdate=true;
    const taigaMaps=taigaSurfaceMaps(model),taigaTex=new THREE.DataTexture(taigaMaps.habitat,TAIGA_MAP_SIZE,TAIGA_MAP_SIZE,THREE.RGBAFormat),taigaCoverTex=new THREE.DataTexture(taigaMaps.cover,TAIGA_MAP_SIZE,TAIGA_MAP_SIZE,THREE.RGBAFormat);
    for(const texture of [taigaTex,taigaCoverTex]){texture.magFilter=texture.minFilter=THREE.LinearFilter;texture.needsUpdate=true;}
    const detailTex = new THREE.DataTexture(model.splatDetail, SPLAT_RES, SPLAT_RES, THREE.RGBAFormat, THREE.UnsignedByteType);
    detailTex.magFilter = detailTex.minFilter = THREE.LinearFilter; detailTex.needsUpdate = true;
    const coverBytes = new Uint8Array(128 * 128), coverTex = new THREE.DataTexture(coverBytes, 128, 128, THREE.RedFormat);
    // Store surface identity as well as height: a coarse sample must never clip its own sloping river.
    const waterLevels=new Float32Array(256*256*2),waterLevelTex=new THREE.DataTexture(waterLevels,256,256,THREE.RGFormat,THREE.FloatType);
    for(let i=0;i<256*256;i++)waterLevels[i*2]=model.state.water;
    waterLevelTex.minFilter=waterLevelTex.magFilter=THREE.NearestFilter;waterLevelTex.needsUpdate=true;
    let lastBodies:typeof model.world.waterBodies|undefined,lastOcean=NaN;
    coverTex.magFilter = coverTex.minFilter = THREE.LinearFilter; coverTex.needsUpdate = true;
    const terrainUniforms = {
        uJungleMap:{value:jungleTex},
        uTaigaMap:{value:taigaTex},uTaigaCover:{value:taigaCoverTex},
        uBiomes:{value:biomeTex},uWorldGround:{value:new THREE.Vector4()},uWorldRock:{value:new THREE.Color(0xffffff)},uWorldSand:{value:new THREE.Color(0xffffff)},uShoreTime:environment.uniforms.uEnvTime,uShoreReach:{value:0},
        uWaterLevels:{value:waterLevelTex},
        uContactMap: { value: coverTex as THREE.Texture },uContactStrength: {value:model.state.contactAO},
        uSplatDetail: { value: detailTex }, uAlbedoAtlas: { value: maps.albedo }, uDetailAtlas: { value: maps.detail }, uForestCover: { value: coverTex }, uGroundDetail: { value: model.state.groundDetail }, uSurfaceOctaves: { value: qualityProfile(model).surfaceOctaves },
        uSplat: { value: splatTex }, uSize: { value: SIZE }, uWater: { value: model.state.water }, uSnow: { value: model.state.snowLine },
        uRockSlope: { value: model.state.rockSlope }, uBrushPos: { value: new THREE.Vector3() }, uBrushRadius: { value: model.state.radius },
        uBrushOn: { value: 0 }, uBrushFalloff: { value: model.state.falloff }, uBrushColor: { value: new THREE.Color(1, 0.8, 0.25) },
    };
    const terrainMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0.0, envMapIntensity: 0.55 });
    terrainMat.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, terrainUniforms);
        shader.uniforms.uOceanWater=terrainUniforms.uWater;
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNormal;')
            .replace('#include <fog_vertex>', '#include <fog_vertex>\n vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\n vWNormal = normalize(mat3(modelMatrix) * objectNormal);');
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', `#include <common>
uniform highp sampler2DArray uAlbedoAtlas, uDetailAtlas;
uniform sampler2D uSplatDetail, uForestCover;
uniform sampler2D uBiomes,uJungleMap,uTaigaMap,uTaigaCover;
uniform vec4 uWorldGround;uniform vec3 uWorldRock,uWorldSand;
uniform sampler2D uContactMap;uniform float uContactStrength;
uniform float uGroundDetail, uSurfaceOctaves,uShoreTime,uShoreReach;
// Let the sampler wrap continuous coordinates so mip derivatives do not spike at tile edges.
vec3 surfaceColor(vec2 p, float layer) { return texture(uAlbedoAtlas, vec3(p, layer)).rgb; }
vec2 surfaceDetail(vec2 p, float layer) { return texture(uDetailAtlas, vec3(p, layer)).rg; }
uniform sampler2D uSplat, uWaterLevels; uniform float uSize, uOceanWater, uSnow, uRockSlope, uBrushRadius, uBrushOn, uBrushFalloff;
uniform vec3 uBrushPos; uniform vec3 uBrushColor;
varying vec3 vWPos; varying vec3 vWNormal;
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash12(i), hash12(i+vec2(1.0,0.0)), u.x), mix(hash12(i+vec2(0.0,1.0)), hash12(i+vec2(1.0,1.0)), u.x), u.y); }
float fbm3(vec2 p){ float s = 0.0, a = 0.5, norm = 0.0; for (int i = 0; i < 4; i++){ if(float(i) >= uSurfaceOctaves)break; s += a * vnoise(p); norm += a; p = p * 2.03 + vec2(17.1, 9.3); a *= 0.5; } return s / max(norm, 0.5); }
vec3 perturbN(vec3 surf_pos, vec3 surf_norm, float h){
  vec3 sx = dFdx(surf_pos), sy = dFdy(surf_pos);
  vec3 r1 = cross(sy, surf_norm), r2 = cross(surf_norm, sx);
  float det = dot(sx, r1);
  vec2 dh = vec2(dFdx(h), dFdy(h));
  vec3 grad = sign(det) * (dh.x * r1 + dh.y * r2);
  return normalize(abs(det) * surf_norm - grad);
}
float tBump; float tRough;`)
            .replace('#include <map_fragment>', `
  vec3 wn = normalize(vWNormal);
  float slope = 1.0 - wn.y;
  float h = vWPos.y;
  vec2 p = vWPos.xz;
  float uWater = max(uOceanWater, texture2D(uWaterLevels, p / uSize + 0.5).r);
  float nLarge = fbm3(p * 0.004);
  float nMid = fbm3(p * 0.035);
  float nFine = vnoise(p * 0.3);
  vec4 jungle = texture2D(uJungleMap, p / uSize + 0.5);
  vec4 taiga = texture2D(uTaigaMap, p / uSize + 0.5), taigaCover = texture2D(uTaigaCover, p / uSize + 0.5);
  // трава
  vec3 grass = mix(vec3(0.30, 0.35, 0.20), vec3(0.43, 0.45, 0.28), smoothstep(0.3, 0.7, nMid));
  grass = mix(grass, vec3(0.47, 0.44, 0.29), smoothstep(0.55, 0.8, nLarge) * 0.35 + smoothstep(uSnow * 0.55, uSnow, h) * 0.25);
  grass *= 0.94 + 0.12 * nFine;
  // земля
  vec3 dirt;
  // песок
  vec3 sand = mix(vec3(0.78, 0.71, 0.52), vec3(0.64, 0.57, 0.42), nMid) * (0.9 + 0.2 * nFine);
  sand *= mix(0.62, 1.0, smoothstep(uWater - 0.3, uWater + 1.2, h));
  // скала (трипланарная проекция)
  vec3 bw = pow(abs(wn), vec3(4.0)); bw /= (bw.x + bw.y + bw.z);
  float rx = vnoise(vWPos.zy * vec2(0.07, 0.22));
  float ry = vnoise(vWPos.xz * 0.07);
  float rz = vnoise(vWPos.xy * vec2(0.07, 0.22));
  float rn = rx * bw.x + ry * bw.y + rz * bw.z;
  float strata = 0.5 + 0.5 * sin(h * 0.45 + rn * 7.0);
  vec3 rock = mix(vec3(0.27, 0.25, 0.23), vec3(0.50, 0.47, 0.43), rn);
  rock = mix(rock, rock * vec3(1.12, 0.98, 0.86), strata * 0.45);
  // снег
  vec3 snow = vec3(0.90, 0.93, 0.98) * (0.94 + 0.06 * nFine);
  vec2 texUV = p * 0.32 + jungle.r * vec2(nLarge - .5, nMid - .5) * .8;
  grass = mix(grass, surfaceColor(texUV, 0.0), 0.8);
  sand = mix(sand, surfaceColor(texUV * 1.3, 2.0), 0.85);
  rock = mix(rock, surfaceColor(vWPos.zy * 0.18, 1.0) * bw.x + surfaceColor(p * 0.18, 1.0) * bw.y + surfaceColor(vWPos.xy * 0.18, 1.0) * bw.z, 0.8);
  snow = mix(snow, surfaceColor(texUV, 3.0), 0.3);
  dirt = surfaceColor(texUV, 5.0);
  vec3 litter = surfaceColor(texUV, 4.0), gravel = surfaceColor(texUV * 0.7, 6.0), moss = surfaceColor(texUV, 7.0);
  rock*=uWorldRock;
  sand*=uWorldSand;
  grass=mix(grass,sand,uWorldGround.x);
  grass=mix(grass,sand,uWorldGround.y*(1.0-smoothstep(uWater+8.0,uWater+32.0,h)));
  grass=mix(grass,mix(gravel,rock,.7),uWorldGround.z);
  grass=mix(grass,mix(litter,moss,.65),uWorldGround.w);
  vec4 biome = texture2D(uBiomes, p / uSize + 0.5);
  grass = mix(grass, mix(litter, moss, 0.25), biome.r * 0.23);
  grass = mix(grass, sand, biome.g * (1.0 - smoothstep(uWater + 8.0, uWater + 22.0, h)) * 0.8);
  grass = mix(grass, mix(gravel, rock, 0.5), biome.b * smoothstep(0.03, 0.25, slope) * 0.5);
  grass = mix(grass, mix(grass * vec3(0.98, 1.03, 0.96), moss, 0.12), biome.a * 0.7);
  float forest = texture2D(uForestCover, p / uSize + 0.5).r;
  grass = mix(grass, mix(litter, moss, smoothstep(0.35, 0.8, nMid) * 0.5), forest * 0.9);
  // веса по высоте и уклону
  float wSand = 1.0 - smoothstep(uWater + 0.8, uWater + 3.5 + nMid * 4.0, h);
  float wRock = smoothstep(uRockSlope - 0.07, uRockSlope + 0.07, slope + (nMid - 0.5) * 0.14);
  float wDirt = smoothstep(uRockSlope * 0.45, uRockSlope * 0.85, slope + (nFine - 0.5) * 0.12);
  float wSnow = smoothstep(uSnow - 8.0, uSnow + 8.0, h + (nMid - 0.5) * 34.0) * (1.0 - smoothstep(0.42, 0.68, slope + (nFine-0.5)*0.1));
  vec3 col = mix(grass, dirt, wDirt);
  col = mix(col, sand, wSand * (1.0 - wRock));
  float wGravel = smoothstep(0.09, 0.22, slope) * (1.0 - wRock) * (1.0 - wSand);
  col = mix(col, gravel, wGravel * 0.7);
  col = mix(col, rock, wRock);
  col = mix(col, snow, wSnow);
  // The existing PBR atlas supplies damp soil, decaying litter, moss and wet stone.
  vec3 jungleSoil = dirt * vec3(.78,.66,.54);
  vec3 jungleLitter = litter * vec3(.90,.83,.70);
  vec3 jungleMoss = moss * vec3(.77,.88,.65);
  float mossPatch = smoothstep(.48,.72,nMid) * jungle.g * (1.0-jungle.a*.75);
  vec3 jungleFloor = mix(jungleSoil,jungleLitter,smoothstep(.22,.72,nLarge) * (.45+forest*.5));
  jungleFloor = mix(jungleFloor,jungleMoss,mossPatch*.65);
  jungleFloor = mix(jungleFloor,jungleSoil*.72,jungle.b*.75);
  jungleFloor *= 1.0-forest*.16;
  vec3 wetRock = mix(rock*.7,jungleMoss,mossPatch*.48);
  jungleFloor = mix(jungleFloor,wetRock,wRock);
  col = mix(col,jungleFloor,jungle.r);
  // Boreal litter, moss, pale dry lichen, wet organic soil and sphagnum blend in habitat space.
  float tm = smoothstep(.22,.78,nMid) * taigaCover.r;
  float tl = smoothstep(.28,.72,nLarge) * taigaCover.g;
  float ts = taigaCover.b * (1.0-smoothstep(.3,.65,slope));
  vec3 boreal = mix(dirt*vec3(.72,.65,.54),litter*vec3(.76,.79,.65),.4+forest*.4);
  boreal = mix(boreal,moss*vec3(.81,.88,.68),tm);
  vec3 lichen = mix(vec3(.51,.53,.43),vec3(.70,.72,.61),nFine);
  boreal = mix(boreal,lichen,tl);
  boreal = mix(boreal,dirt*vec3(.48,.44,.36),taiga.g*.3);
  vec3 peat = mix(dirt*vec3(.39,.33,.25),moss*vec3(.91,.84,.55),smoothstep(.35,.7,nMid));
  boreal = mix(boreal,peat,taiga.b);
  boreal = mix(boreal,mix(rock*vec3(.81,.86,.84),moss,tm*.6),max(wRock,smoothstep(.75,.9,nLarge)*.3));
  boreal = mix(boreal,litter*vec3(1.05,.78,.46),taigaCover.a*.18);
  boreal = mix(boreal,snow,ts);
  col = mix(col,boreal,taiga.r);
  vec4 sp = texture2D(uSplat, p / uSize + 0.5), sd = texture2D(uSplatDetail, p / uSize + 0.5);
  float sSum = dot(sp, vec4(1.0)) + dot(sd, vec4(1.0));
  vec2 md = surfaceDetail(texUV, 0.0);
  md = mix(md, surfaceDetail(texUV, 5.0), wDirt);
  md = mix(md, surfaceDetail(texUV, 4.0), forest * 0.9);
  md = mix(md, surfaceDetail(texUV * 0.7, 6.0), wGravel * 0.7);
  md = mix(md, surfaceDetail(texUV * 1.3, 2.0), wSand * (1.0 - wRock));
  vec2 rd = surfaceDetail(vWPos.zy * 0.18, 1.0) * bw.x + surfaceDetail(p * 0.18, 1.0) * bw.y + surfaceDetail(vWPos.xy * 0.18, 1.0) * bw.z;
  md = mix(md, rd, wRock); md = mix(md, surfaceDetail(texUV, 3.0), wSnow);
  vec2 jungleDetail = mix(surfaceDetail(texUV,5.0),surfaceDetail(texUV,4.0),.5+forest*.35);
  jungleDetail = mix(jungleDetail,surfaceDetail(texUV,7.0),mossPatch*.65);
  jungleDetail.g = mix(jungleDetail.g,.48,jungle.b*.8);
  md = mix(md,mix(jungleDetail,rd,wRock),jungle.r);
  vec2 taigaDetail=mix(surfaceDetail(texUV,4.0),surfaceDetail(texUV,7.0),tm);
  taigaDetail.g=mix(taigaDetail.g,.52,taiga.b*.65);
  taigaDetail=mix(taigaDetail,rd,wRock);taigaDetail=mix(taigaDetail,surfaceDetail(texUV,3.0),ts);
  md=mix(md,taigaDetail,taiga.r);
  if (sSum > 0.003) {
    float k = clamp(sSum, 0.0, 1.0);
    vec3 mc = (sp.r * grass + sp.g * rock + sp.b * sand + sp.a * snow + sd.r * litter + sd.g * dirt + sd.b * gravel + sd.a * moss) / sSum;
    vec2 detailMix = (sp.r * surfaceDetail(texUV, 0.0) + sp.g * rd + sp.b * surfaceDetail(texUV, 2.0) + sp.a * surfaceDetail(texUV, 3.0) + sd.r * surfaceDetail(texUV, 4.0) + sd.g * surfaceDetail(texUV, 5.0) + sd.b * surfaceDetail(texUV, 6.0) + sd.a * surfaceDetail(texUV, 7.0)) / sSum;
    col = mix(col, mc, k); md = mix(md, detailMix, k);
  }
  // Wave wash darkens the shore without baking changes into the painted terrain.
  float wetShore=1.0-smoothstep(uWater-.3,uWater+max(.65,uShoreReach*1.5)+(.12+uShoreReach*.12)*sin(uShoreTime*1.6+p.x*.13+p.y*.11),h);
  col*=mix(vec3(1.0),vec3(.65,.73,.7),wetShore);
  diffuseColor.rgb = mix(col / 12.92, pow((col + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045),col));
  tBump = md.r * 0.012 * uGroundDetail * (1.0 - smoothstep(35.0, 160.0, length(cameraPosition - vWPos)));
  tRough = clamp(md.g, 0.35, 1.0);
  tRough = mix(tRough, 0.38, wetShore);
`)
            .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = tRough;')
            .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
  // The sky environment represents open air. Dense crowns occlude that blue reflection
  // and filter the remaining indirect light reaching the wet forest floor.
  vec2 forestUV = vWPos.xz / uSize + .5;
  float jungleShade = texture2D(uJungleMap, forestUV).r * texture2D(uForestCover, forestUV).r;
  reflectedLight.indirectSpecular *= mix(1.0, .12, jungleShade);
  reflectedLight.indirectDiffuse *= mix(vec3(1.0), vec3(1.0, .97, .70), jungleShade);
`)
            .replace('#include <opaque_fragment>', 'outgoingLight *= 1.0 - texture2D(uContactMap, vWPos.xz / uSize + 0.5).r * uContactStrength;\n#include <opaque_fragment>')
            .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n normal = perturbN(-vViewPosition, normal, tBump * 2.2);')
            .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  if (uBrushOn > 0.5) {
    float bd = distance(vWPos.xz, uBrushPos.xz);
    float bw2 = max(0.35, uBrushRadius * 0.018);
    float ring = 1.0 - smoothstep(0.0, bw2, abs(bd - uBrushRadius));
    float inner = (1.0 - smoothstep(0.0, bw2 * 0.6, abs(bd - uBrushRadius * (1.0 - uBrushFalloff)))) * step(0.02, uBrushFalloff);
    float fill = (1.0 - smoothstep(uBrushRadius * 0.97, uBrushRadius, bd)) * 0.05;
    float dotc = 1.0 - smoothstep(0.0, bw2 * 1.5, bd);
    totalEmissiveRadiance += uBrushColor * (ring * 0.9 + inner * 0.35 + fill + dotc * 0.8);
  }`);
    };
    const waterUniforms = {
        ...waterExtraUniforms(),
        uTime: { value: 0 }, uWater: { value: model.state.water }, uSize: { value: SIZE }, uN: { value: model.N }, uOpacity: { value: model.state.waterOpacity }, uWave: { value: model.state.wave },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color(1, 1, 1) },
        uSkyZenith: { value: new THREE.Color() }, uSkyHorizon: { value: new THREE.Color() },
        uDeep: { value: new THREE.Color().setRGB(0.01, 0.06, 0.09) }, uShallow: { value: new THREE.Color().setRGB(0.05, 0.22, 0.22) },
        uFogColor: { value: new THREE.Color() }, uFogDensity: { value: 0.0004 }, uHeight: { value: null as THREE.Texture | null },
        uWaterLevels:{value:waterLevelTex},uBodyIndex:{value:0},uFlowSpeed:{value:0},uWaterDetail:{value:1},uFoamStrength:{value:1},
        uReflection:{value:new THREE.DataTexture(new Uint8Array([0,0,0,255]),1,1) as THREE.Texture},uReflectionMatrix:{value:new THREE.Matrix4()},uReflectionOn:{value:0},uReflectionLevel:{value:0},uReflectionsEnabled:{value:1},
    };
    const waterMat = new THREE.ShaderMaterial({
        uniforms: waterUniforms, transparent: true, depthWrite: true, side:THREE.DoubleSide,
        vertexShader: waterVertexShader, fragmentShader: waterFragmentShader,
    });
    environment.decorate(terrainMat);
    Object.assign(waterUniforms,environment.uniforms);
    Object.assign(waterMat.uniforms,environment.uniforms);
    waterMat.fragmentShader=environment.fogGLSL+'\n'+waterMat.fragmentShader;
    waterMat.fragmentShader=waterMat.fragmentShader.replace('gl_FragColor.rgb = mix(gl_FragColor.rgb, linearToOutputTexel(vec4(uFogColor, 1.0)).rgb, ff);','gl_FragColor.rgb = mix(gl_FragColor.rgb, linearToOutputTexel(vec4(uFogColor, 1.0)).rgb, ff);\n gl_FragColor.rgb=mix(gl_FragColor.rgb,linearToOutputTexel(vec4(uEnvFogColor,1.0)).rgb,valleyFog(vWPos));');
    const water = new THREE.Mesh(oceanGeometry(96), waterMat);
    water.frustumCulled=false;
    waterUniforms.uReflection.value.needsUpdate=true;
    water.renderOrder = 2;
    render.scene.add(water);
    function updateWater() {
        const ocean = model.world.waterBodies.find(body => body.kind === 'ocean');
        if (ocean) {
            ocean.level = model.state.water;
            ocean.opacity = model.state.waterOpacity;
            ocean.wave = model.state.wave;
        }
        water.position.y = model.state.water;
        waterUniforms.uWater.value = model.state.water;
        terrainUniforms.uWater.value = model.state.water;
        waterUniforms.uOpacity.value = model.state.waterOpacity;
        waterUniforms.uWave.value = model.state.wave;
        waterUniforms.uClarity.value=ocean?.clarity??12;
        terrainUniforms.uShoreReach.value=waveSettings('ocean',model.state.wave,model.state.windSpeed,0).runup;
        waterUniforms.uWindSpeed.value=model.state.windSpeed;
        waterUniforms.uWindAngle.value=model.state.windDir*Math.PI/180;
        if(lastBodies!==model.world.waterBodies||lastOcean!==model.state.water){
            const ids=new Map(model.world.waterBodies.map((body,i)=>[body,i+1]));
            for(let j=0;j<256;j++)for(let i=0;i<256;i++){const surface=waterAt(model.state.water,model.world.waterBodies,(i+.5)/256*SIZE-SIZE/2,(j+.5)/256*SIZE-SIZE/2),k=(j*256+i)*2;waterLevels[k]=surface.level;waterLevels[k+1]=surface.body?ids.get(surface.body)!:0;}
            waterLevelTex.needsUpdate=true;lastBodies=model.world.waterBodies;lastOcean=model.state.water;
        }
    }
    function updateMaterial() { terrainUniforms.uSurfaceOctaves.value=qualityProfile(model).surfaceOctaves;terrainUniforms.uGroundDetail.value = model.state.groundDetail * qualityProfile(model).groundDetail; terrainUniforms.uContactStrength.value=model.state.contactAO*qualityProfile(model).contact;terrainUniforms.uSnow.value = model.state.snowLine; terrainUniforms.uRockSlope.value = model.state.rockSlope; }
    function updateForestCover() {
        coverBytes.fill(0);
        for (const item of model.world.objects) {
            if (getModel(item.asset).category !== 'tree' || item.source === 'scatter' && !model.state.showScatter) continue;
            const cx = (item.position[0] / SIZE + 0.5) * 128, cy = (item.position[2] / SIZE + 0.5) * 128, radius = Math.max(1.5, getModel(item.asset).bounds.getSize(new THREE.Vector3()).x * item.scale[0] / SIZE * 128 * (isJunglePlant(item.asset)?.5:1));
            for (let y = Math.max(0, Math.floor(cy - radius)); y <= Math.min(127, Math.ceil(cy + radius)); y++) for (let x = Math.max(0, Math.floor(cx - radius)); x <= Math.min(127, Math.ceil(cx + radius)); x++) {
                const weight = Math.max(0, 1 - Math.hypot(x - cx, y - cy) / radius); coverBytes[y * 128 + x] = Math.min(255, coverBytes[y * 128 + x] + weight * 190);
            }
        }
        coverTex.needsUpdate = true;
    }
    function updateBiomes(){
        biomeTex.image.data!.set(biomeMaterialMap(model.world));biomeTex.needsUpdate=true;
        jungleTex.image.data!.set(jungleSurfaceMap(model));jungleTex.needsUpdate=true;
        const taiga=taigaSurfaceMaps(model);taigaTex.image.data!.set(taiga.habitat);taigaCoverTex.image.data!.set(taiga.cover);taigaTex.needsUpdate=taigaCoverTex.needsUpdate=true;
        const recipe=worldPreset(model.world.preset);terrainUniforms.uWorldGround.value.fromArray(recipe?.ground??[0,0,0,0]);
        terrainUniforms.uWorldRock.value.setHex(recipe?.rockTint??0xffffff);
        terrainUniforms.uWorldSand.value.setHex(recipe?.sandTint??0xffffff);
        if(recipe){waterUniforms.uDeep.value.setHex(recipe.waterDeep);waterUniforms.uShallow.value.setHex(recipe.waterShallow);}
        else{waterUniforms.uDeep.value.setHex(0x153849);waterUniforms.uShallow.value.setHex(0x3c9a94);}
    }
    return { environment, detailTex, updateBiomes, updateForestCover, terrainMat, terrainUniforms, splatTex, water, waterUniforms, waterMat, updateWater, updateMaterial, };
}
export type MaterialsSystem = ReturnType<typeof createMaterials>;
