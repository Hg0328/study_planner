// 메인 화면: 로그인, 월간 캘린더, D-Day/진행률, 설정
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

let view = (() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; })();
let exams = [];
let settings = null;
let dirty = false;

// ───────── 로그인 ─────────
let signup = false;
$('#authToggle').onclick = (e) => {
  e.preventDefault();
  signup = !signup;
  $('#authSubmit').textContent = signup ? '회원가입' : '로그인';
  $('#authHint').textContent = signup ? '이미 계정이 있나요?' : '처음이신가요?';
  $('#authToggle').textContent = signup ? '로그인' : '회원가입';
  $('#authErr').textContent = '';
};
$('#authForm').onsubmit = async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  try {
    const r = await api(signup ? '/auth/signup' : '/auth/login', { method: 'POST', body: { username: f.get('username'), password: f.get('password') } });
    Auth.set(r.token, r.username);
    const next = new URLSearchParams(location.search).get('next');
    if (next && /^planner\.html\?date=\d{4}-\d{2}-\d{2}$/.test(next)) { location.href = next; return; }
    $('#authOv').classList.remove('open');
    boot(signup);
  } catch (err) { $('#authErr').textContent = err.message; }
};
$('#btnLogout').onclick = () => { Auth.clear(); location.reload(); };

// ───────── 캘린더 ─────────
async function renderCalendar() {
  const first = new Date(view.y, view.m, 1);
  const start = new Date(first); start.setDate(1 - first.getDay());
  const cells = [];
  for (let i = 0; i < 42; i++) { const d = new Date(start); d.setDate(start.getDate() + i); cells.push(d); }
  // 마지막 주가 전부 다음 달이면 생략
  const trimmed = cells[35].getMonth() !== view.m ? cells.slice(0, 35) : cells;
  const from = D.fmt(trimmed[0]), to = D.fmt(trimmed[trimmed.length - 1]);

  $('#calTitle').innerHTML = `${view.m + 1}월<small>${view.y}</small>`;
  const { days, exams: ex } = await api(`/summary?from=${from}&to=${to}`);
  exams = ex;
  const today = D.today();
  const byDate = {};
  for (const e of exams) (byDate[e.date] ||= []).push(e);

  let html = DAY_KO.map((d, i) => `<div class="wd ${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}">${d}</div>`).join('');
  for (const d of trimmed) {
    const ds = D.fmt(d);
    const info = days[ds];
    const cls = ['day', d.getMonth() !== view.m && 'other', d.getDay() === 0 && 'sun', d.getDay() === 6 && 'sat',
      ds === today && 'today', ds < today && 'past'].filter(Boolean).join(' ');
    const stickers = (byDate[ds] || []).map((e) => `<span class="sticker" style="--c:${e.color}">${esc(e.subject)}</span>`).join('');
    let bottom = '';
    if (info && info.total) {
      const pct = Math.round((info.done / info.total) * 100);
      bottom = `<div class="dots">${info.colors.map((c) => `<i style="--c:${c}"></i>`).join('')}</div>
        <div class="mini"><div class="bar"><i style="width:${pct}%;--c:${pct === 100 ? 'var(--accent)' : 'var(--sage)'}"></i></div>
        <small>${info.done}/${info.total} 완료</small></div>
        ${pct === 100 ? '<span class="stamp">참잘</span>' : ''}`;
    }
    html += `<a class="${cls}" href="planner.html?date=${ds}" target="_blank" rel="opener" title="${D.pretty(ds)} 플래너 열기">
      <span class="num">${d.getDate()}</span>${info?.mood ? `<span class="mood">${info.mood}</span>` : ''}
      ${stickers}${bottom}</a>`;
  }
  $('#cal').innerHTML = html;

  $('#emptyBox').innerHTML = exams.length ? '' : `<div class="empty">
      <div class="hand" style="font-size:30px">아직 등록된 시험이 없어요</div>
      <p>시험 과목과 날짜, 학교·학원 시간을 입력하면 공부 계획을 자동으로 만들어 드려요.</p>
      <button class="btn primary" onclick="openSettings()">📝 시험 등록하러 가기</button></div>`;
}

// ───────── 사이드바 ─────────
async function renderSide() {
  const today = D.today();
  const upcoming = exams.filter((e) => e.date >= today);
  const next = upcoming[0];
  $('#bigDday').innerHTML = next
    ? `<div class="s">가장 가까운 시험</div>
       <div class="n">${dday(D.diff(today, next.date))}</div>
       <div><span class="chip" style="--c:${next.color}">${esc(next.subject)}</span>
       <span class="muted" style="font-size:13px">${D.pretty(next.date)}</span></div>`
    : `<div class="s">다가오는 시험</div><div class="hand" style="font-size:26px">시험을 등록해 주세요</div>`;

  $('#dlist').innerHTML = exams.map((e) => {
    const n = D.diff(today, e.date);
    return `<li><a href="planner.html?date=${e.date}" target="_blank" rel="opener" class="${n < 0 ? 'past' : ''}">
      <span class="dot" style="--c:${e.color}"></span>${esc(e.subject)}
      <span class="muted" style="font-size:12px">${D.pretty(e.date)}</span>
      <span class="dd">${dday(n)}</span></a></li>`;
  }).join('') || '<li class="muted" style="font-size:13px">등록된 시험이 없어요</li>';

  const st = await api('/stats?today=' + today);
  $('#progList').innerHTML = st.subjects.map((s) => {
    const pct = s.total ? Math.round((s.done / s.total) * 100) : 0;
    return `<div class="prog"><div class="row"><span>${esc(s.subject)}</span>
      <span class="muted">${fmtMin(s.doneMin)} / ${fmtMin(s.planMin)} · ${pct}%</span></div>
      <div class="bar"><i style="width:${pct}%;--c:${s.color}"></i></div></div>`;
  }).join('') || '<p class="muted" style="font-size:13px">계획을 만들면 여기서 진행률을 볼 수 있어요</p>';
  $('#stPct').textContent = (st.total ? Math.round((st.done / st.total) * 100) : 0) + '%';
  $('#stStreak').textContent = st.streak + '일';
  $('#stFocus').textContent = fmtMin(st.focusMin);
}

async function refresh() {
  await renderCalendar();
  await renderSide();
}

$('#prevM').onclick = () => { view.m--; if (view.m < 0) { view.m = 11; view.y--; } renderCalendar(); };
$('#nextM').onclick = () => { view.m++; if (view.m > 11) { view.m = 0; view.y++; } renderCalendar(); };
$('#thisM').onclick = () => { const d = new Date(); view = { y: d.getFullYear(), m: d.getMonth() }; renderCalendar(); };

async function generate() {
  const btn = $('#btnGenerate');
  btn.disabled = true;
  try {
    const r = await api('/generate', { method: 'POST', body: { startDate: D.today() } });
    toast(`✨ ${D.pretty(r.from)} ~ ${D.pretty(r.to)} · 총 ${fmtMin(r.studyMin)} 계획 완성!`, 3200);
    await refresh();
    notifyChange();
  } catch (e) { toast(e.message); }
  finally { btn.disabled = false; }
}
$('#btnGenerate').onclick = generate;

// ───────── 설정 모달 ─────────
$$('#tabs button').forEach((b) => (b.onclick = () => {
  $$('#tabs button').forEach((x) => x.classList.toggle('on', x === b));
  $$('.tab-pane').forEach((p) => p.classList.toggle('on', p.dataset.pane === b.dataset.tab));
}));

async function openSettings() {
  settings = await api('/settings');
  exams = await api('/exams');
  fillSettings();
  renderExamList();
  resetExamForm();
  dirty = false;
  $('#setOv').classList.add('open');
}
window.openSettings = openSettings;
$('#btnSettings').onclick = openSettings;

async function closeSettings() {
  $('#setOv').classList.remove('open');
  if (dirty) { dirty = false; if (exams.some((e) => e.date >= D.today())) await generate(); else await refresh(); }
}
$('#setClose').onclick = closeSettings;
$('#setOv').addEventListener('mousedown', (e) => { if (e.target.id === 'setOv') closeSettings(); });

function fillSettings() {
  const s = settings;
  $('#schoolTable tbody').innerHTML = s.school.map((d, i) => `<tr>
    <td class="${i === 0 ? 'sun' : ''}" style="color:${i === 0 ? 'var(--sun)' : i === 6 ? 'var(--sat)' : ''}">${DAY_KO[i]}요일</td>
    <td><input type="checkbox" data-i="${i}" data-k="on" ${d.on ? 'checked' : ''}></td>
    <td><input class="input" type="time" data-i="${i}" data-k="start" value="${d.start}"></td>
    <td><input class="input" type="time" data-i="${i}" data-k="end" value="${d.end}"></td></tr>`).join('');
  $('#examDayStart').value = s.examDay.start; $('#examDayEnd').value = s.examDay.end;
  $('#wake').value = s.wake; $('#sleep').value = s.sleep;
  $('#dinnerStart').value = s.dinner.start; $('#dinnerEnd').value = s.dinner.end;
  $('#lunchStart').value = s.lunch.start; $('#lunchEnd').value = s.lunch.end;
  $('#blockMin').value = s.blockMin; $('#breakMin').value = s.breakMin; $('#bufferMin').value = s.bufferMin;
  $('#maxWeekday').value = s.maxWeekdayMin / 60; $('#maxWeekend').value = s.maxWeekendMin / 60;
  $('#reviewSlot').checked = s.reviewSlot;
  renderAcademies();
}

function renderAcademies() {
  $('#acaList').innerHTML = settings.academies.map((a, i) => `<div class="list-card" data-i="${i}">
    <div class="grow">
      <div class="grid3">
        <label class="field">학원 이름<input class="input" data-k="name" value="${esc(a.name)}"></label>
        <label class="field">시작<input class="input" type="time" data-k="start" value="${a.start}"></label>
        <label class="field">끝<input class="input" type="time" data-k="end" value="${a.end}"></label>
      </div>
      <div class="daypick">${DAY_KO.map((d, j) => `<label><input type="checkbox" data-day="${j}" ${a.days.includes(j) ? 'checked' : ''}><span>${d}</span></label>`).join('')}</div>
    </div>
    <button class="x" data-del="${i}" title="삭제">✕</button></div>`).join('')
    || '<p class="muted" style="font-size:14px">등록된 학원이 없어요. 학원 시간은 공부 계획에서 자동으로 빠져요.</p>';
}
$('#acaAdd').onclick = () => {
  readAcademies();
  settings.academies.push({ name: '학원', days: [1, 3, 5], start: '18:00', end: '20:00' });
  renderAcademies(); dirty = true;
};
$('#acaList').addEventListener('click', (e) => {
  const i = e.target.dataset.del;
  if (i !== undefined) { readAcademies(); settings.academies.splice(+i, 1); renderAcademies(); dirty = true; }
});
function readAcademies() {
  settings.academies = $$('#acaList .list-card').map((card) => ({
    name: $('[data-k=name]', card).value || '학원',
    start: $('[data-k=start]', card).value,
    end: $('[data-k=end]', card).value,
    days: $$('[data-day]', card).filter((c) => c.checked).map((c) => +c.dataset.day),
  }));
}
function readSettings() {
  const s = settings;
  $$('#schoolTable [data-i]').forEach((el) => { s.school[+el.dataset.i][el.dataset.k] = el.type === 'checkbox' ? el.checked : el.value; });
  s.examDay = { start: $('#examDayStart').value, end: $('#examDayEnd').value };
  s.wake = $('#wake').value; s.sleep = $('#sleep').value;
  s.dinner = { start: $('#dinnerStart').value, end: $('#dinnerEnd').value };
  s.lunch = { start: $('#lunchStart').value, end: $('#lunchEnd').value };
  s.blockMin = +$('#blockMin').value; s.breakMin = +$('#breakMin').value; s.bufferMin = +$('#bufferMin').value;
  s.maxWeekdayMin = Math.round(+$('#maxWeekday').value * 60); s.maxWeekendMin = Math.round(+$('#maxWeekend').value * 60);
  s.reviewSlot = $('#reviewSlot').checked;
  readAcademies();
}
$('#setOv').addEventListener('input', (e) => { if (!e.target.closest('#examForm')) dirty = true; });
$('#setSave').onclick = async () => {
  readSettings();
  try {
    settings = await api('/settings', { method: 'PUT', body: settings });
    dirty = true;
    await closeSettings();
  } catch (e) { toast(e.message); }
};

// 시험 과목 CRUD
function renderExamList() {
  const today = D.today();
  $('#examList').innerHTML = exams.map((e) => `<div class="list-card">
    <span class="dot" style="width:14px;height:14px;border-radius:50%;background:${e.color};flex:none"></span>
    <div class="grow"><b>${esc(e.subject)}</b> <span class="muted" style="font-size:13px">${D.pretty(e.date)} · ${dday(D.diff(today, e.date))}</span>
      <div style="font-size:13px"><span class="stars">${'★'.repeat(e.difficulty)}${'☆'.repeat(5 - e.difficulty)}</span>
      <span class="muted">${esc(e.scope) || '범위 미입력'}</span></div></div>
    <button class="btn small ghost" data-edit="${e.id}">수정</button>
    <button class="x" data-rm="${e.id}" title="삭제">✕</button></div>`).join('')
    || '<p class="muted" style="font-size:14px">시험 과목을 추가해 주세요. 예) 국어 · 11/24 · ★★★</p>';
}
function resetExamForm() {
  const f = $('#examForm');
  f.reset(); f.id.value = '';
  f.color.value = ['#e07a5f', '#81b29a', '#7fa7c9', '#f2b84b', '#b48ead', '#e8998d', '#6d9dc5', '#a3b86c', '#d4a373', '#9a8c98'][exams.length % 10];
  $('#examSubmit').textContent = '+ 과목 추가';
  $('#examCancel').hidden = true;
}
$('#examCancel').onclick = resetExamForm;
$('#examForm').onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target;
  const body = { subject: f.subject.value, date: f.date.value, difficulty: +f.difficulty.value, scope: f.scope.value, color: f.color.value };
  try {
    if (f.id.value) await api('/exams/' + f.id.value, { method: 'PUT', body });
    else await api('/exams', { method: 'POST', body });
    exams = await api('/exams');
    dirty = true;
    renderExamList(); resetExamForm();
    toast('시험 과목을 저장했어요');
  } catch (err) { toast(err.message); }
};
$('#examList').addEventListener('click', async (e) => {
  const edit = e.target.dataset.edit, rm = e.target.dataset.rm;
  if (edit) {
    const x = exams.find((v) => v.id == edit), f = $('#examForm');
    f.id.value = x.id; f.subject.value = x.subject; f.date.value = x.date;
    f.difficulty.value = x.difficulty; f.scope.value = x.scope; f.color.value = x.color;
    $('#examSubmit').textContent = '수정 저장'; $('#examCancel').hidden = false;
    f.subject.focus();
  }
  if (rm) {
    if (e.target.dataset.sure !== '1') { e.target.dataset.sure = '1'; e.target.textContent = '삭제?'; e.target.style.color = 'var(--sun)'; e.target.style.fontSize = '13px'; return; }
    await api('/exams/' + rm, { method: 'DELETE' });
    exams = await api('/exams'); dirty = true; renderExamList();
  }
});

// ───────── 시험 범위 빠른 입력 (사진·캡처·글) ─────────
let cfg = { ai: false };
let cands = [];
const qStatus = (html) => { $('#qStatus').innerHTML = html; };

function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res;
    s.onerror = () => rej(new Error('글자 인식 도구를 불러오지 못했어요 (인터넷 연결을 확인해 주세요)'));
    document.head.appendChild(s);
  });
}

// 사진을 적당한 크기의 JPEG로 줄이기 (전송·인식 속도 ↑)
function downscale(file, max = 1800) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      const g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      res(c.toDataURL('image/jpeg', 0.88));
    };
    img.onerror = () => rej(new Error('이미지를 열 수 없어요. JPG나 PNG 파일로 시도해 주세요'));
    img.src = URL.createObjectURL(file);
  });
}

// 무료 글자 인식 (브라우저에서 Tesseract.js 실행)
async function ocr(dataUrl) {
  if (!window.Tesseract) await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js');
  const { data } = await Tesseract.recognize(dataUrl, 'kor+eng', {
    logger: (m) => {
      if (m.status === 'recognizing text') qStatus(`<span class="spin">⏳</span> 사진에서 글자 읽는 중… ${Math.round(m.progress * 100)}%`);
      else qStatus('<span class="spin">⏳</span> 글자 인식 준비 중… (처음 한 번은 1분 정도 걸릴 수 있어요)');
    },
  });
  return data.text;
}

async function handleImage(file) {
  if (!file || !file.type.startsWith('image/')) return toast('이미지 파일만 올릴 수 있어요');
  $('#qResult').innerHTML = '';
  try {
    qStatus('<span class="spin">⏳</span> 사진 준비 중…');
    const dataUrl = await downscale(file);
    $('#dropPreview').src = dataUrl; $('#dropPreview').hidden = false;
    let r = null;
    if (cfg.ai) {
      qStatus('<span class="spin">⏳</span> AI가 시험 범위를 읽는 중… (10~20초)');
      try { r = await api('/exams/extract', { method: 'POST', body: { image: dataUrl, today: D.today() } }); }
      catch (e) { toast(e.message + ' → 무료 인식으로 다시 시도할게요', 3000); }
    }
    if (!r) {
      const text = await ocr(dataUrl);
      $('#pasteText').value = text.trim();
      $('#pasteBox').open = true;
      r = await api('/exams/extract', { method: 'POST', body: { text, today: D.today() } });
    }
    showCands(r.items, r.method);
  } catch (e) { qStatus(`<span style="color:var(--sun)">⚠️ ${esc(e.message)}</span>`); }
}

$('#drop').onclick = () => $('#imgFile').click();
$('#drop').onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#imgFile').click(); } };
$('#imgFile').onchange = (e) => { handleImage(e.target.files[0]); e.target.value = ''; };
$('#drop').addEventListener('dragover', (e) => { e.preventDefault(); $('#drop').classList.add('over'); });
$('#drop').addEventListener('dragleave', () => $('#drop').classList.remove('over'));
$('#drop').addEventListener('drop', (e) => { e.preventDefault(); $('#drop').classList.remove('over'); handleImage(e.dataTransfer.files[0]); });
// 캡처 후 Ctrl+V
document.addEventListener('paste', (e) => {
  if (!$('#setOv').classList.contains('open')) return;
  const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
  if (!item) return;
  e.preventDefault();
  $('[data-tab=exam]').click();
  handleImage(item.getAsFile());
});

$('#parseText').onclick = async () => {
  const text = $('#pasteText').value;
  if (!text.trim()) return toast('시험 범위 글을 붙여넣어 주세요');
  qStatus('<span class="spin">⏳</span> 과목과 범위를 찾는 중…');
  try {
    const r = await api('/exams/extract', { method: 'POST', body: { text, today: D.today() } });
    showCands(r.items, r.method);
  } catch (e) { qStatus(`<span style="color:var(--sun)">⚠️ ${esc(e.message)}</span>`); }
};

function showCands(items, method) {
  cands = items.map((it) => ({ ...it, difficulty: 3, on: true }));
  if (!cands.length) {
    qStatus('');
    $('#qResult').innerHTML = `<p style="color:var(--sun);font-size:14px">과목을 찾지 못했어요 😥 사진을 더 밝고 선명하게 찍거나, 글 붙여넣기 칸에서 내용을 고친 뒤 다시 찾아보세요.</p>`;
    return;
  }
  qStatus(`✅ <b>${cands.length}개 과목</b>을 찾았어요. ${method === 'ai' ? 'AI가 읽은 결과예요.' : '자동 인식 결과예요.'} 날짜와 범위가 맞는지 확인하고 고쳐 주세요.`);
  renderCands();
}
function renderCands() {
  const opts = (v) => [1, 2, 3, 4, 5].map((n) => `<option value="${n}" ${n === v ? 'selected' : ''}>${'★'.repeat(n)}</option>`).join('');
  $('#qResult').innerHTML = `<div class="cands">
    <div class="cand head"><span></span><span>과목</span><span>시험 날짜</span><span class="c-diff">난이도</span><span class="c-scope">시험 범위</span><span></span></div>
    ${cands.map((c, i) => `<div class="cand ${c.date ? '' : 'nodate'} ${c.on ? '' : 'off'}" data-i="${i}">
      <input type="checkbox" data-k="on" ${c.on ? 'checked' : ''} aria-label="추가할지 선택">
      <input class="input" data-k="subject" value="${esc(c.subject)}" maxlength="30">
      <input class="input" type="date" data-k="date" value="${c.date}">
      <select class="input c-diff" data-k="difficulty">${opts(c.difficulty)}</select>
      <input class="input c-scope" data-k="scope" value="${esc(c.scope)}" placeholder="범위 (쉼표로 단원 구분)" maxlength="500">
      <button type="button" class="x" data-rmc="${i}" title="빼기">✕</button></div>`).join('')}
  </div>
  <div class="cand-foot">
    <button type="button" class="btn small primary" id="candAdd">✔ 선택한 과목 모두 추가</button>
    <span class="muted" style="font-size:12px">빨간 칸 = 날짜를 못 찾았어요 · 이미 있는 과목은 날짜·범위가 업데이트돼요</span>
  </div>`;
}
$('#qResult').addEventListener('input', (e) => {
  const row = e.target.closest('.cand[data-i]'); if (!row) return;
  const c = cands[+row.dataset.i], k = e.target.dataset.k;
  c[k] = k === 'on' ? e.target.checked : k === 'difficulty' ? +e.target.value : e.target.value;
  row.classList.toggle('nodate', !c.date);
  row.classList.toggle('off', !c.on);
});
$('#qResult').addEventListener('click', async (e) => {
  if (e.target.dataset.rmc !== undefined) { cands.splice(+e.target.dataset.rmc, 1); return cands.length ? renderCands() : showCands([], ''); }
  if (e.target.id !== 'candAdd') return;
  const pick = cands.filter((c) => c.on);
  if (!pick.length) return toast('추가할 과목을 선택해 주세요');
  if (pick.some((c) => !c.subject.trim())) return toast('과목 이름이 비어 있는 줄이 있어요');
  if (pick.some((c) => !c.date)) return toast('날짜가 비어 있는 과목이 있어요 (빨간 칸)');
  try {
    const r = await api('/exams/bulk', { method: 'POST', body: { exams: pick.map(({ subject, date, difficulty, scope }) => ({ subject, date, difficulty, scope })) } });
    exams = await api('/exams');
    dirty = true;
    renderExamList(); resetExamForm();
    cands = []; $('#qResult').innerHTML = ''; $('#dropPreview').hidden = true;
    qStatus(`🎉 ${r.added}개 추가${r.updated ? `, ${r.updated}개 업데이트` : ''}했어요!${r.errors.length ? ` <span style="color:var(--sun)">(${esc(r.errors.join(' / '))})</span>` : ''}`);
  } catch (err) { toast(err.message); }
});

// ───────── 시작 ─────────
async function boot(isNew) {
  $('#app').hidden = false;
  api('/config').then((c) => {
    cfg = c;
    $('#aiBadge').textContent = c.ai ? 'AI 인식' : '무료 자동 인식';
  }).catch(() => {});
  $('#uname').textContent = Auth.user;
  $('#todayLink').href = `planner.html?date=${D.today()}`;
  await refresh();
  if (isNew) openSettings();
}
onChange(() => refresh());
document.addEventListener('visibilitychange', () => { if (!document.hidden && Auth.token) refresh(); });

if (Auth.token) boot(false).catch(() => {});
else $('#authOv').classList.add('open');
