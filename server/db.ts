/** Thin helpers over D1 prepared statements. Every query is parameterised. */

export type Row = Record<string, unknown>;

export async function first<T = Row>(
  db: D1Database,
  sql: string,
  ...params: unknown[]
): Promise<T | null> {
  return (await db
    .prepare(sql)
    .bind(...params)
    .first<T>()) as T | null;
}

export async function all<T = Row>(
  db: D1Database,
  sql: string,
  ...params: unknown[]
): Promise<T[]> {
  const r = await db
    .prepare(sql)
    .bind(...params)
    .all<T>();
  return r.results;
}

/** Runs a statement and returns the number of changed rows. */
export async function run(db: D1Database, sql: string, ...params: unknown[]): Promise<number> {
  const r = await db
    .prepare(sql)
    .bind(...params)
    .run();
  return r.meta.changes ?? 0;
}

export const now = () => Date.now();
export const uuid = () => crypto.randomUUID();
