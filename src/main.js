import * as THREE from 'three';
import { RouteGeometry, STATIONS } from './world/routeData.js';
import {
  createBallastTextures,
  createConcreteTextures,
  createPlatformSurfaceTexture,
  createBuildingFacadeVariants,
  createWaterNormalTexture,
} from './world/textures.js';
import { AtmosphereAndPost } from './world/skyAndPost.js';
import { TrackSystem } from './world/trackBuilder.js';
import { ScenerySystem } from './world/sceneryBuilder.js';
import { TrainPhysics, NOTCH_STEPS, NEUTRAL_INDEX } from './train/physics.js';
import { DriverCabView } from './train/cabView.js';
import { TrainSoundEngine } from './audio/soundEngine.js';

// --- DOM 要素参照 ---
const canvas = document.getElementById('sim-canvas');
const startOverlay = document.getElementById('start-overlay');
const btnStartDrive = document.getElementById('btn-start-drive');
const hudLayer = document.getElementById('hud-layer');
const btnRestoreHud = document.getElementById('btn-restore-hud');
const statusToast = document.getElementById('status-toast');

const hudLineBadge = document.getElementById('hud-line-badge');
const hudZoneLabel = document.getElementById('hud-zone-label');
const hudJumpSelect = document.getElementById('hud-jump-select');
const hudAtmosphereSelect = document.getElementById('hud-atmosphere-select');
const btnToggleWorld = document.getElementById('btn-toggle-world');
const btnToggleView = document.getElementById('btn-toggle-view');
const btnPopoutPanel = document.getElementById('btn-popout-panel');
const btnToggleMute = document.getElementById('btn-toggle-mute');
const btnToggleHud = document.getElementById('btn-toggle-hud');
const hudBottombar = document.getElementById('hud-bottombar');
const theWorldBanner = document.getElementById('the-world-banner');
const worldSpeedText = document.getElementById('world-speed-text');

const hudNotchText = document.getElementById('hud-notch-text');
const notchLadder = document.getElementById('notch-ladder');
const btnHorn = document.getElementById('btn-horn');
const btnMelody = document.getElementById('btn-melody');
const btnDoors = document.getElementById('btn-doors');

const hudNextStation = document.getElementById('hud-next-station');
const hudNextDist = document.getElementById('hud-next-dist');
const stopBarWrap = document.getElementById('stop-bar-wrap');
const stopBarMarker = document.getElementById('stop-bar-marker');
const hudSpeed = document.getElementById('hud-speed');
const hudLimit = document.getElementById('hud-limit');
const hudBc = document.getElementById('hud-bc');
const hudGrade = document.getElementById('hud-grade');

// --- Three.js レンダラー・シーン・カメラ初期化 ---
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: false,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.12,
  4500
);

// --- PBR テクスチャ & 路線・風景・車両システム構築 ---
const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
const textures = {
  ballast: createBallastTextures(maxAniso),
  concrete: createConcreteTextures(maxAniso),
  platformTop: createPlatformSurfaceTexture(maxAniso),
  buildingFacades: createBuildingFacadeVariants(Math.min(4, maxAniso)),
  waterNormal: createWaterNormalTexture(),
};

const route = new RouteGeometry();
const atmosphere = new AtmosphereAndPost(renderer, scene, camera);
const trackSystem = new TrackSystem(scene, route, textures);
const scenery = new ScenerySystem(scene, route, textures);

atmosphere.onPresetChange((preset) => {
  scenery.setWindowGlowMultiplier(preset.windowGlowMultiplier);
});
scenery.setWindowGlowMultiplier(atmosphere.currentPreset.windowGlowMultiplier);

const physics = new TrainPhysics(route);
const cabView = new DriverCabView(scene, camera);
const sound = new TrainSoundEngine();

// --- アプリケーション状態 ---
let isDrivingStarted = false;
let isHudVisible = true;
let wasMovingSinceStop = false;
let toastTimeoutId = null;

function showToast(message, durationMs = 4200) {
  statusToast.textContent = message;
  statusToast.classList.remove('hidden');
  if (toastTimeoutId) clearTimeout(toastTimeoutId);
  toastTimeoutId = setTimeout(() => {
    statusToast.classList.add('hidden');
  }, durationMs);
}

function getNotchClickKind(notch) {
  if (!notch) return 'normal';
  if (notch.type === 'eb') return 'eb';
  if (notch.type === 'neutral') return 'neutral';
  return 'normal';
}

// --- ノッチラダー UI 構築（マウスクリックでも直接ノッチ投入可能） ---
const notchChipEls = [];
NOTCH_STEPS.forEach((step, index) => {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `notch-chip type-${step.type}`;
  btn.textContent = step.id;
  btn.title = `${step.label}`;
  btn.addEventListener('click', () => {
    sound.init();
    if (physics.doorsOpen && index > NEUTRAL_INDEX) {
      showToast('扉が開いています。Dキーまたは「扉閉」ボタンで扉を閉めてください。', 2800);
      return;
    }
    if (physics.notchIndex !== index) {
      physics.notchIndex = index;
      sound.playNotchClick(getNotchClickKind(physics.currentNotch));
      syncNotchHud();
      broadcastCockpitTelemetry(null, true);
    }
  });
  notchLadder.appendChild(btn);
  notchChipEls.push(btn);
});

function syncNotchHud() {
  const notch = physics.currentNotch;
  hudNotchText.textContent = notch.id;
  notchChipEls.forEach((el, idx) => {
    el.classList.toggle('active', idx === physics.notchIndex);
  });
}
syncNotchHud();

function syncDoorButton() {
  btnDoors.textContent = physics.doorsOpen ? '扉開中' : '扉閉';
  btnDoors.classList.toggle('doors-open', physics.doorsOpen);
}
syncDoorButton();

// --- スタートオーバーレイの設定ボタン ---
document.getElementById('service-select').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-service]');
  if (!btn) return;
  document.querySelectorAll('#service-select .seg-btn').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');

  const svc = btn.dataset.service;
  physics.setServiceType(svc);
  hudLineBadge.textContent = svc === 'special_rapid' ? 'JJ 特快' : 'JJ 快速';
  hudLineBadge.classList.toggle('special', svc === 'special_rapid');
});

document.getElementById('time-select').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-preset]');
  if (!btn) return;
  document.querySelectorAll('#time-select .seg-btn').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');

  const preset = btn.dataset.preset;
  atmosphere.applyPreset(preset);
  hudAtmosphereSelect.value = preset;
});

function startDrivingSession() {
  if (isDrivingStarted) return;
  isDrivingStarted = true;
  sound.init();
  startOverlay.classList.add('hidden');
  hudLayer.classList.remove('hidden');
  showToast('日暮里駅 4番線 — ブレーキを緩め、P1〜P5で発車してください（S / ↓キー）', 4800);
}

btnStartDrive.addEventListener('click', startDrivingSession);

// --- ザ・ワールド（時間停止＋自由スペクテイターカメラ）状態 ---
let isTheWorldActive = false;
let specYaw = 0;
let specPitch = 0;
let specSpeed = 16;
let frozenElapsed = 0;
const heldKeys = new Set();
const _specEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const _specFwd = new THREE.Vector3();
const _specRight = new THREE.Vector3();
const _specMove = new THREE.Vector3();
const _specWorldPos = new THREE.Vector3();
const _specWorldQuat = new THREE.Quaternion();
const _specWorldUp = new THREE.Vector3(0, 1, 0);

function syncWorldSpeedHud() {
  if (worldSpeedText) worldSpeedText.textContent = String(Math.round(specSpeed));
}

function setTheWorld(active, { silentToast = false } = {}) {
  if (active === isTheWorldActive) return;
  isTheWorldActive = active;
  heldKeys.clear();
  sound.init();

  if (active) {
    frozenElapsed = clock.elapsedTime;
    scene.updateMatrixWorld(true);
    camera.getWorldPosition(_specWorldPos);
    camera.getWorldQuaternion(_specWorldQuat);

    // 運転席マウントから切り離してワールド自由カメラへ（一切ジャンプせずシームレス移行）
    scene.add(camera);
    camera.position.copy(_specWorldPos);
    _specEuler.setFromQuaternion(_specWorldQuat, 'YXZ');
    specYaw = _specEuler.y;
    specPitch = THREE.MathUtils.clamp(_specEuler.x, -1.52, 1.52);
    camera.rotation.order = 'YXZ';
    camera.rotation.set(specPitch, specYaw, 0);

    cabView.cabInterior.visible = false;
    sound.setTimeStopped(true);

    btnToggleWorld.classList.add('active');
    btnToggleWorld.textContent = '時間停止中 (Tで解除)';
    hudBottombar.classList.add('hidden');
    theWorldBanner.classList.remove('hidden');
    syncWorldSpeedHud();
    if (!silentToast) {
      showToast('ザ・ワールド発動 — 時よ止まれ！（WASD移動・E/Q昇降・ドラッグ視点・Tで解除）', 4200);
    }
  } else {
    cabView.eyeHolder.add(camera);
    camera.position.set(0, 0, 0);
    camera.rotation.set(0, 0, 0);
    cabView._applyViewMode();
    sound.setTimeStopped(false);

    btnToggleWorld.classList.remove('active');
    btnToggleWorld.textContent = 'ザ・ワールド (T)';
    theWorldBanner.classList.add('hidden');
    hudBottombar.classList.remove('hidden');
    clock.getDelta();
    if (!silentToast) {
      showToast('時は動き出す — 運転席へ復帰しました', 2400);
    }
  }
  broadcastCockpitTelemetry(null, true);
}

btnToggleWorld.addEventListener('click', () => {
  setTheWorld(!isTheWorldActive);
  btnToggleWorld.blur();
});

// --- 別ウィンドウ計器パネル（SideCar / サブディスプレイ対応）双方向同期 ---
const COCKPIT_CHANNEL_NAME = 'joban-sim-cockpit';
const COCKPIT_SNAPSHOT_KEY = 'joban-sim-cockpit-snapshot';
const cockpitChannel =
  typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(COCKPIT_CHANNEL_NAME) : null;
let panelPopupWindow = null;
let isPanelConnected = false;
let lastPanelBroadcastMs = 0;
let lastPanelStorageMs = 0;
const panelMessageTargets = new Set();

function sendCockpitMessage(msg) {
  if (cockpitChannel) {
    try {
      cockpitChannel.postMessage(msg);
    } catch {
      // ignore channel errors
    }
  }
  for (const win of Array.from(panelMessageTargets)) {
    if (!win || win.closed) {
      panelMessageTargets.delete(win);
      continue;
    }
    try {
      win.postMessage(msg, '*');
    } catch {
      // ignore cross-window postMessage errors
    }
  }
}

function syncPanelButton() {
  if (!btnPopoutPanel) return;
  btnPopoutPanel.classList.toggle('panel-connected', isPanelConnected);
  btnPopoutPanel.textContent = isPanelConnected ? '別窓計器: 同期中 (P)' : '別窓計器 (P)';
}

function buildCockpitTelemetry(physState) {
  const st = physState || {
    distance: physics.distance,
    speedKmh: physics.speedKmh,
    bcPressure: physics.bcPressure,
    mrPressure: physics.mrPressure,
    motorEffort: physics.motorEffort,
    frame: route.getFrameAt(physics.distance),
    zone: route.getTrackZoneAt(physics.distance),
  };
  const nextStop = physics.getNextScheduledStop();
  const remainingMeters = nextStop ? nextStop.stopDistance - st.distance : 0;
  const speedLimitObj = route.getSpeedLimitAt(st.distance);
  const notch = physics.currentNotch;
  const scheduled = physics.getScheduledStations();

  return {
    type: 'telemetry',
    speedKmh: st.speedKmh,
    speedLimit: speedLimitObj.limit,
    notchIndex: physics.notchIndex,
    notchId: notch.id,
    notchType: notch.type,
    bcPressure: st.bcPressure,
    mrPressure: st.mrPressure ?? 840,
    lineVoltage: 1500,
    motorEffort: st.motorEffort ?? 0,
    distance: st.distance,
    gradient: st.frame ? st.frame.gradient : 0,
    zoneLabel: st.zone ? st.zone.label : '',
    serviceType: physics.serviceType,
    doorsOpen: physics.doorsOpen,
    nextStopName: nextStop ? nextStop.nameKanji : '北千住',
    remainingMeters,
    isTheWorldActive,
    stations: scheduled.map((s) => ({
      id: s.id,
      name: s.nameKanji,
      dist: s.stopDistance,
    })),
  };
}

function broadcastCockpitTelemetry(physState = null, force = false) {
  const now = performance.now();
  if (!force && now - lastPanelBroadcastMs < 32) return;
  lastPanelBroadcastMs = now;

  if (panelPopupWindow && panelPopupWindow.closed) {
    panelMessageTargets.delete(panelPopupWindow);
    panelPopupWindow = null;
    if (isPanelConnected) {
      isPanelConnected = false;
      syncPanelButton();
    }
  }

  const payload = buildCockpitTelemetry(physState);
  sendCockpitMessage(payload);

  if (force || now - lastPanelStorageMs >= 250) {
    lastPanelStorageMs = now;
    try {
      localStorage.setItem(COCKPIT_SNAPSHOT_KEY, JSON.stringify(payload));
    } catch {
      // ignore storage quota errors
    }
  }
}

/**
 * 指定ウィンドウの document 内へ E531 グラスコックピット計器パネルを直接構築・マウントする
 * （about:blank ポップアップへの即時注入 ＆ ?panel=1 単独計器モードの両方で共用！）
 */
function mountCockpitPanelIntoDocument(doc, win) {
  doc.title = 'E531系 グラスコックピット計器パネル | SideCar / 別窓ディスプレイ';
  doc.head.innerHTML = `
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no" />
    <title>E531系 グラスコックピット計器パネル | SideCar / 別窓ディスプレイ</title>
    <style>
      :root {
        --console-bg: #15181d;
        --bezel-border: #323a44;
        --lcd-bg: #0c1015;
        --text-main: #edf2f7;
        --text-dim: #8b97a6;
        --amber: #f5a623;
        --blue: #0072ce;
        --mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
        --sans: 'Noto Sans JP', 'Inter', system-ui, -apple-system, sans-serif;
      }
      * { box-sizing: border-box; margin: 0; padding: 0; user-select: none; -webkit-user-select: none; }
      html, body { width: 100%; height: 100%; background: var(--console-bg); color: var(--text-main); font-family: var(--sans); overflow: hidden; }
      .cockpit-shell {
        width: 100%; height: 100%; display: flex; flex-direction: column;
        padding: 10px 14px 12px; gap: 10px;
        background: radial-gradient(circle at 50% 0%, #242a33 0%, #12151a 68%);
      }
      .panel-topbar {
        display: flex; align-items: center; justify-content: space-between; gap: 12px;
        padding: 4px 10px; background: rgba(10, 13, 18, 0.78);
        border: 1px solid var(--bezel-border); border-radius: 8px; flex-shrink: 0;
      }
      .panel-brand { display: flex; align-items: center; gap: 10px; font-size: 0.82rem; font-weight: 700; letter-spacing: 0.04em; }
      .series-pill { padding: 2px 8px; border-radius: 4px; background: var(--blue); color: #fff; font-family: var(--mono); font-size: 0.74rem; }
      .conn-badge { display: inline-flex; align-items: center; gap: 6px; font-size: 0.75rem; color: var(--amber); font-family: var(--mono); }
      .conn-badge.connected { color: #4ce69e; }
      .conn-dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; box-shadow: 0 0 8px currentColor; }
      .top-btn {
        padding: 4px 11px; background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.18); border-radius: 6px;
        color: var(--text-main); font-family: var(--sans); font-size: 0.76rem; cursor: pointer;
      }
      .top-btn:hover { background: rgba(255, 255, 255, 0.16); }
      .desk-cluster {
        flex: 1; min-height: 0; display: grid;
        grid-template-columns: 1.12fr 0.44fr 1.12fr; gap: 12px; align-items: stretch;
      }
      .lcd-bezel {
        background: linear-gradient(180deg, #272d36 0%, #1b2027 100%);
        border: 2px solid #38414d; border-radius: 12px; padding: 10px;
        display: flex; flex-direction: column;
        box-shadow: inset 0 2px 6px rgba(255, 255, 255, 0.06), 0 8px 24px rgba(0, 0, 0, 0.55);
        min-height: 0;
      }
      .lcd-screen {
        flex: 1; min-height: 0; background: var(--lcd-bg);
        border: 2px solid #06080b; border-radius: 7px; overflow: hidden; position: relative;
      }
      .lcd-screen canvas { width: 100%; height: 100%; display: block; }
      .center-column {
        background: linear-gradient(180deg, #232830 0%, #171b21 100%);
        border: 2px solid #353d48; border-radius: 12px; padding: 10px 8px;
        display: flex; flex-direction: column; align-items: center; justify-content: space-between;
        gap: 8px; min-height: 0;
      }
      .watch-wrap { display: flex; flex-direction: column; align-items: center; gap: 4px; }
      #watch-canvas { width: min(124px, 16vh); height: min(124px, 16vh); }
      .watch-digital { font-family: var(--mono); font-size: 0.86rem; color: #ffd588; letter-spacing: 0.08em; }
      .stop-gauge-box {
        width: 100%; padding: 8px 10px; background: #0d1117;
        border: 1px solid #2d3540; border-radius: 8px; text-align: center;
      }
      .stop-gauge-label { font-size: 0.68rem; color: var(--text-dim); letter-spacing: 0.04em; }
      .stop-gauge-val { font-family: var(--mono); font-size: 1.05rem; font-weight: 700; color: #f6f9fc; margin: 2px 0 6px; }
      .stop-track { height: 8px; border-radius: 4px; background: #1e252f; position: relative; overflow: hidden; }
      .stop-center-mark { position: absolute; left: 50%; top: 0; bottom: 0; width: 2px; background: #4ce69e; transform: translateX(-50%); }
      .stop-pin { position: absolute; top: 0; bottom: 0; width: 8px; border-radius: 3px; background: #ff9f2e; transform: translateX(-50%); left: 0%; }
      .eb-mushroom-btn {
        width: 78px; height: 78px; border-radius: 50%; border: 4px solid #444b55;
        background: radial-gradient(circle at 35% 30%, #ff6b6b 0%, #c81e24 62%, #7d0c11 100%);
        color: #fff; font-family: var(--sans); font-size: 0.85rem; font-weight: 700; cursor: pointer;
        box-shadow: 0 6px 16px rgba(0, 0, 0, 0.55), inset 0 2px 4px rgba(255, 255, 255, 0.35);
      }
      .touch-console {
        flex-shrink: 0; display: flex; align-items: center; justify-content: space-between;
        gap: 12px; padding: 8px 12px; background: rgba(12, 15, 20, 0.88);
        border: 1px solid var(--bezel-border); border-radius: 10px; flex-wrap: wrap;
      }
      .touch-notch-strip { display: flex; align-items: center; gap: 4px; flex: 1; min-width: 300px; }
      .t-notch {
        flex: 1; min-width: 28px; height: 36px; border-radius: 6px;
        border: 1px solid rgba(255, 255, 255, 0.14); background: rgba(255, 255, 255, 0.06);
        color: var(--text-dim); font-family: var(--mono); font-size: 0.78rem; font-weight: 700; cursor: pointer;
      }
      .t-notch.type-eb.active { background: #d92d20; border-color: #ff8a80; color: #fff; }
      .t-notch.type-brake.active { background: #d97706; border-color: #fcd34d; color: #fff; }
      .t-notch.type-neutral.active { background: #475467; border-color: #cbd5e1; color: #fff; }
      .t-notch.type-power.active { background: #009e5c; border-color: #5eead4; color: #fff; }
      .touch-actions { display: flex; align-items: center; gap: 6px; }
      .t-act-btn {
        height: 36px; padding: 0 13px; border-radius: 6px;
        border: 1px solid rgba(255, 255, 255, 0.18); background: rgba(255, 255, 255, 0.08);
        color: var(--text-main); font-family: var(--sans); font-size: 0.78rem; font-weight: 600; cursor: pointer;
      }
      .t-act-btn.active-amber { background: rgba(245, 166, 35, 0.25); border-color: rgba(255, 206, 86, 0.8); color: #ffe39b; }
    </style>
  `;

  doc.body.innerHTML = `
    <div class="cockpit-shell">
      <header class="panel-topbar">
        <div class="panel-brand">
          <span class="series-pill">E531系</span>
          <span>グラスコックピット計器パネル・SideCar / 外部ディスプレイ</span>
          <span class="conn-badge connected" id="conn-badge">
            <span class="conn-dot"></span>
            <span id="conn-text">メイン画面とリアルタイム同期中</span>
          </span>
        </div>
        <div class="panel-actions">
          <button type="button" class="top-btn" id="btn-panel-fullscreen">全画面表示</button>
        </div>
      </header>
      <main class="desk-cluster">
        <section class="lcd-bezel" aria-label="主計器ディスプレイ">
          <div class="lcd-screen"><canvas id="meter-canvas" width="900" height="580"></canvas></div>
        </section>
        <aside class="center-column" aria-label="鉄道懐中時計・停止位置計">
          <div class="watch-wrap">
            <canvas id="watch-canvas" width="220" height="220"></canvas>
            <div class="watch-digital" id="watch-digital">17:45:00</div>
          </div>
          <div class="stop-gauge-box">
            <div class="stop-gauge-label" id="stop-station-label">次停車: 三河島</div>
            <div class="stop-gauge-val" id="stop-dist-val">1,200 m</div>
            <div class="stop-track">
              <div class="stop-center-mark"></div>
              <div class="stop-pin" id="stop-pin"></div>
            </div>
          </div>
          <button type="button" class="eb-mushroom-btn" id="btn-eb-mushroom" title="非常ブレーキ投入">
            緊急<br />EB
          </button>
        </aside>
        <section class="lcd-bezel" aria-label="TIMS モニタディスプレイ">
          <div class="lcd-screen"><canvas id="tims-canvas" width="900" height="580"></canvas></div>
        </section>
      </main>
      <footer class="touch-console" aria-label="ワンハンドルマスコン・クイック操作">
        <div class="touch-notch-strip" id="touch-notch-strip"></div>
        <div class="touch-actions">
          <button type="button" class="t-act-btn" id="pbtn-melody">発車メロディ</button>
          <button type="button" class="t-act-btn" id="pbtn-doors">扉閉</button>
          <button type="button" class="t-act-btn" id="pbtn-horn">警笛</button>
          <button type="button" class="t-act-btn" id="pbtn-world">ザ・ワールド</button>
        </div>
      </footer>
    </div>
  `;

  const meterCanvas = doc.getElementById('meter-canvas');
  const meterCtx = meterCanvas.getContext('2d');
  const timsCanvas = doc.getElementById('tims-canvas');
  const timsCtx = timsCanvas.getContext('2d');
  const watchCanvas = doc.getElementById('watch-canvas');
  const watchCtx = watchCanvas.getContext('2d');
  const connBadge = doc.getElementById('conn-badge');
  const connText = doc.getElementById('conn-text');
  const watchDigital = doc.getElementById('watch-digital');
  const stopStationLabel = doc.getElementById('stop-station-label');
  const stopDistVal = doc.getElementById('stop-dist-val');
  const stopPin = doc.getElementById('stop-pin');
  const touchNotchStrip = doc.getElementById('touch-notch-strip');
  const btnFullscreen = doc.getElementById('btn-panel-fullscreen');
  const btnEbMushroom = doc.getElementById('btn-eb-mushroom');
  const pbtnMelody = doc.getElementById('pbtn-melody');
  const pbtnDoors = doc.getElementById('pbtn-doors');
  const pbtnHorn = doc.getElementById('pbtn-horn');
  const pbtnWorld = doc.getElementById('pbtn-world');

  let pState = buildCockpitTelemetry(null);
  let lastRxTime = performance.now();

  const pChannel =
    typeof win.BroadcastChannel !== 'undefined' ? new win.BroadcastChannel(COCKPIT_CHANNEL_NAME) : null;

  const sendPanelCmd = (action, payload = {}) => {
    const msg = { type: 'cmd', action, ...payload };
    if (pChannel) {
      try {
        pChannel.postMessage(msg);
      } catch {
        // ignore
      }
    }
    if (win.opener && !win.opener.closed) {
      try {
        win.opener.postMessage(msg, '*');
      } catch {
        // ignore
      }
    } else if (win !== window) {
      window.postMessage(msg, '*');
    }
  };

  const notchBtns = [];
  NOTCH_STEPS.forEach((step, idx) => {
    const b = doc.createElement('button');
    b.type = 'button';
    b.className = `t-notch type-${step.type}`;
    b.textContent = step.id;
    b.addEventListener('click', () => sendPanelCmd('setNotch', { index: idx }));
    touchNotchStrip.appendChild(b);
    notchBtns.push(b);
  });

  const syncPanelDom = () => {
    notchBtns.forEach((el, idx) => el.classList.toggle('active', idx === pState.notchIndex));
    pbtnDoors.textContent = pState.doorsOpen ? '扉開中 (閉める)' : '扉閉 (開ける)';
    pbtnDoors.classList.toggle('active-amber', Boolean(pState.doorsOpen));
    pbtnWorld.textContent = pState.isTheWorldActive ? '時間停止中' : 'ザ・ワールド';
    pbtnWorld.classList.toggle('active-amber', Boolean(pState.isTheWorldActive));

    stopStationLabel.textContent = `次停車: ${pState.nextStopName || '北千住'}`;
    const rem = pState.remainingMeters ?? 0;
    if (Math.abs(rem) < 1000) {
      stopDistVal.textContent = `${rem < 0 ? '過走 ' : ''}${Math.abs(Math.round(rem))} m`;
    } else {
      stopDistVal.textContent = `${(rem / 1000).toFixed(2)} km`;
    }
    const pct = Math.min(100, Math.max(0, 50 - rem));
    stopPin.style.left = Math.abs(rem) <= 50 ? `${pct}%` : '0%';
  };

  const onTelemetryPacket = (data) => {
    if (!data || typeof data !== 'object') return;
    if (data.type === 'telemetry') {
      pState = { ...pState, ...data };
      lastRxTime = performance.now();
      syncPanelDom();
    }
  };

  if (pChannel) {
    pChannel.onmessage = (ev) => onTelemetryPacket(ev.data);
    pChannel.postMessage({ type: 'panel-hello' });
  }
  win.addEventListener('message', (ev) => onTelemetryPacket(ev.data));
  win.addEventListener('beforeunload', () => {
    if (pChannel) pChannel.postMessage({ type: 'panel-bye' });
    if (win.opener && !win.opener.closed) {
      try {
        win.opener.postMessage({ type: 'panel-bye' }, '*');
      } catch {
        // ignore
      }
    }
  });

  btnEbMushroom.addEventListener('click', () => sendPanelCmd('applyEB'));
  pbtnHorn.addEventListener('click', () => sendPanelCmd('horn'));
  pbtnDoors.addEventListener('click', () => sendPanelCmd('toggleDoors'));
  pbtnMelody.addEventListener('click', () => sendPanelCmd('melody'));
  pbtnWorld.addEventListener('click', () => sendPanelCmd('toggleWorld'));
  btnFullscreen.addEventListener('click', () => {
    if (!doc.fullscreenElement) {
      doc.documentElement.requestFullscreen?.().catch(() => {});
    } else {
      doc.exitFullscreen?.().catch(() => {});
    }
  });

  win.addEventListener('keydown', (e) => {
    if (e.code === 'KeyS' || e.code === 'ArrowDown') {
      e.preventDefault();
      sendPanelCmd('pullHandle');
    } else if (e.code === 'KeyW' || e.code === 'ArrowUp') {
      e.preventDefault();
      sendPanelCmd('pushHandle');
    } else if (e.code === 'Space') {
      e.preventDefault();
      sendPanelCmd('setNeutral');
    } else if (e.code === 'Backspace' || e.code === 'KeyE') {
      e.preventDefault();
      sendPanelCmd('applyEB');
    } else if (e.code === 'KeyH' || e.code === 'Enter') {
      e.preventDefault();
      sendPanelCmd('horn');
    } else if (e.code === 'KeyD') {
      e.preventDefault();
      sendPanelCmd('toggleDoors');
    } else if (e.code === 'KeyF') {
      e.preventDefault();
      sendPanelCmd('melody');
    } else if (e.code === 'KeyT' && !e.repeat) {
      e.preventDefault();
      sendPanelCmd('toggleWorld');
    }
  });

  const resizeCvs = (cvs) => {
    const rect = cvs.getBoundingClientRect();
    const dpr = Math.min(win.devicePixelRatio || 1, 2);
    const w = Math.max(300, Math.round(rect.width * dpr));
    const h = Math.max(200, Math.round(rect.height * dpr));
    if (cvs.width !== w || cvs.height !== h) {
      cvs.width = w;
      cvs.height = h;
    }
    return { w, h };
  };

  const renderPanelFrame = () => {
    if (win.closed) return;
    win.requestAnimationFrame(renderPanelFrame);

    // localStorage からのフォールバック同期（別ウィンドウやリロード直後でも即反映）
    try {
      const snap = localStorage.getItem(COCKPIT_SNAPSHOT_KEY);
      if (snap && performance.now() - lastRxTime > 400) {
        const parsed = JSON.parse(snap);
        if (parsed && parsed.type === 'telemetry') {
          pState = { ...pState, ...parsed };
          syncPanelDom();
        }
      }
    } catch {
      // ignore
    }

    const isConn = performance.now() - lastRxTime < 2800 || (win.opener && !win.opener.closed);
    connBadge.classList.toggle('connected', Boolean(isConn));
    connText.textContent = isConn ? 'メイン画面とリアルタイム同期中' : 'メイン画面の運転操作を待機中...';

    // 1. 左メータLCD描画
    {
      const { w, h } = resizeCvs(meterCanvas);
      const ctx = meterCtx;
      ctx.fillStyle = '#0c1117';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(255,255,255,0.04)';
      ctx.lineWidth = 1;
      ctx.strokeRect(8, 8, w - 16, h - 16);

      const cx = w * 0.65;
      const cy = h * 0.56;
      const radius = Math.min(w * 0.31, h * 0.40);
      const startAng = Math.PI * 0.78;
      const sweepAng = Math.PI * 1.44;
      const maxSpd = 160;

      ctx.strokeStyle = '#25303d';
      ctx.lineWidth = Math.max(4, radius * 0.055);
      ctx.beginPath();
      ctx.arc(cx, cy, radius, startAng, startAng + sweepAng);
      ctx.stroke();

      const limFrac = Math.min(1, (pState.speedLimit || 100) / maxSpd);
      const limAng = startAng + limFrac * sweepAng;
      ctx.strokeStyle = '#ff8a24';
      ctx.lineWidth = Math.max(5, radius * 0.065);
      ctx.beginPath();
      ctx.arc(cx, cy, radius * 1.04, limAng - 0.04, limAng + 0.04);
      ctx.stroke();

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

      const spdFrac = Math.min(1, Math.max(0, (pState.speedKmh || 0) / maxSpd));
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

      const overLimit = pState.speedKmh > pState.speedLimit + 1.5;
      ctx.fillStyle = overLimit ? '#ff5757' : '#ffffff';
      ctx.font = `700 ${Math.round(radius * 0.34)}px "JetBrains Mono", monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(String(Math.round(pState.speedKmh || 0)), cx, cy + radius * 0.42);
      ctx.fillStyle = '#8b99a8';
      ctx.font = `600 ${Math.round(radius * 0.12)}px "Inter", sans-serif`;
      ctx.fillText('km/h', cx, cy + radius * 0.64);

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
        pState.doorsOpen ? '扉 開' : '戸 閉',
        pState.doorsOpen ? '#4a2e08' : '#103b2a',
        pState.doorsOpen ? '#ffbe44' : '#4ce69e',
        true
      );
      const notchCol =
        pState.notchType === 'eb'
          ? ['#541216', '#ff6464']
          : pState.notchType === 'brake'
            ? ['#4a2d08', '#ffad33']
            : pState.notchType === 'power'
              ? ['#0d3d2c', '#3de09a']
              : ['#1f2732', '#dbe4ee'];
      drawLamp(w * 0.745, topY, w * 0.215, pillH, `ノッチ ${pState.notchId}`, notchCol[0], notchCol[1], true);

      drawLamp(w * 0.04, topY, w * 0.175, pillH * 0.88, 'DC 1500V', '#4d3206', '#ffbd4a', true);
      ctx.fillStyle = '#9aa8b8';
      ctx.font = `600 ${Math.round(h * 0.030)}px "JetBrains Mono", monospace`;
      ctx.textAlign = 'left';
      ctx.fillText(`電流 ${Math.round(Math.abs(pState.motorEffort || 0) * 520)} A`, w * 0.23, topY + pillH * 0.45);

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
      for (let k = 0; k <= 1000; k += 200) {
        const yy = barTop + barH * (1 - k / 1000);
        ctx.fillStyle = '#6f7d8c';
        ctx.font = `500 ${Math.round(h * 0.028)}px "JetBrains Mono", monospace`;
        ctx.textAlign = 'right';
        ctx.fillText(String(k), w * 0.095, yy + 3);
      }
      drawPressureBar(w * 0.11, 'BC', pState.bcPressure || 0, 1000, '#f5a623');
      drawPressureBar(w * 0.22, 'MR', pState.mrPressure || 830, 1000, '#e6eef6');
    }

    // 2. 右TIMS LCD描画
    {
      const { w, h } = resizeCvs(timsCanvas);
      const ctx = timsCtx;
      ctx.fillStyle = '#0c1118';
      ctx.fillRect(0, 0, w, h);

      const hdrH = h * 0.12;
      ctx.fillStyle = '#004b93';
      ctx.fillRect(0, 0, w, hdrH);
      ctx.fillStyle = '#ffffff';
      ctx.font = `700 ${Math.round(hdrH * 0.39)}px "Noto Sans JP", sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const svcText = pState.serviceType === 'special_rapid' ? '特別快速' : '快速';
      ctx.fillText(`TIMS｜常磐線 ${svcText}`, w * 0.03, hdrH * 0.52);

      ctx.textAlign = 'right';
      ctx.font = `600 ${Math.round(hdrH * 0.34)}px "JetBrains Mono", monospace`;
      ctx.fillStyle = '#b9dcff';
      ctx.fillText(`制限 ${pState.speedLimit} km/h · 勾配 ${(pState.gradient || 0).toFixed(1)}‰`, w * 0.97, hdrH * 0.52);

      const tblTop = hdrH + h * 0.04;
      const rowH = h * 0.105;
      const stations = pState.stations || [];
      stations.forEach((st, idx) => {
        const ry = tblTop + idx * rowH;
        const isNext = st.name === pState.nextStopName;
        const passed = pState.distance > st.dist + 25;
        const distDiff = st.dist - pState.distance;

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

      const cTop = h * 0.62;
      ctx.fillStyle = '#9aa8b8';
      ctx.font = `600 ${Math.round(h * 0.036)}px "Noto Sans JP", sans-serif`;
      ctx.textAlign = 'left';
      ctx.fillText(`編成状態（10両） ｜ ${pState.zoneLabel || ''}`, w * 0.03, cTop);

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
        ctx.strokeStyle = pState.doorsOpen ? '#f5a623' : '#3a495a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(cx, cy, cw, ch, 4);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#dce6f0';
        ctx.font = `700 ${Math.round(ch * 0.24)}px "JetBrains Mono", monospace`;
        ctx.textAlign = 'center';
        ctx.fillText(String(i + 1), cx + cw * 0.5, cy + ch * 0.24);
        if (isGreen) {
          ctx.fillStyle = '#5ee085';
          ctx.font = `700 ${Math.round(ch * 0.20)}px "Noto Sans JP", sans-serif`;
          ctx.fillText('G', cx + cw * 0.5, cy + ch * 0.56);
        }
        if (isMotor && Math.abs(pState.motorEffort || 0) > 0.02) {
          const eff = Math.min(1, Math.abs(pState.motorEffort));
          const bh = ch * 0.32 * eff;
          ctx.fillStyle = pState.motorEffort > 0 ? '#27d980' : '#ff9f2e';
          ctx.fillRect(cx + 4, cy + ch - 4 - bh, cw - 8, bh);
        }
      }

      ctx.fillStyle = '#7b8a9c';
      ctx.font = `600 ${Math.round(h * 0.034)}px "JetBrains Mono", monospace`;
      ctx.textAlign = 'right';
      ctx.fillText(`現在位置 ${(Math.max(0, pState.distance) / 1000).toFixed(3)} km`, w * 0.97, h * 0.94);
    }

    // 3. 鉄道懐中時計描画
    {
      const ctx = watchCtx;
      const W = watchCanvas.width;
      const H = watchCanvas.height;
      const cx = W * 0.5;
      const cy = H * 0.5;
      const r = W * 0.44;
      ctx.clearRect(0, 0, W, H);
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
  };

  syncPanelDom();
  renderPanelFrame();
}

function openInstrumentPanel() {
  sound.init();
  if (panelPopupWindow && !panelPopupWindow.closed) {
    panelPopupWindow.focus();
    broadcastCockpitTelemetry(null, true);
    showToast('別窓計器パネルを前面に表示しました（SideCar / サブ画面へ移動可能）', 3200);
    return;
  }

  // プロキシ環境や埋め込みプレビューでも about:blank にならないよう、
  // 同一オリジン空ウィンドウを開いてその場で E531 計器パネル DOM を直接マウントする！
  const features =
    'width=1280,height=580,menubar=no,toolbar=no,location=no,status=no,resizable=yes';
  let win = null;
  try {
    win = window.open('', 'joban_cockpit_panel', features);
  } catch {
    win = null;
  }

  if (!win) {
    showToast(
      '別窓がブロックされました。ブラウザ右上のポップアップ許可、または左の「E531系 別窓計器パネル」カードから開けます！',
      5800
    );
    return;
  }

  panelPopupWindow = win;
  panelMessageTargets.add(win);
  isPanelConnected = true;
  syncPanelButton();

  try {
    mountCockpitPanelIntoDocument(win.document, win);
  } catch {
    // 万一同一オリジン書き込みが制限された場合は ?panel=1 へ遷移
    const url = new URL(window.location.href);
    url.searchParams.set('panel', '1');
    win.location.href = url.toString();
  }

  broadcastCockpitTelemetry(null, true);
  showToast(
    'E531系 別窓計器パネルを起動！iPad (SideCar) やサブ画面へドラッグして前面展望 (V) で遊べます',
    4800
  );
}

if (btnPopoutPanel) {
  btnPopoutPanel.addEventListener('click', () => {
    openInstrumentPanel();
    btnPopoutPanel.blur();
  });
}

function handleIncomingCockpitMessage(data) {
  if (!data || typeof data !== 'object') return;

  if (data.type === 'panel-hello') {
    isPanelConnected = true;
    syncPanelButton();
    broadcastCockpitTelemetry(null, true);
    return;
  }

  if (data.type === 'panel-bye') {
    isPanelConnected = false;
    syncPanelButton();
    return;
  }

  if (data.type === 'cmd') {
    if (!isPanelConnected) {
      isPanelConnected = true;
      syncPanelButton();
    }
    if (!isDrivingStarted) {
      startDrivingSession();
    } else {
      sound.init();
    }

    switch (data.action) {
      case 'setNotch': {
        const idx = Number(data.index);
        if (Number.isInteger(idx) && idx >= 0 && idx < NOTCH_STEPS.length) {
          if (physics.doorsOpen && idx > NEUTRAL_INDEX) {
            showToast('戸閉保安作動中：扉を閉めてから力行してください', 2600);
            return;
          }
          if (physics.notchIndex !== idx) {
            physics.notchIndex = idx;
            sound.playNotchClick(getNotchClickKind(physics.currentNotch));
            syncNotchHud();
            broadcastCockpitTelemetry(null, true);
          }
        }
        break;
      }
      case 'pullHandle': {
        const res = physics.pullHandle();
        if (res.blockedByDoor) {
          showToast('戸閉保安作動中：扉を閉めてから力行してください', 2600);
        } else if (res.changed) {
          sound.playNotchClick(getNotchClickKind(res.notch));
          syncNotchHud();
          broadcastCockpitTelemetry(null, true);
        }
        break;
      }
      case 'pushHandle': {
        const res = physics.pushHandle();
        if (res.changed) {
          sound.playNotchClick(getNotchClickKind(res.notch));
          syncNotchHud();
          broadcastCockpitTelemetry(null, true);
        }
        break;
      }
      case 'setNeutral': {
        const res = physics.setNeutral();
        if (res.changed) {
          sound.playNotchClick('neutral');
          syncNotchHud();
          broadcastCockpitTelemetry(null, true);
        }
        break;
      }
      case 'applyEB': {
        const res = physics.applyEmergencyBrake();
        if (res.changed) {
          sound.playNotchClick('eb');
          syncNotchHud();
          broadcastCockpitTelemetry(null, true);
          showToast('非常ブレーキ (EB) 投入', 2200);
        }
        break;
      }
      case 'horn':
        sound.playHorn();
        break;
      case 'toggleDoors':
        handleDoorToggle();
        break;
      case 'melody':
        handleDepartureMelody();
        break;
      case 'toggleWorld':
        setTheWorld(!isTheWorldActive);
        break;
      default:
        break;
    }
  }
}

if (cockpitChannel) {
  cockpitChannel.onmessage = (ev) => handleIncomingCockpitMessage(ev.data);
}
window.addEventListener('message', (ev) => handleIncomingCockpitMessage(ev.data));

// URL に ?panel=1 が指定されている場合は、この画面自体を SideCar 用計器パネル専用モードとして起動！
if (new URLSearchParams(window.location.search).get('panel') === '1') {
  mountCockpitPanelIntoDocument(document, window);
}

// --- ツールバー＆クイック操作イベント ---
hudJumpSelect.addEventListener('change', (e) => {
  const targetD = Number(e.target.value);
  if (!Number.isNaN(targetD)) {
    const zone = route.getTrackZoneAt(targetD);
    if (isTheWorldActive) {
      // 時間停止中は列車を動かさず、自由カメラだけ指定区間の鳥瞰位置へワープ！
      const frame = route.getFrameAt(targetD);
      camera.position.copy(frame.position).add(new THREE.Vector3(0, 6.2, 0));
      specYaw = Math.atan2(-frame.tangent.x, -frame.tangent.z);
      specPitch = -0.22;
      camera.rotation.order = 'YXZ';
      camera.rotation.set(specPitch, specYaw, 0);
      showToast(`自由カメラを ${zone.label} (${(targetD / 1000).toFixed(1)} km) へ移動しました`, 2800);
    } else {
      physics.reset(targetD);
      wasMovingSinceStop = false;
      sound.stopDepartureMelody();
      syncNotchHud();
      syncDoorButton();
      broadcastCockpitTelemetry(null, true);
      showToast(`${zone.label} (${(targetD / 1000).toFixed(1)} km) へ移動しました`, 3000);
    }
  }
  e.target.value = '';
  e.target.blur();
});

hudAtmosphereSelect.addEventListener('change', (e) => {
  atmosphere.applyPreset(e.target.value);
  e.target.blur();
});

function handleToggleView() {
  if (isTheWorldActive) setTheWorld(false, { silentToast: true });
  const mode = cabView.toggleViewMode();
  btnToggleView.textContent = mode === 'cab' ? '視点: 運転席' : '視点: 前面展望';
  if (mode === 'front') {
    if (isPanelConnected) {
      showToast('前面展望モード（別窓計器パネルとリアルタイム同期中）', 3000);
    } else {
      showToast('前面展望モード — Pキーまたは「別窓計器」でSideCar用計器パネルを開けます', 4200);
    }
  }
}
btnToggleView.addEventListener('click', handleToggleView);

function handleToggleMute() {
  sound.init();
  sound.setMuted(!sound.isMuted);
  btnToggleMute.textContent = sound.isMuted ? '音: OFF' : '音: ON';
}
btnToggleMute.addEventListener('click', handleToggleMute);

function setHudVisibility(visible) {
  isHudVisible = visible;
  hudLayer.classList.toggle('hidden', !visible);
  btnRestoreHud.classList.toggle('hidden', visible);
}
btnToggleHud.addEventListener('click', () => setHudVisibility(false));
btnRestoreHud.addEventListener('click', () => setHudVisibility(true));

btnHorn.addEventListener('click', () => {
  sound.init();
  sound.playHorn();
});

function handleDepartureMelody() {
  sound.init();
  if (isTheWorldActive) return;
  if (sound.isMelodyPlaying) {
    sound.stopDepartureMelody();
    showToast('発車メロディを停止しました', 1800);
    return;
  }
  let targetSt = physics.getCurrentStationAtPlatform();
  if (!targetSt) {
    // 駅停車外でも最寄り駅の発車メロディを再生可能
    let bestDist = Infinity;
    for (const st of STATIONS) {
      const distDiff = Math.abs(physics.distance - st.stopDistance);
      if (distDiff < bestDist) {
        bestDist = distDiff;
        targetSt = st;
      }
    }
  }
  const stId = targetSt ? targetSt.id : 'nippori';
  const stName = targetSt ? targetSt.nameKanji : '日暮里';
  sound.playDepartureMelody(stId);
  showToast(`♪ ${stName}駅 発車メロディ再生中（もう一度 F で停止 / D で戸閉）`, 3600);
}
if (btnMelody) {
  btnMelody.addEventListener('click', handleDepartureMelody);
}

function handleDoorToggle() {
  sound.init();
  const res = physics.toggleDoors();
  if (!res.toggled) {
    showToast('走行中は扉を開閉できません（停車後に操作してください）', 2500);
    return;
  }
  if (!res.doorsOpen) {
    sound.stopDepartureMelody();
  }
  sound.playDoorChime(res.doorsOpen);
  syncDoorButton();
  syncNotchHud();
  broadcastCockpitTelemetry(null, true);
  showToast(res.doorsOpen ? '客室扉を開けました（発車時はFでメロディ→Dで閉扉）' : '戸閉完了 — 発車可能です', 2800);
}
btnDoors.addEventListener('click', handleDoorToggle);

// --- キーボード操作（ワンハンドル直感キー ＆ BVE互換キー ＆ ザ・ワールド自由移動） ---
const SPEC_KEYS = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'KeyE',
  'KeyQ',
  'KeyC',
  'Space',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ShiftLeft',
  'ShiftRight',
  'AltLeft',
  'AltRight',
]);

window.addEventListener('keydown', (e) => {
  if (!isDrivingStarted) {
    if (e.code === 'Enter' || e.code === 'Space') {
      e.preventDefault();
      startDrivingSession();
    }
    return;
  }

  if (e.target && (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT')) {
    return;
  }

  // 時間停止＋スペクテイター切替 (T) / 解除 (Esc)
  if (e.code === 'KeyT' && !e.repeat) {
    e.preventDefault();
    setTheWorld(!isTheWorldActive);
    return;
  }
  if (e.code === 'Escape' && isTheWorldActive) {
    e.preventDefault();
    setTheWorld(false);
    return;
  }

  // 別窓計器パネル (P)・時間帯切替・HUD非表示は時間停止中でも共通利用可能
  if (e.code === 'KeyP' && !e.repeat) {
    e.preventDefault();
    openInstrumentPanel();
    return;
  }
  if (e.code === 'Tab') {
    e.preventDefault();
    setHudVisibility(!isHudVisible);
    return;
  }
  if (e.code === 'Digit1') {
    atmosphere.applyPreset('magic_hour');
    hudAtmosphereSelect.value = 'magic_hour';
    return;
  }
  if (e.code === 'Digit2') {
    atmosphere.applyPreset('golden_hour');
    hudAtmosphereSelect.value = 'golden_hour';
    return;
  }
  if (e.code === 'Digit3') {
    atmosphere.applyPreset('twilight');
    hudAtmosphereSelect.value = 'twilight';
    return;
  }

  // ザ・ワールド発動中は運転キーを遮断し、スペクテイター移動キーのみ受付
  if (isTheWorldActive) {
    if (SPEC_KEYS.has(e.code)) {
      e.preventDefault();
      heldKeys.add(e.code);
    }
    return;
  }

  switch (e.code) {
    case 'KeyS':
    case 'ArrowDown':
    case 'KeyZ': {
      e.preventDefault();
      const res = physics.pullHandle();
      if (res.blockedByDoor) {
        showToast('戸閉保安作動中：Dキーで扉を閉めてから力行してください', 2600);
      } else if (res.changed) {
        sound.playNotchClick(getNotchClickKind(res.notch));
        syncNotchHud();
        broadcastCockpitTelemetry(null, true);
      }
      break;
    }
    case 'KeyW':
    case 'ArrowUp':
    case 'KeyQ':
    case 'Period': {
      e.preventDefault();
      const res = physics.pushHandle();
      if (res.changed) {
        sound.playNotchClick(getNotchClickKind(res.notch));
        syncNotchHud();
        broadcastCockpitTelemetry(null, true);
      }
      break;
    }
    case 'Space':
    case 'KeyN': {
      e.preventDefault();
      const res = physics.setNeutral();
      if (res.changed) {
        sound.playNotchClick('neutral');
        syncNotchHud();
        broadcastCockpitTelemetry(null, true);
      }
      break;
    }
    case 'Backspace':
    case 'KeyE':
    case 'Slash': {
      e.preventDefault();
      const res = physics.applyEmergencyBrake();
      if (res.changed) {
        sound.playNotchClick('eb');
        syncNotchHud();
        broadcastCockpitTelemetry(null, true);
        showToast('非常ブレーキ (EB) 投入', 2200);
      }
      break;
    }
    case 'KeyH':
    case 'Enter': {
      e.preventDefault();
      sound.playHorn();
      break;
    }
    case 'KeyF': {
      e.preventDefault();
      handleDepartureMelody();
      break;
    }
    case 'KeyD': {
      e.preventDefault();
      handleDoorToggle();
      break;
    }
    case 'KeyV': {
      e.preventDefault();
      handleToggleView();
      break;
    }
    case 'KeyM': {
      e.preventDefault();
      handleToggleMute();
      break;
    }
    default:
      break;
  }
});

window.addEventListener('keyup', (e) => {
  heldKeys.delete(e.code);
});

window.addEventListener('blur', () => {
  heldKeys.clear();
});

// --- マウスドラッグ視点回転 ＆ ホイール移動速度調整 ---
let isDraggingLook = false;
let prevPointerX = 0;
let prevPointerY = 0;

canvas.addEventListener('pointerdown', (e) => {
  isDraggingLook = true;
  prevPointerX = e.clientX;
  prevPointerY = e.clientY;
});

window.addEventListener('pointermove', (e) => {
  if (!isDraggingLook) return;
  const dx = e.clientX - prevPointerX;
  const dy = e.clientY - prevPointerY;
  prevPointerX = e.clientX;
  prevPointerY = e.clientY;
  if (isTheWorldActive) {
    specYaw -= dx * 0.0032;
    specPitch = THREE.MathUtils.clamp(specPitch - dy * 0.0032, -1.52, 1.52);
  } else {
    cabView.addLookOffset(-dx * 0.0022, -dy * 0.0022);
  }
});

window.addEventListener('pointerup', () => {
  isDraggingLook = false;
});

canvas.addEventListener('dblclick', () => {
  if (isTheWorldActive) {
    specPitch = 0;
  } else {
    cabView.resetLookOffset();
  }
});

canvas.addEventListener(
  'wheel',
  (e) => {
    if (!isTheWorldActive) return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.22 : 1 / 1.22;
    specSpeed = THREE.MathUtils.clamp(specSpeed * factor, 2, 120);
    syncWorldSpeedHud();
  },
  { passive: false }
);

// --- ウィンドウリサイズ対応 ---
window.addEventListener('resize', () => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  atmosphere.resize(w, h);
});

// --- メインシミュレーション＆レンダリングループ ---
const clock = new THREE.Clock();
let isRenderPaused = false;

function updateSpectatorCamera(dt) {
  camera.rotation.order = 'YXZ';
  camera.rotation.set(specPitch, specYaw, 0);

  const forwardInput =
    (heldKeys.has('KeyW') || heldKeys.has('ArrowUp') ? 1 : 0) -
    (heldKeys.has('KeyS') || heldKeys.has('ArrowDown') ? 1 : 0);
  const strafeInput =
    (heldKeys.has('KeyD') || heldKeys.has('ArrowRight') ? 1 : 0) -
    (heldKeys.has('KeyA') || heldKeys.has('ArrowLeft') ? 1 : 0);
  const verticalInput =
    (heldKeys.has('KeyE') || heldKeys.has('Space') ? 1 : 0) -
    (heldKeys.has('KeyQ') || heldKeys.has('KeyC') ? 1 : 0);

  if (forwardInput !== 0 || strafeInput !== 0 || verticalInput !== 0) {
    camera.getWorldDirection(_specFwd).normalize();
    _specRight.crossVectors(_specFwd, _specWorldUp).normalize();
    _specMove.set(0, 0, 0);
    _specMove.addScaledVector(_specFwd, forwardInput);
    _specMove.addScaledVector(_specRight, strafeInput);
    _specMove.addScaledVector(_specWorldUp, verticalInput);
    if (_specMove.lengthSq() > 1e-6) {
      _specMove.normalize();
      let speed = specSpeed;
      if (heldKeys.has('ShiftLeft') || heldKeys.has('ShiftRight')) speed *= 3.5;
      if (heldKeys.has('AltLeft') || heldKeys.has('AltRight')) speed *= 0.22;
      camera.position.addScaledVector(_specMove, speed * dt);
      if (camera.position.y < 0.35) camera.position.y = 0.35;
    }
  }
}

function stepFrame() {
  const rawDt = Math.min(clock.getDelta(), 0.1);
  const elapsed = clock.elapsedTime;

  // ザ・ワールド発動中：全物理・対向車・並走車・音声を完全停止し、自由スペクテイターカメラのみ駆動！
  if (isTheWorldActive) {
    updateSpectatorCamera(rawDt);
    broadcastCockpitTelemetry(null);
    atmosphere.update(camera.position, frozenElapsed);
    atmosphere.render();
    return;
  }

  const dt = rawDt;

  // 1. 車両縦物理・ブレーキ圧・ジョイント通過判定の更新
  const physState = physics.update(dt, {
    onRailJoint: (jointEvt) => {
      cabView.triggerJointImpulse(jointEvt);
      sound.playRailJoint(jointEvt);
    },
    onBrakeAirRelease: (strength) => {
      sound.playBrakeAirRelease(strength);
    },
  });

  if (physState.speedKmh > 3.5) {
    wasMovingSinceStop = true;
  } else if (wasMovingSinceStop && physState.speedKmh === 0) {
    wasMovingSinceStop = false;
    const atStation = physics.getCurrentStationAtPlatform();
    if (atStation) {
      const diff = physState.distance - atStation.stopDistance;
      const signStr = diff >= 0 ? `+${diff.toFixed(2)}` : diff.toFixed(2);
      if (atStation.id === 'kitasenju') {
        showToast(
          `終着 北千住駅 到着 ｜ [15] 停止目標との差 ${signStr} m — ご乗務お疲れさまでした`,
          7500
        );
      } else {
        showToast(
          `${atStation.nameKanji}駅 停車 ｜ [15] 停止目標との差 ${signStr} m （Dキーで扉開閉）`,
          5200
        );
      }
    }
  }

  // 2. 次停車駅・制限速度・閉塞信号機の更新
  const nextStop = physics.getNextScheduledStop();
  const remainingMeters = nextStop ? nextStop.stopDistance - physState.distance : 0;
  const speedLimitObj = route.getSpeedLimitAt(physState.distance);

  trackSystem.updateSignals(physState.distance, nextStop ? nextStop.stopDistance : null);

  // 3. 沿線風景（隅田川さざ波・航空障害灯・上り対向列車）更新
  scenery.update(dt, elapsed, physState.distance, () => {
    sound.playPassingTrainWhoosh();
  });

  // 4. 3D運転台・サスペンションカメラ・3D計器盤更新
  cabView.update(dt, elapsed, {
    ...physState,
    notch: physics.currentNotch,
    notchIndex: physics.notchIndex,
    doorsOpen: physics.doorsOpen,
    serviceType: physics.serviceType,
    speedLimit: speedLimitObj.limit,
    nextStopName: nextStop ? nextStop.nameKanji : '北千住',
    remainingMeters,
  });

  // 5. Web Audio 連続走行音更新
  sound.update({
    speedKmh: physState.speedKmh,
    motorEffort: physState.motorEffort,
    zoneType: physState.zone.type,
    curvature: physState.frame.curvature,
  });

  // 6. HUD 表示 ＆ 別窓計器パネル（SideCar）テレメトリ同期
  if (isHudVisible && isDrivingStarted) {
    hudZoneLabel.textContent = physState.zone.label;
    hudSpeed.textContent = physState.speedKmh.toFixed(1);
    hudSpeed.classList.toggle('over-limit', physState.speedKmh > speedLimitObj.limit + 1.0);
    hudLimit.textContent = String(speedLimitObj.limit);
    hudBc.textContent = String(Math.round(physState.bcPressure));
    hudGrade.textContent = physState.frame.gradient.toFixed(1);

    if (nextStop) {
      hudNextStation.textContent = nextStop.nameKanji;
      if (Math.abs(remainingMeters) < 1000) {
        const prefix = remainingMeters >= 0 ? '' : '過走 ';
        hudNextDist.textContent = `${prefix}${Math.abs(Math.round(remainingMeters)).toLocaleString()} m`;
      } else {
        hudNextDist.textContent = `${(remainingMeters / 1000).toFixed(2)} km`;
      }

      // 停止目標 ±50m 以内で精密停止バーをスライド表示
      if (Math.abs(remainingMeters) <= 50) {
        stopBarWrap.style.opacity = '1';
        const pct = THREE.MathUtils.clamp(50 - remainingMeters, 0, 100);
        stopBarMarker.style.left = `${pct}%`;
      } else {
        stopBarWrap.style.opacity = '0.28';
        stopBarMarker.style.left = '0%';
      }
    }
  }
  broadcastCockpitTelemetry(physState);

  // 7. 太陽シャドウ追従 & ポストプロセス描画
  atmosphere.update(cabView.trainRoot.position, elapsed);
  atmosphere.render();
}

function animate() {
  requestAnimationFrame(animate);
  if (!isRenderPaused) {
    stepFrame();
  }
}

window.__sim = {
  setPaused(p) {
    isRenderPaused = p;
    if (!p) clock.getDelta();
  },
  jumpTo(d, speedKmh = 0) {
    physics.distance = d;
    physics.speedMps = speedKmh / 3.6;
    physics.speedKmh = speedKmh;
    cabView._panelTimer = 1.0; // 計器盤を即時更新
    stepFrame();
    broadcastCockpitTelemetry(null, true);
  },
  setPreset(id) {
    atmosphere.applyPreset(id);
    stepFrame();
  },
  getState() {
    return {
      distance: physics.distance,
      speedKmh: physics.speedKmh,
      notch: physics.currentNotch.id,
      notchIndex: physics.notchIndex,
      bcPressure: physics.bcPressure,
      panelConnected: isPanelConnected,
    };
  },
  capture() {
    stepFrame();
    return canvas.toDataURL('image/png');
  },
  placeOncoming(idx, headD) {
    if (scenery.oncomingTrains[idx]) {
      scenery.oncomingTrains[idx].headD = headD;
    }
    stepFrame();
  },
  placeParallel(idx, d) {
    if (scenery.parallelTrains[idx]) {
      scenery.parallelTrains[idx].d = d;
    }
    stepFrame();
  },
  setLook(yaw, pitch) {
    cabView.lookYawOffset = yaw;
    cabView.lookPitchOffset = pitch;
    stepFrame();
  },
  setNotch(idx) {
    physics.notchIndex = idx;
    const relNotch = idx - 9;
    cabView.masconVisualAngle =
      relNotch >= 0 ? -0.04 + (relNotch / 5) * 0.44 : -0.04 + (relNotch / 9) * 0.56;
    cabView._panelTimer = 1.0;
    stepFrame();
    broadcastCockpitTelemetry(null, true);
  },
  setViewMode(mode) {
    cabView.viewMode = mode;
    cabView._applyViewMode();
    stepFrame();
  },
  startSession() {
    startDrivingSession();
    stepFrame();
  },
  setTheWorld(active) {
    setTheWorld(active, { silentToast: true });
    stepFrame();
  },
  broadcastTelemetry() {
    broadcastCockpitTelemetry(null, true);
  },
  testAllSounds() {
    sound.init();
    sound.update({ speedKmh: 12, motorEffort: 0.85, zoneType: 'viaduct_ballast', curvature: 0.0025 });
    sound.update({ speedKmh: 36, motorEffort: 0.9, zoneType: 'truss_bridge', curvature: 0 });
    sound.update({ speedKmh: 52, motorEffort: -0.65, zoneType: 'viaduct_ballast', curvature: 0 });
    sound.playNotchClick('normal');
    sound.playNotchClick('neutral');
    sound.playNotchClick('eb');
    sound.playHorn();
    sound.playDoorChime(true);
    sound.playDoorChime(false);
    sound.playDepartureMelody('nippori');
    sound.playDepartureMelody('kitasenju');
    sound.stopDepartureMelody();
    sound.playTimeStopEffect(true);
    sound.playTimeStopEffect(false);
    return { initialized: sound.isInitialized, state: sound.ctx ? sound.ctx.state : 'none' };
  },
  setSpectatorAtTrack(d, latOffset, height, lookD, lookLat = 0, lookHeight = 1.5) {
    if (!isTheWorldActive) setTheWorld(true, { silentToast: true });
    const f1 = route.getFrameAt(d);
    const r1 = new THREE.Vector3().crossVectors(f1.tangent, _specWorldUp).normalize();
    const camPos = f1.position.clone().addScaledVector(r1, latOffset);
    camPos.y += height;

    const f2 = route.getFrameAt(lookD);
    const r2 = new THREE.Vector3().crossVectors(f2.tangent, _specWorldUp).normalize();
    const target = f2.position.clone().addScaledVector(r2, lookLat);
    target.y += lookHeight;

    camera.position.copy(camPos);
    const dir = target.sub(camPos).normalize();
    specYaw = Math.atan2(-dir.x, -dir.z);
    specPitch = Math.asin(THREE.MathUtils.clamp(dir.y, -0.99, 0.99));
    camera.rotation.order = 'YXZ';
    camera.rotation.set(specPitch, specYaw, 0);
    stepFrame();
  },
  getOncomingYaws(idx) {
    const tr = scenery.oncomingTrains[idx];
    if (!tr) return [];
    const e = new THREE.Euler(0, 0, 0, 'YXZ');
    return tr.carMeshes.map((m) => {
      e.setFromQuaternion(m.quaternion, 'YXZ');
      return Number(THREE.MathUtils.radToDeg(e.y).toFixed(2));
    });
  },
};

animate();
