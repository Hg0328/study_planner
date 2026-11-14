// 마이그레이션: 빈 선호 요일 '0' 데이터 정리는 한 번만 실행 (이후 고른 일요일 단독 선호는 유지)
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'planner-mig-'));
const DB = path.join(dir, 'm.db');
const PORT = 3990 + Math.floor(Math.random() * 9);
const BASE = `http://127.0.0.1:${PORT}/api`;
let server, token;

async function start() {
  server = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB, TURSO_DATABASE_URL: '' }, stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(BASE + '/health')).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('서버가 시작되지 않음');
}
async function stop() { const s = server; server = null; if (!s) return; await new Promise((r) => { s.once('exit', r); s.kill(); }); }
async function api(p, body) {
  const r = await fetch(BASE + p, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body && JSON.stringify(body) });
  return r.json();
}
const sql = (q, ...a) => { const d = new DatabaseSync(DB); try { return q.trim().startsWith('SELECT') ? d.prepare(q).all(...a) : d.prepare(q).run(...a); } finally { d.close(); } };

test.after(async () => { await stop(); fs.rmSync(dir, { recursive: true, force: true }); });

test('빈 선호 요일 정리 마이그레이션은 한 번만 실행된다', async () => {
  await start();
  token = (await api('/auth/signup', { username: 'miguser', password: 'pw1234' })).token;
  const a = await api('/exams', { subject: '국어', date: '2027-01-05' });
  const b = await api('/exams', { subject: '영어', date: '2027-01-06', pref_days: [1, 3] });
  await stop();
  // 버그가 있던 시절의 데이터 상태로 되돌림: 빈 선호 요일이 '0'으로 저장돼 있고, 정리 기록이 없음
  sql("UPDATE exams SET pref_days='0' WHERE id=?", a.id);
  sql("DELETE FROM meta WHERE key='mig_pref_days_0'");

  await start(); // ① 첫 실행: '0' → '' 정리, 다른 선호 요일은 그대로
  assert.deepEqual(sql('SELECT id, pref_days FROM exams ORDER BY id').map((r) => r.pref_days), ['', '1,3']);
  assert.equal(sql("SELECT value FROM meta WHERE key='mig_pref_days_0'")[0].value, 'done');
  const sun = await api('/exams', { subject: '수학', date: '2027-01-07', pref_days: [0] }); // 수정 후 진짜 일요일 선택
  assert.equal(sun.pref_days, '0');
  await stop();

  await start(); // ② 다시 실행해도 일요일 단독 선호가 지워지지 않음
  assert.equal(sql('SELECT pref_days FROM exams WHERE id=?', sun.id)[0].pref_days, '0');
  assert.equal(sql('SELECT pref_days FROM exams WHERE id=?', b.id)[0].pref_days, '1,3');
});
