import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Database, SqlValue, Statement } from '../core/types';

export class SqliteDatabase implements Database {
  readonly connection: DatabaseSync;
  constructor(path: string, migrations = join(process.cwd(), 'drizzle')) {
    this.connection = new DatabaseSync(path);
    this.connection.exec('PRAGMA foreign_keys = ON');
    this.connection.exec('PRAGMA journal_mode = WAL');
    this.connection.exec('PRAGMA busy_timeout = 5000');
    this.connection.exec(
      'CREATE TABLE IF NOT EXISTS _tibo_migrations (name TEXT PRIMARY KEY)',
    );
    for (const name of readdirSync(migrations)
      .filter((n) => /^\d.*\.sql$/.test(n))
      .sort()) {
      if (
        this.connection
          .prepare('SELECT name FROM _tibo_migrations WHERE name=?')
          .get(name)
      )
        continue;
      this.connection.exec('BEGIN IMMEDIATE');
      try {
        this.connection.exec(readFileSync(join(migrations, name), 'utf8'));
        this.connection
          .prepare('INSERT INTO _tibo_migrations(name) VALUES(?)')
          .run(name);
        this.connection.exec('COMMIT');
      } catch (error) {
        this.connection.exec('ROLLBACK');
        throw error;
      }
    }
  }
  async query<T = Record<string, unknown>>(
    sql: string,
    args: SqlValue[] = [],
  ): Promise<T[]> {
    return this.connection.prepare(sql).all(...args) as T[];
  }
  async batch(statements: Statement[]): Promise<Record<string, unknown>[][]> {
    this.connection.exec('BEGIN IMMEDIATE');
    try {
      const result = statements.map((s) =>
        this.connection.prepare(s.sql).all(...(s.args || [])),
      );
      this.connection.exec('COMMIT');
      return result;
    } catch (error) {
      this.connection.exec('ROLLBACK');
      throw error;
    }
  }
  close() {
    this.connection.close();
  }
}
