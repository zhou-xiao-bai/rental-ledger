import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createRequestId, saveCommand } from '../lib/client-save.ts';
import { emptyLedger, applyCommand } from '../lib/ledger.ts';

const command = {type:'property.save', name:'HTTP 测试房源', source:'owned', rooms:'A房'};
const httpCrypto = {getRandomValues: bytes => webcrypto.getRandomValues(bytes)};
function context() {
  const events = {busy:[], error:'', notice:''};
  return {events, busyRef:{current:false}, requestRef:{current:null}, stateRef:{current:{state:emptyLedger(), revision:0}},
    setBusy:v=>events.busy.push(v), setError:v=>events.error=v, setNotice:v=>events.notice=v, setSnapshot:()=>{}};
}
function server() {
  let snapshot = {state:emptyLedger(), revision:0};
  const requests = [];
  return {requests, get snapshot(){return snapshot;}, fetch:async(_url, init)=>{
    if (init?.method === 'POST') {
      const body = JSON.parse(init.body); requests.push(body);
      if (!snapshot.state.requests.includes(body.requestId)) snapshot = {state:applyCommand(snapshot.state, body.command, body.requestId), revision:snapshot.revision+1};
    }
    return Response.json(snapshot);
  }};
}

test('HTTP without randomUUID generates unique RFC 4122 v4 request IDs and saves', async()=>{
  const ids = new Set(Array.from({length:1000},()=>createRequestId(httpCrypto)));
  assert.equal(ids.size,1000);
  for (const id of ids) assert.match(id,/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
  assert.equal(createRequestId({randomUUID(){assert.equal(this.marker,true);return 'native';}, marker:true}),'native');
  const ctx=context(), api=server();
  assert.equal(await saveCommand(command,ctx,{fetch:api.fetch,createId:()=>createRequestId(httpCrypto)}),true);
  assert.equal(api.requests.length,1);
  assert.equal(ctx.stateRef.current.state.properties[0].name,command.name);
  assert.deepEqual(ctx.events.busy,[true,false]);
});

test('request ID failure restores button and lock, makes no request, and allows retry',async()=>{
  const ctx=context(), api=server();
  const unavailable=()=>createRequestId({});
  assert.equal(await saveCommand(command,ctx,{fetch:api.fetch,createId:unavailable}),false);
  assert.match(ctx.events.error,/浏览器无法生成/);
  assert.equal(api.requests.length,0);
  assert.equal(ctx.busyRef.current,false);
  assert.deepEqual(ctx.events.busy,[true,false]);
  assert.equal(await saveCommand(command,ctx,{fetch:api.fetch,createId:()=>createRequestId(httpCrypto)}),true);
});

test('serialization and random source exceptions are caught before fetch and release busy',async()=>{
  for (const fail of ['serialize','random']) {
    const ctx=context(); let calls=0;
    const input=fail==='serialize'?{...command,toJSON(){throw new Error('serialization failed');}}:command;
    assert.equal(await saveCommand(input,ctx,{fetch:async()=>{calls++;},createId:()=>{throw new Error('random failed');}}),false);
    assert.equal(calls,0); assert.equal(ctx.busyRef.current,false); assert.deepEqual(ctx.events.busy,[true,false]);
    assert.match(ctx.events.error,/failed/);
  }
});

test('lost response reconciles successful save without recording twice',async()=>{
  const ctx=context(), api=server();
  const request=async(url,init)=>{const response=await api.fetch(url,init);if(init?.method==='POST')throw new Error('response lost');return response;};
  assert.equal(await saveCommand(command,ctx,{fetch:request}),true);
  assert.equal(api.snapshot.state.properties.length,1);
  assert.match(ctx.events.notice,/已确认/);
  assert.equal(ctx.requestRef.current,null);
});

test('uncertain save retry reuses request ID and does not duplicate an already committed record',async()=>{
  const ctx=context(), api=server();
  const disconnected=async(url,init)=>{if(init?.method==='POST')await api.fetch(url,init);throw new Error('offline');};
  assert.equal(await saveCommand(command,ctx,{fetch:disconnected}),false);
  const key=ctx.requestRef.current.key;
  assert.equal(ctx.busyRef.current,false);
  assert.equal(await saveCommand(command,ctx,{fetch:api.fetch}),true);
  assert.deepEqual(api.requests.map(r=>r.requestId),[key,key]);
  assert.equal(api.snapshot.state.properties.length,1);
  assert.equal(api.snapshot.revision,1);
});

test('revision conflict clears old ID and next attempt uses refreshed revision',async()=>{
  const ctx=context(), api=server(); const ids=[];
  const conflict=async(url,init)=>{if(init?.method==='POST'){ids.push(JSON.parse(init.body).requestId);return Response.json({...api.snapshot,revision:2,error:'conflict'},{status:409});}return Response.json({...api.snapshot,revision:2});};
  assert.equal(await saveCommand(command,ctx,{fetch:conflict}),false);
  assert.equal(ctx.requestRef.current,null);
  assert.equal(await saveCommand(command,ctx,{fetch:api.fetch}),true);
  assert.notEqual(api.requests[0].requestId,ids[0]);
  assert.equal(api.requests[0].revision,2);
});

test('repeated click while saving sends only one request',async()=>{
  const ctx=context(), api=server(); let release;
  const gate=new Promise(resolve=>release=resolve);
  const first=saveCommand(command,ctx,{fetch:async(url,init)=>{await gate;return api.fetch(url,init);}});
  assert.equal(ctx.busyRef.current,true);
  assert.equal(await saveCommand(command,ctx,{fetch:api.fetch}),false);
  release(); assert.equal(await first,true);
  assert.equal(api.requests.length,1); assert.equal(ctx.busyRef.current,false);
});
