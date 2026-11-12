// ─────────────────────────────────────────────
//  친구와 공부 마라톤 — 로비 / 방 / 트랙 / 캐릭터 꾸미기 / 타이머
// ─────────────────────────────────────────────
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
if (!Auth.token) goLogin();

const roomCode = (new URLSearchParams(location.search).get('room') || '').toUpperCase();
let myAvatar = null, avatarDefaults = null;
let state = null;          // 서버에서 받은 방 상태
let view = 'today';        // 'today' | 'total'
const shown = new Map();   // 화면에 보이는 위치 (부드럽게 이동)
const POLL_MS = 5000;

function pxToast(msg, ms = 2400) {
  const t = $('#pxToast');
  t.textContent = msg; t.style.display = 'block';
  clearTimeout(t._t); t._t = setTimeout(() => (t.style.display = 'none'), ms);
}
const fireLevel = (m) => (m >= 240 ? 3 : m >= 120 ? 2 : m >= 60 ? 1 : 0);
const fmt = (x) => { const m = Math.floor(x); return m >= 60 ? `${Math.floor(m / 60)}시간 ${m % 60}분` : `${m}분`; };
const shortFmt = (x) => { const m = Math.floor(x); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; };

// ───────── 로비 ─────────
async function showLobby() {
  $('#lobby').hidden = false;
  $('#lobbyLink').hidden = true;
  const rooms = await api('/rooms');
  $('#roomList').innerHTML = rooms.map((r) => `<a href="race.html?room=${r.code}">
      <span>🏁 ${esc(r.name)} <span class="muted">· ${r.members}명</span></span>
      <span class="muted">${r.code} ›</span></a>`).join('')
    || '<p class="muted help">아직 들어간 방이 없어요. 방을 만들거나 친구에게 받은 코드로 입장해 보세요.</p>';
}
$('#createForm').onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    const r = await api('/rooms', { method: 'POST', body: { name: f.name.value, goalMin: +f.goal.value, today: D.today() } });
    location.href = `race.html?room=${r.code}`;
  } catch (err) { pxToast(err.message); }
};
$('#joinForm').onsubmit = async (e) => {
  e.preventDefault();
  const code = e.target.code.value.trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(code)) return pxToast('입장 코드는 6자리예요');
  try {
    await api('/rooms/join', { method: 'POST', body: { code } });
    location.href = `race.html?room=${code}`;
  } catch (err) { pxToast(err.message); }
};

// ───────── 방 ─────────
async function enterRoom(code) {
  try {
    // 링크로 들어와도 바로 참가 (이미 참가 중이면 그대로)
    await api('/rooms/join', { method: 'POST', body: { code } });
  } catch (err) {
    pxToast(err.message, 3500);
    return showLobby();
  }
  $('#room').hidden = false;
  if (!myAvatar) openEditor(true); // 처음 입장 → 캐릭터부터 꾸미기
  await poll();
  setInterval(poll, POLL_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
  requestAnimationFrame(loop);
}

async function poll() {
  try {
    state = await api(`/rooms/${roomCode}?today=${D.today()}`);
    fetchedAt = performance.now();
  } catch (err) { pxToast(err.message); return; }
  const r = state.room;
  document.title = `${r.name} · 공부 마라톤`;
  $('#roomName').textContent = r.name;
  $('#hudWorld').textContent = r.name;
  $('#roomCode').textContent = r.code;
  $('#roomInfo').textContent = view === 'today'
    ? `오늘 목표 ${fmt(r.goalMin)} · 결승선까지 달려 보세요! (완료 체크한 공부 + 집중 타이머 시간)`
    : `${D.pretty(r.startDate)}부터 쌓인 공부 시간 · 1등이 결승선 근처에 있어요`;
  $('#ownerTools').innerHTML = r.isOwner
    ? `👑 방장 · 하루 목표 <select class="pin" id="goalSel" style="padding:4px">${[60, 120, 180, 240, 300, 360, 480, 600].map((m) => `<option value="${m}" ${m === r.goalMin ? 'selected' : ''}>${m / 60}시간</option>`).join('')}</select>`
    : '';
  const sel = $('#goalSel');
  if (sel) sel.onchange = async () => { await api(`/rooms/${roomCode}`, { method: 'PUT', body: { goalMin: +sel.value } }); pxToast('목표를 바꿨어요'); poll(); };
  renderRank();
  sizeTrack();
}

// 달리는 중이면 지금 이 순간까지 공부한 시간을 더해서 → 캐릭터가 실시간으로 조금씩 앞으로 나아감
let fetchedAt = 0;
const liveRun = (m) => (m.status === 'run'
  ? Math.min(m.runElapsedMin + (performance.now() - fetchedAt) / 60e3, m.runElapsedMin + m.runLeftMin) : 0);
const liveToday = (m) => m.todayMin + liveRun(m);
const metric = (m) => (view === 'today' ? m.todayMin : m.totalMin) + liveRun(m);
function target(m) {
  if (!state) return 0;
  if (view === 'today') return Math.min(1, metric(m) / state.room.goalMin);
  const top = Math.max(...state.members.map(metric), state.room.goalMin);
  return Math.min(1, metric(m) / (top * 1.04));
}

const STATUS = { run: '🏃 달리는 중', drink: '💧 물 마시는 중', sleep: '💤 누워서 자는 중' };
const ORD = (i) => ['1ST', '2ND', '3RD'][i] || `${i + 1}TH`;
function renderRank() {
  const list = [...state.members].sort((a, b) => metric(b) - metric(a));
  $('#rank').innerHTML = list.map((m, i) => `<li class="${m.id === state.me ? 'me' : ''}">
      <span class="no">${ORD(i)}</span>
      <canvas width="56" height="64" data-av="${m.id}"></canvas>
      <span><b>${esc(m.username)}</b>${m.id === state.me ? ' <span class="muted">(1P)</span>' : ''}<br>
        <span class="st ${m.status}">${STATUS[m.status]}${m.status === 'run' ? ` · ${m.runLeftMin}분 남음` : ''}</span></span>
      <span class="min">${shortFmt(metric(m))}<small>${'🔥'.repeat(fireLevel(liveToday(m)))}</small></span></li>`).join('');
  for (const c of $$('#rank canvas')) {
    const m = state.members.find((x) => x.id === +c.dataset.av);
    const g = c.getContext('2d'); g.imageSmoothingEnabled = false;
    Pixel.draw(g, m.avatar, m.status === 'sleep' ? 'sleep' : 'stand', 0, 12, 8 + (m.status === 'sleep' ? 6 : 0), 2, fireLevel(liveToday(m)));
  }
  const me = state.members.find((x) => x.id === state.me);
  if (me) $('#hudToday').textContent = shortFmt(liveToday(me));
}

$$('.tabs button').forEach((b) => (b.onclick = () => {
  view = b.dataset.view;
  $$('.tabs button').forEach((x) => x.classList.toggle('on', x === b));
  poll();
}));
$('#copyCode').onclick = async () => {
  const code = state?.room.code || roomCode;
  const text = `[공부 마라톤] "${state?.room.name || ''}" 방에 같이 달려요!\n입장 코드: ${code}\n${location.origin}${location.pathname}?room=${code}`;
  try { await navigator.clipboard.writeText(text); pxToast('초대 문구를 복사했어요. 친구에게 붙여넣어 보내 주세요'); }
  catch { pxToast(`입장 코드: ${code}`, 4000); }
};
$('#leaveBtn').onclick = async (e) => {
  const b = e.target;
  if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = '정말 나갈까요? 한 번 더 누르기'; setTimeout(() => { b.dataset.sure = ''; b.textContent = '방 나가기'; }, 4000); return; }
  await api(`/rooms/${roomCode}/me`, { method: 'DELETE' });
  location.href = 'race.html';
};

// ───────── 트랙 그리기 (8비트 횡스크롤 무대) ─────────
const cv = $('#track'), ctx = cv.getContext('2d');
let S = 3, laneH = 0, W = 0;
function sizeTrack() {
  if (!state) return;
  W = $('#trackWrap').clientWidth;
  const n = Math.max(1, state.members.length);
  S = W < 620 || n > 5 ? 2 : 3;
  laneH = 46 * S;
  const H = n * laneH;
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  ctx.imageSmoothingEnabled = false;
}
window.addEventListener('resize', sizeTrack);

const px = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };
// 픽셀 구름
function cloud(x, y) {
  const u = S;
  px(x + 4 * u, y, 8 * u, 2 * u, '#fff'); px(x + 2 * u, y + 2 * u, 14 * u, 2 * u, '#fff');
  px(x, y + 4 * u, 20 * u, 3 * u, '#fff'); px(x + 2 * u, y + 7 * u, 16 * u, 1 * u, '#c8e0ff');
}
// 계단식 언덕
function hill(x, base, h, c, dark) {
  for (let k = 0; k < h; k++) px(x - k * 2 * S, base - (h - k) * 2 * S, (k * 4 + 4) * S, 2 * S, c);
  px(x + S, base - (h - 1) * 2 * S + S, S, S, dark); px(x - S, base - (h - 2) * 2 * S + S, S, S, dark);
}
// 덤불
function bush(x, base) {
  px(x + 2 * S, base - 5 * S, 6 * S, 2 * S, '#2c9c2c'); px(x, base - 3 * S, 12 * S, 3 * S, '#2c9c2c'); px(x + 8 * S, base - 6 * S, 4 * S, 3 * S, '#2c9c2c');
  px(x + 3 * S, base - 4 * S, S, S, '#70dc70'); px(x + 9 * S, base - 5 * S, S, S, '#70dc70');
}
// 테두리 있는 글자 (고전 게임 자막)
function outlined(text, x, y, color = '#fff') {
  ctx.fillStyle = '#000';
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [1, -1], [-1, 1]]) ctx.fillText(text, x + dx * Math.max(1, S / 2), y + dy * Math.max(1, S / 2));
  ctx.fillStyle = color; ctx.fillText(text, x, y);
}

function drawTrack(t) {
  const n = state.members.length;
  const startX = 26 * S, finishX = W - 34 * S;
  const groundH = 7 * S;
  for (let i = 0; i < n; i++) {
    const y0 = i * laneH, gy = y0 + laneH - groundH; // gy = 땅 윗면
    // 하늘 (아래로 갈수록 살짝 밝게, 줄무늬 디더링)
    px(0, y0, W, laneH, '#5c8df6');
    for (let yy = y0 + laneH * 0.45; yy < gy; yy += 4 * S) px(0, yy, W, S, '#6a98f7');
    // 구름 (천천히 흘러감)
    for (let c = 0; c < 3; c++) {
      const span = W + 40 * S;
      const cx = (((i * 173 + c * 311) * S - t * 0.012 * (1 + c * 0.3)) % span + span) % span - 24 * S;
      cloud(cx, y0 + (4 + ((i + c) % 3) * 4) * S);
    }
    // 언덕 · 덤불
    hill(((i * 97) % 5 + 2) * W / 9, gy, 6, '#4cb84c', '#2c8c2c');
    hill(((i * 53) % 5 + 5) * W / 10, gy, 4, '#5ccc5c', '#3c9c3c');
    bush(((i * 71) % 7 + 1) * W / 9 + 10 * S, gy);
    // 벽돌 땅
    px(0, gy, W, groundH, '#c4622d');
    px(0, gy, W, S, '#f0a060');
    for (let r = 0; r < 2; r++) {
      const ry = gy + S + r * 3 * S;
      px(0, ry + 3 * S - S, W, S, '#7a3410');
      for (let x = (r ? 6 * S : 0); x < W; x += 12 * S) px(x, ry, S, 3 * S, '#7a3410');
    }
    px(0, y0 + laneH - S, W, S, '#000');
    // 레인 번호
    ctx.font = `${4 * S}px 'Press Start 2P', monospace`;
    outlined(String(i + 1), 4 * S, gy + 5.5 * S, '#fcd83c');
  }
  // START 표지판
  ctx.font = `${3 * S}px 'Press Start 2P', monospace`;
  px(startX - 2 * S, 0, S, n * laneH, 'rgba(255,255,255,.75)');
  for (let i = 0; i < n; i++) {
    const gy = i * laneH + laneH - groundH;
    px(startX - 14 * S, gy - 12 * S, S * 2, 12 * S, '#7a3410');
    px(startX - 22 * S, gy - 17 * S, 18 * S, 7 * S, '#000'); px(startX - 21 * S, gy - 16 * S, 16 * S, 5 * S, '#fff');
    ctx.fillStyle = '#000'; ctx.fillText('START', startX - 20.5 * S, gy - 12 * S);
  }
  // GOAL: 체크무늬 결승선 + 깃대 리본
  for (let i = 0; i < n; i++) {
    const y0 = i * laneH, gy = y0 + laneH - groundH;
    for (let yy = y0 + 10 * S; yy < gy; yy += 2 * S) for (let k = 0; k < 2; k++) px(finishX + 8 * S + k * 2 * S, yy, 2 * S, 2 * S, ((yy - y0) / (2 * S) + k) % 2 ? '#000' : '#fff');
    px(finishX + 7 * S, y0 + 8 * S, 6 * S, 2 * S, '#e4402c');
  }
  const wave = Math.floor(t / 250) % 2;
  px(finishX + 13 * S, S, S, 9 * S, '#ddd');
  px(finishX + 14 * S, S + wave * S, 14 * S, 6 * S, '#e4402c');
  ctx.font = `${3 * S}px 'Press Start 2P', monospace`;
  ctx.fillStyle = '#fff'; ctx.fillText('GOAL', finishX + 15 * S, 6 * S + wave * S);

  // 참가자
  state.members.forEach((m, i) => {
    const goal = target(m);
    const cur = shown.has(m.id) ? shown.get(m.id) : 0;
    const p = Math.abs(goal - cur) < 0.004 ? goal : cur + (goal - cur) * 0.06;
    shown.set(m.id, Math.abs(goal - p) < 0.0005 ? goal : p);
    const y0 = i * laneH, gy = y0 + laneH - groundH;
    const x = Math.round(startX + p * (finishX - startX - 16 * S));
    const oy = gy - 24 * S;
    const pose = m.status === 'run' ? 'run' : m.status;
    const frame = pose === 'run' ? Math.floor(t / 110) % 4 : pose === 'drink' ? Math.floor(t / 650) % 2 : Math.floor(t / 700) % 3;
    if (pose === 'run' && frame % 2 === 0) { px(x - 3 * S, gy - 2 * S, 2 * S, S, '#fff'); px(x - 6 * S, gy - 3 * S, S, S, '#fff'); }
    // 그림자
    px(x + 3 * S, gy - S, 10 * S, S, 'rgba(0,0,0,.25)');
    Pixel.draw(ctx, m.avatar, pose, frame, x, oy, S, pose === 'sleep' ? 0 : fireLevel(liveToday(m)));
    // 완주 반짝이
    if (goal >= 1 && view === 'today') {
      const tw = Math.floor(t / 200) % 4;
      [[-3, 4], [17, 8], [-1, 14], [19, 18]].forEach(([dx, dy], k) => { if ((k + tw) % 2) { px(x + dx * S, oy + dy * S, S, 3 * S, '#fcd83c'); px(x + (dx - 1) * S, oy + (dy + 1) * S, 3 * S, S, '#fcd83c'); } });
    }
    // 이름표
    const label = `${m.username} ${shortFmt(metric(m))}${goal >= 1 && view === 'today' ? ' CLEAR!' : ''}`;
    ctx.font = `${5 * S}px Galmuri11, monospace`;
    const lw = ctx.measureText(label).width;
    const lx = Math.max(3 * S, Math.min(W - lw - 3 * S, x + 8 * S - lw / 2));
    outlined(label, lx, y0 + 7 * S, m.id === state.me ? '#fcd83c' : '#fff');
    if (m.id === state.me) { ctx.font = `${3 * S}px 'Press Start 2P', monospace`; outlined('1P', lx - 9 * S, y0 + 6.5 * S, '#e4402c'); }
  });
}
function loop(t) {
  if (state && W) drawTrack(t);
  requestAnimationFrame(loop);
}

// ───────── 타이머 (공부 시작 = 달리기) ─────────
const T = { total: 25 * 60, left: 25 * 60, run: false, iv: null };
function drawT() {
  $('#tDisp').textContent = `${String(Math.floor(T.left / 60)).padStart(2, '0')}:${String(T.left % 60).padStart(2, '0')}`;
  $('#hudTime').textContent = $('#tDisp').textContent;
  $('#tBar').style.width = ((T.total - T.left) / T.total) * 100 + '%';
  $('#tStart').disabled = T.run;
  $$('[data-min]').forEach((b) => { b.classList.toggle('green', +b.dataset.min * 60 === T.total); b.disabled = T.run; });
}
$$('[data-min]').forEach((b) => (b.onclick = () => { T.total = T.left = +b.dataset.min * 60; drawT(); }));
$('#tStart').onclick = async () => {
  T.run = true;
  if (Noise.type !== 'off') Noise.play();
  const endAt = Date.now() + T.left * 1000;
  api('/presence', { method: 'POST', body: { state: 'study', minutes: Math.ceil(T.left / 60) } }).then(poll).catch(() => {});
  T.iv = setInterval(async () => {
    T.left = Math.max(0, Math.round((endAt - Date.now()) / 1000));
    drawT();
    if (T.left === 0) {
      clearInterval(T.iv); T.run = false;
      Noise.stop();
      beep();
      try {
        await api('/focus/' + D.today(), { method: 'POST', body: { minutes: T.total / 60 } });
        await api('/presence', { method: 'POST', body: { state: 'rest' } });
      } catch {}
      pxToast(`STAGE CLEAR! ${T.total / 60}분 달리기 완료 — 물 한 잔 마시고 쉬어요`, 3500);
      T.left = T.total; drawT(); poll();
    }
  }, 250);
  drawT();
};
$('#tStop').onclick = async () => {
  if (!T.run) return;
  const doneMin = Math.floor((T.total - T.left) / 60); // 중간에 멈춰도 공부한 만큼은 기록
  clearInterval(T.iv); T.run = false; T.left = T.total; drawT();
  Noise.stop();
  try {
    await api('/presence', { method: 'POST', body: { state: 'rest' } });
    if (doneMin >= 1) { await api('/focus/' + D.today(), { method: 'POST', body: { minutes: doneMin } }); pxToast(`${doneMin}분 기록했어요. 잠깐 쉬어 가요!`); }
  } catch {}
  poll();
};
window.addEventListener('beforeunload', (e) => { if (T.run) { e.preventDefault(); e.returnValue = ''; } });
function beep() {
  try {
    const a = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.18, 0.36].forEach((d, i) => {
      const o = a.createOscillator(), g = a.createGain();
      o.type = 'square'; o.frequency.value = [523, 659, 784][i];
      o.connect(g); g.connect(a.destination);
      g.gain.setValueAtTime(0.12, a.currentTime + d); g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + d + 0.16);
      o.start(a.currentTime + d); o.stop(a.currentTime + d + 0.17);
    });
  } catch {}
}

// ───────── 백색소음 (noise.js) — 달리는 동안 재생 ─────────
bindNoiseUI({ select: $('#noiseType'), vol: $('#noiseVol'), test: $('#noiseTest'), isRunning: () => T.run });

// ───────── 캐릭터 꾸미기 ─────────
const HAIR_COLORS = ['#2b1d16', '#3b2a20', '#6b4423', '#a0522d', '#d4a15a', '#f2d16b', '#c0392b', '#ff8fb1', '#8e44ad', '#2e86c1', '#e8e8e8'];
const CLOTH_COLORS = ['#e07a5f', '#f2b84b', '#ffd34e', '#81b29a', '#6fdc8c', '#3d5a80', '#7fa7c9', '#5fb3f0', '#b48ead', '#ff6fa5', '#ffffff', '#2b2b2b'];
let draft = null, edPose = 'run', edFirst = false;

function openEditor(first = false) {
  edFirst = first;
  draft = { ...(myAvatar || avatarDefaults) };
  $('#edTitle').textContent = first ? 'PLAYER SELECT · 입장 전에 캐릭터를 꾸며 주세요!' : '내 캐릭터 꾸미기';
  $('#edCancel').textContent = first ? '기본으로 입장' : '취소';
  renderOpts();
  $('#edOv').classList.add('open');
}
function renderOpts() {
  const sw = (key, colors) => `<div class="chips">${colors.map((c) => `<button type="button" class="sw ${draft[key] === c ? 'on' : ''}" style="background:${c}" data-k="${key}" data-v="${c}" aria-label="${c}"></button>`).join('')}</div>`;
  const ch = (key, map) => `<div class="chips">${Object.entries(map).map(([v, n]) => `<button type="button" class="${draft[key] === v ? 'on' : ''}" data-k="${key}" data-v="${v}">${n}</button>`).join('')}</div>`;
  $('#edOpts').innerHTML = `
    <div class="opt"><b>피부색</b><div class="chips">${Pixel.SKINS.map((c, i) => `<button type="button" class="sw ${draft.skin === i ? 'on' : ''}" style="background:${c}" data-k="skin" data-v="${i}" data-num="1"></button>`).join('')}</div></div>
    <div class="opt"><b>머리 모양</b>${ch('hair', Pixel.HAIRS)}</div>
    <div class="opt"><b>머리색</b>${sw('hairColor', HAIR_COLORS)}</div>
    <div class="opt"><b>윗옷</b>${sw('shirt', CLOTH_COLORS)}</div>
    <div class="opt"><b>바지</b>${sw('pants', CLOTH_COLORS)}</div>
    <div class="opt"><b>신발</b>${sw('shoes', CLOTH_COLORS)}</div>
    <div class="opt"><b>액세서리</b>${ch('acc', Pixel.ACCS)}</div>
    <div class="opt"><b>액세서리 색</b>${sw('accColor', CLOTH_COLORS)}</div>`;
}
$('#edOpts').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-k]'); if (!b) return;
  draft[b.dataset.k] = b.dataset.num ? +b.dataset.v : b.dataset.v;
  renderOpts();
});
$$('[data-pose]').forEach((b) => (b.onclick = () => { edPose = b.dataset.pose; $$('[data-pose]').forEach((x) => x.classList.toggle('on', x === b)); }));
$('#edRandom').onclick = () => {
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  draft = { skin: Math.floor(Math.random() * 5), hair: pick(Object.keys(Pixel.HAIRS)), hairColor: pick(HAIR_COLORS), shirt: pick(CLOTH_COLORS),
    pants: pick(CLOTH_COLORS), shoes: pick(CLOTH_COLORS), acc: pick(Object.keys(Pixel.ACCS)), accColor: pick(CLOTH_COLORS) };
  renderOpts();
};
async function saveAvatar(a) {
  const r = await api('/avatar', { method: 'PUT', body: { avatar: a } });
  myAvatar = r.avatar;
  $('#edOv').classList.remove('open');
  if (state) poll();
}
$('#edSave').onclick = () => saveAvatar(draft).then(() => pxToast('캐릭터를 저장했어요')).catch((e) => pxToast(e.message));
$('#edCancel').onclick = () => { if (edFirst) saveAvatar(avatarDefaults); else $('#edOv').classList.remove('open'); };
$('#btnAvatar').onclick = () => openEditor(false);

// 미리보기 애니메이션
(function edLoop(t) {
  if ($('#edOv').classList.contains('open') && draft) {
    const c = $('#edCanvas'), g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    // 미리보기 무대: 하늘 · 구름 · 벽돌 땅
    g.fillStyle = '#5c8df6'; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#fff'; g.fillRect(14, 22, 30, 6); g.fillRect(8, 28, 44, 8); g.fillRect(104, 40, 26, 5); g.fillRect(98, 45, 40, 7);
    g.fillStyle = '#3cbc3c'; g.fillRect(0, 171, c.width, 5);
    g.fillStyle = '#c4622d'; g.fillRect(0, 176, c.width, c.height - 176);
    g.fillStyle = '#7a3410'; for (let y = 186; y < c.height; y += 12) g.fillRect(0, y, c.width, 2);
    for (let y = 176, r = 0; y < c.height; y += 12, r++) for (let x = r % 2 ? 12 : 0; x < c.width; x += 24) g.fillRect(x, y, 2, 10);
    const frame = edPose === 'run' ? Math.floor(t / 120) % 4 : edPose === 'drink' ? Math.floor(t / 650) % 2 : Math.floor(t / 700) % 3;
    Pixel.draw(g, draft, edPose, frame, edPose === 'sleep' ? 14 : 32, 171 - 144, 6, edPose === 'run' ? 2 : 0);
  }
  requestAnimationFrame(edLoop);
})(0);

// ───────── 시작 ─────────
(async () => {
  try {
    $('#hudName').textContent = Auth.user || '-';
    await Promise.all([document.fonts.load('12px Galmuri11'), document.fonts.load("12px 'Press Start 2P'")]).catch(() => {});
    const a = await api('/avatar');
    myAvatar = a.avatar; avatarDefaults = a.defaults;
    if (roomCode) await enterRoom(roomCode);
    else await showLobby();
  } catch (e) { pxToast(e.message); }
  drawT();
})();
