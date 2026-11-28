export function normalizeText(value){
 return String(value??"").normalize("NFKC").toLocaleLowerCase("ja-JP");
}
const restrictedPattern=/(?:\b(?:gun|guns|weapon|weapons|knife|knives|sword|swords|rifle|pistol|shotgun|grenade|ammo|ammunition|blade|crossbow|mace|spear|firearm|firearms)\b|銃|武器|刃物|刀剣|弾薬|弾丸|火器|\b(?:bow|arrow|arrows|trident|crossbow|launcher|ammo|ammunition)\b|弓|矢|トライデント)/iu;
export function isRestricted(...values){
 return restrictedPattern.test(normalizeText(values.filter(Boolean).join(" ")));
}
export function category(title){
 const t=normalizeText(title);
 if(/shader|visual|pbr|シェーダー|影|描画/.test(t))return "シェーダー";
 if(/\b(ui|gui|hud|menu|crosshair|inventory)\b|ユーザーインターフェース|メニュー|照準|インベントリ/.test(t))return "UI・テーマ";
 if(/sound|music|audio|サウンド|音声|効果音/.test(t))return "サウンド";
 if(/font|language|フォント|言語/.test(t))return "言語・フォント";
 if(/animation|animated|アニメーション|動き/.test(t))return "アニメーション";
 if(/tree|plant|leaves|flower|nature|grass|自然|植物|木|草|葉|花/.test(t))return "自然・植物";
 if(/block|ore|glass|item|texture|ブロック|鉱石|ガラス|アイテム|テクスチャ/.test(t))return "ブロック・建築";
 if(/fps|performance|optimization|lag|軽量化|最適化|軽い/.test(t))return "軽量化";
 return "その他";
}
export function normalizeSourceUrl(value){
 try{
  const u=new URL(String(value||""));
  if(u.protocol!=="https:")return "";
  u.hostname=u.hostname.toLowerCase().replace(/^www\./,"");
  u.hash="";
  for(const key of [...u.searchParams.keys()])if(/^(utm_.+|fbclid|gclid|ref|source|campaign)$/i.test(key))u.searchParams.delete(key);
  u.searchParams.sort();u.pathname=u.pathname.replace(/\/+$/,"");
  return u.origin+u.pathname+(u.search||"");
 }catch{return "";}
}
export function subtractCalendarYear(value=new Date()){
 const d=new Date(value),year=d.getUTCFullYear()-1,month=d.getUTCMonth(),day=d.getUTCDate();
 const lastDay=new Date(Date.UTC(year,month+1,0)).getUTCDate();
 return new Date(Date.UTC(year,month,Math.min(day,lastDay),d.getUTCHours(),d.getUTCMinutes(),d.getUTCSeconds(),d.getUTCMilliseconds()));
}
export function titleKey(value){
 return normalizeText(value).replace(/[^a-z0-9ぁ-んァ-ヶ一-龯]/giu,"");
}
