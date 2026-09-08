import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
// One owner ledger is committed atomically using compare-and-swap revision checks.
export const ledgers = sqliteTable('ledgers', {
  ownerId: text('owner_id').primaryKey(),
  payload: text('payload').notNull(),
  revision: integer('revision').notNull().default(0),
  updatedAt: text('updated_at').notNull(),
});
