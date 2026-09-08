import { readFileSync } from 'node:fs';
import { check,date,integer,validateFinancials,categories } from '../lib/ledger.ts';
import { openStore } from './storage.mjs';
const file=process.argv[2];if(!file)throw new Error('用法：node server/import-ledger.mjs 账本备份.json');
const input=JSON.parse(readFileSync(file,'utf8'));const s=input.state;
check(input.app==='房账'&&input.currency==='CNY'&&input.moneyUnit==='fen'&&s?.schema===1,'请使用房账导出的完整 JSON 备份（人民币分）');
const limits={properties:500,tenants:10000,leases:2000,bills:30000,entries:30000,audit:100000,requests:200000};
for(const [key,max] of Object.entries(limits)){check(Array.isArray(s[key])&&s[key].length<=max,'备份字段无效：'+key);if(key!=='requests')check(new Set(s[key].map(r=>r.id)).size===s[key].length&&s[key].every(r=>typeof r.id==='string'),'备份记录编号无效：'+key);}
const pids=new Set(s.properties.map(p=>p.id)),lids=new Set(s.leases.map(l=>l.id)),bids=new Set(s.bills.map(b=>b.id)),tids=new Set(s.tenants.map(t=>t.id));
for(const p of s.properties)check(typeof p.name==='string'&&Array.isArray(p.rooms)&&p.rooms.every(r=>typeof r==='string'),'房源资料无效');
for(const l of s.leases){check(pids.has(l.propertyId)&&(l.side==='out'||tids.has(l.tenantId))&&Array.isArray(l.fees),'合同关联无效');date(l.start);date(l.end);integer(l.rent,1,100_000_000_000);integer(l.deposit,0,100_000_000_000);}
for(const b of s.bills){check(pids.has(b.propertyId)&&(!b.leaseId||lids.has(b.leaseId))&&Object.hasOwn(categories,b.category)&&['in','out'].includes(b.side),'账单关联无效');date(b.start);date(b.end);date(b.due);}
for(const e of s.entries){check(bids.has(e.billId)&&['payment','refund','apply','reversal'].includes(e.kind),'流水无效');date(e.date);integer(e.amount,1,100_000_000_000);if(e.kind==='apply')check(bids.has(e.depositId),'抵扣关联无效');if(e.kind==='reversal')check(s.entries.some(o=>o.id===e.reversalOf&&o.kind!=='reversal'),'冲销关联无效');}
validateFinancials(s);
const store=openStore();try{const existing=store.read();check(existing.revision===0&&!existing.state.properties.length&&!existing.state.entries.length,'目标账本已有数据，已拒绝覆盖。请使用空白数据卷导入。');check(store.save(0,s),'账本正在被修改，导入取消');console.log('导入成功：'+s.properties.length+' 个房源，'+s.bills.length+' 笔账单，'+s.entries.length+' 笔流水。');}finally{store.close();}
