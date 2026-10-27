// Stands in for @neondatabase/serverless during tests: same tagged-template call, backed by in-memory Postgres.
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();

export function neon() {
  return async (strings, ...vals) => {
    let q = strings[0];
    for (let i = 0; i < vals.length; i++) q += `$${i + 1}${strings[i + 1]}`;
    return (await db.query(q, vals)).rows;
  };
}
