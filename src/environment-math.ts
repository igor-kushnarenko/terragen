import {clamp,smoothstep} from './noise';
export function wetnessAfter(wetness:number,rain:number,dt:number){
    const target=clamp(rain,0,1),time=target>wetness?12:150;
    const result=target+(wetness-target)*Math.exp(-Math.max(0,dt)/time);
    return result<.0001?0:clamp(result,0,1);
}
export function daylight(hour:number){
    const time=((hour%24)+24)%24;
    return {sunEl:Math.sin((time-6)/24*Math.PI*2)*58,sunAz:(time*15)%360};
}
export function advanceDay(hour:number,seconds:number,minutes:number){return (hour+Math.max(0,seconds)*24/(Math.max(2,minutes)*60))%24;}
export function approachAngle(current:number,target:number,dt:number){return current+(((target-current+540)%360)-180)*(1-Math.exp(-Math.max(0,dt)*1.8));}
export function windDisplacement(height:number,x:number,z:number,time:number,speed:number,direction:number,grass=false):[number,number]{
    const phase=x*.17+z*.13,oscillation=Math.sin(time*1.5+phase)*.7+Math.sin(time*3.1+phase*1.7)*.2;
    const anchor=Math.max(height,0),amount=(grass?anchor*.16:Math.pow(Math.min(anchor/8,1.5),1.7)*.38)*Math.min(3,Math.max(0,speed))*oscillation,angle=direction*Math.PI/180;
    return [Math.sin(angle)*amount,Math.cos(angle)*amount];
}
export function basinFog(height:number,neighbors:number[],water:number){
    const basin=Math.max(0,neighbors.reduce((a,b)=>a+b,0)/neighbors.length-height),nearWater=1-smoothstep(water+2,water+14,height);
    return {ceiling:height+Math.min(12,basin*.8+nearWater*5),strength:Math.max(smoothstep(1,10,basin),nearWater*.55)};
}
