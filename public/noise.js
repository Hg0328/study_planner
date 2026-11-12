// ─────────────────────────────────────────────
//  백색소음 — 집중 타이머가 돌아가는 동안 재생 (플래너 · 공부 마라톤 공용)
// ─────────────────────────────────────────────
// 소리 파일 없이 Web Audio로 직접 만들어요: 화이트(쏴아) · 핑크(부드러운) · 브라운(낮고 묵직) · 빗소리
const Noise = {
  ctx: null, src: null, gain: null, type: 'off', vol: 0.5, buffers: {}, onchange() {},
  load() {
    try { const v = JSON.parse(localStorage.getItem('sp_noise') || '{}'); this.type = v.type || 'off'; this.vol = v.vol ?? 0.5; } catch {}
  },
  save() { localStorage.setItem('sp_noise', JSON.stringify({ type: this.type, vol: this.vol })); },
  makeBuffer(type) {
    const ctx = this.ctx, sr = ctx.sampleRate, len = sr * 6;
    const b = ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        if (type === 'white') d[i] = w * 0.35;
        else if (type === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.2; }
        else { // pink (빗소리도 핑크 노이즈 기반)
          b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
          b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
          d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.09; b6 = w * 0.115926;
          if (type === 'rain' && Math.random() < 0.0009) d[i] += (Math.random() * 2 - 1) * 0.6; // 빗방울 톡톡
        }
      }
      // 반복 재생 이음새에서 '툭' 소리가 안 나도록 처음과 끝을 이어 붙임
      const fade = Math.floor(sr * 0.05);
      for (let i = 0; i < fade; i++) { const k = i / fade; d[len - fade + i] = d[len - fade + i] * (1 - k) + d[i] * k; }
    }
    return b;
  },
  play() {
    if (this.type === 'off') return;
    this.ctx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this.stop(true);
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.buffers[this.type] ||= this.makeBuffer(this.type);
    src.loop = true;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(this.vol * 0.6, ctx.currentTime + 1.2); // 서서히 커지기
    let node = src;
    if (this.type === 'rain') {
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 400;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 7000;
      node.connect(hp); hp.connect(lp); node = lp;
    }
    node.connect(gain); gain.connect(ctx.destination);
    src.start();
    this.src = src; this.gain = gain;
    this.onchange();
  },
  stop(now = false) {
    if (!this.src) return;
    const { src, gain, ctx } = this;
    this.src = null;
    const t = now ? 0.05 : 1;
    gain.gain.cancelScheduledValues(ctx.currentTime);
    gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + t); // 서서히 작아지기
    src.stop(ctx.currentTime + t + 0.05);
    this.onchange();
  },
  setVol(v) {
    this.vol = v; this.save();
    if (this.gain) this.gain.gain.setTargetAtTime(v * 0.6, this.ctx.currentTime, 0.1);
  },
};
Noise.load();

// 화면의 고르기/음량/들어보기와 연결
function bindNoiseUI({ select, vol, test, isRunning }) {
  select.value = Noise.type;
  vol.value = Noise.vol;
  Noise.onchange = () => { test.textContent = Noise.src ? '■ 끄기' : '▶ 들어보기'; };
  select.onchange = () => {
    Noise.type = select.value; Noise.save();
    if (Noise.type === 'off') Noise.stop();
    else if (Noise.src || isRunning()) Noise.play(); // 재생 중이면 바로 바꿔 틀기
  };
  vol.oninput = () => Noise.setVol(+vol.value);
  test.onclick = () => {
    if (Noise.src) return Noise.stop();
    if (Noise.type === 'off') { Noise.type = 'pink'; select.value = 'pink'; Noise.save(); }
    Noise.play();
  };
}

