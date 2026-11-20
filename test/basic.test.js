// 기본 모드: 모드 저장/조회, 기본 모드 설정으로 계획 생성, /api/week 7일 응답, 주 마지막 날 미루기
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const S = require('../scheduler');
const P = require('../public/presets');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'planner-basic-'));
const PORT = 3800 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}/api`;
let server, token;

async function api(p, { method = 'GET', body } = {}) {
  const r = await fetch(BASE + p, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body && JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(`${p} ${r.status} ${j.error}`);
  return j;
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
  token = (await api('/auth/signup', { method: 'POST', body: { username: 'basicuser', password: 'pw1234' } })).token;
});
test.after(() => { server?.kill(); fs.rmSync(dir, { recursive: true, force: true }); });

// 오늘 = 2026-11-16(월). 일주일 보기는 일~토: 11-15(일) ~ 11-21(토), 다음 주는 11-22(일)부터
const MON = '2026-11-16', WK = '2026-11-15', SAT = '2026-11-21', NEXT_SUN = '2026-11-22';

test('모드 허용 값: basic | expert, 그 외·없음은 expert (기존 사용자 기본값)', () => {
  assert.equal(S.sanitizeSettings({}).mode, 'expert');
  assert.equal(S.sanitizeSettings({ mode: 'basic' }).mode, 'basic');
  assert.equal(S.sanitizeSettings({ mode: 'admin' }).mode, 'expert');
});

test('API: 모드 저장/조회 — 가입 직후 expert, basic으로 바꿔도 다른 설정은 그대로', async () => {
  const s0 = await api('/settings');
  assert.equal(s0.mode, 'expert');
  const custom = { ...s0, wake: '06:30', maxWeekdayMin: 180, theme: 'mint' };
  await api('/settings', { method: 'PUT', body: custom });
  const s1 = await api('/settings', { method: 'PUT', body: { ...(await api('/settings')), mode: 'basic' } });
  assert.equal(s1.mode, 'basic');
  assert.equal((await api('/settings')).mode, 'basic');
  assert.deepEqual({ ...s1, mode: 'expert' }, { ...custom, mode: 'expert' }); // 모드 말고는 바뀐 게 없음
  const s2 = await api('/settings', { method: 'PUT', body: { ...s1, mode: 'weird' } });
  assert.equal(s2.mode, 'expert');
  await api('/settings', { method: 'PUT', body: { ...s2, mode: 'basic', wake: '07:00', maxWeekdayMin: 240, theme: 'cream' } });
});

test('API: 기본 모드에서 입력하는 값만으로 계획이 만들어진다 (숨긴 값은 프리셋·기본값)', async () => {
  // 기본 모드 단계 입력과 같은 내용: ② 학교 ③ 학원 ④ 식사 ⑤ 생활 유형(숨긴 값만 프리셋으로)
  const cur = await api('/settings');
  const preset = P.LIFE_TYPES.student.defaults;
  const school = cur.school.map((d, i) => ({ on: i >= 1 && i <= 5, start: '08:40', end: '15:50' }));
  const saved = await api('/settings', { method: 'PUT', body: {
    ...cur, mode: 'basic', lifeType: 'student', school,
    academies: [{ name: '수학학원', days: [2, 4], start: '18:30', end: '20:30' }],
    lunch: { start: '12:30', end: '13:20' }, dinner: { start: '17:30', end: '18:20' },
    examDay: preset.examDay, bufferMin: preset.bufferMin, maxWeekdayMin: preset.maxWeekdayMin, maxWeekendMin: preset.maxWeekendMin,
  } });
  assert.equal(saved.mode, 'basic');
  // ① 시험: 과목·날짜(·범위)만 보냄 — 난이도·선호 요일·색상·종류·우선순위는 안 보냄
  const e1 = await api('/exams', { method: 'POST', body: { subject: '국어', date: '2026-12-01', scope: '1단원 문학, 2단원 문법' } });
  await api('/exams', { method: 'POST', body: { subject: '수학', date: '2026-12-02' } });
  assert.deepEqual([e1.difficulty, e1.pref_days, e1.kind, e1.priority], [3, '', 'naesin', 'normal']);
  assert.match(e1.color, /^#[0-9a-f]{6}$/i);

  const r = await api('/generate', { method: 'POST', body: { startDate: MON, today: MON } });
  assert.ok(r.created > 0);
  const day = await api('/day/2026-11-17'); // 화요일: 학교 + 학원
  const study = day.tasks.filter((t) => t.start != null);
  assert.ok(study.length > 0);
  assert.deepEqual(day.fixed.map((f) => f.label), ['학교', '저녁', '수학학원']);
  for (const t of study) for (const f of day.fixed) {
    const pad = f.buffer ? saved.bufferMin : 0;
    assert.ok(t.end <= f.start - pad || t.start >= f.end + pad, `${S.toHM(t.start)} 공부가 ${f.label}과 겹침`);
  }
  assert.ok(study.reduce((a, t) => a + t.end - t.start, 0) <= saved.maxWeekdayMin);
  assert.equal(day.settings.mode, 'basic');
});

test('API: /api/week 는 7일 치를 한 번에, 각 항목은 /api/day와 같은 형태', async () => {
  const w = await api('/week?from=' + WK);
  assert.equal(w.from, WK);
  assert.equal(w.to, SAT);
  assert.deepEqual(w.days.map((d) => d.date), Array.from({ length: 7 }, (_, i) => S.addDays(WK, i)));
  assert.deepEqual([S.dow(w.from), S.dow(w.to)], [0, 6]); // 일요일 ~ 토요일
  for (const d of w.days) assert.deepEqual(d, await api('/day/' + d.date));
  assert.ok(w.days.some((d) => d.tasks.length > 0));
  // 일요일이 아니어도 그 날짜부터 7일, 달이 바뀌는 주도 됨
  const w2 = await api('/week?from=2026-11-28');
  assert.deepEqual([w2.days[0].date, w2.days[6].date], ['2026-11-28', '2026-12-04']);
  await assert.rejects(api('/week?from=2026-13-01'), /400/);
  await assert.rejects(api('/week'), /400/);
});

test('API: 주 마지막 날(토요일) 할 일을 미루면 다음 주 일요일로 간다', async () => {
  const before = await api('/week?from=' + WK);
  const t = before.days[6].tasks.find((x) => x.kind === 'study');
  assert.ok(t, '토요일에 공부 할 일이 있어야 함');
  assert.equal(t.date, SAT);
  await api('/tasks/' + t.id, { method: 'PATCH', body: { date: S.addDays(t.date, 1) } });
  const after = await api('/week?from=' + WK);
  assert.ok(!after.days.flatMap((d) => d.tasks).some((x) => x.id === t.id), '이번 주에서 빠져야 함');
  assert.equal(after.days[6].tasks.length, before.days[6].tasks.length - 1);
  const next = await api('/week?from=' + NEXT_SUN);
  const moved = next.days[0].tasks.find((x) => x.id === t.id);
  assert.ok(moved, '다음 주 일요일에 있어야 함');
  assert.deepEqual([moved.date, moved.title, moved.start, moved.done], [NEXT_SUN, t.title, t.start, 0]);
});

test('플래너 보기(하루|일주일) 저장: plannerView는 day | week, 그 외는 day', async () => {
  assert.equal(S.sanitizeSettings({}).plannerView, 'day');
  assert.equal(S.sanitizeSettings({ plannerView: 'week' }).plannerView, 'week');
  assert.equal(S.sanitizeSettings({ plannerView: 'month' }).plannerView, 'day');
  const s = await api('/settings');
  assert.equal(s.plannerView, 'day');
  const saved = await api('/settings', { method: 'PUT', body: { ...s, plannerView: 'week' } });
  assert.deepEqual(saved, { ...s, plannerView: 'week' }); // 보기 말고는 그대로
  assert.equal((await api('/day/' + MON)).settings.plannerView, 'week');
  await api('/settings', { method: 'PUT', body: s });
});

test('API: 모드를 바꿔도 시험·할 일·설정 데이터는 그대로', async () => {
  const snap = async () => ({ exams: await api('/exams'), week: (await api('/week?from=' + WK)).days.map((d) => d.tasks), s: await api('/settings') });
  const a = await snap();
  await api('/settings', { method: 'PUT', body: { ...a.s, mode: 'expert' } });
  const b = await snap();
  assert.deepEqual(b.exams, a.exams);
  assert.deepEqual(b.week, a.week);
  assert.deepEqual({ ...b.s, mode: 'basic' }, a.s);
  // 기본 모드에서 프리셋으로 채운 값이 전문가 설정에 그대로 보임
  assert.deepEqual([b.s.maxWeekdayMin, b.s.maxWeekendMin, b.s.examDay, b.s.bufferMin], [240, 480, { start: '08:20', end: '12:30' }, 30]);
});
