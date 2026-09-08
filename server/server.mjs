import { createServer } from 'node:http';
import { createReadStream, statSync, readFileSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { applyCommand, integer, check } from '../lib/ledger.ts';
import { openStore } from './storage.mjs';

const username=process.env.ADMIN_USERNAME||'admin';
const password=process.env.ADMIN_PASSWORD;
const secret=process.env.SESSION_SECRET;
if(!password||password.length<12||password==='change-this-password')throw new Error('请配置至少 12 位的固定账号密码 ADMIN_PASSWORD');
if(!secret||secret.length<32)throw new Error('请配置至少 32 位随机 SESSION_SECRET');
const publicOrigin=new URL(process.env.PUBLIC_ORIGIN||'http://localhost:3000').origin;
const secure=publicOrigin.startsWith('https://');
const sessionSeconds=12*60*60;
const cookieName='rental_session';
const salt=randomBytes(16),passwordHash=scryptSync(password,salt,64);
const staticRoot=resolve(process.env.STATIC_DIR||'selfhost-dist');
const store=openStore();
const attempts=new Map();
const sign=value=>createHmac('sha256',secret).update(value).digest('base64url');
const equal=(a,b)=>a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const issueSession=()=>{const payload=Buffer.from(JSON.stringify({expires:Date.now()+sessionSeconds*1000,nonce:randomBytes(18).toString('hex')})).toString('base64url');return payload+'.'+sign(payload);};
function authenticated(req){try{const values=(req.headers.cookie||'').split(';').map(c=>c.trim()).filter(c=>c.startsWith(cookieName+'='));if(values.length!==1)return false;const token=values[0].slice(cookieName.length+1);if(token.length>1000)return false;const [payload,sig,...rest]=token.split('.');if(rest.length||!sig||!equal(sign(payload),sig))return false;const session=JSON.parse(Buffer.from(payload,'base64url').toString());return Number.isSafeInteger(session.expires)&&session.expires>Date.now()&&session.expires<=Date.now()+sessionSeconds*1000;}catch{return false;}}
const cookie=(token,age=sessionSeconds)=>`${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secure?'; Secure':''}`;
function reply(res,data,status=200){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
function redirect(res,path,headers={}){res.writeHead(303,{Location:path,'Cache-Control':'no-store',...headers});res.end();}
async function body(req,max=40000){let bytes=0;const chunks=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>max)throw new Error('请求内容过大');chunks.push(chunk);}return Buffer.concat(chunks).toString('utf8');}
function loginHtml(error=''){return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>登录 · 房账</title><link rel="icon" href="/favicon.svg"><style>*{box-sizing:border-box}body{margin:0;background:#f3f6fb;color:#20314d;font:16px 'Segoe UI','Microsoft YaHei',sans-serif;display:grid;place-items:center;min-height:100dvh;padding:24px}main{width:100%;max-width:410px;background:#fff;padding:36px;border:1px solid #dde5ef;border-radius:18px;box-shadow:0 12px 50px #17355a0c}h1{margin:0 0 8px;font-size:30px}p{color:#748298;font-size:14px;line-height:1.8;margin:0 0 28px}label{display:block;font-size:14px;margin-top:20px}input,button{width:100%;font:inherit;padding:13px;border:1px solid #d5deeb;border-radius:8px;margin-top:9px}button{background:#315cce;color:#fff;border:0;margin-top:28px;cursor:pointer}.error{color:#ac354a;background:#fff0f3;padding:10px;margin:15px 0 0;border-radius:7px}</style><main><h1>房账</h1><p>登录你的个人房源账本</p>${error?'<p class="error" role="alert">'+error+'</p>':''}<form method="post" action="/login"><label>账号<input name="username" autocomplete="username" required maxlength="100"></label><label>密码<input type="password" name="password" autocomplete="current-password" required maxlength="256"></label><button type="submit">登录</button></form></main></html>`;}
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.woff2':'font/woff2'};
const server=createServer(async(req,res)=>{
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Frame-Options','DENY');
 try{
  const url=new URL(req.url||'/',publicOrigin),path=url.pathname;
  if(req.method==='GET'&&path==='/healthz'){reply(res,{ok:true});return;}
  if(req.method==='POST'&&req.headers.origin!==publicOrigin){reply(res,{error:'来源无效，请使用配置的站点地址访问'},403);return;}
  if(path==='/login'){
   if(req.method==='GET'){if(authenticated(req)){redirect(res,'/');return;}res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(loginHtml());return;}
   if(req.method!=='POST'){reply(res,{error:'不支持的请求'},405);return;}
   const ip=req.socket.remoteAddress||'unknown',now=Date.now(),old=attempts.get(ip);const count=old&&old.until>now?old.count:0;
   if(count>=10){reply(res,{error:'尝试过多，请 15 分钟后重试'},429);return;}
   if(!req.headers['content-type']?.startsWith('application/x-www-form-urlencoded')){reply(res,{error:'登录格式无效'},415);return;}
   const form=new URLSearchParams(await body(req,4000));const supplied=form.get('password')||'';
   const validPassword=timingSafeEqual(scryptSync(supplied,salt,64),passwordHash);const validName=form.get('username')===username;
   if(!validPassword||!validName){if(attempts.size>1000)for(const [key,item] of attempts)if(item.until<now)attempts.delete(key);attempts.set(ip,{count:count+1,until:old&&old.until>now?old.until:now+15*60*1000});res.writeHead(401,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(loginHtml('账号或密码错误'));return;}
   attempts.delete(ip);redirect(res,'/',{'Set-Cookie':cookie(issueSession())});return;
  }
  if(!authenticated(req)){if(path.startsWith('/api/'))reply(res,{error:'登录已过期，请重新登录'},401);else redirect(res,'/login');return;}
  if(path==='/logout'){if(req.method!=='POST'){reply(res,{error:'请使用退出按钮'},405);return;}redirect(res,'/login',{'Set-Cookie':cookie('',0)});return;}
  if(path==='/api/ledger'){
   if(req.method==='GET'){reply(res,{...store.read(),user:{name:username,email:''}});return;}
   if(req.method!=='POST'){reply(res,{error:'不支持的请求'},405);return;}
   if(!req.headers['content-type']?.startsWith('application/json')){reply(res,{error:'请求格式无效'},415);return;}
   const input=JSON.parse(await body(req));const revision=integer(input.revision,0,Number.MAX_SAFE_INTEGER,'账本版本');check(typeof input.requestId==='string'&&input.requestId.length>=8&&input.requestId.length<=100,'请求编号无效');
   const previous=store.read();if(previous.state.requests.includes(input.requestId)){reply(res,previous);return;}
   if(previous.revision!==revision){reply(res,{...previous,error:'其他设备已更新账本，请核对最新数据后重试'},409);return;}
   const next=applyCommand(previous.state,input.command,input.requestId);
   if(!store.save(revision,next)){const latest=store.read();reply(res,{...latest,error:'账本同时发生变更，请核对后重试'},409);return;}
   reply(res,{state:next,revision:revision+1});return;
  }
  if(req.method!=='GET'&&req.method!=='HEAD'){reply(res,{error:'不支持的请求'},405);return;}
  const decoded=decodeURIComponent(path);const file=resolve(staticRoot,'.'+(decoded==='/'?'/index.html':decoded));
  if(!file.startsWith(staticRoot+sep)||!mime[extname(file)]){reply(res,{error:'页面不存在'},404);return;}
  let stats;try{stats=statSync(file);}catch{reply(res,{error:'页面不存在'},404);return;}if(!stats.isFile()){reply(res,{error:'页面不存在'},404);return;}
  res.writeHead(200,{'Content-Type':mime[extname(file)],'Content-Length':stats.size,'Cache-Control':path.startsWith('/assets/')?'private, max-age=31536000, immutable':'no-store'});if(req.method==='HEAD')res.end();else createReadStream(file).pipe(res);
 }catch(e){reply(res,{error:e instanceof Error?e.message:'操作失败'},400);}
});
server.requestTimeout=15000;server.headersTimeout=10000;
const port=Number(process.env.PORT||3000);server.listen(port,'0.0.0.0',()=>console.log('Rental ledger listening on port '+server.address().port));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>{store.close();process.exit(0);}));
