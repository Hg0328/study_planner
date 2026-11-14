// ─────────────────────────────────────────────
//  시험 공부 계획 자동 생성 알고리즘
// ─────────────────────────────────────────────
// 1) 하루마다 학교·학원·식사 시간을 빼고 "빈 시간"을 계산
// 2) 빈 시간을 공부 블록(기본 50분 + 쉬는 10분)으로 쪼갬
// 3) 과목별 가중치 = 난이도 ÷ √(시험까지 남은 일수) × 우선순위  (D-1, D-2는 추가 가중)
//    → 가까운 시험 + 어려운 과목일수록 많은 블록을 배정
//    장기 시험(60일 이상 남음)은 하루 블록의 최소 비중(minLongShare%)을 보장 (D-3 이내 시험이 있는 날 제외)
// 4) 같은 과목이 연달아 오지 않도록 번갈아 배치 (집중력 유지)
// 5) 시험 종류별 단계([개념]→[문제]→[총정리], 수능 [개념]→[기출]→[실전모의] 등, public/presets.js)로 제목을 붙이고
//    시험 범위 항목을 앞 단계들에 고르게 나눠 배정
// 6) 하루 마지막 블록은 "오늘 복습 & 오답노트", 시험 당일은 "최종 점검"
// 7) 계산은 항상 마지막 시험일까지 끝까지 해서(시뮬레이션) 단계 비율·예상 시간을 정하고,
//    저장은 until(오늘부터 최대 28일)까지만 → 나눠서 생성해도 진도가 이어짐
const P = require('./public/presets');

const DAY_KO = ['일', '월', '화', '수', '목', '금', '토'];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const DEFAULT_SETTINGS = {
  wake: '07:00',
  sleep: '23:30',
  school: [
    { on: false, start: '08:20', end: '16:30' }, // 일
    { on: true, start: '08:20', end: '16:30' },  // 월
    { on: true, start: '08:20', end: '16:30' },  // 화
    { on: true, start: '08:20', end: '16:30' },  // 수
    { on: true, start: '08:20', end: '16:30' },  // 목
    { on: true, start: '08:20', end: '16:30' },  // 금
    { on: false, start: '08:20', end: '16:30' }, // 토
  ],
  examDay: { start: '08:20', end: '12:30' }, // 시험 당일 학교에 있는 시간
  academies: [], // { name, days:[1,3], start, end }
  lunch: { start: '12:00', end: '13:00' },   // 학교 없는 날 점심
  dinner: { start: '18:00', end: '19:00' },
  bufferMin: 30,     // 학교·학원 전후 이동/휴식 시간
  blockMin: 50,      // 공부 블록 길이
  breakMin: 10,      // 블록 사이 쉬는 시간
  maxWeekdayMin: 240,
  maxWeekendMin: 480,
  reviewSlot: true,  // 하루 마지막 블록을 복습으로
  lifeType: 'student',     // 생활 유형 (presets.LIFE_TYPES)
  examKinds: ['naesin'],   // 준비하는 시험 종류 (시험 추가 칸 기본 선택지·추천 과목용)
  minLongShare: 20,        // 장기 시험 최소 비중 (%)
  // 꾸미기 (화면 테마·글꼴)
  theme: 'cream',
  handFont: 'pen',
  fontScale: 1,
};
const THEME_IDS = ['cream', 'cherry', 'mint', 'sky', 'lavender', 'lemon', 'night'];
const FONT_IDS = ['pen', 'gaegu', 'gamja', 'melody', 'yeonsung', 'jua', 'dohyeon', 'batang'];

const PALETTE = ['#e07a5f', '#81b29a', '#7fa7c9', '#f2b84b', '#b48ead', '#e8998d', '#6d9dc5', '#a3b86c', '#d4a373', '#9a8c98'];

// ── 날짜/시간 유틸 (타임존 영향을 받지 않도록 UTC 기준) ──
const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const toHM = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const utc = (ds) => { const [y, mo, d] = ds.split('-').map(Number); return Date.UTC(y, mo - 1, d); };
const dow = (ds) => new Date(utc(ds)).getUTCDay();
const addDays = (ds, n) => new Date(utc(ds) + n * 86400000).toISOString().slice(0, 10);
const diffDays = (a, b) => Math.round((utc(b) - utc(a)) / 86400000);

// ── 설정값 검증/정리 ──
function sanitizeSettings(input = {}) {
  const d = DEFAULT_SETTINGS;
  const time = (v, def) => (typeof v === 'string' && TIME_RE.test(v) ? v : def);
  const num = (v, def, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : def; };
  const range = (v, def) => ({ start: time(v?.start, def.start), end: time(v?.end, def.end) });
  const school = d.school.map((def, i) => {
    const v = (input.school || [])[i] || {};
    return { on: v.on === undefined ? def.on : !!v.on, start: time(v.start, def.start), end: time(v.end, def.end) };
  });
  const academies = (Array.isArray(input.academies) ? input.academies : []).slice(0, 20).map((a) => ({
    name: String(a?.name || '학원').slice(0, 20),
    days: (Array.isArray(a?.days) ? a.days : []).map(Number).filter((x) => x >= 0 && x <= 6),
    start: time(a?.start, '18:00'),
    end: time(a?.end, '20:00'),
  }));
  return {
    wake: time(input.wake, d.wake),
    sleep: time(input.sleep, d.sleep),
    school,
    examDay: range(input.examDay, d.examDay),
    academies,
    lunch: range(input.lunch, d.lunch),
    dinner: range(input.dinner, d.dinner),
    bufferMin: num(input.bufferMin, d.bufferMin, 0, 120),
    blockMin: num(input.blockMin, d.blockMin, 20, 120),
    breakMin: num(input.breakMin, d.breakMin, 0, 60),
    maxWeekdayMin: num(input.maxWeekdayMin, d.maxWeekdayMin, 0, 900),
    maxWeekendMin: num(input.maxWeekendMin, d.maxWeekendMin, 0, 900),
    reviewSlot: input.reviewSlot === undefined ? d.reviewSlot : !!input.reviewSlot,
    lifeType: P.LIFE_IDS.includes(input.lifeType) ? input.lifeType : d.lifeType,
    examKinds: (() => {
      const k = [...new Set((Array.isArray(input.examKinds) ? input.examKinds : []).filter((x) => P.KIND_IDS.includes(x)))];
      return k.length ? k : [...d.examKinds];
    })(),
    minLongShare: num(input.minLongShare, d.minLongShare, 0, 50),
    theme: THEME_IDS.includes(input.theme) ? input.theme : d.theme,
    handFont: FONT_IDS.includes(input.handFont) ? input.handFont : d.handFont,
    fontScale: [1, 1.1, 1.2].includes(Number(input.fontScale)) ? Number(input.fontScale) : d.fontScale,
  };
}

// ── 그날의 고정 일정 (학교/시험/학원/식사) ──
function fixedBlocksFor(date, s, examsToday = []) {
  const d = dow(date);
  const sc = s.school[d] || {};
  const out = [];
  if (examsToday.length) {
    out.push({ start: toMin(s.examDay.start), end: toMin(s.examDay.end), label: `시험 · ${examsToday.map((e) => e.subject).join(', ')}`, kind: 'exam', buffer: true });
    out.push({ start: toMin(s.lunch.start), end: toMin(s.lunch.end), label: '점심', kind: 'meal' });
  } else if (sc.on) {
    out.push({ start: toMin(sc.start), end: toMin(sc.end), label: P.fixedLabel(s.lifeType), kind: 'school', buffer: true });
  } else {
    out.push({ start: toMin(s.lunch.start), end: toMin(s.lunch.end), label: '점심', kind: 'meal' });
  }
  out.push({ start: toMin(s.dinner.start), end: toMin(s.dinner.end), label: '저녁', kind: 'meal' });
  for (const a of s.academies) {
    if (a.days.includes(d)) out.push({ start: toMin(a.start), end: toMin(a.end), label: a.name, kind: 'academy', buffer: true });
  }
  return out.filter((b) => b.end > b.start).sort((a, b) => a.start - b.start);
}

// ── 빈 시간 구간 계산 ──
function freeIntervals(s, busy) {
  const wake = toMin(s.wake);
  const dayStart = wake + 30; // 기상 후 30분은 준비 시간
  let dayEnd = toMin(s.sleep);
  if (dayEnd <= wake) dayEnd = 24 * 60;
  const bs = busy
    .map((b) => ({ start: b.start - (b.buffer ? s.bufferMin : 0), end: b.end + (b.buffer ? s.bufferMin : 0) }))
    .sort((a, b) => a.start - b.start);
  const res = [];
  let cur = dayStart;
  for (const b of bs) {
    if (b.end <= cur) continue;
    if (b.start > cur) res.push({ start: cur, end: Math.min(b.start, dayEnd) });
    cur = Math.max(cur, b.end);
    if (cur >= dayEnd) break;
  }
  if (cur < dayEnd) res.push({ start: cur, end: dayEnd });
  return res.filter((iv) => iv.end - iv.start >= 30);
}

// ── 빈 시간을 공부 블록으로 쪼개기 ──
function makeSlots(intervals, s, cap) {
  const slots = [];
  let used = 0;
  for (const iv of intervals) {
    let t = Math.ceil(iv.start / 5) * 5;
    while (iv.end - t >= 30 && cap - used >= 30) {
      const len = Math.min(s.blockMin, iv.end - t, cap - used);
      slots.push({ start: t, end: t + len });
      used += len;
      t = Math.ceil((t + len + s.breakMin) / 5) * 5;
    }
  }
  return slots;
}

// 최대 나머지 방식으로 블록 수를 가중치에 비례해 배분
function allocate(n, weights) {
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  const raw = weights.map((w) => (w / sum) * n);
  const c = raw.map(Math.floor);
  let left = n - c.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - c[i], i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; k < left; k++) c[order[k % order.length][1]]++;
  return c;
}

// 같은 과목이 연속되지 않도록 섞기
function interleave(counts) {
  const c = [...counts];
  const total = c.reduce((a, b) => a + b, 0);
  const res = [];
  let prev = -1;
  for (let k = 0; k < total; k++) {
    let best = -1;
    for (let i = 0; i < c.length; i++) if (c[i] > 0 && i !== prev && (best < 0 || c[i] > c[best])) best = i;
    if (best < 0) best = prev;
    res.push(best);
    c[best]--;
    prev = best;
  }
  return res;
}

// 범위 → 단원 목록. 항목이 ";"로 나뉘어 있으면 그 기준으로(자동 인식 결과), 아니면 쉼표 등으로
const splitUnits = (scope) => String(scope || '').split(/;/.test(scope || '') ? /[;\n]+/ : /[,\n/·]+/).map((x) => x.trim()).filter(Boolean)
  .reduce((acc, u) => { if (acc.length && u.length < 5) acc[acc.length - 1] += `, ${u}`; else acc.push(u); return acc; }, []);

// 단계 경계: 단계마다 최소 1블록. 전체 블록이 단계 수보다 적으면 마지막 단계(총정리·모의고사 등)부터 배정
function stageCounts(N, stages) {
  const S = stages.length;
  if (N <= 0) return stages.map(() => 0);
  if (N < S) return stages.map((_, i) => (i >= S - N ? 1 : 0));
  const counts = [];
  let prev = 0, cum = 0;
  for (let i = 0; i < S - 1; i++) {
    cum += stages[i].ratio;
    const b = Math.min(N - (S - 1 - i), Math.max(prev + 1, Math.ceil((N * cum) / 100)));
    counts.push(b - prev);
    prev = b;
  }
  counts.push(N - prev);
  return counts;
}

// 진도 번호(idx, 0부터)에 맞는 할 일 제목
function stageTitle(exam, idx, N) {
  const stages = P.stagesFor(exam);
  const counts = stageCounts(N, stages);
  const units = splitUnits(exam.scope);
  let base = 0;
  for (let i = 0; i < stages.length; i++) {
    const st = stages[i], c = counts[i];
    if (idx < base + c || i === stages.length - 1) {
      const p = Math.min(idx - base, Math.max(0, c - 1));
      if (!st.units) return `[${st.name}] ${st.detail}`;
      const firstUnitStage = stages.findIndex((x) => x.units) === i;
      const u = units.length ? units[Math.floor((p * units.length) / c)]
        : firstUnitStage ? `범위 전체 ${p + 1}/${c}` : `${st.name === '문제' ? '문제 세트' : '세트'} ${p + 1}`;
      return st.detail ? `[${st.name}] ${u} — ${st.detail}` : `[${st.name}] ${u}`;
    }
    base += c;
  }
  return '';
}

/**
 * @param settings  정리된 설정
 * @param exams     [{id, subject, date, difficulty, scope, kind, priority, stages, pref_days}]
 * @param keepTasks 이미 존재해서 유지되는 일정 (완료/직접 추가) — 시간이 겹치지 않게 피함
 * @param startDate 계획 시작일
 * @param until     이 날짜까지만 결과에 담음 (없으면 끝까지). 계산은 항상 마지막 시험일까지
 * @param doneCount { examId: 시작일 전까지 진행한 공부 블록 수 } — 진도 이어가기용
 * @returns { tasks: until까지의 할 일, all: 끝까지 계산한 할 일, simMin: {examId: 시작일 이후 예상 공부 분} }
 */
function buildPlan({ settings: s, exams, keepTasks = [], startDate, until = null, doneCount = {} }) {
  if (!exams.length) return { tasks: [], all: [], simMin: {} };
  const sorted = [...exams].sort((a, b) => a.date.localeCompare(b.date));
  const lastDate = sorted[sorted.length - 1].date;
  const out = [];

  for (let date = startDate; date <= lastDate; date = addDays(date, 1)) {
    const todays = sorted.filter((e) => e.date === date);
    const upcoming = sorted.filter((e) => e.date > date);
    const fixed = fixedBlocksFor(date, s, todays);
    const kept = keepTasks.filter((t) => t.date === date && t.start != null && t.end != null);

    // 시험 당일: 쉬는 시간용 최종 점검 (시간 지정 없음)
    for (const e of todays) {
      out.push({ date, start: null, end: null, exam_id: e.id, subject: e.subject, kind: 'final', title: `시험 직전 최종 점검 — 요약노트·오답 훑어보기 (쉬는 시간 활용)` });
    }
    if (!upcoming.length) continue;

    const busy = [...fixed, ...kept.map((t) => ({ start: t.start, end: t.end }))];
    const isSchoolDay = !!(s.school[dow(date)] || {}).on || todays.length > 0;
    const keptMin = kept.reduce((a, t) => a + (t.end - t.start), 0);
    const cap = Math.max(0, (isSchoolDay ? s.maxWeekdayMin : s.maxWeekendMin) - keptMin);
    let slots = makeSlots(freeIntervals(s, busy), s, cap);
    if (!slots.length) continue;

    let reviewSlot = null;
    if (s.reviewSlot && slots.length >= 3) {
      reviewSlot = slots[slots.length - 1];
      slots = slots.slice(0, -1);
    }

    const dls = upcoming.map((e) => diffDays(date, e.date));
    const weights = upcoming.map((e, i) => {
      const dl = dls[i];
      let w = (e.difficulty || 3) / Math.sqrt(dl);
      if (dl === 1) w *= 4;
      else if (dl === 2) w *= 1.6;
      // 선호 요일: 그 요일엔 이 과목 비중 ×3, 다른 요일엔 ×0.5 (시험 2일 전부터는 무시하고 시험 대비 우선)
      const pref = String(e.pref_days || '').split(',').filter(Boolean).map(Number);
      if (pref.length && dl > 2) w *= pref.includes(dow(date)) ? 3 : 0.5;
      w *= (P.PRIORITY[e.priority] || P.PRIORITY.normal).weight;
      return w;
    });
    const counts = allocateWithLongShare(slots.length, weights, dls, todays.length > 0, s.minLongShare ?? 0);
    const order = interleave(counts);
    slots.forEach((sl, i) => {
      const e = upcoming[order[i]];
      out.push({ date, start: sl.start, end: sl.end, exam_id: e.id, subject: e.subject, kind: 'study', title: '' });
    });
    if (reviewSlot) {
      out.push({ date, start: reviewSlot.start, end: reviewSlot.end, exam_id: null, subject: '복습', kind: 'review', title: '오늘 공부한 내용 복습 & 오답노트 정리' });
    }
  }

  // ── 과목별 단계/단원 제목 붙이기 (끝까지 계산한 전체 블록 수 기준) ──
  const simMin = {};
  for (const e of sorted) {
    const list = out.filter((t) => t.kind === 'study' && t.exam_id === e.id);
    simMin[e.id] = list.reduce((a, t) => a + (t.end - t.start), 0);
    const done = doneCount[e.id] || 0;
    const N = done + list.length;
    const d1Count = {};
    list.forEach((t, k) => {
      if (diffDays(t.date, e.date) === 1) {
        const c = (d1Count[t.date] = (d1Count[t.date] || 0) + 1);
        t.title = ['D-1 실전 모의 풀이 — 시간 재고 풀어보기', 'D-1 취약 단원 & 오답노트 최종 점검', 'D-1 핵심 암기 백지 테스트'][(c - 1) % 3];
        return;
      }
      t.title = stageTitle(e, done + k, N);
    });
  }
  return { tasks: until ? out.filter((t) => t.date <= until) : out, all: out, simMin };
}

// 장기 시험 최소 비중: 60일 이상 남은 시험 묶음에 하루 블록의 minShare%를 보장
//  - 장기·단기 시험이 둘 다 있을 때만, D-3 ~ 당일 시험이 있는 날은 적용 안 함
//  - 단기 시험 몫은 최소 1블록 남김
function allocateWithLongShare(n, weights, dls, examToday, minShare) {
  const base = allocate(n, weights);
  const isLong = dls.map((dl) => dl >= P.LONG_TERM_DAYS);
  const longIdx = [], shortIdx = [];
  isLong.forEach((l, i) => (l ? longIdx : shortIdx).push(i));
  if (!minShare || !longIdx.length || !shortIdx.length) return base;
  if (examToday || dls.some((dl) => dl <= P.LONG_TERM_OFF_DAYS)) return base;
  const need = Math.min(n - 1, Math.ceil((n * minShare) / 100));
  const have = longIdx.reduce((a, i) => a + base[i], 0);
  if (have >= need) return base;
  const res = new Array(weights.length).fill(0);
  const longC = allocate(need, longIdx.map((i) => weights[i]));
  const shortC = allocate(n - need, shortIdx.map((i) => weights[i]));
  longIdx.forEach((i, k) => (res[i] = longC[k]));
  shortIdx.forEach((i, k) => (res[i] = shortC[k]));
  return res;
}

const generatePlan = (args) => buildPlan(args).tasks;

module.exports = {
  DEFAULT_SETTINGS, PALETTE, DAY_KO,
  sanitizeSettings, fixedBlocksFor, generatePlan, buildPlan, stageCounts, stageTitle, allocateWithLongShare, splitUnits,
  toMin, toHM, addDays, diffDays, dow,
};
