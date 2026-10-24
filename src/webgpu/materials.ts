import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { attribute, color, float, mix, positionGeometry, positionLocal, sin, smoothstep, texture, uniform, vec3 } from 'three/tsl';
import { createSurfaceMaps, SURFACE_TILE } from '../surface-maps';
import type { LabMaterials } from './scene';

export function createLabMaterials(tsl: boolean) {
    const atlas = createSurfaceMaps(), maps: THREE.DataTexture[] = [];
    function layer(index: number, detail = false) {
        const data = (detail ? atlas.detail : atlas.albedo).image.data as Uint8Array;
        const bytes = data.slice(index * SURFACE_TILE ** 2 * 4, (index + 1) * SURFACE_TILE ** 2 * 4);
        const map = new THREE.DataTexture(bytes, SURFACE_TILE, SURFACE_TILE, THREE.RGBAFormat);
        map.colorSpace = detail ? THREE.NoColorSpace : THREE.SRGBColorSpace;
        map.wrapS = map.wrapT = THREE.RepeatWrapping; map.magFilter = THREE.LinearFilter;
        map.minFilter = THREE.LinearMipmapLinearFilter; map.generateMipmaps = true; map.needsUpdate = true;
        maps.push(map); return map;
    }
    const grass = layer(0), rock = layer(1), litter = layer(4), detail = layer(0, true);
    atlas.albedo.dispose(); atlas.detail.dispose();
    // Keep stock PBR lighting and bump mapping equal, change only the custom shader expressions.
    const time = { value: 12 }, wet = { value: .35 }, wind = { value: 1 };
    const timeNode = uniform(time.value), wetNode = uniform(wet.value), windNode = uniform(wind.value);
    const ground = tsl ? new MeshStandardNodeMaterial() : new THREE.MeshStandardMaterial();
    ground.roughness = .95; ground.bumpMap = detail; ground.bumpScale = .18;
    const plant = tsl ? new MeshStandardNodeMaterial() : new THREE.MeshStandardMaterial();
    plant.vertexColors = true; plant.roughness = .9;
    const water = tsl ? new MeshStandardNodeMaterial() : new THREE.MeshStandardMaterial();
    water.roughness = .32; water.metalness = .05;
    if (tsl) {
        const uv = positionGeometry.xz.mul(.18), blend = attribute('aBlend', 'vec2');
        const g = ground as MeshStandardNodeMaterial, p = plant as MeshStandardNodeMaterial, w = water as MeshStandardNodeMaterial;
        g.colorNode = mix(mix(texture(grass, uv).rgb, texture(litter, uv).rgb, blend.y), texture(rock, uv).rgb, blend.x).mul(float(1).sub(wetNode.mul(.27)));
        g.roughnessNode = texture(detail, uv).g.mul(.95).mul(float(1).sub(wetNode.mul(.35)));
        const phase = attribute('aPhase', 'float'), weight = attribute('aWeight', 'float');
        const sway = sin(timeNode.mul(1.5).add(phase)).mul(.7).add(sin(timeNode.mul(3.1).add(phase.mul(1.7))).mul(.2)).mul(weight).mul(windNode);
        p.positionNode = positionLocal.add(vec3(sway, 0, sway.mul(.45)));
        const wave = sin(positionGeometry.x.mul(.65).add(timeNode)).mul(sin(positionGeometry.z.mul(.8).sub(timeNode.mul(.7))));
        const foam = smoothstep(.82, .98, wave);
        w.colorNode = mix(color(0x286f75), color(0xb9d4bf), foam.mul(.55));
        w.positionNode = positionLocal.add(vec3(0, wave.mul(.065), 0));
    } else {
        ground.onBeforeCompile = shader => {
            Object.assign(shader.uniforms, { uGrass: { value: grass }, uRock: { value: rock }, uLitter: { value: litter }, uDetail: { value: detail }, uWet: wet });
            shader.vertexShader = 'attribute vec2 aBlend; varying vec2 vBlend; varying vec2 vGroundUv;\n' + shader.vertexShader;
            shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvBlend=aBlend; vGroundUv=position.xz*.18;');
            shader.fragmentShader = 'uniform sampler2D uGrass,uRock,uLitter,uDetail; uniform float uWet; varying vec2 vBlend,vGroundUv;\n' + shader.fragmentShader;
            shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= mix(mix(texture2D(uGrass,vGroundUv).rgb,texture2D(uLitter,vGroundUv).rgb,vBlend.y),texture2D(uRock,vGroundUv).rgb,vBlend.x)*(1.-uWet*.27);');
            shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor *= texture2D(uDetail,vGroundUv).g*(1.-uWet*.35);');
        };
        plant.onBeforeCompile = shader => {
            Object.assign(shader.uniforms, { uTime: time, uWind: wind });
            shader.vertexShader = 'uniform float uTime,uWind; attribute float aPhase,aWeight;\n' + shader.vertexShader;
            shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nfloat sway=(sin(uTime*1.5+aPhase)*.7+sin(uTime*3.1+aPhase*1.7)*.2)*aWeight*uWind; transformed+=vec3(sway,0.,sway*.45);');
        };
        water.onBeforeCompile = shader => {
            shader.uniforms.uTime = time;
            shader.vertexShader = 'uniform float uTime; varying float vWave;\n' + shader.vertexShader;
            shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvWave=sin(position.x*.65+uTime)*sin(position.z*.8-uTime*.7); transformed.y+=vWave*.065;');
            // Fragment re-evaluates the wave so geometry tessellation does not change foam detail.
            shader.vertexShader = 'varying vec2 vWaterUv;\n' + shader.vertexShader;
            shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvWaterUv=position.xz;');
            shader.fragmentShader = 'uniform float uTime; varying vec2 vWaterUv;\n' + shader.fragmentShader;
            const base = new THREE.Color(0x286f75), foam = new THREE.Color(0xb9d4bf);
            shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>\nfloat wave=sin(vWaterUv.x*.65+uTime)*sin(vWaterUv.y*.8-uTime*.7); diffuseColor.rgb *= mix(vec3(${base.r},${base.g},${base.b}),vec3(${foam.r},${foam.g},${foam.b}),smoothstep(.82,.98,wave)*.55);`);
        };
    }
    const materials: LabMaterials = { ground, plant, water };
    return { materials, set(timeValue: number, wetness: number, windValue: number) {
        time.value = timeNode.value = timeValue; wet.value = wetNode.value = wetness; wind.value = windNode.value = windValue;
    }, disposeTextures() { maps.forEach(map => map.dispose()); } };
}
