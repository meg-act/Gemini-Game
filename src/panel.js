import { NOTCH_STEPS } from './train/physics.js';

const CHANNEL_NAME = 'joban-sim-cockpit';
const SNAPSHOT_KEY = 'joban-sim-cockpit-snapshot';

const meterCanvas = document.getElementById('meter-canvas');
const meterCtx = meterCanvas.getContext('2d');
const timsCanvas = document.getElementById('tims-canvas');
const timsCtx = timsCanvas.getContext('2d');
const watchCanvas = document.getElementById('watch-canvas');
const watchCtx = watchCanvas.getContext('2d');

const connBadge = document.getElementById('conn-badge');
const connText = document.getElementById('conn-text');
const watchDigital = document.getElementById('watch-digital');
const stopStationLabel = document.getElementById('stop-station-label');
const stopDistVal = document.getElementById('stop-dist-val');
const stopPin = document.getElementById('stop-pin');

const touchNotchStrip = document.getElementById('touch-notch-strip');
const btnFullscreen = document.getElementById('btn-panel-fullscreen');
const btnEbMushroom = document.getElementById('btn-eb-mushroom');
const btnMelody = document.getElementById('pbtn-melody');
const btnDoors = document.getElementById('pbtn-doors');
const btnHorn = document.getElementById('pbtn-horn');
const btnWorld = document.getElementById('pbtn-world');

// 初期ダミー状態（メイン画面と同期され次第リアルタイム更新）
let state = {
  speedKmh: 0,
  speedLimit: 55,
  notchIndex: 5,
  notchId: 'B4',
  notchType: 'brake',
  bcPressure: 200,
  mrPressure: 830,
  lineVoltage: 1500,
  motorEffort: 0,
  distance: 0,
  gradient: 0,
  zoneLabel: '日暮里駅構内',
  serviceType: 'rapid',
  doorsOpen: false,
  nextStopName: '三河島',
  remainingMeters: 1200,
  isTheWorldActive: false,
  stations: [
    { id: 'nippori', name: '日暮里', dist: 0 },
    { id: 'mikawashima', name: '三河島', dist: 1200 },
    { id: 'minamisenju', name: '南千住', dist: 3400 },
    { id: 'kitasenju', name: '北千住', dist: 5200 },
  ],
};

let lastPacketTime = 0;

// BroadcastChannel + localStorage フォールバックによる双方向同期
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL_NAME) : null;

function sendCmd(action, payload = {}) {
  const msg = { type: 'cmd', action, ...payload };
  if (channel) channel.postMessage(msg);
}

if (channel) {
  channel.onmessage = (ev) => {
    const data = ev.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'telemetry') {
      state = { ...state, ...data };
      lastPacketTime = performance.now();
      syncDomControls();
    }
  };
  channel.postMessage({ type: 'panel-hello' });
  window.addEventListener('beforeunload', () => {
    channel.postMessage({ type: 'panel-bye' });
  });
}

try {
  const saved = localStorage.getItem(SNAPSHOT_KEY);
  if (saved) {
    state = { ...state, ...JSON.parse(saved) };
  }
} catch {
  // ignore storage errors
}

// タッチ操作用ワンハンドルマスコンノッチ列構築
const notchBtns = [];
NOTCH_STEPS.forEach((step, idx) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `t-notch type-${step.type}`;
  b.textContent = step.id;
  b.addEventListener('click', () => sendCmd('setNotch', { index: idx }));
  touchNotchStrip.appendChild(b);
  notchBtns.push(b);
});

btnEbMushroom.addEventListener('click', () => sendCmd('applyEB'));
btnHorn.addEventListener('click', () => sendCmd('horn'));
btnDoors.addEventListener('click', () => sendCmd('toggleDoors'));
btnMelody.addEventListener('click', () => sendCmd('melody'));
btnWorld.addEventListener('click', () => sendCmd('toggleWorld'));

btnFullscreen.addEventListener('click', () => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen?.().catch(() => {});
  } else {
    document.exitFullscreen?.().catch(() => {});
  }
});

// 別窓側でキーボード操作してもメイン画面へ転送
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyS' || e.code === 'ArrowDown') {
    e.preventDefault();
    sendCmd('pullHandle');
  } else if (e.code === 'KeyW' || e.code === 'ArrowUp') {
    e.preventDefault();
    sendCmd('pushHandle');
  } else if (e.code === 'Space') {
    e.preventDefault();
    sendCmd('setNeutral');
  } else if (e.code === 'Backspace' || e.code === 'KeyE') {
    e.preventDefault();
    sendCmd('applyEB');
  } else if (e.code === 'KeyH' || e.code === 'Enter') {
    e.preventDefault();
    sendCmd('horn');
  } else if (e.code === 'KeyD') {
    e.preventDefault();
    sendCmd('toggleDoors');
  } else if (e.code === 'KeyF') {
    e.preventDefault();
    sendCmd('melody');
  } else if (e.code === 'KeyT' && !e.repeat) {
    e.preventDefault();
    sendCmd('toggleWorld');
  }
});

function syncDomControls() {
  notchBtns.forEach((el, idx) => el.classList.toggle('active', idx === state.notchIndex));
  btnDoors.textContent = state.doorsOpen ? '扉開中 (閉める)' : '扉閉 (開ける)';
  btnDoors.classList.toggle('active-amber', state.doorsOpen);
  btnWorld.textContent = state.isTheWorldActive ? '時間停止中' : 'ザ・ワールド';
  btnWorld.classList.toggle('active-amber', state.isTheWorldActive);

  stopStationLabel.textContent = `次停車: ${state.nextStopName || '北千住'}`;
  const rem = state.remainingMeters ?? 0;
  if (Math.abs(rem) < 1000) {
    stopDistVal.textContent = `${rem < 0 ? '過走 ' : ''}${Math.abs(Math.round(rem))} m`;
  } else {
    stopDistVal.textContent = `${(rem / 1000).toFixed(2)} km`;
  }
  const pct = Math.min(100, Math.max(0, 50 - rem));
  stopPin.style.left = Math.abs(rem) <= 50 ? `${pct}%` : '0%';
}
syncDomControls();

function resizeCanvasToDisplay(cvs) {
  const rect = cvs.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(300, Math.round(rect.width * dpr));
  const h = Math.max(200, Math.round(rect.height * dpr));
  if (cvs.width !== w || cvs.height !== h) {
    cvs.width = w;
    cvs.height = h;
  }
  return { w, h, dpr };
}

/**
 * 左LCD：JR東日本 E531系 主メータディスプレイ描画（高DPI・実車レイアウト）
 */
function drawMeterLcd() {
  const { w, h } = resizeCanvasToDisplay(meterCanvas);
  const ctx = meterCtx;

  ctx.fillStyle = '#0c1117';
  ctx.fillRect(0, 0, w, h);

  // 背景の微細な計器パネルグリッド
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1;
  ctx.strokeRect(8, 8, w - 16, h - 16);

  // 1. 右側：160 km/h アナログアーク速度計
  const cx = w * 0.65;
  const cy = h * 0.56;
  const radius = Math.min(w * 0.31, h * 0.40);
  const startAng = Math.PI * 0.78;
  const sweepAng = Math.PI * 1.44;
  const maxSpd = 160;

  // 外周リング
  ctx.strokeStyle = '#25303d';
  ctx.lineWidth = Math.max(4, radius * 0.055);
  ctx.beginPath();
  ctx.arc(cx, cy, radius, startAng, startAng + sweepAng);
  ctx.stroke();

  // 制限速度マーカー帯
  const limFrac = Math.min(1, (state.speedLimit || 100) / maxSpd);
  const limAng = startAng + limFrac * sweepAng;
  ctx.strokeStyle = '#ff8a24';
  ctx.lineWidth = Math.max(5, radius * 0.065);
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 1.04, limAng - 0.04, limAng + 0.04);
  ctx.stroke();

  // 目盛＆数字（0〜160 km/h）
  for (let spd = 0; spd <= maxSpd; spd += 5) {
    const frac = spd / maxSpd;
    const ang = startAng + frac * sweepAng;
    const isMajor = spd % 20 === 0;
    const isMid = spd % 10 === 0;
    const rOut = radius * 0.96;
    const rIn = radius * (isMajor ? 0.80 : isMid ? 0.85 : 0.90);

    ctx.strokeStyle = isMajor ? '#ffaa44' : '#7b8a9c';
    ctx.lineWidth = isMajor ? 2.8 : 1.4;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(ang) * rIn, cy + Math.sin(ang) * rIn);
    ctx.lineTo(cx + Math.cos(ang) * rOut, cy + Math.sin(ang) * rOut);
    ctx.stroke();

    if (isMajor) {
      const rTxt = radius * 0.66;
      ctx.fillStyle = '#e5edf5';
      ctx.font = `700 ${Math.round(radius * 0.13)}px "JetBrains Mono", monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(spd), cx + Math.cos(ang) * rTxt, cy + Math.sin(ang) * rTxt);
    }
  }

  // 速度指針
  const spdFrac = Math.min(1, Math.max(0, (state.speedKmh || 0) / maxSpd));
  const needleAng = startAng + spdFrac * sweepAng;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = Math.max(3, radius * 0.038);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - Math.cos(needleAng) * radius * 0.14, cy - Math.sin(needleAng) * radius * 0.14);
  ctx.lineTo(cx + Math.cos(needleAng) * radius * 0.86, cy + Math.sin(needleAng) * radius * 0.86);
  ctx.stroke();

  ctx.fillStyle = '#dce4ec';
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 0.075, 0, Math.PI * 2);
  ctx.fill();

  // 中央下デジタル速度表示
  const overLimit = state.speedKmh > state.speedLimit + 1.5;
  ctx.fillStyle = overLimit ? '#ff5757' : '#ffffff';
  ctx.font = `700 ${Math.round(radius * 0.34)}px "JetBrains Mono", monospace`;
  ctx.textAlign = 'center';
  ctx.fillText(String(Math.round(state.speedKmh || 0)), cx, cy + radius * 0.42);
  ctx.fillStyle = '#8b99a8';
  ctx.font = `600 ${Math.round(radius * 0.12)}px "Inter", sans-serif`;
  ctx.fillText('km/h', cx, cy + radius * 0.64);

  // 2. 右上：ATS-P / 戸閉 / 制限速度 / ノッチ状態表示ランプ
  const topY = h * 0.055;
  const pillH = h * 0.088;
  const drawLamp = (x, y, lw, lh, text, activeBg, activeFg, isOn) => {
    ctx.fillStyle = isOn ? activeBg : '#182029';
    ctx.strokeStyle = isOn ? activeFg : '#384554';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x, y, lw, lh, 5);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = isOn ? activeFg : '#566474';
    const maxFontByWidth = Math.floor((lw * 0.84) / Math.max(2.6, text.length * 0.68));
    const fontPx = Math.max(10, Math.min(Math.round(lh * 0.48), maxFontByWidth));
    ctx.font = `700 ${fontPx}px "Noto Sans JP", "JetBrains Mono", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + lw * 0.5, y + lh * 0.52);
  };

  drawLamp(w * 0.43, topY, w * 0.145, pillH, 'ATS-P', '#103b2a', '#4ce69e', true);
  drawLamp(
    w * 0.59,
    topY,
    w * 0.14,
    pillH,
    state.doorsOpen ? '扉 開' : '戸 閉',
    state.doorsOpen ? '#4a2e08' : '#103b2a',
    state.doorsOpen ? '#ffbe44' : '#4ce69e',
    true
  );
  const notchCol =
    state.notchType === 'eb'
      ? ['#541216', '#ff6464']
      : state.notchType === 'brake'
        ? ['#4a2d08', '#ffad33']
        : state.notchType === 'power'
          ? ['#0d3d2c', '#3de09a']
          : ['#1f2732', '#dbe4ee'];
  drawLamp(w * 0.745, topY, w * 0.215, pillH, `ノッチ ${state.notchId}`, notchCol[0], notchCol[1], true);

  // 3. 左上：DC 1500V 架線電圧 ＆ 主回路電流ミニメーター
  drawLamp(w * 0.04, topY, w * 0.175, pillH * 0.88, 'DC 1500V', '#4d3206', '#ffbd4a', true);
  ctx.fillStyle = '#9aa8b8';
  ctx.font = `600 ${Math.round(h * 0.030)}px "JetBrains Mono", monospace`;
  ctx.textAlign = 'left';
  ctx.fillText(`電流 ${Math.round(Math.abs(state.motorEffort || 0) * 520)} A`, w * 0.23, topY + pillH * 0.45);

  // 4. 左下：縦バー式 BC（ブレーキシリンダ圧）/ MR（元空気ダメ圧）圧力計
  const barTop = h * 0.24;
  const barH = h * 0.64;
  const barW = w * 0.075;
  const drawPressureBar = (bx, label, val, maxVal, color) => {
    ctx.fillStyle = '#9aa8b8';
    ctx.font = `700 ${Math.round(h * 0.036)}px "JetBrains Mono", monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(label, bx + barW * 0.5, barTop - h * 0.03);

    ctx.fillStyle = '#151c24';
    ctx.strokeStyle = '#334050';
    ctx.lineWidth = 2;
    ctx.fillRect(bx, barTop, barW, barH);
    ctx.strokeRect(bx, barTop, barW, barH);

    const frac = Math.min(1, Math.max(0, val / maxVal));
    const fillH = barH * frac;
    ctx.fillStyle = color;
    ctx.fillRect(bx + 3, barTop + barH - fillH, barW - 6, fillH);

    ctx.fillStyle = '#edf2f7';
    ctx.font = `700 ${Math.round(h * 0.034)}px "JetBrains Mono", monospace`;
    ctx.fillText(`${Math.round(val)}`, bx + barW * 0.5, barTop + barH + h * 0.055);
  };

  // 目盛線
  for (let k = 0; k <= 1000; k += 200) {
    const yy = barTop + barH * (1 - k / 1000);
    ctx.fillStyle = '#6f7d8c';
    ctx.font = `500 ${Math.round(h * 0.028)}px "JetBrains Mono", monospace`;
    ctx.textAlign = 'right';
    ctx.fillText(String(k), w * 0.095, yy + 3);
  }
  drawPressureBar(w * 0.11, 'BC', state.bcPressure || 0, 1000, '#f5a623');
  drawPressureBar(w * 0.22, 'MR', state.mrPressure || 830, 1000, '#e6eef6');
}

/**
 * 右LCD：JR東日本 E531系 TIMS 車両情報モニタ描画
 */
function drawTimsLcd() {
  const { w, h } = resizeCanvasToDisplay(timsCanvas);
  const ctx = timsCtx;

  ctx.fillStyle = '#0c1118';
  ctx.fillRect(0, 0, w, h);

  // ヘッダー帯（常磐線ブルー）
  const hdrH = h * 0.12;
  ctx.fillStyle = '#004b93';
  ctx.fillRect(0, 0, w, hdrH);
  ctx.fillStyle = '#ffffff';
  ctx.font = `700 ${Math.round(hdrH * 0.39)}px "Noto Sans JP", sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const svcText = state.serviceType === 'special_rapid' ? '特別快速' : '快速';
  ctx.fillText(`TIMS｜常磐線 ${svcText}`, w * 0.03, hdrH * 0.52);

  ctx.textAlign = 'right';
  ctx.font = `600 ${Math.round(hdrH * 0.34)}px "JetBrains Mono", monospace`;
  ctx.fillStyle = '#b9dcff';
  ctx.fillText(`制限 ${state.speedLimit} km/h · 勾配 ${(state.gradient || 0).toFixed(1)}‰`, w * 0.97, hdrH * 0.52);

  // 中段：駅採時スタフ（路線進行テーブル）
  const tblTop = hdrH + h * 0.04;
  const rowH = h * 0.105;
  const stations = state.stations || [];
  stations.forEach((st, idx) => {
    const ry = tblTop + idx * rowH;
    const isNext = st.name === state.nextStopName;
    const passed = state.distance > st.dist + 25;
    const distDiff = st.dist - state.distance;

    ctx.fillStyle = isNext ? 'rgba(0, 114, 206, 0.32)' : idx % 2 === 0 ? 'rgba(255,255,255,0.03)' : 'transparent';
    ctx.fillRect(w * 0.03, ry, w * 0.94, rowH - 3);
    if (isNext) {
      ctx.strokeStyle = '#38a1ff';
      ctx.lineWidth = 2;
      ctx.strokeRect(w * 0.03, ry, w * 0.94, rowH - 3);
    }

    ctx.fillStyle = passed ? '#5a6675' : isNext ? '#ffffff' : '#c6d2df';
    ctx.font = `700 ${Math.round(rowH * 0.44)}px "Noto Sans JP", sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText(st.name, w * 0.06, ry + rowH * 0.5);

    ctx.font = `600 ${Math.round(rowH * 0.36)}px "JetBrains Mono", monospace`;
    ctx.fillStyle = '#8b99a8';
    ctx.fillText(`${(st.dist / 1000).toFixed(1)} km`, w * 0.34, ry + rowH * 0.5);

    ctx.textAlign = 'right';
    ctx.fillStyle = passed ? '#566270' : isNext ? '#ffcf66' : '#8ea0b2';
    const statusStr = passed
      ? '通過/発車済'
      : Math.abs(distDiff) < 1000
        ? `残 ${Math.round(distDiff)} m`
        : `残 ${(distDiff / 1000).toFixed(2)} km`;
    ctx.fillText(statusStr, w * 0.94, ry + rowH * 0.5);
  });

  // 下段：10両編成状態モニタ（力行緑・回生橙バー＋サロ2階建て＋戸閉状態）
  const cTop = h * 0.62;
  ctx.fillStyle = '#9aa8b8';
  ctx.font = `600 ${Math.round(h * 0.036)}px "Noto Sans JP", sans-serif`;
  ctx.textAlign = 'left';
  ctx.fillText(`編成状態（10両） ｜ ${state.zoneLabel || ''}`, w * 0.03, cTop);

  const carCount = 10;
  const padX = w * 0.03;
  const gap = 5;
  const cw = (w - padX * 2 - gap * (carCount - 1)) / carCount;
  const ch = h * 0.18;
  const cy = cTop + h * 0.05;

  for (let i = 0; i < carCount; i++) {
    const cx = padX + i * (cw + gap);
    const isGreen = i === 3 || i === 4;
    const isMotor = i === 1 || i === 2 || i === 6 || i === 7;

    ctx.fillStyle = isGreen ? '#123124' : '#161e28';
    ctx.strokeStyle = state.doorsOpen ? '#f5a623' : '#3a495a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(cx, cy, cw, ch, 4);
    ctx.fill();
    ctx.stroke();

    // 号車番号 & サロ表記
    ctx.fillStyle = '#dce6f0';
    ctx.font = `700 ${Math.round(ch * 0.24)}px "JetBrains Mono", monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(String(i + 1), cx + cw * 0.5, cy + ch * 0.24);
    if (isGreen) {
      ctx.fillStyle = '#5ee085';
      ctx.font = `700 ${Math.round(ch * 0.20)}px "Noto Sans JP", sans-serif`;
      ctx.fillText('G', cx + cw * 0.5, cy + ch * 0.56);
    }

    // M車力行/回生出力バー
    if (isMotor && Math.abs(state.motorEffort || 0) > 0.02) {
      const eff = Math.min(1, Math.abs(state.motorEffort));
      const bh = ch * 0.32 * eff;
      ctx.fillStyle = state.motorEffort > 0 ? '#27d980' : '#ff9f2e';
      ctx.fillRect(cx + 4, cy + ch - 4 - bh, cw - 8, bh);
    }
  }

  // 最下段：現在キロ程
  ctx.fillStyle = '#7b8a9c';
  ctx.font = `600 ${Math.round(h * 0.034)}px "JetBrains Mono", monospace`;
  ctx.textAlign = 'right';
  ctx.fillText(`現在位置 ${(Math.max(0, state.distance) / 1000).toFixed(3)} km`, w * 0.97, h * 0.94);
}

/**
 * 中央コラム：鉄道懐中時計（アナログ＋デジタル）
 */
function drawPocketWatch() {
  const ctx = watchCtx;
  const W = watchCanvas.width;
  const H = watchCanvas.height;
  const cx = W * 0.5;
  const cy = H * 0.5;
  const r = W * 0.44;

  ctx.clearRect(0, 0, W, H);

  // ステンレスケース外枠
  ctx.fillStyle = '#e8edf2';
  ctx.beginPath();
  ctx.arc(cx, cy, r + 8, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#f6f5ee';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  for (let i = 0; i < 60; i++) {
    const ang = (i / 60) * Math.PI * 2 - Math.PI / 2;
    const maj = i % 5 === 0;
    ctx.strokeStyle = '#181c22';
    ctx.lineWidth = maj ? 3.2 : 1.3;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(ang) * (r - (maj ? 14 : 7)), cy + Math.sin(ang) * (r - (maj ? 14 : 7)));
    ctx.lineTo(cx + Math.cos(ang) * (r - 3), cy + Math.sin(ang) * (r - 3));
    ctx.stroke();
  }

  const now = new Date();
  const sec = now.getSeconds() + now.getMilliseconds() / 1000;
  const min = now.getMinutes() + sec / 60;
  const hr = (now.getHours() % 12) + min / 60;

  const hand = (ang, len, width, col) => {
    ctx.strokeStyle = col;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(ang) * len, cy + Math.sin(ang) * len);
    ctx.stroke();
  };
  hand((hr / 12) * Math.PI * 2 - Math.PI / 2, r * 0.52, 5.5, '#14181e');
  hand((min / 60) * Math.PI * 2 - Math.PI / 2, r * 0.74, 3.6, '#14181e');
  hand((sec / 60) * Math.PI * 2 - Math.PI / 2, r * 0.80, 1.8, '#d92d20');

  ctx.fillStyle = '#14181e';
  ctx.beginPath();
  ctx.arc(cx, cy, 5, 0, Math.PI * 2);
  ctx.fill();

  const pad2 = (n) => String(n).padStart(2, '0');
  watchDigital.textContent = `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
}

function renderLoop() {
  requestAnimationFrame(renderLoop);

  const isConnected = performance.now() - lastPacketTime < 2500;
  connBadge.classList.toggle('connected', isConnected);
  connText.textContent = isConnected ? 'メイン画面とリアルタイム同期中' : 'メイン画面の運転開始を待機中...';

  drawMeterLcd();
  drawTimsLcd();
  drawPocketWatch();
}

renderLoop();
