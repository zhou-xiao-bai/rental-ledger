import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { emptyLedger } from '../lib/ledger.ts';
export function openStore(file=process.env.DATABASE_PATH||'data/ledger.sqlite') {
 const path=resolve(file);mkdirSync(dirname(path),{recursive:true});const db=new DatabaseSync(path);
 db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
 db.exec('CREATE TABLE IF NOT EXISTS ledger (id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL)');
 db.prepare('INSERT OR IGNORE INTO ledger (id,payload,revision,updated_at) VALUES (1,?,0,?)').run(JSON.stringify(emptyLedger()),new Date().toISOString());
 return {db,read(){const row=db.prepare('SELECT payload,revision FROM ledger WHERE id=1').get();return {state:JSON.parse(row.payload),revision:row.revision};},save(revision,state){const payload=JSON.stringify(state);if(Buffer.byteLength(payload)>4_000_000)throw new Error('账本超过 4 MB，请先导出备份');return db.prepare('UPDATE ledger SET payload=?, revision=revision+1, updated_at=? WHERE id=1 AND revision=?').run(payload,new Date().toISOString(),revision).changes===1;},close(){db.close();}};
}
