// 플래너: [하루 | 일주일] 두 가지 보기
//  - 하루: 타임테이블, 체크리스트, 타이머, 회고
//  - 일주일: 일~토 7일 체크리스트, 내일로 미루기, 과목별 이번 주 시간, A4 가로 인쇄
//  - 주소: planner.html?date=YYYY-MM-DD&view=day|week (view가 없으면 기본 모드 = 일주일, 전문가 모드 = 마지막으로 본 보기)
//  - 데이터는 두 보기 모두 GET /api/week 한 번으로 읽음 (하루 보기는 그중 하루치를 씀)
const $ = (s) => document.querySelector(s);
if (!Auth.token) goLogin();

const params = new URLSearchParams(location.search);
let date = params.get('date');
if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) date = D.today();
let askedView = ['day', 'week'].includes(params.get('view')) ? params.get('view') : ''; // 주소로 지정한 보기
let view = askedView || 'day';
let wk = null;      // { from, to, days: [/api/day와 같은 형태 × 7] }
let data = null;    // 지금 날짜의 하루치 (wk.days 중 하나)
let hideDone = false;
let focusId = 0;    // 일주일 보기에서 타이머로 집중 중인 할 일

const QUOTES = [
  '오늘 걸은 한 걸음이 시험장에서의 자신감이 된다.',
  '완벽하게 말고, 끝까지.',
  '어제보다 한 문제 더.',
  '지금 하기 싫은 그 과목부터!',
  '쉬는 것도 계획의 일부예요. 잘 쉬고 다시 집중!',
  '틀린 문제는 보물. 오답노트에 꼭 적기 ✍️',
  '작은 체크 하나가 모여 큰 점수가 된다.',
];

// 할 일의 과목 표시 ("수학 · 수능" — 시험 종류가 2개 이상일 때)
function taskName(t, fallback) {
  const e = t.exam_id && data.exams.find((x) => x.id === t.exam_id);
  return e ? examName(e, data.exams) : t.subject || fallback;
}

const allTasks = () => wk.days.flatMap((d) => d.tasks);
const findTask = (id) => allTasks().find((t) => t.id === id);
const taskColor = (t) => t.color || (t.kind === 'review' ? '#b48ead' : '#9a8c98');
const href = (d, v = view) => `planner.html?date=${d}&view=${v}`;

async function load() {
  wk = await api('/week?from=' + D.weekStart(date));
  data = wk.days.find((d) => d.date === date);
  Mode.fromSettings(data.settings); // 기본 모드면 달성률·회고·직접 추가·다시 짜기를 숨김 (data-expert)
  // 보기 정하기: 주소에 있으면 그대로 / 기본 모드는 일주일 / 전문가 모드는 마지막으로 본 보기(서버 설정)
  view = askedView || (Mode.basic ? 'week' : data.settings.plannerView === 'week' ? 'week' : 'day');
  render();
  // 주소로 보기를 정해서 연 경우(탭·날짜 누르기·이전/다음)도 "마지막으로 본 보기"로 저장 (전문가 모드)
  if (!Mode.basic && askedView && data.settings.plannerView !== view) saveView(view);
}
async function saveView(v) {
  try { const s = await api('/settings'); if (s.plannerView !== v) await api('/settings', { method: 'PUT', body: { ...s, plannerView: v } }); } catch {}
}

// 보기 탭 (전문가 모드): 화면만 바꾸고(다시 읽지 않음) 마지막으로 본 보기를 서버 설정에 저장 — 테마와 같은 방식
async function setView(v) {
  if (v === view) return;
  view = askedView = v;
  history.replaceState(null, '', href(date));
  render();
  saveView(v);
}
$('#viewTabs').addEventListener('click', (e) => { const b = e.target.closest('button[data-view]'); if (b) setView(b.dataset.view); });

function render() {
  const today = D.today(), week = view === 'week';
  document.body.classList.toggle('view-week', week);
  document.body.classList.toggle('view-day', !week);
  document.querySelectorAll('#viewTabs button').forEach((b) => { b.classList.toggle('on', b.dataset.view === view); b.setAttribute('aria-selected', b.dataset.view === view); });
  // 타이머 카드는 하나만 두고, 보기에 따라 자리만 옮김
  const card = $('.timer-card'), slot = week ? $('#weekTimerSlot') : $('.cols > .side');
  if (card.parentNode !== slot) { if (week) slot.appendChild(card); else slot.insertBefore(card, slot.children[1] || null); }
  $('#printBtn').title = week ? '이번 주 할 일을 A4 가로 한 장으로 인쇄' : '할 일 목록만 한 장으로 인쇄';
  setPageSize(week);
  $('#weekLink').href = href(date, 'week');
  $('#weekLink').hidden = week;
  $('#ddays').innerHTML = data.exams
    .filter((e) => e.date >= (week ? today : date))
    .map((e) => `<span class="chip" style="--c:${e.color}">${esc(examName(e, data.exams))} ${dday(D.diff(week ? today : date, e.date))}</span>`)
    .join('') || '<span class="muted" style="font-size:13px">남은 시험이 없어요 🎉</span>';
  if (week) return renderWeek();

  document.title = `${D.pretty(date)} 플래너`;
  $('#dateTitle').innerHTML = `${D.pretty(date)}<small>${date.slice(0, 4)}</small>`;
  $('#prevDay').textContent = '‹ 어제'; $('#todayBtn').textContent = '오늘'; $('#nextDay').textContent = '내일 ›';
  $('#prevDay').href = href(D.add(date, -1));
  $('#nextDay').href = href(D.add(date, 1));
  $('#todayBtn').href = href(today);
  $('#jump').value = date;
  $('#quote').textContent = '“ ' + QUOTES[D.parse(date).getDate() % QUOTES.length] + ' ”';

  renderTimeline();
  renderTodos();
  renderProgress();
  renderMemo();
  renderTimerTasks();
  renderPrint();
}

// ───────── 인쇄용 시트 (할 일 체크표 한 장) ─────────
function renderPrint() {
  const upcoming = data.exams.filter((e) => e.date >= date);
  const timed = data.tasks.filter((t) => t.start != null);
  const planMin = timed.reduce((a, t) => a + t.end - t.start, 0);
  const fixed = data.fixed.map((b) => `${b.label} ${toHM(b.start)}–${toHM(b.end)}`).join(' · ');
  $('#printSheet').innerHTML = `
    <div class="ps-head">
      <div class="ps-date">${D.pretty(date)}</div>
      <div class="ps-dd">${upcoming.slice(0, 6).map((e) => `<b>${esc(examName(e, data.exams))} ${dday(D.diff(date, e.date))}</b>`).join('')}</div>
    </div>
    <div class="ps-meta">할 일 ${data.tasks.length}개 · 계획 공부 ${fmtMin(planMin)}${fixed ? ` · 고정 일정: ${esc(fixed)}` : ''}</div>
    ${data.tasks.length ? `<table class="ps">
      <thead><tr><th style="width:22px"></th><th>시간</th><th>과목</th><th>할 일</th></tr></thead>
      <tbody>${data.tasks.map((t) => `<tr class="${t.done ? 'ps-done' : ''}">
        <td><span class="ps-box ${t.done ? 'on' : ''}"></span></td>
        <td class="ps-time">${t.start != null ? `${toHM(t.start)}–${toHM(t.end)}` : '자유'}</td>
        <td class="ps-sub" style="--c:${t.color || (t.kind === 'review' ? '#b48ead' : '#9a8c98')}">${esc(taskName(t, '기타'))}</td>
        <td><span class="ps-title">${esc(t.title)}</span>${t.note ? `<span class="ps-note">📝 ${esc(t.note)}</span>` : ''}</td>
      </tr>`).join('')}</tbody></table>` : '<p>계획된 할 일이 없어요.</p>'}
    <div class="ps-memo"><b>메모 · 회고 ${data.memo.mood || ''}</b><div class="ps-lines">${esc(data.memo.text || '')}</div></div>`;
}

// ───────── 타임테이블 ─────────
const PX = 0.9; // 1분당 px
function renderTimeline() {
  const timed = data.tasks.filter((t) => t.start != null);
  const wake = toMin(data.settings.wake);
  let sleep = toMin(data.settings.sleep); if (sleep <= wake) sleep = 1440;
  const all = [...data.fixed, ...timed];
  const startH = Math.floor(Math.min(wake, ...all.map((b) => b.start)) / 60);
  const endH = Math.min(24, Math.ceil(Math.max(sleep, ...all.map((b) => b.end)) / 60));
  const base = startH * 60;
  const el = $('#timeline');
  el.style.height = (endH - startH) * 60 * PX + 'px';

  let html = '';
  for (let h = startH; h <= endH; h++) html += `<div class="hr" style="top:${(h * 60 - base) * PX}px"><span>${D.pad(h)}</span></div>`;

  // 겹치는 고정 일정(예: 저녁+학원)은 반씩 나눠 표시
  const fixed = [...data.fixed].sort((a, b) => a.start - b.start);
  fixed.forEach((b, i) => {
    const ov = fixed.find((o, j) => j !== i && o.start < b.end && b.start < o.end);
    const half = ov ? (fixed.indexOf(ov) > i ? 'half' : 'half2') : '';
    html += `<div class="blk fixed ${b.kind} ${half}" style="top:${(b.start - base) * PX}px;height:${Math.max(16, (b.end - b.start) * PX - 2)}px">
      <b>${toHM(b.start)}</b>${esc(b.label)}</div>`;
  });
  for (const t of timed) {
    const c = t.color || (t.kind === 'review' ? '#b48ead' : '#9a8c98');
    html += `<div class="blk ${t.done ? 'done' : ''} ${(t.end - t.start) < 40 ? 'tiny' : ''}" data-id="${t.id}" style="--c:${c};top:${(t.start - base) * PX}px;height:${Math.max(16, (t.end - t.start) * PX - 2)}px" title="클릭해서 완료 체크">
      <b>${toHM(t.start)}</b>${esc(taskName(t, ''))} · ${esc(t.title)}</div>`;
  }
  if (date === D.today()) {
    const n = new Date(), m = n.getHours() * 60 + n.getMinutes();
    if (m >= base && m <= endH * 60) html += `<div class="nowline" style="top:${(m - base) * PX}px"></div>`;
  }
  el.innerHTML = html;
}
$('#timeline').addEventListener('click', (e) => {
  const b = e.target.closest('.blk[data-id]');
  if (b) toggle(+b.dataset.id);
});

// ───────── 할 일 목록 ─────────
const KIND = { study: '공부', review: '복습', final: '최종점검', manual: '직접 추가' };
function renderTodos() {
  const list = data.tasks.filter((t) => !(hideDone && t.done));
  const done = data.tasks.filter((t) => t.done).length;
  $('#todoCount').textContent = data.tasks.length ? `${done} / ${data.tasks.length}` : '';
  $('#hideDone').textContent = hideDone ? '완료 보이기' : '완료 숨기기';

  $('#todos').innerHTML = list.map((t) => {
    const c = t.color || (t.kind === 'review' ? '#b48ead' : '#9a8c98');
    return `<li class="todo ${t.done ? 'done' : ''}" data-id="${t.id}">
      <label class="check"><input type="checkbox" ${t.done ? 'checked' : ''} aria-label="완료"><span class="box"></span></label>
      <div class="tbody">
        <div class="ttop">
          <span>${t.start != null ? `${toHM(t.start)} – ${toHM(t.end)}` : '시간 자유'}</span>
          <span class="chip" style="--c:${c}">${esc(taskName(t, '기타'))}</span>
          <span class="kind">${KIND[t.kind] || ''}</span>
        </div>
        <div class="ttitle">${esc(t.title)}</div>
        ${t.note ? `<div class="tnote">📝 ${esc(t.note)}</div>` : ''}
        <div class="note-edit" hidden><input class="input" maxlength="300" placeholder="메모 (예: p.45~60 완료, 3번 다시 보기)" value="${esc(t.note)}"></div>
      </div>
      <div class="tact">
        <button data-act="note" title="메모">📝</button>
        <button data-act="tomorrow" title="내일로 미루기">⏭</button>
        <button data-act="del" title="삭제">✕</button>
      </div></li>`;
  }).join('') || `<li class="empty-todo"><div class="hand" style="font-size:calc(28px * var(--hand-scale))">${data.tasks.length ? '모두 완료! 수고했어요 🎉' : '이 날은 계획된 공부가 없어요'}</div>
    ${data.tasks.length ? '' : data.planUntil && date > data.planUntil
      ? '<p style="font-size:13px">계획은 오늘부터 4주씩 만들어져요. 이 날짜가 가까워지면 자동으로 이어서 만들어져요.</p>'
      : `<p style="font-size:13px">설정 창에서 시험을 등록하면 계획이 자동으로 만들어져요.${Mode.basic ? '' : ' 아래에서 직접 추가해도 돼요.'}</p>`}</li>`;

  $('#addForm').exam_id.innerHTML = `<option value="">기타</option>` +
    data.exams.filter((e) => e.date >= date).map((e) => `<option value="${e.id}">${esc(examName(e, data.exams))}</option>`).join('');
}

$('#todos').addEventListener('change', (e) => {
  if (e.target.type === 'checkbox') toggle(+e.target.closest('.todo').dataset.id);
});
$('#todos').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const li = btn.closest('.todo'), id = +li.dataset.id;
  if (btn.dataset.act === 'note') {
    const box = li.querySelector('.note-edit');
    box.hidden = !box.hidden;
    if (!box.hidden) box.querySelector('input').focus();
  } else if (btn.dataset.act === 'tomorrow') {
    await api('/tasks/' + id, { method: 'PATCH', body: { date: D.add(date, 1) } });
    toast('내일 할 일로 옮겼어요'); changed();
  } else if (btn.dataset.act === 'del') {
    await api('/tasks/' + id, { method: 'DELETE' });
    changed();
  }
});
$('#todos').addEventListener('keydown', async (e) => {
  if (e.key === 'Enter' && e.target.closest('.note-edit')) {
    const id = +e.target.closest('.todo').dataset.id;
    await api('/tasks/' + id, { method: 'PATCH', body: { note: e.target.value } });
    changed();
  }
});
$('#todos').addEventListener('focusout', async (e) => {
  const box = e.target.closest('.note-edit');
  if (!box) return;
  const t = data.tasks.find((x) => x.id === +e.target.closest('.todo').dataset.id);
  if (t && t.note !== e.target.value) { await api('/tasks/' + t.id, { method: 'PATCH', body: { note: e.target.value } }); changed(); }
});

async function toggle(id) {
  const t = findTask(id);
  if (!t) return;
  t.done = t.done ? 0 : 1;
  render();
  const day = wk.days.find((d) => d.date === t.date);
  if (t.done && day.tasks.every((x) => x.done)) toast(view === 'week' ? `🎉 ${DAY_KO[D.dow(t.date)]}요일 할 일을 전부 끝냈어요!` : '🎉 오늘 할 일을 전부 끝냈어요! 참 잘했어요', 3000);
  try { await api('/tasks/' + id, { method: 'PATCH', body: { done: !!t.done } }); notifyChange(); }
  catch (e) { t.done = t.done ? 0 : 1; render(); toast(e.message); }
}
async function changed() { await load(); notifyChange(); }

$('#hideDone').onclick = () => { hideDone = !hideDone; renderTodos(); };

$('#addForm').onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target;
  const s = f.start.value, en = f.end.value;
  if ((s && !en) || (!s && en)) return toast('시작/끝 시간을 둘 다 입력하거나 비워 두세요');
  if (s && toMin(en) <= toMin(s)) return toast('끝 시간이 시작 시간보다 늦어야 해요');
  try {
    await api('/tasks', { method: 'POST', body: { date, title: f.title.value, exam_id: f.exam_id.value || null, start: s ? toMin(s) : null, end: en ? toMin(en) : null } });
    f.reset(); changed();
  } catch (err) { toast(err.message); }
};

$('#replan').onclick = async (e) => {
  e.target.disabled = true;
  try {
    const r = await api('/generate', { method: 'POST', body: { startDate: D.add(D.today(), 1), today: D.today() } });
    toast(`🔄 내일부터 ${fmtMin(r.studyMin)} 분량으로 다시 짰어요`, 3000);
    changed();
  } catch (err) { toast(err.message); }
  finally { e.target.disabled = false; }
};

// ───────── 달성률 ─────────
function renderProgress() {
  const n = data.tasks.length, d = data.tasks.filter((t) => t.done).length;
  const pct = n ? Math.round((d / n) * 100) : 0;
  $('#donut').style.setProperty('--p', pct);
  $('#pct').textContent = pct + '%';
  $('#pctSub').textContent = `${d}/${n} 완료`;
  const timed = data.tasks.filter((t) => t.start != null);
  $('#planMin').textContent = fmtMin(timed.reduce((a, t) => a + t.end - t.start, 0));
  $('#doneMin').textContent = fmtMin(timed.filter((t) => t.done).reduce((a, t) => a + t.end - t.start, 0));
  $('#focusMin').textContent = fmtMin(data.memo.focus_min || 0);
}

// ───────── 회고 ─────────
let mood = '';
function renderMemo() {
  if (document.activeElement !== $('#memo')) $('#memo').value = data.memo.text || '';
  mood = data.memo.mood || '';
  document.querySelectorAll('#moods button').forEach((b) => b.classList.toggle('on', b.dataset.v === mood));
}
let memoTimer;
async function saveMemo() {
  clearTimeout(memoTimer);
  await api('/memo/' + date, { method: 'PUT', body: { text: $('#memo').value, mood } });
  data.memo.text = $('#memo').value; data.memo.mood = mood;
  $('#memoState').textContent = '저장됨 ✓';
  notifyChange();
}
$('#memo').addEventListener('input', () => { $('#memoState').textContent = '입력 중…'; clearTimeout(memoTimer); memoTimer = setTimeout(saveMemo, 900); });
$('#moods').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  mood = mood === b.dataset.v ? '' : b.dataset.v;
  document.querySelectorAll('#moods button').forEach((x) => x.classList.toggle('on', x.dataset.v === mood));
  saveMemo();
});

// ───────── 집중 타이머 (뽀모도로) ─────────
const timer = { total: 25 * 60, left: 25 * 60, run: false, iv: null, isBreak: false };
function renderTimerTasks() {
  const sel = $('#timerTask'), cur = sel.value;
  if (view === 'week') { // 일주일 보기: 이번 주의 안 끝낸 할 일 (오늘 것부터)
    const today = D.today(), undone = allTasks().filter((t) => !t.done);
    const opt = (t) => `<option value="${t.id}">${DAY_KO[D.dow(t.date)]} · ${esc(taskName(t, ''))} · ${esc(t.title)}</option>`;
    sel.innerHTML = '<option value="">집중할 할 일 고르기</option>' + undone.filter((t) => t.date === today).map(opt).join('') + undone.filter((t) => t.date !== today).map(opt).join('');
    if (!undone.some((t) => t.id === focusId)) focusId = 0;
    sel.value = focusId || '';
    return;
  }
  sel.innerHTML = '<option value="">집중할 할 일 선택 (선택)</option>' +
    data.tasks.filter((t) => !t.done).map((t) => `<option value="${t.id}">${esc(taskName(t, ''))} · ${esc(t.title)}</option>`).join('');
  sel.value = cur;
}
// 집중 시간을 기록할 날짜: 하루 보기는 그 날짜(기존 동작), 일주일 보기는 오늘
const focusDate = () => (view === 'week' ? D.today() : date);
function setFocusTask(id) {
  focusId = id || 0;
  document.querySelectorAll('.wt').forEach((li) => li.classList.toggle('focus', +li.dataset.id === focusId));
  $('#timerTask').value = focusId || '';
}
$('#timerTask').addEventListener('change', (e) => { if (view === 'week') setFocusTask(+e.target.value); });
function drawTimer() {
  $('#tDisplay').textContent = `${D.pad(Math.floor(timer.left / 60))}:${D.pad(timer.left % 60)}`;
  $('#tBar').style.width = ((timer.total - timer.left) / timer.total) * 100 + '%';
  $('#tStart').textContent = timer.run ? '⏸ 일시정지' : '▶ 시작';
  document.querySelectorAll('#modes button').forEach((b) => b.classList.toggle('on', +b.dataset.m * 60 === timer.total));
}
// 공부 마라톤에 "공부 중/휴식" 상태 알리기 (친구 화면에서 내 캐릭터가 달리거나 쉼)
const presence = (st, min) => api('/presence', { method: 'POST', body: { state: st, minutes: min } }).catch(() => {});
// 지금까지 공부한 분 중 아직 기록 안 한 만큼 기록 (일시정지·초기화 때)
async function creditElapsed() {
  if (timer.isBreak) return;
  const m = Math.floor((timer.total - timer.left) / 60) - (timer.credited || 0);
  if (m < 1) return;
  timer.credited = (timer.credited || 0) + m;
  try {
    const fd = focusDate(), r = await api('/focus/' + fd, { method: 'POST', body: { minutes: m } });
    if (fd === date) { data.memo.focus_min = r.focus_min; renderProgress(); }
    notifyChange();
  } catch {}
}
function setMode(min) {
  if (timer.run) { presence('rest'); creditElapsed(); Noise.stop(); }
  clearInterval(timer.iv); timer.run = false;
  timer.total = timer.left = min * 60; timer.isBreak = min <= 10; timer.credited = 0;
  drawTimer();
}
$('#modes').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setMode(+b.dataset.m); });
$('#tReset').onclick = () => setMode(timer.total / 60);
$('#tStart').onclick = () => {
  if (timer.run) { clearInterval(timer.iv); timer.run = false; drawTimer(); presence('rest'); creditElapsed(); Noise.stop(); return; }
  timer.run = true;
  const endAt = Date.now() + timer.left * 1000;
  presence(timer.isBreak ? 'rest' : 'study', Math.ceil(timer.left / 60));
  if (!timer.isBreak) Noise.play(); // 집중 시간에만 백색소음
  timer.iv = setInterval(async () => {
    timer.left = Math.max(0, Math.round((endAt - Date.now()) / 1000));
    drawTimer();
    if (timer.left === 0) {
      clearInterval(timer.iv); timer.run = false; beep();
      presence('rest');
      Noise.stop();
      if (!timer.isBreak) {
        const rest = timer.total / 60 - (timer.credited || 0); // 일시정지 때 이미 기록한 만큼은 빼고
        if (rest > 0) {
          const fd = focusDate(), r = await api('/focus/' + fd, { method: 'POST', body: { minutes: rest } });
          if (fd === date) { data.memo.focus_min = r.focus_min; renderProgress(); }
        }
        const tid = +$('#timerTask').value;
        toast(tid ? '⏰ 집중 완료! 할 일을 끝냈다면 체크해 주세요' : '⏰ 집중 완료! 5분 쉬어가요', 3500);
        notifyChange();
        setMode(5);
      } else { toast('☕ 휴식 끝! 다시 집중해 볼까요?'); setMode(25); }
    }
  }, 250);
  drawTimer();
};
function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.35, 0.7].forEach((t) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = 880; o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.25, ctx.currentTime + t); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.3);
      o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.3);
    });
  } catch {}
}
window.addEventListener('beforeunload', (e) => { if (timer.run) { e.preventDefault(); e.returnValue = ''; } });
mountNoiseUI($('#noiseBox'), { isRunning: () => timer.run && !timer.isBreak });

// ───────── 테마 ─────────
$('#lookBtn').onclick = (e) => {
  e.stopPropagation();
  const pop = $('#lookPop');
  pop.hidden = !pop.hidden;
  $('#lookBtn').setAttribute('aria-expanded', String(!pop.hidden));
  if (!pop.hidden) renderLookPicker(pop);
};
document.addEventListener('click', (e) => { const path = e.composedPath(); if (!path.includes($('#lookPop')) && !path.includes($('#lookBtn'))) $('#lookPop').hidden = true; });

// ───────── 이동 & 동기화 ─────────
$('#jump').addEventListener('change', (e) => { if (e.target.value) location.href = href(e.target.value); });
onChange(() => load());
setInterval(() => { if (view === 'day' && date === D.today()) renderTimeline(); }, 60000);

// ───────── 일주일 보기 ─────────
// 학교·학원(시험) 일정 한 줄 요약 — 식사는 뺌
const fixedLine = (d) => d.fixed.filter((b) => b.kind !== 'meal').map((b) => `${b.label} ${toHM(b.start)}–${toHM(b.end)}`).join(' · ');
function renderWeek() {
  const today = D.today();
  const a = D.parse(wk.from), b = D.parse(wk.to);
  document.title = `${a.getMonth() + 1}월 ${a.getDate()}일 주 · 플래너`;
  $('#dateTitle').innerHTML = `${a.getMonth() + 1}월 ${a.getDate()}일 ~ ${a.getMonth() === b.getMonth() ? '' : `${b.getMonth() + 1}월 `}${b.getDate()}일<small>${a.getFullYear()}</small>`;
  $('#prevDay').textContent = '‹ 이전 주'; $('#todayBtn').textContent = '이번 주'; $('#nextDay').textContent = '다음 주 ›';
  $('#prevDay').href = href(D.add(wk.from, -7));
  $('#nextDay').href = href(D.add(wk.from, 7));
  $('#todayBtn').href = href(today);

  $('#wk').innerHTML = wk.days.map((d, i) => {
    const dow = D.dow(d.date), n = D.parse(d.date).getDate();
    const cls = ['wd', dow === 0 && 'sun', dow === 6 && 'sat', d.date === today && 'today', d.date < today && 'past'].filter(Boolean).join(' ');
    const stickers = data.exams.filter((e) => e.date === d.date)
      .map((e) => `<span class="sticker" style="--c:${e.color}">${esc(examName(e, data.exams))} ${dday(D.diff(today, e.date))}</span>`).join('');
    const fx = fixedLine(d);
    const done = d.tasks.filter((t) => t.done).length;
    const nextLabel = i === 6 ? '다음 주 일요일로 미루기' : '내일로 미루기';
    const items = d.tasks.map((t) => `<li class="wt ${t.done ? 'done' : ''} ${t.id === focusId ? 'focus' : ''}" data-id="${t.id}">
        <label class="check"><input type="checkbox" ${t.done ? 'checked' : ''} aria-label="완료"><span class="box"></span></label>
        <div class="wbody">
          <div class="wmeta"><span>${t.start != null ? `${toHM(t.start)}–${toHM(t.end)}` : '시간 자유'}</span>
            <span class="chip" style="--c:${taskColor(t)}">${esc(taskName(t, '기타'))}</span></div>
          <div class="wtitle">${esc(t.title)}</div>
        </div>
        <div class="wact">
          <button data-act="focus" title="이 할 일로 집중 타이머 맞추기">⏱</button>
          <button data-act="tomorrow" title="${nextLabel}">⏭</button>
        </div></li>`).join('');
    // 날짜를 누르면 하루 보기로 (전문가: 같은 창에서 이동 / 기본: 새 창)
    return `<section class="${cls}" data-date="${d.date}">
      <a class="wd-head" href="${href(d.date, 'day')}" ${Mode.basic ? 'target="_blank" rel="opener"' : ''} title="${D.pretty(d.date)} 하루 계획 보기">
        <span class="dn">${DAY_KO[dow]}</span><span class="num">${n}</span>${d.date === today ? '<span class="todaytag">오늘</span>' : ''}
        <span class="go">${Mode.basic ? '자세히 ↗' : '하루 계획 보기 ›'}</span></a>
      ${stickers}
      ${fx ? `<div class="fx" title="${esc(fx)}">${esc(fx)}</div>` : ''}
      <ul class="wtodos">${items || `<li class="wempty">${d.planUntil && d.date > d.planUntil ? '가까워지면 계획이 만들어져요' : '할 일이 없어요'}</li>`}</ul>
      ${d.tasks.length ? `<div class="wcount"><div class="bar"><i style="width:${Math.round((done / d.tasks.length) * 100)}%"></i></div>${done}/${d.tasks.length} 완료</div>` : ''}
    </section>`;
  }).join('');
  const stats = weekStats();
  $('#weekStats').innerHTML = `<h3 class="section-title"><span class="hl">과목별 이번 주</span></h3>` + (stats.length
    ? `<div class="ws-grid">${stats.map((s) => `<div class="ws-row"><div class="top"><span>${esc(s.name)}</span>
        <span class="muted">완료 ${fmtMin(s.done)} / 계획 ${fmtMin(s.plan)}</span></div>
        <div class="bar"><i style="width:${s.plan ? Math.round((s.done / s.plan) * 100) : 0}%;--c:${s.color}"></i></div></div>`).join('')}</div>`
    : '<p class="muted" style="font-size:13px">이번 주에 시간이 정해진 할 일이 없어요</p>');
  renderTimerTasks();
  renderWeekPrint(stats);
}
// 과목별 이번 주 계획 시간·완료 시간 (시간이 정해진 할 일 기준)
function weekStats() {
  const map = new Map();
  for (const t of allTasks()) {
    if (t.start == null) continue;
    const key = t.exam_id ? 'e' + t.exam_id : 's' + (t.subject || '기타');
    if (!map.has(key)) map.set(key, { name: taskName(t, '기타'), color: taskColor(t), plan: 0, done: 0 });
    const s = map.get(key), m = t.end - t.start;
    s.plan += m; if (t.done) s.done += m;
  }
  return [...map.values()].sort((a, b) => b.plan - a.plan);
}
$('#wk').addEventListener('change', (e) => { if (e.target.type === 'checkbox') toggle(+e.target.closest('.wt').dataset.id); });
$('#wk').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const id = +btn.closest('.wt').dataset.id, t = findTask(id);
  if (!t) return;
  if (btn.dataset.act === 'focus') {
    setFocusTask(id);
    $('.timer-card').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  } else if (btn.dataset.act === 'tomorrow') {
    const to = D.add(t.date, 1); // 토요일이면 다음 주 일요일
    try {
      await api('/tasks/' + id, { method: 'PATCH', body: { date: to } });
      toast(to > wk.to ? '다음 주 일요일 할 일로 옮겼어요' : `${DAY_KO[D.dow(to)]}요일 할 일로 옮겼어요`);
      await changed();
    } catch (err) { toast(err.message); }
  }
});

// 일주일 인쇄: A4 가로 한 장
function renderWeekPrint(stats) {
  const today = D.today();
  const a = D.parse(wk.from), b = D.parse(wk.to);
  $('#weekPrint').innerHTML = `
    <div class="pw-head">
      <div class="pw-date">${a.getFullYear()}년 ${a.getMonth() + 1}월 ${a.getDate()}일 ~ ${b.getMonth() + 1}월 ${b.getDate()}일</div>
      <div class="pw-dd">${data.exams.filter((e) => e.date >= today).slice(0, 8).map((e) => `<b>${esc(examName(e, data.exams))} ${dday(D.diff(today, e.date))}</b>`).join('')}</div>
    </div>
    <div class="pw-grid">${wk.days.map((d) => {
      const dd = D.parse(d.date), ex = data.exams.filter((e) => e.date === d.date).map((e) => `★ ${esc(e.subject)} 시험`).join(' ');
      const fx = fixedLine(d);
      return `<div class="pw-day"><div class="pw-dh">${DAY_KO[dd.getDay()]} ${dd.getMonth() + 1}/${dd.getDate()}<span>${ex}</span></div>
        ${fx ? `<div class="pw-fx">${esc(fx)}</div>` : ''}
        ${d.tasks.map((t) => `<div class="pw-t ${t.done ? 'done' : ''}"><span class="pw-box ${t.done ? 'on' : ''}"></span>
          <div><div class="pw-m"><b style="--c:${taskColor(t)}">${esc(taskName(t, '기타'))}</b> ${t.start != null ? `${toHM(t.start)}–${toHM(t.end)}` : ''}</div>
          <div class="pw-title">${esc(t.title)}</div></div></div>`).join('') || '<div class="pw-none">할 일 없음</div>'}</div>`;
    }).join('')}</div>
    ${!Mode.basic && stats.length ? `<div class="pw-sum">과목별 이번 주 (완료/계획): ${stats.map((s) => `<b>${esc(s.name)} ${fmtMin(s.done)}/${fmtMin(s.plan)}</b>`).join('')}</div>` : ''}`;
  fitPrint();
}
// 내용이 한 장(높이 186mm)을 넘으면 배율(--pz)을 줄임. 폭은 277mm/배율로 넓혀서 인쇄했을 때 가로를 꽉 채움
function fitPrint() {
  if (view !== 'week') return;
  const sheet = $('#weekPrint'), limit = $('#printRuler').offsetHeight;
  let z = 1;
  for (let i = 0; i < 20; i++) {
    sheet.style.setProperty('--pz', z.toFixed(3));
    if (sheet.offsetHeight * z <= limit || z <= 0.4) break;
    z *= 0.94;
  }
}
window.addEventListener('beforeprint', fitPrint);
if (document.fonts?.ready) document.fonts.ready.then(() => wk && fitPrint());
// 인쇄 용지 방향: 하루 = A4 세로(기존), 일주일 = A4 가로
function setPageSize(week) {
  let st = document.getElementById('pageSize');
  if (!st) { st = document.createElement('style'); st.id = 'pageSize'; document.head.appendChild(st); }
  st.textContent = week ? '@media print { @page { size: A4 landscape; margin: 10mm; } }' : '';
}

// ───────── 처음 사용 안내 (이 기기에서 플래너를 처음 열 때 한 번) ─────────
function weekTour() {
  runTour([
    { el: '#wk', title: '① 이번 주 할 일', text: '일요일부터 토요일까지 할 일이 한눈에 보여요. 끝낸 일은 <b>네모를 눌러 체크</b>하고, 못 한 일은 <b>⏭</b>로 내일로 미뤄요.' },
    { el: '.timer-card', title: '② 집중 타이머', text: '할 일 옆의 <b>⏱</b>를 누르고 <b>▶ 시작</b>하면 25분 집중 타이머가 돌아가요. 끝나면 알림이 울려요.' },
    { el: '#nextDay', title: '③ 다른 주 · 인쇄', text: '이전 주·다음 주로 넘기고, <b>🖨 인쇄</b>로 한 주를 종이 한 장에 뽑을 수 있어요. 하루를 자세히 보려면 <b>날짜</b>를 눌러요.' },
  ], { doneLabel: '알겠어요' });
}
function plannerTour() {
  if (view === 'week') return weekTour();
  if (Mode.basic) {
    return runTour([
      { el: '#todos', title: '오늘 할 일 체크', text: '끝낸 일은 네모를 눌러 체크해요. ⏭를 누르면 내일로 미룰 수 있어요.' },
      { el: '#timeline', title: '타임테이블', text: '학교·학원·식사 사이 빈 시간에 공부가 배치돼요. 빨간 선이 지금 시각이에요.' },
      { el: '.timer-card', title: '집중 타이머', text: '25분·50분 집중하고 나면 알림이 울려요.' },
    ], { doneLabel: '알겠어요' });
  }
  runTour([
    { el: '#todos', title: '오늘 할 일 체크', text: '끝낸 일은 네모를 눌러 체크해요. 📝로 메모(예: p.45까지 함), ⏭로 내일로 미루기, ✕로 삭제할 수 있어요.' },
    { el: '#timeline', title: '타임테이블', text: '학교·학원·식사 사이 빈 시간에 공부가 배치돼요. 빨간 선이 지금 시각이에요. 블록을 눌러도 체크돼요.' },
    { el: '.timer-card', title: '집중 타이머', text: '25분·50분 집중 후 알림이 울려요. 집중한 시간은 기록돼서 달력 화면 통계에 쌓여요.' },
    { el: '#replan', title: '밀렸을 때', text: '못 끝낸 진도는 이 버튼으로 <b>내일부터 남은 기간에 다시 분배</b>할 수 있어요.' },
    { el: '#lookBtn', title: '테마 · 인쇄', text: '🎨 테마로 색과 글꼴을 바꾸고, 🖨 인쇄를 누르면 <b>할 일 체크표만 한 장</b>으로 깔끔하게 출력돼요.' },
  ], { doneLabel: '알겠어요' });
}
$('#plHelp').onclick = plannerTour;

load().then(async () => {
  drawTimer();
  if (await Plan.ensure()) await load();
  // 처음 열 때 한 번: 기본 모드의 일주일 보기 안내 / 하루 보기 안내
  const key = view === 'week' ? 'sp_tour_week' : 'sp_tour_planner';
  if ((view === 'day' || Mode.basic) && !localStorage.getItem(key)) { localStorage.setItem(key, '1'); plannerTour(); }
}).catch((e) => toast(e.message));
