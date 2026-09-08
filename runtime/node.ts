import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { SqliteDatabase } from './sqlite';
import type { Runtime } from '../core/types';
let database: SqliteDatabase | undefined;
export function getRuntime(): Runtime {
  if (!database) {
    const path = process.env.DATABASE_PATH || 'data/tibo.sqlite';
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    database = new SqliteDatabase(path, process.env.MIGRATIONS_PATH);
  }
  return {
    db: database,
    env: process.env,
    trustedIpHeader: process.env.TRUSTED_PROXY_IP_HEADER,
  };
}
