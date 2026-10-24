import type { Vec2 } from '../src/world';
export interface DrivenWalk {feet:{x:number;y:number;z:number};yaw:number;autoWalking:boolean;paused:boolean;on:boolean;swim:boolean;}
/** Steering only. Actual translation, gravity and collisions stay in createWalkSimulation. */
export class RouteDriver {
    index=1;distance=0;complete=false;blocked='';
    private previous?:Vec2;
    constructor(readonly points:readonly Vec2[],private readonly walk:DrivenWalk){}
    start(index=1){this.index=index;this.previous=[this.walk.feet.x,this.walk.feet.z];this.walk.autoWalking=true;}
    step(){
        if(this.complete||this.blocked||this.walk.paused||!this.walk.on)return;
        if(!this.walk.autoWalking){this.blocked='Автопрогулка остановилась перед препятствием';return;}
        const feet=this.walk.feet;
        if(this.previous)this.distance+=Math.hypot(feet.x-this.previous[0],feet.z-this.previous[1]);
        this.previous=[feet.x,feet.z];
        while(this.index<this.points.length&&Math.hypot(feet.x-this.points[this.index][0],feet.z-this.points[this.index][1])<.35)this.index++;
        if(this.index===this.points.length){this.complete=true;this.walk.autoWalking=false;return;}
        const target=this.points[this.index];this.walk.yaw=Math.atan2(feet.x-target[0],feet.z-target[1]);
    }
}
