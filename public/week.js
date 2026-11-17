// 주간 플래너 (기본 모드 전용): 만들어진 하루 계획을 월~일 7일씩 묶어 보여 줌
//  - 체크 / 내일로 미루기 (일요일 할 일은 다음 주 월요일로) / 집중 타이머 / A4 가로 한 장 인쇄
//  - 계획 생성 알고리즘은 건드리지 않음 (GET /api/week 로 7일 치를 한 번에 읽기만 함)
const $ = (s) => document.querySelector(s);
if (!Auth.token) goLogin();

let start = new URLSearchParams(location.search).get('start');
if (!/^\d{4}-\d{2}-\d{2}$/.test(start || '')) start = D.today();
start = D.weekStart(start); // 주의 시작은 월요일
let wk = null;      // { from, to, days: [/api/day와 같은 형태 × 7] }
let focusId = 0;    // 타이머로 집중 중인 할 일

const allTasks = () => wk.days.flatMap((d) => d.tasks);
const exams = () => wk.days[0].exams;
const findTask = (id) => allTasks().find((t) => t.id === id);
function taskName(t, fallback) {
  const e = t.exam_id && exams().find((x) => x.id === t.exam_id);
  return e ? examName(e, exams()) : t.subject || fallback;
}
const taskColor = (t) => t.color || (t.kind === 'review' ? '#b48ead' : '#9a8c98');
// 학교·학원(시험) 일정 한 줄 요약 — 식사는 뺌
const fixedLine = (d) => d.fixed.filter((b) => b.kind !== 'meal').map((b) => `${b.label} ${toHM(b.start)}–${toHM(b.end)}`).join(' · ');

async function load() {
  wk = await api('/week?from=' + start);
  Mode.fromSettings(wk.days[0].settings);
  // 주간 플래너는 기본 모드 전용 → 전문가 모드면 하루 플래너로
  if (!Mode.basic) { const t = D.today(); location.replace(`planner.html?date=${t >= wk.from && t <= wk.to ? t : wk.from}`); return; }
  render();
}

function render() {
  const today = D.today();
  const a = D.parse(wk.from), b = D.parse(wk.to);
  document.title = `${a.getMonth() + 1}월 ${a.getDate()}일 주 · 주간 플래너`;
  $('#weekTitle').innerHTML = `${a.getMonth() + 1}월 ${a.getDate()}일 ~ ${a.getMonth() === b.getMonth() ? '' : `${b.getMonth() + 1}월 `}${b.getDate()}일<small>${a.getFullYear()}</small>`;
  $('#prevWeek').href = `week.html?start=${D.add(wk.from, -7)}`;
  $('#nextWeek').href = `week.html?start=${D.add(wk.from, 7)}`;
  $('#thisWeek').href = `week.html?start=${D.weekStart(today)}`;
  $('#ddays').innerHTML = exams().filter((e) => e.date >= today)
    .map((e) => `<span class="chip" style="--c:${e.color}">${esc(examName(e, exams()))} ${dday(D.diff(today, e.date))}</span>`)
    .join('') || '<span class="muted" style="font-size:13px">남은 시험이 없어요 🎉</span>';

  $('#wk').innerHTML = wk.days.map((d) => {
    const dow = D.dow(d.date), n = D.parse(d.date).getDate();
    const cls = ['wd', dow === 0 && 'sun', dow === 6 && 'sat', d.date === today && 'today', d.date < today && 'past'].filter(Boolean).join(' ');
    const stickers = exams().filter((e) => e.date === d.date)
      .map((e) => `<span class="sticker" style="--c:${e.color}">${esc(examName(e, exams()))} ${dday(D.diff(today, e.date))}</span>`).join('');
    const fx = fixedLine(d);
    const done = d.tasks.filter((t) => t.done).length;
    const nextLabel = dow === 0 ? '다음 주 월요일로 미루기' : '내일로 미루기';
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
    return `<section class="${cls}" data-date="${d.date}">
      <div class="wd-head"><span class="dn">${DAY_KO[dow]}</span><span class="num">${n}</span>${d.date === today ? '<span class="todaytag">오늘</span>' : ''}
        <a href="planner.html?date=${d.date}" target="_blank" rel="opener" title="${D.pretty(d.date)} 하루 플래너 열기">자세히 ↗</a></div>
      ${stickers}
      ${fx ? `<div class="fx" title="${esc(fx)}">${esc(fx)}</div>` : ''}
      <ul class="wtodos">${items || `<li class="wempty">${wk.days[0].planUntil && d.date > wk.days[0].planUntil ? '가까워지면 계획이 만들어져요' : '할 일이 없어요'}</li>`}</ul>
      ${d.tasks.length ? `<div class="wcount"><div class="bar"><i style="width:${Math.round((done / d.tasks.length) * 100)}%"></i></div>${done}/${d.tasks.length} 완료</div>` : ''}
    </section>`;
  }).join('');
  renderTimerTasks();
  renderPrint();
}

// ───────── 체크 · 내일로 미루기 ─────────
$('#wk').addEventListener('change', (e) => {
  if (e.target.type === 'checkbox') toggle(+e.target.closest('.wt').dataset.id);
});
$('#wk').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const id = +btn.closest('.wt').dataset.id, t = findTask(id);
  if (!t) return;
  if (btn.dataset.act === 'focus') {
    setFocus(id);
    $('#timerCard').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  } else if (btn.dataset.act === 'tomorrow') {
    const to = D.add(t.date, 1); // 일요일이면 다음 주 월요일
    try {
      await api('/tasks/' + id, { method: 'PATCH', body: { date: to } });
      toast(to > wk.to ? '다음 주 월요일 할 일로 옮겼어요' : `${DAY_KO[D.dow(to)]}요일 할 일로 옮겼어요`);
      await changed();
    } catch (err) { toast(err.message); }
  }
});
async function toggle(id) {
  const t = findTask(id);
  if (!t) return;
  t.done = t.done ? 0 : 1;
  render();
  const day = wk.days.find((d) => d.date === t.date);
  if (t.done && day.tasks.every((x) => x.done)) toast(`🎉 ${DAY_KO[D.dow(t.date)]}요일 할 일을 전부 끝냈어요!`, 2800);
  try { await api('/tasks/' + id, { method: 'PATCH', body: { done: !!t.done } }); notifyChange(); } // 열려 있는 달력 창에 바로 반영
  catch (e) { t.done = t.done ? 0 : 1; render(); toast(e.message); }
}
async function changed() { await load(); notifyChange(); }

// ───────── 집중 타이머 (하나) — 고른 할 일에 집중, 시간은 오늘 집중 시간(/api/focus)으로 기록 ─────────
const timer = { total: 25 * 60, left: 25 * 60, run: false, iv: null, isBreak: false, credited: 0 };
function renderTimerTasks() {
  const sel = $('#timerTask'), today = D.today();
  const opt = (t) => `<option value="${t.id}">${DAY_KO[D.dow(t.date)]} · ${esc(taskName(t, ''))} · ${esc(t.title)}</option>`;
  const undone = allTasks().filter((t) => !t.done);
  const todays = undone.filter((t) => t.date === today), others = undone.filter((t) => t.date !== today);
  sel.innerHTML = '<option value="">집중할 할 일 고르기</option>' + todays.map(opt).join('') + others.map(opt).join('');
  if (!undone.some((t) => t.id === focusId)) focusId = 0;
  sel.value = focusId || '';
}
function setFocus(id) {
  focusId = id || 0;
  document.querySelectorAll('.wt').forEach((li) => li.classList.toggle('focus', +li.dataset.id === focusId));
  $('#timerTask').value = focusId || '';
}
$('#timerTask').addEventListener('change', (e) => setFocus(+e.target.value));
function drawTimer() {
  $('#tDisplay').textContent = `${D.pad(Math.floor(timer.left / 60))}:${D.pad(timer.left % 60)}`;
  $('#tBar').style.width = ((timer.total - timer.left) / timer.total) * 100 + '%';
  $('#tStart').textContent = timer.run ? '⏸ 일시정지' : '▶ 시작';
  document.querySelectorAll('#modes button').forEach((b) => b.classList.toggle('on', +b.dataset.m * 60 === timer.total));
}
// 공부 마라톤에 "공부 중/휴식" 상태 알리기
const presence = (st, min) => api('/presence', { method: 'POST', body: { state: st, minutes: min } }).catch(() => {});
const record = (m) => api('/focus/' + D.today(), { method: 'POST', body: { minutes: m } });
// 지금까지 공부한 분 중 아직 기록 안 한 만큼 기록 (일시정지·초기화 때) — 완료 때 나머지만 기록해 중복 없음
async function creditElapsed() {
  if (timer.isBreak) return;
  const m = Math.floor((timer.total - timer.left) / 60) - timer.credited;
  if (m < 1) return;
  timer.credited += m;
  try { await record(m); notifyChange(); } catch {}
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
  if (!timer.isBreak) Noise.play();
  timer.iv = setInterval(async () => {
    timer.left = Math.max(0, Math.round((endAt - Date.now()) / 1000));
    drawTimer();
    if (timer.left !== 0) return;
    clearInterval(timer.iv); timer.run = false; beep();
    presence('rest');
    Noise.stop();
    if (timer.isBreak) { toast('☕ 휴식 끝! 다시 집중해 볼까요?'); return setMode(25); }
    const rest = timer.total / 60 - timer.credited;
    if (rest > 0) { try { await record(rest); } catch {} }
    const t = findTask(focusId);
    toast(t ? `⏰ 집중 완료! 「${t.title.slice(0, 18)}」을 끝냈다면 체크해 주세요` : '⏰ 집중 완료! 5분 쉬어가요', 4000);
    notifyChange();
    setMode(5);
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
bindNoiseUI({ select: $('#noiseType'), vol: $('#noiseVol'), test: $('#noiseTest'), isRunning: () => timer.run && !timer.isBreak });

// ───────── 인쇄: A4 가로 한 장 ─────────
function renderPrint() {
  const today = D.today();
  const a = D.parse(wk.from), b = D.parse(wk.to);
  $('#printSheet').innerHTML = `
    <div class="pw-head">
      <div class="pw-date">${a.getFullYear()}년 ${a.getMonth() + 1}월 ${a.getDate()}일 ~ ${b.getMonth() + 1}월 ${b.getDate()}일</div>
      <div class="pw-dd">${exams().filter((e) => e.date >= today).slice(0, 8).map((e) => `<b>${esc(examName(e, exams()))} ${dday(D.diff(today, e.date))}</b>`).join('')}</div>
    </div>
    <div class="pw-grid">${wk.days.map((d) => {
      const dd = D.parse(d.date), ex = exams().filter((e) => e.date === d.date).map((e) => `★ ${esc(e.subject)} 시험`).join(' ');
      const fx = fixedLine(d);
      return `<div class="pw-day"><div class="pw-dh">${DAY_KO[dd.getDay()]} ${dd.getMonth() + 1}/${dd.getDate()}<span>${ex}</span></div>
        ${fx ? `<div class="pw-fx">${esc(fx)}</div>` : ''}
        ${d.tasks.map((t) => `<div class="pw-t ${t.done ? 'done' : ''}"><span class="pw-box ${t.done ? 'on' : ''}"></span>
          <div><div class="pw-m"><b style="--c:${taskColor(t)}">${esc(taskName(t, '기타'))}</b> ${t.start != null ? `${toHM(t.start)}–${toHM(t.end)}` : ''}</div>
          <div class="pw-title">${esc(t.title)}</div></div></div>`).join('') || '<div class="pw-none">할 일 없음</div>'}</div>`;
    }).join('')}</div>`;
  fitPrint();
}
// 내용이 한 장(높이 186mm)을 넘으면 배율(--pz)을 줄임. 폭은 277mm/배율로 넓혀서 인쇄했을 때 가로를 꽉 채움
function fitPrint() {
  const sheet = $('#printSheet'), limit = $('#printRuler').offsetHeight;
  let z = 1;
  for (let i = 0; i < 20; i++) {
    sheet.style.setProperty('--pz', z.toFixed(3));
    if (sheet.offsetHeight * z <= limit || z <= 0.4) break;
    z *= 0.94;
  }
}
window.addEventListener('beforeprint', fitPrint);
if (document.fonts?.ready) document.fonts.ready.then(() => wk && fitPrint());

// ───────── 동기화 · 안내 ─────────
onChange(() => load());
document.addEventListener('visibilitychange', () => { if (!document.hidden && Auth.token) load().catch(() => {}); });

function weekTour() {
  runTour([
    { el: '#wk', title: '① 이번 주 할 일', text: '월요일부터 일요일까지 할 일이 한눈에 보여요. 끝낸 일은 <b>네모를 눌러 체크</b>하고, 못 한 일은 <b>⏭</b>로 내일로 미뤄요.' },
    { el: '#timerCard', title: '② 집중 타이머', text: '할 일 옆의 <b>⏱</b>를 누르고 <b>▶ 시작</b>하면 25분 집중 타이머가 돌아가요. 끝나면 알림이 울려요.' },
    { el: '#nextWeek', title: '③ 다른 주 · 인쇄', text: '이전 주·다음 주로 넘기고, <b>🖨 인쇄</b>로 한 주를 종이 한 장에 뽑을 수 있어요. 하루를 자세히 보려면 날짜 옆 <b>자세히 ↗</b>를 눌러요.' },
  ], { doneLabel: '알겠어요' });
}
$('#wkHelp').onclick = weekTour;

load().then(async () => {
  if (!wk || !Mode.basic) return;
  drawTimer();
  if (await Plan.ensure()) await load();
  if (!localStorage.getItem('sp_tour_week')) { localStorage.setItem('sp_tour_week', '1'); weekTour(); }
}).catch((e) => toast(e.message));
