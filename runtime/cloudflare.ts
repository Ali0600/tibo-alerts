import type { D1Database } from '@cloudflare/workers-types';
import { env } from 'cloudflare:workers';
import type { Database, Runtime, SqlValue, Statement } from '../core/types';
export function getRuntime(): Runtime {
  const bindings = env as unknown as Record<string, unknown>;
  const connection = bindings.DB as D1Database;
  if (!connection) throw new Error('DATABASE_NOT_CONFIGURED');
  const db: Database = {
    async query<T>(sql: string, args: SqlValue[] = []): Promise<T[]> {
      const r = await connection
        .prepare(sql)
        .bind(...args)
        .all<T>();
      return r.results;
    },
    async batch(statements: Statement[]) {
      const r = await connection.batch(
        statements.map((s) =>
          connection.prepare(s.sql).bind(...(s.args || [])),
        ),
      );
      return r.map((v) => v.results as Record<string, unknown>[]);
    },
  };
  const settings: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(bindings))
    if (typeof value === 'string') settings[key] = value;
  return { db, env: settings, trustedIpHeader: 'cf-connecting-ip' };
}
