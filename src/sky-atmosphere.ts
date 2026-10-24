import * as T from 'three';
import type {RenderingSystem} from './rendering';
import {ATMOSPHERE_RADIUS,CLOUD_ALTITUDE,SKY_FOG_HEIGHT,SKY_FOG_MIN_ELEVATION} from './atmosphere-settings';

export const skyFogGLSL=`
float atmosphereFog(float distance){float opticalDepth=uFogDensity*distance;return 1.0-exp(-opticalDepth*opticalDepth);}
float skyFogPath(float elevation){return ${SKY_FOG_HEIGHT.toFixed(1)}/max(${SKY_FOG_MIN_ELEVATION.toFixed(3)},elevation);}
`;
const cloudGLSL=`
uniform float uTime,uCover,uDark,uFlash,uFogDensity,uForeground,uIsEnvironment;
uniform vec2 uOffset;
uniform vec3 uLit,uShade,uSunDir,uFogColor,uObserverOffset;
${skyFogGLSL}
float cloudHash(vec2 p){vec3 q=fract(p.xyx*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
float cloudNoise(vec2 p){vec2 i=floor(p),f=fract(p),u=f*f*(3.0-2.0*f);
return mix(mix(cloudHash(i),cloudHash(i+vec2(1,0)),u.x),mix(cloudHash(i+vec2(0,1)),cloudHash(i+vec2(1,1)),u.x),u.y);}
float cloudFbm(vec2 p){
    float footprint=max(length(dFdx(p)),length(dFdy(p))),s=0.0,a=.5;
    for(int i=0;i<5;i++){
        // Unresolved distant octaves approach their average instead of flickering.
        float weight=1.0-smoothstep(.35,1.0,footprint);
        s+=a*mix(.5,cloudNoise(p),weight);p=p*2.07+vec2(13.7,5.1);a*=.5;footprint*=2.07;
    }
    return s/.97;
}
float cloudDistance(vec3 observer,vec3 direction){
    float b=(${ATMOSPHERE_RADIUS.toFixed(1)}+observer.y)*direction.y;
    float c=(observer.y-${CLOUD_ALTITUDE.toFixed(1)})*(2.0*${ATMOSPHERE_RADIUS.toFixed(1)}+observer.y+${CLOUD_ALTITUDE.toFixed(1)});
    float discriminant=b*b-c;
    if(discriminant<0.0)return -1.0;
    float root=sqrt(discriminant),farHit=-b+root;
    if(farHit<=0.0)return -1.0;
    return c<=0.0?(b>0.0?-c/(b+root):farHit):c/farHit;
}
vec4 cloudLayer(vec3 direction,out float distance){
    vec3 observer=cameraPosition+uObserverOffset;
    distance=cloudDistance(observer,direction);
    if(distance<0.0||uCover<=.01)return vec4(0.0);
    vec2 p=(observer.xz+direction.xz*distance+uOffset)*.00045;
    float n=cloudFbm(p),n2=cloudFbm(p*2.3+vec2(uTime*.01,0));
    float th=1.0-uCover,field=n*.8+n2*.25;
    float density=smoothstep(th-.05,th+.15,field);
    density=max(density,smoothstep(.75,1.0,uCover)*(.85+.15*n2));
    float thick=smoothstep(th-.05,th+.3,field);
    vec3 color=mix(uLit,uShade,clamp(thick*.9+uDark,0.0,1.0));
    float edge=(1.0-thick)*pow(max(dot(direction,uSunDir),0.0),6.0);
    color+=uLit*edge*.6+vec3(.75,.8,1.0)*uFlash*(.4+thick);
    return vec4(color,density);
}
`;

/** One background pass; independent of map extents and the camera's far plane. */
export function createSkyAtmosphere(render:Pick<RenderingSystem,'sky'|'envSky'|'sunDir'|'camera'|'scene'>){
    const uniforms={uTime:{value:0},uCover:{value:0},uDark:{value:0},uFlash:{value:0},uOffset:{value:new T.Vector2()},
        uLit:{value:new T.Color()},uShade:{value:new T.Color()},uSunDir:{value:render.sunDir},uFogColor:{value:new T.Color()},uFogDensity:{value:0},uForeground:{value:0}};
    for(const sky of [render.sky,render.envSky]){
        const material=sky.material;
        Object.assign(material.uniforms,uniforms,{uObserverOffset:{value:sky===render.envSky?render.camera.position:new T.Vector3()},uIsEnvironment:{value:sky===render.envSky?1:0}});
        // The addon has its own clouds. Use one weather-controlled cloud field.
        material.uniforms.cloudCoverage.value=0;
        // Camera-relative rays work for main, reflected and environment cameras.
        material.vertexShader=material.vertexShader
            .replace('modelMatrix * vec4( position, 1.0 )','modelMatrix * vec4( position, 0.0 ) + vec4( cameraPosition, 1.0 )')
            .replace('projectionMatrix * modelViewMatrix * vec4( position, 1.0 )','projectionMatrix * viewMatrix * worldPosition');
        material.fragmentShader=cloudGLSL+material.fragmentShader.replace('#include <colorspace_fragment>',`
            #include <colorspace_fragment>
            vec3 fogOutput=linearToOutputTexel(vec4(uFogColor,1.0)).rgb;
            float skyFog=atmosphereFog(skyFogPath(direction.y));
            gl_FragColor.rgb=mix(gl_FragColor.rgb,fogOutput,skyFog);
            if(uCover>.01&&skyFog<.9999&&(uForeground<.5||uIsEnvironment>.5)){
                float cloudPath;vec4 cloud=cloudLayer(direction,cloudPath);
                #if defined(TONE_MAPPING)
                    cloud.rgb=toneMapping(cloud.rgb);
                #endif
                cloud.rgb=linearToOutputTexel(vec4(cloud.rgb,1.0)).rgb;
                cloud.rgb=mix(cloud.rgb,fogOutput,max(skyFog,atmosphereFog(max(0.0,cloudPath))));
                gl_FragColor.rgb=mix(gl_FragColor.rgb,cloud.rgb,cloud.a);
            }
        `);
        sky.frustumCulled=false;material.needsUpdate=true;
    }
    // Usually the background is sufficient. Above the layer (or beside peaks
    // penetrating it), clouds must also occlude geometry between them and the sky.
    const material=new T.ShaderMaterial({uniforms:{...uniforms,uObserverOffset:{value:new T.Vector3()},uIsEnvironment:{value:0}},side:T.BackSide,transparent:true,depthWrite:false,fog:false,
        vertexShader:`varying vec3 vCloudDirection;void main(){
            vCloudDirection=(modelMatrix*vec4(position,0.0)).xyz;
            gl_Position=projectionMatrix*viewMatrix*vec4(vCloudDirection+cameraPosition,1.0);gl_Position.z=gl_Position.w;
        }`,fragmentShader:cloudGLSL+`
        uniform mat4 projectionMatrix;varying vec3 vCloudDirection;
        void main(){
            vec3 direction=normalize(vCloudDirection);float skyFog=atmosphereFog(skyFogPath(direction.y));
            if(skyFog>.9999)discard;
            float distance;vec4 cloud=cloudLayer(direction,distance);if(cloud.a<.003)discard;
            vec4 clip=projectionMatrix*viewMatrix*vec4(cameraPosition+direction*distance,1.0);
            gl_FragDepth=clamp(.5+.5*clip.z/clip.w,0.0,.9999999);
            gl_FragColor=cloud;
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
            gl_FragColor.rgb=mix(gl_FragColor.rgb,linearToOutputTexel(vec4(uFogColor,1.0)).rgb,max(skyFog,atmosphereFog(distance)));
        }`});
    const clouds=new T.Mesh(new T.BoxGeometry(2,2,2),material);clouds.scale.setScalar(100);clouds.frustumCulled=false;clouds.renderOrder=3;clouds.visible=false;render.scene.add(clouds);
    return {uniforms,clouds};
}
