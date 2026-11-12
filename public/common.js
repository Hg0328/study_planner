// 공통 유틸: API 호출, 로그인 토큰, 날짜 계산, 창 간 동기화, 토스트
// 로그인 규칙: 사이트를 "새로" 열면(주소 입력, 즐겨찾기, 새 탭) 항상 다시 로그인.
//  - 같은 탭에서 새로고침/이동하거나, 달력에서 연 플래너 새 창은 로그인이 이어짐
//  - 서버 토큰도 12시간이 지나면 만료
const Auth = {
  get token() { return localStorage.getItem('sp_token'); },
  get user() { return localStorage.getItem('sp_user'); },
  set(token, user) {
    localStorage.setItem('sp_token', token);
    localStorage.setItem('sp_user', user);
    sessionStorage.setItem('sp_active', '1');
  },
  clear() {
    localStorage.removeItem('sp_token');
    localStorage.removeItem('sp_user');
    sessionStorage.removeItem('sp_active');
  },
  checkVisit() {
    let fromSite = false;
    try { fromSite = !!document.referrer && new URL(document.referrer).origin === location.origin; } catch {}
    if (!sessionStorage.getItem('sp_active') && !fromSite) this.clear(); // 새로 접속 → 로그아웃 상태로 시작
    else if (this.token) sessionStorage.setItem('sp_active', '1');
  },
};
Auth.checkVisit();

// 로그인 화면으로 이동 (플래너에서 왔다면 로그인 후 그 날짜로 돌아오도록 next 전달)
function goLogin() {
  const here = location.pathname.split('/').pop() + location.search;
  const ok = /^planner\.html\?date=\d{4}-\d{2}-\d{2}$/.test(here);
  location.href = 'index.html' + (ok ? '?next=' + encodeURIComponent(here) : '');
}

async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (Auth.token) headers.Authorization = 'Bearer ' + Auth.token;
  const res = await fetch('/api' + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith('/auth')) {
    Auth.clear();
    if (location.pathname.includes('planner')) goLogin();
    else location.reload();
    throw new Error(data.error || '로그인이 필요해요');
  }
  if (!res.ok) throw new Error(data.error || '요청에 실패했어요');
  return data;
}

const DAY_KO = ['일', '월', '화', '수', '목', '금', '토'];
const D = {
  pad: (n) => String(n).padStart(2, '0'),
  fmt(d) { return `${d.getFullYear()}-${D.pad(d.getMonth() + 1)}-${D.pad(d.getDate())}`; },
  today() { return D.fmt(new Date()); },
  parse(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); },
  add(s, n) { const d = D.parse(s); d.setDate(d.getDate() + n); return D.fmt(d); },
  diff(a, b) { return Math.round((D.parse(b) - D.parse(a)) / 864e5); },
  dow(s) { return D.parse(s).getDay(); },
  pretty(s) { const d = D.parse(s); return `${d.getMonth() + 1}월 ${d.getDate()}일 (${DAY_KO[d.getDay()]})`; },
};
const toHM = (m) => `${D.pad(Math.floor(m / 60))}:${D.pad(m % 60)}`;
const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const dday = (n) => (n === 0 ? 'D-DAY' : n > 0 ? `D-${n}` : `D+${-n}`);
const fmtMin = (m) => (m >= 60 ? `${Math.floor(m / 60)}시간${m % 60 ? ' ' + (m % 60) + '분' : ''}` : `${m}분`);

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 캘린더 창 ↔ 플래너 창 실시간 동기화
const sync = 'BroadcastChannel' in window ? new BroadcastChannel('study-planner') : null;
function notifyChange() { sync && sync.postMessage({ type: 'changed', at: Date.now() }); }
function onChange(fn) { sync && sync.addEventListener('message', (e) => e.data?.type === 'changed' && fn()); }

function toast(msg, ms = 2200) {
  let el = document.getElementById('toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), ms);
}

// ─────────────────────────────────────────────
//  꾸미기: 색 테마 + 큰 글씨(제목) 글꼴 + 글자 크기
// ─────────────────────────────────────────────
// 이 기기에 바로 적용(localStorage) + 로그인하면 서버 설정에도 저장해서 다른 기기에서도 같은 테마
const THEMES = {
  cream: { name: '크림 노트', vars: {} }, // style.css 기본값
  cherry: { name: '벚꽃', vars: {
    bg: '#f6e4e6', dot: '#e8c6cb', paper: '#fffafa', card: '#ffffff', soft: '#fcf0f1', track: '#f6e1e4', hover: '#fdecef', note: '#fff0f3',
    ink: '#4a3438', muted: '#9a7e83', line: '#f0dadd', rule: '#f3e3e6', dash: '#dcb4ba', accent: '#e26d8a', 'accent-soft': '#fde8ee',
    sage: '#8fbf9f', sky: '#93a8d6', butter: '#f6b8c6', tape: 'rgba(246,184,198,.8)', 'shadow-line': '#ead0d4' } },
  mint: { name: '민트', vars: {
    bg: '#dcefe8', dot: '#bcdcd0', paper: '#fbfffd', card: '#ffffff', soft: '#eef8f4', track: '#dcefe7', hover: '#e8f7f1', note: '#eafaf3',
    ink: '#2f3f3a', muted: '#71877f', line: '#d6ebe3', rule: '#dcefe8', dash: '#a9cfc1', accent: '#2f9e83', 'accent-soft': '#dff4ed',
    sage: '#5fb49a', sky: '#6ea7c4', butter: '#a8dcc9', tape: 'rgba(168,220,201,.85)', 'shadow-line': '#c7e2d8' } },
  sky: { name: '하늘', vars: {
    bg: '#dde8f4', dot: '#c0d3e8', paper: '#fbfdff', card: '#ffffff', soft: '#eef4fb', track: '#dde8f4', hover: '#e9f1fb', note: '#eef5ff',
    ink: '#2f3a48', muted: '#76849a', line: '#d9e4f0', rule: '#dde8f3', dash: '#a9c0dc', accent: '#3d7cc9', 'accent-soft': '#e2edfa',
    sage: '#6fb09a', sky: '#5f97d1', butter: '#a9c8ec', tape: 'rgba(169,200,236,.85)', 'shadow-line': '#c9d9ea' } },
  lavender: { name: '라벤더', vars: {
    bg: '#e8e2f3', dot: '#d2c8e6', paper: '#fdfbff', card: '#ffffff', soft: '#f4f0fa', track: '#e8e1f3', hover: '#f1ebfb', note: '#f5effd',
    ink: '#3b3448', muted: '#857b97', line: '#e4dcf0', rule: '#e8e2f3', dash: '#c2b4dc', accent: '#8a63c9', 'accent-soft': '#efe6fb',
    sage: '#7fb39b', sky: '#7f9cd6', butter: '#cdb8ec', tape: 'rgba(205,184,236,.85)', 'shadow-line': '#d8cde9' } },
  lemon: { name: '레몬', vars: {
    bg: '#f4eecf', dot: '#e2d8a6', paper: '#fffef6', card: '#ffffff', soft: '#fbf8e6', track: '#f3edcc', hover: '#fdf8dc', note: '#fffbe0',
    ink: '#3f3b28', muted: '#8c8564', line: '#ede6c4', rule: '#eee9cf', dash: '#d6ca8d', accent: '#d9971c', 'accent-soft': '#fcf0d4',
    sage: '#8cb36f', sky: '#7fa7c9', butter: '#f3dc6b', tape: 'rgba(243,220,107,.8)', 'shadow-line': '#e3daaf' } },
  night: { name: '밤 (다크)', vars: {
    bg: '#1d1f26', dot: '#2c2f38', paper: '#272a32', card: '#2f323b', soft: '#2c2f37', track: '#3a3e48', hover: '#343843', note: '#3a3528',
    ink: '#ecebe6', muted: '#a3a29c', line: '#3c404a', rule: '#343944', dash: '#565b68', accent: '#f08a6c', 'accent-soft': '#4a342e',
    sage: '#86c2a4', sky: '#8fb6d9', butter: '#d9b56a', tape: 'rgba(217,181,106,.5)', 'on-accent': '#1d1f26', 'shadow-line': '#15161b',
    sun: '#ff8a80', sat: '#8fb6ff' } },
};
// 큰 글씨 글꼴 — scale: 글꼴마다 실제 크기가 달라서 맞춰 주는 배율
const FONTS = {
  pen: { name: '펜 손글씨', family: 'Nanum Pen Script', scale: 1 },
  gaegu: { name: '개구쟁이', family: 'Gaegu', scale: 0.7 },
  gamja: { name: '감자꽃', family: 'Gamja Flower', scale: 0.85 },
  melody: { name: '하이멜로디', family: 'Hi Melody', scale: 0.85 },
  yeonsung: { name: '연성', family: 'Yeon Sung', scale: 0.8 },
  jua: { name: '주아 (동글)', family: 'Jua', scale: 0.72 },
  dohyeon: { name: '도현 (굵게)', family: 'Do Hyeon', scale: 0.78 },
  batang: { name: '고운바탕 (명조)', family: 'Gowun Batang', scale: 0.66 },
};
const THEME_VARS = [...new Set(Object.values(THEMES).flatMap((t) => Object.keys(t.vars)))];

const Look = {
  get() {
    let v = {};
    try { v = JSON.parse(localStorage.getItem('sp_look') || '{}'); } catch {}
    return { theme: THEMES[v.theme] ? v.theme : 'cream', handFont: FONTS[v.handFont] ? v.handFont : 'pen', fontScale: [1, 1.1, 1.2].includes(v.fontScale) ? v.fontScale : 1 };
  },
  loadFont(id) {
    const f = FONTS[id];
    if (!f || f.family === 'Nanum Pen Script' || document.getElementById('font-' + id)) return;
    const l = document.createElement('link');
    l.id = 'font-' + id; l.rel = 'stylesheet';
    l.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(f.family)}&display=swap`;
    document.head.appendChild(l);
  },
  apply(look = Look.get()) {
    const root = document.documentElement.style;
    THEME_VARS.forEach((k) => root.removeProperty('--' + k));
    for (const [k, v] of Object.entries(THEMES[look.theme].vars)) root.setProperty('--' + k, v);
    const f = FONTS[look.handFont];
    Look.loadFont(look.handFont);
    root.setProperty('--font-hand', `'${f.family}'`);
    root.setProperty('--hand-scale', f.scale);
    root.setProperty('--font-scale', look.fontScale);
    document.documentElement.dataset.theme = look.theme;
    const meta = document.querySelector('meta[name=theme-color]');
    if (meta) meta.content = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  },
  // 바꾸기: 이 기기 저장 + 화면 적용 + (로그인 상태면) 서버 저장
  async set(patch, { server = true } = {}) {
    const look = { ...Look.get(), ...patch };
    localStorage.setItem('sp_look', JSON.stringify(look));
    Look.apply(look);
    if (server && Auth.token) {
      try {
        const s = await api('/settings');
        await api('/settings', { method: 'PUT', body: { ...s, ...look } });
      } catch {}
    }
  },
  // 서버에 저장된 테마를 이 기기에 반영 (로그인 직후)
  fromSettings(s) {
    if (!s) return;
    const look = { theme: s.theme, handFont: s.handFont, fontScale: s.fontScale };
    localStorage.setItem('sp_look', JSON.stringify({ ...Look.get(), ...look }));
    Look.apply();
  },
};
Look.apply();
// 다른 창(캘린더 ↔ 플래너)에서 테마를 바꾸면 이 창도 바로 바뀜
window.addEventListener('storage', (e) => { if (e.key === 'sp_look') Look.apply(); });

// 테마 고르기 화면 (설정 창 · 플래너 창에서 같이 사용)
const THEME_PREVIEW_BASE = { bg: '#ece5d6', paper: '#fffdf6', accent: '#e07a5f', butter: '#f2cc8f', ink: '#3a3631', line: '#e9e1d0' };
function renderLookPicker(el) {
  const cur = Look.get();
  Object.keys(FONTS).forEach(Look.loadFont); // 미리보기용으로 글꼴 불러오기
  el.innerHTML = `
    <div class="look-sec"><b>🎨 색 테마</b><div class="swatches">
      ${Object.entries(THEMES).map(([id, t]) => {
        const v = { ...THEME_PREVIEW_BASE, ...t.vars };
        return `<button type="button" class="swatch ${id === cur.theme ? 'on' : ''}" data-theme="${id}"
          style="--sb:${v.bg};--sp:${v.paper};--sa:${v.accent};--sk:${v.butter};--si:${v.ink};--sl:${v.line}">
          <span class="sw-page"><i class="t"></i><i class="a"></i><i class="l"></i><i class="l s"></i></span>${t.name}</button>`;
      }).join('')}
    </div></div>
    <div class="look-sec"><b>✒️ 큰 글씨 글꼴</b> <span class="muted" style="font-size:12px">날짜·제목·D-Day 숫자에 쓰여요</span><div class="fontpick">
      ${Object.entries(FONTS).map(([id, f]) => `<button type="button" class="fontopt ${id === cur.handFont ? 'on' : ''}" data-font="${id}">
        <span style="font-family:'${f.family}',cursive;font-size:calc(30px * ${f.scale})">11월 12일 D-7</span><small>${f.name}</small></button>`).join('')}
    </div></div>
    <div class="look-sec"><b>🔍 화면 크기</b><div class="sizepick">
      ${[[1, '보통'], [1.1, '크게'], [1.2, '아주 크게']].map(([v, n]) => `<button type="button" class="btn small ${v === cur.fontScale ? 'primary' : ''}" data-scale="${v}">${n}</button>`).join('')}
    </div></div>`;
  el.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    let patch;
    if (b.dataset.theme) patch = { theme: b.dataset.theme };
    else if (b.dataset.font) patch = { handFont: b.dataset.font };
    else if (b.dataset.scale) patch = { fontScale: +b.dataset.scale };
    else return;
    const saving = Look.set(patch);
    renderLookPicker(el);
    await saving;
  };
}

// ─────────────────────────────────────────────
//  처음 사용하는 사람을 위한 안내 (화면 곳곳을 하나씩 짚어 줌)
// ─────────────────────────────────────────────
// steps: [{ el: 'CSS 선택자' | null(가운데), title, text }]
function runTour(steps, { doneLabel = '시작하기', onDone } = {}) {
  document.querySelector('.tour')?.remove();
  const wrap = document.createElement('div');
  wrap.className = 'tour';
  wrap.innerHTML = '<div class="tour-block"></div><div class="tour-hole"></div><div class="tour-tip" role="dialog" aria-live="polite"></div>';
  document.body.appendChild(wrap);
  const hole = wrap.querySelector('.tour-hole'), tip = wrap.querySelector('.tour-tip');
  let i = 0;

  const close = (finished) => {
    wrap.remove();
    window.removeEventListener('resize', place);
    document.removeEventListener('keydown', onKey);
    if (finished && onDone) onDone();
  };
  function place() {
    const s = steps[i];
    const el = s.el && document.querySelector(s.el);
    const visible = el && el.getClientRects().length;
    if (visible) {
      const r = el.getBoundingClientRect(), pad = 8;
      Object.assign(hole.style, { display: 'block', left: r.left - pad + 'px', top: r.top - pad + 'px', width: r.width + pad * 2 + 'px', height: r.height + pad * 2 + 'px' });
      // 말풍선: 대상 아래 → 공간 없으면 위 → 그래도 없으면 옆
      const tw = Math.min(340, innerWidth - 24), th = tip.offsetHeight || 180;
      let left = Math.min(Math.max(12, r.left), innerWidth - tw - 12);
      let top = r.bottom + 16;
      if (top + th > innerHeight - 12) top = r.top - th - 16;
      if (top < 12) { top = Math.max(12, Math.min(r.top, innerHeight - th - 12)); left = r.right + 16 + tw < innerWidth ? r.right + 16 : Math.max(12, r.left - tw - 16); }
      Object.assign(tip.style, { left: left + 'px', top: top + 'px', width: tw + 'px', transform: 'none' });
    } else {
      hole.style.display = 'none';
      Object.assign(tip.style, { left: '50%', top: '50%', width: Math.min(380, innerWidth - 24) + 'px', transform: 'translate(-50%, -50%)' });
    }
  }
  function show() {
    const s = steps[i];
    const last = i === steps.length - 1;
    tip.innerHTML = `
      <div class="tour-step">${i + 1} / ${steps.length}</div>
      <h3>${s.title}</h3><p>${s.text}</p>
      <div class="tour-btns">
        <button type="button" class="btn small ghost" data-t="skip">${last ? '닫기' : '건너뛰기'}</button>
        <span style="flex:1"></span>
        ${i ? '<button type="button" class="btn small" data-t="prev">이전</button>' : ''}
        <button type="button" class="btn small primary" data-t="next">${last ? doneLabel : '다음 →'}</button>
      </div>`;
    const el = s.el && document.querySelector(s.el);
    if (el && el.getClientRects().length) el.scrollIntoView({ block: 'center', behavior: 'instant' });
    place();
    requestAnimationFrame(place);
    tip.querySelector('[data-t=next]').focus();
  }
  function onKey(e) {
    if (e.key === 'Escape') close(false);
    if (e.key === 'ArrowRight') tip.querySelector('[data-t=next]').click();
    if (e.key === 'ArrowLeft' && i) { i--; show(); }
  }
  tip.addEventListener('click', (e) => {
    const t = e.target.dataset.t;
    if (t === 'skip') close(false);
    if (t === 'prev') { i--; show(); }
    if (t === 'next') { if (i === steps.length - 1) close(true); else { i++; show(); } }
  });
  window.addEventListener('resize', place);
  document.addEventListener('keydown', onKey);
  show();
}
