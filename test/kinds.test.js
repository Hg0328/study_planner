// 시험 종류·우선순위·장기 시험 최소 비중·28일 생성 (scheduler + presets)
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../scheduler');
const P = require('../public/presets');

const START = '2026-11-16'; // 월요일
const settings = (over = {}) => S.sanitizeSettings({ academies: [{ name: '학원', days: [1, 3], start: '19:00', end: '21:00' }], ...over });
const studyOf = (plan, id) => plan.filter((t) => t.kind === 'study' && t.exam_id === id)
  .sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
const stageName = (t) => (t.title.match(/^\[([^\]]+)\]/) || [])[1];

test('presets: 종류별 단계 비율 합은 100, 생활 유형 기본값과 설정 허용 목록', () => {
  for (const id of P.KIND_IDS) {
    const st = P.EXAM_KINDS[id].stages;
    if (st) assert.equal(st.reduce((a, s) => a + s.ratio, 0), 100, id);
  }
  assert.deepEqual(P.EXAM_KINDS.naesin.stages.map((s) => [s.name, s.ratio]), [['개념', 45], ['문제', 35], ['총정리', 20]]);
  assert.deepEqual(P.EXAM_KINDS.suneung.stages.map((s) => [s.name, s.ratio]), [['개념', 30], ['기출', 40], ['실전모의', 30]]);
  assert.deepEqual(P.EXAM_KINDS.college.stages.map((s) => [s.name, s.ratio]), [['강의복습', 40], ['연습문제', 35], ['요약', 25]]);
  assert.deepEqual(P.EXAM_KINDS.cert.stages.map((s) => [s.name, s.ratio]), [['이론', 35], ['기출', 45], ['모의고사', 20]]);
  assert.deepEqual(P.EXAM_KINDS.civil.stages.map((s) => [s.name, s.ratio]), [['1회독', 35], ['2회독·기출', 40], ['모의고사', 25]]);
  // 기존 사용자(설정에 lifeType 없음) → 중·고등학생, 잘못된 값은 걸러짐
  const d = S.sanitizeSettings({});
  assert.equal(d.lifeType, 'student');
  assert.deepEqual(d.examKinds, ['naesin']);
  assert.equal(d.minLongShare, 20);
  const x = S.sanitizeSettings({ lifeType: 'hacker', examKinds: ['cert', 'nope', 'cert'], minLongShare: 99 });
  assert.equal(x.lifeType, 'student');
  assert.deepEqual(x.examKinds, ['cert']);
  assert.equal(x.minLongShare, 50);
  // 고정 일정 이름
  assert.equal(S.fixedBlocksFor('2026-11-16', S.sanitizeSettings({ lifeType: 'worker' }))[0].label, '근무');
  assert.equal(S.fixedBlocksFor('2026-11-16', S.sanitizeSettings({}))[0].label, '학교');
});

test('presets: 직접 설정 단계 정리 (2~4개, 비율 합 100으로 맞춤)', () => {
  assert.deepEqual(P.cleanStages([{ name: '이론', ratio: 1 }, { name: '문제', ratio: 1 }]), [{ name: '이론', ratio: 50 }, { name: '문제', ratio: 50 }]);
  assert.equal(P.cleanStages([{ name: '하나', ratio: 100 }]), null);
  const st = P.cleanStages('[{"name":"A","ratio":30},{"name":"B","ratio":30},{"name":"C","ratio":30}]');
  assert.equal(st.reduce((a, s) => a + s.ratio, 0), 100);
  assert.equal(P.examLabel({ subject: '수학', kind: 'suneung' }, [{ kind: 'naesin' }, { kind: 'suneung' }]), '수학 · 수능');
  assert.equal(P.examLabel({ subject: '수학', kind: 'naesin' }, [{ kind: 'naesin' }, { kind: 'naesin' }]), '수학'); // 종류 1개면 안 붙임
  // 직접 설정은 화면에서 "· 기타", 진행률 소제목은 "기타 시험"
  assert.equal(P.examLabel({ subject: '한국사능력검정', kind: 'custom' }, [{ kind: 'naesin' }, { kind: 'custom' }]), '한국사능력검정 · 기타');
  assert.equal(P.kindGroupLabel('custom'), '기타 시험');
  assert.equal(P.kindGroupLabel('suneung'), '수능·모의고사');
  assert.equal(P.kindGroupLabel(undefined), '내신');
});

test('종류별 단계 이름과 비율대로 할 일이 배정된다 (직접 설정 포함)', () => {
  const custom = JSON.stringify([{ name: '읽기', ratio: 50 }, { name: '쓰기', ratio: 30 }, { name: '점검', ratio: 20 }]);
  for (const kind of [...P.KIND_IDS]) {
    const exam = { id: 1, subject: '과목', date: '2026-12-11', difficulty: 3, scope: 'A파트; B파트', kind, stages: kind === 'custom' ? custom : '' };
    const plan = S.generatePlan({ settings: settings(), exams: [exam], startDate: START });
    const list = studyOf(plan, 1);
    const N = list.length;
    const stages = P.stagesFor(exam);
    if (kind === 'custom') assert.deepEqual(stages.map((s) => s.name), ['읽기', '쓰기', '점검']);
    const body = list.filter((t) => S.diffDays(t.date, exam.date) !== 1); // D-1은 별도 제목
    const names = body.map(stageName);
    // 단계 순서대로만 등장
    const order = names.map((n) => stages.findIndex((s) => s.name === n));
    assert.ok(!order.includes(-1), `${kind}: 모르는 단계 ${names}`);
    for (let i = 1; i < order.length; i++) assert.ok(order[i] >= order[i - 1], `${kind}: 순서 ${names}`);
    // 비율: 단계별 블록 수가 N×비율과 1블록 이내로 같음 (D-1 블록은 마지막 쪽 번호를 차지)
    const counts = S.stageCounts(N, stages);
    let acc = 0;
    stages.forEach((s, i) => { acc += s.ratio; assert.ok(Math.abs(counts.slice(0, i + 1).reduce((a, b) => a + b, 0) - (N * acc) / 100) <= 1, `${kind} ${s.name}`); });
    // 범위 항목이 첫 단계 제목에 들어감
    assert.ok(body.some((t) => t.title.startsWith(`[${stages[0].name}] A파트`)), `${kind}: 범위 항목 없음`);
  }
});

test('전체 블록 수가 단계 수보다 적으면 마지막 단계부터 배정된다', () => {
  const st = P.EXAM_KINDS.naesin.stages;
  assert.deepEqual(S.stageCounts(1, st), [0, 0, 1]);
  assert.deepEqual(S.stageCounts(2, st), [0, 1, 1]);
  assert.deepEqual(S.stageCounts(3, st), [1, 1, 1]);
  assert.deepEqual(S.stageCounts(0, st), [0, 0, 0]);
  // 실제 계획: 하루 한 블록만 생기는 조건(블록 1개)에서 마지막 단계 제목
  const s = settings({ maxWeekdayMin: 50, maxWeekendMin: 50, reviewSlot: false });
  const plan = S.generatePlan({ settings: s, exams: [{ id: 1, subject: '수학', date: '2026-11-19', difficulty: 3, kind: 'suneung' }], startDate: '2026-11-17' });
  const list = studyOf(plan, 1); // 11-17(D-2) 1개 + 11-18(D-1) 1개
  assert.equal(list.length, 2); // 블록 2개 → 뒤의 두 단계(기출·실전모의)만 사용, 개념은 건너뜀
  assert.match(list[0].title, /^\[기출\]/);
  const ex = { kind: 'suneung', scope: '' };
  assert.equal(S.stageTitle(ex, 0, 1), '[실전모의] 실전 모의고사 시간 재고 풀기'); // 블록 1개 → 마지막 단계
});

test('내신 할 일 제목은 기존 형식 그대로', () => {
  const plan = S.generatePlan({ settings: settings(), exams: [{ id: 1, subject: '국어', date: '2026-11-27', difficulty: 3, scope: '1단원; 2단원 문법' }], startDate: START });
  const titles = new Set(studyOf(plan, 1).map((t) => t.title));
  assert.ok(titles.has('[개념] 1단원 — 교과서·필기 정리'));
  assert.ok(titles.has('[문제] 2단원 문법 — 학습지·기출 풀이'));
  assert.ok(titles.has('[총정리] 오답노트 & 핵심 암기 정리'));
});

test('우선순위 높음 ×1.5 > 보통 ×1 > 낮음 ×0.6', () => {
  const exams = ['high', 'normal', 'low'].map((p, i) => ({ id: i + 1, subject: `과목${i}`, date: '2026-12-04', difficulty: 3, priority: p }));
  const plan = S.generatePlan({ settings: settings(), exams, startDate: START });
  const [h, n, l] = [1, 2, 3].map((id) => studyOf(plan, id).length);
  assert.ok(h > n && n > l, `높음 ${h} / 보통 ${n} / 낮음 ${l}`);
  // 비율이 가중치와 비슷한지 (1.5 : 1 : 0.6 → 높음/낮음 ≈ 2.5)
  assert.ok(h / l > 1.8 && h / l < 3.2, `높음/낮음 = ${(h / l).toFixed(2)}`);
  // 우선순위가 없거나 이상한 값이면 보통과 같음
  const plain = S.generatePlan({ settings: settings(), exams: exams.map((e) => ({ ...e, priority: e.priority === 'normal' ? 'weird' : e.priority })), startDate: START });
  assert.equal(studyOf(plain, 2).length, n);
});

test('장기 시험(60일 이상) 최소 비중 보장, D-3 이내 시험이 있는 날은 해제, 0%면 끔', () => {
  const exams = [
    { id: 1, subject: '수학', date: '2027-03-02', difficulty: 1, kind: 'suneung', priority: 'low' }, // 장기
    { id: 2, subject: '국어', date: '2026-11-30', difficulty: 5, priority: 'high' },                  // 단기
  ];
  const on = S.generatePlan({ settings: settings({ minLongShare: 20 }), exams, startDate: START });
  const off = S.generatePlan({ settings: settings({ minLongShare: 0 }), exams, startDate: START });
  const days = [...new Set(on.filter((t) => t.kind === 'study').map((t) => t.date))].filter((d) => d < '2026-11-30');
  let guarded = 0, released = 0, shortfallWithout = 0;
  for (const d of days) {
    const n = on.filter((t) => t.date === d && t.kind === 'study').length;
    const longOn = on.filter((t) => t.date === d && t.exam_id === 1).length;
    const longOff = off.filter((t) => t.date === d && t.exam_id === 1).length;
    const need = Math.min(n - 1, Math.ceil(n * 0.2));
    if (S.diffDays(d, '2026-11-30') <= 3) {
      released++;
      assert.equal(longOn, longOff, `${d}: D-3 이내인데 최소 비중이 적용됨`);
    } else {
      guarded++;
      assert.ok(longOn >= need, `${d}: 장기 ${longOn} < 최소 ${need} (블록 ${n})`);
      if (longOff < need) shortfallWithout++;
    }
  }
  assert.ok(guarded > 0 && released > 0);
  assert.ok(shortfallWithout > 0, '0%일 때 부족한 날이 없어서 검사가 의미 없음');
  // 함수 단위: 블록 5개, 20% → 1개 보장 / 시험 당일이면 해제
  assert.deepEqual(S.allocateWithLongShare(5, [0.01, 10], [90, 10], false, 20), [1, 4]);
  assert.deepEqual(S.allocateWithLongShare(5, [0.01, 10], [90, 3], false, 20), [0, 5]);
  assert.deepEqual(S.allocateWithLongShare(5, [0.01, 10], [90, 10], true, 20), [0, 5]);
});

// 서버의 이어 생성과 같은 계산: 진도 = 완료 수 + (계획 시작일 ~ 이어 생성 시작 전날) 미완료 자동 공부 수
const key = (t) => `${t.date} ${t.start} ${t.exam_id} ${t.title}`;
test('28일 생성 + 이어 생성 = 한 번에 생성 (중간에 완료·직접 추가·설정 변경이 없을 때)', () => {
  const s = settings();
  const exams = [
    { id: 1, subject: '수학', date: '2027-02-20', difficulty: 4, kind: 'suneung', scope: '수열; 미분; 적분' },
    { id: 2, subject: '토익', date: '2027-01-10', difficulty: 3, kind: 'cert', scope: 'LC; RC' },
    { id: 3, subject: '영어', date: '2026-12-08', difficulty: 3, scope: '1과; 2과; 3과' },
  ];
  const full = S.buildPlan({ settings: s, exams, startDate: START }).all;
  const stored = [];
  let planUntil = S.addDays(START, 27);
  stored.push(...S.buildPlan({ settings: s, exams, startDate: START, until: planUntil }).tasks);
  assert.ok(stored.every((t) => t.date <= planUntil), '28일 밖 할 일이 저장됨');
  // 남은 기간이 14일 미만이 되는 날마다 이어 생성
  for (let today = START; today <= '2027-02-20'; today = S.addDays(today, 1)) {
    if (!(S.diffDays(today, planUntil) < 14) || planUntil >= '2027-02-20') continue;
    const start = S.addDays(planUntil, 1), until = S.addDays(today, 27);
    const doneCount = {};
    for (const t of stored) if (t.kind === 'study' && t.date < start) doneCount[t.exam_id] = (doneCount[t.exam_id] || 0) + 1;
    const r = S.buildPlan({ settings: s, exams: exams.filter((e) => e.date >= start), startDate: start, until, doneCount });
    assert.ok(r.tasks.every((t) => t.date >= start && t.date <= until));
    stored.push(...r.tasks);
    planUntil = until < '2027-02-20' ? until : '2027-02-20';
  }
  assert.deepEqual(stored.map(key), full.map(key));
});

test('완료한 블록이 있으면 재생성 때 진도가 완료 수만큼 이어진다', () => {
  const s = settings();
  const exam = { id: 1, subject: '수학', date: '2027-01-20', difficulty: 4, kind: 'suneung', scope: '수열과 급수; 미분법 응용; 적분법 응용' };
  const first = studyOf(S.buildPlan({ settings: s, exams: [exam], startDate: START, until: S.addDays(START, 27) }).tasks, 1);
  // 처음 10일 동안의 블록 중 k개 완료 → 11일째 재생성
  const today = S.addDays(START, 10);
  const doneTasks = first.filter((t) => t.date < today).slice(0, 15);
  const k = doneTasks.length;
  const r = S.buildPlan({ settings: s, exams: [exam], keepTasks: doneTasks.filter((t) => t.date >= today), startDate: today, until: S.addDays(today, 27), doneCount: { 1: k } });
  const all = studyOf(r.all, 1);
  const N = k + all.length;
  const stages = P.stagesFor(exam);
  const counts = S.stageCounts(N, stages);
  // 새 계획의 첫 블록 = 진도 k번째 제목 (개념 단계에서 k만큼 지나간 범위 항목)
  assert.equal(all[0].title, S.stageTitle(exam, k, N));
  const units = ['수열과 급수', '미분법 응용', '적분법 응용'];
  assert.equal(all[0].title, `[개념] ${units[Math.floor((k * units.length) / counts[0])]} — 개념·EBS 정리`);
  // [개념] 블록 수 = 전체 개념 몫 - 이미 완료한 수
  assert.equal(all.filter((t) => stageName(t) === '개념').length, counts[0] - k);
  // 완료 수를 안 넣으면 처음부터 다시 시작 (= 진도 이어가기가 실제로 작동하고 있음)
  const fresh = studyOf(S.buildPlan({ settings: s, exams: [exam], startDate: today }).all, 1);
  const conceptOf = (l) => l.filter((t) => stageName(t) === '개념').length;
  assert.ok(conceptOf(fresh) > conceptOf(all), `완료 반영 개념 ${conceptOf(all)} vs 처음부터 ${conceptOf(fresh)}`);
});

test('예상 공부 시간(simMin)은 끝까지 계산한 값이고 until과 무관', () => {
  const s = settings();
  const exams = [{ id: 1, subject: '수학', date: '2027-02-20', difficulty: 4, kind: 'suneung' }];
  const a = S.buildPlan({ settings: s, exams, startDate: START, until: S.addDays(START, 27) });
  const b = S.buildPlan({ settings: s, exams, startDate: START });
  assert.equal(a.simMin[1], b.simMin[1]);
  assert.equal(a.simMin[1], studyOf(b.all, 1).reduce((x, t) => x + t.end - t.start, 0));
  assert.ok(a.tasks.length < a.all.length);
});

test('성능: 1년치 · 과목 30개 시뮬레이션', () => {
  const kinds = P.KIND_IDS.filter((k) => k !== 'custom');
  const exams = Array.from({ length: 30 }, (_, i) => ({
    id: i + 1, subject: `과목${i + 1}`, date: S.addDays(START, 30 + i * 11), difficulty: (i % 5) + 1,
    kind: kinds[i % kinds.length], priority: ['high', 'normal', 'low'][i % 3], scope: '1; 2; 3; 4',
  }));
  exams[29].date = S.addDays(START, 365);
  const s = settings();
  S.buildPlan({ settings: s, exams, startDate: START }); // 워밍업
  const runs = 5, t0 = performance.now();
  let r;
  for (let i = 0; i < runs; i++) r = S.buildPlan({ settings: s, exams, startDate: START, until: S.addDays(START, 27) });
  const ms = (performance.now() - t0) / runs;
  console.log(`# 성능: 365일 · 과목 30개 · 할 일 ${r.all.length}개 계산 → 평균 ${ms.toFixed(1)}ms (${runs}회)`);
  assert.ok(ms < 2000, `${ms}ms`);
});
