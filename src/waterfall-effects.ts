import {effectiveQuality} from './quality';
import * as T from 'three';
import {mulberry32} from './noise';
import type {EditorModel} from './state';
import type {WaterBody} from './world';

export function waterfallPlan(body:WaterBody){
    if(body.outlet===undefined||!body.pointLevels)return null;
    const lip=body.outlet,sea=body.endLevel??body.level,drop=body.pointLevels[lip]-sea;
    if(drop<=.75)return null;
    const base=body.pointLevels.findIndex((h,i)=>i>lip&&h===sea);if(base<0)return null;
    const a=body.points[lip],b=body.points[base],run=Math.hypot(b[0]-a[0],b[1]-a[1]);if(run<.01)return null;
    return {x:a[0],z:a[1],top:body.pointLevels[lip],sea,drop,run,dx:(b[0]-a[0])/run,dz:(b[1]-a[1])/run,width:body.width};
}
export function waterfallCurtain(plan:NonNullable<ReturnType<typeof waterfallPlan>>,layers=3,steps=24){
    const positions:number[]=[],uv:number[]=[],indices:number[]=[],layer:number[]=[],across=12;
    for(let l=0;l<layers;l++)for(let j=0;j<=steps;j++)for(let i=0;i<=across;i++){
        const u=i/across,t=j/steps,spread=1+t*.16,side=(u-.5)*plan.width*spread;
        const bulge=Math.sin(t*Math.PI)*(l-(layers-1)/2)*Math.min(.35,plan.width*.045);
        positions.push(plan.x+plan.dx*(plan.run*t+bulge)-plan.dz*side,plan.top-plan.drop*t*t+.025,plan.z+plan.dz*(plan.run*t+bulge)+plan.dx*side);
        uv.push(u,t);layer.push(l);
        if(j<steps&&i<across){const a=l*(steps+1)*(across+1)+j*(across+1)+i,b=a+across+1;indices.push(a,b,a+1,a+1,b,b+1);}
    }
    const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setAttribute('aLayer',new T.Float32BufferAttribute(layer,1));g.setIndex(indices);g.computeBoundingSphere();g.boundingSphere!.radius+=plan.width*.2;return g;
}
const noise=`float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}float noise(vec2 p){vec2 i=floor(p),f=fract(p),u=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1,0)),u.x),mix(hash(i+vec2(0,1)),hash(i+1.0),u.x),u.y);}`;
const finish=`float fog=1.0-exp(-uFogDensity*uFogDensity*dot(cameraPosition-vWorld,cameraPosition-vWorld));gl_FragColor.rgb=mix(gl_FragColor.rgb,uFogColor,fog);
#include <tonemapping_fragment>
#include <colorspace_fragment>
`;
const fragmentCommon=`uniform float uTime,uFogDensity;uniform vec3 uFogColor;varying vec3 vWorld;${noise}`;

/** Bounded procedural visual effects: no particles or animation data are saved in the project. */
export function createWaterfallEffects(model:EditorModel,scene:T.Scene,shared:{uTime:{value:number};uFogDensity:{value:number};uFogColor:{value:T.Color}}){
    const root=new T.Group();root.name='Waterfall streams, spray and plunge foam';root.userData.noWaterReflection=true;scene.add(root);
    let bodies:WaterBody[]|undefined,quality=effectiveQuality(model),particles=0;
    function clear(){root.traverse(o=>{if(o instanceof T.Mesh||o instanceof T.Points){o.geometry.dispose();(o.material as T.Material).dispose();}});root.clear();particles=0;}
    function rebuild(){
        clear();bodies=model.world.waterBodies;quality=effectiveQuality(model);
        const layers=quality==='low'?2:quality==='high'?4:3,count=quality==='low'?64:quality==='high'?256:144;
        for(const body of bodies){const p=waterfallPlan(body);if(!p)continue;
            const group=new T.Group();group.userData.center=new T.Vector3(p.x,p.sea+p.drop*.5,p.z);group.userData.range=Math.max(200,p.width*25);root.add(group);
            const uniforms={...shared,uWidth:{value:p.width},uSide:{value:new T.Vector2(-p.dz,p.dx)}};
            const curtain=new T.ShaderMaterial({uniforms,transparent:true,depthWrite:false,side:T.DoubleSide,
                vertexShader:`uniform float uTime,uWidth;uniform vec2 uSide;attribute float aLayer;varying vec2 vUv;varying float vLayer;varying vec3 vWorld;
void main(){vUv=uv;vLayer=aLayer;vec3 p=position;float motion=sin(uv.x*43.0+uv.y*27.0-uTime*(5.0+aLayer))+.4*sin(uv.x*79.0-uv.y*41.0+uTime*8.0+aLayer);p.xz+=uSide*motion*uWidth*.012*sin(uv.y*3.14159);vWorld=p;gl_Position=projectionMatrix*viewMatrix*vec4(p,1);}`,
                fragmentShader:`${fragmentCommon}varying vec2 vUv;varying float vLayer;
void main(){vec2 q=vec2(vUv.x*23.0+vLayer*7.3,vUv.y*9.0-uTime*(2.2+vLayer*.3));float n=noise(q),threads=noise(vec2(q.x*2.7,q.y*.45));float edge=1.0-smoothstep(.72,1.0,abs(vUv.x*2.0-1.0)+(.5-n)*.18);float breakup=mix(1.0,smoothstep(.14,.58,threads),smoothstep(.3,1.0,vUv.y)*.75);float alpha=edge*breakup*(.28+.42*threads);if(alpha<.025)discard;float air=smoothstep(.15,.9,vUv.y);vec3 col=mix(vec3(.12,.31,.37),vec3(.77,.87,.89),clamp(threads*.7+n*.15+air*.4,0.0,1.0));gl_FragColor=vec4(col,alpha);${finish}}`});
            const sheet=new T.Mesh(waterfallCurtain(p,layers,quality==='low'?16:24),curtain);sheet.renderOrder=3;group.add(sheet);
            const base=new T.Vector3(p.x+p.dx*p.run,p.sea+.07,p.z+p.dz*p.run),random=mulberry32(model.state.seed^body.id.split('').reduce((a,c)=>Math.imul(a,31)+c.charCodeAt(0),0));
            const seeds=new Float32Array(count*4);for(let i=0;i<seeds.length;i++)seeds[i]=random();
            const sprayGeometry=new T.BufferGeometry();sprayGeometry.setAttribute('position',new T.Float32BufferAttribute(new Float32Array(count*3),3));sprayGeometry.setAttribute('aSeed',new T.BufferAttribute(seeds,4));
            const sprayMaterial=new T.ShaderMaterial({uniforms:{...shared,uBase:{value:base},uSide:{value:new T.Vector2(-p.dz,p.dx)},uForward:{value:new T.Vector2(p.dx,p.dz)},uWidth:{value:p.width},uPower:{value:Math.min(2.5,Math.sqrt(p.drop)*.55)}},transparent:true,depthWrite:false,
                vertexShader:`uniform float uTime,uWidth,uPower;uniform vec3 uBase;uniform vec2 uSide,uForward;attribute vec4 aSeed;varying float vAlpha;varying vec3 vWorld;
void main(){float life=fract(uTime*(.6+aSeed.w*.4)+aSeed.x),age=life*1.3;vec3 p=uBase;vec2 velocity=uSide*(aSeed.y-.5)*uPower*3.0+uForward*(.6+aSeed.z)*uPower;p.xz+=uSide*(aSeed.z-.5)*uWidth+velocity*age;p.y+=max(0.0,(2.0+aSeed.y*2.0)*uPower*age-4.9*age*age);vAlpha=sin(life*3.14159)*(aSeed.w>.8?.14:.55);vWorld=p;vec4 view=viewMatrix*vec4(p,1);gl_Position=projectionMatrix*view;gl_PointSize=clamp((aSeed.w>.8?1.0:.12)*360.0/max(1.0,-view.z),1.0,40.0);}`,
                fragmentShader:`${fragmentCommon}varying float vAlpha;void main(){float r=length(gl_PointCoord-.5)*2.0;if(r>1.0)discard;gl_FragColor=vec4(.83,.91,.93,vAlpha*exp(-r*r*3.0)*(1.0-smoothstep(.7,1.0,r)));${finish}}`});
            const spray=new T.Points(sprayGeometry,sprayMaterial);spray.frustumCulled=false;spray.renderOrder=4;group.add(spray);particles+=count;
            const foamGeometry=new T.PlaneGeometry(p.width*2.4,p.width*2.4);foamGeometry.rotateX(-Math.PI/2);foamGeometry.translate(base.x,base.y,base.z);
            const foamMaterial=new T.ShaderMaterial({uniforms:shared,transparent:true,depthWrite:false,side:T.DoubleSide,
                vertexShader:'varying vec2 vUv;varying vec3 vWorld;void main(){vUv=uv;vWorld=position;gl_Position=projectionMatrix*viewMatrix*vec4(position,1);}',
                fragmentShader:`${fragmentCommon}varying vec2 vUv;void main(){vec2 p=(vUv-.5)*2.0;float r=length(p),n=noise(p*7.0-uTime*.3),edge=1.0-smoothstep(.55+n*.18,.95,r);float ring=pow(.5+.5*sin(r*25.0-uTime*4.0+n*4.0),4.0);float a=edge*(.08+.24*n+.18*ring);if(a<.01)discard;gl_FragColor=vec4(.78,.87,.86,a);${finish}}`});
            const foam=new T.Mesh(foamGeometry,foamMaterial);foam.renderOrder=3;group.add(foam);
        }
    }
    return {update(camera:T.Camera){if(bodies!==model.world.waterBodies||quality!==effectiveQuality(model))rebuild();for(const g of root.children)g.visible=camera.position.distanceTo(g.userData.center)<g.userData.range;},get statistics(){return {waterfalls:root.children.length,sprayParticles:particles};},dispose(){clear();root.removeFromParent();}};
}
