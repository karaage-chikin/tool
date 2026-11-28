import fs from "node:fs";
import { createHash } from "node:crypto";
import { load } from "cheerio";
import { category, isRestricted, normalizeSourceUrl, subtractCalendarYear, titleKey } from "./resource-pack-utils.mjs";

const file="resource-packs.json";
const packs=JSON.parse(fs.readFileSync(file,"utf8"));
const cutoff=subtractCalendarYear();
const knownUrls=new Set(packs.map(p=>normalizeSourceUrl(p.sourceUrl)).filter(Boolean));
const knownTitles=new Set(packs.map(p=>titleKey(p.title)).filter(Boolean));
const knownIds=new Set(packs.map(p=>p.id));
const headers={"User-Agent":"Mozilla/5.0 (compatible; KaraageChikinBedrockPackDirectory/4.1; +https://karaage-chikin.github.io/tool/)","Accept":"text/html,application/xhtml+xml,application/json"};
const maxNew=Math.max(0,Math.min(20000,Number(process.env.MAX_NEW_PACKS)||3000));
const maxPages=Math.max(1,Math.min(1000,Number(process.env.MAX_ADDITIONAL_PAGES)||1000));
const staleLimit=Math.max(10,Math.min(200,Number(process.env.ADDITIONAL_STALE_PAGE_LIMIT)||60));
const clean=s=>String(s||"").replace(/\s+/g," ").trim();
function liveLog(type,provider,detail={}){const event={at:new Date().toISOString(),type,provider,...detail};console.log("[LIVE_SCAN] "+JSON.stringify(event));globalThis.__liveLogQueue=(globalThis.__liveLogQueue||Promise.resolve()).then(async()=>{const endpoint=process.env.RESOURCE_PACK_LIVE_LOG_URL,token=process.env.ACTIONS_ID_TOKEN;if(!endpoint||!token)return;try{await fetch(endpoint,{method:"POST",headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json"},body:JSON.stringify(event),signal:AbortSignal.timeout(8000)});}catch(error){console.warn("Live log delivery failed:",error?.message||error);}});}
const stats={"MCPEDL REST API":{scanned:0,added:0,duplicates:0,tooOld:0,noDate:0,notBedrock:0,errors:0},GitHub:{scanned:0,added:0,duplicates:0,tooOld:0,noDate:0,notBedrock:0,errors:0},ModBay:{scanned:0,added:0,duplicates:0,tooOld:0,noDate:0,notBedrock:0,errors:0},"Planet Minecraft":{scanned:0,added:0,duplicates:0,tooOld:0,noDate:0,notBedrock:0,errors:0},CurseForge:{scanned:0,added:0,duplicates:0,tooOld:0,noDate:0,notBedrock:0,errors:0}};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function parseDate(value){
 if(!value)return null;
 const d=new Date(value);
 return Number.isNaN(d.getTime())||d.getTime()>Date.now()+86400000?null:d;
}
function dateFromText(text){
 const patterns=[/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}\b/i,/\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*,?\s+\d{4}\b/i,/\b\d{4}-\d{2}-\d{2}\b/];
 for(const re of patterns){const m=String(text||"").match(re);if(m){const d=parseDate(m[0]);if(d)return d;}}
 return null;
}
function dateFromDocument($){
 const values=[];
 $("time[datetime],meta[property='article:published_time'],meta[property='article:modified_time'],meta[name='datePublished'],meta[name='dateModified'],meta[itemprop='datePublished'],meta[itemprop='dateModified']").each((_,el)=>{
  const x=$(el),raw=x.attr("datetime")||x.attr("content")||x.attr("value");
  const d=parseDate(raw);if(d)values.push(d);
 });
 $("script[type='application/ld+json']").each((_,el)=>{
  try{
   const parsed=JSON.parse($(el).contents().text()||$(el).html()||"");
   const roots=Array.isArray(parsed)?parsed:[parsed];
   for(const root of roots){
    const nodes=root?.["@graph"]||[root];
    for(const node of nodes){const d=parseDate(node?.dateModified)||parseDate(node?.datePublished);if(d)values.push(d);}
   }
  }catch{}
 });
 if(values.length)return values.sort((a,b)=>b-a)[0];
 return null;
}
function jsonLdInfo($){
 let best={};
 $("script[type='application/ld+json']").each((_,el)=>{
  try{
   const parsed=JSON.parse($(el).contents().text()||$(el).html()||"");
   const roots=Array.isArray(parsed)?parsed:[parsed];
   for(const root of roots)for(const node of (root?.["@graph"]||[root])){
    if(node&&typeof node==="object"){
     const author=typeof node.author==="string"?node.author:Array.isArray(node.author)?node.author.map(x=>x?.name).filter(Boolean).join(", "):node.author?.name;
     if(node.description||author||node.datePublished||node.dateModified)best={...best,description:node.description||best.description,author:author||best.author,publishedAt:node.datePublished||best.publishedAt,updatedAt:node.dateModified||best.updatedAt};
    }
   }
  }catch{}
 });
 return best;
}
function meta($,selector){return clean($(selector).first().attr("content"));}
function safeImage(raw,base){
 if(!raw)return "";
 try{const u=new URL(raw,base);if(u.protocol!=="https:"||!u.hostname.includes(".")||/\.svg(?:$|\?)/i.test(u.pathname)||/advert|sponsor|banner|avatar|profile|logo|share/i.test(u.hostname+u.pathname))return "";return u.href;}catch{return "";}
}
function imageFrom($,base){
 const raw=meta($,"meta[property='og:image']")||meta($,"meta[name='twitter:image']")||$("main img,article img").first().attr("data-src")||$("main img,article img").first().attr("src");
 return safeImage(raw,base);
}
function pageDescription($,card,title){
 const raw=meta($,"meta[property='og:description']")||meta($,"meta[name='description']")||clean(card.find("p,[class*='description'],[class*='summary']").first().text())||clean(card.text()).replace(title,"");
 return clean(raw).slice(0,1200);
}
function pageAuthor($,card){
 const ld=jsonLdInfo($);
 if(ld.author)return clean(ld.author).slice(0,120);
 const text=clean(card.text()+" "+$("body").text().slice(0,2000));
 const m=text.match(/(?:\bBy|Uploaded by|Created by|作者|作成者|投稿者)\s*[:：]?\s*([^\n|·]{2,80}?)(?=\s+(?:Updated|Last updated|Downloads|Views|on\b)|$)/i);
 return m?m[1].trim().slice(0,120):"";
}
async function fetchText(url,accept="text/html,application/xhtml+xml"){
 liveLog("page_request","",{url});
 let last;
 for(let attempt=0;attempt<4;attempt++){
  try{
   const requestHeaders={...headers,Accept:accept};try{if(new URL(url).hostname==="api.github.com"&&process.env.GITHUB_TOKEN)requestHeaders.Authorization="Bearer "+process.env.GITHUB_TOKEN;}catch{}
   const response=await fetch(url,{headers:requestHeaders,signal:AbortSignal.timeout(25000),redirect:"follow"});
   if(response.ok){liveLog("page_loaded","",{url:response.url||url,status:response.status});return await response.text();}
   last=new Error("HTTP "+response.status+" at "+url);
   if(response.status!==429&&response.status<500)break;
   const retry=Number(response.headers.get("Retry-After"))||Math.min(10,2**attempt);
   await wait(retry*1000);
  }catch(error){last=error;if(attempt===3)break;await wait(Math.min(8000,1000*2**attempt));}
 }
 throw last||new Error("Request failed: "+url);
}
function bedrockEvidence(provider,url,$,description){
 if(provider==="MCPEDL")return true;
 if(provider==="CurseForge"&&new URL(url).pathname.startsWith("/minecraft-bedrock/"))return true;
 const text=(description+" "+$("title").text()+" "+$("body").text().slice(0,18000)).toLowerCase();
 if(/java edition only|only for java edition|java-only|fabric mod|forge mod/.test(text))return false;
 return /minecraft bedrock|bedrock edition|bedrock platform|mcpe|pocket edition|\.mcpack|\.mcaddon|minecraft for android|minecraft for ios|windows 10 edition/.test(text);
}
function makeRecord(provider,canonical,title,author,description,date,image){
 const slug=new URL(canonical).pathname.split("/").filter(Boolean).at(-1)||"pack";
 const hash=createHash("sha256").update(canonical).digest("hex").slice(0,12);
 const id=provider.toLowerCase().replace(/[^a-z0-9]+/g,"-")+"-"+slug.replace(/[^a-z0-9_-]/gi,"-").slice(0,38)+"-"+hash;
 return {id,title,author,category:category(title),description:description||"Bedrock Edition向けリソースパックです。詳細・対応バージョンは配布元ページで確認してください。",sourceUrl:canonical.endsWith("/")?canonical:canonical+"/",compatibility:"Bedrock Edition（対応バージョンは配布元で確認）",source:provider,sourceType:"automatic",createdAt:date.toISOString().slice(0,10),sourceUpdatedAt:date.toISOString().slice(0,10),thumbnailUrl:image,galleryImages:image?[image]:[]};
}
async function addExternal(provider,href,title,card$,card,base){
 const st=stats[provider];st.scanned++;liveLog("candidate_found",provider,{title,sourceUrl:href});
 let u;try{u=new URL(href,base);}catch{st.errors++;return false;}
 if(u.protocol!=="https:"||u.hostname.toLowerCase().replace(/^www\./,"")!==new URL(base).hostname.toLowerCase().replace(/^www\./,""))return false;
 const canonical=normalizeSourceUrl(u.href);if(!canonical)return false;
 if(knownUrls.has(canonical)){st.duplicates++;liveLog("candidate_skipped",provider,{title,reason:"URL重複"});return false;}
 const tk=titleKey(title);if(!tk||knownTitles.has(tk)||isRestricted(title,canonical)){st.duplicates++;liveLog("candidate_skipped",provider,{title,reason:!tk?"タイトル不正":knownTitles.has(tk)?"タイトル重複":"登録対象外"});return false;}
 try{
  const html=await fetchText(canonical),$=load(html),ld=jsonLdInfo($);
  const updated=cardDateFromCard(card$,card)||dateFromDocument($)||parseDate(ld.updatedAt)||parseDate(ld.publishedAt);
  if(!updated){st.noDate++;liveLog("candidate_skipped",provider,{title,reason:"公開日・更新日を確認できない"});return false;}
  if(updated<cutoff){st.tooOld++;liveLog("candidate_skipped",provider,{title,reason:"1年以上前"});return false;}
  const description=pageDescription($,card,title)||clean(ld.description).slice(0,1200);
  if(!bedrockEvidence(provider,canonical,$,description)){st.notBedrock++;liveLog("candidate_skipped",provider,{title,reason:"Bedrock対応の根拠なし"});return false;}
  if(isRestricted(title,canonical,description)){st.duplicates++;liveLog("candidate_skipped",provider,{title,reason:"制限対象"});return false;}
  const detailTitle=meta($,"meta[property='og:title']")||$("h1").first().text()||title;
  const finalTitle=clean(detailTitle).replace(/\s*[|–-]\s*(?:ModBay|Planet Minecraft|CurseForge).*$/i,"").slice(0,160)||title;
  const finalKey=titleKey(finalTitle);
  if(!finalKey||knownTitles.has(finalKey)){st.duplicates++;liveLog("candidate_skipped",provider,{title:finalTitle,reason:"詳細ページのタイトル重複"});return false;}
  const image=imageFrom($,canonical)||safeImage(card.find("img").first().attr("data-src")||card.find("img").first().attr("src"),base);
  const record=makeRecord(provider,canonical,finalTitle,pageAuthor($,card),description,updated,image);
  if(knownIds.has(record.id)){st.duplicates++;return false;}
  packs.push(record);knownUrls.add(canonical);knownTitles.add(finalKey);knownIds.add(record.id);st.added++;liveLog("candidate_added",provider,{title:finalTitle,sourceUrl:canonical,hasImage:Boolean(image)});
  return true;
 }catch(error){st.errors++;console.log(provider+" detail skipped:",title,error?.message||error);return false;}
}
function cardDateFromCard($,card){
 const dates=[];
 card.find("time[datetime],[data-date],[data-published],meta[itemprop='datePublished']").each((_,el)=>{
  const x=$(el),d=parseDate(x.attr("datetime")||x.attr("data-date")||x.attr("data-published")||x.attr("content"));if(d)dates.push(d);
 });
 if(dates.length)return dates.sort((a,b)=>b-a)[0];
 return dateFromText(card.text());
}
function cardTitle($,a){
 return clean(a.text()||a.attr("title")||a.find("img").attr("alt")||a.closest("article,li,.card,.resource,.project").find("h2,h3").first().text());
}
async function processListingCandidates(provider,candidates,base){
 let added=0;
 for(let i=0;i<candidates.length&&added<maxNew;i+=5){
  const batch=candidates.slice(i,i+5);
  const results=await Promise.all(batch.map(c=>addExternal(provider,c.href,c.title,c.$,c.card,base)));
  added+=results.filter(Boolean).length;
  await wait(350);
 }
 return added;
}
async function scanMcpedlRest(){
 const st=stats["MCPEDL REST API"];let added=0;
 const catText=await fetchText("https://mcpedl.com/wp-json/wp/v2/categories?slug=texture-packs","application/json");
 const cats=JSON.parse(catText);const categoryId=Array.isArray(cats)?Number(cats[0]?.id):0;
 if(!categoryId)throw new Error("MCPEDL Texture Packs category unavailable");
 for(let pageNo=1;pageNo<=Math.min(20,maxPages)&&added<maxNew;pageNo++){
  const url="https://mcpedl.com/wp-json/wp/v2/posts?categories="+categoryId+"&per_page=100&page="+pageNo+"&orderby=date&order=desc&_embed=author,wp:featuredmedia";
  let posts;try{posts=JSON.parse(await fetchText(url,"application/json"));}catch(error){if(String(error).includes("HTTP 400"))break;throw error;}
  if(!Array.isArray(posts)||!posts.length)break;
  let pageAdded=0;
  for(const post of posts){
   st.scanned++;
   const link=String(post.link||"");let u;try{u=new URL(link);}catch{continue;}
   if(u.hostname!=="mcpedl.com"||u.protocol!=="https:")continue;
   const canonical=normalizeSourceUrl(link),title=clean(load(post.title?.rendered||"").text()).slice(0,160);
   if(!canonical||!title||isRestricted(title,canonical)){continue;}
   if(knownUrls.has(canonical)){st.duplicates++;continue;}
   const date=parseDate(post.modified_gmt||post.date_gmt||post.modified||post.date);
   if(!date){st.noDate++;continue;}if(date<cutoff){st.tooOld++;continue;}
   const description=clean(load(post.excerpt?.rendered||post.content?.rendered||"").text()).slice(0,1200);
   const author=clean(post._embedded?.author?.[0]?.name||"").slice(0,120);
   const image=post._embedded?.["wp:featuredmedia"]?.[0]?.source_url||"";
   const safe=safeImage(image,canonical);
   const record=makeRecord("MCPEDL",canonical,title,author,description,date,safe);
   const tk=titleKey(title);
   if(knownTitles.has(tk)||knownIds.has(record.id)){st.duplicates++;continue;}
   packs.push(record);knownUrls.add(canonical);knownTitles.add(tk);knownIds.add(record.id);st.added++;added++;pageAdded++;
   if(added>=maxNew)break;
  }
  liveLog("listing_result","MCPEDL REST API",{page:pageNo,url,posts:posts.length,added:pageAdded,totalAdded:added});
  if(posts.length<100)break;
  await wait(250);
 }
 return added;
}

async function scanGithubRepos(){
 const provider="GitHub",st=stats[provider];let added=0;
 const queries=["topic:minecraft-bedrock topic:resource-pack","topic:bedrock topic:texture-pack"];
 const seenRepos=new Set();
 for(const query of queries){
  for(let pageNo=1;pageNo<=5&&added<maxNew;pageNo++){
   const api="https://api.github.com/search/repositories?q="+encodeURIComponent(query)+"&sort=updated&order=desc&per_page=100&page="+pageNo;
   liveLog("listing_scan",provider,{query,page:pageNo,url:api});
   let data;
   try{data=JSON.parse(await fetchText(api,"application/vnd.github+json"));}catch(error){st.errors++;console.warn("GitHub repository search failed:",error?.message||error);break;}
   const repos=Array.isArray(data.items)?data.items:[];
   if(!repos.length)break;
   for(const repo of repos){
    st.scanned++;
    const full=String(repo.full_name||"").toLowerCase();
    if(!full||seenRepos.has(full))continue;seenRepos.add(full);
    const updated=parseDate(repo.pushed_at||repo.updated_at);
    if(!updated){st.noDate++;continue;}
    if(updated<cutoff){st.tooOld++;continue;}
    const title=clean(repo.name||"").replace(/[-_]+/g," ").slice(0,160);
    const summary=clean(repo.description||"").slice(0,1200);
    const topics=Array.isArray(repo.topics)?repo.topics.join(" "):"";
    if(!title||isRestricted(title,summary,topics,repo.html_url)){st.notBedrock++;continue;}
    const evidence=(topics+" "+summary).toLowerCase();
    if(!/(bedrock|mcpe|pocket edition)/.test(evidence)||!/(resource.?pack|texture.?pack|mcpack)/.test(evidence)){st.notBedrock++;continue;}
    const repoUrl=String(repo.html_url||"");
    if(normalizeSourceUrl(repoUrl)===""||knownUrls.has(normalizeSourceUrl(repoUrl))){st.duplicates++;continue;}
    try{
     const rootUrl="https://api.github.com/repos/"+repo.full_name+"/contents?ref="+encodeURIComponent(repo.default_branch||"main");
     const root=JSON.parse(await fetchText(rootUrl,"application/vnd.github+json"));
     if(!Array.isArray(root)){st.notBedrock++;continue;}
     const manifestFile=root.find(x=>x.type==="file"&&x.name.toLowerCase()==="manifest.json");
     if(!manifestFile){st.notBedrock++;continue;}
     const rawBase="https://raw.githubusercontent.com/"+repo.full_name+"/"+encodeURIComponent(repo.default_branch||"main")+"/";
     const manifest=JSON.parse(await fetchText(rawBase+"manifest.json","application/json"));
     const resourceModule=Array.isArray(manifest.modules)&&manifest.modules.some(m=>m?.type==="resources");
     const headerName=clean(manifest.header?.name);
     const headerDescription=clean(manifest.header?.description);
     const finalTitle=(headerName||title).slice(0,160);
     const description=(headerDescription||summary).slice(0,1200);
     if(!resourceModule||isRestricted(finalTitle,description,topics,repoUrl)){st.notBedrock++;continue;}
     const key=titleKey(finalTitle);
     if(!key||knownTitles.has(key)){st.duplicates++;continue;}
     const icon=root.find(x=>x.type==="file"&&x.name.toLowerCase()==="pack_icon.png");
     const image=icon?safeImage(rawBase+"pack_icon.png",repoUrl):"";
     const record=makeRecord(provider,repoUrl,finalTitle,repo.owner?.login||"",description,updated,image);
     if(knownIds.has(record.id)){st.duplicates++;continue;}
     packs.push(record);knownUrls.add(normalizeSourceUrl(repoUrl));knownTitles.add(key);knownIds.add(record.id);
     st.added++;added++;
     liveLog("candidate_added",provider,{title:finalTitle,sourceUrl:repoUrl,hasImage:Boolean(image),updatedAt:updated.toISOString().slice(0,10)});
     if(added>=maxNew)break;
    }catch(error){
     st.errors++;liveLog("candidate_skipped",provider,{title,reason:"GitHub manifest/metadata verification failed"});
     console.log("GitHub repository skipped:",repo.full_name,error?.message||error);
    }
   }
   liveLog("listing_result",provider,{query,page:pageNo,results:repos.length,totalAdded:added});
   if(repos.length<100)break;
   await wait(300);
  }
 }
 return added;
}

async function scanHtmlSource(provider){
 let added=0,stale=0;
 for(let pageNo=1;pageNo<=maxPages&&added<maxNew;pageNo++){
  let url,base,selector;
  if(provider==="ModBay"){base="https://modbay.org";url=pageNo===1?base+"/textures/":base+"/textures/page/"+pageNo+"/";selector='a[href*="/textures/"]';}
  else if(provider==="Planet Minecraft"){base="https://www.planetminecraft.com";url=base+"/texture-packs/?platform=2&p="+(pageNo-1);selector='a[href*="/texture-pack/"]';}
  else{base="https://www.curseforge.com";url=base+"/minecraft-bedrock/search?class=texture-packs&page="+pageNo+"&pageSize=50&sortBy=latest+update";selector='a[href*="/minecraft-bedrock/texture-packs/"]';}
  liveLog("listing_scan",provider,{page:pageNo,url});
  const html=await fetchText(url),$=load(html),anchors=$(selector).toArray(),candidates=[],seen=new Set();
  for(const el of anchors){
   const a=$(el);let u;try{u=new URL(a.attr("href"),base);}catch{continue;}
   const parts=u.pathname.split("/").filter(Boolean);
   if(u.protocol!=="https:"||u.hostname!==new URL(base).hostname)continue;
   if(provider==="ModBay"&&(parts.length<2||parts[0]!=="textures"||parts[1]==="page"||/^(tag|author|category)$/i.test(parts[1])))continue;
   if(provider==="Planet Minecraft"&&(parts.length<2||parts[0]!=="texture-pack"))continue;
   if(provider==="CurseForge"&&(parts.length!==3||parts[0]!=="minecraft-bedrock"||parts[1]!=="texture-packs"))continue;
   u.search="";u.hash="";
   const canonical=normalizeSourceUrl(u.href);if(!canonical||seen.has(canonical))continue;seen.add(canonical);
   const card=a.closest("article,li,.post,.entry,.card,.resource,.project,.tile,[class*='post-item'],[class*='texture'],[class*='resource'],[class*='project']").first();
   const title=cardTitle($,a);if(title.length<4||title.length>160||/^download$/i.test(title))continue;
   if(knownUrls.has(canonical)){stats[provider].duplicates++;continue;}
   candidates.push({href:canonical,title,$,card:card.length?card:a.parent().parent().parent()});
  }
  const pageAdded=await processListingCandidates(provider,candidates,base);
  added+=pageAdded;
  liveLog("listing_result",provider,{page:pageNo,url,candidateLinks:candidates.length,added:pageAdded,totalAdded:added});
  if(candidates.length===0){console.warn(provider+" parser found no candidate links; stopping.");break;}
  stale=pageAdded===0?stale+1:0;
  if(stale>=staleLimit){console.log(provider+" stopped after "+stale+" pages without new verified Bedrock entries.");break;}
  await wait(450);
 }
 return added;
}
function save(){fs.writeFileSync(file,JSON.stringify(packs,null,2)+"\n");}
(async()=>{
 const results={};
 for(const [name,scan] of [["MCPEDL REST API",scanMcpedlRest],["GitHub",scanGithubRepos],["CurseForge",()=>scanHtmlSource("CurseForge")],["ModBay",()=>scanHtmlSource("ModBay")],["Planet Minecraft",()=>scanHtmlSource("Planet Minecraft")]]){
  try{results[name]=await scan();save();}
  catch(error){console.warn(name+" scan failed; keeping already collected records:",error?.message||error);stats[name].errors++;results[name]=0;save();}
 }
 const added=Object.values(results).reduce((sum,n)=>sum+n,0);
 let primary={};try{primary=JSON.parse(fs.readFileSync("resource-pack-primary-stats.json","utf8"));}catch{}
 const addedBySource={"MCPEDL category listing":Number(primary.added||0),...results};
 const sourceStats={"MCPEDL category listing":{scanned:Number(primary.scanned||0),added:Number(primary.added||0),updated:Number(primary.updated||0),removed:Number(primary.removed||0)},...stats};
 const summary={addedFromAdditionalSource:added,totalNewAdded:Object.values(addedBySource).reduce((sum,n)=>sum+Number(n||0),0),addedBySource,sourceStats,total:packs.length,cutoff:cutoff.toISOString().slice(0,10),maxPages,maxNew,staleLimit};
 fs.writeFileSync("resource-pack-collector-stats.json",JSON.stringify(summary,null,2)+"\n");
 await globalThis.__liveLogQueue;
 console.log(JSON.stringify(summary,null,2));
})().catch(error=>{console.error(error);process.exit(1);});
