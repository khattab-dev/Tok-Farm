import { z } from 'zod'

const finite=z.number().finite()
export const QwenEventSchema=z.object({
  start:finite.nonnegative(),end:finite.nonnegative(),
  label:z.string().trim().min(1).max(160),evidence:z.string().trim().min(1).max(800)
}).strict().refine(event=>event.end>=event.start,'Event ends before it starts')
export const QwenResponseSchema=z.object({summary:z.string().max(1600),events:z.array(QwenEventSchema).max(8)}).strict()
export type QwenResponse=z.infer<typeof QwenResponseSchema>
export interface VideoWindow {start:number;end:number}
export interface QwenEvent {start:number;end:number;label:string;evidence:string;windowStart:number}
export const QWEN_RESPONSE_FORMAT={type:'json_schema',schema:{
  type:'object',additionalProperties:false,required:['summary','events'],properties:{
    summary:{type:'string'},events:{type:'array',maxItems:8,items:{type:'object',additionalProperties:false,
      required:['start','end','label','evidence'],properties:{start:{type:'number'},end:{type:'number'},label:{type:'string'},evidence:{type:'string'}}}}
  }
}}

export function videoWindows(start:number,end:number,seconds=10,overlap=2):VideoWindow[]{
  if(![start,end,seconds,overlap].every(Number.isFinite)||start<0||end<=start||seconds<=0||overlap<0||overlap>=seconds)throw new Error('Invalid scan window settings')
  const result:VideoWindow[]=[]
  for(let at=start;at<end;at+=seconds-overlap){
    const next={start:Number(at.toFixed(6)),end:Math.min(end,Number((at+seconds).toFixed(6)))}
    result.push(next)
    if(next.end===end)break
  }
  return result
}

export function absoluteEvents(response:unknown,window:VideoWindow):{summary:string;events:QwenEvent[]}{
  const parsed=QwenResponseSchema.parse(response),duration=window.end-window.start
  for(const event of parsed.events){
    if(event.end>duration+.05)throw new Error(`Model timestamp ${event.end} exceeds window duration ${duration}`)
  }
  return {summary:parsed.summary,events:parsed.events.map(event=>({...event,start:window.start+Math.min(event.start,duration),end:window.start+Math.min(event.end,duration),windowStart:window.start}))}
}

// Merge repeated observations only where windows actually overlap. Nearby events
// within a single window remain independent, unlike the legacy 22-second suppression.
export function mergeQwenEvents(events:QwenEvent[]):QwenEvent[]{
  const result:QwenEvent[]=[]
  for(const event of [...events].sort((a,b)=>a.start-b.start)){
    const same=result.find(item=>item.windowStart!==event.windowStart&&item.label.toLowerCase()===event.label.toLowerCase()&&Math.abs(item.start-event.start)<=1.5&&Math.min(item.end,event.end)>=Math.max(item.start,event.start)-.25)
    if(same){same.start=Math.min(same.start,event.start);same.end=Math.max(same.end,event.end)}else result.push({...event})
  }
  return result
}

export function matchKnownEvents(events:QwenEvent[],truth:number[],tolerance=2){
  const available=new Set(events.map((_,index)=>index))
  const matches=truth.map(time=>{
    const nearest=[...available].map(index=>({index,distance:time<events[index].start?events[index].start-time:time>events[index].end?time-events[index].end:0}))
      .filter(item=>item.distance<=tolerance).sort((a,b)=>a.distance-b.distance)[0]
    if(nearest)available.delete(nearest.index)
    return {time,matched:Boolean(nearest),distanceSeconds:nearest?.distance??null,event:nearest?events[nearest.index]:null}
  })
  return {toleranceSeconds:tolerance,knownEventCount:truth.length,matchedKnownEvents:matches.filter(item=>item.matched).length,
    recallOnProvidedEvents:truth.length?matches.filter(item=>item.matched).length/truth.length:null,matches,
    unmatchedDetections:[...available].map(index=>events[index]),
    note:'Provided timestamps may be incomplete. Unmatched detections are unreviewed, not automatically false positives. Timing intervals are model estimates.'}
}
