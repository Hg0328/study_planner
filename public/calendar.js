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
    if (next && SAFE_NEXT.test(next)) { location.href = next; return; }
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
    const stickers = (byDate[ds] || []).map((e) => `<span class="sticker" style="--c:${e.color}">${esc(examName(e, exams))}</span>`).join('');
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
      <div class="hand" style="font-size:calc(30px * var(--hand-scale))">아직 등록된 시험이 없어요</div>
      <p>시험 과목과 날짜, ${esc(fixedName())}·학원 시간을 입력하면 공부 계획을 자동으로 만들어 드려요.</p>
      <button class="btn primary" onclick="openSettings()">📝 시험 등록하러 가기</button></div>`;
}

// ───────── 사이드바 ─────────
// 큰 예상 시간은 시간 단위로 반올림 (예: 438시간 50분 → 약 439시간)
const fmtHours = (m) => (m >= 600 ? `약 ${Math.round(m / 60)}시간` : fmtMin(m));
async function renderSide() {
  const today = D.today();
  const upcoming = exams.filter((e) => e.date >= today);
  const next = upcoming[0];
  $('#bigDday').innerHTML = next
    ? `<div class="s">가장 가까운 시험</div>
       <div class="n">${dday(D.diff(today, next.date))}</div>
       <div><span class="chip" style="--c:${next.color}">${esc(examName(next, exams))}</span>
       <span class="muted" style="font-size:13px">${D.pretty(next.date)}</span></div>`
    : `<div class="s">다가오는 시험</div><div class="hand" style="font-size:calc(26px * var(--hand-scale))">시험을 등록해 주세요</div>`;

  $('#dlist').innerHTML = exams.map((e) => {
    const n = D.diff(today, e.date);
    return `<li><a href="planner.html?date=${e.date}" target="_blank" rel="opener" class="${n < 0 ? 'past' : ''}">
      <span class="dot" style="--c:${e.color}"></span>${esc(examName(e, exams))}
      <span class="muted" style="font-size:12px">${D.pretty(e.date)}</span>
      <span class="dd">${dday(n)}</span></a></li>`;
  }).join('') || '<li class="muted" style="font-size:13px">등록된 시험이 없어요</li>';

  const st = await api('/stats?today=' + today);
  $('#progList').innerHTML = renderProgress(st.subjects, today);
  $('#stPct').textContent = (st.total ? Math.round((st.done / st.total) * 100) : 0) + '%';
  $('#stStreak').textContent = st.streak + '일';
  $('#stFocus').textContent = fmtMin(st.focusMin);
}

// 시험별 진행률: 한 줄 = 시험(과목+종류). 종류가 2개 이상이면 종류별로 묶고 소제목 아래에 과목명만
//  묶음 안은 시험 날짜가 가까운 순(지난 시험은 맨 뒤), 묶음 순서도 가장 가까운 시험 기준
function renderProgress(list, today) {
  if (!list.length) return '<p class="muted" style="font-size:13px">계획을 만들면 여기서 진행률을 볼 수 있어요</p>';
  // 다가오는 시험 먼저(가까운 순), 지난 시험은 뒤에(최근 순)
  const near = (a, b) => {
    const ua = a.date >= today, ub = b.date >= today;
    if (ua !== ub) return ua ? -1 : 1;
    return ua ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date);
  };
  const row = (s, name) => {
    // 분모 = 생성 때 시험일까지 계산한 예상 전체 공부 시간 (예전 계획이면 저장된 계획 시간)
    const exp = s.expected_min || s.planMin;
    const pct = exp ? Math.min(100, Math.round((s.doneMin / exp) * 100)) : 0;
    return `<div class="prog ${s.date < today ? 'past' : ''}"><div class="row"><span>${esc(name)}</span>
      <span class="muted"><small class="prog-dd">${dday(D.diff(today, s.date))}</small> ${pct}%</span></div>
      <div class="bar"><i style="width:${pct}%;--c:${s.color}"></i></div>
      <div class="muted prog-sub">완료 ${fmtMin(s.doneMin)} / 예상 전체 ${fmtHours(exp)}</div></div>`;
  };
  const sorted = [...list].sort(near);
  if (!Presets.showKinds(list)) return sorted.map((s) => row(s, s.subject)).join('');
  const groups = new Map(); // 가까운 시험이 있는 종류부터
  for (const s of sorted) { const k = s.kind || 'naesin'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(s); }
  return [...groups].map(([k, items]) => `<div class="prog-group"><div class="prog-kind">${esc(Presets.kindGroupLabel(k))}</div>
    ${items.map((s) => row(s, s.subject)).join('')}</div>`).join('');
}

async function refresh() {
  await renderCalendar();
  await renderSide();
}

$('#prevM').onclick = () => { view.m--; if (view.m < 0) { view.m = 11; view.y--; } renderCalendar(); };
$('#nextM').onclick = () => { view.m++; if (view.m > 11) { view.m = 0; view.y++; } renderCalendar(); };
$('#thisM').onclick = () => { const d = new Date(); view = { y: d.getFullYear(), m: d.getMonth() }; renderCalendar(); };

// 설정 창을 닫을 때 바뀐 내용이 있으면 자동으로 계획을 다시 짬
async function generate() {
  try {
    const r = await api('/generate', { method: 'POST', body: { startDate: D.today(), today: D.today() } });
    toast(`✨ ${D.pretty(r.from)} ~ ${D.pretty(r.to)} · 총 ${fmtMin(r.studyMin)} 계획 완성!${r.lastExam > r.to ? ' (다음 기간은 자동으로 이어서 만들어요)' : ''}`, 3600);
    await refresh();
    notifyChange();
  } catch (e) { toast(e.message); }
}

// ───────── 설정 모달 ─────────
$$('#tabs button').forEach((b) => (b.onclick = () => {
  $$('#tabs button').forEach((x) => x.classList.toggle('on', x === b));
  $$('.tab-pane').forEach((p) => p.classList.toggle('on', p.dataset.pane === b.dataset.tab));
  if (b.dataset.tab === 'look') renderLookPicker($('#lookPicker'));
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
  $('#minLongShare').value = s.minLongShare;
  renderLifePick();
  applyLifeLabels();
  renderAcademies();
}

// ───────── 생활 유형 · 시험 종류 ─────────
const lifeOf = () => Presets.LIFE_TYPES[settings?.lifeType] || Presets.LIFE_TYPES.student;
const fixedName = () => lifeOf().fixedLabel;
// 생활 유형에 따라 "학교" ↔ "강의" ↔ "고정 일정" ↔ "근무" 문구 바꾸기 (중·고등학생은 기존 문구 그대로)
function applyLifeLabels() {
  const lt = lifeOf(), L = lt.fixedLabel, student = settings?.lifeType === 'student' || !settings?.lifeType;
  $('#tabSchool').textContent = `${lt.icon} ${L} 시간`;
  $('#schoolOnTh').textContent = student ? '등교' : L;
  $('#examDayTitle').textContent = lt.examDayLabel;
  $('#lunchLabel').textContent = `점심 시작 (${L} 없는 날)`;
  $('#bufferLabel').textContent = `${L}·학원 전후 이동 (분)`;
  $('#maxWeekdayLabel').textContent = student ? '학교 가는 날 최대 공부 (시간)' : `${L} 있는 날 최대 공부 (시간)`;
}
function renderLifePick() {
  const s = settings;
  $('#lifePick').innerHTML = Presets.LIFE_IDS.map((id) => { const t = Presets.LIFE_TYPES[id];
    return `<label><input type="radio" name="lifeType" value="${id}" ${s.lifeType === id ? 'checked' : ''}><span>${t.icon} ${t.label}</span></label>`; }).join('');
  $('#kindPick').innerHTML = Presets.KIND_IDS.map((id) =>
    `<label><input type="checkbox" value="${id}" ${s.examKinds.includes(id) ? 'checked' : ''}><span>${Presets.EXAM_KINDS[id].label}</span></label>`).join('');
}
// 생활 유형의 기본 시간표 넣기 (학교/강의/근무 요일·시간, 시험 당일, 이동 시간, 하루 최대 공부)
function applyLifeDefaults(s, id) {
  const d = Presets.LIFE_TYPES[id]?.defaults;
  if (!d) return s;
  return { ...s, school: d.school.map((x) => ({ ...x })), examDay: { ...d.examDay }, bufferMin: d.bufferMin, maxWeekdayMin: d.maxWeekdayMin, maxWeekendMin: d.maxWeekendMin };
}
$('#lifePick').addEventListener('change', (e) => {
  const id = e.target.value;
  readSettings();
  settings.lifeType = id;
  const t = Presets.LIFE_TYPES[id];
  if (t.defaults && confirm(`기본 시간표를 '${t.label}' 유형으로 바꿀까요?\n(${t.fixedLabel} 시간·시험 당일 시간·이동 시간·하루 최대 공부가 바뀌어요. 취소하면 지금 시간표를 그대로 둬요)`)) {
    settings = applyLifeDefaults(settings, id);
  }
  fillSettings();
  renderKindSelect();
  dirty = true;
});
$('#kindPick').addEventListener('change', () => {
  settings.examKinds = $$('#kindPick input:checked').map((c) => c.value);
  if (!settings.examKinds.length) { settings.examKinds = ['naesin']; renderLifePick(); }
  renderKindSelect();
});

// 시험 추가 칸: 종류 선택지(내가 준비하는 종류가 앞에) · 추천 과목 · 범위 문구 · 직접 설정 단계
function renderKindSelect(selected) {
  const mine = settings.examKinds || ['naesin'];
  const ids = [...mine, ...Presets.KIND_IDS.filter((k) => !mine.includes(k))];
  const cur = selected || $('#examKind').value || mine[0];
  $('#examKind').innerHTML = ids.map((id, i) => `${i === mine.length && i ? '<option disabled>──────</option>' : ''}<option value="${id}">${Presets.EXAM_KINDS[id].label}</option>`).join('');
  $('#examKind').value = ids.includes(cur) ? cur : mine[0];
  onKindChange();
}
function onKindChange() {
  const k = Presets.EXAM_KINDS[$('#examKind').value] || Presets.EXAM_KINDS.naesin;
  $('#suggest').innerHTML = k.suggest.map((x) => `<button type="button" data-sug="${esc(x)}">${esc(x)}</button>`).join('') || '<span class="muted" style="font-size:12px">직접 입력해 주세요</span>';
  $('#scopeLabel').textContent = `시험 범위 — ${k.unit}를 쉼표(,)로 구분하면 ${k.unit}별로 나눠서 계획해요`;
  $('#examForm').scope.placeholder = `예) ${k.unitEx}`;
  $('#stagesRow').hidden = $('#examKind').value !== 'custom';
}
$('#examKind').addEventListener('change', onKindChange);
$('#suggest').addEventListener('click', (e) => { const v = e.target.dataset.sug; if (v) { $('#examForm').subject.value = v; $('#examForm').subject.focus(); } });
const stagesText = (json) => { try { return JSON.parse(json || '[]').map((x) => `${x.name}:${x.ratio}`).join(', '); } catch { return ''; } };
const parseStages = (text) => String(text || '').split(/[,，]/).map((x) => x.split(/[:：]/)).filter((x) => x[0]?.trim())
  .map(([name, ratio]) => ({ name: name.trim(), ratio: Number(ratio) }));

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
  s.minLongShare = +$('#minLongShare').value;
  s.lifeType = $('#lifePick input:checked')?.value || s.lifeType;
  s.examKinds = $$('#kindPick input:checked').map((c) => c.value);
  readAcademies();
}
$('#setOv').addEventListener('input', (e) => { if (e.target.closest('#kindPick')) return; if (!e.target.closest('#examForm') && !e.target.closest('[data-pane=look]') && !e.target.closest('.quick')) dirty = true; });
$('#setSave').onclick = async () => {
  readSettings();
  try {
    settings = await api('/settings', { method: 'PUT', body: { ...settings, ...Look.get() } });
    dirty = true;
    await closeSettings();
  } catch (e) { toast(e.message); }
};

// 시험 과목 CRUD
function renderExamList() {
  const today = D.today();
  $('#examList').innerHTML = exams.map((e) => `<div class="list-card">
    <span class="dot" style="width:14px;height:14px;border-radius:50%;background:${e.color};flex:none"></span>
    <div class="grow"><b>${esc(examName(e, exams))}</b> <span class="muted" style="font-size:13px">${D.pretty(e.date)} · ${dday(D.diff(today, e.date))}</span>
      <div style="font-size:13px"><span class="stars">${'★'.repeat(e.difficulty)}${'☆'.repeat(5 - e.difficulty)}</span>
      ${e.priority && e.priority !== 'normal' ? `<span class="chip" style="--c:${e.priority === 'high' ? 'var(--accent)' : 'var(--line)'}">우선순위 ${Presets.PRIORITY[e.priority].label}</span>` : ''}
      ${e.kind === 'custom' && e.stages ? `<span class="chip" style="--c:var(--sage)">${esc(stagesText(e.stages).replace(/, /g, ' → '))}</span>` : ''}
      ${e.pref_days ? `<span class="chip" style="--c:var(--sky)">${String(e.pref_days).split(',').map((d) => DAY_KO[d]).join('·')} 선호</span>` : ''}
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
  renderKindSelect((settings.examKinds || ['naesin'])[0]);
}
$('#examCancel').onclick = resetExamForm;
$('#examForm').onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target;
  const body = { subject: f.subject.value, date: f.date.value, difficulty: +f.difficulty.value, scope: f.scope.value, color: f.color.value,
    pref_days: $$('#prefDays input:checked').map((c) => +c.value),
    kind: f.kind.value, priority: f.priority.value, stages: parseStages(f.stages.value) };
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
    renderKindSelect(x.kind || 'naesin'); f.priority.value = x.priority || 'normal'; f.stages.value = stagesText(x.stages);
    const pd = String(x.pref_days || '').split(',');
    $$('#prefDays input').forEach((c) => (c.checked = pd.includes(c.value)));
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
const qStatus = (html) => { $('#qStatus').innerHTML = html; $('#qReset').hidden = false; };
let lastUndo = null; // 직전 "모두 추가"를 되돌리기 위한 기록

// 빠른 입력 칸을 처음 상태로
function resetQuick() {
  cands = [];
  $('#qResult').innerHTML = '';
  $('#qStatus').innerHTML = '';
  $('#pasteText').value = '';
  $('#dropPreview').hidden = true; $('#dropPreview').removeAttribute('src');
  $('#qReset').hidden = true;
}
$('#qReset').onclick = resetQuick;

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
    $('#qResult').innerHTML = `<p style="color:var(--sun);font-size:14px">과목을 찾지 못했어요 😥 사진을 더 밝고 선명하게 찍거나, 글 붙여넣기 칸에서 내용을 고친 뒤 다시 찾아보세요.
      <button type="button" class="linkbtn" data-reset>처음부터 다시</button></p>`;
    $('#qReset').hidden = false;
    return;
  }
  const blank = cands.filter((c) => !c.subject).length;
  qStatus(`✅ <b>${cands.length}개 과목</b>을 찾았어요. ${method === 'ai' ? 'AI가 읽은 결과예요.' : '자동 인식 결과예요.'} 날짜와 범위가 맞는지 확인하고 고쳐 주세요.`
    + (blank ? ` <span style="color:var(--sun)">과목 이름을 찾지 못한 줄이 있어요 — 빨간 칸에 직접 입력해 주세요.</span>` : ''));
  renderCands();
}
function renderCands() {
  const opts = (v) => [1, 2, 3, 4, 5].map((n) => `<option value="${n}" ${n === v ? 'selected' : ''}>${'★'.repeat(n)}</option>`).join('');
  $('#qResult').innerHTML = `<div class="cands">
    <div class="cand head"><span></span><span>과목</span><span>시험 날짜</span><span class="c-diff">난이도</span><span class="c-scope">시험 범위</span><span></span></div>
    ${cands.map((c, i) => `<div class="cand ${c.date ? '' : 'nodate'} ${c.subject ? '' : 'nosub'} ${c.on ? '' : 'off'}" data-i="${i}">
      <input type="checkbox" data-k="on" ${c.on ? 'checked' : ''} aria-label="추가할지 선택">
      <input class="input" data-k="subject" value="${esc(c.subject)}" maxlength="30" placeholder="과목 이름">
      <input class="input" type="date" data-k="date" value="${c.date}">
      <select class="input c-diff" data-k="difficulty">${opts(c.difficulty)}</select>
      <input class="input c-scope" data-k="scope" value="${esc(c.scope)}" placeholder="범위 (쉼표로 단원 구분)" maxlength="500">
      <button type="button" class="x" data-rmc="${i}" title="빼기">✕</button></div>`).join('')}
  </div>
  <div class="cand-foot">
    <label class="muted" style="font-size:13px">시험 종류 <select class="input" id="candKind" style="width:auto;display:inline-block;margin:0">${(settings?.examKinds || ['naesin']).concat(Presets.KIND_IDS.filter((k) => !(settings?.examKinds || ['naesin']).includes(k) && k !== 'custom'))
      .filter((k) => k !== 'custom').map((k) => `<option value="${k}">${Presets.EXAM_KINDS[k].label}</option>`).join('')}</select></label>
    <button type="button" class="btn small primary" id="candAdd">✔ 선택한 과목 모두 추가</button>
    <button type="button" class="btn small ghost" data-reset>취소</button>
    <span class="muted" style="font-size:12px">빨간 칸 = 직접 입력이 필요해요 · 이미 있는 과목은 날짜·범위가 업데이트돼요</span>
  </div>`;
}
$('#qResult').addEventListener('input', (e) => {
  const row = e.target.closest('.cand[data-i]'); if (!row) return;
  const c = cands[+row.dataset.i], k = e.target.dataset.k;
  c[k] = k === 'on' ? e.target.checked : k === 'difficulty' ? +e.target.value : e.target.value;
  row.classList.toggle('nodate', !c.date);
  row.classList.toggle('nosub', !c.subject.trim());
  row.classList.toggle('off', !c.on);
});
$('#qResult').addEventListener('click', async (e) => {
  if (e.target.dataset.rmc !== undefined) { cands.splice(+e.target.dataset.rmc, 1); return cands.length ? renderCands() : showCands([], ''); }
  if (e.target.dataset.reset !== undefined) return resetQuick();
  if (e.target.id !== 'candAdd') return;
  const pick = cands.filter((c) => c.on);
  if (!pick.length) return toast('추가할 과목을 선택해 주세요');
  if (pick.some((c) => !c.subject.trim())) return toast('과목 이름이 비어 있는 줄이 있어요 (빨간 칸)');
  if (pick.some((c) => !c.date)) return toast('날짜가 비어 있는 과목이 있어요 (빨간 칸)');
  try {
    const before = await api('/exams'); // 되돌리기용 스냅샷
    const kind = $('#candKind')?.value || 'naesin';
    const r = await api('/exams/bulk', { method: 'POST', body: { exams: pick.map(({ subject, date, difficulty, scope }) => ({ subject, date, difficulty, scope, kind })) } });
    exams = await api('/exams');
    const beforeIds = new Set(before.map((x) => x.id));
    lastUndo = {
      added: exams.filter((x) => !beforeIds.has(x.id)).map((x) => x.id),
      changed: before.filter((b) => { const n = exams.find((x) => x.id === b.id); return n && (n.date !== b.date || n.scope !== b.scope || n.difficulty !== b.difficulty); }),
    };
    dirty = true;
    renderExamList(); resetExamForm();
    resetQuick();
    qStatus(`🎉 ${r.added}개 추가${r.updated ? `, ${r.updated}개 업데이트` : ''}했어요!${r.errors.length ? ` <span style="color:var(--sun)">(${esc(r.errors.join(' / '))})</span>` : ''}
      <button type="button" class="linkbtn" id="undoBulk">↶ 되돌리기</button>`);
  } catch (err) { toast(err.message); }
});

// 직전 "모두 추가" 되돌리기: 새로 생긴 과목은 삭제, 바뀐 과목은 원래 값으로
$('#qStatus').addEventListener('click', async (e) => {
  if (e.target.id !== 'undoBulk' || !lastUndo) return;
  e.target.disabled = true;
  try {
    for (const id of lastUndo.added) await api('/exams/' + id, { method: 'DELETE' });
    for (const b of lastUndo.changed) await api('/exams/' + b.id, { method: 'PUT', body: { date: b.date, scope: b.scope, difficulty: b.difficulty } });
    lastUndo = null;
    exams = await api('/exams');
    dirty = true;
    renderExamList();
    qStatus('↶ 추가하기 전으로 되돌렸어요.');
  } catch (err) { toast(err.message); e.target.disabled = false; }
});

// ───────── 시작 ─────────
async function boot(isNew) {
  $('#app').hidden = false;
  api('/settings').then((s) => Look.fromSettings(s)).catch(() => {});
  api('/config').then((c) => {
    cfg = c;
    $('#aiBadge').textContent = c.ai ? 'AI 인식' : '무료 자동 인식';
  }).catch(() => {});
  $('#uname').textContent = Auth.user;
  $('#todayLink').href = `planner.html?date=${D.today()}`;
  settings = await api('/settings').catch(() => settings);
  await refresh();
  if (await Plan.ensure()) await refresh();
  if (isNew) { await runOnboarding(); startTour(true); }
}

// ───────── 가입 직후: ① 생활 유형 ② 준비하는 시험 종류 ─────────
function runOnboarding() {
  return new Promise((resolve) => {
    let step = 1, life = '', kinds = [];
    const draw = () => {
      $('#onbStep').textContent = `${step} / 2`;
      $('#onbBack').hidden = step === 1;
      if (step === 1) {
        $('#onbTitle').textContent = '어떤 생활을 하고 있나요?';
        $('#onbDesc').textContent = '하나만 골라 주세요. 고른 생활에 맞춰 기본 시간표를 넣어 드려요. 설정 창에서 언제든 바꿀 수 있어요.';
        $('#onbBody').innerHTML = `<div class="pick-grid">${Presets.LIFE_IDS.map((id) => { const t = Presets.LIFE_TYPES[id];
          return `<label class="pick-card"><input type="radio" name="onbLife" value="${id}" ${life === id ? 'checked' : ''}><span><span class="ic">${t.icon}</span><b>${t.label}</b><small>${t.desc}</small></span></label>`; }).join('')}</div>`;
        $('#onbNext').textContent = '다음 →';
        $('#onbNext').disabled = !life;
      } else {
        $('#onbTitle').textContent = '어떤 시험을 준비하나요?';
        $('#onbDesc').textContent = '여러 개 골라도 돼요. 시험을 추가할 때 기본 선택지와 추천 과목으로 쓰여요.';
        $('#onbBody').innerHTML = `<div class="pick-grid">${Presets.KIND_IDS.map((id) => { const k = Presets.EXAM_KINDS[id];
          const st = k.stages ? k.stages.map((x) => x.name).join(' → ') : '단계를 직접 정해요';
          return `<label class="pick-card"><input type="checkbox" value="${id}" ${kinds.includes(id) ? 'checked' : ''}><span><b>${k.label}</b><small>${st}</small></span></label>`; }).join('')}</div>`;
        $('#onbNext').textContent = '시작하기 ✓';
        $('#onbNext').disabled = !kinds.length;
      }
    };
    $('#onbBody').onchange = (e) => {
      if (step === 1) { life = e.target.value; if (!kinds.length) kinds = [...Presets.LIFE_TYPES[life].suggestKinds]; }
      else kinds = $$('#onbBody input:checked').map((c) => c.value);
      $('#onbNext').disabled = step === 1 ? !life : !kinds.length;
    };
    $('#onbBack').onclick = () => { step = 1; draw(); };
    $('#onbNext').onclick = async () => {
      if (step === 1) { step = 2; return draw(); }
      $('#onbNext').disabled = true;
      try {
        const base = applyLifeDefaults(await api('/settings'), life);
        settings = await api('/settings', { method: 'PUT', body: { ...base, lifeType: life, examKinds: kinds, ...Look.get() } });
      } catch (err) { toast(err.message); $('#onbNext').disabled = false; return; }
      $('#onbOv').classList.remove('open');
      await refresh();
      resolve();
    };
    draw();
    $('#onbOv').classList.add('open');
  });
}

// ───────── 처음 사용 안내 ─────────
function startTour(isNew = false) {
  runTour([
    { el: null, title: '반가워요! 👋', text: `시험 날짜와 ${fixedName()}·학원 시간만 넣으면 <b>시험 공부 계획을 자동으로</b> 짜 주는 플래너예요. 사용법을 1분 안에 알려 드릴게요.` },
    { el: '#btnSettings', title: '① 시험·시간표 입력', text: `여기서 <b>시험 과목·날짜</b>와 <b>${fixedName()}·학원 시간</b>, 기상·취침 시간을 넣어요. 창을 닫으면 <b>공부 계획이 자동으로</b> 만들어져요.<br>시험 범위는 공지 <b>사진·캡처를 올리거나 글을 붙여넣으면</b> 과목별로 자동 정리돼요.` },
    { el: '#cal', title: '② 달력에서 날짜 누르기', text: '날짜를 누르면 <b>그날의 플래너가 새 창</b>으로 열려요. 할 일을 체크하면 이 달력에도 바로 반영되고, 다 끝낸 날엔 도장이 찍혀요.' },
    { el: '#bigDday', title: '③ D-Day와 진행률', text: '가장 가까운 시험까지 남은 날, 시험별로 얼마나 공부했는지, 며칠 연속 공부했는지 여기서 볼 수 있어요.' },
    { el: '#raceLink', title: '④ 친구와 공부 마라톤', text: '방을 만들고 <b>입장 코드</b>를 친구에게 알려 주면 같이 달릴 수 있어요. 공부한 만큼 내 픽셀 캐릭터가 앞으로 달리고, 많이 할수록 머리에 불이 붙어요 🔥' },
    { el: '#btnSettings', title: '⑤ 내 맘대로 꾸미기', text: '설정 창의 <b>🎨 꾸미기</b> 탭에서 색 테마(벚꽃·민트·밤 등), 큰 글씨 글꼴, 화면 크기를 바꿀 수 있어요.' },
    { el: '#btnHelp', title: '언제든 다시 보기', text: '사용법이 궁금하면 이 버튼을 눌러 주세요. 이제 시험부터 등록해 볼까요?' },
  ], { doneLabel: isNew ? '시험 등록하러 가기 →' : '완료', onDone: () => { if (isNew) openSettings(); } });
}
$('#btnHelp').onclick = () => startTour(exams.length === 0);
onChange(() => refresh());
document.addEventListener('visibilitychange', async () => { if (!document.hidden && Auth.token) { await refresh(); if (await Plan.ensure()) await refresh(); } });

if (Auth.token) boot(false).catch(() => {});
else $('#authOv').classList.add('open');
