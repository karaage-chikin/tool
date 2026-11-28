(()=>{"use strict";
const API=document.querySelector('meta[name="resource-packs-api"]')?.content;if(!API)throw new Error("API endpoint is not configured");
const form=document.getElementById("homeAdminLogin"),status=document.getElementById("homeAdminStatus"),button=document.getElementById("homeAdminLoginBtn");
if(!form)return;
form.addEventListener("submit",async event=>{
 event.preventDefault();button.disabled=true;status.className="login-status";status.textContent="認証中…";
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
 try{
  const response=await fetch(API+"/api/admin/login",{method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json"},body:JSON.stringify({password:document.getElementById("homeAdminPassword").value}),signal:controller.signal,cache:"no-store"});
  let data;try{data=await response.json();}catch{throw new Error("サーバーから正しい応答がありません。");}
  if(!response.ok)throw new Error(data.error||"ログインできませんでした。");
  if(typeof data.token!=="string"||!/^[A-Za-z0-9_.-]{20,2048}$/.test(data.token))throw new Error("認証応答が不正です。");
  sessionStorage.setItem("resourcePackAdminToken",data.token);if(data.expiresIn)sessionStorage.setItem("resourcePackAdminTokenExpiresAt",String(Date.now()+Number(data.expiresIn)));location.href="admin.html";
 }catch(error){status.className="login-status error";status.textContent=error.name==="AbortError"?"通信がタイムアウトしました。":"ログインできませんでした："+error.message;}
 finally{clearTimeout(timer);button.disabled=false;}
});
})();