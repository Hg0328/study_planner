// 고급 설정(이동 시간 전/후, 쉬는 시간, 단계 비율, 마지막 복습 블록, 요일별 기상·취침, 과목별 하루 최대 블록)
// + 단계 올리기(공부량 점점 늘리기)
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const S = require('../scheduler');
const P = require('../public/presets');

const START = '2026-11-16'; // 월요일
const exams = [
  { id: 1, subject: '국어', date: '2026-12-11', difficulty: 3, scope: '1단원 문학; 2단원 문법; 3단원 비문학' },
  { id: 2, subject: '수학', date: '2026-12-14', difficulty: 4, scope: '' },
  { id: 3, subject: '영어', date: '2026-12-15', difficulty: 2, scope: '' },
];
const timed = (plan) => plan.filter((t) => t.start != null);
const minutesOn = (plan, date) => timed(plan).filter((t) => t.date === date).reduce((a, t) => a + t.end - t.start, 0);
const plan = (over = {}, extra = {}) => S.buildPlan({ settings: S.sanitizeSettings(over), exams, startDate: START, ...extra }).all;

// ── 설정 범위 검사 ──
test('고급 설정 범위 검사 (sanitizeSettings)', () => {
  const d = S.sanitizeSettings({});
  assert.deepEqual([d.bufferMin, d.bufferAfterMin, d.breakMin, d.reviewSlot, d.wakeSleep, d.maxBlocksPerSubject, d.ramp], [30, 30, 10, true, null, 0, 'off']);
  assert.deepEqual(d.stageRatios, {});
  // 끝난 뒤 이동 시간: 저장된 값이 없으면 가기 전 값과 같게 (직장인 60분 → 60분), 0~120
  assert.equal(S.sanitizeSettings({ bufferMin: 60 }).bufferAfterMin, 60);
  assert.equal(S.sanitizeSettings({ bufferMin: 60, bufferAfterMin: 15 }).bufferAfterMin, 15);
  assert.equal(S.sanitizeSettings({ bufferAfterMin: 500 }).bufferAfterMin, 120);
  assert.equal(S.sanitizeSettings({ bufferAfterMin: -5 }).bufferAfterMin, 0);
  assert.equal(S.sanitizeSettings({ breakMin: 99 }).breakMin, 60);
  // 과목별 하루 최대 블록 0~12
  assert.equal(S.sanitizeSettings({ maxBlocksPerSubject: 30 }).maxBlocksPerSubject, 12);
  assert.equal(S.sanitizeSettings({ maxBlocksPerSubject: 'x' }).maxBlocksPerSubject, 0);
  // 단계 올리기: off | slow | normal | fast
  for (const r of ['off', 'slow', 'normal', 'fast']) assert.equal(S.sanitizeSettings({ ramp: r }).ramp, r);
  assert.equal(S.sanitizeSettings({ ramp: 'turbo' }).ramp, 'off');
  // 요일별 기상·취침: 7개가 아니면 끔, 잘못된 시간은 매일 값으로
  assert.equal(S.sanitizeSettings({ wakeSleep: [{ wake: '06:00', sleep: '23:00' }] }).wakeSleep, null);
  const ws = S.sanitizeSettings({ wake: '06:30', wakeSleep: Array.from({ length: 7 }, (_, i) => ({ wake: i === 6 ? '25:00' : '08:00', sleep: '23:00' })) }).wakeSleep;
  assert.equal(ws.length, 7);
  assert.deepEqual([ws[0].wake, ws[6].wake], ['08:00', '06:30']);
  // 단계 비율: 합 100으로 맞춤, 기본값과 같으면 저장 안 함, 단계 수가 다르거나 5~90 밖이거나 모르는 종류면 버림
  const r = S.sanitizeSettings({ stageRatios: { naesin: [30, 30, 30], suneung: [30, 40, 30], cert: [50, 50], college: [2, 50, 48], custom: [50, 50], foo: [1, 2, 3] } }).stageRatios;
  assert.deepEqual(r, { naesin: [33, 33, 34] });
});

// ── 단계 올리기: 하루 상한 공식 ──
test('단계 올리기 하루 상한 = min(최대, 시작값 + 블록 × floor(지난 날 ÷ 주기))', () => {
  const s = (ramp) => S.sanitizeSettings({ ramp });
  const seq = (ramp, base) => Array.from({ length: 16 }, (_, i) => S.rampCap(s(ramp), base, S.addDays(START, i), START, []));
  // 천천히: 최대의 50%, 3일마다 +50분
  assert.deepEqual(seq('slow', 240).slice(0, 10), [120, 120, 120, 170, 170, 170, 220, 220, 220, 240]);
  // 보통: 최대의 50%, 2일마다 +50분
  assert.deepEqual(seq('normal', 240).slice(0, 7), [120, 120, 170, 170, 220, 220, 240]);
  assert.deepEqual(seq('normal', 480).slice(0, 11), [240, 240, 290, 290, 340, 340, 390, 390, 440, 440, 480]);
  // 빠르게: 블록 1개에서, 매일 +50분
  assert.deepEqual(seq('fast', 240).slice(0, 6), [50, 100, 150, 200, 240, 240]);
  // 끄기 / 시작일 없음 → 원래 최대 그대로
  assert.deepEqual(seq('off', 240).slice(0, 3), [240, 240, 240]);
  assert.equal(S.rampCap(s('normal'), 240, START, '', []), 240);
  // 시험이 7일 안이면 풀림 (8일 남으면 그대로)
  assert.equal(S.rampCap(s('fast'), 240, START, START, [7]), 240);
  assert.equal(S.rampCap(s('fast'), 240, START, START, [8]), 50);
  // 블록 길이를 바꾸면 늘리는 폭도 블록 길이
  assert.equal(S.rampCap(S.sanitizeSettings({ ramp: 'fast', blockMin: 30 }), 240, S.addDays(START, 2), START, []), 90);
});

test('단계 올리기 계획: 하루 공부량이 점점 늘고, 시험 7일 전부터는 최대 공부량', () => {
  const s = S.sanitizeSettings({ ramp: 'normal' });
  const ramped = S.buildPlan({ settings: s, exams, startDate: START, rampStart: START }).all;
  const full = plan();
  const days = Array.from({ length: 22 }, (_, i) => S.addDays(START, i));
  for (const d of days) {
    const base = s.school[S.dow(d)].on ? s.maxWeekdayMin : s.maxWeekendMin;
    const dl = S.diffDays(d, '2026-12-11');
    const cap = S.rampCap(s, base, d, START, dl >= 0 ? [dl] : []);
    assert.ok(minutesOn(ramped, d) <= cap, `${d}: ${minutesOn(ramped, d)}분 > 상한 ${cap}분`);
    if (dl <= 7) assert.equal(minutesOn(ramped, d), minutesOn(full, d), `${d}: 시험 7일 안인데 단계 올리기가 적용됨`);
  }
  assert.ok(minutesOn(ramped, '2026-11-16') < minutesOn(full, '2026-11-16'));
  assert.ok(minutesOn(ramped, '2026-11-16') < minutesOn(ramped, '2026-11-20'), '평일 공부량이 늘어야 함');
  // 끄면 결과가 전과 같음 (시작일이 있어도)
  assert.deepEqual(S.buildPlan({ settings: S.sanitizeSettings({ ramp: 'off' }), exams, startDate: START, rampStart: START }).all, full);
});

test('단계 올리기를 켜도 완료·직접 추가한 일정은 그 시간을 피하고, 그만큼 상한에서 뺀다', () => {
  const s = S.sanitizeSettings({ ramp: 'fast' });
  const keep = [{ date: '2026-11-18', start: S.toMin('17:00'), end: S.toMin('17:50'), done: 1 }]; // 수요일 상한 150분
  const p = S.buildPlan({ settings: s, exams, keepTasks: keep, startDate: START, rampStart: START }).all;
  const wed = timed(p).filter((t) => t.date === '2026-11-18');
  for (const t of wed) assert.ok(t.end <= keep[0].start || t.start >= keep[0].end);
  assert.ok(minutesOn(p, '2026-11-18') <= 150 - 50, `${minutesOn(p, '2026-11-18')}분`);
});

// ── 고급 설정이 계획에 반영되는지 ──
test('이동 시간: 학교·학원 가기 전과 끝난 뒤를 따로', () => {
  const p = plan({ bufferMin: 0, bufferAfterMin: 90, maxWeekdayMin: 600, dinner: { start: '20:00', end: '20:30' } }); // 18:00이 저녁과 겹치지 않게
  const mon = timed(p).filter((t) => t.date === START);
  assert.ok(mon.length);
  assert.ok(mon.every((t) => t.end <= S.toMin('08:20') || t.start >= S.toMin('16:30') + 90), '학교 끝난 뒤 90분 안에 공부가 있음');
  assert.ok(mon.some((t) => t.start >= S.toMin('16:30') + 90 && t.start < S.toMin('16:30') + 100));
});

test('쉬는 시간: 이어지는 블록 사이 간격이 쉬는 시간 이상', () => {
  const p = plan({ breakMin: 25 });
  const sat = timed(p).filter((t) => t.date === '2026-11-21').sort((a, b) => a.start - b.start);
  assert.ok(sat.length >= 3);
  for (let i = 1; i < sat.length; i++) if (sat[i].start - sat[i - 1].end < 60) assert.ok(sat[i].start - sat[i - 1].end >= 25);
});

test('마지막 복습 블록 켜기/끄기', () => {
  assert.ok(plan().some((t) => t.kind === 'review'));
  assert.ok(!plan({ reviewSlot: false }).some((t) => t.kind === 'review'));
});

test('요일별 기상·취침: 토요일만 늦게 일어나면 토요일 공부는 그 뒤부터', () => {
  const ws = Array.from({ length: 7 }, (_, i) => (i === 6 ? { wake: '10:00', sleep: '23:30' } : { wake: '07:00', sleep: '23:30' }));
  const p = plan({ wakeSleep: ws });
  const first = (d) => Math.min(...timed(p).filter((t) => t.date === d).map((t) => t.start));
  assert.ok(first('2026-11-21') >= S.toMin('10:30'), `토요일 ${S.toHM(first('2026-11-21'))}`);
  assert.ok(first('2026-11-22') < S.toMin('10:00'), '일요일은 매일 값');
  assert.deepEqual(S.wakeSleepFor(S.sanitizeSettings({ wakeSleep: ws }), '2026-11-21'), { wake: '10:00', sleep: '23:30' });
});

test('과목별 하루 최대 블록: 한 과목이 하루에 그 수를 넘지 않음', () => {
  const p = plan({ maxBlocksPerSubject: 2 });
  const count = {};
  for (const t of p.filter((x) => x.kind === 'study')) { const k = t.date + t.exam_id; count[k] = (count[k] || 0) + 1; }
  assert.ok(Object.values(count).every((n) => n <= 2), JSON.stringify(Object.entries(count).filter(([, n]) => n > 2)));
  assert.deepEqual(S.capPerSubject([5, 1, 0], [3, 2, 1], 2), [2, 2, 2]);
  assert.deepEqual(S.capPerSubject([6, 0], [3, 1], 2), [2, 2]); // 다 차면 남은 블록은 버림
});

test('단계 비율 바꾸기: 내신 [개념] 비율을 20%로 줄이면 [개념] 블록이 줄어듦', () => {
  const concept = (p) => p.filter((t) => t.exam_id === 1 && t.title.startsWith('[개념]')).length;
  const base = plan(), changed = plan({ stageRatios: { naesin: [20, 40, 40] } });
  assert.ok(concept(changed) < concept(base), `${concept(changed)} vs ${concept(base)}`);
  const N = base.filter((t) => t.exam_id === 1 && t.kind === 'study').length;
  assert.equal(S.stageCounts(N, S.stagesOf(exams[0], { naesin: [20, 40, 40] }))[0], Math.ceil(N * 0.2));
});

// ── API: 단계 올리기 시작일 저장 ──
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'planner-adv-'));
const PORT = 3700 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}/api`;
let server, token;
async function api(p, { method = 'GET', body } = {}) {
  const r = await fetch(BASE + p, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body && JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(`${p} ${r.status} ${j.error}`);
  return j;
}
test.after(() => { server?.kill(); fs.rmSync(dir, { recursive: true, force: true }); });

test('API: 단계 올리기 시작일 — 처음 계획 만든 날 저장, A·B·C 바꿔도 유지, 끄면 지우고 다시 켠 날부터', async () => {
  server = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DB_PATH: path.join(dir, 't.db'), TURSO_DATABASE_URL: process.env.SIM_TURSO || '', ANTHROPIC_API_KEY: '' }, stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }
  token = (await api('/auth/signup', { method: 'POST', body: { username: 'rampuser', password: 'pw1234' } })).token;
  for (const e of exams) await api('/exams', { method: 'POST', body: e });
  // 끈 상태(기존 사용자와 같음): 시작일 없음
  assert.equal((await api('/generate', { method: 'POST', body: { startDate: START, today: START } })).rampStart, '');
  const s = await api('/settings');
  await api('/settings', { method: 'PUT', body: { ...s, ramp: 'normal' } });
  const r1 = await api('/generate', { method: 'POST', body: { startDate: START, today: START } });
  assert.equal(r1.rampStart, START);
  const mon = (await api('/day/' + START)).tasks.filter((t) => t.start != null).reduce((a, t) => a + t.end - t.start, 0);
  assert.ok(mon <= 120, `첫날 ${mon}분`);
  // 완료 1개 + 직접 추가 1개 → 다음 날 '빠르게'로 바꿔 재생성: 시작일 유지, 두 일정은 그대로
  const day2 = '2026-11-17';
  const t2 = (await api('/day/' + day2)).tasks.find((t) => t.kind === 'study');
  await api('/tasks/' + t2.id, { method: 'PATCH', body: { done: true } });
  const manual = await api('/tasks', { method: 'POST', body: { date: day2, title: '단어 외우기', start: S.toMin('21:00'), end: S.toMin('21:30') } });
  await api('/settings', { method: 'PUT', body: { ...(await api('/settings')), ramp: 'fast' } });
  const r2 = await api('/generate', { method: 'POST', body: { startDate: day2, today: day2 } });
  assert.equal(r2.rampStart, START);
  const after = (await api('/day/' + day2)).tasks;
  assert.ok(after.some((t) => t.id === t2.id && t.done === 1), '완료한 일정이 지워짐');
  assert.ok(after.some((t) => t.id === manual.id), '직접 추가한 일정이 지워짐');
  // 끄면 지우고, 다시 켜면 그 뒤 처음 계획을 만든 날부터
  await api('/settings', { method: 'PUT', body: { ...(await api('/settings')), ramp: 'off' } });
  assert.equal((await api('/generate', { method: 'POST', body: { startDate: day2, today: day2 } })).rampStart, '');
  await api('/settings', { method: 'PUT', body: { ...(await api('/settings')), ramp: 'slow' } });
  assert.equal((await api('/generate', { method: 'POST', body: { startDate: '2026-11-19', today: '2026-11-19' } })).rampStart, '2026-11-19');
});

test('단계 올리기 단계는 presets 한 곳에 (기본 모드·전문가 모드 공용)', () => {
  assert.deepEqual(P.RAMP_IDS, ['off', 'slow', 'normal', 'fast']);
  assert.equal(P.RAMP_RELEASE_DAYS, 7);
});
