import fs from "node:fs";

const file="resource-pack-progress.json";
const catalogue="resource-packs.json";
const statsFile="resource-pack-collector-stats.json";
const action=process.argv[2];
const stage=process.argv.slice(3).join(" ")||action;
const now=new Date().toISOString();
const count=JSON.parse(fs.readFileSync(catalogue,"utf8")).length;
let state={};
try{state=JSON.parse(fs.readFileSync(file,"utf8"));}catch{}
let collectorStats={};
try{collectorStats=JSON.parse(fs.readFileSync(statsFile,"utf8"));}catch{}
const history=Array.isArray(state.history)?state.history:[];
const stages=Array.isArray(state.stageHistory)?state.stageHistory:[];
function write(){state.updatedAt=now;state.currentCount=count;fs.writeFileSync(file,JSON.stringify(state,null,2)+"\n");console.log(JSON.stringify({action,stage:state.stage,count,status:state.status,updatedAt:now}));}

if(action==="start"){
 state={schema:2,updatedAt:now,status:"running",runStartedAt:now,runFinishedAt:null,baselineCount:count,currentCount:count,stage:"収集ジョブを開始",stageHistory:[{at:now,stage:"収集ジョブを開始",count}],history};
 write();
}else if(action==="stage"){
 const next=[...stages,{at:now,stage,count}].slice(-12);
 state={...state,updatedAt:now,status:"running",currentCount:count,stage,stageHistory:next};
 if(collectorStats.sourceStats)state.sourceStats=collectorStats.sourceStats;
 write();
}else if(action==="finish"||action==="fail"){
 const started=Date.parse(state.runStartedAt||now);
 const durationMs=Math.max(1000,Date.now()-(Number.isFinite(started)?started:Date.now()));
 const added=Math.max(0,count-Number(state.baselineCount||count));
 const entry={startedAt:state.runStartedAt||now,finishedAt:now,durationMs,baselineCount:Number(state.baselineCount||count),finalCount:count,added,failed:action==="fail",addedBySource:collectorStats.addedBySource||{},sourceStats:collectorStats.sourceStats||{},stageHistory:[...stages,{at:now,stage:action==="finish"?"今回の巡回サイクル終了":"今回の巡回サイクルでエラー",count}].slice(-12)};
 const nextHistory=[...history,entry].slice(-10);
 state={...state,updatedAt:now,status:action==="finish"?"completed":"failed",runFinishedAt:now,currentCount:count,stage:action==="finish"?"今回の巡回サイクル終了":"今回の巡回サイクルでエラー",lastRun:entry,history:nextHistory,stageHistory:entry.stageHistory};
 write();
}else{
 throw new Error("Usage: start | stage <name> | finish | fail");
}
