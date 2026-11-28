(() => {
"use strict";
const API = document.querySelector('meta[name="resource-packs-api"]')?.content;
if (!API) throw new Error("API endpoint is not configured");
const $ = id => document.getElementById(id);
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const favKey = "bedrock-resource-pack-favorites-v1";
let imageOffset = 0, packs = [], seedPacks = [], activeCategory = "すべて", favoritesOnly = false, currentPage = 1, pageSize = 60, searchTimer = 0, suggestionActiveIndex = -1, modalReturnFocus = null, token = sessionStorage.getItem("resourcePackAdminToken") || "", currentModalId = null, currentGalleryImages = [];
const tokenExpiry=Number(sessionStorage.getItem("resourcePackAdminTokenExpiresAt")||0);
if(tokenExpiry&&tokenExpiry<=Date.now()){token="";sessionStorage.removeItem("resourcePackAdminToken");sessionStorage.removeItem("resourcePackAdminTokenExpiresAt");}
const BASE_CATEGORIES = ["シェーダー","軽量化","UI・テーマ","UI・操作","UI・メニュー","自然・植物","ブロック・建築","ブロック・アイテム","UI・シンプル","サウンド","空・天候","水・環境","モブ・モデル","アニメーション","言語・フォント","便利・農業","便利・操作","季節・テーマ","テーマ・世界観","その他"];
let categories = ["すべて", ...BASE_CATEGORIES];
const searchCache = new WeakMap();
const JAPANESE_RE = /[ぁ-んァ-ヶ一-龯]/;
const initialSearchParams=new URLSearchParams(location.search);
if(initialSearchParams.has("q"))$("search").value=initialSearchParams.get("q")||"";
if(categories.includes(initialSearchParams.get("category")))activeCategory=initialSearchParams.get("category");
if(initialSearchParams.get("sort")&&["new","az","fav","updated","author"].includes(initialSearchParams.get("sort")))$("sort").value=initialSearchParams.get("sort");
favoritesOnly=initialSearchParams.get("fav")==="1";currentPage=Math.max(1,Number.parseInt(initialSearchParams.get("page")||"1",10)||1);
$("favoritesOnly").classList.toggle("primary",favoritesOnly);
function syncSearchUrl(){
 const p=new URLSearchParams(),q=$("search").value.trim(),sort=$("sort").value;
 if(q)p.set("q",q);if(activeCategory!=="すべて")p.set("category",activeCategory);
 if(favoritesOnly)p.set("fav","1");if(sort!=="new")p.set("sort",sort);if(currentPage>1)p.set("page",String(currentPage));
 const next=location.pathname+(p.toString()?"?"+p.toString():"")+location.hash;
 history.replaceState(null,"",next);
}
function favorites(){
 try{const v=JSON.parse(localStorage.getItem(favKey)||"[]");return new Set(Array.isArray(v)?v.filter(x=>typeof x==="string"):[]);}
 catch{favoriteStorageAvailable=false;return new Set(volatileFavorites);}
}
function setFavorites(set){
 volatileFavorites.clear();for(const id of set)volatileFavorites.add(id);
 try{localStorage.setItem(favKey,JSON.stringify([...set]));favoriteStorageAvailable=true;}
 catch{favoriteStorageAvailable=false;}
}
function searchableText(p){
 let value=searchCache.get(p);
 if(value===undefined){value=[p.title,p.author,p.description,p.category,...(p.searchKeywords||[]),...(p.tags||[])].join(" ").normalize("NFKC").toLocaleLowerCase();searchCache.set(p,value);}
 return value;
}
function syncCategoryOptions(){
 const dynamic=[...new Set(packs.map(p=>String(p.category||"その他").trim()).filter(Boolean))];
 categories=["すべて",...new Set([...BASE_CATEGORIES,...dynamic])];
 const select=$("editCategory");
 if(select){const current=select.value;select.replaceChildren(...categories.slice(1).map(value=>{const option=document.createElement("option");option.value=value;option.textContent=value;return option;}));select.value=categories.includes(current)?current:"その他";}
}
function setStatus(message,type=""){const editorVisible=!$("editorArea").classList.contains("hidden");const el=$(editorVisible?"adminStatus":"loginStatus");if(el){el.textContent=message;el.className="status "+type;}}
function categoryNav(){ $("filters").innerHTML=categories.map(c=>'<button class="chip '+(c===activeCategory?"active":"")+'" data-category="'+esc(c)+'">'+esc(c)+'</button>').join(""); }
const searchTerms = [
 ["シェーダー","shader","shaders","visual","graphics","グラフィック"],
 ["軽量化","performance","fps","軽い","最適化"],
 ["UI","ユーアイ","gui","hud","メニュー","menu","インベントリ","inventory"],
 ["空","sky","cloud","雲","sun","太陽","moon","月","stars","星"],
 ["水","water","ocean","海","川","river"],
 ["自然","nature","植物","plant","tree","木","草","grass","leaves","葉"],
 ["ブロック","block","blocks","建築","building","texture","テクスチャ"],
 ["アイテム","item","items","道具","持ち物"],
 ["サウンド","sound","sounds","audio","音","効果音"],
 ["フォント","font","文字","language","言語","翻訳"],
 ["アニメーション","animation","animated","動き"],
 ["モブ","mob","model","モデル","動物","animal"],
 ["天候","weather","rain","雨","snow","雪"],
 ["透明","透明化","transparent","glass","ガラス"],
 ["かわいい","cute","カラフル","colorful","pastel","パステル"],
 ["リアル","realistic","realism","高画質","HD"],
 ["シンプル","simple","minimal","ミニマル"],
 ["暗い","dark","黒","black"],
 ["明るい","bright","light","白","white"]
];
function normalized(s){return String(s||"").normalize("NFKC").toLocaleLowerCase().trim();}
const formatDateJst=value=>{const n=Number(value);if(!Number.isFinite(n))return "不明";const d=new Date(n);return Number.isNaN(d.getTime())?"不明":new Intl.DateTimeFormat("ja-JP",{timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"}).format(d);};
function expandSearch(q){
 const n=normalized(q);if(!n)return [];
 const out=[n];
 for(const group of searchTerms)if(group.some(t=>normalized(t)===n))out.push(...group.map(normalized));
 return [...new Set(out.filter(Boolean))];
}
function suggestionItems(q){
 const n=normalized(q);if(!n)return ["シェーダー","UI","自然","空","水","ブロック","アイテム","サウンド","軽量化","フォント"];
 const matches=[];
 for(const group of searchTerms){const label=group[0];if(group.some(t=>normalized(t).includes(n)||n.includes(normalized(t))))matches.push(label,...group.filter(t=>normalized(t)!==n).slice(0,2));}
 return [...new Set(matches)].slice(0,8);
}
function renderSuggestions(){
 const q=$("search").value,box=$("searchSuggestions"),items=suggestionItems(q);
 if(!items.length){box.classList.add("hidden");$("search").setAttribute("aria-expanded","false");$("search").removeAttribute("aria-activedescendant");suggestionActiveIndex=-1;return;}
 suggestionActiveIndex=-1;$("search").removeAttribute("aria-activedescendant");
 box.innerHTML=items.map((v,i)=>'<button id="search-option-'+i+'" type="button" role="option" aria-selected="false" data-suggest="'+esc(v)+'"><span>'+esc(v)+'</span><small>'+(i===0&&q?"候補":"関連キーワード")+'</small></button>').join("")+(q?'<button type="button" data-translate-search="1"><span>入力した言葉を'+(JAPANESE_RE.test(q)?"英語":"日本語")+'に翻訳して検索</span><small>自動翻訳</small></button>':"");
 box.classList.remove("hidden");$("search").setAttribute("aria-expanded","true");
}
async function translateSearch(){
 const q=$("search").value.trim();if(!q)return;
 const target=JAPANESE_RE.test(q)?"en":"ja";
 window.open("https://translate.google.com/?sl=auto&tl="+target+"&text="+encodeURIComponent(q)+"&op=translate","_blank","noopener,noreferrer");
 $("searchSuggestions").classList.add("hidden");$("search").setAttribute("aria-expanded","false");
}
function filtered(){
 const q=normalized($("search").value),terms=expandSearch(q),fav=favorites();
 let list=packs.filter(p=>(activeCategory==="すべて"||p.category===activeCategory)&&(!favoritesOnly||fav.has(p.id))&&(!q||terms.some(term=>searchableText(p).includes(term))));
 const sort=$("sort").value;
 if(sort==="az")list=[...list].sort((a,b)=>a.title.localeCompare(b.title,"ja"));
 if(sort==="fav")list=[...list].sort((a,b)=>(Number(fav.has(b.id))-Number(fav.has(a.id)))||a.title.localeCompare(b.title,"ja"));
 if(sort==="updated")list=[...list].sort((a,b)=>String(b.sourceUpdatedAt||b.updatedAt||b.createdAt||"").localeCompare(String(a.sourceUpdatedAt||a.updatedAt||a.createdAt||"")));
 if(sort==="author")list=[...list].sort((a,b)=>String(a.author||"").localeCompare(String(b.author||""),"ja")||a.title.localeCompare(b.title,"ja"));
 return list;
}
document.addEventListener("error",event=>{const img=event.target;if(!(img instanceof HTMLImageElement))return;img.hidden=true;const fallback=img.nextElementSibling;if(fallback?.classList.contains("image-placeholder"))fallback.hidden=false;},true);
function safeImageUrl(value){
 try{const u=new URL(String(value||""),location.href);return u.protocol==="https:"||u.origin===location.origin?u.href:"";}catch{return "";}
}
function imageMarkup(url,alt,cls){
 const safe=safeImageUrl(url);
 return '<div class="'+cls+'">'+(safe?'<img src="'+esc(safe)+'" alt="'+esc(alt)+'" loading="lazy" decoding="async" referrerpolicy="no-referrer"><div class="image-placeholder" hidden>📦</div>':'<div class="image-placeholder">📦</div>')+'</div>';
}
function render(){
 const list=filtered(),fav=favorites(),totalPages=Math.max(1,Math.ceil(list.length/pageSize));
 currentPage=Math.min(currentPage,totalPages);
 const offset=(currentPage-1)*pageSize,visible=list.slice(offset,offset+pageSize);
 $("countStat").textContent=packs.length+"件掲載";
 $("resultCount").textContent=(list.length?offset+1:0)+"〜"+Math.min(offset+pageSize,list.length)+"件 / 全"+list.length+"件（"+currentPage+" / "+totalPages+"ページ）";
 $("loadMorePacks").classList.toggle("hidden",totalPages<=1);$("loadMorePacks").disabled=currentPage>=totalPages;$("loadMorePacks").textContent="次のページ →";
 if($("prevPacks")){$("prevPacks").classList.toggle("hidden",totalPages<=1);$("prevPacks").disabled=currentPage<=1;}
 if($("pageIndicator"))$("pageIndicator").textContent=currentPage+" / "+totalPages+"ページ";
 syncSearchUrl();
 $("grid").innerHTML=visible.length?visible.map(p=>'<article class="pack" data-open="'+esc(p.id)+'">'+imageMarkup(p.thumbnailUrl||(p.galleryImages||[])[0]||"",p.title+"の画像","pack-thumb")+'<div class="pack-top"><span class="category">'+esc(p.category)+'</span><button class="fav '+(fav.has(p.id)?"on":"")+'" data-fav="'+esc(p.id)+'" aria-label="お気に入り">'+(fav.has(p.id)?"★":"☆")+'</button></div><h2>'+esc(p.title)+'</h2><div class="author">作者：'+esc(p.author||"不明")+'</div><p class="desc">'+esc(p.description)+'</p><div class="pack-bottom"><span class="version">'+esc(p.compatibility||"対応情報は配布元で確認")+'</span><button class="details" data-open="'+esc(p.id)+'">詳細を見る →</button></div>'+(p.directDownloadAllowed?'<div class="version">サイト内ダウンロード対応</div>':'')+(token?'<div class="admin-actions"><button class="btn small" data-delete="'+esc(p.id)+'">削除</button></div>':"")+'</article>').join(""):'<div class="empty">該当するパックが見つかりませんでした。検索語やジャンルを変えてみてね。</div>';
}
function renderGallery(index=0){
 const box=$("modalGallery");
 if(!currentGalleryImages.length){box.innerHTML=imageMarkup("","画像なし","modal-gallery-main");return;}
 const safeIndex=Math.max(0,Math.min(index,currentGalleryImages.length-1)),url=currentGalleryImages[safeIndex];
 box.innerHTML=imageMarkup(url,"リソースパック画像 "+(safeIndex+1),"modal-gallery-main")+(currentGalleryImages.length>1?'<div class="gallery-thumbs">'+currentGalleryImages.map((src,i)=>'<button type="button" data-gallery-index="'+i+'" class="'+(i===safeIndex?"active":"")+'" aria-pressed="'+String(i===safeIndex)+'" aria-label="画像 '+(i+1)+'"><img src="'+esc(src)+'" alt="" loading="lazy" referrerpolicy="no-referrer"></button>').join("")+'</div>':"");
}
function openDetail(id){
 const p=packs.find(x=>x.id===id);if(!p)return;modalReturnFocus=document.activeElement;currentModalId=id;
 $("modalCategory").textContent=p.category;$("modalTitle").textContent=p.title;
 const meta=[["作者",p.author],["対応バージョン",p.compatibility||p.versions],["配布元",p.source],["公開日",p.publishedAt||p.createdAt],["最終更新日",p.sourceUpdatedAt||p.updatedAt],["ダウンロード数",p.downloads],["ファイルサイズ",p.fileSize],["ライセンス",p.license],["必要条件",p.requirements],["対応言語",Array.isArray(p.languages)?p.languages.join("、"):p.languages],["タグ",(p.tags||[]).join("、")]].filter(x=>x[1]!==undefined&&x[1]!==null&&String(x[1]).trim()!=="");const sections=[["説明",p.fullDescription||p.description],["主な特徴",p.features],["導入方法",p.installationSteps],["更新履歴",p.changelog],["注意事項",p.notes]].filter(x=>x[1]);$("modalBody").innerHTML='<div class="detail-meta">'+meta.map(x=>'<div><b>'+esc(x[0])+'</b><span>'+esc(Array.isArray(x[1])?x[1].join("、"):x[1])+'</span></div>').join("")+'</div>'+sections.map(x=>'<section class="detail-section"><h3>'+esc(x[0])+'</h3><p>'+esc(x[1])+'</p></section>').join("")+(p.sourceUrl?'<section class="detail-section"><h3>掲載情報について</h3><p>この図鑑に取得できた情報を掲載しています。未取得・未公表の項目は表示していません。内容の確認日：'+esc(p.detailsFetchedAt||"未記録")+'</p></section>':"");
 currentGalleryImages=[...new Set([p.thumbnailUrl,...(Array.isArray(p.galleryImages)?p.galleryImages:[])].map(safeImageUrl).filter(Boolean))].slice(0,20);
 renderGallery(0);
 $("sourceLink").href=safeImageUrl(p.sourceUrl)||"#";
 $("downloadLink").href=API+"/api/download/"+encodeURIComponent(p.id);
 $("downloadLink").classList.toggle("hidden",!(p.directDownloadAllowed&&p.directDownloadUrl));
 $("downloadLink").textContent="サイト内からダウンロード ↓";
 const isFav=favorites().has(id);$("modalFav").textContent=isFav?"★ お気に入り済み":"☆ お気に入り";
 const isJapanese=JAPANESE_RE.test((p.fullDescription||p.description||""));
 $("translateDescription").href="https://translate.google.com/?sl=auto&tl="+(isJapanese?"en":"ja")+"&text="+encodeURIComponent(p.fullDescription||p.description||"")+"&op=translate";
 $("translateDescription").textContent=isJapanese?"英語に翻訳 ↗":"日本語に翻訳 ↗";
 $("modal").classList.remove("hidden");$("modal").setAttribute("aria-hidden","false");document.body.style.overflow="hidden";$("modalClose").focus();
}
function closeModal(){
 $("modal").classList.add("hidden");$("modal").setAttribute("aria-hidden","true");
 document.body.style.overflow="";currentModalId=null;
 if(modalReturnFocus&&typeof modalReturnFocus.focus==="function")modalReturnFocus.focus();
 modalReturnFocus=null;
}
function toggleFav(id){
 const f=favorites();f.has(id)?f.delete(id):f.add(id);setFavorites(f);
 if(favoritesOnly){currentPage=1;render();}
 else{
  const button=$("grid").querySelector('[data-fav="'+CSS.escape(id)+'"]');
  if(button){const active=f.has(id);button.classList.toggle("on",active);button.setAttribute("aria-pressed",String(active));button.textContent=active?"★":"☆";}
 }
 if(currentModalId===id)$("modalFav").textContent=f.has(id)?"★ お気に入り済み":"☆ お気に入り";
 if(!favoriteStorageAvailable)catalogueNotice("このブラウザではお気に入りを保存できません。ページを閉じると消える場合があります。","warning");
}
function clearEditor(){
 ["editTitle","editAuthor","editVersion","editUrl","editThumbnail","editGallery","editDownloadUrl","editDescription","editPermissionUrl","editPermissionNote","editImagePermissionUrl"].forEach(id=>$(id).value="");
 if($("editPackFile"))$("editPackFile").value="";if($("uploadPackStatus"))$("uploadPackStatus").textContent="";
 $("editCategory").value="シェーダー";$("editDownloadAllowed").checked=false;
 setStatus("入力をクリアしました。");
}
async function api(path,options={}){
 const headers={"Accept":"application/json",...(options.body?{"Content-Type":"application/json"}:{}),...(options.headers||{})};
 if(token&&/^[A-Za-z0-9_.-]{20,2048}$/.test(token))headers.Authorization="Bearer "+token;
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
 try{
  const res=await fetch(API+path,{...options,headers,cache:"no-store",signal:controller.signal});
  let body;try{body=await res.json();}catch{throw new Error("サーバーから正しい応答がありません。");}
  if(!res.ok)throw new Error(body.error||("APIエラー "+res.status));
  return body;
 }catch(error){if(error.name==="AbortError")throw new Error("通信がタイムアウトしました。");throw error;}
 finally{clearTimeout(timer);}
}
const candidateCategories=["その他","シェーダー","軽量化","UI・テーマ","UI・操作","UI・メニュー","自然・植物","ブロック・建築","ブロック・アイテム","サウンド","空・天候","水・環境","モブ・モデル","アニメーション","言語・フォント","便利・農業","季節・テーマ"];

async function loadTrash(){
 const box=$("trashList");if(!box||!token)return;
 box.innerHTML='<div class="empty">削除履歴を読み込み中…</div>';
 try{const data=await api("/api/admin/trash"),items=data.items||[];
 box.innerHTML=items.length?items.map(x=>'<div class="admin-actions" style="align-items:center;justify-content:space-between;border-bottom:1px solid var(--border);padding:8px 0"><span>'+esc(x.title)+' <small>'+esc(formatDateJst(x.deleted_at))+'</small></span><button class="btn small" data-restore="'+esc(x.id)+'">復元</button></div>').join(""):'<p class="note">削除履歴はありません。</p>';
 }catch(error){box.textContent="削除履歴を読み込めませんでした："+error.message;}
}

async function loadCandidates(){
 const box=$("candidateList");if(!box)return;box.innerHTML='<div class="empty">候補を読み込み中…</div>';
 try{const data=await api("/api/admin/candidates"),list=data.candidates||[];
 box.innerHTML=list.length?list.map(c=>'<article class="pack">'+imageMarkup(c.thumbnailUrl||((c.galleryImages||[])[0])||"",c.title,"pack-thumb")+'<h2>'+esc(c.title)+'</h2><div class="author">作者：'+esc(c.author||"不明")+' · '+esc(c.provider)+'</div><p class="desc">'+esc(c.description)+'</p><div class="admin-actions"><a class="btn small" href="'+esc(safeImageUrl(c.sourceUrl)||"#")+'" target="_blank" rel="noopener noreferrer">配布元を確認 ↗</a><select class="field" data-candidate-category="'+esc(c.id)+'">'+candidateCategories.map(x=>'<option>'+esc(x)+'</option>').join("")+'</select><button class="btn primary small" data-approve="'+esc(c.id)+'">確認して公開</button><button class="btn small" data-reject="'+esc(c.id)+'">除外</button></div><div class="version">発見：'+formatDateJst(c.discoveredAt)+'</div></article>').join(""):'<div class="empty">追加候補はありません。今すぐ候補を探してみてね。</div>';
 $("candidateStatus").textContent=list.length+"件の未確認候補";
 }catch(e){box.innerHTML='<div class="empty">候補を読み込めませんでした：'+esc(e.message)+'</div>';}
}
function pollGalleryImages(attempt=0){
 const MAX_ATTEMPTS=36,INTERVAL_MS=10000;
 if(attempt>=MAX_ATTEMPTS)return;
 setTimeout(async()=>{
  try{
   const live=await api("/api/packs"),next=Array.isArray(live.packs)?live.packs:[];
   const merged=mergeLivePacks(next),oldById=new Map(packs.map(p=>[p.id,p]));
   const changed=merged.some(p=>{const old=oldById.get(p.id);return !old||p.thumbnailUrl!==old.thumbnailUrl||JSON.stringify(p.galleryImages||[])!==JSON.stringify(old.galleryImages||[]);});
   if(changed){packs=merged;render();}
   const pending=next.some(p=>!p.thumbnailUrl&&!(p.galleryImages||[]).length);
   if(pending&&attempt+1<MAX_ATTEMPTS)pollGalleryImages(attempt+1);
  }catch(error){
   console.info("Gallery status check failed",error.message);
   if(attempt+1<MAX_ATTEMPTS)pollGalleryImages(attempt+1);
  }
 },INTERVAL_MS);
}
function normalizeSourceUrl(value){
 try{
  const u=new URL(String(value||""));
  if(u.protocol!=="https:")return "";
  u.hostname=u.hostname.toLowerCase().replace(/^www\./,"");
  u.hash="";
  for(const key of [...u.searchParams.keys()])if(/^(utm_.+|fbclid|gclid|ref|source|campaign)$/i.test(key))u.searchParams.delete(key);
  u.searchParams.sort();
  u.pathname=u.pathname.replace(/\/+$/,"");
  return u.origin+u.pathname+(u.search||"");
 }catch{return "";}
}
function mergeLivePacks(live){
 const byUrl=new Map();
 for(const p of seedPacks){const key=normalizeSourceUrl(p.sourceUrl);if(key)byUrl.set(key,p);}
 for(const p of (Array.isArray(live)?live:[])){
  const key=normalizeSourceUrl(p.sourceUrl);if(!key)continue;
  const seed=byUrl.get(key);
  const sourceHost=(()=>{try{return new URL(p.sourceUrl).hostname.toLowerCase();}catch{return "";}})();
  if(!seed&&(/mcpedl/i.test(String(p.source||""))||sourceHost==="mcpedl.com"))continue;
  const base=seed||{},merged={...base};
  for(const [field,value] of Object.entries(p)){
   if(value===null||value===undefined||value==="")continue;
   if(Array.isArray(value)&&value.length===0&&Array.isArray(base[field])&&base[field].length)continue;
   merged[field]=value;
  }
  merged.thumbnailUrl=p.thumbnailUrl||base.thumbnailUrl||"";
  merged.galleryImages=Array.isArray(p.galleryImages)&&p.galleryImages.length?p.galleryImages:(base.galleryImages||[]);
  merged.sourceUrl=base.sourceUrl||p.sourceUrl;
  byUrl.set(key,merged);
 }
 return [...byUrl.values()];
}
function catalogueNotice(message,kind="warning"){
 let el=$("catalogueNotice");
 if(!el){el=document.createElement("div");el.id="catalogueNotice";el.className="catalogue-notice";$("grid").before(el);}
 el.replaceChildren(document.createTextNode(message));
 if(message){const button=document.createElement("button");button.type="button";button.className="btn small";button.textContent="再試行";button.addEventListener("click",()=>load());el.append(document.createTextNode(" "),button);}
 el.dataset.kind=kind;el.hidden=!message;
}
async function load(){
 let seedError=null,liveError=null;
 $("resultCount").textContent="図鑑を読み込み中…";$("grid").setAttribute("aria-busy","true");
 $("grid").innerHTML=Array.from({length:6},()=>'<div class="skeleton-pack" aria-hidden="true"><div class="skeleton-image"></div><div class="skeleton-line"></div><div class="skeleton-line short"></div></div>').join("");
 try{
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
  let response;try{response=await fetch("resource-packs.json",{cache:"no-store",signal:controller.signal});}finally{clearTimeout(timer);}
  if(!response.ok)throw new Error("HTTP "+response.status);
  const data=await response.json();if(!Array.isArray(data))throw new Error("カタログ形式が不正です。");
  seedPacks=data.filter(p=>p&&typeof p==="object"&&typeof p.id==="string"&&typeof p.title==="string");packs=seedPacks;
 }catch(error){seedError=error;seedPacks=[];packs=[];}
 try{
  const live=await api("/api/packs");
  if(Array.isArray(live.packs))packs=mergeLivePacks(live.packs);
  else throw new Error("公開APIのデータ形式が不正です。");
 }catch(error){liveError=error;console.info("Cloud catalogue unavailable.",error.message);}
 syncCategoryOptions();categoryNav();render();$("grid").removeAttribute("aria-busy");
 if(seedError&&liveError)catalogueNotice("図鑑データを読み込めませんでした。通信を確認して再読み込みしてください。","error");
 else if(seedError)catalogueNotice("基本カタログを読み込めませんでした。現在表示できるデータは公開API分のみです。","warning");
 else if(liveError)catalogueNotice("追加データとの同期に失敗しました。基本カタログを表示しています。","warning");
 else catalogueNotice("");
 if(packs.some(p=>!p.thumbnailUrl&&!(p.galleryImages||[]).length))pollGalleryImages();
 if(token){
  try{await api("/api/admin/session");showEditor(true);await loadCandidates();await loadTrash();}
  catch(error){
   if(/401|ログインしてください|認証/i.test(error.message)){token="";sessionStorage.removeItem("resourcePackAdminToken");sessionStorage.removeItem("resourcePackAdminTokenExpiresAt");showEditor(false);setStatus("ログイン期限が切れました。再度ログインしてください。","error");}
   else{showEditor(false);setStatus("管理者認証サーバーに接続できません。通信を確認して再読み込みしてください。","error");}
  }
 }
}
function showEditor(loggedIn){
 $("loginArea").classList.toggle("hidden",loggedIn);$("editorArea").classList.toggle("hidden",!loggedIn);
}
$("filters").addEventListener("click",e=>{const b=e.target.closest("[data-category]");if(!b)return;activeCategory=b.dataset.category;currentPage=1;categoryNav();render();});
$("grid").addEventListener("click",e=>{
 const reset=e.target.closest("[data-reset-search]");if(reset){$("search").value="";activeCategory="すべて";favoritesOnly=false;$("sort").value="new";$("favoritesOnly").classList.remove("primary");currentPage=1;categoryNav();render();return;}
 const fav=e.target.closest("[data-fav]");if(fav){e.stopPropagation();toggleFav(fav.dataset.fav);return;}
 const del=e.target.closest("[data-delete]");if(del){e.stopPropagation();deletePack(del.dataset.delete);return;}
 const open=e.target.closest("[data-open]");if(open)openDetail(open.dataset.open);
});
$("search").addEventListener("input",()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{currentPage=1;render();renderSuggestions();},140);});$("search").addEventListener("focus",renderSuggestions);$("search").addEventListener("keydown",e=>{
 const box=$("searchSuggestions"),options=[...box.querySelectorAll("[data-suggest]")];
 if(e.key==="Escape"){box.classList.add("hidden");$("search").setAttribute("aria-expanded","false");$("search").removeAttribute("aria-activedescendant");suggestionActiveIndex=-1;return;}
 if((e.key==="ArrowDown"||e.key==="ArrowUp")&&!box.classList.contains("hidden")&&options.length){e.preventDefault();const step=e.key==="ArrowDown"?1:-1;suggestionActiveIndex=(suggestionActiveIndex+step+options.length)%options.length;options.forEach((option,i)=>option.setAttribute("aria-selected",String(i===suggestionActiveIndex)));$("search").setAttribute("aria-activedescendant","search-option-"+suggestionActiveIndex);return;}
 if(e.key==="Enter"&&suggestionActiveIndex>=0&&options[suggestionActiveIndex]){e.preventDefault();$("search").value=options[suggestionActiveIndex].dataset.suggest;box.classList.add("hidden");$("search").setAttribute("aria-expanded","false");$("search").removeAttribute("aria-activedescendant");suggestionActiveIndex=-1;currentPage=1;render();}
});$("searchSuggestions").addEventListener("click",e=>{const b=e.target.closest("[data-suggest]");if(!b)return;$("search").value=b.dataset.suggest;$("searchSuggestions").classList.add("hidden");$("search").setAttribute("aria-expanded","false");$("search").removeAttribute("aria-activedescendant");suggestionActiveIndex=-1;currentPage=1;render();$("search").focus();});$("searchSuggestions").addEventListener("click",e=>{if(e.target.closest("[data-translate-search]"))translateSearch();});document.addEventListener("click",e=>{if(!e.target.closest(".search-wrap"))$("searchSuggestions").classList.add("hidden");});$("sort").addEventListener("change",()=>{currentPage=1;render();});
 window.addEventListener("popstate",()=>{const p=new URLSearchParams(location.search);$("search").value=p.get("q")||"";activeCategory=categories.includes(p.get("category"))?p.get("category"):"すべて";$("sort").value=["new","az","fav","updated","author"].includes(p.get("sort"))?p.get("sort"):"new";favoritesOnly=p.get("fav")==="1";currentPage=Math.max(1,Number.parseInt(p.get("page")||"1",10)||1);$("favoritesOnly").classList.toggle("primary",favoritesOnly);categoryNav();render();});
$("loadMorePacks").addEventListener("click",()=>{currentPage++;render();});if($("prevPacks"))$("prevPacks").addEventListener("click",()=>{currentPage=Math.max(1,currentPage-1);render();});
$("favoritesOnly").addEventListener("click",()=>{favoritesOnly=!favoritesOnly;currentPage=1;$("favoritesOnly").classList.toggle("primary",favoritesOnly);render();});
$("adminToggle").addEventListener("click",()=>$("adminPanel").classList.toggle("hidden"));
$("loginBtn").addEventListener("click",async()=>{
 const password=$("adminPassword").value;if(!password){setStatus("パスワードを入力してください。","error");return;}
 try{
  const data=await api("/api/admin/login",{method:"POST",body:JSON.stringify({password})});
  if(typeof data.token!=="string"||!/^[A-Za-z0-9_.-]{20,2048}$/.test(data.token))throw new Error("認証応答が不正です。");
  token=data.token;sessionStorage.setItem("resourcePackAdminToken",token);
  if(data.expiresIn)sessionStorage.setItem("resourcePackAdminTokenExpiresAt",String(Date.now()+Number(data.expiresIn)));
  $("adminPassword").value="";showEditor(true);render();await loadCandidates();await loadTrash();setStatus("ログインしました。","ok");
 }catch(e){if(e.message.includes("設定されていません"))$("adminSetupHint").classList.remove("hidden");setStatus(e.message,"error");}
});
$("logoutBtn").addEventListener("click",()=>{token="";sessionStorage.removeItem("resourcePackAdminToken");sessionStorage.removeItem("resourcePackAdminTokenExpiresAt");showEditor(false);render();setStatus("ログアウトしました。");});

$("uploadPackFile").addEventListener("click",async()=>{
 const file=$("editPackFile").files?.[0];
 if(!file){$("uploadPackStatus").textContent="先にファイルを選択してください。";return;}
 if(!token){$("uploadPackStatus").textContent="管理者ログインが必要です。";return;}
 if(!$("editDownloadAllowed").checked||!$("editPermissionUrl").value.trim()){$("uploadPackStatus").textContent="再配布許可の根拠URLを入力し、確認欄にチェックしてください。";return;}
 if(!/\.(mcpack|mcaddon|zip)$/i.test(file.name)||file.size>50*1024*1024){$("uploadPackStatus").textContent="mcpack / mcaddon / zip形式、50MB以下のファイルを選んでください。";return;}
 const button=$("uploadPackFile");button.disabled=true;$("uploadPackStatus").textContent="アップロード中…";
 try{
  const form=new FormData();form.append("file",file);form.append("permissionUrl",$("editPermissionUrl").value.trim());
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),90000);
  let response;
  try{response=await fetch(API+"/api/admin/storage/upload",{method:"POST",headers:{Authorization:"Bearer "+token},body:form,cache:"no-store",signal:controller.signal});}
  finally{clearTimeout(timer);}
  let data;try{data=await response.json();}catch{throw new Error("サーバーから正しい応答がありません。");}
  if(!response.ok)throw new Error(data.error||("アップロードエラー "+response.status));
  $("editDownloadUrl").value=data.publicUrl;
  $("uploadPackStatus").textContent="保存完了。公開URLを確認中…";const verify=await fetch(data.publicUrl,{method:"HEAD",cache:"no-store"});if(!verify.ok)throw new Error("アップロードは完了しましたが、公開URLの取得確認に失敗しました（HTTP "+verify.status+"）。");const verifiedSize=Number(verify.headers.get("Content-Length")||0);if(verifiedSize&&verifiedSize!==Number(data.size))throw new Error("公開URLのファイルサイズが一致しません。");$("uploadPackStatus").textContent="実通信テスト成功：保存・公開URLからの取得を確認しました。"+data.fileName+"（"+(data.size/1024/1024).toFixed(2)+"MB）";
 }catch(error){$("uploadPackStatus").textContent=error.name==="AbortError"?"アップロードがタイムアウトしました。":error.message;}
 finally{button.disabled=false;}
});

$("savePack").addEventListener("click",async()=>{
 const payload={title:$("editTitle").value.trim(),author:$("editAuthor").value.trim(),category:$("editCategory").value,compatibility:$("editVersion").value.trim()||"配布元で確認",sourceUrl:$("editUrl").value.trim(),thumbnailUrl:$("editThumbnail").value.trim(),galleryImages:$("editGallery").value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean),directDownloadUrl:$("editDownloadUrl").value.trim(),directDownloadAllowed:$("editDownloadAllowed").checked,permissionUrl:$("editPermissionUrl").value.trim(),permissionNote:$("editPermissionNote").value.trim(),imagePermissionUrl:$("editImagePermissionUrl").value.trim(),description:$("editDescription").value.trim(),source:"管理者登録"};
 if(!payload.title||!payload.sourceUrl||!payload.description){setStatus("パック名・説明・配布元URLを入力してください。","error");return;}
 try{const data=await api("/api/admin/packs",{method:"POST",body:JSON.stringify(payload)});packs.unshift(data.pack);clearEditor();render();setStatus("登録しました。","ok");}
 catch(e){setStatus(e.message,"error");}
});
$("discoverNow").addEventListener("click",async()=>{const b=$("discoverNow");b.disabled=true;$("candidateStatus").textContent="MCPEDLを検索中…";try{const r=await api("/api/admin/discover",{method:"POST",body:"{}"});$("candidateStatus").textContent="調査："+r.scanned+"件 / 新規候補："+r.added+"件 / 重複等："+r.skipped+"件";await loadCandidates();}catch(e){$("candidateStatus").textContent=e.message;}finally{b.disabled=false;}});
$("refreshCandidates").addEventListener("click",loadCandidates);

$("processImages")?.addEventListener("click",async()=>{const b=$("processImages");b.disabled=true;$("imageProcessStatus").textContent="画像リンクを確認・許可済み画像を保存中…";try{const r=await api("/api/admin/images/process",{method:"POST",body:JSON.stringify({limit:10,offset:imageOffset})});$("imageProcessStatus").textContent="確認 "+r.checked+"件 / 保存 "+r.stored+"件 / リンク切れ "+r.broken+"件 / 権利確認待ち "+r.skipped+"件";imageOffset+=r.packs||0;await load();}catch(e){$("imageProcessStatus").textContent=e.message;}finally{b.disabled=false;}});
$("trashList")?.addEventListener("click",async e=>{const b=e.target.closest("[data-restore]");if(!b)return;if(!confirm("このパックを復元しますか？"))return;try{await api("/api/admin/trash/"+encodeURIComponent(b.dataset.restore)+"/restore",{method:"POST",body:"{}"});await load();await loadTrash();setStatus("復元しました。","ok");}catch(error){setStatus(error.message,"error");}});

$("candidateList").addEventListener("click",async e=>{
 const a=e.target.closest("[data-approve]"),d=e.target.closest("[data-reject]");
 if(a){const id=a.dataset.approve,sel=$("candidateList").querySelector('[data-candidate-category="'+CSS.escape(id)+'"]');if(!confirm("配布元でBedrock対応を確認しましたか？確認済みなら公開します。"))return;try{const r=await api("/api/admin/candidates/"+encodeURIComponent(id)+"/approve",{method:"POST",body:JSON.stringify({category:sel?.value||"その他"})});packs.unshift(r.pack);render();await loadCandidates();$("candidateStatus").textContent="承認して公開しました。";}catch(err){$("candidateStatus").textContent=err.message;}}
 if(d){const id=d.dataset.reject;if(!confirm("この候補を除外しますか？"))return;try{await api("/api/admin/candidates/"+encodeURIComponent(id),{method:"DELETE"});await loadCandidates();}catch(err){$("candidateStatus").textContent=err.message;}}
});
$("cancelEdit").addEventListener("click",clearEditor);
async function deletePack(id){const p=packs.find(x=>x.id===id);if(!p||!confirm("「"+p.title+"」を削除しますか？"))return;try{await api("/api/admin/packs/"+encodeURIComponent(id),{method:"DELETE"});packs=packs.filter(x=>x.id!==id);render();await loadTrash();setStatus("削除履歴に保存しました。復元できます。","ok");}catch(e){setStatus(e.message,"error");}}
$("downloadLink").addEventListener("click",async e=>{
 e.preventDefault();const p=packs.find(x=>x.id===currentModalId);if(!p||!p.directDownloadAllowed)return;
 const button=$("downloadLink"),label=button.textContent;button.textContent="ダウンロード準備中…";button.classList.add("disabled");
 try{
  const res=await fetch(API+"/api/download/"+encodeURIComponent(p.id));
  if(!res.ok){let data={};try{data=await res.json();}catch{}throw new Error(data.error||"ダウンロードできませんでした。");}
  const blob=await res.blob(),cd=res.headers.get("Content-Disposition")||"",m=cd.match(/filename\*=UTF-8''([^;]+)/i);
  let filename=(p.title||"resource-pack")+".mcpack";if(m){try{filename=decodeURIComponent(m[1]);}catch{}}
  const objectUrl=URL.createObjectURL(blob),a=document.createElement("a");a.href=objectUrl;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(objectUrl),30000);
  button.textContent="ダウンロードを開始しました";
 }catch(err){alert(err.message);button.textContent=label;}
 finally{button.classList.remove("disabled");}
});
$("modalGallery").addEventListener("click",e=>{const b=e.target.closest("[data-gallery-index]");if(b)renderGallery(Number(b.dataset.galleryIndex));});

$("modalClose").addEventListener("click",closeModal);
$("modal").addEventListener("click",e=>{if(e.target===$("modal"))closeModal();});
$("modalFav").addEventListener("click",()=>currentModalId&&toggleFav(currentModalId));
document.addEventListener("keydown",e=>{
 const modal=$("modal");if(modal.classList.contains("hidden"))return;
 if(e.key==="Escape"){closeModal();return;}
 if(e.key==="Tab"){
  const focusable=[...modal.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter(el=>!el.closest(".hidden")&&el.getClientRects().length);
  if(!focusable.length)return;
  const first=focusable[0],last=focusable[focusable.length-1];
  if(e.shiftKey&&(document.activeElement===first||!modal.contains(document.activeElement))){e.preventDefault();last.focus();}
  else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
 }
});
load();
})();