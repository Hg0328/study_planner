// ─────────────────────────────────────────────
//  백색소음 — 집중 타이머가 돌아가는 동안 재생 (플래너 · 공부 마라톤 공용)
// ─────────────────────────────────────────────
// 소리 파일 없이 Web Audio로 직접 만들어요.
//  재료: 6초짜리 잡음 3종(화이트·핑크·브라운)을 한 번 만들어 반복 재생 + 필터 + 음량 자동 조절 + 짧은 "톡" 소리
//  소리: 기본 잡음(선명↔부드럽게) · 빗소리(가랑비↔소나기) · 파도 · 장작불 · 시냇물 · 바람
//  소리마다 시간에 따라 달라지는 패턴이 달라서 서로 구별돼요 (아래 NOISE 상수)
//  소리를 바꾸거나 끌 때는 항상 음량을 서서히 줄였다 키워서(크로스페이드) '툭' 끊기는 소리가 없어요

// ── 소리 설계 값 (주기·빈도·주파수) ──
const NOISE = {
  MASTER: 0.6,          // 음량 슬라이더 1.0일 때 실제 출력 배율
  FADE_IN: 0.9,         // 켤 때 서서히 커지는 시간(초)
  FADE_OUT: 0.6,        // 끌 때·소리 바꿀 때 서서히 작아지는 시간(초)
  PREVIEW: 3,           // 미리듣기 길이(초)
  LOOKAHEAD: 2.5,       // 무작위 소리를 몇 초 앞까지 미리 예약할지 (탭이 뒤로 가서 타이머가 느려져도 끊기지 않게)
  TICK_MS: 400,         // 예약 점검 간격(ms)
  BUFFER_SEC: 6,        // 반복 재생하는 잡음 길이(초), 이음새 50ms 겹침
  base: { level: 1 },   // 선명(0)=화이트 → 가운데(0.5)=핑크 → 부드럽게(1)=브라운, 같은 크기로 섞기(equal-power)
  rain: {
    bedHigh: 500, bedLow: [5000, 8000],   // 배경 잡음 대역(Hz): 가랑비 500~5000, 소나기 500~8000
    bedGain: [0.3, 0.8],                  // 배경 크기: 가랑비 → 소나기
    rumbleGain: [0, 0.22], rumbleLow: 300, // 소나기일수록 낮은 웅웅 소리 추가
    dropsPerSec: [4, 48],                 // 빗방울 수(초당): 가랑비 4 → 소나기 48
    dropFreq: [1800, 6500], dropQ: [4, 9], dropDur: [0.015, 0.05], dropGain: [0.12, 0.45],
    swellEvery: [4, 9], swell: [0.8, 1.15], // 4~9초마다 빗줄기가 0.8~1.15배로 굵어졌다 가늘어짐
    level: 0.9,
  },
  waves: {
    period: [8, 13],      // 파도 하나의 길이(초)
    rise: 0.35,           // 밀려오는 구간 비율 (나머지 65%는 빠져나감)
    gain: [0.1, 1], peak: [0.7, 1], // 가장 작을 때 크기 / 파도마다 꼭대기 크기 범위
    cutoff: [260, 1900],  // 필터: 잔잔할 때 260Hz → 부서질 때 최대 1900Hz
    foamHigh: 3200, foamGain: 0.1, // 부서지는 순간의 "쏴" 거품 소리
    level: 0.95,
  },
  fire: {
    rumbleLow: 160, rumbleGain: [0.55, 1], flutterEvery: [0.25, 0.8], // 낮은 웅웅 소리가 0.25~0.8초마다 흔들림
    hissFreq: 2500, hissGain: 0.05,
    cracklesPerSec: 7, crackleFreq: [1500, 5500], crackleDur: [0.004, 0.02], crackleGain: [0.1, 0.5],
    clusterChance: 0.2, cluster: [2, 4], clusterWithin: 0.06, // 타닥 소리 5번에 1번은 0.06초 안에 2~4개가 몰려서
    popsPerSec: 0.35, popFreq: [500, 1200], popDur: [0.03, 0.07], popGain: [0.55, 0.85], // 가끔 "딱" 큰 소리
    level: 0.9,
  },
  stream: {
    bands: [450, 900, 1700, 2900, 4600], q: 3,   // 다섯 대역(Hz)
    wobbleEvery: [0.05, 0.13], wobbleGain: [0.15, 1], wobbleFreq: 0.12, // 대역마다 0.05~0.13초마다 크기와 높이(±12%)가 따로 흔들림
    bedHigh: 800, bedGain: 0.1,
    level: 0.55,
  },
  wind: {
    gustEvery: [2.5, 6], gustTime: [1.2, 2.5],   // 2.5~6초마다 새 바람, 1.2~2.5초에 걸쳐 바뀜
    freq: [220, 950], q: 1.4, gain: [0.2, 1],    // 세게 불수록 음이 높아짐
    lowCut: 200, lowGain: 0.3,                   // 깔리는 낮은 바람
    whistleFreq: [900, 1600], whistleQ: 12, whistleGain: 0.035, // 센 바람일 때만 들리는 휘파람
    level: 0.9,
  },
};
const NOISE_SOUNDS = [
  { id: 'off', name: '끄기' },
  { id: 'base', name: '기본 잡음', slider: 'tone', lo: '선명하게', hi: '부드럽게' },
  { id: 'rain', name: '빗소리', slider: 'rain', lo: '가랑비', hi: '소나기' },
  { id: 'waves', name: '파도' },
  { id: 'fire', name: '장작불' },
  { id: 'stream', name: '시냇물' },
  { id: 'wind', name: '바람' },
];
// 예전에 저장된 값 → 기본 잡음 + 슬라이더 위치
const NOISE_LEGACY = { white: 0, pink: 0.5, brown: 1 };

const Noise = {
  ctx: null, master: null, voice: null, buffers: {}, ticker: null, previewTimer: null,
  on: false,          // 고른 소리를 재생 중인지 (미리듣기는 제외)
  previewing: '',     // 미리듣기 중인 소리
  type: 'off', vol: 0.5, tone: 0.5, rain: 0.5,
  onchange() {},

  load() {
    try {
      const v = JSON.parse(localStorage.getItem('sp_noise') || '{}');
      this.vol = typeof v.vol === 'number' ? v.vol : 0.5;
      this.tone = typeof v.tone === 'number' ? v.tone : 0.5;
      this.rain = typeof v.rain === 'number' ? v.rain : 0.5;
      this.type = v.type || 'off';
      if (this.type in NOISE_LEGACY) { this.tone = NOISE_LEGACY[this.type]; this.type = 'base'; this.save(); } // white/pink/brown → 기본 잡음
      if (!NOISE_SOUNDS.some((s) => s.id === this.type)) this.type = 'off';
    } catch {}
  },
  save() { localStorage.setItem('sp_noise', JSON.stringify({ type: this.type, vol: this.vol, tone: this.tone, rain: this.rain })); },
  get playing() { return this.on || !!this.previewing; },

  ensure() {
    this.ctx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (this.ctx.state === 'suspended') this.ctx.resume();
    if (!this.master) {
      this.master = this.ctx.createGain();
      this.master.gain.value = this.vol * NOISE.MASTER;
      this.master.connect(this.ctx.destination);
    }
    return this.ctx;
  },
  // 반복 재생용 잡음 (white | pink | brown)
  buffer(kind) {
    if (this.buffers[kind]) return this.buffers[kind];
    const ctx = this.ctx, sr = ctx.sampleRate, len = sr * NOISE.BUFFER_SEC;
    const b = ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        if (kind === 'white') d[i] = w * 0.35;
        else if (kind === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.2; }
        else {
          b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
          b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
          d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.09; b6 = w * 0.115926;
        }
      }
      // 반복 재생 이음새에서 '툭' 소리가 안 나도록 처음과 끝을 이어 붙임
      const fade = Math.floor(sr * 0.05);
      for (let i = 0; i < fade; i++) { const k = i / fade; d[len - fade + i] = d[len - fade + i] * (1 - k) + d[i] * k; }
    }
    return (this.buffers[kind] = b);
  },

  // 소리 하나 시작 (이전 소리는 서서히 줄이면서 겹쳐 바꿈)
  start(type) {
    const ctx = this.ensure(), now = ctx.currentTime;
    this.fade(this.voice, NOISE.FADE_OUT);
    const out = ctx.createGain();
    out.gain.setValueAtTime(0, now);
    out.gain.linearRampToValueAtTime(NOISE[type].level, now + NOISE.FADE_IN);
    out.connect(this.master);
    const v = { type, out, sources: [], next: {}, dead: false };
    NoiseKit.build[type](this, v);
    this.voice = v;
    v.sched?.(now, now + NOISE.LOOKAHEAD);
    this.ticker ||= setInterval(() => {
      const c = this.ctx.currentTime;
      if (this.voice && !this.voice.dead) this.voice.sched?.(c, c + NOISE.LOOKAHEAD);
    }, NOISE.TICK_MS);
  },
  // 소리를 서서히 줄인 뒤 정리
  fade(v, sec) {
    if (!v || v.dead) return;
    v.dead = true;
    const ctx = this.ctx, now = ctx.currentTime, g = v.out.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0, now + sec);
    for (const s of v.sources) { try { s.stop(now + sec + 0.1); } catch {} }
    setTimeout(() => { try { v.out.disconnect(); } catch {} }, (sec + 0.3) * 1000);
    if (this.voice === v) this.voice = null;
  },

  // 고른 소리 재생 (타이머 시작)
  play() {
    if (this.type === 'off') return this.stop();
    clearTimeout(this.previewTimer); this.previewing = '';
    if (!(this.on && this.voice && this.voice.type === this.type)) this.start(this.type);
    this.on = true;
    this.onchange();
  },
  // 멈춤 (타이머 정지). now=true면 짧게 줄임
  stop(now = false) {
    clearTimeout(this.previewTimer); this.previewing = '';
    this.on = false;
    this.fade(this.voice, now ? 0.08 : NOISE.FADE_OUT);
    this.onchange();
  },
  // 3초 미리듣기: 끝나면 원래 재생 중이던 소리로 돌아가거나 꺼짐
  preview(type) {
    clearTimeout(this.previewTimer);
    if (this.previewing === type) return this.endPreview();
    this.start(type);
    this.previewing = type;
    this.previewTimer = setTimeout(() => this.endPreview(), NOISE.PREVIEW * 1000);
    this.onchange();
  },
  endPreview() {
    clearTimeout(this.previewTimer);
    this.previewing = '';
    if (this.on && this.type !== 'off') this.start(this.type); else this.fade(this.voice, NOISE.FADE_OUT);
    this.onchange();
  },
  // 소리 고르기 (재생 중이면 바로 바꿔 틀기)
  select(type, running) {
    this.type = type; this.save();
    clearTimeout(this.previewTimer); this.previewing = '';
    if (type === 'off') this.stop();
    else if (this.on || running) this.play();
    else { this.fade(this.voice, NOISE.FADE_OUT); this.onchange(); }
  },
  setVol(v) {
    this.vol = v; this.save();
    if (this.master) this.master.gain.setTargetAtTime(v * NOISE.MASTER, this.ctx.currentTime, 0.1);
  },
  setParam(name, v) { // tone(선명↔부드럽게) | rain(가랑비↔소나기) — 재생 중이면 끊김 없이 반영
    this[name] = v; this.save();
    if (this.voice && !this.voice.dead) this.voice.set?.(name, v);
  },
};

// ── 소리 만드는 도구와 소리별 설계 ──
const NoiseKit = {
  rnd: (a, b) => a + Math.random() * (b - a),
  lerp: (r, t) => r[0] + (r[1] - r[0]) * t,
  // 반복 재생 잡음 → (필터들) → 음량 → v.out
  loop(N, v, kind, filters = [], gain = 1) {
    const ctx = N.ctx, src = ctx.createBufferSource();
    src.buffer = N.buffer(kind); src.loop = true;
    let node = src;
    const fs = filters.map(([type, freq, q]) => {
      const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; if (q) f.Q.value = q;
      node.connect(f); node = f; return f;
    });
    const g = ctx.createGain(); g.gain.value = gain;
    node.connect(g); g.connect(v.out);
    src.start(0, Math.random() * (NOISE.BUFFER_SEC - 1));
    v.sources.push(src);
    return { src, filters: fs, gain: g };
  },
  // 짧은 "톡" 소리 하나를 t초에 예약 (빗방울·타닥)
  burst(N, v, t, { freq, q = 1, dur, gain, type = 'bandpass', pan = 0 }) {
    const ctx = N.ctx, src = ctx.createBufferSource();
    src.buffer = N.buffer('white');
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.002);          // 2ms에 걸쳐 올라가서 클릭 없음
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g);
    if (pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; g.connect(p); p.connect(v.out); } else g.connect(v.out);
    src.start(t, Math.random() * (NOISE.BUFFER_SEC - 1), dur + 0.03);
  },
  // 평균 rate(초당)로 무작위 시각에 fn 실행 예약 — key별로 다음 시각을 기억
  poisson(v, key, t0, t1, rate, fn) {
    if (rate <= 0) { v.next[key] = t1; return; }
    let t = Math.max(v.next[key] ?? t0, t0);
    while (t < t1) { fn(t); t += -Math.log(1 - Math.random()) / rate; }
    v.next[key] = t;
  },
  // every 범위(초)마다 fn 실행 예약
  every(v, key, t0, t1, range, fn) {
    let t = Math.max(v.next[key] ?? t0, t0);
    while (t < t1) { fn(t); t += NoiseKit.rnd(range[0], range[1]); }
    v.next[key] = t;
  },

  build: {
    // 기본 잡음: 화이트·핑크·브라운을 동시에 틀고 슬라이더로 섞는 비율만 바꿈
    base(N, v) {
      const K = NoiseKit, parts = ['white', 'pink', 'brown'].map((k) => K.loop(N, v, k, [], 0));
      const mix = (t) => { const x = t * 2, a = Math.PI / 2;
        return x <= 1 ? [Math.cos(x * a), Math.sin(x * a), 0] : [0, Math.cos((x - 1) * a), Math.sin((x - 1) * a)]; };
      const apply = (t, tc) => mix(t).forEach((g, i) => parts[i].gain.gain.setTargetAtTime(g, N.ctx.currentTime, tc));
      mix(N.tone).forEach((g, i) => (parts[i].gain.gain.value = g));
      v.set = (name, val) => { if (name === 'tone') apply(val, 0.08); };
    },
    // 빗소리: 배경 잡음 + 무작위 빗방울, 세기(가랑비↔소나기)
    rain(N, v) {
      const K = NoiseKit, C = NOISE.rain;
      let r = N.rain;
      const bed = K.loop(N, v, 'pink', [['highpass', C.bedHigh], ['lowpass', K.lerp(C.bedLow, r)]], K.lerp(C.bedGain, r));
      const rumble = K.loop(N, v, 'brown', [['lowpass', C.rumbleLow]], K.lerp(C.rumbleGain, r));
      v.set = (name, val) => {
        if (name !== 'rain') return;
        r = val; const now = N.ctx.currentTime;
        bed.gain.gain.setTargetAtTime(K.lerp(C.bedGain, r), now, 0.15);
        bed.filters[1].frequency.setTargetAtTime(K.lerp(C.bedLow, r), now, 0.15);
        rumble.gain.gain.setTargetAtTime(K.lerp(C.rumbleGain, r), now, 0.15);
      };
      v.sched = (t0, t1) => {
        K.poisson(v, 'drop', t0, t1, K.lerp(C.dropsPerSec, r), (t) => K.burst(N, v, t, {
          freq: K.rnd(...C.dropFreq), q: K.rnd(...C.dropQ), dur: K.rnd(...C.dropDur), gain: K.rnd(...C.dropGain), pan: K.rnd(-0.8, 0.8) }));
        K.every(v, 'swell', t0, t1, C.swellEvery, (t) => bed.gain.gain.setTargetAtTime(K.lerp(C.bedGain, r) * K.rnd(...C.swell), t, 1.2));
      };
    },
    // 파도: 8~13초에 한 번씩 밀려와 부서지고 빠져나감 (크기와 밝기가 함께 변함)
    waves(N, v) {
      const K = NoiseKit, C = NOISE.waves, ctx = N.ctx;
      const body = ctx.createGain(); body.gain.value = C.gain[0]; body.connect(v.out);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = C.cutoff[0]; lp.connect(body);
      for (const [kind, g] of [['brown', 0.8], ['pink', 0.5]]) {
        const src = ctx.createBufferSource(); src.buffer = N.buffer(kind); src.loop = true;
        const gg = ctx.createGain(); gg.gain.value = g; src.connect(gg); gg.connect(lp);
        src.start(0, Math.random() * 4); v.sources.push(src);
      }
      const foam = K.loop(N, v, 'white', [['highpass', C.foamHigh]], 0);
      v.sched = (t0, t1) => {
        let t = Math.max(v.next.wave ?? t0, t0);
        while (t < t1) {
          const P = K.rnd(...C.period), up = t + P * C.rise, end = t + P, peak = K.rnd(...C.peak);
          body.gain.setValueAtTime(C.gain[0], t);
          body.gain.linearRampToValueAtTime(peak, up);
          body.gain.linearRampToValueAtTime(C.gain[0], end);
          lp.frequency.setValueAtTime(C.cutoff[0], t);
          lp.frequency.linearRampToValueAtTime(C.cutoff[1] * (0.6 + 0.4 * peak), up);
          lp.frequency.linearRampToValueAtTime(C.cutoff[0], end);
          foam.gain.gain.setValueAtTime(0, t + P * C.rise * 0.7);
          foam.gain.gain.linearRampToValueAtTime(C.foamGain * peak, up + P * 0.05);
          foam.gain.gain.linearRampToValueAtTime(0, up + P * 0.35);
          t = end;
        }
        v.next.wave = t;
      };
    },
    // 장작불: 낮게 웅웅거리는 불 + 무작위로 타닥 튀는 소리 (가끔 몰려서, 가끔 크게 "딱")
    fire(N, v) {
      const K = NoiseKit, C = NOISE.fire;
      const rumble = K.loop(N, v, 'brown', [['lowpass', C.rumbleLow]], C.rumbleGain[1]);
      K.loop(N, v, 'pink', [['bandpass', C.hissFreq, 0.7]], C.hissGain);
      const crackle = (t) => K.burst(N, v, t, { freq: K.rnd(...C.crackleFreq), q: K.rnd(1, 3), dur: K.rnd(...C.crackleDur), gain: K.rnd(...C.crackleGain), pan: K.rnd(-0.5, 0.5) });
      v.sched = (t0, t1) => {
        K.every(v, 'flutter', t0, t1, C.flutterEvery, (t) => rumble.gain.gain.setTargetAtTime(K.rnd(...C.rumbleGain), t, 0.15));
        K.poisson(v, 'crackle', t0, t1, C.cracklesPerSec, (t) => {
          crackle(t);
          if (Math.random() < C.clusterChance) for (let i = 0, n = Math.round(K.rnd(...C.cluster)); i < n; i++) crackle(t + Math.random() * C.clusterWithin);
        });
        K.poisson(v, 'pop', t0, t1, C.popsPerSec, (t) => K.burst(N, v, t, { freq: K.rnd(...C.popFreq), q: 1.5, dur: K.rnd(...C.popDur), gain: K.rnd(...C.popGain), pan: K.rnd(-0.3, 0.3) }));
      };
    },
    // 시냇물: 다섯 대역의 잡음이 각각 빠르게 흔들림 (졸졸)
    stream(N, v) {
      const K = NoiseKit, C = NOISE.stream;
      const bands = C.bands.map((f) => ({ f, p: K.loop(N, v, 'white', [['bandpass', f, C.q]], 0.5) }));
      K.loop(N, v, 'pink', [['highpass', C.bedHigh]], C.bedGain);
      v.sched = (t0, t1) => bands.forEach((b, i) => K.every(v, 'b' + i, t0, t1, C.wobbleEvery, (t) => {
        b.p.gain.gain.setTargetAtTime(K.rnd(...C.wobbleGain), t, 0.035);
        b.p.filters[0].frequency.setTargetAtTime(b.f * K.rnd(1 - C.wobbleFreq, 1 + C.wobbleFreq), t, 0.035);
      }));
    },
    // 바람: 2.5~6초마다 세기가 바뀌고, 세게 불수록 음이 높아짐 (휘이잉)
    wind(N, v) {
      const K = NoiseKit, C = NOISE.wind;
      const main = K.loop(N, v, 'pink', [['bandpass', C.freq[0], C.q]], C.gain[0]);
      K.loop(N, v, 'brown', [['lowpass', C.lowCut]], C.lowGain);
      const whistle = K.loop(N, v, 'white', [['bandpass', C.whistleFreq[0], C.whistleQ]], 0);
      v.sched = (t0, t1) => K.every(v, 'gust', t0, t1, C.gustEvery, (t) => {
        const s = Math.random(), tc = K.rnd(...C.gustTime) / 3; // s: 이번 바람 세기 0~1
        main.gain.gain.setTargetAtTime(K.lerp(C.gain, s), t, tc);
        main.filters[0].frequency.setTargetAtTime(K.lerp(C.freq, s), t, tc);
        whistle.gain.gain.setTargetAtTime(s > 0.6 ? C.whistleGain * (s - 0.6) / 0.4 : 0, t, tc);
        whistle.filters[0].frequency.setTargetAtTime(K.lerp(C.whistleFreq, s), t, tc);
      });
    },
  },
};
Noise.load();

// ── 화면: 소리 고르기 + 소리마다 3초 미리듣기 + 슬라이더 (플래너·마라톤이 같은 것을 씀) ──
//  el: 넣을 곳, isRunning(): 지금 타이머가 돌고 있는지 (돌고 있으면 고르자마자 바꿔 틀기)
function mountNoiseUI(el, { isRunning = () => false, hint = '골라 두면 타이머를 시작할 때 자동으로 켜지고, 멈추면 꺼져요' } = {}) {
  if (!document.getElementById('nz-style')) {
    const st = document.createElement('style'); st.id = 'nz-style';
    st.textContent = `
      .nz { text-align: left; font-size: 13px; }
      .nz-head { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
      .nz-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(128px, 1fr)); gap: 4px 10px; margin-bottom: 8px; }
      .nz-row { display: flex; align-items: center; gap: 4px; min-height: 26px; }
      .nz-row label { flex: 1; display: flex; align-items: center; gap: 5px; cursor: pointer; white-space: nowrap; }
      .nz-row input { accent-color: var(--nz-accent, var(--accent, #e07a5f)); margin: 0; }
      .nz-row.on label { font-weight: bold; }
      .nz-pre { border: 1.5px solid currentColor; background: none; color: inherit; font: inherit; font-size: 11px; line-height: 1; padding: 3px 6px;
        border-radius: var(--nz-radius, 999px); cursor: pointer; opacity: .7; white-space: nowrap; }
      .nz-pre:hover, .nz-pre.on { opacity: 1; }
      .nz-pre.on { background: var(--nz-accent, var(--accent, #e07a5f)); border-color: var(--nz-accent, var(--accent, #e07a5f)); color: var(--nz-on, #fff); }
      .nz-sl { display: flex; align-items: center; gap: 8px; margin: 4px 0; white-space: nowrap; }
      .nz-sl input { flex: 1; min-width: 60px; accent-color: var(--nz-accent, var(--accent, #e07a5f)); }
      .nz-hint { font-size: 11px; opacity: .7; margin-top: 4px; }`;
    document.head.appendChild(st);
  }
  el.classList.add('nz');
  el.innerHTML = `
    <div class="nz-head"><span>🎧 백색소음</span></div>
    <div class="nz-list" role="radiogroup" aria-label="백색소음 종류">${NOISE_SOUNDS.map((s) => `
      <div class="nz-row" data-row="${s.id}"><label><input type="radio" name="nzType" value="${s.id}">${s.name}</label>
        ${s.id === 'off' ? '' : `<button type="button" class="nz-pre" data-pre="${s.id}" title="${s.name} 3초 미리듣기" aria-label="${s.name} 3초 미리듣기">▶ 3초</button>`}</div>`).join('')}</div>
    ${NOISE_SOUNDS.filter((s) => s.slider).map((s) => `<label class="nz-sl" data-for="${s.id}"><span>${s.lo}</span>
      <input type="range" min="0" max="1" step="0.05" data-param="${s.slider}" aria-label="${s.name}: ${s.lo}에서 ${s.hi}까지"><span>${s.hi}</span></label>`).join('')}
    <label class="nz-sl"><span>음량</span><input type="range" min="0" max="1" step="0.05" data-vol aria-label="음량"></label>
    <div class="nz-hint">${hint}</div>`;
  const q = (s) => el.querySelector(s), qa = (s) => [...el.querySelectorAll(s)];
  const sync = () => {
    qa('[name=nzType]').forEach((r) => { r.checked = r.value === Noise.type; r.closest('.nz-row').classList.toggle('on', r.checked); });
    qa('.nz-pre').forEach((b) => { const on = Noise.previewing === b.dataset.pre; b.classList.toggle('on', on); b.textContent = on ? '■ 멈춤' : '▶ 3초'; });
    // 슬라이더는 고른 소리(또는 미리듣기 중인 소리)의 것만 보임
    qa('[data-for]').forEach((l) => (l.hidden = l.dataset.for !== (Noise.previewing || Noise.type)));
    qa('[data-param]').forEach((i) => (i.value = Noise[i.dataset.param]));
    q('[data-vol]').value = Noise.vol;
  };
  Noise.onchange = sync;
  el.addEventListener('change', (e) => { if (e.target.name === 'nzType') Noise.select(e.target.value, isRunning()); });
  el.addEventListener('click', (e) => { const b = e.target.closest('.nz-pre'); if (b) Noise.preview(b.dataset.pre); });
  el.addEventListener('input', (e) => {
    if (e.target.dataset.param) Noise.setParam(e.target.dataset.param, +e.target.value);
    else if (e.target.hasAttribute('data-vol')) Noise.setVol(+e.target.value);
  });
  sync();
}
