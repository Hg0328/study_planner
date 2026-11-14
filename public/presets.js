// ─────────────────────────────────────────────
//  생활 유형 · 시험 종류 · 우선순위 규칙 (서버와 화면이 같이 쓰는 한 파일)
// ─────────────────────────────────────────────
// 브라우저: <script src="presets.js"> → window.Presets
// Node:     require('./public/presets')
(function (root) {
  const week = (on, start, end, days = [1, 2, 3, 4, 5]) =>
    [0, 1, 2, 3, 4, 5, 6].map((d) => ({ on: on && days.includes(d), start, end }));

  // 생활 유형 (계정 단위). fixedLabel = 고정 일정 이름(학교/강의/근무…)
  const LIFE_TYPES = {
    student: {
      label: '중·고등학생', icon: '🏫', fixedLabel: '학교', examDayLabel: '시험 당일 학교 시간',
      desc: '학교 시간표 + 학원', suggestKinds: ['naesin', 'suneung'],
      defaults: { school: week(true, '08:20', '16:30'), examDay: { start: '08:20', end: '12:30' }, bufferMin: 30, maxWeekdayMin: 240, maxWeekendMin: 480 },
    },
    college: {
      label: '대학생', icon: '🎓', fixedLabel: '강의', examDayLabel: '시험 당일 강의·시험 시간',
      desc: '강의 시간 + 과제', suggestKinds: ['college', 'cert'],
      defaults: { school: week(true, '10:00', '15:00'), examDay: { start: '10:00', end: '12:00' }, bufferMin: 30, maxWeekdayMin: 300, maxWeekendMin: 480 },
    },
    prep: {
      label: '수험생·취준생', icon: '📚', fixedLabel: '고정 일정', examDayLabel: '시험 당일 고정 일정',
      desc: '하루 대부분이 공부 시간', suggestKinds: ['civil', 'cert'],
      defaults: { school: week(false, '09:00', '18:00'), examDay: { start: '09:00', end: '13:00' }, bufferMin: 30, maxWeekdayMin: 480, maxWeekendMin: 480 },
    },
    worker: {
      label: '직장인', icon: '💼', fixedLabel: '근무', examDayLabel: '시험 당일 일정',
      desc: '퇴근 후·주말 공부', suggestKinds: ['cert', 'civil'],
      defaults: { school: week(true, '09:00', '18:00'), examDay: { start: '09:00', end: '13:00' }, bufferMin: 60, maxWeekdayMin: 120, maxWeekendMin: 300 },
    },
    custom: {
      label: '직접 설정', icon: '🛠️', fixedLabel: '고정 일정', examDayLabel: '시험 당일 고정 일정',
      desc: '시간표를 내 맘대로', suggestKinds: ['custom'],
      defaults: null, // 지금 설정값 그대로
    },
  };

  // 시험 종류 (시험 단위). stages: 공부 단계 — ratio(%) 합 100, units=true면 시험 범위 항목을 나눠 배정
  const EXAM_KINDS = {
    naesin: {
      label: '내신', unit: '단원', unitEx: '1단원 다항식, 2단원 방정식, 3단원 부등식',
      suggest: ['국어', '수학', '영어', '사회', '과학', '한국사'],
      stages: [
        { name: '개념', ratio: 45, detail: '교과서·필기 정리', units: true },
        { name: '문제', ratio: 35, detail: '학습지·기출 풀이', units: true },
        { name: '총정리', ratio: 20, detail: '오답노트 & 핵심 암기 정리' },
      ],
    },
    suneung: {
      label: '수능·모의고사', short: '수능', unit: '단원', unitEx: '수열, 지수함수와 로그함수, 삼각함수',
      suggest: ['국어', '수학', '영어', '한국사', '탐구1', '탐구2'],
      stages: [
        { name: '개념', ratio: 30, detail: '개념·EBS 정리', units: true },
        { name: '기출', ratio: 40, detail: '기출 분석·풀이', units: true },
        { name: '실전모의', ratio: 30, detail: '실전 모의고사 시간 재고 풀기' },
      ],
    },
    college: {
      label: '대학 시험', short: '대학', unit: '챕터', unitEx: 'Ch.1 서론, Ch.2 회귀분석, Ch.3 검정',
      suggest: ['전공', '교양'],
      stages: [
        { name: '강의복습', ratio: 40, detail: '강의자료·필기 복습', units: true },
        { name: '연습문제', ratio: 35, detail: '과제·연습문제 풀이', units: true },
        { name: '요약', ratio: 25, detail: '요약노트 & 예상 문제 정리' },
      ],
    },
    cert: {
      label: '자격증·어학', short: '자격증', unit: '파트', unitEx: 'Part 1~2, Part 3~4, Part 5~7',
      suggest: ['LC', 'RC', '필기', '실기', '스피킹'],
      stages: [
        { name: '이론', ratio: 35, detail: '이론·핵심 정리', units: true },
        { name: '기출', ratio: 45, detail: '기출문제 풀이', units: true },
        { name: '모의고사', ratio: 20, detail: '실전 모의고사 & 오답 정리' },
      ],
    },
    civil: {
      label: '공무원·취업', short: '공무원', unit: '과목', unitEx: '총론, 각론, 판례',
      suggest: ['국어', '영어', '한국사', '행정법', '행정학', '인적성', 'NCS'],
      stages: [
        { name: '1회독', ratio: 35, detail: '기본서 1회독', units: true },
        { name: '2회독·기출', ratio: 40, detail: '2회독 & 기출 풀이', units: true },
        { name: '모의고사', ratio: 25, detail: '실전 모의고사 & 오답 정리' },
      ],
    },
    custom: {
      label: '직접 설정', unit: '항목', unitEx: '항목1, 항목2, 항목3',
      suggest: [],
      stages: null, // 시험마다 사용자 입력 (exams.stages)
    },
  };

  const PRIORITY = {
    high: { label: '높음', weight: 1.5 },
    normal: { label: '보통', weight: 1 },
    low: { label: '낮음', weight: 0.6 },
  };

  const LONG_TERM_DAYS = 60;  // 이 일수 이상 남은 시험 = 장기 시험
  const LONG_TERM_OFF_DAYS = 3; // 다른 시험이 D-3 ~ 당일이면 최소 비중 해제

  // 직접 설정 단계: [{name, ratio}] 2~4개, 비율 합을 100으로 맞춤
  function cleanStages(input) {
    let list = input;
    if (typeof list === 'string') { try { list = JSON.parse(list || '[]'); } catch { list = []; } }
    if (!Array.isArray(list)) list = [];
    list = list.slice(0, 4)
      .map((s) => ({ name: String(s?.name || '').trim().replace(/[\[\]]/g, '').slice(0, 12), ratio: Math.max(0, Number(s?.ratio) || 0) }))
      .filter((s) => s.name && s.ratio > 0);
    if (list.length < 2) return null;
    const sum = list.reduce((a, s) => a + s.ratio, 0);
    const out = list.map((s) => ({ name: s.name, ratio: Math.round((s.ratio / sum) * 100) }));
    out[out.length - 1].ratio += 100 - out.reduce((a, s) => a + s.ratio, 0);
    return out;
  }

  // 시험 하나의 공부 단계 (직접 설정이면 사용자 입력, 없으면 내신 기본값)
  function stagesFor(exam) {
    const k = EXAM_KINDS[exam?.kind] || EXAM_KINDS.naesin;
    if (k.stages) return k.stages;
    const custom = cleanStages(exam?.stages);
    if (!custom) return EXAM_KINDS.naesin.stages;
    return custom.map((s, i) => ({ name: s.name, ratio: s.ratio, detail: i === custom.length - 1 ? '정리 & 마무리' : '', units: i < custom.length - 1 }));
  }

  const kindLabel = (kind) => { const k = EXAM_KINDS[kind] || EXAM_KINDS.naesin; return k.short || k.label; };
  // 등록한 시험 종류가 2개 이상일 때만 "수학 · 수능"처럼 종류를 붙임
  const showKinds = (exams) => new Set((exams || []).map((e) => e.kind || 'naesin')).size >= 2;
  const examLabel = (exam, exams) => (showKinds(exams) ? `${exam.subject} · ${kindLabel(exam.kind)}` : exam.subject);

  const Presets = {
    LIFE_TYPES, EXAM_KINDS, PRIORITY, LONG_TERM_DAYS, LONG_TERM_OFF_DAYS,
    LIFE_IDS: Object.keys(LIFE_TYPES), KIND_IDS: Object.keys(EXAM_KINDS), PRIORITY_IDS: Object.keys(PRIORITY),
    cleanStages, stagesFor, kindLabel, showKinds, examLabel,
    fixedLabel: (lifeType) => (LIFE_TYPES[lifeType] || LIFE_TYPES.student).fixedLabel,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Presets;
  else root.Presets = Presets;
})(typeof window !== 'undefined' ? window : globalThis);
