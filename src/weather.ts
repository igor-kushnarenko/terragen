interface WeatherSettings {
    name: string;
    cover: number;
    dark: number;
    overcast: number;
    fog: number;
    sun: number;
    sat: number;
    rain: number;
    snow: number;
    storm: number;
}
import * as THREE from 'three';
import { weatherStrengths, CLOUD_ALTITUDE } from './atmosphere-settings';
import { createSkyAtmosphere, skyFogGLSL } from './sky-atmosphere';
import type { Feedback } from './feedback';
import type { LightingSystem } from './lighting';
import type { MaterialsSystem } from './materials';
import { mulberry32, smoothstep } from './noise';
import type { RenderingSystem } from './rendering';
import { type EditorModel } from './state';
export function createWeather(model: EditorModel, render: RenderingSystem, feedback: Feedback, materials: MaterialsSystem, lighting: LightingSystem) {
    let atmosTime = 0;
    const {uniforms:cloudUniforms,clouds}=createSkyAtmosphere(render);
    // --- Звёзды
    const STAR_COUNT = 6000;
    const starMat = new THREE.ShaderMaterial({
        uniforms: { uOpacity: { value: 0 }, uTime: { value: 0 }, uPixel: { value: render.renderer.getPixelRatio() },uFogDensity:cloudUniforms.uFogDensity },
        vertexShader: `
attribute float aSize; attribute float aBright; attribute float aPhase;
uniform float uTime, uPixel; varying float vB,vSkyY; varying vec3 vCol; attribute vec3 aColor;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_Position.z = gl_Position.w * 0.99999; // на дальней плоскости
  float tw = 0.75 + 0.25 * sin(uTime * (1.3 + aPhase * 2.7) + aPhase * 40.0);
  vB = aBright * tw; vCol = aColor; vSkyY=normalize(position).y;
  gl_PointSize = aSize * uPixel;
}`,
        fragmentShader: `
uniform float uOpacity,uFogDensity; varying float vB,vSkyY; varying vec3 vCol;
${skyFogGLSL}
void main(){
  vec2 c = gl_PointCoord - 0.5; float d = length(c);
  float a = smoothstep(0.5, 0.0, d);
  a = a * a;
  gl_FragColor = vec4(vCol * vB * 1.6, a * vB * uOpacity * (1.0-atmosphereFog(skyFogPath(vSkyY))));
}`,
        transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, fog: false,
    });
    const stars = (() => {
        const g = new THREE.BufferGeometry();
        const pos = new Float32Array(STAR_COUNT * 3), size = new Float32Array(STAR_COUNT), br = new Float32Array(STAR_COUNT), ph = new Float32Array(STAR_COUNT), col = new Float32Array(STAR_COUNT * 3);
        const rnd = mulberry32(4242), R = 15000;
        for (let i = 0; i < STAR_COUNT; i++) {
            const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2, s = Math.sqrt(1 - u * u);
            pos[i * 3] = s * Math.cos(th) * R;
            pos[i * 3 + 1] = u * R;
            pos[i * 3 + 2] = s * Math.sin(th) * R;
            const m = Math.pow(rnd(), 3.5); // большинство звёзд тусклые
            br[i] = 0.25 + 0.95 * m;
            size[i] = 1.3 + 2.8 * m;
            ph[i] = rnd();
            const t = rnd(); // цвет: голубоватые — белые — желтоватые
            if (t < 0.2)
                col.set([0.75, 0.85, 1.0], i * 3);
            else if (t < 0.85)
                col.set([1, 1, 1], i * 3);
            else
                col.set([1.0, 0.88, 0.7], i * 3);
        }
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
        g.setAttribute('aBright', new THREE.BufferAttribute(br, 1));
        g.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
        g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
        const p = new THREE.Points(g, starMat);
        p.frustumCulled = false;
        p.renderOrder = -1;
        p.visible = false;
        render.scene.add(p);
        return p;
    })();
    // --- Осадки: дождь (отрезки) и снег (точки), вершины анимируются на GPU вокруг камеры
    const PRECIP_BOX = 70, PRECIP_H = 40;
    const precipUniforms = { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uWind: { value: new THREE.Vector2() }, uOpacity: { value: 0 }, uColor: { value: new THREE.Color(0.7, 0.75, 0.85) }, uPixel: { value: render.renderer.getPixelRatio() } };
    const precipCommonV = `
uniform float uTime; uniform vec3 uCam; uniform vec2 uWind;
const float B = ${PRECIP_BOX.toFixed(1)}; const float H = ${PRECIP_H.toFixed(1)};
vec3 wrapPos(vec3 base, float fall, vec2 wind){
  vec3 p = base;
  p.y = mod(base.y - uTime * fall - uCam.y, H) - H * 0.5 + uCam.y;
  vec2 d = base.xz + wind * uTime;
  p.xz = mod(d - uCam.xz, B) - B * 0.5 + uCam.xz;
  return p;
}`;
    function makeRain() {
        const COUNT = 14000, g = new THREE.BufferGeometry();
        const base = new Float32Array(COUNT * 6), endA = new Float32Array(COUNT * 2), spd = new Float32Array(COUNT * 2);
        const rnd = mulberry32(99);
        for (let i = 0; i < COUNT; i++) {
            const x = rnd() * PRECIP_BOX, y = rnd() * PRECIP_H, z = rnd() * PRECIP_BOX, s = 0.85 + rnd() * 0.3;
            for (let k = 0; k < 2; k++) {
                base.set([x, y, z], (i * 2 + k) * 3);
                endA[i * 2 + k] = k;
                spd[i * 2 + k] = s;
            }
        }
        g.setAttribute('position', new THREE.BufferAttribute(base, 3));
        g.setAttribute('aEnd', new THREE.BufferAttribute(endA, 1));
        g.setAttribute('aSpd', new THREE.BufferAttribute(spd, 1));
        const m = new THREE.ShaderMaterial({ uniforms: precipUniforms, transparent: true, depthWrite: false, fog: false,
            vertexShader: precipCommonV + `
attribute float aEnd; attribute float aSpd; varying float vA;
void main(){
  float fall = 22.0 * aSpd; vec2 wind = uWind * 6.0;
  vec3 p = wrapPos(position, fall, wind);
  vec3 vel = vec3(wind.x, -fall, wind.y);
  p += vel * 0.035 * aEnd; // длина штриха ~ скорость
  float dc = length(p - uCam);
  vA = (0.35 + 0.65 * aEnd) * (1.0 - smoothstep(B * 0.3, B * 0.5, dc)) * smoothstep(0.5, 2.0, dc);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`,
            fragmentShader: `uniform float uOpacity; uniform vec3 uColor; varying float vA; void main(){ gl_FragColor = vec4(uColor, vA * uOpacity * 0.8); }` });
        const l = new THREE.LineSegments(g, m);
        l.frustumCulled = false;
        l.renderOrder = 3;
        l.visible = false;
        render.scene.add(l);
        return l;
    }
    function makeSnow() {
        const COUNT = 18000, g = new THREE.BufferGeometry();
        const base = new Float32Array(COUNT * 3), ph = new Float32Array(COUNT);
        const rnd = mulberry32(77);
        for (let i = 0; i < COUNT; i++) {
            base.set([rnd() * PRECIP_BOX, rnd() * PRECIP_H, rnd() * PRECIP_BOX], i * 3);
            ph[i] = rnd();
        }
        g.setAttribute('position', new THREE.BufferAttribute(base, 3));
        g.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
        const m = new THREE.ShaderMaterial({ uniforms: precipUniforms, transparent: true, depthWrite: false, fog: false,
            vertexShader: precipCommonV + `
attribute float aPhase; uniform float uPixel; varying float vA;
void main(){
  float fall = 1.4 + aPhase * 1.0;
  vec3 p = wrapPos(position, fall, uWind * 1.6);
  p.x += sin(uTime * (0.7 + aPhase) + aPhase * 30.0) * 0.6; p.z += cos(uTime * (0.6 + aPhase) + aPhase * 17.0) * 0.6;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  float dc = -mv.z;
  vA = (1.0 - smoothstep(B * 0.3, B * 0.5, length(p - uCam))) * smoothstep(0.3, 1.5, dc);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp((2.0 + aPhase * 2.0) * 60.0 / max(dc, 0.5), 1.0, 14.0) * uPixel;
}`,
            fragmentShader: `uniform float uOpacity; varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.15, d); gl_FragColor = vec4(vec3(0.95, 0.97, 1.0), a * vA * uOpacity * 0.9); }` });
        const p = new THREE.Points(g, m);
        p.frustumCulled = false;
        p.renderOrder = 3;
        p.visible = false;
        render.scene.add(p);
        return p;
    }
    const rain = makeRain(), snow = makeSnow();
    // --- Погода: пресеты и плавные переходы
    const WEATHERS: Record<import("./state").WeatherId, WeatherSettings> = {
        clear: { name: 'Солнечно', cover: 0.0, dark: 0.0, overcast: 0, fog: 0, sun: 1.0, sat: 0, rain: 0, snow: 0, storm: 0 },
        partly: { name: 'Переменная облачность', cover: 0.55, dark: 0.0, overcast: 0, fog: 0, sun: 0.9, sat: 0.0, rain: 0, snow: 0, storm: 0 },
        overcast: { name: 'Сплошная облачность', cover: 1.0, dark: 0.25, overcast: 1, fog: 0.0008, sun: 0.22, sat: 0.8, rain: 0, snow: 0, storm: 0 },
        fog: { name: 'Туман', cover: 0.8, dark: 0.1, overcast: 0.7, fog: 0.0032, sun: 0.35, sat: 0.9, rain: 0, snow: 0, storm: 0 },
        rain: { name: 'Дождь', cover: 1.0, dark: 0.45, overcast: 1, fog: 0.0018, sun: 0.15, sat: 0.9, rain: 1, snow: 0, storm: 0 },
        storm: { name: 'Гроза', cover: 1.0, dark: 0.7, overcast: 1, fog: 0.0022, sun: 0.08, sat: 1.0, rain: 1, snow: 0, storm: 1 },
        snow: { name: 'Снег', cover: 1.0, dark: 0.15, overcast: 1, fog: 0.0025, sun: 0.25, sat: 0.9, rain: 0, snow: 1, storm: 0 },
    };
    const WKEYS: (keyof Omit<WeatherSettings, "name">)[] = ['cover', 'dark', 'overcast', 'fog', 'sun', 'sat', 'rain', 'snow', 'storm'];
    const wCur = Object.assign({}, WEATHERS.clear), wFrom = Object.assign({}, wCur);
    let wTo = WEATHERS.clear, wT = 1, flash = 0, flashTimer = 3, flashSeq = 0;
    const WEATHER_FADE = 3.0;
    let envDirty = false, envDirtyT = 0;
    function setWeather(id: string, instant = false) {
        if (!(id in WEATHERS))
            id = 'clear';
        const weatherId = id as import('./state').WeatherId;
        model.state.weather = weatherId;
        wTo = WEATHERS[weatherId];
        Object.assign(wFrom, wCur);
        wT = instant ? 1 : 0;
        if (instant)
            for (const k of WKEYS)
                wCur[k] = wTo[k];
        if (feedback.uiSync.weather)
            feedback.uiSync.weather();
    }
    const _c1 = new THREE.Color(), _c2 = new THREE.Color();
    const GREY = new THREE.Color();
    let precipitation = model.state.precipitation, fogIntensity = model.state.fogIntensity, envFogDensity = -1;
    const soundWeather = { rain: 0, snow: 0, dark: 0 };
    function atmosUpdate(dt: number) {
        atmosTime += dt;
        // интерполяция погоды
        if (wT < 1) {
            wT = Math.min(1, wT + dt / WEATHER_FADE);
            const s = wT * wT * (3 - 2 * wT);
            for (const k of WKEYS)
                wCur[k] = wFrom[k] + (wTo[k] - wFrom[k]) * s;
            envDirty = true;
        }
        const W = wCur, dayL = smoothstep(-6, 10, lighting.sunElevation);
        const blend = 1 - Math.exp(-Math.max(0, dt) * 5);
        precipitation += (model.state.precipitation - precipitation) * blend;
        fogIntensity += (model.state.fogIntensity - fogIntensity) * blend;
        if(Math.abs(precipitation-model.state.precipitation)<0.001)precipitation=model.state.precipitation;
        if(Math.abs(fogIntensity-model.state.fogIntensity)<0.001)fogIntensity=model.state.fogIntensity;
        const effects = weatherStrengths(render.atmosBase.fogDensity, W.fog, W.rain, W.snow, precipitation, fogIntensity);
        soundWeather.rain = Math.min(1, effects.rain); soundWeather.snow = Math.min(1, effects.snow); soundWeather.dark = W.dark;
        // молнии
        if (W.storm > 0.5) {
            flashTimer -= dt;
            if (flashTimer <= 0) {
                flashSeq = 1 + ((Math.random() * 3) | 0);
                flash = 1;
                flashTimer = 3 + Math.random() * 7;
            }
        }
        if (flash > 0) {
            flash = Math.max(0, flash - dt * 7);
            if (flash === 0 && flashSeq > 1) {
                flashSeq--;
                flash = 0.8;
            }
            if (flash === 0)
                flashSeq = 0;
        }
        const fl = flash * W.storm;
        // свет
        render.sun.intensity = render.atmosBase.sunInt * W.sun;
        render.hemi.intensity = render.atmosBase.hemiInt * (1 - 0.25 * W.overcast) + fl * 2.5;
        // туман
        const d = effects.fog;
        render.fog.density = d;
        materials.waterUniforms.uFogDensity.value = d;
        GREY.setRGB(0.62, 0.65, 0.69, THREE.SRGBColorSpace).multiplyScalar((0.1 + 0.9 * dayL) * (1 - 0.45 * W.dark));
        _c1.copy(render.atmosBase.fogColor).lerp(GREY, W.sat);
        if (fl > 0)
            _c1.lerp(_c2.setRGB(0.7, 0.75, 0.9), fl * 0.5);
        render.fog.color.copy(_c1);
        if(Math.abs(d-envFogDensity)>Math.max(.00001,envFogDensity*.05)){envDirty=true;envFogDensity=d;}
        cloudUniforms.uFogDensity.value=d;cloudUniforms.uFogColor.value.copy(_c1);
        materials.waterUniforms.uFogColor.value.copy(_c1);
        materials.waterUniforms.uSkyHorizon.value.copy(render.atmosBase.skyHorizon).lerp(_c1, W.sat);
        materials.waterUniforms.uSkyZenith.value.copy(render.atmosBase.skyZenith).lerp(_c1, W.sat);
        materials.waterUniforms.uSunColor.value.copy(render.atmosBase.sunColor).multiplyScalar(W.sun * (1 - W.overcast * 0.9));
        // небо: обесцвечивание
        for (const s of [render.sky, render.envSky]) {
            const u = s.material.uniforms;
            u.rayleigh.value = 3.0 - 2.4 * W.sat;
            u.turbidity.value = 2.5 + 8 * W.sat;
            u.mieCoefficient.value = 0.005 * (1 - 0.8 * W.overcast);
        }
        // облака
        const wr = THREE.MathUtils.degToRad(model.state.windDir), ws = model.state.windSpeed;
        const wx = Math.sin(wr) * ws, wz = Math.cos(wr) * ws;
        cloudUniforms.uOffset.value.x -= wx * dt * 25;
        cloudUniforms.uOffset.value.y -= wz * dt * 25; // дрейф облаков по ветру
        cloudUniforms.uTime.value = atmosTime;
        cloudUniforms.uCover.value = W.cover;
        cloudUniforms.uForeground.value=render.camera.position.y>CLOUD_ALTITUDE-1||model.maxH>CLOUD_ALTITUDE-1?1:0;
        clouds.visible=cloudUniforms.uForeground.value>.5&&W.cover>.01;
        cloudUniforms.uDark.value = W.dark;
        cloudUniforms.uFlash.value = fl;
        const warm = smoothstep(2, 35, lighting.sunElevation);
        cloudUniforms.uLit.value.setRGB(1.0, 0.75 + 0.25 * warm, 0.6 + 0.4 * warm).multiplyScalar(0.04 + 1.7 * dayL * (1 - 0.35 * W.overcast));
        cloudUniforms.uShade.value.setRGB(0.55, 0.58, 0.64).multiplyScalar((0.03 + 0.8 * dayL) * (1 - 0.5 * W.dark));
        // Capture only after all sky uniforms are current, and throttle slider changes.
        if (envDirty) {
            envDirtyT += dt;
            if (envDirtyT > 0.6) {
                envDirtyT = 0;
                envDirty = wT < 1;
                lighting.updateEnv();
            }
        }
        // звёзды
        const night = 1 - smoothstep(-4, 10, lighting.sunElevation);
        starMat.uniforms.uOpacity.value = night * (1 - W.cover * 0.95) * Math.max(0, 1 - d * 100);
        starMat.uniforms.uTime.value = atmosTime;
        stars.visible = starMat.uniforms.uOpacity.value > 0.003;
        stars.position.copy(render.camera.position);
        // осадки
        precipUniforms.uTime.value = atmosTime;
        precipUniforms.uCam.value.copy(render.camera.position);
        precipUniforms.uWind.value.set(wx, wz);
        const pr = Math.max(effects.rain, effects.snow);
        precipUniforms.uOpacity.value = Math.min(1, pr * 4) * (0.25 + 0.75 * dayL + fl * 0.6);
        precipUniforms.uColor.value.setRGB(0.8, 0.84, 0.92).multiplyScalar(0.35 + 0.65 * dayL);
        rain.geometry.setDrawRange(0, Math.round(7000 * effects.rain) * 2);
        snow.geometry.setDrawRange(0, Math.round(9000 * effects.snow));
        rain.visible = effects.rain > 0.001;
        snow.visible = effects.snow > 0.001;
    }
    return { WEATHERS, wCur, soundWeather, starMat, clouds, rain, snow, setWeather, atmosUpdate, };
}
export type WeatherSystem = ReturnType<typeof createWeather>;
