import RAPIER from '@dimforge/rapier3d-compat';
import {Quaternion,Vector3} from 'three';
import {BALLOON,type BalloonState,type BalloonPose} from './balloon-state';
import {aerodynamicDrag,ropeForce,thermalStep} from './balloon-physics';
import type {AirSample} from './atmosphere';
import type {CollisionParticipant} from './collisions';
import type {Vec3} from './world';
export interface BalloonCanopy {key:string;position:Vec3;half:Vec3;}

const vec=(a:readonly number[])=>({x:a[0],y:a[1],z:a[2]}),rot=(a:readonly number[])=>({x:a[0],y:a[1],z:a[2],w:a[3]});
export function createBalloonBody(s:BalloonState,airAt:(p:Vec3,time:number)=>AirSample,heightAt:(x:number,z:number)=>number,waterAt:(x:number,z:number)=>number,canopies:(p:Vec3)=>BalloonCanopy[]=()=>[]){
    let world:RAPIER.World|undefined,basket:RAPIER.RigidBody|undefined,envelope:RAPIER.RigidBody|undefined,anchor:RAPIER.RigidBody|undefined;
    let basketMass:RAPIER.Collider,envelopeMass:RAPIER.Collider,massTimer=0,lastMoored=s.moored,lastHook=s.hooked;
    const own=new Set<number>(),crowns=new Map<string,RAPIER.Collider>(),previous={basket:structuredClone(s.basket),envelope:structuredClone(s.envelope),anchor:structuredClone(s.anchor)};
    let crownTimer=0;
    let boost=false,ventHeld=false,hookCooldown=0;
    const metrics={power:0,air:airAt(s.envelope.position,s.time),tension:0,grounded:true,agl:0,winchStalled:false,impact:0,boundaryHit:false};
    function make(pose:BalloonPose,damping:number){const body=world!.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(...pose.position).setRotation(rot(pose.rotation)).setLinearDamping(0).setAngularDamping(damping).setCcdEnabled(true));body.setLinvel(vec(pose.velocity),true);body.setAngvel(vec(pose.angular),true);return body;}
    function collider(desc:RAPIER.ColliderDesc,body:RAPIER.RigidBody){const c=world!.createCollider(desc.setCollisionGroups(0x0004ffff).setRestitution(.02),body);own.add(c.handle);return c;}
    function updateCrowns(){
        const nearby=canopies(s.envelope.position).slice(0,96),wanted=new Set(nearby.map(c=>c.key));
        for(const [key,c]of crowns)if(!wanted.has(key)){own.delete(c.handle);world!.removeCollider(c,true);crowns.delete(key);}
        for(const p of nearby){let c=crowns.get(p.key);if(!c){c=world!.createCollider(RAPIER.ColliderDesc.cuboid(...p.half).setCollisionGroups(0x00020004).setFriction(.3));crowns.set(p.key,c);own.add(c.handle);}else c.setShape(new RAPIER.Cuboid(...p.half));c.setTranslation(vec(p.position));}
    }
    function capture(body:RAPIER.RigidBody,p:BalloonPose){const t=body.translation(),r=body.rotation(),v=body.linvel(),a=body.angvel();p.position=[t.x,t.y,t.z];p.rotation=[r.x,r.y,r.z,r.w];p.velocity=[v.x,v.y,v.z];p.angular=[a.x,a.y,a.z];}
    function ground(p:Vec3){if(!world)return heightAt(p[0],p[2]);const ray=new RAPIER.Ray({x:p[0],y:p[1]+.25,z:p[2]},{x:0,y:-1,z:0}),hit=world.castRay(ray,100000,true,undefined,undefined,undefined,undefined,c=>!own.has(c.handle)&&c.shape.type!==RAPIER.ShapeType.Capsule);return hit?p[1]+.25-hit.timeOfImpact:heightAt(p[0],p[2]);}
    function anchorAttachment(){return new Vector3(1.08,-.25,0).applyQuaternion(new Quaternion(...s.basket.rotation)).add(new Vector3(...s.basket.position));}
    function obstacleDistance(from:Vec3,to:Vec3){if(!world)return 0;const delta=new Vector3(...to).sub(new Vector3(...from)),distance=delta.length();delta.normalize();const hit=world.castRay(new RAPIER.Ray(vec(from),vec(delta.toArray())),distance,true,undefined,undefined,undefined,undefined,c=>!own.has(c.handle)&&c.shape.type!==RAPIER.ShapeType.Capsule);return hit?.timeOfImpact??distance;}
    const participant:CollisionParticipant={
        attach(next){
            world=next;own.clear();basket=make(s.basket,.7);envelope=make(s.envelope,.65);anchor=make(s.anchor,1);
            basketMass=collider(RAPIER.ColliderDesc.cuboid(.95,.12,.78).setTranslation(0,-.59,0).setMass(350).setFriction(.9),basket);
            for(const [x,z,hx,hz]of [[-.9,0,.1,.78],[.9,0,.1,.78],[0,-.73,.9,.08],[0,.73,.9,.08]])collider(RAPIER.ColliderDesc.cuboid(hx,.52,hz).setTranslation(x,0,z).setMass(0).setFriction(.8),basket);
            envelopeMass=collider(RAPIER.ColliderDesc.ball(8).setMass(3000).setFriction(.4),envelope);
            collider(RAPIER.ColliderDesc.ball(4.4).setTranslation(0,-7,0).setMass(0).setFriction(.4),envelope);
            collider(RAPIER.ColliderDesc.ball(.26).setMass(BALLOON.anchorMass).setFriction(2),anchor);
            for(const x of [-.68,.68])for(const z of [-.55,.55]){const joint=world.createImpulseJoint(RAPIER.JointData.rope(2.7,{x,y:2,z},{x:x*1.1,y:-13.3,z:z*1.1}),basket,envelope,true);joint.setContactsEnabled(false);}
            basket.setBodyType(s.moored?RAPIER.RigidBodyType.KinematicPositionBased:RAPIER.RigidBodyType.Dynamic,true);
            anchor.setEnabled(s.anchorOut&&!s.broken);anchor.setBodyType(s.hooked?RAPIER.RigidBodyType.KinematicPositionBased:RAPIER.RigidBodyType.Dynamic,true);
            lastMoored=s.moored;lastHook=s.hooked;massTimer=0;
            crownTimer=0;metrics.agl=Math.max(0,s.basket.position[1]-.72-Math.max(heightAt(s.basket.position[0],s.basket.position[2]),waterAt(s.basket.position[0],s.basket.position[2])));metrics.grounded=metrics.agl<.18&&Math.abs(s.basket.velocity[1])<.8;
            for(const key of ['basket','envelope','anchor'] as const)previous[key]=structuredClone(s[key]);
        },
        detach(){if(world){for(const c of crowns.values())if(c.isValid())world.removeCollider(c,true);for(const b of [anchor,basket,envelope])if(b?.isValid())world.removeRigidBody(b);}crowns.clear();world=undefined;basket=envelope=anchor=undefined;own.clear();},
        beforeStep(dt){
            if(!world||!basket||!envelope||!anchor)return;
            crownTimer-=dt;if(crownTimer<=0){crownTimer=.25;updateCrowns();}
            for(const key of ['basket','envelope','anchor'] as const)previous[key]=structuredClone(s[key]);
            const air=airAt(s.envelope.position,s.time);metrics.air=air;
            const terrainY=heightAt(s.basket.position[0],s.basket.position[2]),surface=Math.max(terrainY,waterAt(s.basket.position[0],s.basket.position[2]));metrics.agl=Math.max(0,s.basket.position[1]-.72-surface);
            const thermal=thermalStep(s,air,dt,metrics.agl,boost,ventHeld);metrics.power=thermal.power;
            if(s.moored!==lastMoored){basket.setBodyType(s.moored?RAPIER.RigidBodyType.KinematicPositionBased:RAPIER.RigidBodyType.Dynamic,true);if(s.moored){basket.setNextKinematicTranslation(basket.translation());basket.setNextKinematicRotation(basket.rotation());}lastMoored=s.moored;}
            if(s.hooked!==lastHook){anchor.setBodyType(s.hooked?RAPIER.RigidBodyType.KinematicPositionBased:RAPIER.RigidBodyType.Dynamic,true);if(s.hooked)anchor.setNextKinematicTranslation(anchor.translation());lastHook=s.hooked;}
            const bm=BALLOON.basketMass+s.fuel+s.ballast+(s.seated?BALLOON.pilotMass:0)+(s.anchorOut?0:BALLOON.anchorMass);
            massTimer-=dt;if(massTimer<=0){basketMass.setMass(bm);envelopeMass.setMass(thermal.airMass+BALLOON.envelopeMass+s.wetness*28);massTimer=.2;}
            basket.resetForces(false);basket.resetTorques(false);envelope.resetForces(false);envelope.resetTorques(false);anchor.resetForces(false);anchor.resetTorques(false);
            const drag=aerodynamicDrag(air,s.envelope.velocity);drag[1]+=thermal.lift-s.wetness*28*9.81;envelope.addForce(vec(drag),true);
            const basketDrag=aerodynamicDrag(airAt(s.basket.position,s.time),s.basket.velocity,3,1);basketDrag[1]-=bm*9.81;basket.addForce(vec(basketDrag),true);
            const submerged=Math.max(0,Math.min(1,waterAt(s.basket.position[0],s.basket.position[2])-s.basket.position[1]+.65));
            if(submerged>0)basket.addForce({x:-s.basket.velocity[0]*bm*submerged,y:1000*9.81*2.2*submerged-s.basket.velocity[1]*bm*3*submerged,z:-s.basket.velocity[2]*bm*submerged},true);
            metrics.tension=0;metrics.winchStalled=false;hookCooldown=Math.max(0,hookCooldown-dt);
            if(s.anchorOut&&!s.broken){
                anchor.setEnabled(true);
                const attachment=anchorAttachment(),delta=new Vector3(...s.anchor.position).sub(attachment),distance=delta.length(),direction=delta.clone().divideScalar(Math.max(.001,distance));
                const speed=new Vector3(...s.anchor.velocity).sub(new Vector3(...s.basket.velocity)).dot(direction);
                let tension=ropeForce(distance,s.ropeLength,speed);
                if(s.winch==='lower')s.ropeLength=Math.min(BALLOON.ropeMax,s.ropeLength+dt*2);
                if(s.winch==='raise'){
                    if(tension>BALLOON.winchForce||s.battery<=0&&!s.options.unlimited)metrics.winchStalled=true;
                    else {s.hooked=false;const change=Math.max(0,Math.min(s.ropeLength-.55,BALLOON.winchSpeed*dt));s.ropeLength-=change;if(!s.options.unlimited)s.battery=Math.max(0,s.battery-(Math.max(BALLOON.anchorMass*9.81,tension)*change/.65+25*dt));}
                }
                if(s.hooked&&tension>BALLOON.anchorHolding){s.hooked=false;hookCooldown=2;}
                if(tension>BALLOON.ropeStrength&&s.options.mode==='manual'){s.broken=true;s.hooked=false;s.winch='stop';}
                tension=Math.min(tension,BALLOON.ropeStrength);metrics.tension=tension;
                if(!s.broken){const force=direction.multiplyScalar(tension);basket.addForceAtPoint(vec(force.toArray()),vec(attachment.toArray()),true);anchor.addForce({x:-force.x,y:-force.y,z:-force.z},true);}
                const wet=s.anchor.position[1]<waterAt(s.anchor.position[0],s.anchor.position[2])?1:0;
                anchor.addForce({x:-s.anchor.velocity[0]*wet*12,y:-BALLOON.anchorMass*9.81+wet*31-s.anchor.velocity[1]*wet*12,z:-s.anchor.velocity[2]*wet*12},true);
                if(!s.hooked&&hookCooldown===0&&s.winch!=='raise'&&Math.abs(s.anchor.position[1]-.26-ground(s.anchor.position))<.16&&Math.hypot(...s.anchor.velocity)<.6)s.hooked=true;
                if(s.winch==='raise'&&s.ropeLength<=.56&&distance<1.1){s.anchorOut=false;s.hooked=false;s.winch='stop';massTimer=0;}
            }
            if(!s.anchorOut||s.broken){anchor.setEnabled(false);s.anchor.position=anchorAttachment().toArray() as Vec3;s.anchor.velocity=[...s.basket.velocity];anchor.setTranslation(vec(s.anchor.position),false);}
        },
        afterStep(){
            if(!basket||!envelope||!anchor)return;
            const impactSpeed=previous.basket.velocity[1];capture(basket,s.basket);capture(envelope,s.envelope);if(s.anchorOut&&!s.broken)capture(anchor,s.anchor);
            const p=s.basket.position,dx=Math.max(-506,Math.min(506,p[0]))-p[0],dz=Math.max(-506,Math.min(506,p[2]))-p[2];
            if(dx||dz){
                metrics.boundaryHit=true;
                for(const [key,body]of [['basket',basket],['envelope',envelope],['anchor',anchor]] as const){const pose=s[key];pose.position[0]+=dx;pose.position[2]+=dz;if(dx)pose.velocity[0]=0;if(dz)pose.velocity[2]=0;body.setTranslation(vec(pose.position),true);body.setLinvel(vec(pose.velocity),true);if(key==='anchor'&&s.hooked)body.setNextKinematicTranslation(vec(pose.position));}
            }
            const bottom=s.basket.position[1]-.71,groundY=ground(s.basket.position),waterY=waterAt(s.basket.position[0],s.basket.position[2]);metrics.grounded=bottom<Math.max(groundY,waterY)+.18&&Math.abs(s.basket.velocity[1])<.8;
            metrics.impact=metrics.grounded&&impactSpeed< -2?Math.abs(impactSpeed):0;
            if(s.options.mode==='manual'&&metrics.impact>0)s.damage=Math.min(1,s.damage+(metrics.impact-2)*.08);
        },
    };
    return {participant,previous,metrics,ground,
        obstacleDistance,lineClear(from:Vec3,to:Vec3){return obstacleDistance(from,to)>=new Vector3(...from).distanceTo(new Vector3(...to))-.85;},
        releaseKeys(){boost=ventHeld=false;},setBoost(v:boolean){boost=v;},setVent(v:boolean){ventHeld=v;},
        dropAnchor(){if(s.broken)return;s.anchorOut=true;s.hooked=false;s.winch='lower';s.anchor.position=anchorAttachment().toArray() as Vec3;s.anchor.velocity=[...s.basket.velocity];if(anchor){anchor.setBodyType(RAPIER.RigidBodyType.Dynamic,true);anchor.setTranslation(vec(s.anchor.position),true);anchor.setLinvel(vec(s.anchor.velocity),true);anchor.setEnabled(true);}massTimer=0;},
        get bodies(){return {basket,envelope,anchor};},get bodyCount(){return basket?3:0;},get canopyCount(){return crowns.size;},invalidateMass(){massTimer=0;},
    };
}
export type BalloonBody=ReturnType<typeof createBalloonBody>;
