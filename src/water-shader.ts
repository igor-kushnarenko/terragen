import * as T from 'three';
import {WATER_WAVE_GLSL,MAX_WATER_IMPACTS} from './water-surface';

export function waterExtraUniforms(){
    return {uWindSpeed:{value:.5},uWindAngle:{value:0},uWaterKind:{value:0},uClarity:{value:12},
        uImpacts:{value:Array.from({length:MAX_WATER_IMPACTS},()=>new T.Vector4())},uImpactMeta:{value:Array.from({length:MAX_WATER_IMPACTS},()=>new T.Vector4())},uImpactCount:{value:0},
        uRefraction:{value:null as T.Texture|null},uSceneDepth:{value:null as T.Texture|null},uRefractionOn:{value:0},uViewport:{value:new T.Vector2(1,1)},uInverseProjection:{value:new T.Matrix4()},
        uFlowMap:{value:null as T.Texture|null},uFlowBounds:{value:new T.Vector4()},uFlowMapOn:{value:0},uDomainMap:{value:null as T.Texture|null},uDomainBounds:{value:new T.Vector4()},uDomainOn:{value:0},uCascade:{value:new T.Vector4(0,0,0,0)}};
}
const common=`uniform sampler2D uHeight,uFlowMap,uDomainMap;uniform vec4 uFlowBounds,uDomainBounds;uniform float uFlowMapOn,uSize,uN,uFlowSpeed,uDomainOn;
float bodyDomain(vec2 p){if(uDomainOn<.5)return 10000.0;vec2 uv=(p-uDomainBounds.xy)/uDomainBounds.zw;return texture2D(uDomainMap,clamp(uv,0.0,1.0)).r;}
float terrainHeight(vec2 p,float fallback){vec2 uv=p/uSize+.5;if(any(lessThan(uv,vec2(0.0)))||any(greaterThan(uv,vec2(1.0))))return fallback-60.0;return texture2D(uHeight,(uv*uN+.5)/(uN+1.0)).r;}
vec2 riverFlow(vec2 p,vec2 fallback){if(uFlowMapOn<.5)return fallback*uFlowSpeed;vec2 uv=(p-uFlowBounds.xy)/uFlowBounds.zw;return texture2D(uFlowMap,clamp(uv,0.0,1.0)).rg;}
`;
export const waterVertexShader=`${WATER_WAVE_GLSL}\n${common}
attribute vec2 aFlow;attribute float aTravel;
varying vec3 vWPos;varying float vMeanLevel,vTravel,vViewDepth;varying vec2 vFlow;
void main(){vec3 p=(modelMatrix*vec4(position,1.0)).xyz;vMeanLevel=p.y;vFlow=riverFlow(p.xz,aFlow);vTravel=aTravel;
p+=waterOffset(p.xz,p.y-terrainHeight(p.xz,p.y),vFlow);vWPos=p;vec4 view=viewMatrix*vec4(p,1.0);vViewDepth=-view.z;gl_Position=projectionMatrix*view;}`;

export const waterFragmentShader=`${WATER_WAVE_GLSL}\n${common}
uniform float uWater,uOpacity,uFogDensity,uWaterDetail,uFoamStrength,uReflectionOn,uReflectionLevel,uReflectionsEnabled,uRefractionOn,uClarity;
uniform vec3 uSunDir,uSunColor,uSkyZenith,uSkyHorizon,uDeep,uShallow,uFogColor;
uniform sampler2D uWaterLevels,uReflection,uRefraction,uSceneDepth;uniform mat4 uReflectionMatrix,uInverseProjection;uniform vec2 uViewport;
uniform vec4 uCascade;
varying vec3 vWPos;varying float vMeanLevel,vTravel,vViewDepth;varying vec2 vFlow;
float hash12(vec2 p){vec3 p3=fract(vec3(p.xyx)*.1031);p3+=dot(p3,p3.yzx+33.33);return fract((p3.x+p3.y)*p3.z);}
// Isotropic gradient noise avoids the zero-gradient square borders of bilinear value noise.
float noiseCorner(vec2 cell,vec2 delta){float w=max(0.0,.5-dot(delta,delta));vec2 g=vec2(hash12(cell),hash12(cell+vec2(17.13,3.71)))*2.0-1.0;g*=inversesqrt(max(.001,dot(g,g)));return w*w*w*w*dot(g,delta);}
float vnoise(vec2 p){const float F=.3660254038,G=.2113248654;vec2 cell=floor(p+(p.x+p.y)*F),d=p-cell+(cell.x+cell.y)*G;
vec2 rank=d.x>d.y?vec2(1.0,0.0):vec2(0.0,1.0);return clamp(.5+35.0*(noiseCorner(cell,d)+noiseCorner(cell+rank,d-rank+G)+noiseCorner(cell+1.0,d-1.0+2.0*G)),0.0,1.0);}
float sceneDistance(vec2 uv){float d=texture2D(uSceneDepth,uv).r;vec4 view=uInverseProjection*vec4(uv*2.0-1.0,d*2.0-1.0,1.0);return -view.z/view.w;}
void main(){
vec2 p=vWPos.xz,huv=p/uSize+.5;float th=terrainHeight(p,vMeanLevel),depth=vWPos.y-th;
if(depth<.002)discard;
float domain=bodyDomain(p);if(domain<0.0&&(th<vMeanLevel-.1||vWPos.y<=vMeanLevel+.01))discard;
if(all(greaterThan(huv,vec2(0)))&&all(lessThan(huv,vec2(1)))){vec2 surface=texture2D(uWaterLevels,huv).rg;if(abs(surface.g-uBodyIndex)>.5&&surface.r>vMeanLevel+.5)discard;}
vec3 toCam=cameraPosition-vWPos;float dist=length(toCam);vec3 V=toCam/max(.001,dist);
vec2 flow=riverFlow(p,vFlow/max(uFlowSpeed,.001));
vec2 gradient=waterGradient(p,vMeanLevel-th,flow);vec3 N=normalize(vec3(-gradient.x,1.0,-gradient.y));
vec3 faceNormal=normalize(cross(dFdx(vWPos),dFdy(vWPos)));float waterfall=1.0-smoothstep(.25,.7,abs(faceNormal.y));
// Sea-level tails use the ocean surface; a separate layered effect renders the falling water.
if(uWaterKind>1.5&&uCascade.w>0.0&&vMeanLevel<=uWater+.06)discard;
if(uWaterKind>1.5&&uCascade.w>.75&&waterfall>.35)discard;
if(!gl_FrontFacing)faceNormal=-faceNormal;N=normalize(mix(N,faceNormal,waterfall));
N=normalize(mix(N,vec3(0.0,1.0,0.0),smoothstep(150.0,2500.0,dist)*.85));
float cycle=fract(uTime*.12),blend=abs(cycle-.5)*2.0;
vec2 q=p*.85-flow*cycle/ .12,q2=p*.85-flow*fract(cycle+.5)/.12;
float e=.08;
vec2 micro=mix(vec2(vnoise(q+vec2(e,0))-vnoise(q-vec2(e,0)),vnoise(q+vec2(0,e))-vnoise(q-vec2(0,e))),vec2(vnoise(q2+vec2(e,0))-vnoise(q2-vec2(e,0)),vnoise(q2+vec2(0,e))-vnoise(q2-vec2(0,e))),blend);
micro+=vec2(sin(p.x*5.1+p.y*3.7-uTime*2.4),cos(p.y*5.8-p.x*2.2+uTime*1.8))*.015;
N=normalize(N+vec3(-micro.x,0.0,-micro.y)*min(1.0,uWaterDetail)*min(3.0,uWave)*(.1+min(3.0,uWindSpeed)*.3)*smoothstep(0.0,1.0,depth)*(1.0-smoothstep(50.0,300.0,dist)));
bool below=!gl_FrontFacing;if(below)N=-N;
float fres=.02+.98*pow(1.0-clamp(dot(N,V),0.0,1.0),5.0);
vec3 R=reflect(-V,N);R.y=abs(R.y);vec3 sky=mix(uSkyHorizon,uSkyZenith,pow(clamp(R.y,0.0,1.0),.45));
vec4 reflected=uReflectionMatrix*vec4(vWPos.x,vMeanLevel,vWPos.z,1.0);vec2 reflectionUV=reflected.xy/max(reflected.w,.0001)+N.xz*.035;
if(uReflectionOn>.5&&!below&&abs(vMeanLevel-uReflectionLevel)<.8&&reflected.w>0.0&&all(greaterThan(reflectionUV,vec2(.01)))&&all(lessThan(reflectionUV,vec2(.99)))){
float reflectionEdge=min(min(reflectionUV.x,reflectionUV.y),min(1.0-reflectionUV.x,1.0-reflectionUV.y));
sky=mix(sky,texture2D(uReflection,reflectionUV).rgb,.92*smoothstep(.01,.07,reflectionEdge));}
float sun=max(uSunDir.y,0.0),path=depth;vec3 scatter=mix(uShallow,uDeep,1.0-exp(-depth*.08))*(.35+.65*sun),transmitted=scatter;float alpha=mix(uOpacity,1.0,fres)*smoothstep(0.0,1.3,depth);
if(uRefractionOn>.5){vec2 uv=gl_FragCoord.xy/uViewport;float rawDistance=sceneDistance(uv);vec2 shift=N.xz*.018*min(1.0,max(0.0,rawDistance-vViewDepth)/2.0);vec2 refracted=clamp(uv+shift,.002,.998);
if(sceneDistance(refracted)<vViewDepth+.02)refracted=uv;
path=clamp((sceneDistance(refracted)-vViewDepth)*dist/max(.1,vViewDepth),0.0,100.0);
if(below)path=0.0;
vec3 absorption=vec3(3.6,1.15,.62)/max(.1,uClarity)*(.04+uOpacity*1.5),transmittance=exp(-absorption*path);
transmitted=texture2D(uRefraction,refracted).rgb*transmittance+scatter*(1.0-transmittance);
// Captured background is already composited here; a second alpha blend would count it twice.
alpha=1.0;}
// Warped noise contours form moving caustic arcs. Adding two sine waves made
// exact intersecting straight lines (sin A + sin B), visible as a tiled grid.
vec2 causticWarp=vec2(vnoise(p*.19+uTime*.03),vnoise(p*.23+vec2(17.0,-9.0)-uTime*.02));
float caustic=1.0-smoothstep(.015,.06,abs(vnoise(p*.65+causticWarp*1.7+uTime*.04)-.56));
transmitted+=vec3(.045,.07,.055)*caustic*(1.0-smoothstep(.1,5.0,depth))*sun*min(1.0,uWaterDetail);
float spec=pow(max(dot(R,uSunDir),0.0),280.0)*6.0;
vec3 col=mix(transmitted,sky,fres*uReflectionsEnabled)+uSunColor*spec*uReflectionsEnabled;
float foamNoise=vnoise(p*.9-flow*uTime*.25),wash=.5+.5*sin(uTime*1.6+p.x*.13+p.y*.11);
float shore=(1.0-smoothstep(.05,.75+wash*.5,depth))*smoothstep(.35,.8,foamNoise+wash*.2)*smoothstep(0.0,.06,depth)*min(1.0,uWave*(.22+min(3.0,uWindSpeed)*.62));
float rapids=smoothstep(.65,.95,foamNoise)*pow(max(0.0,sin((vTravel-uTime*length(flow))*2.2)),8.0)*min(1.0,length(flow))*.3;
float localPeak=waveParameters(vMeanLevel-th).x*${.18+.085+.038+.016},crest=smoothstep(.12,.7,(vWPos.y-vMeanLevel)/max(.05,localPeak));
float breaker=crest*(1.0-smoothstep(1.0,3.0+waterBasePeak()*1.5,max(0.0,vMeanLevel-th)))*(.45+.55*foamNoise);
float whitecap=smoothstep(1.3,3.0,uWindSpeed)*crest*smoothstep(.55,.9,foamNoise)*.5;
float foam=max(max(shore,rapids),max(breaker,whitecap))*uFoamStrength*(below?0.0:1.0);
float fallingNoise=vnoise(vec2(vTravel*.7,vWPos.y*.55+uTime*3.0));
float splash=(1.0-smoothstep(uCascade.z*.25,max(.01,uCascade.z),distance(p,uCascade.xy)))*min(1.0,uCascade.w/3.0);
foam=max(foam,max(waterfall*(.55+.45*fallingNoise),splash*(.55+.45*foamNoise))*uFoamStrength*(below?0.0:1.0));
col=mix(col,vec3(.8,.87,.87)*(.25+.75*sun),foam*.8);alpha=clamp(alpha+foam*.5,0.0,1.0);
float ff=1.0-exp(-uFogDensity*uFogDensity*dist*dist);gl_FragColor=vec4(col,mix(alpha,1.0,ff));
#include <tonemapping_fragment>
#include <colorspace_fragment>
gl_FragColor.rgb = mix(gl_FragColor.rgb, linearToOutputTexel(vec4(uFogColor, 1.0)).rgb, ff);
}`;
