/**
 * JR東日本 E233系 / E531系 運転台左画面「計器モニタ」実車準拠 高精細Canvasレンダラー
 * 添付実車写真（/home/antigravity/image.png）のレイアウト・配色・目盛・指針・表示灯を忠実再現:
 *   - 左上 2連アナログ電圧計：制御電圧計 (0〜150 V) ＆ 架線電圧計 (0〜2 kV)
 *   - 右上 2段縦書き表示灯マトリクス（P電源・パターン接近・ブレーキ動作/開放・ATS-P・故障・ATS電源/動作、三相・非常短絡・耐雪・直通予備・定速・駐車ブレーキ）
 *   - 左下 非常灯＋8段ブレーキノッチインジケータ、台形BC圧力計 (0〜800 kPa 白バー＋立体指針)、MR圧力計 (700〜1000 kPa 赤バー＋立体指針)
 *   - 右下 160 km/h アナログ速度計（内周リング＆20km/h放射スポーク＋2km/h細目盛）＋ 右下デジタル速度表示
 */

export function drawDriverMeterScreen(canvas, ctx, state, options = {}) {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min((options.win || window).devicePixelRatio || 1, 2);
  const w = Math.max(480, Math.round((rect.width || canvas.width || 960) * dpr));
  const h = Math.max(360, Math.round((rect.height || canvas.height || 720) * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }

  const dimFactor = options.dimmed ? 0.82 : 1.0;
  ctx.save();

  // 1. 実車液晶パネル特有のダークスレート背景グラデーション
  const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
  bgGrad.addColorStop(0.00, '#14181e');
  bgGrad.addColorStop(0.08, '#262c35');
  bgGrad.addColorStop(0.45, '#373f4a');
  bgGrad.addColorStop(0.85, '#313843');
  bgGrad.addColorStop(1.00, '#2a303a');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, w, h);

  // 画面外周の微細ベゼル影
  ctx.strokeStyle = '#0c0f13';
  ctx.lineWidth = Math.max(2, w * 0.004);
  ctx.strokeRect(1, 1, w - 2, h - 2);

  // 左上モニターアイコン [□]（クリックで全画面切替の目安にもなる実車UIアイコン）
  drawTopLeftMonitorIcon(ctx, w * 0.014, h * 0.016, w * 0.028, h * 0.032);

  // -------------------------------------------------------------------------
  // 2. 左上 2連アナログ電圧計：制御電圧 (0〜150 V) & 架線電圧 (0〜2 kV)
  // -------------------------------------------------------------------------
  const controlVolt = 102; // DC 100V 制御電源
  const effort = state.motorEffort || 0;
  // 力行時は架線電圧がわずかに降下、回生制動時はわずかに上昇（実車挙動）
  const lineKv = Math.max(1.25, Math.min(1.72, 1.50 - effort * 0.07));

  drawVoltmeterGauge(ctx, {
    cx: w * 0.138,
    cy: h * 0.305,
    radius: Math.min(w * 0.102, h * 0.156),
    minVal: 0,
    maxVal: 150,
    value: controlVolt,
    stepMinor: 2,
    stepMid: 10,
    majorLabels: [
      [0, '0'],
      [50, '50'],
      [100, '100'],
      [150, '150'],
    ],
    unitText: 'V',
  });

  drawVoltmeterGauge(ctx, {
    cx: w * 0.416,
    cy: h * 0.305,
    radius: Math.min(w * 0.102, h * 0.156),
    minVal: 0,
    maxVal: 2.0,
    value: lineKv,
    stepMinor: 0.1,
    stepMid: 0.5,
    majorLabels: [
      [0, '0'],
      [1.0, '1'],
      [1.5, '1.5'],
      [2.0, '2'],
    ],
    unitText: 'kV',
  });

  // -------------------------------------------------------------------------
  // 3. 右上 保安装置・ブレーキ状態 2段表示灯マトリクス
  // -------------------------------------------------------------------------
  drawAnnunciatorMatrix(ctx, w, h, state);

  // -------------------------------------------------------------------------
  // 4. 左下 非常灯・ブレーキ段表示 ＋ 台形BC圧力計 (0〜800) ＋ MR圧力計 (700〜1000)
  // -------------------------------------------------------------------------
  drawBrakeAndPressureSection(ctx, w, h, state);

  // -------------------------------------------------------------------------
  // 5. 右下 160 km/h アナログ速度計 ＋ デジタル速度表示
  // -------------------------------------------------------------------------
  drawMainSpeedometer(ctx, w, h, state);

  // 右下 輝度調整アイコン [☀]（実車液晶右下のボタン再現）
  drawBrightnessButton(ctx, w * 0.935, h * 0.918, w * 0.046, h * 0.056);

  if (dimFactor < 1.0) {
    ctx.fillStyle = `rgba(0, 0, 0, ${(1 - dimFactor).toFixed(2)})`;
    ctx.fillRect(0, 0, w, h);
  }

  ctx.restore();
}

function drawTopLeftMonitorIcon(ctx, x, y, iw, ih) {
  ctx.save();
  ctx.strokeStyle = 'rgba(215, 224, 235, 0.72)';
  ctx.lineWidth = Math.max(1.2, iw * 0.06);
  ctx.strokeRect(x, y, iw, ih);
  ctx.strokeRect(x + iw * 0.22, y + ih * 0.20, iw * 0.56, ih * 0.52);
  ctx.restore();
}

function drawBrightnessButton(ctx, x, y, bw, bh) {
  ctx.save();
  const g = ctx.createLinearGradient(x, y, x, y + bh);
  g.addColorStop(0, '#78889c');
  g.addColorStop(0.5, '#4e5c6e');
  g.addColorStop(1, '#364150');
  ctx.fillStyle = g;
  ctx.strokeStyle = '#b8c6d8';
  ctx.lineWidth = Math.max(1.5, bw * 0.04);
  ctx.beginPath();
  ctx.roundRect(x, y, bw, bh, 3);
  ctx.fill();
  ctx.stroke();

  // 太陽マーク
  const cx = x + bw * 0.5;
  const cy = y + bh * 0.5;
  const r = Math.min(bw, bh) * 0.18;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = Math.max(1.4, bw * 0.04);
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r * 1.45, cy + Math.sin(a) * r * 1.45);
    ctx.lineTo(cx + Math.cos(a) * r * 2.15, cy + Math.sin(a) * r * 2.15);
    ctx.stroke();
  }
  ctx.restore();
}

function drawVoltmeterGauge(
  ctx,
  { cx, cy, radius, minVal, maxVal, value, stepMinor, stepMid, majorLabels, unitText }
) {
  ctx.save();
  // 実車と同じ約 202° の上向き扇形アーク（左下 156° 〜 右水平 358°）
  const startAng = (156 * Math.PI) / 180;
  const endAng = (358 * Math.PI) / 180;
  const sweep = endAng - startAng;

  const majorMap = new Map();
  for (const [v, lbl] of majorLabels) {
    majorMap.set(Math.round(v * 1000), lbl);
  }

  const totalSteps = Math.round((maxVal - minVal) / stepMinor);
  for (let i = 0; i <= totalSteps; i++) {
    const val = minVal + i * stepMinor;
    const key = Math.round(val * 1000);
    const frac = (val - minVal) / (maxVal - minVal);
    const ang = startAng + frac * sweep;

    const isMajor = majorMap.has(key);
    const isMid = Math.abs(val / stepMid - Math.round(val / stepMid)) < 1e-4;

    const rIn = radius * 0.84;
    const rOut = radius * (isMajor ? 1.03 : isMid ? 0.97 : 0.92);

    ctx.strokeStyle = '#eef3f8';
    ctx.lineWidth = isMajor ? Math.max(2.2, radius * 0.028) : Math.max(1.1, radius * 0.013);
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(ang) * rIn, cy + Math.sin(ang) * rIn);
    ctx.lineTo(cx + Math.cos(ang) * rOut, cy + Math.sin(ang) * rOut);
    ctx.stroke();

    if (isMajor) {
      const lbl = majorMap.get(key);
      if (lbl) {
        const rTxt = radius * 1.21;
        ctx.fillStyle = '#f2f6fa';
        ctx.font = `italic 700 ${Math.round(radius * 0.22)}px "Inter", "Noto Sans JP", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(lbl, cx + Math.cos(ang) * rTxt, cy + Math.sin(ang) * rTxt);
      }
    }
  }

  // 単位表記 (V / kV)
  ctx.fillStyle = '#f4f7fb';
  ctx.font = `700 ${Math.round(radius * 0.30)}px "Inter", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(unitText, cx + radius * 0.68, cy + radius * 0.36);

  // 白色テーパー指針（中心ハブ付近から目盛先端までシャープに伸びる）
  const clamped = Math.max(minVal, Math.min(maxVal, value));
  const valAng = startAng + ((clamped - minVal) / (maxVal - minVal)) * sweep;
  drawTaperedWhiteNeedle(ctx, cx, cy, valAng, radius * 0.06, radius * 0.90, radius * 0.048, false);

  ctx.restore();
}

function drawTaperedWhiteNeedle(ctx, cx, cy, ang, rTail, rTip, halfBaseW, drawHub = true) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(ang);

  ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
  ctx.shadowBlur = 4;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(-rTail, -halfBaseW * 0.85);
  ctx.lineTo(rTip, -halfBaseW * 0.24);
  ctx.lineTo(rTip + halfBaseW * 0.7, 0);
  ctx.lineTo(rTip, halfBaseW * 0.24);
  ctx.lineTo(-rTail, halfBaseW * 0.85);
  ctx.closePath();
  ctx.fill();

  if (drawHub) {
    ctx.beginPath();
    ctx.arc(0, 0, halfBaseW * 2.15, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawVerticalChars(ctx, chars, cx, topY, bottomY, fontPx, color) {
  ctx.fillStyle = color;
  ctx.font = `700 ${fontPx}px "Noto Sans JP", "Inter", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const arr = Array.from(chars);
  const n = arr.length;
  const span = bottomY - topY;
  for (let i = 0; i < n; i++) {
    const yy = n === 1 ? (topY + bottomY) * 0.5 : topY + ((i + 0.5) / n) * span;
    const ch = arr[i];
    if (ch === 'ー' || ch === '-') {
      ctx.save();
      ctx.translate(cx, yy);
      ctx.rotate(Math.PI / 2);
      ctx.fillText('ー', 0, 0);
      ctx.restore();
    } else {
      ctx.fillText(ch, cx, yy);
    }
  }
}

function drawAnnunciatorMatrix(ctx, w, h, state) {
  ctx.save();
  const areaX = w * 0.605;
  const areaW = w * 0.382;

  // --- 上段：ATS・パターン表示灯（8スロット） ---
  const r1Y = h * 0.032;
  const r1H = h * 0.145;
  const slotGap1 = w * 0.004;
  const slotW1 = (areaW - slotGap1 * 7) / 8;

  const rem = state.remainingMeters ?? 9999;
  const spd = state.speedKmh || 0;
  const lim = state.speedLimit || 100;
  const patternNear = spd > lim - 2.5 || (rem > -15 && rem < 160 && spd > 28);
  const atsBrakeOn = spd > lim + 2.5;

  const row1Defs = [
    { cols: ['P電源'], state: 'green' },
    { cols: ['パターン', '接近'], state: patternNear ? 'amber' : 'off' },
    { cols: ['ブレーキ', '動作'], state: atsBrakeOn ? 'red' : 'off' },
    { cols: ['ブレーキ', '開放'], state: 'off' },
    { cols: ['ATS-P'], state: 'green' },
    { cols: ['故障'], state: 'off' },
    { cols: ['ATS電源'], state: 'off' },
    { cols: ['ATS動作'], state: 'off' },
  ];

  row1Defs.forEach((item, idx) => {
    const sx = areaX + idx * (slotW1 + slotGap1);
    if (item.state === 'green') {
      const lg = ctx.createLinearGradient(sx, r1Y, sx + slotW1, r1Y);
      lg.addColorStop(0, '#5fd64e');
      lg.addColorStop(0.5, '#96f784');
      lg.addColorStop(1, '#58cc48');
      ctx.fillStyle = lg;
      ctx.fillRect(sx, r1Y, slotW1, r1H);
      ctx.strokeStyle = '#d8ffd0';
      ctx.lineWidth = Math.max(1.5, w * 0.0018);
      ctx.strokeRect(sx + 1, r1Y + 1, slotW1 - 2, r1H - 2);
    } else if (item.state === 'amber') {
      ctx.fillStyle = '#f2a829';
      ctx.fillRect(sx, r1Y, slotW1, r1H);
      ctx.strokeStyle = '#ffe8a8';
      ctx.lineWidth = 1.6;
      ctx.strokeRect(sx + 1, r1Y + 1, slotW1 - 2, r1H - 2);
    } else if (item.state === 'red') {
      ctx.fillStyle = '#e04238';
      ctx.fillRect(sx, r1Y, slotW1, r1H);
      ctx.strokeStyle = '#ffb8b2';
      ctx.lineWidth = 1.6;
      ctx.strokeRect(sx + 1, r1Y + 1, slotW1 - 2, r1H - 2);
    } else {
      ctx.fillStyle = '#14181e';
      ctx.fillRect(sx, r1Y, slotW1, r1H);
      ctx.strokeStyle = '#2d343f';
      ctx.lineWidth = 1.2;
      ctx.strokeRect(sx, r1Y, slotW1, r1H);
    }

    const fg =
      item.state === 'green' || item.state === 'amber'
        ? '#142614'
        : item.state === 'red'
          ? '#ffffff'
          : '#e5ebf2';
    if (item.cols.length === 1) {
      const fpx = Math.max(9, Math.round(Math.min(slotW1 * 0.44, (r1H * 0.84) / item.cols[0].length)));
      drawVerticalChars(ctx, item.cols[0], sx + slotW1 * 0.5, r1Y + r1H * 0.08, r1Y + r1H * 0.92, fpx, fg);
    } else {
      const fpx = Math.max(8, Math.round(Math.min(slotW1 * 0.36, r1H * 0.18)));
      drawVerticalChars(ctx, item.cols[0], sx + slotW1 * 0.70, r1Y + r1H * 0.08, r1Y + r1H * 0.88, fpx, fg);
      drawVerticalChars(ctx, item.cols[1], sx + slotW1 * 0.30, r1Y + r1H * 0.32, r1Y + r1H * 0.90, fpx, fg);
    }
  });

  // --- 下段：スレートグレー枠内の車両状態表示灯（7スロット、右端は白枠「駐車ブレーキ」） ---
  const boxY = h * 0.192;
  const boxH = h * 0.232;
  const bg2 = ctx.createLinearGradient(areaX, boxY, areaX, boxY + boxH);
  bg2.addColorStop(0, '#4c5460');
  bg2.addColorStop(0.5, '#68717e');
  bg2.addColorStop(1, '#58616e');
  ctx.fillStyle = bg2;
  ctx.fillRect(areaX - w * 0.006, boxY, areaW + w * 0.012, boxH);

  const slotGap2 = w * 0.008;
  const slotW2 = (areaW - slotGap2 * 6) / 7;
  const r2Y = boxY + boxH * 0.16;
  const r2H = boxH * 0.72;

  const row2Defs = [
    { cols: [], blank: true },
    { cols: ['三相'] },
    { cols: ['非常短絡'] },
    { cols: ['耐雪', 'ブレーキ'] },
    { cols: ['直通予備'] },
    { cols: ['定速'] },
    { cols: ['駐車ブレーキ'], parking: true },
  ];

  row2Defs.forEach((item, idx) => {
    const sx = areaX + idx * (slotW2 + slotGap2);
    if (item.blank) {
      ctx.fillStyle = '#2c323b';
      ctx.fillRect(sx, r2Y, slotW2, r2H);
      return;
    }
    if (item.parking) {
      const py = boxY + boxH * 0.06;
      const ph = boxH * 0.86;
      ctx.fillStyle = '#2d1e22';
      ctx.fillRect(sx - 2, py, slotW2 + 4, ph);
      ctx.strokeStyle = '#eef3f8';
      ctx.lineWidth = Math.max(2, w * 0.0024);
      ctx.strokeRect(sx - 2, py, slotW2 + 4, ph);
      const fpx = Math.max(10, Math.round(Math.min(slotW2 * 0.46, ph * 0.135)));
      drawVerticalChars(ctx, '駐車ブレーキ', sx + slotW2 * 0.5, py + ph * 0.07, py + ph * 0.93, fpx, '#eef3f8');
      return;
    }

    ctx.fillStyle = '#474f5a';
    ctx.fillRect(sx, r2Y, slotW2, r2H);
    ctx.strokeStyle = 'rgba(30, 35, 42, 0.55)';
    ctx.lineWidth = 1;
    ctx.strokeRect(sx, r2Y, slotW2, r2H);

    if (item.cols.length === 1) {
      const txt = item.cols[0];
      const fpx = Math.max(9, Math.round(Math.min(slotW2 * 0.44, (r2H * 0.82) / Math.max(2.3, txt.length))));
      drawVerticalChars(ctx, txt, sx + slotW2 * 0.5, r2Y + r2H * 0.10, r2Y + r2H * 0.90, fpx, '#eef3f8');
    } else {
      const fpx = Math.max(8, Math.round(Math.min(slotW2 * 0.36, r2H * 0.18)));
      drawVerticalChars(ctx, item.cols[0], sx + slotW2 * 0.68, r2Y + r2H * 0.14, r2Y + r2H * 0.62, fpx, '#eef3f8');
      drawVerticalChars(ctx, item.cols[1], sx + slotW2 * 0.32, r2Y + r2H * 0.14, r2Y + r2H * 0.90, fpx, '#eef3f8');
    }
  });

  ctx.restore();
}

function drawBrakeAndPressureSection(ctx, w, h, state) {
  ctx.save();

  const topY = h * 0.478;
  const botY = h * 0.928;
  const barH = botY - topY;

  // --- 4A. 左端：「非常」ランプ ＆ B8〜B1 ブレーキ段スラントラダー ---
  const ebLampX = w * 0.045;
  const ebLampY = h * 0.462;
  const ebLampW = w * 0.088;
  const ebLampH = h * 0.064;
  const isEB = state.notchType === 'eb' || state.notchId === 'EB';

  if (isEB) {
    ctx.shadowColor = 'rgba(255, 110, 95, 0.65)';
    ctx.shadowBlur = 10;
    ctx.fillStyle = '#fff5f3';
    ctx.fillRect(ebLampX, ebLampY, ebLampW, ebLampH);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#ef7b70';
    ctx.lineWidth = Math.max(2.5, w * 0.003);
    ctx.strokeRect(ebLampX, ebLampY, ebLampW, ebLampH);
    ctx.fillStyle = '#c6463d';
  } else {
    ctx.fillStyle = '#252a32';
    ctx.fillRect(ebLampX, ebLampY, ebLampW, ebLampH);
    ctx.strokeStyle = '#3d4552';
    ctx.lineWidth = 1.6;
    ctx.strokeRect(ebLampX, ebLampY, ebLampW, ebLampH);
    ctx.fillStyle = '#6c7684';
  }
  ctx.font = `700 ${Math.round(ebLampH * 0.50)}px "Noto Sans JP", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('非常', ebLampX + ebLampW * 0.5, ebLampY + ebLampH * 0.52);

  // B8(上) 〜 B1(下) の8段スラントインジケータ（右端がBC台形の左斜辺に沿う実車デザイン！）
  const notchIdx = state.notchIndex ?? 5; // 0=EB, 1=B8 .. 8=B1, 9=N
  const activeBrakeLevel = notchIdx === 0 ? 8 : notchIdx <= 8 ? 9 - notchIdx : 0;
  const ladTop = h * 0.562;
  const ladBot = botY;
  const ladSpan = ladBot - ladTop;
  const segCount = 8;
  const segGap = ladSpan * 0.036;
  const segH = (ladSpan - segGap * (segCount - 1)) / segCount;

  for (let s = 0; s < segCount; s++) {
    // s=0 が最上段 (B8), s=7 が最下段 (B1)
    const levelForSeg = 8 - s;
    const isLit = activeBrakeLevel >= levelForSeg && !isEB;
    const sy0 = ladTop + s * (segH + segGap);
    const sy1 = sy0 + segH;
    const t0 = s / segCount;
    const t1 = (s + 0.82) / segCount;
    const lx0 = w * (0.048 + t0 * 0.034);
    const lx1 = w * (0.048 + t1 * 0.034);
    const rx = w * 0.132;

    ctx.fillStyle = isLit ? '#ffae38' : '#242931';
    ctx.beginPath();
    ctx.moveTo(lx0, sy0);
    ctx.lineTo(rx, sy0);
    ctx.lineTo(rx, sy1);
    ctx.lineTo(lx1, sy1);
    ctx.closePath();
    ctx.fill();
  }

  // --- 4B. 台形 BC ブレーキシリンダ圧力計 (0〜800 kPa) ---
  const bcRightX = w * 0.296;
  const bcTopLeftX = w * 0.214;
  const bcBotLeftX = w * 0.214; // 左辺は垂直、右辺が上に向かって広がる台形！（image.png 準拠：左垂直・右斜辺！）
  // image.png を確認：左辺が垂直で、右辺が下(狭い)→上(広い)へ斜めに広がる台形！
  const bcLeftX = w * 0.218;
  const bcBotRightX = w * 0.262;
  const bcTopRightX = w * 0.312;
  const bcRightAtFrac = (f) => bcBotRightX + (bcTopRightX - bcBotRightX) * f;

  // ヘッダーラベル "BC   kPa"
  ctx.fillStyle = '#f2f6fa';
  ctx.font = `700 ${Math.round(h * 0.036)}px "Inter", sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText('BC', (bcLeftX + bcTopRightX) * 0.5 - w * 0.005, topY - h * 0.034);
  ctx.font = `italic 700 ${Math.round(h * 0.028)}px "Inter", sans-serif`;
  ctx.fillText('kPa', w * 0.362, topY - h * 0.032);

  // 台形背景ウェル
  ctx.fillStyle = '#252b33';
  ctx.beginPath();
  ctx.moveTo(bcLeftX, topY);
  ctx.lineTo(bcTopRightX, topY);
  ctx.lineTo(bcBotRightX, botY);
  ctx.lineTo(bcLeftX, botY);
  ctx.closePath();
  ctx.fill();

  // 0, 200, 400, 600, 800 kPa の白横基準線（image.png 通り台形左端〜右目盛コームまで貫通）
  const bcScaleX = w * 0.336;
  ctx.strokeStyle = 'rgba(235, 242, 250, 0.78)';
  ctx.lineWidth = 1.6;
  for (const refKpa of [0, 200, 400, 600, 800]) {
    const f = refKpa / 800;
    const yy = botY - barH * f;
    ctx.beginPath();
    ctx.moveTo(bcLeftX, yy);
    ctx.lineTo(bcScaleX, yy);
    ctx.stroke();
  }

  // BC 白塗りバー本体 + 上端の右向き五角形ポインタキャップ
  const bcVal = Math.max(0, Math.min(800, state.bcPressure || 0));
  const bcFrac = bcVal / 800;
  if (bcFrac > 0.002) {
    const fillTopY = botY - barH * bcFrac;
    const rTop = bcRightAtFrac(bcFrac);
    ctx.fillStyle = '#f4f7fb';
    ctx.beginPath();
    ctx.moveTo(bcLeftX, fillTopY);
    ctx.lineTo(rTop, fillTopY);
    ctx.lineTo(bcBotRightX, botY);
    ctx.lineTo(bcLeftX, botY);
    ctx.closePath();
    ctx.fill();

    // 台形内に重なる 200 / 400 / 600 基準線のグレー細線（白バー上でも目盛が読める実車表現）
    ctx.strokeStyle = 'rgba(130, 142, 156, 0.65)';
    ctx.lineWidth = 1.3;
    for (const refKpa of [200, 400, 600]) {
      if (bcVal > refKpa + 8) {
        const f = refKpa / 800;
        const yy = botY - barH * f;
        ctx.beginPath();
        ctx.moveTo(bcLeftX, yy);
        ctx.lineTo(bcRightAtFrac(f), yy);
        ctx.stroke();
      }
    }

    // 立体感のある白い水平ポインタバー（image.png の特徴的な白い矢羽根キャップ）
    const capH = h * 0.021;
    const capTipX = w * 0.324;
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#96a2b2';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(bcLeftX - 2, fillTopY - capH * 0.5);
    ctx.lineTo(capTipX - capH * 0.65, fillTopY - capH * 0.5);
    ctx.lineTo(capTipX, fillTopY);
    ctx.lineTo(capTipX - capH * 0.65, fillTopY + capH * 0.5);
    ctx.lineTo(bcLeftX - 2, fillTopY + capH * 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  // BC 右側目盛コーム (0〜800, 20kPa刻み)
  for (let k = 0; k <= 800; k += 20) {
    const f = k / 800;
    const yy = botY - barH * f;
    const isMaj = k % 200 === 0;
    const isHundred = k % 100 === 0;
    const tLeft = isMaj ? bcScaleX - w * 0.024 : isHundred ? bcScaleX - w * 0.014 : bcScaleX - w * 0.010;
    ctx.strokeStyle = '#eef3f8';
    ctx.lineWidth = isMaj ? 2.4 : 1.3;
    ctx.beginPath();
    ctx.moveTo(tLeft, yy);
    ctx.lineTo(bcScaleX, yy);
    ctx.stroke();

    if (isMaj) {
      ctx.fillStyle = '#f2f6fa';
      ctx.font = `italic 700 ${Math.round(h * 0.028)}px "Inter", sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(k), bcScaleX + w * 0.005, yy);
    }
  }

  // --- 4C. MR 元空気ダメ圧力計 (700〜1000 kPa、赤バー＋立体ポインタ) ---
  const mrLeftX = w * 0.405;
  const mrW = w * 0.044;
  const mrRightX = mrLeftX + mrW;

  ctx.fillStyle = '#f2f6fa';
  ctx.font = `700 ${Math.round(h * 0.036)}px "Inter", sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText('MR', mrLeftX + mrW * 0.5, topY - h * 0.034);
  ctx.font = `italic 700 ${Math.round(h * 0.028)}px "Inter", sans-serif`;
  ctx.fillText('kPa', w * 0.494, topY - h * 0.032);

  // MR 黒背景ウェル
  ctx.fillStyle = '#14181e';
  ctx.fillRect(mrLeftX, topY, mrW, barH);

  // MR コーラルレッドバー（780 kPa 付近に赤ポインタ、現在MR圧まで赤グラデ柱 — image.png 再現！）
  const mrVal = Math.max(700, Math.min(1000, state.mrPressure || 865));
  const mrTopFrac = (mrVal - 700) / 300;
  const mrBaseFrac = (780 - 700) / 300; // 780 kPa 下限ライン
  const mrFillTopY = botY - barH * mrTopFrac;
  const mrBaseY = botY - barH * mrBaseFrac;

  const mrGrad = ctx.createLinearGradient(mrLeftX, 0, mrRightX, 0);
  mrGrad.addColorStop(0, '#ff6860');
  mrGrad.addColorStop(0.45, '#ff8f88');
  mrGrad.addColorStop(1, '#dc4842');
  ctx.fillStyle = mrGrad;
  const colTop = Math.min(mrFillTopY, mrBaseY);
  const colBot = Math.max(mrFillTopY, mrBaseY);
  ctx.fillRect(mrLeftX + 1, colTop, mrW - 2, Math.max(4, colBot - colTop));

  // 800 / 900 kPa 白基準線
  ctx.strokeStyle = 'rgba(240, 245, 250, 0.82)';
  ctx.lineWidth = 1.5;
  for (const refMr of [800, 900]) {
    const yy = botY - barH * ((refMr - 700) / 300);
    ctx.beginPath();
    ctx.moveTo(mrLeftX, yy);
    ctx.lineTo(mrRightX + w * 0.012, yy);
    ctx.stroke();
  }

  // MR 780kPa 下限ポインタキャップ（赤の立体矢羽根）
  const mCapH = h * 0.020;
  const mTipX = mrRightX + w * 0.012;
  ctx.fillStyle = '#ff6b63';
  ctx.strokeStyle = '#a82e28';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(mrLeftX - 1, mrBaseY - mCapH * 0.5);
  ctx.lineTo(mTipX - mCapH * 0.6, mrBaseY - mCapH * 0.5);
  ctx.lineTo(mTipX, mrBaseY);
  ctx.lineTo(mTipX - mCapH * 0.6, mrBaseY + mCapH * 0.5);
  ctx.lineTo(mrLeftX - 1, mrBaseY + mCapH * 0.5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // MR 右側目盛 (700〜1000, 20kPa刻み)
  const mrScaleX = mrRightX + w * 0.022;
  for (let k = 700; k <= 1000; k += 20) {
    const f = (k - 700) / 300;
    const yy = botY - barH * f;
    const isMaj = k % 100 === 0;
    ctx.strokeStyle = '#eef3f8';
    ctx.lineWidth = isMaj ? 2.4 : 1.3;
    ctx.beginPath();
    ctx.moveTo(isMaj ? mrRightX + 2 : mrScaleX - w * 0.012, yy);
    ctx.lineTo(mrScaleX, yy);
    ctx.stroke();

    if (isMaj) {
      ctx.fillStyle = '#f2f6fa';
      ctx.font = `italic 700 ${Math.round(h * 0.028)}px "Inter", sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(k), mrScaleX + w * 0.005, yy);
    }
  }

  ctx.restore();
}

function drawMainSpeedometer(ctx, w, h, state) {
  ctx.save();

  const cx = w * 0.752;
  const cy = h * 0.735;
  const radius = Math.min(w * 0.165, h * 0.228);
  const maxSpd = 160;

  // 実車と同じ 240° スイープ（0 km/h = 150° 左下、80 km/h = 270° 真上12時、160 km/h = 390° 右下！）
  const startAng = (150 * Math.PI) / 180;
  const sweepAng = (240 * Math.PI) / 180;
  const endAng = startAng + sweepAng;

  // 1. 内側の漆黒ダイヤル円盤（下側 30°〜150° は切り欠いてスレート背景とデジタル速度計を見せる！）
  ctx.fillStyle = '#11151a';
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, radius * 0.89, startAng, endAng, false);
  ctx.closePath();
  ctx.fill();

  // 2. 内周の白い同心円アーク ＆ 0〜160 (20km/h ごと) の白い放射スポーク線（image.png 特有の造形！）
  const rInnerRing = radius * 0.46;
  ctx.strokeStyle = 'rgba(225, 234, 244, 0.80)';
  ctx.lineWidth = Math.max(1.4, radius * 0.011);
  ctx.beginPath();
  ctx.arc(cx, cy, rInnerRing, startAng, endAng, false);
  ctx.stroke();

  for (let spd = 0; spd <= 160; spd += 20) {
    const ang = startAng + (spd / maxSpd) * sweepAng;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(ang) * rInnerRing, cy + Math.sin(ang) * rInnerRing);
    ctx.lineTo(cx + Math.cos(ang) * (radius * 0.89), cy + Math.sin(ang) * (radius * 0.89));
    ctx.stroke();
  }

  // 3. 2 km/h 刻みの精密白目盛 ＆ 外周の斜体太字速度数字 (0, 20, 40, 60, 80, 100, 120, 140, 160)
  for (let spd = 0; spd <= maxSpd; spd += 2) {
    const frac = spd / maxSpd;
    const ang = startAng + frac * sweepAng;
    const isMajor = spd % 20 === 0;
    const isMid = spd % 10 === 0;

    const rIn = radius * 0.90;
    const rOut = radius * (isMajor ? 1.05 : isMid ? 1.00 : 0.96);

    ctx.strokeStyle = '#f2f6fa';
    ctx.lineWidth = isMajor ? Math.max(2.6, radius * 0.022) : Math.max(1.2, radius * 0.010);
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(ang) * rIn, cy + Math.sin(ang) * rIn);
    ctx.lineTo(cx + Math.cos(ang) * rOut, cy + Math.sin(ang) * rOut);
    ctx.stroke();

    if (isMajor) {
      const rTxt = radius * 1.21;
      ctx.fillStyle = '#f4f8fc';
      ctx.font = `italic 700 ${Math.round(radius * 0.19)}px "Inter", "Noto Sans JP", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(spd), cx + Math.cos(ang) * rTxt, cy + Math.sin(ang) * rTxt);
    }
  }

  // 制限速度の控えめな赤橙インデックス三角（運転しやすさのため外周に小さく表示）
  if (state.speedLimit) {
    const limFrac = Math.max(0, Math.min(1, state.speedLimit / maxSpd));
    const limAng = startAng + limFrac * sweepAng;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(limAng);
    ctx.fillStyle = '#ff6a3d';
    ctx.beginPath();
    ctx.moveTo(radius * 1.06, 0);
    ctx.lineTo(radius * 1.13, -radius * 0.035);
    ctx.lineTo(radius * 1.13, radius * 0.035);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // 4. 白色速度指針 ＋ 中央丸ボス ＋ 短いカウンターウェイト尻尾（image.png 完全再現！）
  const curSpd = Math.max(0, Math.min(maxSpd, state.speedKmh || 0));
  const needleAng = startAng + (curSpd / maxSpd) * sweepAng;
  drawTaperedWhiteNeedle(ctx, cx, cy, needleAng, radius * 0.14, radius * 0.93, radius * 0.045, true);

  // 5. 右下デジタル速度表示（斜体極太白数字 ＋ "km/h"）
  const digVal = String(Math.round(state.speedKmh || 0));
  ctx.fillStyle = '#ffffff';
  ctx.font = `italic 800 ${Math.round(radius * 0.56)}px "Inter", "JetBrains Mono", sans-serif`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(digVal, cx + radius * 0.44, cy + radius * 0.88);

  ctx.font = `italic 700 ${Math.round(radius * 0.18)}px "Inter", sans-serif`;
  ctx.textAlign = 'left';
  ctx.fillText('km/h', cx + radius * 0.49, cy + radius * 0.86);

  ctx.restore();
}
