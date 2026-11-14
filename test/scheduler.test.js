// scheduler.js 단위 테스트 (node --test)
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../scheduler');

// 2026-11-16 = 월요일. 학원: 월·수 19:00~21:00
const settings = (over = {}) => S.sanitizeSettings({
  academies: [{ name: '수학학원', days: [1, 3], start: '19:00', end: '21:00' }],
  ...over,
});
const START = '2026-11-16';
const timed = (plan) => plan.filter((t) => t.start != null);
const studyOf = (plan, id) => plan.filter((t) => t.kind === 'study' && t.exam_id === id);
const overlaps = (a, b) => a.start < b.end && b.start < a.end;

test('학교·학원·저녁 시간과 공부 블록이 겹치지 않는다 (이동 여유 시간 포함)', () => {
  const s = settings();
  const exams = [
    { id: 1, subject: '수학', date: '2026-11-25', difficulty: 4, scope: '' },
    { id: 2, subject: '국어', date: '2026-11-27', difficulty: 3, scope: '' },
  ];
  const plan = S.generatePlan({ settings: s, exams, startDate: START });
  assert.ok(timed(plan).length > 0, '공부 블록이 하나 이상 생겨야 함');
  const kinds = new Set();
  for (const t of timed(plan)) {
    const todays = exams.filter((e) => e.date === t.date);
    for (const f of S.fixedBlocksFor(t.date, s, todays)) {
      kinds.add(f.kind);
      const pad = f.buffer ? s.bufferMin : 0;
      const busy = { start: f.start - pad, end: f.end + pad };
      assert.ok(!overlaps(t, busy), `${t.date} ${S.toHM(t.start)}~${S.toHM(t.end)} 이(가) ${f.label}과 겹침`);
    }
  }
  // 학교·학원·저녁이 실제로 검사 대상에 들어갔는지
  for (const k of ['school', 'academy', 'meal', 'exam']) assert.ok(kinds.has(k), `${k} 일정이 검사되지 않음`);
  // 같은 날 공부 블록끼리도 겹치지 않음
  const byDate = {};
  for (const t of timed(plan)) (byDate[t.date] ||= []).push(t);
  for (const list of Object.values(byDate)) {
    list.sort((a, b) => a.start - b.start);
    for (let i = 1; i < list.length; i++) assert.ok(list[i].start >= list[i - 1].end);
  }
});

test('직접 추가한 일정(keepTasks)의 시간은 피한다', () => {
  const s = settings();
  const keep = { date: '2026-11-21', start: S.toMin('14:00'), end: S.toMin('16:00') };
  const plan = S.generatePlan({ settings: s, exams: [{ id: 1, subject: '수학', date: '2026-11-25', difficulty: 3 }], keepTasks: [keep], startDate: START });
  for (const t of timed(plan).filter((t) => t.date === keep.date)) assert.ok(!overlaps(t, keep));
});

test('시험이 가까운 과목에 블록이 더 많이 배정된다 (난이도 같음)', () => {
  const plan = S.generatePlan({ settings: settings(), startDate: START, exams: [
    { id: 1, subject: '가까운', date: '2026-11-24', difficulty: 3 },
    { id: 2, subject: '먼', date: '2026-12-04', difficulty: 3 },
  ] });
  // 공정하게 비교하려고 두 과목 모두 아직 시험 전인 기간만 센다
  const before = (id) => studyOf(plan, id).filter((t) => t.date < '2026-11-24').length;
  assert.ok(before(1) > before(2), `가까운 ${before(1)} vs 먼 ${before(2)}`);
});

test('어려운 과목에 블록이 더 많이 배정된다 (시험일 같음)', () => {
  const plan = S.generatePlan({ settings: settings(), startDate: START, exams: [
    { id: 1, subject: '어려운', date: '2026-11-27', difficulty: 5 },
    { id: 2, subject: '쉬운', date: '2026-11-27', difficulty: 1 },
  ] });
  const a = studyOf(plan, 1).length, b = studyOf(plan, 2).length;
  assert.ok(a > b, `어려운 ${a} vs 쉬운 ${b}`);
});

test('선호 요일(pref_days)엔 그 과목이 더 많이 배치되고, 시험 2일 전부터는 무시된다', () => {
  const s = settings();
  const examDate = '2026-12-04'; // 금요일
  const prefDow = S.dow(S.addDays(examDate, -1)); // D-1 요일(목)을 선호 요일로 → D-1에선 무시돼야 함
  const base = [
    { id: 1, subject: '선호', date: examDate, difficulty: 3, pref_days: String(prefDow) },
    { id: 2, subject: '비교', date: examDate, difficulty: 3 },
  ];
  const plan = S.generatePlan({ settings: s, exams: base, startDate: START });

  // 시험 3일 이상 남은 날: 선호 요일 vs 다른 요일의 '선호' 과목 비율
  const share = (pick) => {
    let mine = 0, all = 0;
    for (const t of plan.filter((t) => t.kind === 'study' && S.diffDays(t.date, examDate) > 2 && pick(S.dow(t.date)))) {
      all++; if (t.exam_id === 1) mine++;
    }
    return mine / all;
  };
  const onPref = share((d) => d === prefDow), offPref = share((d) => d !== prefDow);
  assert.ok(onPref > offPref, `선호 요일 비율 ${onPref.toFixed(2)} vs 다른 요일 ${offPref.toFixed(2)}`);
  assert.ok(onPref > 0.5 && offPref < 0.5);

  // 시험 2일 전부터는 pref_days가 없을 때와 배치가 똑같아야 함
  const noPref = S.generatePlan({ settings: s, exams: base.map((e) => ({ ...e, pref_days: '' })), startDate: START });
  const near = (p) => p.filter((t) => t.kind === 'study' && S.diffDays(t.date, examDate) <= 2)
    .map((t) => `${t.date} ${t.start} ${t.exam_id}`);
  assert.ok(near(plan).length > 0);
  assert.deepEqual(near(plan), near(noPref));
});

test('[개념] → [문제] → [총정리] 순서, D-1 할 일과 시험 당일 할 일이 생긴다', () => {
  const exam = { id: 7, subject: '과학', date: '2026-11-27', difficulty: 4, scope: '1단원 힘과 운동; 2단원 에너지; 3단원 전기' };
  const plan = S.generatePlan({ settings: settings(), exams: [exam], startDate: START });
  const list = studyOf(plan, 7).sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
  const d1 = S.addDays(exam.date, -1);

  const stage = (t) => (t.title.startsWith('[개념]') ? 0 : t.title.startsWith('[문제]') ? 1 : t.title.startsWith('[총정리]') ? 2 : -1);
  const stages = list.filter((t) => t.date !== d1).map(stage);
  assert.ok(!stages.includes(-1), '단계 제목이 없는 블록이 있음');
  for (const st of [0, 1, 2]) assert.ok(stages.includes(st), `단계 ${st}가 없음`);
  for (let i = 1; i < stages.length; i++) assert.ok(stages[i] >= stages[i - 1], `순서가 거꾸로: ${stages.join(',')}`);
  // 시험 범위 단원이 [개념] 제목에 고르게 들어감
  for (const u of ['1단원 힘과 운동', '2단원 에너지', '3단원 전기']) {
    assert.ok(list.some((t) => t.title === `[개념] ${u} — 교과서·필기 정리`), `[개념] ${u} 없음`);
  }

  const d1Tasks = list.filter((t) => t.date === d1);
  assert.ok(d1Tasks.length > 0, 'D-1 할 일이 없음');
  assert.ok(d1Tasks.every((t) => t.title.startsWith('D-1')));

  const finals = plan.filter((t) => t.date === exam.date && t.kind === 'final');
  assert.equal(finals.length, 1);
  assert.equal(finals[0].start, null);
  assert.equal(finals[0].exam_id, 7);
  // 마지막 시험 당일엔 공부 블록을 만들지 않음
  assert.equal(plan.filter((t) => t.date === exam.date && t.start != null).length, 0);
});

test('하루 최대 공부량(maxWeekdayMin / maxWeekendMin)을 넘지 않는다', () => {
  for (const [wd, we] of [[120, 200], [240, 480], [90, 90]]) {
    const s = settings({ maxWeekdayMin: wd, maxWeekendMin: we });
    const exams = [
      { id: 1, subject: '수학', date: '2026-11-25', difficulty: 5 },
      { id: 2, subject: '영어', date: '2026-11-30', difficulty: 4 },
    ];
    const keep = [{ date: '2026-11-22', start: S.toMin('10:00'), end: S.toMin('11:00') }]; // 일요일에 직접 넣은 60분
    const plan = S.generatePlan({ settings: s, exams, keepTasks: keep, startDate: START });
    const sum = {};
    for (const t of timed(plan)) sum[t.date] = (sum[t.date] || 0) + (t.end - t.start);
    let hitCap = false;
    for (const [date, min] of Object.entries(sum)) {
      const schoolDay = s.school[S.dow(date)].on || exams.some((e) => e.date === date);
      const keptMin = keep.filter((k) => k.date === date).reduce((a, k) => a + k.end - k.start, 0);
      const cap = (schoolDay ? wd : we) - keptMin;
      assert.ok(min <= cap, `${date}: ${min}분 > 한도 ${cap}분 (설정 ${wd}/${we})`);
      if (min > cap - 30) hitCap = true;
    }
    assert.ok(hitCap, `한도까지 채운 날이 없음 (설정 ${wd}/${we}) — 검사가 의미 없음`);
  }
});
