import { env } from 'cloudflare:workers';
import { emptyLedger, type Ledger } from '../lib/ledger';
export function database() { if(!env.DB) throw new Error('账本存储暂时不可用'); return env.DB as D1Database; }
export async function readLedger(owner:string) {
 const db=database();
 let row=await db.prepare('SELECT payload, revision FROM ledgers WHERE owner_id = ?').bind(owner).first<{payload:string;revision:number}>();
 if(!row) { await db.prepare('INSERT INTO ledgers (owner_id, payload, revision, updated_at) VALUES (?, ?, 0, ?) ON CONFLICT(owner_id) DO NOTHING').bind(owner,JSON.stringify(emptyLedger()),new Date().toISOString()).run();row=await db.prepare('SELECT payload, revision FROM ledgers WHERE owner_id = ?').bind(owner).first<{payload:string;revision:number}>(); }
 if(!row) throw new Error('无法载入账本');
 return {state:JSON.parse(row.payload) as Ledger,revision:row.revision};
}
export async function saveLedger(owner:string,revision:number,state:Ledger) { const payload=JSON.stringify(state);if(new TextEncoder().encode(payload).length>4_000_000)throw new Error('账本达到当前 MVP 容量上限，请先导出备份'); const result=await database().prepare('UPDATE ledgers SET payload = ?, revision = revision + 1, updated_at = ? WHERE owner_id = ? AND revision = ?').bind(payload,new Date().toISOString(),owner,revision).run();return result.meta.changes===1; }
