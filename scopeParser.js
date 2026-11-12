// ─────────────────────────────────────────────
//  시험 범위 글 → [{subject, date, scope}] 변환 (규칙 기반, 무료)
// ─────────────────────────────────────────────
// 가정통신문·단톡 공지·사진에서 읽은 글(OCR)을 줄 단위로 훑으면서
//  - 과목명을 찾고 (글자 사이 띄어쓰기가 섞여도 인식: "국 어" → 국어)
//  - 날짜(11/24, 11월 24일, 2026.11.24, 11.24(화))를 찾아 과목에 붙이고
//  - 과목명 뒤의 내용을 시험 범위로 사용
//  - 과목이 없는 다음 줄은 앞 과목의 범위에 이어 붙임

const SUBJECTS = [
  '확률과 통계', '미적분', '기하', '수학Ⅰ', '수학Ⅱ', '수학1', '수학2', '공통수학1', '공통수학2', '공통수학', '수학',
  '공통국어1', '공통국어2', '공통국어', '문학', '독서', '언어와 매체', '화법과 작문', '국어',
  '공통영어1', '공통영어2', '공통영어', '영어Ⅰ', '영어Ⅱ', '영어1', '영어2', '영어 독해와 작문', '영어',
  '한국사1', '한국사2', '한국사', '통합사회1', '통합사회2', '통합사회', '통합과학1', '통합과학2', '통합과학',
  '물리학Ⅰ', '물리학', '물리', '화학Ⅰ', '화학', '생명과학Ⅰ', '생명과학', '지구과학Ⅰ', '지구과학', '과학탐구실험', '과학',
  '생활과 윤리', '윤리와 사상', '한국지리', '세계지리', '동아시아사', '세계사', '정치와 법', '사회·문화', '사회문화', '경제', '사회',
  '역사', '도덕', '기술·가정', '기술가정', '기가', '정보', '한문', '일본어', '중국어', '음악', '미술', '체육', '보건',
];

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// 글자 사이에 공백이 끼어도 매칭되도록 ("국 어", "한 국 사")
// 단, "수학1/영어Ⅱ" 같은 숫자는 바로 붙어 있을 때만 (→ "수학 2단원"을 수학2로 착각하지 않게)
const subjectPattern = (s) => {
  const flat = s.replace(/\s/g, '');
  const m = flat.match(/^(.*?)([0-9ⅠⅡ]*)$/);
  const body = [...m[1]].map(escRe).join('\\s*');
  return m[2] ? `${body}${escRe(m[2])}(?![0-9단장과~.\\-])` : body;
};
const SUBJECT_RE = new RegExp(
  [...SUBJECTS].sort((a, b) => b.length - a.length).map(subjectPattern).join('|'),
  'g'
);
// 과목명 뒤에 조사가 붙으면 범위 속 단어로 봄 (예: "문학의 즐거움")
const PARTICLE_AFTER = /^[의을를은는이가과와적에도로]/;
const normSubject = (s) => {
  const flat = s.replace(/\s/g, '');
  return SUBJECTS.find((x) => x.replace(/\s/g, '') === flat) || flat;
};

const WEEK = '[월화수목금토일]';
const DATE_PATTERNS = [
  new RegExp(`(\\d{4})\\s*[.\\-/년]\\s*(\\d{1,2})\\s*[.\\-/월]\\s*(\\d{1,2})\\s*일?\\.?(\\s*\\(?${WEEK}\\)?)?`),
  new RegExp(`(?<!\\d)(\\d{1,2})\\s*월\\s*(\\d{1,2})\\s*일(\\s*\\(?${WEEK}\\)?)?`),
  new RegExp(`(?<![\\d.p])(\\d{1,2})\\s*/\\s*(\\d{1,2})(?![\\d~])(\\s*\\(?${WEEK}\\)?)?`),
  new RegExp(`(?<![\\d.p])(\\d{1,2})\\.\\s?(\\d{1,2})\\.?(\\s*\\(${WEEK}\\))`),
];

function inferYear(m, d, today) {
  const [ty, tm, td] = today.split('-').map(Number);
  let y = ty;
  const cand = Date.UTC(y, m - 1, d);
  if (cand < Date.UTC(ty, tm - 1, td) - 60 * 864e5) y += 1; // 두 달 넘게 지난 날짜면 내년으로
  return y;
}
const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

function findDate(line, today) {
  for (let i = 0; i < DATE_PATTERNS.length; i++) {
    const m = line.match(DATE_PATTERNS[i]);
    if (!m) continue;
    let y, mo, d;
    if (i === 0) [y, mo, d] = [+m[1], +m[2], +m[3]];
    else { mo = +m[1]; d = +m[2]; y = inferYear(mo, d, today); }
    if (mo < 1 || mo > 12 || d < 1 || d > 31) continue;
    return { date: iso(y, mo, d), index: m.index, text: m[0] };
  }
  return null;
}

function stripDates(s) {
  let out = s;
  for (const re of DATE_PATTERNS) out = out.replace(new RegExp(re.source, 'g'), ' ');
  return out;
}

function cleanScope(seg) {
  return stripDates(seg)
    .replace(/[∼〜～]/g, '~')
    .replace(/\(\s*[월화수목금토일]\s*\)/g, ' ')
    .replace(/\d\s*교\s*시/g, ' ')
    .replace(/^[\s:：\-–—)\]】>·,|.]+/, '')
    .replace(/^(시험\s*)?범\s*위\s*[:：]?\s*/, '')
    .replace(/[\s|,·:：\-–—(\[【<]+$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function parseScopeText(text, today) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const map = new Map();
  const order = [];
  let curDate = '';
  let last = null;

  const upsert = (subject, date, scope) => {
    const key = normSubject(subject);
    let e = map.get(key);
    if (!e) { e = { subject: key, date: '', scope: '' }; map.set(key, e); order.push(key); }
    if (date && !e.date) e.date = date;
    if (scope) e.scope = e.scope ? `${e.scope}, ${scope}` : scope;
    return e;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) { last = null; continue; }
    const dm = findDate(line, today);
    // 과목명 후보 중 "진짜 과목 표시"만 남기기
    const subs = [];
    for (const m of line.matchAll(SUBJECT_RE)) {
      const after = line.slice(m.index + m[0].length);
      if (PARTICLE_AFTER.test(after)) continue;
      if (subs.length) {
        const prev = subs[subs.length - 1];
        const between = line.slice(prev.index + prev[0].length, m.index);
        const isNew = !cleanScope(between) || /^\s*[:：\-–—]/.test(after) || /(\s{2,}|[|/])$/.test(between);
        if (!isNew) continue;
      }
      subs.push(m);
    }

    if (!subs.length) {
      const rest = cleanScope(line);
      if (dm && rest.length <= 6) { curDate = dm.date; last = null; continue; } // "11월 24일(화)" 같은 날짜 머리말
      if (last && rest) last.scope = last.scope ? `${last.scope}, ${rest}` : rest;
      continue;
    }
    if (dm) curDate = dm.date;
    const date = dm ? dm.date : curDate;
    subs.forEach((m, i) => {
      const from = m.index + m[0].length;
      const to = i + 1 < subs.length ? subs[i + 1].index : line.length;
      last = upsert(m[0], date, cleanScope(line.slice(from, to)));
    });
  }
  return order.map((k) => map.get(k));
}

module.exports = { parseScopeText, normSubject };
