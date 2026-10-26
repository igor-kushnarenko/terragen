import * as T from 'three';
import type {EditorModel} from './state';
import type {WaterSurface} from './water-surface';
import type {CollisionSystem} from './collisions';
import type {RenderingSystem} from './rendering';
import {WATER_PROFILES,effectiveQuality} from './quality';
interface ContactPose{on:boolean;paused:boolean;swim:boolean;feet:T.Vector3;}
export function createWaterInteractions(model:EditorModel,water:WaterSurface,collisions:CollisionSystem,render:RenderingSystem){
    const max=128,positions=new Float32Array(max*3),life=new Float32Array(max),geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.BufferAttribute(positions,3));geometry.setAttribute('aLife',new T.BufferAttribute(life,1));
    const material=new T.ShaderMaterial({transparent:true,depthWrite:false,uniforms:{uScale:{value:500},uLight:{value:.8}},vertexShader:'attribute float aLife;varying float vLife;uniform float uScale;void main(){vLife=aLife;vec4 p=modelViewMatrix*vec4(position,1);gl_Position=projectionMatrix*p;gl_PointSize=clamp(uScale*.045/max(1.0,-p.z),1.0,9.0);}',fragmentShader:'varying float vLife;uniform float uLight;void main(){float r=length(gl_PointCoord-.5);if(r>.5||vLife<=0.0)discard;gl_FragColor=vec4(vec3(.7,.85,.9)*uLight,vLife*(1.0-smoothstep(.2,.5,r)));\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}'}),points=new T.Points(geometry,material);points.frustumCulled=false;points.userData.noWaterReflection=true;render.scene.add(points);
    const particles:{p:T.Vector3;v:T.Vector3;age:number;ttl:number}[]=[],last=new T.Vector3(),look=new T.Vector3(),wakes=new Map<string,{x:number;z:number;timer:number;wet:boolean}>();let wasWet=false,walkDistance=0,rainTime=0,index=0,steps=0;
    const random=()=>{let x=Math.imul(++index,0x45d9f3b);x=Math.imul(x^(x>>>16),0x45d9f3b);return ((x^(x>>>16))>>>0)/4294967296;};
    function splash(x:number,y:number,z:number,amount:number){for(let i=0;i<amount&&particles.length<max;i++){const a=random()*Math.PI*2,s=.3+random()*1.2;particles.push({p:new T.Vector3(x,y+.04,z),v:new T.Vector3(Math.cos(a)*s,1+random()*1.8,Math.sin(a)*s),age:0,ttl:.35+random()*.4});}}
    function step(dt:number,pose:ContactPose,rain:number){
        water.advance(dt);steps++;
        if(pose.on&&!pose.paused){const s=water.sample(pose.feet.x,pose.feet.z),wet=pose.feet.y<s.level+.08,distance=last.distanceTo(pose.feet);if(wet&&distance<3)walkDistance+=distance;
            if(wet&&(!wasWet||walkDistance>(pose.swim?.7:.65))){const strength=pose.swim?.065:.1;water.addImpact(pose.feet.x,pose.feet.z,strength,.15);splash(pose.feet.x,s.level,pose.feet.z,pose.swim?5:10);walkDistance=0;}wasWet=wet;
            for(const [id,item]of collisions.floating){let wake=wakes.get(id);if(!wake){wake={x:item.pose.position.x,z:item.pose.position.z,timer:0,wet:false};wakes.set(id,wake);}wake.timer+=dt;const p=item.pose.position,s=water.sample(p.x,p.z),wet=p.y+item.bounds.min.y<s.level;
                if(wet&&!wake.wet&&p.y+item.bounds.max.y>s.level-.2){water.addImpact(p.x,p.z,Math.min(.14,.035+Math.abs(item.body.linvel().y)*.025),.25);splash(p.x,s.level,p.z,6);}wake.wet=wet;
                if(wake.timer>.35&&Math.hypot(p.x-wake.x,p.z-wake.z)>.08&&Math.abs(p.y-s.level)<4){water.addImpact(p.x,p.z,.045,.25);wake.x=p.x;wake.z=p.z;wake.timer=0;}}
        }else {wasWet=false;walkDistance=0;wakes.clear();}last.copy(pose.feet);
        rainTime+=dt*Math.max(0,rain)*WATER_PROFILES[effectiveQuality(model)].rainRate;
        while(rainTime>=1){rainTime--;render.camera.getWorldDirection(look);const camera=render.camera.position,probe=water.sample(camera.x+look.x*25,camera.z+look.z*25),ahead=look.y<-.001?Math.max(0,Math.min(35,(probe.meanLevel-camera.y)/look.y)):12;
            const a=random()*Math.PI*2,d=Math.sqrt(random())*22,x=camera.x+look.x*ahead+Math.cos(a)*d,z=camera.z+look.z*ahead+Math.sin(a)*d;water.addImpact(x,z,.012,.025);}
        for(let i=particles.length-1;i>=0;i--){const p=particles[i];p.age+=dt;p.v.y-=9.81*dt;p.p.addScaledVector(p.v,dt);if(p.age>p.ttl)particles.splice(i,1);}
    }
    function update(){positions.fill(0);life.fill(0);particles.forEach((p,i)=>{positions.set(p.p.toArray(),i*3);life[i]=1-p.age/p.ttl;});geometry.attributes.position.needsUpdate=geometry.attributes.aLife.needsUpdate=true;geometry.setDrawRange(0,particles.length);material.uniforms.uScale.value=render.renderer.domElement.height;material.uniforms.uLight.value=.15+.85*Math.max(0,Math.sin(model.state.sunEl*Math.PI/180));}
    return {step,update,reset(){water.reset();particles.length=0;wakes.clear();wasWet=false;walkDistance=rainTime=0;last.set(0,0,0);},get statistics(){return {steps,splashes:particles.length};},dispose(){geometry.dispose();material.dispose();points.removeFromParent();}};
}
