(()=>{"use strict";
const API=document.querySelector('meta[name="resource-packs-api"]')?.content;
if(!API)throw new Error("API endpoint is not configured");
const TOKEN_KEY="resourcePackAdminToken",TOKEN_EXPIRY_KEY="resourcePackAdminTokenExpiresAt";
function clearSavedAdminToken(){
 try{localStorage.removeItem(TOKEN_KEY);localStorage.removeItem(TOKEN_EXPIRY_KEY);}catch{}
 try{sessionStorage.removeItem(TOKEN_KEY);sessionStorage.removeItem(TOKEN_EXPIRY_KEY);}catch{}
}
function getSavedAdminToken(){
 try{
  const value=localStorage.getItem(TOKEN_KEY)||sessionStorage.getItem(TOKEN_KEY)||"";
  let expiry=Number(localStorage.getItem(TOKEN_EXPIRY_KEY)||sessionStorage.getItem(TOKEN_EXPIRY_KEY)||0);
  if(!/^[A-Za-z0-9_.-]{20,2048}$/.test(value)||(expiry&&expiry<=Date.now())){clearSavedAdminToken();return "";}
  if(!expiry)expiry=Date.now()+30*24*60*60*1000;
  try{localStorage.setItem(TOKEN_KEY,value);localStorage.setItem(TOKEN_EXPIRY_KEY,String(expiry));sessionStorage.removeItem(TOKEN_KEY);sessionStorage.removeItem(TOKEN_EXPIRY_KEY);}catch{}
  return value;
 }catch{return sessionStorage.getItem(TOKEN_KEY)||"";}
}
const token=getSavedAdminToken();
const $=id=>document.getElementById(id);
const PAGE_SIZE=50,MAX_DATE=8640000000000000;
const ESC_MAP={"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"};
const esc=value=>String(value??"").replace(/[&<>"']/g,c=>ESC_MAP[c]);
const number=value=>Number.isFinite(Number(value))?Number(value):0;
const formatBytes=value=>(number(value)/1048576).toFixed(2)+" MB";
const formatDate=value=>{
 const n=Number(value);
 if(!Number.isFinite(n)||Math.abs(n)>MAX_DATE)return "—";
 const d=new Date(n);
 return Number.isNaN(d.getTime())?"—":new Intl.DateTimeFormat("ja-JP",{timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit"}).format(d);
};
let currentPage="overview",requestSequence=0,logPage=0,accessPage=0;
class ApiError extends Error{constructor(message,status=0){super(message);this.name="ApiError";this.status=status;}}
async function api(path){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
 try{
  const response=await fetch(API+path,{method:"GET",headers:{Authorization:"Bearer "+token,Accept:"application/json"},cache:"no-store",signal:controller.signal});
  let data;try{data=await response.json();}catch{throw new ApiError("サーバーから正しいJSON応答がありません。",response.status);}
  if(!response.ok)throw new ApiError(data?.error||("APIエラー（HTTP "+response.status+"）"),response.status);
  return data;
 }catch(error){
  if(error instanceof ApiError)throw error;
  if(error?.name==="AbortError")throw new ApiError("通信がタイムアウトしました。もう一度お試しください。");
  throw new ApiError("通信に失敗しました。ネットワークを確認してください。");
 }finally{clearTimeout(timer);}
}
function status(message,kind=""){
 const el=$("pageStatus");if(!el)return;
 el.textContent=String(message??"");el.className="status "+kind;
}
function cards(items){return '<div class="grid">'+items.map(x=>'<section class="card"><small>'+esc(x.label)+'</small><div class="value">'+esc(x.value)+'</div></section>').join("")+'</div>';}
function rows(items){return '<div class="rows">'+(items.length?items.map(x=>'<div class="row"><strong>'+esc(x.title)+'</strong><div>'+esc(x.body||"")+'</div><div class="muted">'+esc(x.meta||"")+'</div></div>').join(""):'<div class="empty">記録はまだありません。</div>')+'</div>';}
function activateNav(){document.querySelectorAll("[data-nav]").forEach(a=>{const active=a.dataset.nav===currentPage;a.classList.toggle("active",active);a.setAttribute("aria-current",active?"page":"false");});}
function failurePanel(error){return '<section class="panel"><h2>一部の情報を読み込めませんでした</h2><p class="notice">'+esc(error?.message||"不明なエラー")+'</p><button type="button" data-retry>再読み込み</button></section>';}
function pager(kind,page,total,hasMore){
 const prev=page>0, next=Boolean(hasMore);
 return '<div class="pager"><button type="button" data-page="'+kind+'" data-step="-1" '+(!prev?"disabled":"")+'>前へ</button><span>'+(page+1)+'ページ目 / '+Math.max(1,Math.ceil(number(total)/PAGE_SIZE))+'ページ</span><button type="button" data-page="'+kind+'" data-step="1" '+(!next?"disabled":"")+'>次へ</button></div>';
}
async function expansionPanel(){
 let count=null,run=null,measurement=null,catalogueError="",monitorError="";
 try{
  const response=await fetch("./resource-packs.json",{cache:"no-store"});
  if(!response.ok)throw new Error("図鑑JSON HTTP "+response.status);
  const catalogue=await response.json();
  count=Array.isArray(catalogue)?catalogue.length:(Array.isArray(catalogue?.packs)?catalogue.packs.length:null);
  if(count===null)throw new Error("図鑑JSONの形式が想定と異なります");
 }catch(e){catalogueError=e?.message||"図鑑件数を取得できません";}
 try{
  const monitor=await api("/api/admin/monitor/storage");
  run=monitor.expansion||null;measurement=monitor.expansionProgress||null;
  if(run?.available===false)monitorError=run.error||"GitHub Actionsの実行状況を取得できません";
  if(run?.error)monitorError=run.error.includes("HTTP 403")?"GitHub Actions APIがHTTP 403を返しました（認証・API利用制限の可能性）。":run.error;
 }catch(e){monitorError=e?.message||"実行状況を取得できません";}
 const milestone=10000,pct=count===null?0:Math.min(100,count/milestone*100),remaining=count===null?null:Math.max(0,milestone-count);
 const activeRuns=Array.isArray(run?.activeRuns)?run.activeRuns:[];
 const runningCount=activeRuns.filter(x=>x.status==="in_progress").length;
 const waitingCount=activeRuns.filter(x=>x.status==="pending"||x.status==="queued").length;
 let state="状態を取得できません",stateClass="muted";
 if(runningCount){state="収集中："+runningCount+"件";stateClass="running";}
 else if(waitingCount){state="開始待ち："+waitingCount+"件";stateClass="waiting";}
 else if(run?.status==="completed"&&run?.conclusion==="success"){state="待機中（前回の巡回は成功）";stateClass="done";}
 else if(run?.status==="completed"){state="前回の巡回は失敗："+(run.conclusion||"結果不明");stateClass="error";}
 else if(run?.status==="not_started"){state="まだ実行履歴がありません";stateClass="muted";}
 const countText=count===null?"件数取得不可":count.toLocaleString("ja-JP")+" 件";
 const progressText=count===null?catalogueError:count>=milestone?"10,000件の通過目標を達成（以後も収集継続）":"10,000件の通過目標まで "+pct.toFixed(1)+"%";
 const history=Array.isArray(measurement?.history)?measurement.history.slice(-5).reverse():[];
 const last=measurement?.lastRun||history[0]||null;
 const completedRuns=history.filter(x=>Number(x.added)>0&&Number(x.durationMs)>0);
 const avgAddedPerRun=completedRuns.length?completedRuns.reduce((sum,x)=>sum+Number(x.added),0)/completedRuns.length:0;
 const hoursRemaining=avgAddedPerRun>0&&remaining!==null?remaining/avgAddedPerRun:null;
 const etaDate=hoursRemaining===null?null:new Date(Date.now()+hoursRemaining*3600000);
 const durationLabel=ms=>{const m=Math.max(0,Math.round(Number(ms||0)/60000));return m<60?m+"分":Math.floor(m/60)+"時間"+(m%60)+"分";};
 const etaText=count!==null&&count>=milestone?"10,000件は通過目標です。達成後も新規パックを追加します":hoursRemaining!==null?"参考予測："+durationLabel(hoursRemaining*3600000)+"（追加があった回の平均。保証値ではありません）":"到達予測：追加実績が集まるまで算出できません";
 const stageMap={"開始":"収集ジョブを開始","MCPEDL収集完了・追加サイト収集中":"MCPEDL収集完了 → 他サイトを巡回中","追加サイト収集完了・説明情報取得中":"他サイト巡回完了 → 説明情報を取得中","説明・メタデータ取得完了・画像情報取得中":"説明情報完了 → 画像情報を取得中","画像情報取得完了・図鑑更新中":"画像情報完了 → 図鑑データを保存中","完了":"今回の巡回サイクル終了"};
 const rawStage=measurement?.stage||"工程情報なし";
 const stageText=measurement?.status==="completed"?"今回の巡回："+(stageMap[rawStage]||"終了") : "現在の工程："+(stageMap[rawStage]||rawStage);
 const elapsed=measurement?.runStartedAt&&measurement?.status==="running"?durationLabel(Date.now()-Date.parse(measurement.runStartedAt)):"";
 const lastRunText=last?"前回の巡回："+durationLabel(last.durationMs)+" ／ 新規追加 "+Number(last.added||0).toLocaleString("ja-JP")+"件 ／ "+Number(last.finalCount||last.currentCount||0).toLocaleString("ja-JP")+"件":"前回の巡回結果：まだありません";
 const etaDateText=etaDate&&!Number.isNaN(etaDate.getTime())?"予測到達日時："+formatDate(etaDate.getTime()):"";
 const sourceStats=last?.sourceStats&&typeof last.sourceStats==="object"?last.sourceStats:{};
 const sourceRows=Object.entries(sourceStats).map(([name,x])=>'<tr><td>'+esc(name)+'</td><td>'+esc(Number(x.added||0))+'</td><td>'+esc(Number(x.scanned||0))+'</td><td>'+esc(Number(x.noDate||0))+'</td><td>'+esc(Number(x.notBedrock||0))+'</td><td>'+esc(Number(x.errors||0))+'</td></tr>').join("");
 const sourceTable=sourceRows?'<h3>前回の収集元別結果</h3><table><thead><tr><th>収集元</th><th>追加</th><th>調査</th><th>日付不明</th><th>Bedrock確認不可</th><th>エラー</th></tr></thead><tbody>'+sourceRows+'</tbody></table>':"";
 const historyRows=history.map(x=>'<tr><td>'+esc(formatDate(Date.parse(x.finishedAt||x.startedAt)))+'</td><td>'+esc(durationLabel(x.durationMs))+'</td><td>'+esc(Number(x.added||0).toLocaleString("ja-JP"))+'件</td><td>'+esc(Number(x.finalCount||0).toLocaleString("ja-JP"))+'件</td></tr>').join("");
 return '<section class="panel expansion-panel"><h2>リソースパック図鑑の収集状況</h2><div class="progress-head"><strong>'+esc(countText)+'</strong><span class="job-state '+(stateClass)+'">'+esc(state)+'</span></div><div class="meter" role="progressbar" aria-label="10,000件の通過目標" aria-valuemin="0" aria-valuemax="10000" aria-valuenow="'+(count===null?0:Math.min(count,10000))+'"><span style="width:'+pct.toFixed(2)+'%"></span></div><div class="progress-foot"><span>'+esc(progressText)+'</span><span>'+(remaining===null?"":"目安まで残り "+remaining.toLocaleString("ja-JP")+"件")+'</span></div><p class="notice">重要：10,000件は最初の通過目標で、上限でも処理完了条件でもありません。達成後も新しいBedrock向けパックを探して追加します。</p><div class="notice">'+esc(stageText)+(elapsed?" ／ 経過 "+esc(elapsed):"")+'</div><p class="notice">'+esc(lastRunText)+'</p><p class="notice">'+esc(etaText)+'</p><p class="notice">'+esc(etaDateText)+'</p><p class="notice">'+esc(measurement?.updatedAt?"進捗最終更新："+formatDate(Date.parse(measurement.updatedAt)):"進捗最終更新：未取得")+'</p>'+sourceTable+(historyRows?'<h3>直近5回の巡回履歴</h3><table><thead><tr><th>終了日時</th><th>所要時間</th><th>新規追加</th><th>終了時の登録数</th></tr></thead><tbody>'+historyRows+'</tbody></table>':"")+(monitorError?'<p class="notice error">実行状況の取得エラー：'+esc(monitorError)+'</p>':"")+(run?.url?'<a href="'+esc(run.url)+'" target="_blank" rel="noopener noreferrer">今回の巡回ログを開く ↗</a>':"")+'</section>';
}
function storageMeter(label,used,limit,detail,unlimited=false){
 const u=number(used),l=number(limit),pct=unlimited||!l?null:Math.min(100,u/l*100);
 return '<div class="storage-item"><div class="storage-head"><strong>'+esc(label)+'</strong><b>'+formatBytes(u)+(l?' / '+formatBytes(l):'')+'</b></div>'+(pct===null?'<div class="capacity-no-limit">上限未設定（使用量のみ表示）</div>':'<div class="meter"><span style="width:'+pct.toFixed(2)+'%"></span></div>')+'<div class="storage-foot"><span>'+(pct===null?"固定上限なし・使用量のみ":pct.toFixed(2)+"% 使用")+'</span><span>'+esc(detail||"")+'</span></div></div>';
}
async function loadOverview(seq){
 const specs=[
  ["overview","/api/admin/monitor/overview"],
  ["updates","/api/admin/monitor/logs?type=update&limit=4&offset=0"],
  ["debug","/api/admin/monitor/logs?type=debug&limit=4&offset=0"],
  ["access","/api/admin/monitor/access?limit=4&offset=0"]
 ];
 const results=await Promise.allSettled(specs.map(x=>api(x[1])));
 if(seq!==requestSequence)return;
 const data={};const errors=[];
 results.forEach((r,i)=>{if(r.status==="fulfilled")data[specs[i][0]]=r.value;else errors.push(specs[i][0]+": "+r.reason.message);});
 const d=data.overview||{},p=d.packs||{},c=d.candidates||{},ac=d.access||{};
 let html=cards([{label:"リソースパック（D1登録分）",value:number(p.count)},{label:"未承認候補",value:number(c.count)},{label:"累計アクセス",value:number(ac.count)},{label:"監査ログ",value:number(d.logs?.count)},{label:"パック情報の概算容量",value:formatBytes(p.approx_bytes)}]);
 html+=await expansionPanel();
 html+='<div class="overview-grid">';
 html+='<section class="panel overview-panel"><h2>更新履歴</h2>'+(data.updates?rows((data.updates.logs||[]).map(x=>({title:x.action,body:x.detail,meta:formatDate(x.created_at)}))):failurePanel({message:errors.find(x=>x.startsWith("updates"))||"取得失敗"}))+'</section>';
 html+='<section class="panel overview-panel"><h2>Debug・エラー</h2>'+(data.debug?rows((data.debug.logs||[]).map(x=>({title:x.action,body:x.detail,meta:formatDate(x.created_at)}))):failurePanel({message:errors.find(x=>x.startsWith("debug"))||"取得失敗"}))+'</section>';
 html+='<section class="panel overview-panel"><h2>アクセス記録</h2>'+(data.access?((data.access.daily||[]).length?'<table><thead><tr><th>日付</th><th>アクセス数</th></tr></thead><tbody>'+data.access.daily.map(x=>'<tr><td>'+esc(x.day)+'</td><td>'+esc(x.count)+'</td></tr>').join("")+'</tbody></table>':'<div class="empty">アクセス記録はまだありません。</div>'):failurePanel({message:errors.find(x=>x.startsWith("access"))||"取得失敗"}))+'</section>';
 html+='<section class="panel overview-panel"><h2>更新・画像処理の状態</h2>'+rows([{title:d.imageJob?.status||"未実行",body:d.imageJob?.result_json||"処理結果はまだありません。",meta:"開始: "+formatDate(d.imageJob?.started_at)+" / 完了: "+formatDate(d.imageJob?.finished_at)}])+'</section></div>';
 if(errors.length)html+='<p class="notice">一部のAPIに接続できませんでした。各欄の再読み込みを試してください。<br>'+esc(errors.join(" / "))+'</p>';
 $("pageContent").innerHTML=html;
 status("最終確認: "+formatDate(Date.now()),errors.length?"error":"good");
}
async function loadLogs(type,page,seq){
 const offset=page*PAGE_SIZE;
 const d=await api("/api/admin/monitor/logs?type="+encodeURIComponent(type)+"&limit="+PAGE_SIZE+"&offset="+offset);
 if(seq!==requestSequence)return;
 const all=d.logs||[],serverPaged=Number.isFinite(Number(d.total));
 const total=serverPaged?number(d.total):all.length;
 const list=serverPaged?all:all.slice(offset,offset+PAGE_SIZE);
 const progress=await expansionPanel();
 const hasMore=serverPaged?Boolean(d.hasMore):offset+PAGE_SIZE<total;
 $("pageContent").innerHTML=progress+'<section class="panel"><h2>'+(type==="update"?"更新・管理操作":"Debug・エラー記録")+'</h2>'+rows(list.map(x=>({title:x.action,body:x.detail,meta:formatDate(x.created_at)+" / "+x.type})))+pager("logs",page,total,hasMore)+'</section>';
 status("全"+total+"件中 "+(total?offset+1:0)+"〜"+(offset+list.length)+"件を表示","good");
}
async function loadStorage(seq){
 const [d,overview]=await Promise.all([api("/api/admin/monitor/storage"),api("/api/admin/monitor/overview")]);
 if(seq!==requestSequence)return;
 const d1=d.d1||{},sb=d.supabase||{},guard=d.packUploadGuard||{},gh=d.github||{};
 let html=await expansionPanel();
 html+=cards([{label:"Cloudflare D1",value:d1.available?formatBytes(d1.usedBytes):"取得不可"},{label:"Supabase Storage",value:sb.available?formatBytes(sb.usedBytes):"取得不可"},{label:"GitHubリポジトリ",value:gh.available?formatBytes(gh.sizeBytes):"取得不可"},{label:"パック情報（文字数概算）",value:formatBytes(overview.packs?.approx_bytes)}]);
 html+='<section class="panel"><h2>保存先ごとの使用容量</h2>';
 if(d1.available)html+=storageMeter("Cloudflare D1（mapart_data）",d1.usedBytes,d1.databaseLimitBytes,"Workers FreeのDB単体上限500MiB。アカウント全体のFree枠は5GiB。");
 else html+='<p class="notice">Cloudflare D1の実使用量を取得できませんでした。</p>';
 if(sb.available){
  html+=storageMeter("Supabase Storage（画像＋パック合計）",sb.usedBytes,1024*1024*1024,"Free枠1GiB・両バケット共有");
  html+='<div class="storage-subgrid">'+(sb.buckets||[]).map(b=>'<div class="storage-subcard"><strong>'+esc(b.id)+'</strong><div>'+formatBytes(b.usedBytes)+' · '+number(b.count)+'ファイル</div><small>1ファイル上限 '+formatBytes(b.maxFileBytes)+'</small></div>').join("")+'</div>';
 }else html+='<p class="notice">Supabase Storageの実使用量：'+esc(sb.error||"取得不可")+'。実際の容量はSupabase管理画面でも確認できます。</p>';
 if(gh.available)html+=storageMeter("GitHubリポジトリ（tool）",gh.sizeBytes,null,"GitHub APIの現在のリポジトリサイズ。契約上限はAPIで確認できないため割合は表示しません。",true);
 else html+='<p class="notice">GitHubリポジトリ容量を取得できませんでした：'+esc(gh.error||"")+'</p>';
 html+=storageMeter("パック保存のアプリ側安全枠",guard.usedBytes,guard.limitBytes,number(guard.files)+"ファイルをD1で管理");
 html+='</section><section class="panel"><h2>容量の見方・注意点</h2><p class="notice">Supabaseの1GiBは2つの公開バケットで共有されます。各バケットの5MiB／50MiBは1ファイルごとの上限です。パック保存の700MiBはアプリ側で設けた追加の安全枠で、Supabaseの契約容量とは別です。Cloudflare D1の数値はD1 APIのsize_afterを使った実DBサイズです。GitHubは現在サイズのみ表示し、固定上限がないため達成率は出していません。</p></section>';
 $("pageContent").innerHTML=html;
 status("最終確認: "+formatDate(d.checkedAt||Date.now()),"good");
}
async function loadAccess(page,seq){
 const offset=page*PAGE_SIZE,d=await api("/api/admin/monitor/access?limit="+PAGE_SIZE+"&offset="+offset);
 if(seq!==requestSequence)return;
 const daily=(d.daily||[]),allAdmins=(d.admin||[]),serverPaged=Number.isFinite(Number(d.adminTotal));
 const total=serverPaged?number(d.adminTotal):allAdmins.length;
 const admins=serverPaged?allAdmins:allAdmins.slice(offset,offset+PAGE_SIZE);
 const hasMore=serverPaged?Boolean(d.hasMore):offset+PAGE_SIZE<total;
 $("pageContent").innerHTML='<section class="panel"><h2>公開ページの日別アクセス（直近90日）</h2>'+(daily.length?'<table><thead><tr><th>日付（日本時間）</th><th>API</th><th>アクセス数</th></tr></thead><tbody>'+daily.map(x=>'<tr><td>'+esc(x.day)+'</td><td>'+esc(x.route)+'</td><td>'+esc(x.count)+'</td></tr>').join("")+'</tbody></table>':'<div class="empty">アクセス記録はまだありません。</div>')+'</section><section class="panel"><h2>管理者アクセス記録</h2>'+rows(admins.map(x=>({title:x.action,body:x.detail,meta:formatDate(x.created_at)+" / IP識別ハッシュ: "+x.ip_hash+" / "+x.user_agent})))+pager("access",page,total,hasMore)+'</section><p class="notice">公開アクセスは日別集計のみです。管理者アクセスではIPアドレスそのものではなくハッシュ値を保存します。</p>';
 status("管理者ログ "+total+"件中 "+(total?offset+1:0)+"〜"+(offset+admins.length)+"件を表示","good");
}
async function renderPage(){
 const seq=++requestSequence;activateNav();status("読み込み中…");$("pageContent").innerHTML='<div class="panel loading" role="status">データを読み込んでいます…</div>';
 try{
  if(currentPage==="overview")await loadOverview(seq);
  else if(currentPage==="updates")await loadLogs("update",logPage,seq);
  else if(currentPage==="debug")await loadLogs("debug",logPage,seq);
  else if(currentPage==="storage")await loadStorage(seq);
  else if(currentPage==="access")await loadAccess(accessPage,seq);
  else{currentPage="overview";await loadOverview(seq);}
 }catch(error){
  if(seq!==requestSequence)return;
  status(error.message,"error");
  $("pageContent").innerHTML=failurePanel(error);
 }
}
function pageFromHash(){const p=location.hash.replace(/^#/,"");return ["overview","updates","debug","storage","access"].includes(p)?p:"overview";}
async function init(){
 if(!token){location.href="index.html";return;}
 try{await api("/api/admin/session");}
 catch(error){
  if(error.status===401){clearSavedAdminToken();location.href="index.html";return;}
  status(error.message,"error");$("pageContent").innerHTML=failurePanel(error);return;
 }
 $("logoutBtn")?.addEventListener("click",()=>{clearSavedAdminToken();location.href="index.html";});
 $("refreshBtn")?.addEventListener("click",()=>renderPage());
 document.querySelectorAll("[data-nav]").forEach(a=>a.addEventListener("click",e=>{
  e.preventDefault();const next=a.dataset.nav;
  if(next===currentPage){renderPage();return;}
  if(next==="updates"||next==="debug")logPage=0;
  if(next==="access")accessPage=0;
  location.hash=next;
 }));
 $("pageContent")?.addEventListener("click",e=>{
  if(e.target.closest("[data-retry]")){renderPage();return;}
  const p=e.target.closest("[data-page]");if(!p||p.disabled)return;
  const step=Number(p.dataset.step)||0;
  if(p.dataset.page==="logs")logPage=Math.max(0,logPage+step);
  if(p.dataset.page==="access")accessPage=Math.max(0,accessPage+step);
  renderPage();
 });
 window.addEventListener("hashchange",()=>{currentPage=pageFromHash();renderPage();});
 currentPage=pageFromHash();renderPage();
 setInterval(()=>{if(currentPage==="overview"&&document.visibilityState==="visible")renderPage();},60000);
}
init();

})();