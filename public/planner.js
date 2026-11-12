// 하루 플래너: 타임테이블, 체크리스트, 타이머, 회고
const $ = (s) => document.querySelector(s);
if (!Auth.token) goLogin();

let date = new URLSearchParams(location.search).get('date');
if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) date = D.today();
let data = null;
let hideDone = false;

const QUOTES = [
  '오늘 걸은 한 걸음이 시험장에서의 자신감이 된다.',
  '완벽하게 말고, 끝까지.',
  '어제보다 한 문제 더.',
  '지금 하기 싫은 그 과목부터!',
  '쉬는 것도 계획의 일부예요. 잘 쉬고 다시 집중!',
  '틀린 문제는 보물. 오답노트에 꼭 적기 ✍️',
  '작은 체크 하나가 모여 큰 점수가 된다.',
];

async function load() {
  data = await api('/day/' + date);
  render();
}

function render() {
  const today = D.today();
  document.title = `${D.pretty(date)} 플래너`;
  $('#dateTitle').innerHTML = `${D.pretty(date)}<small>${date.slice(0, 4)}</small>`;
  $('#prevDay').href = `planner.html?date=${D.add(date, -1)}`;
  $('#nextDay').href = `planner.html?date=${D.add(date, 1)}`;
  $('#todayBtn').href = `planner.html?date=${today}`;
  $('#jump').value = date;
  $('#quote').textContent = '“ ' + QUOTES[D.parse(date).getDate() % QUOTES.length] + ' ”';

  $('#ddays').innerHTML = data.exams
    .filter((e) => e.date >= date)
    .map((e) => `<span class="chip" style="--c:${e.color}">${esc(e.subject)} ${dday(D.diff(date, e.date))}</span>`)
    .join('') || '<span class="muted" style="font-size:13px">남은 시험이 없어요 🎉</span>';

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
      <div class="ps-dd">${upcoming.slice(0, 6).map((e) => `<b>${esc(e.subject)} ${dday(D.diff(date, e.date))}</b>`).join('')}</div>
    </div>
    <div class="ps-meta">할 일 ${data.tasks.length}개 · 계획 공부 ${fmtMin(planMin)}${fixed ? ` · 고정 일정: ${esc(fixed)}` : ''}</div>
    ${data.tasks.length ? `<table class="ps">
      <thead><tr><th style="width:22px"></th><th>시간</th><th>과목</th><th>할 일</th></tr></thead>
      <tbody>${data.tasks.map((t) => `<tr class="${t.done ? 'ps-done' : ''}">
        <td><span class="ps-box ${t.done ? 'on' : ''}"></span></td>
        <td class="ps-time">${t.start != null ? `${toHM(t.start)}–${toHM(t.end)}` : '자유'}</td>
        <td class="ps-sub" style="--c:${t.color || (t.kind === 'review' ? '#b48ead' : '#9a8c98')}">${esc(t.subject || '기타')}</td>
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
      <b>${toHM(t.start)}</b>${esc(t.subject || '')} · ${esc(t.title)}</div>`;
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
          <span class="chip" style="--c:${c}">${esc(t.subject || '기타')}</span>
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
    ${data.tasks.length ? '' : '<p style="font-size:13px">달력 화면에서 「공부 계획 자동 생성」을 누르거나, 아래에서 직접 추가해 보세요.</p>'}</li>`;

  $('#addForm').exam_id.innerHTML = `<option value="">기타</option>` +
    data.exams.filter((e) => e.date >= date).map((e) => `<option value="${e.id}">${esc(e.subject)}</option>`).join('');
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
  const t = data.tasks.find((x) => x.id === id);
  if (!t) return;
  t.done = t.done ? 0 : 1;
  render();
  if (t.done && data.tasks.every((x) => x.done)) toast('🎉 오늘 할 일을 전부 끝냈어요! 참 잘했어요', 3000);
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
    const r = await api('/generate', { method: 'POST', body: { startDate: D.add(D.today(), 1) } });
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
  sel.innerHTML = '<option value="">집중할 할 일 선택 (선택)</option>' +
    data.tasks.filter((t) => !t.done).map((t) => `<option value="${t.id}">${esc(t.subject || '')} · ${esc(t.title)}</option>`).join('');
  sel.value = cur;
}
function drawTimer() {
  $('#tDisplay').textContent = `${D.pad(Math.floor(timer.left / 60))}:${D.pad(timer.left % 60)}`;
  $('#tBar').style.width = ((timer.total - timer.left) / timer.total) * 100 + '%';
  $('#tStart').textContent = timer.run ? '⏸ 일시정지' : '▶ 시작';
  document.querySelectorAll('#modes button').forEach((b) => b.classList.toggle('on', +b.dataset.m * 60 === timer.total));
}
function setMode(min) {
  clearInterval(timer.iv); timer.run = false;
  timer.total = timer.left = min * 60; timer.isBreak = min <= 10;
  drawTimer();
}
$('#modes').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setMode(+b.dataset.m); });
$('#tReset').onclick = () => setMode(timer.total / 60);
$('#tStart').onclick = () => {
  if (timer.run) { clearInterval(timer.iv); timer.run = false; drawTimer(); return; }
  timer.run = true;
  const endAt = Date.now() + timer.left * 1000;
  timer.iv = setInterval(async () => {
    timer.left = Math.max(0, Math.round((endAt - Date.now()) / 1000));
    drawTimer();
    if (timer.left === 0) {
      clearInterval(timer.iv); timer.run = false; beep();
      if (!timer.isBreak) {
        const r = await api('/focus/' + date, { method: 'POST', body: { minutes: timer.total / 60 } });
        data.memo.focus_min = r.focus_min; renderProgress();
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
$('#jump').addEventListener('change', (e) => { if (e.target.value) location.href = `planner.html?date=${e.target.value}`; });
onChange(() => load());
setInterval(() => { if (date === D.today()) renderTimeline(); }, 60000);

// ───────── 처음 사용 안내 (이 기기에서 플래너를 처음 열 때 한 번) ─────────
function plannerTour() {
  runTour([
    { el: '#todos', title: '오늘 할 일 체크', text: '끝낸 일은 네모를 눌러 체크해요. 📝로 메모(예: p.45까지 함), ⏭로 내일로 미루기, ✕로 삭제할 수 있어요.' },
    { el: '#timeline', title: '타임테이블', text: '학교·학원·식사 사이 빈 시간에 공부가 배치돼요. 빨간 선이 지금 시각이에요. 블록을 눌러도 체크돼요.' },
    { el: '.timer-card', title: '집중 타이머', text: '25분·50분 집중 후 알림이 울려요. 집중한 시간은 기록돼서 달력 화면 통계에 쌓여요.' },
    { el: '#replan', title: '밀렸을 때', text: '못 끝낸 진도는 이 버튼으로 <b>내일부터 남은 기간에 다시 분배</b>할 수 있어요.' },
    { el: '#lookBtn', title: '테마 · 인쇄', text: '🎨 테마로 색과 글꼴을 바꾸고, 🖨 인쇄를 누르면 <b>할 일 체크표만 한 장</b>으로 깔끔하게 출력돼요.' },
  ], { doneLabel: '알겠어요' });
}
$('#plHelp').onclick = plannerTour;

load().then(() => {
  drawTimer();
  if (!localStorage.getItem('sp_tour_planner')) { localStorage.setItem('sp_tour_planner', '1'); plannerTour(); }
}).catch((e) => toast(e.message));
