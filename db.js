// ─────────────────────────────────────────────
//  데이터베이스 연결
// ─────────────────────────────────────────────
//  • TURSO_DATABASE_URL 이 있으면 → Turso(무료 클라우드 SQLite)에 저장   ← 배포용
//  • 없으면               → 내 컴퓨터의 data/planner.db 파일에 저장      ← 로컬 실행용
//  어느 쪽이든 아래 함수(get / all / run / batch)는 똑같이 사용
const fs = require('fs');
const path = require('path');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  pw_hash TEXT NOT NULL,
  settings TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS exams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  subject TEXT NOT NULL,
  date TEXT NOT NULL,
  difficulty INTEGER DEFAULT 3,
  scope TEXT DEFAULT '',
  color TEXT
);
CREATE INDEX IF NOT EXISTS idx_exams_user ON exams(user_id);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  start INTEGER,
  end INTEGER,
  exam_id INTEGER,
  subject TEXT,
  title TEXT NOT NULL,
  kind TEXT DEFAULT 'study',
  auto INTEGER DEFAULT 1,
  done INTEGER DEFAULT 0,
  done_at TEXT,
  note TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_tasks_user_date ON tasks(user_id, date);
CREATE TABLE IF NOT EXISTS memos (
  user_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  text TEXT DEFAULT '',
  mood TEXT DEFAULT '',
  focus_min INTEGER DEFAULT 0,
  PRIMARY KEY (user_id, date)
);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
`;

// undefined/boolean 값을 DB가 받을 수 있는 형태로
const norm = (args = []) => args.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));

function localBackend() {
  const { DatabaseSync } = require('node:sqlite');
  const file = process.env.DB_PATH || path.join(__dirname, 'data', 'planner.db');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const sql = new DatabaseSync(file);
  sql.exec('PRAGMA journal_mode = WAL;');
  return {
    mode: `파일 (${file})`,
    async init() { sql.exec(SCHEMA); },
    async get(q, args) { return sql.prepare(q).get(...norm(args)) || null; },
    async all(q, args) { return sql.prepare(q).all(...norm(args)); },
    async run(q, args) {
      const r = sql.prepare(q).run(...norm(args));
      return { lastInsertRowid: Number(r.lastInsertRowid), changes: Number(r.changes) };
    },
    async batch(stmts) { // 전부 성공하거나 전부 취소 (트랜잭션)
      sql.exec('BEGIN');
      try { for (const s of stmts) sql.prepare(s.sql).run(...norm(s.args)); sql.exec('COMMIT'); }
      catch (e) { sql.exec('ROLLBACK'); throw e; }
    },
  };
}

function tursoBackend() {
  const { createClient } = require('@libsql/client/web');
  const client = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  const rows = (rs) => rs.rows.map((r) => Object.fromEntries(rs.columns.map((c, i) => [c, r[i]])));
  return {
    mode: 'Turso 클라우드',
    async init() { await client.executeMultiple(SCHEMA); },
    async get(q, args) { return rows(await client.execute({ sql: q, args: norm(args) }))[0] || null; },
    async all(q, args) { return rows(await client.execute({ sql: q, args: norm(args) })); },
    async run(q, args) {
      const r = await client.execute({ sql: q, args: norm(args) });
      return { lastInsertRowid: Number(r.lastInsertRowid ?? 0), changes: r.rowsAffected };
    },
    async batch(stmts) {
      if (stmts.length) await client.batch(stmts.map((s) => ({ sql: s.sql, args: norm(s.args) })), 'write');
    },
  };
}

module.exports = process.env.TURSO_DATABASE_URL ? tursoBackend() : localBackend();
