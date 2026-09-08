import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const base='http://localhost:3000';
const cookie='__sites_local_auth=1';
const read=async()=>{const r=await fetch(base+'/api/ledger',{headers:{cookie}});assert.equal(r.status,200);return r.json();};
const post=async(command,revision,requestId=crypto.randomUUID(),origin=base)=>{const r=await fetch(base+'/api/ledger',{method:'POST',headers:{cookie,origin,'content-type':'application/json'},body:JSON.stringify({command,revision,requestId})});const raw=await r.text();let data;try{data=JSON.parse(raw);}catch{data={error:raw};}return {status:r.status,data};};
assert.equal((await fetch(base+'/api/ledger')).status,401,'anonymous access denied');
assert.equal((await fetch(base+'/api/ledger',{headers:{'oai-authenticated-user-id':'forged','oai-authenticated-user-email':'forged@example.test'}})).status,401,'forged identity headers stripped');
const initial=await read();assert.equal(initial.revision,0,'only run on an empty local test ledger');assert.equal(initial.state.properties.length,0);
assert.equal((await post({type:'property.save'},0,crypto.randomUUID(),'https://evil.example')).status,403,'cross-origin writes denied');
let snap=initial;
async function command(c,key) {const result=await post(c,snap.revision,key);assert.equal(result.status,200,JSON.stringify(result.data));snap=result.data;return snap;}
try {
 const key=crypto.randomUUID();const c={type:'property.save',name:'验证用房源（本地测试）',source:'leased',rooms:'A房\nB房'};
 await command(c,key);const repeated=await post(c,0,key);assert.equal(repeated.status,200);assert.equal(repeated.data.state.properties.length,1);assert.equal(repeated.data.revision,1);
 const conflict=await post({type:'tenant.save',name:'过期提交'},0);assert.equal(conflict.status,409);
 const concurrent=await Promise.all([post({type:'tenant.save',name:'测试甲'},1),post({type:'tenant.save',name:'测试乙'},1)]);assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,409]);snap=await read();assert.equal(snap.state.tenants.length,1);
 await command({type:'lease.create',propertyId:snap.state.properties[0].id,tenantId:snap.state.tenants[0].id,unit:'A房',side:'in',start:'2025-01-01',end:'2025-03-31',rent:'3000',deposit:'3000',cycle:'3',advance:'0',fees:[]});
 const deposit=snap.state.bills.find(b=>b.category==='deposit'),rent=snap.state.bills.find(b=>b.category==='rent');
 await command({type:'entry.create',billId:deposit.id,kind:'payment',amount:'3000',date:'2025-01-01'});
 await command({type:'entry.create',billId:rent.id,kind:'payment',amount:'8000',date:'2025-01-01'});
 await command({type:'entry.create',billId:rent.id,depositId:deposit.id,kind:'apply',amount:'1000',date:'2025-01-02'});
 await command({type:'entry.create',billId:deposit.id,kind:'refund',amount:'2000',date:'2025-01-03'});
 const saved=await read();assert.equal(saved.revision,snap.revision);assert.equal(saved.state.entries.length,4);assert.equal(saved.state.bills.find(b=>b.id===rent.id).amount,900000);
 const over=await post({type:'entry.create',billId:deposit.id,kind:'refund',amount:'0.01',date:'2025-01-04'},snap.revision);assert.equal(over.status,400);assert.equal((await read()).revision,snap.revision);
 console.log('PASS: anonymous/spoofed access, CSRF, database persistence, stale revision, simultaneous device writes, retry idempotency, deposit/payment/refund flow, rejected over-refund.');
} finally {
 const final=await read();
 if(final.state.properties.length===1&&final.state.properties[0].name==='验证用房源（本地测试）'&&final.revision===snap.revision) {
  await writeFile('work/api-test-cleanup.sql',`DELETE FROM ledgers WHERE owner_id = 'local_seedy' AND revision = ${final.revision} AND json_extract(payload, '$.properties[0].name') = '验证用房源（本地测试）';`);
 } else throw new Error('Local test data changed; refused cleanup.');
}
