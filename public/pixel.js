// ─────────────────────────────────────────────
//  픽셀 캐릭터 그리기 (캔버스)
// ─────────────────────────────────────────────
// 캐릭터 한 명 = 16 × 24 칸. 칸 하나를 s 픽셀로 그림.
// pose: 'run'(달리기 4프레임) · 'drink'(물 마시기) · 'sleep'(누워서 자기) · 'stand'
// fire: 0~3 (오늘 공부량이 많을수록 머리 위 불꽃이 커짐)
const Pixel = (() => {
  const SKINS = ['#ffe3cc', '#f6c9a2', '#dca476', '#ad7449', '#6f4528'];
  const OUT = '#2a2220';
  const HAIRS = { short: '짧은 머리', long: '긴 머리', pony: '포니테일', spiky: '삐죽 머리', bob: '단발', buzz: '까까머리' };
  const ACCS = { none: '없음', cap: '모자', band: '머리띠', glasses: '안경', ribbon: '리본', crown: '왕관', phones: '헤드폰' };

  const shade = (hex, k) => {
    const n = parseInt(hex.slice(1), 16);
    const f = (c) => Math.max(0, Math.min(255, Math.round(c * k)));
    return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
  };

  function sprite(ctx, av, pose, frame, ox, oy, s) {
    const R = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(ox + x * s, oy + y * s, w * s, h * s); };
    const O = (x, y, w, h, c) => { R(x - 1, y - 1, w + 2, h + 2, OUT); R(x, y, w, h, c); }; // 테두리 있는 칸
    const skin = SKINS[av.skin] || SKINS[1];
    const f = frame % 4;
    const run = pose === 'run';
    const bob = run && f % 2 ? 1 : 0;
    const shirtDark = shade(av.shirt, 0.72);
    const pantsDark = shade(av.pants, 0.72);

    // 다리 (뒤 → 앞)
    let backX = 7, frontX = 7, backLift = 0, frontLift = 0;
    if (run) { backX = [5, 6, 9, 7][f]; frontX = [9, 7, 5, 6][f]; backLift = f === 0 ? 1 : 0; frontLift = f === 2 ? 1 : 0; }
    else { backX = 6; frontX = 8; }
    O(backX, 16 + bob - backLift, 2, 5, pantsDark); O(backX, 21 + bob - backLift, 3, 1, shade(av.shoes, 0.8));
    // 뒤 팔
    const backArmX = run ? [5, 6, 9, 6][f] : 4;
    O(backArmX, 11 + bob, 2, 4, shirtDark); R(backArmX, 14 + bob, 2, 1, shade(skin, 0.85));
    // 몸통
    O(5, 10 + bob, 6, 6, av.shirt);
    R(5, 15 + bob, 6, 1, shirtDark);
    // 앞 다리
    O(frontX, 16 + bob - frontLift, 2, 5, av.pants); O(frontX, 21 + bob - frontLift, 3, 1, av.shoes);

    // 머리
    O(4, 3 + bob, 8, 7, skin);
    // 머리카락
    const hc = av.hairColor, hd = shade(hc, 0.75), y = bob;
    switch (av.hair) {
      case 'long': R(3, 2 + y, 3, 10, hd); R(3, 2 + y, 9, 3, hc); R(4, 1 + y, 7, 1, hc); break;
      case 'pony': R(4, 2 + y, 8, 3, hc); R(4, 1 + y, 7, 1, hc); R(4, 5 + y, 2, 2, hc); R(1, 4 + y, 3, 5, hd); R(3, 4 + y, 1, 2, '#e85d75'); break;
      case 'spiky': R(4, 2 + y, 8, 3, hc); R(4, 5 + y, 1, 2, hc); [[4, 0], [6, -1], [8, 0], [10, -1]].forEach(([sx, sy]) => R(sx, 1 + sy + y, 2, 2, hc)); break;
      case 'bob': R(3, 2 + y, 10, 3, hc); R(4, 1 + y, 8, 1, hc); R(3, 5 + y, 3, 5, hc); R(11, 5 + y, 1, 2, hc); break;
      case 'buzz': R(4, 2 + y, 8, 2, hd); break;
      default: R(4, 2 + y, 8, 3, hc); R(4, 1 + y, 7, 1, hc); R(4, 5 + y, 2, 2, hc); // short
    }
    // 얼굴 (오른쪽을 봄)
    const closed = pose === 'sleep';
    if (closed) { R(8, 7 + y, 2, 1, OUT); R(10, 7 + y, 1, 1, OUT); }
    else { R(8, 6 + y, 1, 2, OUT); R(10, 6 + y, 1, 2, OUT); }
    R(10, 8 + y, 2, 1, '#f4a3a3'); // 볼터치
    if (pose === 'drink') R(11, 8 + y, 1, 1, OUT);

    // 액세서리
    const ac = av.accColor;
    switch (av.acc) {
      case 'cap': R(4, 1 + y, 8, 3, ac); R(10, 3 + y, 4, 1, shade(ac, 0.75)); break;
      case 'band': R(4, 4 + y, 8, 1, ac); break;
      case 'glasses': R(7, 6 + y, 2, 2, 'rgba(255,255,255,.35)'); R(10, 6 + y, 2, 2, 'rgba(255,255,255,.35)'); R(7, 5 + y, 5, 1, OUT); R(9, 6 + y, 1, 1, OUT); break;
      case 'ribbon': R(3, 0 + y, 2, 2, ac); R(6, 0 + y, 2, 2, ac); R(5, 0 + y, 1, 2, shade(ac, 0.7)); break;
      case 'crown': R(5, 0 + y, 6, 2, '#f4c430'); R(5, -1 + y, 1, 1, '#f4c430'); R(7, -1 + y, 2, 1, '#f4c430'); R(10, -1 + y, 1, 1, '#f4c430'); R(7, 1 + y, 2, 1, '#e8452c'); break;
      case 'phones': R(4, 1 + y, 8, 1, OUT); R(5, 5 + y, 2, 3, ac); break;
    }

    // 앞 팔
    if (pose === 'drink') {
      const sip = frame % 2;
      O(9, 8 + y, 2, 4, av.shirt); R(9, 7 + y, 2, 1, skin);
      O(11, 3 + y - sip, 2, 5, '#5fb3f0'); R(11, 2 + y - sip, 2, 1, '#ffffff'); R(11, 5 + y - sip, 2, 1, '#2f86c8'); // 물병
    } else {
      const fx = run ? [10, 9, 6, 9][f] : 10;
      O(fx, 11 + bob, 2, 4, av.shirt); R(fx, 14 + bob, 2, 1, skin);
    }
  }

  // 머리 위 불꽃 (level 1~3, 깜빡임)
  function fire(ctx, level, frame, ox, oy, s, bob = 0) {
    if (!level) return;
    const R = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(ox + x * s, oy + y * s, w * s, h * s); };
    const base = [0, 4, 6, 8][level];
    const jit = [[0, 1, 2, 1, 0, 1], [1, 2, 1, 0, 1, 2], [2, 1, 0, 1, 2, 1]][frame % 3];
    const top = 0 + bob; // 머리 꼭대기 바로 위
    for (let i = 0; i < 6; i++) {
      const hgt = Math.max(1, base - Math.abs(i - 2.5) * (level === 3 ? 0.8 : 1.1) + jit[i] - 1) | 0;
      const x = 5 + i;
      R(x, top - hgt, 1, hgt, '#e8452c');
      if (hgt > 1) R(x, top - hgt + 1, 1, hgt - 1, '#ff9a2e');
      if (hgt > 3 && i > 0 && i < 5) R(x, top - hgt + 3, 1, hgt - 3, '#ffe066');
    }
    if (level === 3) { R(7, top - 2, 2, 2, '#fffbe0'); if (frame % 2) R(4, top - base - 1, 1, 1, '#ffb347'); else R(11, top - base, 1, 1, '#ffb347'); }
  }

  // 전체 캐릭터 (자는 중이면 눕혀서 그림)
  // ox, oy: 16×24 칸 영역의 왼쪽 위
  function draw(ctx, av, pose, frame, ox, oy, s, fireLevel = 0) {
    if (pose === 'sleep') {
      // 베개 → 누운 캐릭터(머리가 왼쪽, 얼굴이 위) → Zzz
      ctx.fillStyle = '#f4f1ea'; ctx.fillRect(ox + 1 * s, oy + 20 * s, 9 * s, 4 * s);
      ctx.fillStyle = '#d9d2c3'; ctx.fillRect(ox + 1 * s, oy + 23 * s, 9 * s, 1 * s);
      ctx.save();
      ctx.translate(ox + 8 * s, oy + 12 * s);
      ctx.rotate(-Math.PI / 2);
      sprite(ctx, av, 'sleep', 0, -12 * s, -8 * s, s);
      ctx.restore();
      const z = frame % 3;
      ctx.fillStyle = '#cfe3ff';
      ctx.font = `${Math.max(10, 4 * s)}px Galmuri11, monospace`;
      ctx.fillText('z', ox + 12 * s, oy + (12 - z * 2) * s);
      if (z > 0) ctx.fillText('Z', ox + 16 * s, oy + (8 - z * 2) * s);
      return;
    }
    const bob = pose === 'run' && frame % 2 ? 1 : 0;
    sprite(ctx, av, pose, frame, ox, oy, s);
    fire(ctx, fireLevel, frame, ox, oy + (av.acc === 'crown' ? -2 * s : av.acc === 'cap' || av.acc === 'ribbon' ? -1 * s : 0), s, bob);
  }

  return { draw, SKINS, HAIRS, ACCS };
})();
