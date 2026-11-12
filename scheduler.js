// ─────────────────────────────────────────────
//  시험 공부 계획 자동 생성 알고리즘
// ─────────────────────────────────────────────
// 1) 하루마다 학교·학원·식사 시간을 빼고 "빈 시간"을 계산
// 2) 빈 시간을 공부 블록(기본 50분 + 쉬는 10분)으로 쪼갬
// 3) 과목별 가중치 = 난이도 ÷ √(시험까지 남은 일수)  (D-1, D-2는 추가 가중)
//    → 가까운 시험 + 어려운 과목일수록 많은 블록을 배정
// 4) 같은 과목이 연달아 오지 않도록 번갈아 배치 (집중력 유지)
// 5) 과목별 진행도에 따라 [개념] → [문제] → [총정리] 단계로 제목을 붙이고
//    시험 범위(단원)를 개념/문제 단계에 고르게 나눠 배정
// 6) 하루 마지막 블록은 "오늘 복습 & 오답노트", 시험 당일은 "최종 점검"

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
};

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
    out.push({ start: toMin(sc.start), end: toMin(sc.end), label: '학교', kind: 'school', buffer: true });
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

const splitUnits = (scope) => String(scope || '').split(/[,\n/·]+/).map((x) => x.trim()).filter(Boolean);

/**
 * @param settings  정리된 설정
 * @param exams     [{id, subject, date, difficulty, scope}]
 * @param keepTasks 이미 존재해서 유지되는 일정 (완료/직접 추가) — 시간이 겹치지 않게 피함
 * @param startDate 계획 시작일
 * @param doneCount { examId: 이미 완료한 공부 블록 수 } — 진도 이어가기용
 */
function generatePlan({ settings: s, exams, keepTasks = [], startDate, doneCount = {} }) {
  if (!exams.length) return [];
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

    const weights = upcoming.map((e) => {
      const dl = diffDays(date, e.date);
      let w = (e.difficulty || 3) / Math.sqrt(dl);
      if (dl === 1) w *= 4;
      else if (dl === 2) w *= 1.6;
      return w;
    });
    const order = interleave(allocate(slots.length, weights));
    slots.forEach((sl, i) => {
      const e = upcoming[order[i]];
      out.push({ date, start: sl.start, end: sl.end, exam_id: e.id, subject: e.subject, kind: 'study', title: '' });
    });
    if (reviewSlot) {
      out.push({ date, start: reviewSlot.start, end: reviewSlot.end, exam_id: null, subject: '복습', kind: 'review', title: '오늘 공부한 내용 복습 & 오답노트 정리' });
    }
  }

  // ── 과목별 단계/단원 제목 붙이기 ──
  for (const e of sorted) {
    const list = out.filter((t) => t.kind === 'study' && t.exam_id === e.id);
    const done = doneCount[e.id] || 0;
    const N = done + list.length;
    const conceptN = Math.max(1, Math.ceil(N * 0.45));
    const practiceN = Math.max(1, Math.ceil(N * 0.8) - conceptN);
    const units = splitUnits(e.scope);
    const d1Count = {};
    list.forEach((t, k) => {
      const idx = done + k;
      if (diffDays(t.date, e.date) === 1) {
        const c = (d1Count[t.date] = (d1Count[t.date] || 0) + 1);
        t.title = ['D-1 실전 모의 풀이 — 시간 재고 풀어보기', 'D-1 취약 단원 & 오답노트 최종 점검', 'D-1 핵심 암기 백지 테스트'][(c - 1) % 3];
        return;
      }
      if (idx < conceptN) {
        const u = units.length ? units[Math.floor((idx * units.length) / conceptN)] : `범위 전체 ${idx + 1}/${conceptN}`;
        t.title = `[개념] ${u} — 교과서·필기 정리`;
      } else if (idx < conceptN + practiceN) {
        const p = idx - conceptN;
        const u = units.length ? units[Math.floor((p * units.length) / practiceN)] : `문제 세트 ${p + 1}`;
        t.title = `[문제] ${u} — 학습지·기출 풀이`;
      } else {
        t.title = '[총정리] 오답노트 & 핵심 암기 정리';
      }
    });
  }
  return out;
}

module.exports = {
  DEFAULT_SETTINGS, PALETTE, DAY_KO,
  sanitizeSettings, fixedBlocksFor, generatePlan,
  toMin, toHM, addDays, diffDays, dow,
};
