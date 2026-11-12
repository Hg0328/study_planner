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
