import fs from "node:fs";
import { createHash } from "node:crypto";
import { load } from "cheerio";
import { category, isRestricted, normalizeSourceUrl, subtractCalendarYear, titleKey } from "./resource-pack-utils.mjs";
// Collection is not capped at the 10,000-entry milestone; MAX_NEW_PACKS only limits work per run.
const path="resource-packs.json";
const packs=JSON.parse(fs.readFileSync(path,"utf8"));
const cutoff=subtractCalendarYear();
const known=new Map(packs.map(p=>[normalizeSourceUrl(p.sourceUrl),p]).filter(([k])=>k));
const ids=new Set(packs.map(p=>p.id));
const headers={"User-Agent":"Mozilla/5.0 (compatible; KaraageChikinBedrockPackDirectory/3.1)","Accept":"text/html,application/xhtml+xml"};
const maxPages=Math.max(1,Math.min(5000,Number(process.env.MAX_MCPEDL_PAGES)||1000));
const maxNew=Math.max(0,Math.min(20000,Number(process.env.MAX_NEW_PACKS)||3000));
const staleLimit=Math.max(3,Math.min(5000,Number(process.env.STALE_PAGE_LIMIT)||1000));
const clean=s=>String(s||"").replace(/\s+/g," ").trim();
let oidcToken="",liveQueue=Promise.resolve();
function liveLog(type,provider,detail={}){const event={at:new Date().toISOString(),type,provider,...detail};console.log("[LIVE_SCAN] "+JSON.stringify(event));liveQueue=liveQueue.then(async()=>{if(!oidcToken||!process.env.RESOURCE_PACK_LIVE_LOG_URL)return;try{await fetch(process.env.RESOURCE_PACK_LIVE_LOG_URL,{method:"POST",headers:{"Authorization":"Bearer "+oidcToken,"Content-Type":"application/json"},body:JSON.stringify(event),signal:AbortSignal.timeout(8000)});}catch(error){console.warn("Live log delivery failed:",error?.message||error);}});}

async function getPage(page){
 const url=page===1?"https://mcpedl.com/category/texture-packs/":"https://mcpedl.com/category/texture-packs/page/"+page+"/";
 const response=await fetch(url,{headers,signal:AbortSignal.timeout(25000)});
 if(!response.ok)throw new Error("MCPEDL listing page "+page+" HTTP "+response.status);
 return await response.text();
}
function cardDate($,card){
 const attrs=[];
 card.find("time[datetime], [data-date], [data-published], meta[itemprop='datePublished']").each((_,el)=>{
  const x=$(el),raw=x.attr("datetime")||x.attr("data-date")||x.attr("data-published")||x.attr("content");
  if(raw){const d=new Date(raw);if(!Number.isNaN(d.getTime()))attrs.push(d);}
 });
 if(attrs.length)return attrs.sort((a,b)=>b-a)[0];
 const text=card.text();
 const patterns=[/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}\b/i,/\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*,?\s+\d{4}\b/i,/\b\d{4}-\d{2}-\d{2}\b/];
 for(const re of patterns){const raw=text.match(re)?.[0];if(raw){const d=new Date(raw);if(!Number.isNaN(d.getTime()))return d;}}
 return null;
}
(async()=>{
 let added=0,updated=0,removed=0,scanned=0,reachedOld=false,stalePages=0;
 for(let page=1;page<=maxPages&&added<maxNew&&!reachedOld;page++){
  const html=await getPage(page),$=load(html),anchors=$("a[href]").toArray();
  let pageItems=0,pageChanges=0,validListingLinks=0;
  for(const el of anchors){
   const a=$(el);let url;try{url=new URL(a.attr("href"),"https://mcpedl.com");}catch{continue;}
   const parts=url.pathname.split("/").filter(Boolean);
   if(url.hostname!=="mcpedl.com"||parts.length!==1||/^(category|tag|author|page|wp-json|login|register|search)$/i.test(parts[0]))continue;
   validListingLinks++;
   const key=normalizeSourceUrl(url.href);if(!key)continue;
   const card=a.closest("article, li, .post, .entry, .card, .type-post").first();
   const title=clean(a.text()||a.attr("title")||a.find("img").attr("alt"));
   if(!title||title.length<4||title.length>160||/^\d+(?:\.\d+)?$/.test(title)||/^image$/i.test(title)||isRestricted(title,key))continue;
   liveLog("candidate_found","MCPEDL",{title,sourceUrl:key});\n   const modified=card.length?cardDate($,card):null;
   if(modified&&modified<cutoff){reachedOld=true;break;}
   const existing=known.get(key);
   if(existing){
    let changed=false;
    if(existing.title!==title){existing.title=title;existing.category=category(title);changed=true;}
    if(modified){const dateText=modified.toISOString().slice(0,10);if(existing.sourceUpdatedAt!==dateText){existing.sourceUpdatedAt=dateText;changed=true;}}
    if(existing.sourceType==="automatic"){
     const fallback="Minecraft Bedrock向けリソースパック。詳しい説明・対応バージョンは取得できた情報を掲載します。";
     if(!existing.description||existing.description.startsWith("Minecraft Bedrock向けリソースパック。"))existing.description=fallback;
     existing.compatibility=existing.compatibility||"Bedrock向け（配布元でバージョン確認）";
    }
    if(changed){updated++;pageChanges++;}
    continue;
   }
   if(!modified)continue;
   const slug=parts[0].replace(/[^a-zA-Z0-9_-]/g,"-").slice(0,42)||"pack";
   const hash=createHash("sha256").update(key).digest("hex").slice(0,12);
   const id="mcpedl-"+slug+"-"+hash;
   if(ids.has(id))continue;
   const dateText=modified.toISOString().slice(0,10);
   const record={id,title,author:"",category:category(title),description:"Minecraft Bedrock向けリソースパック。詳しい説明・対応バージョンは取得できた情報を掲載します。",sourceUrl:key+"/",compatibility:"Bedrock向け（配布元でバージョン確認）",source:"MCPEDL",sourceType:"automatic",createdAt:dateText,sourceUpdatedAt:dateText,thumbnailUrl:"",galleryImages:[]};
   packs.push(record);known.set(key,record);ids.add(id);added++;pageItems++;pageChanges++;scanned++;liveLog("candidate_added","MCPEDL",{title,sourceUrl:key});
   if(added>=maxNew)break;
  }
  console.log("MCPEDL page",page,"valid links",validListingLinks,"new",pageItems,"changed",pageChanges,"total new",added);liveLog("listing_result","MCPEDL",{page,url:"https://mcpedl.com/category/texture-packs/"+(page>1?"page/"+page+"/":""),candidateLinks:validListingLinks,added:pageItems,totalAdded:added});
  if(validListingLinks===0){console.warn("Listing page yielded no valid item links; stopping to avoid treating a parser failure as an empty page.");break;}
  stalePages=pageChanges===0?stalePages+1:0;
  if(stalePages>=staleLimit){console.log("Stopping after",stalePages,"consecutive unchanged listing pages.");break;}
  await new Promise(resolve=>setTimeout(resolve,300));
 }
 const before=packs.length;
 const retained=packs.filter(p=>{
  if(isRestricted(p.title,p.sourceUrl,p.description,p.fullDescription,Array.isArray(p.tags)?p.tags.join(" "):p.tags,p.category))return false;
  if(p.sourceType==="automatic"&&(!p.title||/^\d+(?:\.\d+)?$/.test(p.title)||/^image$/i.test(p.title)))return false;
  if(!p.sourceUpdatedAt)return true;
  const d=new Date(p.sourceUpdatedAt+"T00:00:00Z");
  return Number.isNaN(d.getTime())||d>=cutoff;
 });
 removed=before-retained.length;
 fs.writeFileSync(path,JSON.stringify(retained,null,2)+"\n");
 const summary={total:retained.length,added,updated,removed,scanned,cutoff:cutoff.toISOString().slice(0,10),maxPages,maxNew,staleLimit,directDownloadable:retained.filter(p=>p.directDownloadAllowed&&p.directDownloadUrl).length};
 fs.writeFileSync("resource-pack-primary-stats.json",JSON.stringify(summary,null,2)+"\n");
 await liveQueue;\n console.log(JSON.stringify(summary,null,2));
})().catch(error=>{console.error(error);process.exit(1);});
