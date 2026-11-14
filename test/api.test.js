// API 흐름: 실제 서버를 임시 DB로 띄워서 확인 (28일 생성, 이어 생성, plan_until, 종류별 시험, 예상 시간)
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const S = require('../scheduler');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'planner-test-'));
const PORT = 3900 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}/api`;
let server, token;

async function api(p, { method = 'GET', body } = {}) {
  const r = await fetch(BASE + p, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body && JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(`${p} ${r.status} ${j.error}`);
  return j;
}
async function allTasks(from, to) {
  const out = [];
  for (let d = from; d <= to; d = S.addDays(d, 1)) out.push(...(await api('/day/' + d)).tasks);
  return out;
}

test.before(async () => {
  server = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DB_PATH: path.join(dir, 't.db'), TURSO_DATABASE_URL: process.env.SIM_TURSO || '', ANTHROPIC_API_KEY: '' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(BASE + '/health')).ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  token = (await api('/auth/signup', { method: 'POST', body: { username: 'apitest', password: 'pw1234' } })).token;
});
test.after(() => { server?.kill(); fs.rmSync(dir, { recursive: true, force: true }); });

const T = '2026-11-16';
const key = (t) => `${t.date} ${t.start} ${t.exam_id} ${t.title}`;

test('API: 같은 과목명이라도 종류가 다르면 별도 시험 (bulk 포함)', async () => {
  await api('/settings', { method: 'PUT', body: { lifeType: 'prep', examKinds: ['suneung', 'naesin'] } });
  const s = await api('/settings');
  assert.equal(s.lifeType, 'prep');
  await api('/exams', { method: 'POST', body: { subject: '수학', date: '2027-02-20', difficulty: 4, kind: 'suneung', priority: 'high', scope: '수열과 급수; 미분법 응용' } });
  await api('/exams', { method: 'POST', body: { subject: '수학', date: '2026-12-08', difficulty: 3, kind: 'naesin', scope: '1단원 다항식; 2단원 방정식' } });
  const r = await api('/exams/bulk', { method: 'POST', body: { exams: [
    { subject: '수학', date: '2026-12-09', difficulty: 3, kind: 'naesin', scope: '1단원 다항식; 2단원 방정식' }, // 내신 수학 → 업데이트
    { subject: '영어', date: '2027-01-10', difficulty: 3, kind: 'cert', scope: 'LC 파트; RC 파트' },        // 새로 추가
  ] } });
  assert.deepEqual([r.added, r.updated], [1, 1]);
  const exams = await api('/exams');
  assert.equal(exams.length, 3);
  assert.equal(exams.find((e) => e.kind === 'naesin').date, '2026-12-09');
  assert.equal(exams.find((e) => e.kind === 'suneung').priority, 'high');
  await assert.rejects(api('/exams', { method: 'POST', body: { subject: 'X', date: '2027-01-01', kind: 'custom', stages: [{ name: '하나', ratio: 100 }] } }), /직접 설정 단계/);
});

test('API: 선호 요일을 안 보내면 빈 값으로 저장 (일요일 "0"으로 저장되던 버그)', async () => {
  const exams = await api('/exams');
  // 위에서 pref_days 없이 POST한 시험 2개 + bulk로 추가한 영어 모두 ''
  assert.deepEqual(exams.map((e) => e.pref_days), ['', '', '']);
  const r = await api('/exams', { method: 'POST', body: { subject: '선호없음', date: '2027-01-05', pref_days: '' } });
  assert.equal(r.pref_days, '');
  const sun = await api('/exams', { method: 'POST', body: { subject: '일요일만', date: '2027-01-05', pref_days: [0] } });
  assert.equal(sun.pref_days, '0'); // 진짜 일요일 선택은 그대로
  const both = await api('/exams', { method: 'POST', body: { subject: '주말', date: '2027-01-05', pref_days: '6,0,' } });
  assert.equal(both.pref_days, '0,6');
  for (const id of [r.id, sun.id, both.id]) await api('/exams/' + id, { method: 'DELETE' });
});

test('API: plan_until이 빈 계정(기존 계정)은 첫 접속 때 다시 생성이 필요하다고 알려 줌', async () => {
  const st = await api(`/plan?today=${T}`);
  assert.equal(st.planUntil, '');
  assert.equal(st.needsRegen, true);
  assert.equal(st.needsExtend, false);
});

test('API: 28일까지만 생성 → 이어 생성 → 한 번에 생성한 결과와 같음, plan_until 갱신', async () => {
  const r1 = await api('/generate', { method: 'POST', body: { startDate: T, today: T } });
  assert.equal(r1.planUntil, S.addDays(T, 27));
  assert.equal((await api(`/plan?today=${T}`)).needsRegen, false);
  assert.equal(r1.lastExam, '2027-02-20');
  // 아직 14일 넘게 남음 → 이어 생성 필요 없음
  assert.equal((await api(`/plan?today=${S.addDays(T, 13)}`)).needsExtend, false);
  const today2 = S.addDays(T, 14);
  assert.equal((await api(`/plan?today=${today2}`)).needsExtend, true);
  const r2 = await api('/generate', { method: 'POST', body: { mode: 'extend', today: today2 } });
  assert.equal(r2.from, S.addDays(T, 28));
  assert.equal(r2.planUntil, S.addDays(today2, 27));
  // 같은 이어 생성이 두 번 와도(창 두 개) 중복 없음
  const r3 = await api('/generate', { method: 'POST', body: { mode: 'extend', today: today2 } });
  assert.equal(r3.created, 0);

  const stored = (await allTasks(T, r2.planUntil)).filter((t) => t.auto);
  assert.ok(stored.every((t) => t.date <= r2.planUntil));
  const exams = await api('/exams');
  const full = S.buildPlan({ settings: await api('/settings'), exams, startDate: T }).all.filter((t) => t.date <= r2.planUntil);
  const sortK = (l) => l.map(key).sort();
  assert.deepEqual(sortK(stored), sortK(full));
});

test('API: 완료 후 재생성하면 진도가 이어지고, 예상 전체 시간이 저장된다', async () => {
  const today = S.addDays(T, 5);
  const past = (await allTasks(T, S.addDays(T, 4))).filter((t) => t.kind === 'study');
  const mine = past.filter((t) => t.exam_id === past[0].exam_id).slice(0, 4);
  for (const t of mine) await api('/tasks/' + t.id, { method: 'PATCH', body: { done: true } });
  const r = await api('/generate', { method: 'POST', body: { startDate: today, today } });
  assert.equal(r.planUntil, S.addDays(today, 27));
  const exams = await api('/exams');
  const ex = exams.find((e) => e.id === mine[0].exam_id);
  const settings = await api('/settings');
  const doneMin = mine.reduce((a, t) => a + t.end - t.start, 0);
  const sim = S.buildPlan({ settings, exams: exams.filter((e) => e.date >= today), startDate: today, doneCount: { [ex.id]: mine.length } });
  assert.equal(ex.expected_min, doneMin + sim.simMin[ex.id]);
  const first = (await allTasks(today, S.addDays(today, 3))).filter((t) => t.auto && t.exam_id === ex.id && t.kind === 'study')[0];
  const N = mine.length + sim.all.filter((t) => t.kind === 'study' && t.exam_id === ex.id).length;
  assert.equal(first.title, S.stageTitle(ex, mine.length, N));
  const st = await api('/stats?today=' + today);
  assert.equal(st.subjects.find((x) => x.id === ex.id).expected_min, ex.expected_min);
  assert.equal(st.subjects.find((x) => x.id === ex.id).doneMin, doneMin);
});
