import RAPIER from '@dimforge/rapier3d-compat';
import {Box3,Quaternion,Vector3} from 'three';
import type {WaterQuery} from './water-surface';
export interface FloatingPose{position:Vector3;rotation:Quaternion;previousPosition:Vector3;previousRotation:Quaternion;}
export interface FloatingBody{body:RAPIER.RigidBody;bounds:Box3;pose:FloatingPose;}
/** Eight submerged volume samples produce Archimedes force, drag and righting torque. */
export function applyBuoyancy(item:FloatingBody,sample:WaterQuery){
    const body=item.body,translation=body.translation(),rotation=body.rotation(),q=new Quaternion(rotation.x,rotation.y,rotation.z,rotation.w),size=item.bounds.getSize(new Vector3()),center=item.bounds.getCenter(new Vector3()),volume=size.x*size.y*size.z,mass=body.mass();
    body.resetForces(false);body.resetTorques(false);body.addForce({x:0,y:-9.81*mass,z:0},true);
    for(const x of [-1,1])for(const y of [-1,1])for(const z of [-1,1]){
        const point=new Vector3(center.x+x*size.x*.32,center.y+y*size.y*.25,center.z+z*size.z*.32).applyQuaternion(q).add(translation),s=sample(point.x,point.z),fraction=Math.max(0,Math.min(1,.5+(s.level-point.y)/Math.max(.02,size.y*.5))),v=body.velocityAtPoint(point),drag=mass*fraction/8;
        body.addForceAtPoint({x:(s.dx-v.x)*drag*3,y:9.81*1000*volume*fraction/8-v.y*drag*5,z:(s.dz-v.z)*drag*3},point,true);
    }
    const angular=body.angvel();body.addTorque({x:-angular.x*mass*.45,y:-angular.y*mass*.45,z:-angular.z*mass*.45},true);
}
export function captureFloatingPose(item:FloatingBody){const p=item.body.translation(),r=item.body.rotation();item.pose.position.set(p.x,p.y,p.z);item.pose.rotation.set(r.x,r.y,r.z,r.w);}
