import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
test('D1 SQLite schema: owner isolation and atomic revision guard',()=>{
 const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../drizzle/0000_magical_emma_frost.sql',import.meta.url),'utf8'));
 const insert=db.prepare('INSERT INTO ledgers (owner_id,payload,revision,updated_at) VALUES (?,?,0,?)');insert.run('owner-a','{"private":"a"}','2025-01-01');insert.run('owner-b','{"private":"b"}','2025-01-01');
 const get=db.prepare('SELECT payload,revision FROM ledgers WHERE owner_id = ?');assert.equal(JSON.parse(get.get('owner-a').payload).private,'a');assert.equal(JSON.parse(get.get('owner-b').payload).private,'b');assert.equal(get.get("owner-a' OR 1=1 --"),undefined);
 const save=db.prepare('UPDATE ledgers SET payload = ?, revision = revision + 1, updated_at = ? WHERE owner_id = ? AND revision = ?');assert.equal(save.run('{"private":"updated-a"}','2025-01-02','owner-a',0).changes,1);assert.equal(save.run('{"private":"overwritten"}','2025-01-02','owner-a',0).changes,0);assert.equal(get.get('owner-b').revision,0);assert.equal(JSON.parse(get.get('owner-a').payload).private,'updated-a');db.close();
});
