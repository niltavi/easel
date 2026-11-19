// Server-side storage: Node's built-in SQLite. The cloud only stores each work's full snapshot and version number; it does not parse the content.
import {DatabaseSync} from "node:sqlite";

export function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS codes (
      email TEXT PRIMARY KEY,
      code_hash TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      sent_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS works (
      id TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id),
      name TEXT NOT NULL,
      version INTEGER NOT NULL,
      mutation_id TEXT NOT NULL,
      snapshot TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, id)
    );
    CREATE TABLE IF NOT EXISTS ai_usage (
      user_id TEXT NOT NULL REFERENCES users(id),
      day TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, day)
    );
  `);
  // Columns added after the first release. Accounts that existed before were all created by verifying an email code.
  const columns = new Set((db.prepare("PRAGMA table_info(users)").all() as {name: string}[]).map((column) => column.name));
  if (!columns.has("password_hash")) db.exec("ALTER TABLE users ADD COLUMN password_hash TEXT");
  if (!columns.has("email_verified")) db.exec("ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 1");
  return db;
}
