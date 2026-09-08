import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn,spawnSync } from 'node:child_process';
import { mkdtempSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { emptyLedger,applyCommand } from '../lib/ledger.ts';
import { openStore } from '../server/storage.mjs';
const origin='http://localhost';
const dir=mkdtempSync(join(tmpdir(),'rental-selfhost-'));
const env={...process.env,PORT:'0',PUBLIC_ORIGIN:origin,ADMIN_USERNAME:'test-admin',ADMIN_PASSWORD:'local-test-password-123456',SESSION_SECRET:'local-test-session-secret-with-more-than-32-characters',DATABASE_PATH:join(dir,'ledger.sqlite')};
async function start(){const child=spawn(process.execPath,['server/server.mjs'],{env,stdio:['ignore','pipe','pipe']});let output='';child.stderr.on('data',d=>{output+=d.toString();});let port;await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('server timeout '+output)),10000);child.stdout.on('data',d=>{const match=d.toString().match(/port (\d+)/);if(match){port=match[1];clearTimeout(timeout);resolve();}});child.on('exit',code=>{if(!port){clearTimeout(timeout);reject(new Error('server exited '+code+' '+output));}});child.on('error',reject);});return {child,base:'http://127.0.0.1:'+port};}
async function stop(child){child.kill();await once(child,'exit');}
test('standalone fixed-login server: auth, CSRF, static app, persistent SQLite, idempotency and concurrent writes',async()=>{
 let instance=await start();try{
 const api=()=>instance.base+'/api/ledger';
 assert.equal((await fetch(api())).status,401);
 assert.equal((await fetch(api(),{headers:{'oai-authenticated-user-id':'fake'}})).status,401);
 let response=await fetch(instance.base+'/login',{method:'POST',headers:{origin,'content-type':'application/x-www-form-urlencoded'},body:'username=test-admin&password=wrong',redirect:'manual'});assert.equal(response.status,401);
 async function login(){const r=await fetch(instance.base+'/login',{method:'POST',headers:{origin,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({username:'test-admin',password:env.ADMIN_PASSWORD}),redirect:'manual'});assert.equal(r.status,303);assert.match(r.headers.get('set-cookie'),/HttpOnly/);return r.headers.get('set-cookie').split(';')[0];}
 let cookie=await login();
 const read=async()=>{const r=await fetch(api(),{headers:{cookie}});assert.equal(r.status,200);return r.json();};
 const send=async(command,revision,key=crypto.randomUUID(),requestOrigin=origin)=>{const r=await fetch(api(),{method:'POST',headers:{cookie,origin:requestOrigin,'content-type':'application/json'},body:JSON.stringify({command,revision,requestId:key})});return {status:r.status,data:await r.json()};};
 response=await fetch(instance.base+'/',{headers:{cookie}});assert.equal(response.status,200);const html=await response.text();const asset=html.match(/src="([^"]+\.js)"/)[1];assert.equal((await fetch(instance.base+asset,{headers:{cookie}})).status,200);
 assert.equal((await fetch(api(),{headers:{cookie:cookie+'tampered'}})).status,401);
 assert.equal((await send({},0,crypto.randomUUID(),'https://other.example')).status,403);
 const key=crypto.randomUUID();const command={type:'property.save',name:'自托管测试房源',source:'owned',rooms:'A房'};let result=await send(command,0,key);assert.equal(result.status,200);assert.equal((await send(command,0,key)).data.revision,1);
 assert.equal((await send({type:'tenant.save',name:'冲突'},0)).status,409);
 const concurrent=await Promise.all([send({type:'tenant.save',name:'测试甲'},1),send({type:'tenant.save',name:'测试乙'},1)]);assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,409]);
 let snapshot=await read();const p=snapshot.state.properties[0].id;result=await send({type:'expense.create',propertyId:p,unit:'A房',category:'decoration',title:'装修',amount:'123.45',date:'2025-01-01'},snapshot.revision);assert.equal(result.status,200);assert.equal(result.data.state.entries.length,1);assert.equal(result.data.state.entries[0].amount,12345);snapshot=await read();
 await stop(instance.child);instance=await start();cookie=await login();const persisted=await read();assert.equal(persisted.revision,snapshot.revision);assert.equal(persisted.state.entries[0].amount,12345);
 response=await fetch(instance.base+'/logout',{method:'POST',headers:{cookie,origin},redirect:'manual'});assert.equal(response.status,303);assert.match(response.headers.get('set-cookie'),/Max-Age=0/);
 }finally{await stop(instance.child);}
});
test('exported online ledger imports once into empty self-hosted storage and refuses overwrites',()=>{
 const state=applyCommand(emptyLedger(),{type:'property.save',name:'迁移测试',source:'owned',rooms:'A房'});const file=join(dir,'backup.json'),database=join(dir,'import.sqlite');writeFileSync(file,JSON.stringify({app:'房账',currency:'CNY',moneyUnit:'fen',state}));
 const execute=()=>spawnSync(process.execPath,['server/import-ledger.mjs',file],{env:{...env,DATABASE_PATH:database},encoding:'utf8'});
 assert.equal(execute().status,0);const store=openStore(database);assert.equal(store.read().state.properties[0].name,'迁移测试');assert.equal(store.read().revision,1);store.close();assert.notEqual(execute().status,0);
});
