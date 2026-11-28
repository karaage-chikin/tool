const ORIGIN = "https://karaage-chikin.github.io";
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const encoder = new TextEncoder();

function cors(origin) {
  return {
    "Access-Control-Allow-Origin": ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
    "Access-Control-Expose-Headers": "Content-Disposition",
    "X-Content-Type-Options": "nosniff"
  };
}
function reply(data, status, origin, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...cors(origin), ...extraHeaders }
  });
}
function b64url(bytes) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}
function unb64url(value) {
  const base = value.replace(/-/g,"+").replace(/_/g,"/");
  const binary = atob(base + "=".repeat((4 - base.length % 4) % 4));
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}
async function hmac(secret, value) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}
async function makeToken(secret) {
  const payload = b64url(encoder.encode(JSON.stringify({ role: "admin", exp: Date.now() + SESSION_MS })));
  return payload + "." + b64url(await hmac(secret, payload));
}
async function isAdmin(request, secret) {
  const auth = request.headers.get("Authorization") || "";
  const match = auth.match(/^Bearer ([A-Za-z0-9_.-]+)$/);
  if (!match) return false;
  const parts = match[1].split(".");
  if (parts.length !== 2) return false;
  try {
    const expected = await hmac(secret, parts[0]);
    const actual = unb64url(parts[1]);
    if (expected.length !== actual.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= expected[i] ^ actual[i];
    if (diff !== 0) return false;
    const payload = JSON.parse(new TextDecoder().decode(unb64url(parts[0])));
    return payload.role === "admin" && Number(payload.exp) > Date.now();
  } catch { return false; }
}
function galleryFromJson(value) {
  try { const parsed=JSON.parse(value||"[]"); return Array.isArray(parsed)?parsed.filter(x=>typeof x==="string").slice(0,20):[]; } catch { return []; }
}
function normalize(row) {
  const allowed=Number(row.direct_download_allowed||0)===1;
  return {
    id:row.id,title:row.title,author:row.author||"",category:row.category||"その他",
    description:row.description||"",sourceUrl:row.source_url,compatibility:row.compatibility||"配布元で確認",
    source:row.source||"管理者登録",createdAt:row.created_at,thumbnailUrl:row.thumbnail_url||"",
    galleryImages:galleryFromJson(row.gallery_json),directDownloadAllowed:allowed,
    directDownloadUrl:allowed?(row.direct_download_url||""):"",permissionUrl:row.permission_url||"",permissionNote:row.permission_note||"",imagePermissionUrl:row.image_permission_url||""
  };
}
function validatePack(input) {
  if(!input||typeof input!=="object")return "入力内容が不正です。";
  const title=String(input.title||"").trim(),url=String(input.sourceUrl||"").trim(),description=String(input.description||"").trim();
  if(!title||title.length>160)return "パック名を1〜160文字で入力してください。";
  if(!description||description.length>1200)return "説明を1〜1200文字で入力してください。";
  const isHttps=value=>{try{const u=new URL(value);return u.protocol==="https:"&&!!u.hostname.includes(".");}catch{return false;}};
  if(!isHttps(url))return "配布元URLはhttps://から始まるURLにしてください。";
  if(String(input.author||"").length>120||String(input.category||"").length>60||String(input.compatibility||"").length>120)return "入力が長すぎます。";
  const thumb=String(input.thumbnailUrl||"").trim();
  if(thumb&&!isHttps(thumb))return "サムネイル画像URLはhttps://から始まるURLにしてください。";
  const gallery=Array.isArray(input.galleryImages)?input.galleryImages:[];
  if(gallery.length>20||gallery.some(x=>typeof x!=="string"||x.length>2000||!isHttps(x.trim())))return "ギャラリー画像はhttps://のURLを20件以内で入力してください。";
  const download=String(input.directDownloadUrl||"").trim();
  if(download&&!isHttps(download))return "直接ダウンロードURLはhttps://から始まるURLにしてください。";
  if(input.directDownloadAllowed===true&&!download)return "直接ダウンロードを許可する場合はファイルURLを入力してください。";
  const permission=String(input.permissionUrl||"").trim();
  if(input.directDownloadAllowed===true&&!isHttps(permission))return "再配布許可の根拠URLを入力してください。";
  if(permission&&!isHttps(permission))return "再配布許可の根拠URLはhttps://にしてください。";
  const imagePermission=String(input.imagePermissionUrl||"").trim();
  if(imagePermission&&!isHttps(imagePermission))return "画像利用許可の根拠URLはhttps://にしてください。";
  return null;
}
async function readJson(request) {
  const length = Number(request.headers.get("Content-Length") || 0);
  if (length > 20000) throw new Error("送信データが大きすぎます。");
  return await request.json();
}
async function loginAllowed(env, request) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const digest = await hmac(env.SESSION_SECRET || "missing-session-secret", "resource-pack-login-ip:" + ip);
  const key = b64url(digest.slice(0,18));
  const now = Math.floor(Date.now()/1000);
  const row = await env.DB.prepare(
    "INSERT INTO resource_pack_login_attempts (ip_hash, attempts, window_started) VALUES (?, 1, ?) " +
    "ON CONFLICT(ip_hash) DO UPDATE SET " +
    "attempts = CASE WHEN window_started < ? THEN 1 ELSE attempts + 1 END, " +
    "window_started = CASE WHEN window_started < ? THEN ? ELSE window_started END " +
    "RETURNING attempts"
  ).bind(key,now,now-900,now-900,now).first();
  return Number(row?.attempts || 0) <= 5;
}
async function resetLoginAttempts(env, request) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const digest = await hmac(env.SESSION_SECRET || "missing-session-secret", "resource-pack-login-ip:" + ip);
  const key = b64url(digest.slice(0,18));
  await env.DB.prepare("DELETE FROM resource_pack_login_attempts WHERE ip_hash = ?").bind(key).run();
}
function extractPostImages(post) {
  const urls=[];
  const featured=post._embedded?.["wp:featuredmedia"]?.[0]?.source_url;
  if(featured)urls.push(featured);
  const html=String(post.content?.rendered||"");
  for(const match of html.matchAll(/(?:src|data-src)=["']([^"']+)["']/gi))urls.push(match[1].replace(/&amp;/g,"&"));
  return [...new Set(urls.map(raw=>{try{const u=new URL(raw);return u.protocol==="https:"&&(u.hostname==="mcpedl.com"||u.hostname.endsWith(".mcpedl.com"))?u.href:"";}catch{return "";}}).filter(Boolean))].slice(0,20);
}
async function fetchMcpedlPosts() {
  const headers={"User-Agent":"KaraageChikinResourcePackDirectory/1.2 (+https://karaage-chikin.github.io/tool/)","Accept":"application/json"};
  const cr=await fetch("https://mcpedl.com/wp-json/wp/v2/categories?slug=texture-packs",{headers,signal:AbortSignal.timeout(12000)});
  if(!cr.ok)throw new Error("MCPEDLカテゴリを取得できませんでした（HTTP "+cr.status+"）。");
  const cats=await cr.json();
  if(!Array.isArray(cats)||!cats[0]?.id)throw new Error("MCPEDLのTexture Packsカテゴリが見つかりません。");
  const posts=[];
  for(let page=1;page<=10;page++){
    const url="https://mcpedl.com/wp-json/wp/v2/posts?categories="+cats[0].id+"&per_page=100&page="+page+"&orderby=date&order=desc&_embed=author,wp:featuredmedia";
    const response=await fetch(url,{headers,signal:AbortSignal.timeout(15000)});
    if(response.status===400&&page>1)break;
    if(!response.ok)throw new Error("MCPEDL投稿一覧を取得できませんでした（HTTP "+response.status+" / page "+page+"）。");
    const batch=await response.json();
    if(!Array.isArray(batch))throw new Error("MCPEDLの応答形式が不正です。");
    posts.push(...batch);
    const totalPages=Number(response.headers.get("X-WP-TotalPages")||0);
    if(!batch.length||(totalPages&&page>=totalPages))break;
  }
  return posts;
}
function decodeHtml(value) {
  return String(value||"")
    .replace(/&amp;/gi,"&").replace(/&#038;/g,"&").replace(/&quot;/gi,'"')
    .replace(/&apos;/gi,"'").replace(/&#39;|&#x27;/gi,"'")
    .replace(/&lt;/gi,"<").replace(/&gt;/gi,">").replace(/&nbsp;/gi," ")
    .replace(/&#(\d+);/g,(_,n)=>{const cp=Number(n);return cp>0&&cp<=0x10ffff?String.fromCodePoint(cp):_;})
    .replace(/&#x([0-9a-f]+);/gi,(_,n)=>{const cp=parseInt(n,16);return cp>0&&cp<=0x10ffff?String.fromCodePoint(cp):_;});
}
function extractPageImages(html) {
  const found=[];
  const metaRe=/<meta\b[^>]*(?:property|name)=["'](?:og:image|twitter:image|twitter:image:src)["'][^>]*>/gi;
  for(const match of html.matchAll(metaRe)){
    const content=match[0].match(/content=["']([^"']+)["']/i);
    if(content)found.push(decodeHtml(content[1]));
  }
  const imgRe=/<img\b[^>]*>/gi;
  for(const match of html.matchAll(imgRe)){
    const tag=match[0];
    const src=tag.match(/\b(?:data-src|data-lazy-src|data-original|src)=["']([^"']+)["']/i);
    if(src)found.push(decodeHtml(src[1]));
    const srcset=tag.match(/srcset=["']([^"']+)["']/i);
    if(srcset){
      const candidates=srcset[1].split(",").map(part=>{
        const bits=part.trim().split(/\s+/),descriptor=bits[1]||"1x";
        return {url:bits[0],amount:parseFloat(descriptor)||1};
      }).filter(item=>item.url);
      candidates.sort((a,b)=>b.amount-a.amount);
      if(candidates[0])found.push(decodeHtml(candidates[0].url));
    }
  }
  return [...new Set(found.map(raw=>{
    try{const u=new URL(raw);if(u.protocol!=="https:"||!u.hostname.includes(".")||u.hostname==="localhost"||u.hostname.endsWith(".local")||/\.(svg)(?:$|\?)/i.test(u.pathname))return "";return u.href;}
    catch{return "";}
  }).filter(Boolean))].slice(0,20);
}
async function enrichMcpedlImages(env, offset=0, limit=20) {
  const rows=await env.DB.prepare("SELECT id,source_url FROM resource_packs WHERE thumbnail_url='' OR thumbnail_url IS NULL OR gallery_json='[]' OR gallery_json IS NULL ORDER BY id LIMIT ? OFFSET ?").bind(limit,offset).all();
  const targets=rows.results||[];let updated=0,failed=0,found=0;
  for(let i=0;i<targets.length;i+=6){
    const batch=targets.slice(i,i+6);
    const results=await Promise.all(batch.map(async row=>{
      try{
        const u=new URL(row.source_url);
        if(u.protocol!=="https:"||u.hostname!=="mcpedl.com")return {id:row.id,images:[]};
        const response=await fetch(u.href,{headers:{"User-Agent":"Mozilla/5.0 (compatible; ResourcePackImageIndexer/1.0)","Accept":"text/html,application/xhtml+xml"},signal:AbortSignal.timeout(12000)});
        if(!response.ok)return {id:row.id,images:[]};
        const html=await response.text();
        if(html.length>4000000)return {id:row.id,images:[]};
        return {id:row.id,images:extractPageImages(html)};
      }catch{return {id:row.id,images:[]};}
    }));
    for(const item of results){
      if(!item.images.length){failed++;continue;}
      const prior=await env.DB.prepare("SELECT thumbnail_url,gallery_json FROM resource_packs WHERE id=?").bind(item.id).first();
      let existing=[];try{existing=JSON.parse(prior?.gallery_json||"[]");}catch{}
      const images=[...new Set([...(existing||[]),...item.images])].slice(0,20);
      const thumb=prior?.thumbnail_url||images[0];
      await env.DB.prepare("UPDATE resource_packs SET thumbnail_url=?,gallery_json=?,updated_at=? WHERE id=?")
        .bind(thumb,JSON.stringify(images),Date.now(),item.id).run();
      updated++;found+=images.length;
    }
  }
  return {offset,scanned:targets.length,updated,imagesFound:found,withoutImages:failed};
}
async function discoverMcpedl(env, posts=null) {
  posts=posts||await fetchMcpedlPosts();let added=0,skipped=0;
  for(const p of posts){
    const link=String(p.link||"");let valid=false;try{valid=new URL(link).hostname==="mcpedl.com";}catch{}
    const clean=s=>String(s||"").replace(/<[^>]*>/g," ").replace(/&amp;/g,"&").replace(/&#8217;|&#8216;/g,"'").replace(/&quot;/g,'"').replace(/&nbsp;/g," ").replace(/\s+/g," ").trim();
    const title=clean(p.title?.rendered),description=clean(p.excerpt?.rendered).slice(0,1000),author=String(p._embedded?.author?.[0]?.name||"").slice(0,120),images=extractPostImages(p);
    if(!valid||!title||!description){skipped++;continue;}
    const published=await env.DB.prepare("SELECT id FROM resource_packs WHERE source_url=? LIMIT 1").bind(link).first();
    if(published){skipped++;continue;}
    const r=await env.DB.prepare("INSERT OR IGNORE INTO resource_pack_candidates (id,title,author,description,source_url,provider,discovered_at,status,thumbnail_url,gallery_json) VALUES (?,?,?,?,?,?,?,'pending',?,?)")
      .bind(crypto.randomUUID(),title,author,description,link,"MCPEDL",Date.now(),images[0]||"",JSON.stringify(images)).run();
    if(Number(r?.meta?.changes||0)===1)added++;else skipped++;
  }
  return {added,skipped,scanned:posts.length,provider:"MCPEDL"};
}
function normalizeCandidate(r){return {id:r.id,title:r.title,author:r.author,description:r.description,sourceUrl:r.source_url,provider:r.provider,discoveredAt:r.discovered_at,thumbnailUrl:r.thumbnail_url||"",galleryImages:galleryFromJson(r.gallery_json)};}

async function ensureAdminLogTables(env) {
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS resource_pack_admin_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at INTEGER NOT NULL, type TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', ip_hash TEXT NOT NULL DEFAULT '', user_agent TEXT NOT NULL DEFAULT '')").run();
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS resource_pack_daily_access (day TEXT PRIMARY KEY, route TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0)").run();
}
async function auditEvent(env, request, type, action, detail="") {
  try {
    await ensureAdminLogTables(env);
    const ip=request.headers.get("CF-Connecting-IP")||"unknown";
    const digest=await crypto.subtle.digest("SHA-256",encoder.encode(ip+":admin-audit-v1"));
    const ipHash=b64url(new Uint8Array(digest).slice(0,12));
    const ua=String(request.headers.get("User-Agent")||"").slice(0,120);
    await env.DB.prepare("INSERT INTO resource_pack_admin_logs (created_at,type,action,detail,ip_hash,user_agent) VALUES (?,?,?,?,?,?)")
      .bind(Date.now(),type,action,String(detail).slice(0,500),ipHash,ua).run();
  } catch(error) { console.warn("Admin audit log write failed",String(error?.message||error)); }
}
async function recordPublicAccess(env, route) {
  try {
    await ensureAdminLogTables(env);
    const day=new Date(Date.now()+9*60*60*1000).toISOString().slice(0,10);
    await env.DB.prepare("INSERT INTO resource_pack_daily_access (day,route,count) VALUES (?,?,1) ON CONFLICT(day) DO UPDATE SET count=count+1")
      .bind(day,route).run();
  } catch(error) { console.warn("Public access counter failed",String(error?.message||error)); }
}


const SUPABASE_STORAGE_URL = "https://dvtjubxgmmmpemibefne.supabase.co";
const PACK_STORAGE_LIMIT = 700 * 1024 * 1024;

function isSafePublicDownloadUrl(value) {
  try {
    const u=new URL(value);
    const host=u.hostname.toLowerCase();
    const ipv4Parts=host.split(".");
    const isIpv4=ipv4Parts.length===4&&ipv4Parts.every(part=>part.length>0&&[...part].every(c=>c>="0"&&c<="9"));
    if(u.protocol!=="https:"||u.username||u.password||!host.includes("."))return false;
    if(host==="localhost"||host.endsWith(".localhost")||host.endsWith(".local")||host.endsWith(".internal")||host.endsWith(".test")||host.endsWith(".invalid")||host==="metadata.google.internal")return false;
    if(host.startsWith("[")||isIpv4)return false;
    return true;
  } catch { return false; }
}
async function fetchPublicDownload(startUrl) {
  let current=startUrl;
  for(let hop=0;hop<=5;hop++){
    if(!isSafePublicDownloadUrl(current))throw new Error("unsafe download URL or redirect");
    const response=await fetch(current,{redirect:"manual",headers:{"User-Agent":"KaraageChikinResourcePackDirectory/1.2"},signal:AbortSignal.timeout(30000)});
    if(response.status>=300&&response.status<400){
      const location=response.headers.get("Location");
      if(!location||hop===5)throw new Error("download redirect limit exceeded");
      current=new URL(location,current).href;
      continue;
    }
    return response;
  }
  throw new Error("download redirect limit exceeded");
}


async function ensureDeletedTable(env){
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS resource_pack_deleted (id TEXT PRIMARY KEY,title TEXT NOT NULL,snapshot_json TEXT NOT NULL,deleted_at INTEGER NOT NULL,restored_at INTEGER)").run();
}
async function processPackImages(env,limit=10,offset=0){
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS resource_pack_image_assets (id TEXT PRIMARY KEY,source_url TEXT NOT NULL UNIQUE,storage_path TEXT NOT NULL DEFAULT '',storage_url TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'pending',http_status INTEGER NOT NULL DEFAULT 0,checked_at INTEGER NOT NULL DEFAULT 0,permission_url TEXT NOT NULL DEFAULT '',error TEXT NOT NULL DEFAULT '')").run();
 const q=await env.DB.prepare("SELECT id,title,thumbnail_url,gallery_json,image_permission_url FROM resource_packs WHERE thumbnail_url!='' OR gallery_json!='[]' ORDER BY id LIMIT ? OFFSET ?").bind(Math.min(20,Math.max(1,limit)),Math.max(0,Math.min(1000000,offset))).all();
 const total={packs:(q.results||[]).length,checked:0,stored:0,broken:0,skipped:0};
 for(const row of q.results||[]){
  const urls=[...new Set([row.thumbnail_url,...galleryFromJson(row.gallery_json)].filter(Boolean))].slice(0,20),mapped=new Map();
  for(const sourceUrl of urls){
   const old=await env.DB.prepare("SELECT storage_url,status FROM resource_pack_image_assets WHERE source_url=?").bind(sourceUrl).first();
   if(old?.storage_url){mapped.set(sourceUrl,old.storage_url);continue;}
   try{
    const response=await fetchPublicDownload(sourceUrl),type=(response.headers.get("Content-Type")||"").split(";")[0].toLowerCase(),len=Number(response.headers.get("Content-Length")||0);
    if(!response.ok||!["image/jpeg","image/png","image/webp","image/gif"].includes(type)||len>5*1024*1024){
     const status=response.status||0;try{await response.body?.cancel();}catch{}
     await env.DB.prepare("INSERT INTO resource_pack_image_assets (id,source_url,status,http_status,checked_at,error) VALUES (?,?,?, ?,?,?) ON CONFLICT(source_url) DO UPDATE SET status=excluded.status,http_status=excluded.http_status,checked_at=excluded.checked_at,error=excluded.error")
      .bind(crypto.randomUUID(),sourceUrl,response.ok?"unsupported":"broken",status,Date.now(),"画像形式・サイズ・HTTP応答を確認してください").run();
     total.checked++;if(!response.ok)total.broken++;else total.skipped++;continue;
    }
    if(!row.image_permission_url){
     try{await response.body?.cancel();}catch{}
     await env.DB.prepare("INSERT INTO resource_pack_image_assets (id,source_url,status,http_status,checked_at,error) VALUES (?,?, 'reachable', ?,?,'画像の保存許可URLが未登録のため外部参照') ON CONFLICT(source_url) DO UPDATE SET status='reachable',http_status=excluded.http_status,checked_at=excluded.checked_at,error=excluded.error")
      .bind(crypto.randomUUID(),sourceUrl,response.status,Date.now()).run();
     total.checked++;total.skipped++;continue;
    }
    const bytes=await response.arrayBuffer();if(bytes.byteLength>5*1024*1024)throw new Error("画像が5MBを超えています");
    const ext=type==="image/jpeg"?"jpg":type.split("/")[1],path="images/"+crypto.randomUUID()+"."+ext,key=env.SUPABASE_SERVICE_ROLE_KEY;
    const upload=await fetch(SUPABASE_STORAGE_URL+"/storage/v1/object/resource-pack-images/"+path,{method:"POST",headers:{"apikey":key,"Authorization":"Bearer "+key,"Content-Type":type,"x-upsert":"false","cache-control":"31536000"},body:bytes});
    if(!upload.ok)throw new Error("Supabase Storage HTTP "+upload.status);
    const publicUrl=SUPABASE_STORAGE_URL+"/storage/v1/object/public/resource-pack-images/"+path;
    await env.DB.prepare("INSERT INTO resource_pack_image_assets (id,source_url,storage_path,storage_url,status,http_status,checked_at,permission_url,error) VALUES (?,?,?,?, 'stored',?,?,?,'') ON CONFLICT(source_url) DO UPDATE SET storage_path=excluded.storage_path,storage_url=excluded.storage_url,status='stored',http_status=excluded.http_status,checked_at=excluded.checked_at,permission_url=excluded.permission_url,error=''")
     .bind(crypto.randomUUID(),sourceUrl,path,publicUrl,response.status,Date.now(),row.image_permission_url).run();
    mapped.set(sourceUrl,publicUrl);total.checked++;total.stored++;
   }catch(error){
    await env.DB.prepare("INSERT INTO resource_pack_image_assets (id,source_url,status,http_status,checked_at,error) VALUES (?,?, 'broken',0,?,?) ON CONFLICT(source_url) DO UPDATE SET status='broken',http_status=0,checked_at=excluded.checked_at,error=excluded.error")
     .bind(crypto.randomUUID(),sourceUrl,Date.now(),String(error?.message||error).slice(0,250)).run().catch(()=>{});
    total.checked++;total.broken++;
   }
  }
  if(mapped.size){
   const thumb=mapped.get(row.thumbnail_url)||row.thumbnail_url,gallery=galleryFromJson(row.gallery_json).map(u=>mapped.get(u)||u);
   await env.DB.prepare("UPDATE resource_packs SET thumbnail_url=?,gallery_json=?,updated_at=? WHERE id=?").bind(thumb,JSON.stringify(gallery),Date.now(),row.id).run();
  }
 }
 return total;
}

async function uploadPackToSupabase(env, request, origin) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    return reply({ error: "Supabaseのアップロード用シークレット SUPABASE_SERVICE_ROLE_KEY が未設定です。Cloudflare WorkerのSecretsに追加してください。" }, 503, origin);
  }
  const length = Number(request.headers.get("Content-Length") || 0);
  if (length > 52 * 1024 * 1024) return reply({ error: "アップロード上限は50MBです。" }, 413, origin);
  let reserved = false, uploaded = false, fileSize = 0;
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!file || typeof file.arrayBuffer !== "function") return reply({ error: "アップロードするファイルを選択してください。" }, 400, origin);
    fileSize = Number(file.size || 0);
    if (!fileSize || fileSize > 50 * 1024 * 1024) return reply({ error: "ファイルは1バイト以上、50MB以下にしてください。" }, 413, origin);
    const permissionUrl=String(form.get("permissionUrl")||"").trim();
    let permissionValid=false;try{const pu=new URL(permissionUrl);permissionValid=pu.protocol==="https:"&&pu.hostname.includes(".");}catch{}
    if(!permissionValid)return reply({error:"再配布許可の根拠URLを入力してください。"},400,origin);
    const originalName = String(file.name || "resource-pack.mcpack").normalize("NFKC");
    if (!/\.(mcpack|mcaddon|zip)$/i.test(originalName)) return reply({ error: "対応形式は .mcpack / .mcaddon / .zip です。" }, 415, origin);
    const safeName = originalName.replace(/[^\p{L}\p{N}._ -]/gu, "_").replace(/\s+/g, "_").replace(/^\.+/, "").slice(0, 100) || "resource-pack.mcpack";
    const bytes = await file.arrayBuffer();
    const head = new Uint8Array(bytes.slice(0, 4));
    if (head[0] !== 0x50 || head[1] !== 0x4b || ![0x03,0x05,0x07].includes(head[2])) {
      return reply({ error: "ZIP形式のMinecraftパックとして認識できませんでした。ファイルの中身を確認してください。" }, 415, origin);
    }
    await env.DB.prepare("CREATE TABLE IF NOT EXISTS resource_pack_storage_usage (id INTEGER PRIMARY KEY CHECK(id=1), used_bytes INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL)").run();
    await env.DB.prepare("CREATE TABLE IF NOT EXISTS resource_pack_storage_files (id TEXT PRIMARY KEY, storage_path TEXT NOT NULL UNIQUE, file_name TEXT NOT NULL, size_bytes INTEGER NOT NULL, public_url TEXT NOT NULL, created_at INTEGER NOT NULL, permission_url TEXT NOT NULL DEFAULT '')").run();
    await env.DB.prepare("INSERT OR IGNORE INTO resource_pack_storage_usage (id,used_bytes,updated_at) VALUES (1,0,?)").bind(Date.now()).run();
    const reserve = await env.DB.prepare("UPDATE resource_pack_storage_usage SET used_bytes=used_bytes+?,updated_at=? WHERE id=1 AND used_bytes+?<=?").bind(fileSize,Date.now(),fileSize,PACK_STORAGE_LIMIT).run();
    if (Number(reserve?.meta?.changes || 0) !== 1) {
      const current = await env.DB.prepare("SELECT used_bytes FROM resource_pack_storage_usage WHERE id=1").first();
      return reply({ error: "サイト内保存の安全容量に達したため、新しいファイルは保存できません。配布元リンクを利用してください。", usedBytes: Number(current?.used_bytes || 0), limitBytes: PACK_STORAGE_LIMIT }, 507, origin);
    }
    reserved = true;
    const storagePath = "packs/" + crypto.randomUUID() + "/" + safeName;
    const encodedPath = storagePath.split("/").map(encodeURIComponent).join("/");
    const key = env.SUPABASE_SERVICE_ROLE_KEY;
    const upstream = await fetch(SUPABASE_STORAGE_URL + "/storage/v1/object/resource-pack-files/" + encodedPath, {
      method: "POST",
      headers: { "apikey": key, "Authorization": "Bearer " + key, "Content-Type": "application/octet-stream", "x-upsert": "false", "cache-control": "31536000" },
      body: bytes
    });
    if (!upstream.ok) {
      const message = await upstream.text().catch(() => "");
      await env.DB.prepare("UPDATE resource_pack_storage_usage SET used_bytes=MAX(0,used_bytes-?),updated_at=? WHERE id=1").bind(fileSize,Date.now()).run();
      reserved = false;
      console.error("Supabase Storage upload rejected", upstream.status, message.slice(0,300));
      return reply({ error: "Supabaseへの保存に失敗しました（HTTP " + upstream.status + "）。容量・ファイル形式・接続設定を確認してください。" }, 502, origin);
    }
    uploaded = true;
    const publicUrl = SUPABASE_STORAGE_URL + "/storage/v1/object/public/resource-pack-files/" + encodedPath;
    try {
      await env.DB.prepare("INSERT INTO resource_pack_storage_files (id,storage_path,file_name,size_bytes,public_url,created_at,permission_url) VALUES (?,?,?,?,?,?,?)")
        .bind(crypto.randomUUID(),storagePath,safeName,fileSize,publicUrl,Date.now(),permissionUrl).run();
    } catch (metadataError) {
      const removed=await fetch(SUPABASE_STORAGE_URL+"/storage/v1/object/resource-pack-files/"+encodedPath,{method:"DELETE",headers:{"apikey":key,"Authorization":"Bearer "+key}}).then(r=>r.ok).catch(()=>false);
      if(removed){await env.DB.prepare("UPDATE resource_pack_storage_usage SET used_bytes=MAX(0,used_bytes-?),updated_at=? WHERE id=1").bind(fileSize,Date.now()).run().catch(()=>{});reserved=false;uploaded=false;}
      throw metadataError;
    }
    const usage = await env.DB.prepare("SELECT used_bytes FROM resource_pack_storage_usage WHERE id=1").first();
    return reply({ ok: true, fileName: safeName, size: fileSize, publicUrl, usedBytes: Number(usage?.used_bytes || 0), limitBytes: PACK_STORAGE_LIMIT }, 200, origin);
  } catch (error) {
    if (reserved && !uploaded) {
      await env.DB.prepare("UPDATE resource_pack_storage_usage SET used_bytes=MAX(0,used_bytes-?),updated_at=? WHERE id=1").bind(fileSize,Date.now()).run().catch(()=>{});
    }
    console.error("Supabase pack upload failed", error);
    return reply({ error: "ファイル保存中にエラーが発生しました。既存ファイルは削除していません。" }, 500, origin);
  }
}

export default {
  async scheduled(controller, env, ctx) { ctx.waitUntil((async()=>{await ensureAdminLogTables(env);await auditEvent(env,{headers:new Headers()},"update","scheduled_started","定期更新を開始");try{const images=await enrichMcpedlImages(env,0,20);const posts=await fetchMcpedlPosts();const discovery=await discoverMcpedl(env,posts);await auditEvent(env,{headers:new Headers()},"update","scheduled_completed",JSON.stringify({images,discovery}).slice(0,450));}catch(e){await auditEvent(env,{headers:new Headers()},"debug","scheduled_failed",String(e?.message||e));console.error("Scheduled discovery/image refresh failed",e);}})()); },
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin") || "";
    if (request.method === "OPTIONS") {
      if (origin !== ORIGIN) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: cors(origin) });
    }
    const url = new URL(request.url);
    const publicPackRead = request.method === "GET" && url.pathname === "/api/packs" && (origin === "" || origin === ORIGIN);
    if (origin !== ORIGIN && !publicPackRead) return new Response("Forbidden", { status: 403, headers: { "X-Content-Type-Options": "nosniff" } });
    if (request.method === "GET" && url.pathname === "/api/health") {
      try {
        await env.DB.prepare("SELECT 1 AS ok").first();
        return reply({ ok: true }, 200, origin);
      } catch { return reply({ ok: false }, 503, origin); }
    }
    if (request.method === "GET" && url.pathname === "/api/packs") {
      await recordPublicAccess(env,"/api/packs");
      try {
        await env.DB.prepare("INSERT OR IGNORE INTO resource_pack_image_jobs (id,status) VALUES (1,'idle')").run();
        const now=Date.now();
        const claim=await env.DB.prepare("UPDATE resource_pack_image_jobs SET status='running',started_at=?,finished_at=NULL,result_json=NULL WHERE id=1 AND status!='running' AND (finished_at IS NULL OR finished_at<?)")
          .bind(now,now-21600000).run();
        if(Number(claim?.meta?.changes||0)===1){
          ctx.waitUntil((async()=>{
            try{
              const result=await enrichMcpedlImages(env,0,100);
              await env.DB.prepare("UPDATE resource_pack_image_jobs SET status='done',finished_at=?,result_json=? WHERE id=1")
                .bind(Date.now(),JSON.stringify(result)).run();
              console.log("Automatic gallery image import completed",result);
            }catch(error){
              await env.DB.prepare("UPDATE resource_pack_image_jobs SET status='failed',finished_at=?,result_json=? WHERE id=1")
                .bind(Date.now(),JSON.stringify({error:String(error?.message||error)})).run();
              console.error("Automatic gallery image import failed",error);
            }
          })());
        }
        const result = await env.DB.prepare(
          "SELECT id,title,author,category,description,source_url,compatibility,source,created_at,thumbnail_url,gallery_json,direct_download_url,direct_download_allowed FROM resource_packs ORDER BY created_at DESC, title COLLATE NOCASE"
        ).all();
        return reply({ packs: (result.results || []).map(normalize), imageImportStarted:Number(claim?.meta?.changes||0)===1 }, 200, origin);
      } catch (error) {
        console.error("Pack listing failed", error);
        return reply({ error: "一覧を読み込めませんでした。" }, 503, origin);
      }
    }
    const downloadMatch=url.pathname.match(/^\/api\/download\/([A-Za-z0-9_-]{1,80})$/);
    if(downloadMatch&&request.method==="GET"){
      try{
        const row=await env.DB.prepare("SELECT title,direct_download_url,direct_download_allowed FROM resource_packs WHERE id=?").bind(downloadMatch[1]).first();
        if(!row||Number(row.direct_download_allowed)!==1||!row.direct_download_url)return reply({error:"このパックはサイト内ダウンロードに対応していません。公式配布ページを利用してください。"},404,origin);
        const target=new URL(row.direct_download_url);
        if(!isSafePublicDownloadUrl(target.href))return reply({error:"安全でないダウンロード先です。"},400,origin);
        const upstream=await fetchPublicDownload(target.href);
        if(!upstream.ok||!upstream.body)return reply({error:"配布ファイルを取得できませんでした（HTTP "+upstream.status+"）。"},502,origin);
        const type=(upstream.headers.get("Content-Type")||"application/octet-stream").split(";")[0].toLowerCase();
        if(type.startsWith("text/")||type==="application/json"||type==="application/xhtml+xml")return reply({error:"配布元がファイルではなくWebページを返しました。"},415,origin);
        const length=Number(upstream.headers.get("Content-Length")||0);
        if(length>104857600)return reply({error:"ファイルが大きすぎます（上限100MB）。"},413,origin);
        let filename="resource-pack.mcpack";
        try{filename=decodeURIComponent(target.pathname.split("/").pop()||filename);}catch{}
        filename=filename.split('"').join("_").split("\\").join("_").split(String.fromCharCode(10)).join("_").slice(0,120)||"resource-pack.mcpack";
        let downloaded=0;const stream=upstream.body.pipeThrough(new TransformStream({transform(chunk,controller){downloaded+=chunk.byteLength;if(downloaded>104857600)throw new Error("download exceeds 100MB");controller.enqueue(chunk);}}));
        return new Response(stream,{status:200,headers:{"Content-Type":"application/octet-stream","Content-Disposition":"attachment; filename*=UTF-8''"+encodeURIComponent(filename),"Cache-Control":"no-store",...cors(origin)}});
      }catch(error){console.error("Pack download failed",error);return reply({error:"ダウンロードに失敗しました。配布元ページから取得してください。"},502,origin);}
    }
    if (request.method === "POST" && url.pathname === "/api/admin/login") {
      if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET) return reply({ error: "管理者認証がまだ設定されていません。管理者用シークレットを設定してください。" }, 503, origin);
      try {
        if (!(await loginAllowed(env, request))) return reply({ error: "ログイン試行回数の上限です。15分ほど待ってください。" }, 429, origin, { "Retry-After": "900" });
        const body = await readJson(request);
        const supplied = String(body.password || "");
        const a = await crypto.subtle.digest("SHA-256", encoder.encode(supplied));
        const b = await crypto.subtle.digest("SHA-256", encoder.encode(env.ADMIN_PASSWORD));
        const aa = new Uint8Array(a), bb = new Uint8Array(b);
        let diff = aa.length ^ bb.length;
        for (let i=0;i<Math.min(aa.length,bb.length);i++) diff |= aa[i] ^ bb[i];
        if (diff !== 0) { await auditEvent(env,request,"access","login_failed","パスワード不一致"); return reply({ error: "パスワードが違います。" }, 401, origin); }
        await resetLoginAttempts(env, request);
        await auditEvent(env,request,"access","login_success","管理者ログイン成功");
        return reply({ token: await makeToken(env.SESSION_SECRET), expiresIn: SESSION_MS }, 200, origin);
      } catch (error) {
        return reply({ error: error.message || "ログインできませんでした。" }, 400, origin);
      }
    }
    if (url.pathname.startsWith("/api/admin/")) {
      if (!env.SESSION_SECRET || !(await isAdmin(request, env.SESSION_SECRET))) return reply({ error: "管理者としてログインしてください。" }, 401, origin);
      await auditEvent(env,request,request.method==="GET"?"access":"update","admin_"+request.method.toLowerCase(),url.pathname);
      if (request.method === "POST" && url.pathname === "/api/admin/storage/upload") {
        return await uploadPackToSupabase(env, request, origin);
      }
      if (request.method === "GET" && url.pathname === "/api/admin/session") return reply({ ok: true }, 200, origin);
      if (request.method === "GET" && url.pathname === "/api/admin/monitor/overview") {
        await ensureAdminLogTables(env);
        const packs=await env.DB.prepare("SELECT COUNT(*) AS count, COALESCE(SUM(LENGTH(title)+LENGTH(author)+LENGTH(description)+LENGTH(source_url)+LENGTH(thumbnail_url)+LENGTH(gallery_json)),0) AS approx_bytes FROM resource_packs").first();
        const candidates=await env.DB.prepare("SELECT COUNT(*) AS count FROM resource_pack_candidates").first();
        const logs=await env.DB.prepare("SELECT COUNT(*) AS count FROM resource_pack_admin_logs").first();
        const access=await env.DB.prepare("SELECT COALESCE(SUM(count),0) AS count FROM resource_pack_daily_access").first();
        const imageJob=await env.DB.prepare("SELECT status,started_at,finished_at,result_json FROM resource_pack_image_jobs WHERE id=1").first();
        const dbMeta=await env.DB.prepare("SELECT COUNT(*) AS tables FROM sqlite_master WHERE type='table'").first();
        return reply({packs,candidates,logs,access,imageJob,dbMeta,checkedAt:Date.now()},200,origin);
      }
      if (request.method === "GET" && url.pathname === "/api/admin/monitor/storage") {
        await env.DB.prepare("CREATE TABLE IF NOT EXISTS resource_pack_storage_usage (id INTEGER PRIMARY KEY CHECK(id=1), used_bytes INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL)").run();
        await env.DB.prepare("CREATE TABLE IF NOT EXISTS resource_pack_storage_files (id TEXT PRIMARY KEY, storage_path TEXT NOT NULL UNIQUE, file_name TEXT NOT NULL, size_bytes INTEGER NOT NULL, public_url TEXT NOT NULL, created_at INTEGER NOT NULL, permission_url TEXT NOT NULL DEFAULT '')").run();
        await env.DB.prepare("INSERT OR IGNORE INTO resource_pack_storage_usage (id,used_bytes,updated_at) VALUES (1,0,?)").bind(Date.now()).run();
        const dbProbe = await env.DB.prepare("SELECT COUNT(*) AS tables FROM sqlite_master WHERE type='table'").all();
        const dbUsedBytes = Number(dbProbe?.meta?.size_after || 0);
        const uploadUsage = await env.DB.prepare("SELECT used_bytes,updated_at FROM resource_pack_storage_usage WHERE id=1").first();
        const packFiles = await env.DB.prepare("SELECT COUNT(*) AS count,COALESCE(SUM(size_bytes),0) AS used_bytes FROM resource_pack_storage_files").first();
        let supabase = { available:false, usedBytes:null, buckets:[], error:"Supabaseの実使用量を取得できませんでした。" };
        if (env.SUPABASE_SERVICE_ROLE_KEY) {
          try {
            const response = await fetch(SUPABASE_STORAGE_URL + "/rest/v1/rpc/resource_pack_storage_usage", {
              method:"POST",
              headers: {
                "apikey": env.SUPABASE_SERVICE_ROLE_KEY,
                "Authorization": "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY,
                "Content-Type":"application/json"
              },
              body:"{}",
              signal: AbortSignal.timeout(10000)
            });
            if (!response.ok) throw new Error("Storage usage RPC HTTP " + response.status);
            const objects = await response.json();
            if (!Array.isArray(objects)) throw new Error("Storage usage response is invalid");
            const bucketMap = new Map([
              ["resource-pack-images",{id:"resource-pack-images",count:0,usedBytes:0,maxFileBytes:5*1024*1024}],
              ["resource-pack-files",{id:"resource-pack-files",count:0,usedBytes:0,maxFileBytes:50*1024*1024}]
            ]);
            for (const object of objects) {
              const bucket = bucketMap.get(object.bucket_id);
              if (!bucket) continue;
              bucket.count = Number(object.object_count || 0);
              bucket.usedBytes = Number(object.used_bytes || 0);
            }
            const buckets = [...bucketMap.values()];
            supabase = { available:true, usedBytes:buckets.reduce((sum,b)=>sum+b.usedBytes,0), buckets, checkedAt:Date.now() };
          } catch (error) {
            supabase.error = String(error?.message || error).slice(0,180);
          }
        } else {
          supabase.error = "Storage API用シークレットが未設定です。";
        }
        let github = { available:false, sizeBytes:null, error:"GitHub情報を取得できませんでした。" };
        let expansion = { available:false, status:"unknown", conclusion:null, url:"", createdAt:null };
        let expansionProgress = { available:false, error:"進捗データはまだありません。" };
        try {
          const response = await fetch("https://api.github.com/repos/karaage-chikin/tool", {
            headers:{"Accept":"application/vnd.github+json","User-Agent":"KaraageChikinAdminDashboard/1.0",...(env.GITHUB_ACTIONS_TOKEN?{"Authorization":"Bearer "+env.GITHUB_ACTIONS_TOKEN}:{})},
            signal:AbortSignal.timeout(8000)
          });
          if (!response.ok) throw new Error("GitHub repository API HTTP " + response.status);
          const data = await response.json();
          github = { available:true, sizeBytes:Number(data.size || 0)*1024, checkedAt:Date.now() };
        } catch (error) {
          github.error = String(error?.message || error).slice(0,180);
        }
        try {
          const response = await fetch("https://api.github.com/repos/karaage-chikin/tool/actions/workflows/resource-packs-expanded.yml/runs?per_page=10", {
            headers:{"Accept":"application/vnd.github+json","User-Agent":"KaraageChikinAdminDashboard/1.0",...(env.GITHUB_ACTIONS_TOKEN?{"Authorization":"Bearer "+env.GITHUB_ACTIONS_TOKEN}:{})},
            signal:AbortSignal.timeout(8000)
          });
          if (!response.ok) throw new Error("GitHub Actions API HTTP " + response.status);
          const data = await response.json();
          const runs = Array.isArray(data.workflow_runs) ? data.workflow_runs : [];
          const run = runs[0];
          const activeRuns = runs.filter(item => ["pending","queued","in_progress"].includes(item.status))
            .map(item => ({status:item.status,runNumber:item.run_number||null,url:item.html_url||"",createdAt:item.created_at||null}))
            .slice(0,5);
          if (run) expansion = {available:true,status:run.status||"unknown",conclusion:run.conclusion||null,url:run.html_url||"",createdAt:run.created_at||null,runNumber:run.run_number||null,activeRuns};
          else expansion = {available:true,status:"not_started",conclusion:null,url:"",createdAt:null,activeRuns:[]};
        } catch (error) {
          expansion.error = String(error?.message || error).slice(0,180);
        }
        try {
          const progressResponse = await fetch("https://raw.githubusercontent.com/karaage-chikin/tool/main/resource-pack-progress.json", { headers:{"Accept":"application/json"}, cache:"no-store", signal:AbortSignal.timeout(8000) });
          if (!progressResponse.ok) throw new Error("進捗ファイル HTTP " + progressResponse.status);
          expansionProgress = { available:true, ...(await progressResponse.json()) };
        } catch (error) {
          expansionProgress = { available:false, error:String(error?.message || error).slice(0,180) };
        }
        return reply({
          d1:{available:dbUsedBytes>0,usedBytes:dbUsedBytes,databaseLimitBytes:500*1024*1024,accountFreeLimitBytes:5*1024*1024*1024,tables:Number(dbProbe?.results?.[0]?.tables||0)},
          supabase,
          packUploadGuard:{usedBytes:Number(uploadUsage?.used_bytes||0),limitBytes:PACK_STORAGE_LIMIT,files:Number(packFiles?.count||0),trackedFileBytes:Number(packFiles?.used_bytes||0),updatedAt:Number(uploadUsage?.updated_at||0)},
          github,
          expansion,
          expansionProgress,
          checkedAt:Date.now()
        },200,origin);
      }
      if (request.method === "GET" && url.pathname === "/api/admin/monitor/logs") {
        await ensureAdminLogTables(env);
        const type=String(url.searchParams.get("type")||"all");
        const limit=Math.min(100,Math.max(1,Number.parseInt(url.searchParams.get("limit")||"50",10)||50));
        const offset=Math.min(1000000,Math.max(0,Number.parseInt(url.searchParams.get("offset")||"0",10)||0));
        const allowed=["all","update","debug","access"];
        if(!allowed.includes(type))return reply({error:"ログ種別が不正です。"},400,origin);
        const count=type==="all"
          ? await env.DB.prepare("SELECT COUNT(*) AS total FROM resource_pack_admin_logs").first()
          : await env.DB.prepare("SELECT COUNT(*) AS total FROM resource_pack_admin_logs WHERE type=?").bind(type).first();
        const rows=type==="all"
          ? await env.DB.prepare("SELECT id,created_at,type,action,detail,ip_hash,user_agent FROM resource_pack_admin_logs ORDER BY id DESC LIMIT ? OFFSET ?").bind(limit,offset).all()
          : await env.DB.prepare("SELECT id,created_at,type,action,detail,ip_hash,user_agent FROM resource_pack_admin_logs WHERE type=? ORDER BY id DESC LIMIT ? OFFSET ?").bind(type,limit,offset).all();
        return reply({logs:rows.results||[],total:Number(count?.total||0),limit,offset,hasMore:offset+((rows.results||[]).length)<Number(count?.total||0)},200,origin);
      }
      if (request.method === "GET" && url.pathname === "/api/admin/monitor/access") {
        await ensureAdminLogTables(env);
        const limit=Math.min(100,Math.max(1,Number.parseInt(url.searchParams.get("limit")||"50",10)||50));
        const offset=Math.min(1000000,Math.max(0,Number.parseInt(url.searchParams.get("offset")||"0",10)||0));
        const days=await env.DB.prepare("SELECT day,route,count FROM resource_pack_daily_access ORDER BY day DESC LIMIT 90").all();
        const count=await env.DB.prepare("SELECT COUNT(*) AS total FROM resource_pack_admin_logs WHERE type='access'").first();
        const admins=await env.DB.prepare("SELECT id,created_at,action,detail,ip_hash,user_agent FROM resource_pack_admin_logs WHERE type='access' ORDER BY id DESC LIMIT ? OFFSET ?").bind(limit,offset).all();
        return reply({daily:days.results||[],admin:admins.results||[],adminTotal:Number(count?.total||0),limit,offset,hasMore:offset+((admins.results||[]).length)<Number(count?.total||0)},200,origin);
      }


      if(request.method==="GET"&&url.pathname==="/api/admin/trash"){
        await ensureDeletedTable(env);
        const rows=await env.DB.prepare("SELECT id,title,deleted_at FROM resource_pack_deleted WHERE restored_at IS NULL ORDER BY deleted_at DESC LIMIT 100").all();
        return reply({items:rows.results||[]},200,origin);
      }
      const restoreMatch=url.pathname.match(/^\/api\/admin\/trash\/([A-Za-z0-9_-]{1,80})\/restore$/);
      if(restoreMatch&&request.method==="POST"){
        await ensureDeletedTable(env);
        const item=await env.DB.prepare("SELECT * FROM resource_pack_deleted WHERE id=? AND restored_at IS NULL").bind(restoreMatch[1]).first();
        if(!item)return reply({error:"復元できる削除履歴がありません。"},404,origin);
        try{
          const p=JSON.parse(item.snapshot_json);
          await env.DB.prepare("INSERT INTO resource_packs (id,title,author,category,description,source_url,compatibility,source,created_at,updated_at,thumbnail_url,gallery_json,direct_download_url,direct_download_allowed,permission_url,permission_note,image_permission_url) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
           .bind(p.id,p.title,p.author||"",p.category||"その他",p.description,p.source_url,p.compatibility||"配布元で確認",p.source||"管理者登録",p.created_at||Date.now(),p.updated_at||Date.now(),p.thumbnail_url||"",p.gallery_json||"[]",p.direct_download_url||"",Number(p.direct_download_allowed||0),p.permission_url||"",p.permission_note||"",p.image_permission_url||"").run();
          await env.DB.prepare("UPDATE resource_pack_deleted SET restored_at=? WHERE id=?").bind(Date.now(),item.id).run();
          return reply({ok:true,id:item.id},200,origin);
        }catch(error){return reply({error:"復元できませんでした。同じ配布元URLのパックが既に存在する可能性があります。"},409,origin);}
      }
      if(request.method==="POST"&&url.pathname==="/api/admin/images/process"){
        if(!env.SUPABASE_SERVICE_ROLE_KEY)return reply({error:"画像保存用のStorageシークレットが未設定です。"},503,origin);
        try{const body=await readJson(request);return reply(await processPackImages(env,body.limit||10,body.offset||0),200,origin);}
        catch(error){console.error("Image processing failed",error);return reply({error:"画像処理に失敗しました。"},502,origin);}
      }

      if (request.method === "GET" && url.pathname === "/api/admin/candidates") {
        const r=await env.DB.prepare("SELECT id,title,author,description,source_url,provider,discovered_at,thumbnail_url,gallery_json FROM resource_pack_candidates WHERE status='pending' ORDER BY discovered_at DESC LIMIT 100").all();
        return reply({candidates:(r.results||[]).map(normalizeCandidate)},200,origin);
      }
      if(request.method==="POST"&&url.pathname==="/api/admin/enrich-images"){
        try{return reply(await enrichMcpedlImages(env),200,origin);}catch(e){console.error(e);return reply({error:e.message||"画像を取得できませんでした。"},502,origin);}
      }
      if (request.method === "POST" && url.pathname === "/api/admin/discover") {
        try{return reply(await discoverMcpedl(env),200,origin);}catch(e){console.error(e);return reply({error:e.message||"候補を取得できませんでした。"},502,origin);}
      }
      const cm=url.pathname.match(/^\/api\/admin\/candidates\/([A-Za-z0-9_-]{1,80})(?:\/approve)?$/);
      if(cm && request.method==="POST" && url.pathname.endsWith("/approve")){
        try{
          const c=await env.DB.prepare("SELECT * FROM resource_pack_candidates WHERE id=? AND status='pending'").bind(cm[1]).first();
          if(!c)return reply({error:"候補が見つかりません。"},404,origin);
          const body=await readJson(request), category=String(body.category||"その他").slice(0,60), id=crypto.randomUUID(), now=Date.now();
          await env.DB.prepare("INSERT INTO resource_packs (id,title,author,category,description,source_url,compatibility,source,created_at,updated_at,thumbnail_url,gallery_json,direct_download_url,direct_download_allowed,permission_url,permission_note,image_permission_url) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(id,c.title,c.author,category,c.description,c.source_url,"配布元で確認","MCPEDL自動発見（管理者承認）",now,now,c.thumbnail_url||"",c.gallery_json||"[]","",0,"","","").run();
          await env.DB.prepare("DELETE FROM resource_pack_candidates WHERE id=?").bind(c.id).run();
          const row=await env.DB.prepare("SELECT * FROM resource_packs WHERE id=?").bind(id).first();
          return reply({pack:normalize(row)},201,origin);
        }catch(e){console.error(e);return reply({error:"候補を公開できませんでした。"},500,origin);}
      }
      if(cm && request.method==="DELETE" && !url.pathname.endsWith("/approve")){await env.DB.prepare("DELETE FROM resource_pack_candidates WHERE id=?").bind(cm[1]).run();return reply({ok:true},200,origin);}
      if (request.method === "POST" && url.pathname === "/api/admin/packs") {
        try {
          const body = await readJson(request), invalid = validatePack(body);
          if (invalid) return reply({ error: invalid }, 400, origin);
          const id = crypto.randomUUID();
          const now = Date.now();
          await env.DB.prepare(
            "INSERT INTO resource_packs (id,title,author,category,description,source_url,compatibility,source,created_at,updated_at,thumbnail_url,gallery_json,direct_download_url,direct_download_allowed,permission_url,permission_note,image_permission_url) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
          ).bind(id,String(body.title).trim(),String(body.author||"").trim(),String(body.category||"その他"),String(body.description).trim(),String(body.sourceUrl).trim(),String(body.compatibility||"配布元で確認"),"管理者登録",now,now,String(body.thumbnailUrl||""),JSON.stringify(body.galleryImages||[]),body.directDownloadAllowed?String(body.directDownloadUrl||""):"",body.directDownloadAllowed?1:0,String(body.permissionUrl||""),String(body.permissionNote||"").slice(0,500),String(body.imagePermissionUrl||"")).run();
          const row = await env.DB.prepare("SELECT * FROM resource_packs WHERE id=?").bind(id).first();
          return reply({ pack: normalize(row) }, 201, origin);
        } catch (error) { console.error(error); return reply({ error: "登録できませんでした。" }, 500, origin); }
      }
      const match = url.pathname.match(/^\/api\/admin\/packs\/([A-Za-z0-9_-]{1,80})$/);
      if (match && request.method === "PUT") {
        try {
          const body = await readJson(request), invalid = validatePack(body);
          if (invalid) return reply({ error: invalid }, 400, origin);
          const now = Date.now();
          const result = await env.DB.prepare(
            "UPDATE resource_packs SET title=?,author=?,category=?,description=?,source_url=?,compatibility=?,thumbnail_url=?,gallery_json=?,direct_download_url=?,direct_download_allowed=?,permission_url=?,permission_note=?,image_permission_url=?,updated_at=? WHERE id=?"
          ).bind(String(body.title).trim(),String(body.author||"").trim(),String(body.category||"その他"),String(body.description).trim(),String(body.sourceUrl).trim(),String(body.compatibility||"配布元で確認"),String(body.thumbnailUrl||""),JSON.stringify(body.galleryImages||[]),body.directDownloadAllowed?String(body.directDownloadUrl||""):"",body.directDownloadAllowed?1:0,String(body.permissionUrl||""),String(body.permissionNote||"").slice(0,500),String(body.imagePermissionUrl||""),now,match[1]).run();
          if (Number(result?.meta?.changes||0) !== 1) return reply({ error: "対象のパックが見つかりません。" }, 404, origin);
          const row = await env.DB.prepare("SELECT * FROM resource_packs WHERE id=?").bind(match[1]).first();
          return reply({ pack: normalize(row) }, 200, origin);
        } catch (error) { console.error(error); return reply({ error: "更新できませんでした。" }, 500, origin); }
      }
      if (match && request.method === "DELETE") {
        await ensureDeletedTable(env);
        const row=await env.DB.prepare("SELECT * FROM resource_packs WHERE id=?").bind(match[1]).first();
        if(!row)return reply({error:"対象のパックが見つかりません。"},404,origin);
        await env.DB.prepare("INSERT INTO resource_pack_deleted (id,title,snapshot_json,deleted_at,restored_at) VALUES (?,?,?,?,NULL) ON CONFLICT(id) DO UPDATE SET snapshot_json=excluded.snapshot_json,deleted_at=excluded.deleted_at,restored_at=NULL").bind(row.id,row.title,JSON.stringify(row),Date.now()).run();
        await env.DB.prepare("DELETE FROM resource_packs WHERE id=?").bind(match[1]).run();
        return reply({ok:true,deletedId:row.id},200,origin);
      }
    }
    return reply({ error: "Not found" }, 404, origin);
  }
};