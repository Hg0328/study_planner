// ─────────────────────────────────────────────
//  시험 범위 글 → [{subject, date, scope}] 변환 (규칙 기반, 무료)
// ─────────────────────────────────────────────
// 가정통신문·단톡 공지·사진에서 읽은 글(OCR)을 줄 단위로 훑으면서
//  - 과목명을 찾고 (글자 사이 띄어쓰기가 섞여도 인식: "국 어" → 국어)
//  - 날짜(11/24, 11월 24일, 2026.11.24, 11.24(화))를 찾아 과목에 붙이고
//  - 과목명 뒤의 내용을 시험 범위로 사용
//  - 과목이 없는 다음 줄은 앞 과목의 범위에 이어 붙임

const SUBJECTS = [
  // 2022 개정 교육과정 과목
  '역학과 에너지', '전자기와 양자', '물질과 에너지', '화학 반응의 세계', '세포와 물질대사', '생물의 유전',
  '지구시스템과학', '행성우주과학', '대수', '미적분Ⅰ', '미적분Ⅱ', '독서와 작문', '화법과 언어', '주제 탐구 독서',
  '문학과 영상', '직무 영어', '영미 문학 읽기', '세계시민과 지리', '사회와 문화', '한국지리 탐구', '동아시아 역사 기행',
  '법과 사회', '인문학과 윤리', '현대사회와 윤리', '기후변화와 환경생태', '정보과학',
  // 2015 개정 및 공통
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

// 연도가 없는 날짜: 작년·올해·내년 중 오늘 기준 "60일 전 ~ 305일 후" 범위에 드는 연도 (올해 우선)
//  예) 1월 초에 본 "12월 30일" → 작년, 12월에 본 "1월 5일" → 내년. 범위에 드는 후보가 없으면 올해
function inferYear(m, d, today) {
  const [ty, tm, td] = today.split('-').map(Number);
  const now = Date.UTC(ty, tm - 1, td);
  const lo = now - 60 * 864e5, hi = now + 305 * 864e5;
  for (const y of [ty, ty - 1, ty + 1]) {
    const cand = Date.UTC(y, m - 1, d);
    if (cand >= lo && cand <= hi) return y;
  }
  return ty;
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

// "과목: 역학과 에너지", "교과명 - 국어" 처럼 과목을 직접 적은 줄
const LABEL_RE = /^(?:과\s*목|교\s*과)\s*명?\s*[:：\-–]\s*(.{1,30}?)\s*(?:[(\[].*)?$/;
// 번호/기호 머리 ("1.", "가.", "①", "-", "•")
const MARK_RE = /^\s*(?:\d{1,2}\s*[.)](?!\d)|[가-하]\s*[.)]|[①-⑳]|[-•▪◦*])\s*/;
// 범위가 아닌 출제 팁·유의사항 ("출제 확률 높음", "변형합니다", "준비물" 등)
const HINT_RE = /(출제\s*(확률|가능성|비중|비율|예정|경향|될\s*수)|확률\s*(이\s*)?높|자주\s*(나|출제)|참고\s*(만|하|바람)|변형\s*(해|하|합|함|됨)|유의\s*사항|주의\s*사항|준비물|지참|배점|문항\s*수|시험\s*시간|사인펜|수정\s*테이프)/;
// 범위가 아닌 안내 문장 ("~합니다.", "~하세요")
const NOTICE_RE = /(니다|세요|바랍니다|됩니다)[\s.!)]*$/;

// 범위 항목을 짧고 읽기 좋게 정리
//  "페이지: 처음~73페이지"                     → "처음~73페이지"
//  "학습지: 2학기 학습지 전부"                  → "2학기 학습지 전부"
//  "풀어야 할 문제: 44페이지 1번, 4번"           → "44페이지 1번, 4번"
//  "처음~127페이지(단, 집어준 문제만 풀어도 됨)" → "처음~127페이지"
const MATERIAL_RE = /(교과서|부교재|학습지|프린트|문제집|자습서|교재|활동지|유인물|필기|노트|모의고사|기출)/;
function tidyItem(section, t) {
  let v = t.replace(/\(\s*(단|다만|※|참고|예)(?=[\s,:])[^)]*\)?/g, '').replace(/\s{2,}/g, ' ').trim();
  let label = '';
  const m = v.match(/^([^:：]{1,30})[:：]\s*(.+)$/);
  if (m) { label = m[1].trim(); v = m[2].trim(); }
  v = v.replace(/\s*문제\s*$/, '').trim();
  let head = section;
  if (!head && label && MATERIAL_RE.test(label)) head = label.match(MATERIAL_RE)[0]; // "학습지: 1~5" → "학습지 1~5"
  if (head && v.includes(head)) head = '';
  return (head ? `${head} ${v}` : v).trim();
}

function parseScopeText(text, today) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const map = new Map();
  const order = [];
  let curDate = '';
  let last = null;
  let section = ''; // "1. 교과서" 같은 소제목
  const loose = []; // 과목을 못 찾았을 때를 대비해 모아 두는 범위 줄

  const upsert = (subject, date, scope) => {
    const key = normSubject(subject);
    let e = map.get(key);
    if (!e) { e = { subject: key, date: '', scope: '' }; map.set(key, e); order.push(key); }
    if (date && !e.date) e.date = date;
    if (scope) e.scope = e.scope ? `${e.scope}; ${scope}` : scope;
    return e;
  };
  // 범위 줄 하나를 정리 (번호 제거, 소제목 붙이기, 안내 문장 제외)
  let pending = ''; // 소제목 후보 ("1. 교과서") — 다음 줄이 "가." 항목이면 소제목, 아니면 그 자체가 범위
  const add = (t) => {
    if (!t) return;
    if (last) last.scope = last.scope ? `${last.scope}; ${t}` : t;
    else loose.push(t);
  };
  const flush = () => { if (pending) { add(pending); pending = ''; } };
  const scopeLine = (line) => {
    if (NOTICE_RE.test(line) && line.length > 12) return;
    if (HINT_RE.test(line)) return;
    const marked = MARK_RE.test(line);
    const isSub = /^\s*[가-하]\s*[.)]/.test(line);
    const t = cleanScope(line.replace(MARK_RE, ''));
    if (!t) return;
    if (isSub) {
      if (pending) { section = pending; pending = ''; }
      add(tidyItem(section, t));
      return;
    }
    flush();
    section = '';
    if (marked && t.length <= 12 && !/[:：~\d]/.test(t)) pending = t;
    else add(tidyItem('', t));
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const dm = findDate(line, today);

    const label = line.match(LABEL_RE);
    if (label) {
      flush(); section = '';
      if (dm) curDate = dm.date;
      last = upsert(label[1].trim(), dm ? dm.date : curDate, '');
      continue;
    }

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
    // 이미 과목이 정해진 상태에서 번호 매긴 줄 속 과목명(예: "가. 국어 교과서 p.10")은 범위로 취급
    if (last && MARK_RE.test(line)) subs.length = 0;

    if (!subs.length) {
      const rest = cleanScope(line);
      if (dm && rest.length <= 6) { curDate = dm.date; continue; } // "11월 24일(화)" 같은 날짜 머리말
      scopeLine(line);
      continue;
    }
    flush(); section = '';
    if (dm) curDate = dm.date;
    const date = dm ? dm.date : curDate;
    subs.forEach((m, i) => {
      const from = m.index + m[0].length;
      const to = i + 1 < subs.length ? subs[i + 1].index : line.length;
      last = upsert(m[0], date, cleanScope(line.slice(from, to)));
    });
  }
  flush();
  // 과목을 하나도 못 찾았지만 범위 내용은 있으면 → 과목 이름만 비운 채로 돌려줌 (화면에서 입력)
  if (!order.length && loose.length) return [{ subject: '', date: curDate, scope: loose.join('; ').slice(0, 500) }];
  return order.map((k) => ({ ...map.get(k), scope: map.get(k).scope.slice(0, 500) }));
}

module.exports = { parseScopeText, normSubject };
