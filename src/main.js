import * as THREE from 'three';
import { RouteGeometry, STATIONS } from './world/routeData.js';
import {
  createBallastTextures,
  createConcreteTextures,
  createPlatformSurfaceTexture,
  createBuildingFacadeVariants,
  createWaterNormalTexture,
  createUrbanStreetGridTexture,
  createArterialRoadTexture,
} from './world/textures.js';
import { AtmosphereAndPost } from './world/skyAndPost.js';
import { TrackSystem } from './world/trackBuilder.js';
import { ScenerySystem } from './world/sceneryBuilder.js';
import { TrainPhysics, NOTCH_STEPS, NEUTRAL_INDEX } from './train/physics.js';
import { DriverCabView } from './train/cabView.js';
import { TrainSoundEngine } from './audio/soundEngine.js';
import { AnnouncementAndCalloutSystem } from './audio/announcements.js';
import { drawDriverMeterScreen } from './ui/meterRenderer.js';

// --- DOM 要素参照 ---
const canvas = document.getElementById('sim-canvas');
const startOverlay = document.getElementById('start-overlay');
const btnStartDrive = document.getElementById('btn-start-drive');
const hudLayer = document.getElementById('hud-layer');
const btnRestoreHud = document.getElementById('btn-restore-hud');
const statusToast = document.getElementById('status-toast');
const commsCaption = document.getElementById('comms-caption');

const hudLineBadge = document.getElementById('hud-line-badge');
const hudZoneLabel = document.getElementById('hud-zone-label');
const hudJumpSelect = document.getElementById('hud-jump-select');
const hudAtmosphereSelect = document.getElementById('hud-atmosphere-select');
const btnToggleWeather = document.getElementById('btn-toggle-weather');
const btnToggleWiper = document.getElementById('btn-toggle-wiper');
const btnToggleBeam = document.getElementById('btn-toggle-beam');
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
  urbanGround: createUrbanStreetGridTexture(maxAniso),
  arterialRoad: createArterialRoadTexture(maxAniso),
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
const cabView = new DriverCabView(scene, camera, route, scenery.rollingStock);
const sound = new TrainSoundEngine();
const announcements = new AnnouncementAndCalloutSystem(sound, commsCaption);

// --- アプリケーション状態 ---
let isDrivingStarted = false;
let isHudVisible = true;
let wasMovingSinceStop = false;
let toastTimeoutId = null;
let lastAtosCloseMs = -99999;

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

function syncWeatherAndLightButtons() {
  const isRain = atmosphere.weatherMode === 'rain';
  if (btnToggleWeather) {
    btnToggleWeather.textContent = isRain ? '天候: 雨天 (R)' : '天候: 晴 (R)';
    btnToggleWeather.classList.toggle('rain-active', isRain);
  }
  if (btnToggleWiper) {
    btnToggleWiper.textContent = cabView.wiperActive ? 'ワイパー: ON' : 'ワイパー: OFF';
    btnToggleWiper.classList.toggle('rain-active', cabView.wiperActive);
  }
  if (btnToggleBeam) {
    btnToggleBeam.textContent = cabView.headlightMode === 'high' ? '前照灯: 強' : '前照灯: 減光';
  }
  document.querySelectorAll('#weather-select .seg-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.weather === (isRain ? 'rain' : 'clear'));
  });
}

function applyWeatherMode(mode, { silentToast = false } = {}) {
  const isRain = mode === 'rain';
  atmosphere.setWeather(isRain ? 'rain' : 'clear');
  trackSystem.setWetness(isRain ? 1.0 : 0.0);
  scenery.setWetness(isRain ? 1.0 : 0.0);
  physics.setWeatherRain(isRain);
  cabView.setWeatherRain(isRain);
  sound.setRainIntensity(isRain ? 1.0 : 0.0);
  syncWeatherAndLightButtons();
  broadcastCockpitTelemetry(null, true);
  if (!silentToast && isDrivingStarted) {
    showToast(
      isRain
        ? '雨天モード：ワイパー・耐雪ブレーキ作動（レール湿潤につき制動距離にご注意ください）'
        : '晴天（ドライレール）モードへ切り替えました',
      3800
    );
  }
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

const weatherSelectEl = document.getElementById('weather-select');
if (weatherSelectEl) {
  weatherSelectEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-weather]');
    if (!btn) return;
    applyWeatherMode(btn.dataset.weather, { silentToast: true });
  });
}

function startDrivingSession() {
  if (isDrivingStarted) return;
  isDrivingStarted = true;
  sound.init();
  startOverlay.classList.add('hidden');
  hudLayer.classList.remove('hidden');
  showToast('日暮里駅 4番線 — ドラッグまたは←/→キーで運転室・客室を360°見回せます！', 4800);
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
    cabView._updatePlayerConsist(physics.distance);
    scene.updateMatrixWorld(true);
    camera.getWorldPosition(_specWorldPos);
    camera.getWorldQuaternion(_specWorldQuat);

    // 運転席マウントから切り離してワールド自由カメラへ（少し外へ出れば自分のE531系10両編成の外観を360°鑑賞可能！）
    scene.add(camera);
    camera.position.copy(_specWorldPos);
    _specEuler.setFromQuaternion(_specWorldQuat, 'YXZ');
    specYaw = _specEuler.y;
    specPitch = THREE.MathUtils.clamp(_specEuler.x, -1.52, 1.52);
    camera.rotation.order = 'YXZ';
    camera.rotation.set(specPitch, specYaw, 0);

    cabView.setSpectatorMode(true);
    sound.setTimeStopped(true);
    announcements.cancelAll();

    btnToggleWorld.classList.add('active');
    btnToggleWorld.textContent = '時間停止中 (Tで解除)';
    hudBottombar.classList.add('hidden');
    theWorldBanner.classList.remove('hidden');
    syncWorldSpeedHud();
    if (!silentToast) {
      showToast('ザ・ワールド発動 — 自列車E531系10両編成も外から鑑賞できます！（WASD移動・Tで解除）', 4200);
    }
  } else {
    cabView.eyeHolder.add(camera);
    camera.position.set(0, 0, 0);
    camera.rotation.set(0, 0, 0);
    cabView.setSpectatorMode(false);
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
    atsPatternSpeedKmh: physics.atsPatternSpeedKmh,
    atsPatternApproach: physics.atsPatternApproach,
    atsBrakeActive: physics.atsBrakeActive,
    snowBrake: physics.snowBrake,
    isRaining: physics.isRaining,
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
    atsPatternSpeedKmh: st.atsPatternSpeedKmh ?? physics.atsPatternSpeedKmh,
    atsPatternApproach: Boolean(st.atsPatternApproach ?? physics.atsPatternApproach),
    atsBrakeActive: Boolean(st.atsBrakeActive ?? physics.atsBrakeActive),
    snowBrake: Boolean(st.snowBrake ?? physics.snowBrake),
    isRaining: Boolean(st.isRaining ?? physics.isRaining),
    headlightMode: cabView.headlightMode,
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
 * 指定ウィンドウの document 内へ運転台「計器モニタ」単体画面を直接構築・マウントする
 * （Pキー別窓ポップアップ ＆ ?panel=1 単独計器モードの両方で共用）
 */
function mountCockpitPanelIntoDocument(doc, win) {
  doc.title = '計器モニタ | SideCar / 別窓ディスプレイ';
  doc.head.innerHTML = `
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no" />
    <title>計器モニタ | SideCar / 別窓ディスプレイ</title>
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; user-select: none; -webkit-user-select: none; }
      html, body { width: 100%; height: 100%; background: #0a0d11; overflow: hidden; }
      .meter-bezel {
        width: 100%; height: 100%;
        padding: clamp(4px, 1.1vmin, 14px);
        background: linear-gradient(180deg, #161a20 0%, #0b0e12 100%);
        display: flex; align-items: center; justify-content: center;
      }
      .meter-screen {
        width: 100%; height: 100%;
        background: #14181e;
        border: 2px solid #05070a;
        border-radius: 4px;
        box-shadow: inset 0 1px 4px rgba(0, 0, 0, 0.85), 0 0 0 1px rgba(255, 255, 255, 0.06);
        overflow: hidden; position: relative;
      }
      #meter-canvas { width: 100%; height: 100%; display: block; }
    </style>
  `;

  doc.body.innerHTML = `
    <main class="meter-bezel" aria-label="運転台 計器モニタ">
      <div class="meter-screen">
        <canvas id="meter-canvas" width="960" height="720"></canvas>
      </div>
    </main>
  `;

  const meterCanvas = doc.getElementById('meter-canvas');
  const meterCtx = meterCanvas.getContext('2d');

  let pState = buildCockpitTelemetry(null);
  let lastRxTime = performance.now();
  let brightnessStep = 0;

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

  const onTelemetryPacket = (data) => {
    if (!data || typeof data !== 'object') return;
    if (data.type === 'telemetry') {
      pState = { ...pState, ...data };
      lastRxTime = performance.now();
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

  const toggleFullscreen = () => {
    if (!doc.fullscreenElement) {
      doc.documentElement.requestFullscreen?.().catch(() => {});
    } else {
      doc.exitFullscreen?.().catch(() => {});
    }
  };

  meterCanvas.addEventListener('click', (e) => {
    const rect = meterCanvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const nx = (e.clientX - rect.left) / rect.width;
    const ny = (e.clientY - rect.top) / rect.height;
    if (nx < 0.075 && ny < 0.085) {
      toggleFullscreen();
    } else if (nx > 0.91 && ny > 0.89) {
      brightnessStep = (brightnessStep + 1) % 2;
    }
  });
  meterCanvas.addEventListener('dblclick', toggleFullscreen);

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

  const renderPanelFrame = () => {
    if (win.closed) return;
    win.requestAnimationFrame(renderPanelFrame);

    if (performance.now() - lastRxTime > 400) {
      try {
        const snap = localStorage.getItem(COCKPIT_SNAPSHOT_KEY);
        if (snap) {
          const parsed = JSON.parse(snap);
          if (parsed && parsed.type === 'telemetry') {
            pState = { ...pState, ...parsed };
          }
        }
      } catch {
        // ignore
      }
    }

    drawDriverMeterScreen(meterCanvas, meterCtx, pState, {
      win,
      dimmed: brightnessStep === 1,
    });
  };

  renderPanelFrame();
}

function openInstrumentPanel() {
  sound.init();
  if (panelPopupWindow && !panelPopupWindow.closed) {
    panelPopupWindow.focus();
    broadcastCockpitTelemetry(null, true);
    showToast('計器モニタを前面に表示しました（SideCar / サブ画面へ移動可能）', 3200);
    return;
  }

  // 実車計器モニタと同じ約 4:3 比率のウィンドウを開き、その場で計器モニタ Canvas を直接マウント
  const features =
    'width=960,height=740,menubar=no,toolbar=no,location=no,status=no,resizable=yes';
  let win = null;
  try {
    win = window.open('', 'joban_cockpit_panel', features);
  } catch {
    win = null;
  }

  if (!win) {
    showToast(
      '別窓がブロックされました。ブラウザ右上のポップアップ許可、または panel.html を別タブで開いてください！',
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
    const url = new URL(window.location.href);
    url.searchParams.set('panel', '1');
    win.location.href = url.toString();
  }

  broadcastCockpitTelemetry(null, true);
  showToast(
    '計器モニタを起動しました！iPad (SideCar) やサブ画面へドラッグして前面展望 (V) で遊べます',
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
      case 'toggleWeather':
        applyWeatherMode(atmosphere.weatherMode === 'rain' ? 'clear' : 'rain');
        break;
      case 'toggleWiper':
        handleToggleWiper();
        break;
      case 'toggleBeam':
        handleToggleBeam();
        break;
      case 'toggleSnowBrake':
        handleToggleSnowBrake();
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
      announcements.reset(targetD);
      wasMovingSinceStop = false;
      sound.stopDepartureMelody();
      sound.setAtsChimeActive(false);
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

function handleToggleWeather() {
  sound.init();
  applyWeatherMode(atmosphere.weatherMode === 'rain' ? 'clear' : 'rain');
}
if (btnToggleWeather) {
  btnToggleWeather.addEventListener('click', () => {
    handleToggleWeather();
    btnToggleWeather.blur();
  });
}

function handleToggleWiper() {
  sound.init();
  sound.playSwitchClick();
  const active = cabView.toggleWiper();
  sound.playWiperBlade(1);
  syncWeatherAndLightButtons();
  showToast(active ? 'フロントワイパー：動作開始 (Y)' : 'フロントワイパー：停止・格納 (Y)', 2200);
}
if (btnToggleWiper) {
  btnToggleWiper.addEventListener('click', () => {
    handleToggleWiper();
    btnToggleWiper.blur();
  });
}

function handleToggleBeam() {
  sound.init();
  sound.playSwitchClick();
  const mode = cabView.toggleHeadlightBeam();
  syncWeatherAndLightButtons();
  broadcastCockpitTelemetry(null, true);
  showToast(
    mode === 'high' ? '前照灯：ハイビーム（遠方照射）' : '前照灯：ロービーム（対向列車すれ違い減光）',
    2200
  );
}
if (btnToggleBeam) {
  btnToggleBeam.addEventListener('click', () => {
    handleToggleBeam();
    btnToggleBeam.blur();
  });
}

function handleToggleSnowBrake() {
  sound.init();
  sound.playSwitchClick();
  const on = physics.toggleSnowBrake();
  broadcastCockpitTelemetry(null, true);
  showToast(on ? '耐雪ブレーキ：ON（制輪子予熱圧保持）' : '耐雪ブレーキ：OFF', 2400);
}

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
  if (sound.isMuted) announcements.cancelAll();
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
  const platSt = physics.getCurrentStationAtPlatform();
  if (sound.isMelodyPlaying) {
    sound.stopDepartureMelody();
    if (platSt && performance.now() - lastAtosCloseMs > 4500) {
      lastAtosCloseMs = performance.now();
      announcements.onDoorsClosing(platSt);
    } else {
      showToast('発車メロディを停止しました', 1800);
    }
    return;
  }
  let targetSt = platSt;
  if (!targetSt) {
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
  const melodyTitle = sound.getMelodyTitle(stId);
  sound.playDepartureMelody(stId);
  showToast(`♪ ${stName}駅『${melodyTitle}』再生中（もう一度 F で戸閉放送 / D で戸閉）`, 3800);
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
  const platSt = physics.getCurrentStationAtPlatform();
  if (!res.doorsOpen) {
    sound.stopDepartureMelody();
    if (platSt && performance.now() - lastAtosCloseMs > 4500) {
      lastAtosCloseMs = performance.now();
      announcements.onDoorsClosing(platSt);
    }
  }
  sound.playDoorChime(res.doorsOpen);
  syncDoorButton();
  syncNotchHud();
  broadcastCockpitTelemetry(null, true);
  showToast(res.doorsOpen ? '客室扉を開けました（発車時はFでメロディ→Dで閉扉）' : '戸閉完了 — 発車可能です', 2800);
}
btnDoors.addEventListener('click', handleDoorToggle);

// --- キーボード操作（ワンハンドル直感キー ＆ 360°視点キー ＆ ザ・ワールド自由移動） ---
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

  // 別窓計器パネル (P)・天候(R)・時間帯切替・HUD非表示は時間停止中でも共通利用可能
  if (e.code === 'KeyP' && !e.repeat) {
    e.preventDefault();
    openInstrumentPanel();
    return;
  }
  if (e.code === 'KeyR' && !e.repeat) {
    e.preventDefault();
    handleToggleWeather();
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

  // 運転中の 360° キーボード見回し（← / → で水平360°回転、Shift + ↑ / ↓ で上下チルト、C で正面リセット）
  if (
    e.code === 'ArrowLeft' ||
    e.code === 'ArrowRight' ||
    e.code === 'ShiftLeft' ||
    e.code === 'ShiftRight'
  ) {
    e.preventDefault();
    heldKeys.add(e.code);
    return;
  }
  if ((e.code === 'ArrowUp' || e.code === 'ArrowDown') && e.shiftKey) {
    e.preventDefault();
    heldKeys.add(e.code);
    return;
  }
  if (e.code === 'KeyC' && !e.repeat) {
    e.preventDefault();
    cabView.resetLookOffset();
    showToast('視点を正面へリセットしました', 1600);
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
    case 'KeyY': {
      if (!e.repeat) {
        e.preventDefault();
        handleToggleWiper();
      }
      break;
    }
    case 'KeyL': {
      if (!e.repeat) {
        e.preventDefault();
        handleToggleBeam();
      }
      break;
    }
    case 'KeyB': {
      if (!e.repeat) {
        e.preventDefault();
        handleToggleSnowBrake();
      }
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

// --- マウスドラッグ 360° 視点回転 ＆ ホイール移動速度調整 ---
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
    cabView.addLookOffset(-dx * 0.0032, -dy * 0.0030);
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

function stepFrame({ skipRender = false, fixedDt = null } = {}) {
  const rawDt = fixedDt !== null ? fixedDt : Math.min(clock.getDelta(), 0.1);
  const elapsed = clock.elapsedTime + (fixedDt !== null ? fixedDt : 0);

  // ザ・ワールド発動中：全物理・対向車・並走車・音声を完全停止し、自由スペクテイターカメラのみ駆動！
  if (isTheWorldActive) {
    updateSpectatorCamera(rawDt);
    broadcastCockpitTelemetry(null);
    atmosphere.update(camera.position, frozenElapsed);
    if (!skipRender) atmosphere.render();
    return;
  }

  const dt = rawDt;

  // 1. 車両縦物理・ブレーキ圧・ATS-Pパターン・分岐器揺れ・停止カックン判定の更新
  const physState = physics.update(dt, {
    onRailJoint: (jointEvt) => {
      cabView.triggerJointImpulse(jointEvt);
      sound.playRailJoint(jointEvt);
    },
    onBrakeAirRelease: (strength) => {
      sound.playBrakeAirRelease(strength);
    },
    onTurnoutJolt: (strength) => {
      cabView.triggerTurnoutJolt(strength);
    },
    onStopJerk: (bcAtStop) => {
      cabView.triggerStopJerk(bcAtStop);
    },
    onAtsEvent: (evt) => {
      if (evt.type === 'brake_apply') {
        sound.setAtsChimeActive(true);
      } else if (evt.type === 'brake_release') {
        sound.setAtsChimeActive(false);
      } else if (evt.type === 'pattern_approach') {
        sound.playAtsChimePair();
      }
      announcements.onAtsEvent(evt);
    },
  });
  sound.setAtsChimeActive(Boolean(physState.atsBrakeActive));

  if (physState.speedKmh > 3.5) {
    wasMovingSinceStop = true;
  } else if (wasMovingSinceStop && physState.speedKmh === 0) {
    wasMovingSinceStop = false;
    const atStation = physics.getCurrentStationAtPlatform();
    if (atStation) {
      const diff = physState.distance - atStation.stopDistance;
      const signStr = diff >= 0 ? `+${diff.toFixed(2)}` : diff.toFixed(2);
      announcements.onStationStop(atStation, diff);
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

  // 2. 次停車駅・制限速度・閉塞信号機・自動放送＆指差喚呼の更新
  const nextStop = physics.getNextScheduledStop();
  const remainingMeters = nextStop ? nextStop.stopDistance - physState.distance : 0;
  const speedLimitObj = route.getSpeedLimitAt(physState.distance);

  trackSystem.updateSignals(physState.distance, nextStop ? nextStop.stopDistance : null);
  announcements.update({
    distance: physState.distance,
    speedKmh: physState.speedKmh,
    serviceType: physics.serviceType,
    doorsOpen: physics.doorsOpen,
    isDrivingStarted,
  });

  // 3. 沿線風景（隅田川さざ波・航空障害灯・幹線道路交通・上り対向列車）更新
  scenery.update(dt, elapsed, physState.distance, () => {
    sound.playPassingTrainWhoosh();
  });

  // 4. 3D運転台・360°見回し・6自由度サスペンション・駅照明連動・ワイパー・3D計器盤更新
  const yawKey = (heldKeys.has('ArrowLeft') ? 1 : 0) - (heldKeys.has('ArrowRight') ? 1 : 0);
  const pitchKey =
    heldKeys.has('ShiftLeft') || heldKeys.has('ShiftRight')
      ? (heldKeys.has('ArrowUp') ? 1 : 0) - (heldKeys.has('ArrowDown') ? 1 : 0)
      : 0;
  if (yawKey !== 0 || pitchKey !== 0) {
    cabView.addLookOffset(yawKey * 1.85 * dt, pitchKey * 1.35 * dt);
  }

  cabView.update(dt, elapsed, {
    ...physState,
    notch: physics.currentNotch,
    notchIndex: physics.notchIndex,
    doorsOpen: physics.doorsOpen,
    serviceType: physics.serviceType,
    speedLimit: speedLimitObj.limit,
    nextStopName: nextStop ? nextStop.nameKanji : '北千住',
    remainingMeters,
    onWiperReversal: (dir) => {
      sound.playWiperBlade(dir);
    },
  });

  // 5. Web Audio 連続走行音更新（VVVF・転動・鉄橋・フランジ・雨音・低速制輪子摩擦・CP空気圧縮機）
  sound.update({
    speedKmh: physState.speedKmh,
    motorEffort: physState.motorEffort,
    zoneType: physState.zone.type,
    curvature: physState.frame.curvature,
    bcPressure: physState.bcPressure,
    mrPressure: physState.mrPressure,
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
  if (!skipRender) {
    atmosphere.render();
  }
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
    announcements.reset(d);
    cabView._panelTimer = 1.0; // 計器盤を即時更新
    stepFrame({ skipRender: isRenderPaused, fixedDt: 0.016 });
    broadcastCockpitTelemetry(null, true);
  },
  stepDt(fixedDt = 0.05, steps = 1) {
    for (let i = 0; i < steps; i++) {
      stepFrame({ skipRender: true, fixedDt });
    }
  },
  setPreset(id) {
    atmosphere.applyPreset(id);
    if (!isRenderPaused) stepFrame();
  },
  setWeather(mode) {
    applyWeatherMode(mode, { silentToast: true });
    cabView._panelTimer = 1.0;
    if (!isRenderPaused) stepFrame();
  },
  toggleWiper() {
    const res = cabView.toggleWiper();
    syncWeatherAndLightButtons();
    if (!isRenderPaused) stepFrame();
    return res;
  },
  setHeadlightMode(mode) {
    cabView.setHeadlightMode(mode);
    syncWeatherAndLightButtons();
    if (!isRenderPaused) stepFrame();
  },
  getState() {
    return {
      distance: physics.distance,
      speedKmh: physics.speedKmh,
      notch: physics.currentNotch.id,
      notchIndex: physics.notchIndex,
      bcPressure: physics.bcPressure,
      mrPressure: physics.mrPressure,
      atsPatternSpeedKmh: physics.atsPatternSpeedKmh,
      atsPatternApproach: physics.atsPatternApproach,
      atsBrakeActive: physics.atsBrakeActive,
      snowBrake: physics.snowBrake,
      weatherMode: atmosphere.weatherMode,
      wiperActive: cabView.wiperActive,
      headlightMode: cabView.headlightMode,
      lookYaw: cabView.lookYawOffset,
      lookPitch: cabView.lookPitchOffset,
      playerCarCount: cabView.playerCars ? cabView.playerCars.length : 0,
      stationLightLevel: cabView.stationLightLevel,
      roadVehicleCount: scenery.roadVehicles.length,
      renderCalls: renderer.info.render.calls,
      renderTriangles: renderer.info.render.triangles,
      panelConnected: isPanelConnected,
    };
  },
  capture() {
    cabView._panelTimer = 1.0;
    stepFrame({ skipRender: false, fixedDt: 0.016 });
    return canvas.toDataURL('image/png');
  },
  placeOncoming(idx, headD) {
    if (scenery.oncomingTrains[idx]) {
      scenery.oncomingTrains[idx].headD = headD;
    }
    if (!isRenderPaused) stepFrame();
  },
  placeParallel(idx, d) {
    if (scenery.parallelTrains[idx]) {
      scenery.parallelTrains[idx].d = d;
    }
    if (!isRenderPaused) stepFrame();
  },
  setLook(yaw, pitch) {
    cabView.lookYawOffset = yaw;
    cabView.lookPitchOffset = pitch;
    if (!isRenderPaused) stepFrame();
  },
  setNotch(idx) {
    physics.notchIndex = idx;
    const relNotch = idx - 9;
    cabView.masconVisualAngle =
      relNotch >= 0 ? -0.04 + (relNotch / 5) * 0.44 : -0.04 + (relNotch / 9) * 0.56;
    cabView._panelTimer = 1.0;
    if (!isRenderPaused) stepFrame();
    broadcastCockpitTelemetry(null, true);
  },
  setViewMode(mode) {
    cabView.viewMode = mode;
    cabView._applyViewMode();
    if (!isRenderPaused) stepFrame();
  },
  startSession() {
    startDrivingSession();
    if (!isRenderPaused) stepFrame();
  },
  setTheWorld(active) {
    setTheWorld(active, { silentToast: true });
    if (!isRenderPaused) stepFrame();
  },
  broadcastTelemetry() {
    broadcastCockpitTelemetry(null, true);
  },
  testAllSounds() {
    sound.init();
    sound.setRainIntensity(1.0);
    sound.update({
      speedKmh: 8,
      motorEffort: -0.5,
      zoneType: 'viaduct_ballast',
      curvature: 0.0025,
      bcPressure: 210,
      mrPressure: 790,
    });
    sound.update({ speedKmh: 36, motorEffort: 0.9, zoneType: 'truss_bridge', curvature: 0 });
    sound.update({ speedKmh: 52, motorEffort: -0.65, zoneType: 'viaduct_ballast', curvature: 0 });
    sound.setRainIntensity(0.0);
    sound.playSwitchClick();
    sound.playNotchClick('normal');
    sound.playNotchClick('neutral');
    sound.playNotchClick('eb');
    sound.playHorn();
    sound.playDoorChime(true);
    sound.playDoorChime(false);
    sound.playConductorBuzzer();
    sound.playOnboardChime();
    sound.playWiperBlade(1);
    sound.playAtsChimePair();
    sound.setAtsChimeActive(true);
    sound.setAtsChimeActive(false);
    sound.playDepartureMelody('nippori');
    sound.playDepartureMelody('mikawashima');
    sound.playDepartureMelody('minamisenju');
    sound.playDepartureMelody('kitasenju');
    sound.stopDepartureMelody();
    sound.playTimeStopEffect(true);
    sound.playTimeStopEffect(false);
    return {
      initialized: sound.isInitialized,
      state: sound.ctx ? sound.ctx.state : 'none',
      titles: ['nippori', 'mikawashima', 'minamisenju', 'kitasenju'].map((id) =>
        sound.getMelodyTitle(id)
      ),
    };
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
    if (!isRenderPaused) stepFrame();
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
