import { addDays, billTotals, categories, days, entryEffects, formatMoney, monthlySegments, outstanding, sum, type Bill, type Entry, type Ledger, type Side } from './ledger.ts';

// The working queue retains overdue items and only the next future period of each charge series.
export function currentBillIds(s:Ledger,asOf:string) {
 const ids=new Set<string>();const next=new Map<string,{due:string;ids:string[]}>();
 for(const b of s.bills){if(b.voided||outstanding(s,b)<=0)continue;if(b.due<=asOf){ids.add(b.id);continue;}
  const key=[b.leaseId||b.propertyId+':'+b.unit,b.side,b.category].join('|');const old=next.get(key);
  if(!old||b.due<old.due)next.set(key,{due:b.due,ids:[b.id]});else if(b.due===old.due)old.ids.push(b.id);
 }for(const item of next.values())for(const id of item.ids)ids.add(id);return ids;
}
export function upcomingBills(s:Ledger,asOf:string,within=7,propertyId='') {return s.bills.filter(b=>!b.voided&&(!propertyId||b.propertyId===propertyId)&&b.due>asOf&&b.due<=addDays(asOf,within)&&outstanding(s,b)>0).sort((a,b)=>a.due.localeCompare(b.due));}
export function entryView(s:Ledger,e:Entry) {
 const original=e.kind==='reversal'?s.entries.find(o=>o.id===e.reversalOf)!:e;
 const b=s.bills.find(b=>b.id===original.billId)!;
 const direction:Side|'offset'=original.kind==='apply'?'offset':original.kind==='refund'?(b.side==='in'?'out':'in'):b.side;
 const signedAmount=e.kind==='reversal'?-e.amount:e.amount;
 return {bill:b,original,direction,signedAmount,label:(direction==='offset'?'押金抵扣':direction==='in'?'收款':'付款')+(e.kind==='reversal'?'冲销':original.kind==='refund'?' · 退款':''),cashAmount:direction==='offset'?0:signedAmount};
}
export type EntryFilters={propertyId?:string;unit?:string;direction?:string;category?:string;start?:string;end?:string;query?:string;costOnly?:boolean};
export function filterEntries(s:Ledger,f:EntryFilters) {return s.entries.filter(e=>{const v=entryView(s,e),b=v.bill;
 if(f.propertyId&&b.propertyId!==f.propertyId||f.unit&&b.unit!==f.unit||f.direction&&f.direction!=='all'&&v.direction!==f.direction||f.start&&e.date<f.start||f.end&&e.date>f.end||f.costOnly&&b.side!=='out')return false;
 if(f.category&&f.category!=='all'&&(f.category==='utilities'?!['water','electricity','internet','propertyFee','other'].includes(b.category):b.category!==f.category))return false;
 if(f.query){const p=s.properties.find(p=>p.id===b.propertyId),l=s.leases.find(l=>l.id===b.leaseId),t=s.tenants.find(t=>t.id===l?.tenantId);if(![p?.name,b.unit,b.title,categories[b.category],e.note,t?.name,l?.landlord].join(' ').toLowerCase().includes(f.query.toLowerCase()))return false;}return true;
 }).sort((a,b)=>a.date.localeCompare(b.date)||a.createdAt.localeCompare(b.createdAt));}
export function entrySummary(s:Ledger,entries:Entry[]) {const views=entries.map(e=>entryView(s,e));return {received:sum(views.filter(v=>v.direction==='in').map(v=>v.cashAmount)),paid:sum(views.filter(v=>v.direction==='out').map(v=>v.cashAmount)),offset:sum(views.filter(v=>v.direction==='offset').map(v=>v.signedAmount))};}
export function costSummary(s:Ledger,propertyId='') {
 const relevant=entryEffects(s).filter(({entry:e})=>{const b=s.bills.find(b=>b.id===e.billId)!;return b.side==='out'&&(!propertyId||b.propertyId===propertyId);});
 const invested=sum(relevant.filter(v=>v.entry.kind==='payment').map(v=>v.sign*v.entry.amount));
 const recovered=sum(relevant.filter(v=>v.entry.kind==='refund').map(v=>v.sign*v.entry.amount));
 const heldDeposit=sum(s.bills.filter(b=>b.side==='out'&&b.category==='deposit'&&(!propertyId||b.propertyId===propertyId)).map(b=>billTotals(s,b.id).balance));
 return {invested,recovered,netInvestment:invested-recovered,heldDeposit,consumed:invested-recovered-heldDeposit};
}
export function billExplanation(s:Ledger,b:Bill) {
 const l=s.leases.find(l=>l.id===b.leaseId);if(!b.automatic||!l)return b.note||'手动登记的费用账单。';
 if(b.category==='deposit')return '合同约定押金 '+formatMoney(l.deposit)+'。实际收付、退还和抵扣分别记录。';
 const rule=l.fees.find(f=>f.category===b.category);const monthly=b.category==='rent'?l.rent:rule?.amount;
 if(monthly===undefined)return b.note;
 const rows=monthlySegments(l.start,l.end,monthly).filter(p=>p.start>=b.start&&p.start<=b.end);
 const totalDays=days(b.start,addDays(b.end,1));
 const partial=rows.length===1&&rows[0].amount!==monthly;
 const description=b.category==='rent'?'合同月租':'合同固定'+categories[b.category]+'月费';
 return description+' '+formatMoney(monthly)+'。本期 '+b.start+' 至 '+b.end+'（含首尾，共 '+totalDays+' 天）'+(partial?'，属于不足一个租约月的尾期，按该租约月实际天数折算为 '+formatMoney(b.amount):'，本期应收付 '+formatMoney(b.amount))+'。合同结束日 '+l.end+' 也计费；约定提前 '+l.advance+' 天支付。';
}
