import { drawDriverMeterScreen } from './ui/meterRenderer.js';
import { DenGoControllerManager } from './input/dengoController.js';

const CHANNEL_NAME = 'joban-sim-cockpit';
const SNAPSHOT_KEY = 'joban-sim-cockpit-snapshot';

const meterCanvas = document.getElementById('meter-canvas');
const meterCtx = meterCanvas.getContext('2d');

// 初期状態（メイン画面と接続され次第リアルタイム同期）
let state = {
  speedKmh: 0,
  speedLimit: 55,
  notchIndex: 5,
  notchId: 'B4',
  notchType: 'brake',
  bcPressure: 340,
  mrPressure: 868,
  lineVoltage: 1500,
  motorEffort: 0,
  distance: 0,
  remainingMeters: 1200,
  doorsOpen: false,
  isTheWorldActive: false,
};

let lastRxTime = 0;
let brightnessStep = 0; // 0: 100%, 1: 82% (減光)

const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL_NAME) : null;

function sendPacket(msg) {
  if (channel) {
    try {
      channel.postMessage(msg);
    } catch {
      // ignore channel errors
    }
  }
  if (window.opener && !window.opener.closed) {
    try {
      window.opener.postMessage(msg, '*');
    } catch {
      // ignore cross-window errors
    }
  }
}

function sendCmd(action, payload = {}) {
  sendPacket({ type: 'cmd', action, ...payload });
}

// 別窓（SideCar）にOSフォーカスが移っている間も『電車でGO!』コントローラーの入力をメイン画面へシームレス転送
const panelDengo = new DenGoControllerManager({
  onNotchChange: (idx, _id, meta) => {
    sendCmd('setNotch', { index: idx, initialSync: Boolean(meta?.initialSync) });
  },
  onAction: (actionId, btnKey) => {
    sendCmd('dengoAction', { dengoAction: actionId, buttonKey: btnKey });
  },
});

function notifyFocusState() {
  const focused = typeof document.hasFocus === 'function' ? document.hasFocus() : false;
  sendPacket({ type: 'panel-focus', focused });
}
window.addEventListener('focus', notifyFocusState);
window.addEventListener('blur', notifyFocusState);

function handleTelemetryPacket(data) {
  if (!data || typeof data !== 'object') return;
  if (data.type === 'telemetry') {
    state = { ...state, ...data };
    lastRxTime = performance.now();
  }
}

if (channel) {
  channel.onmessage = (ev) => handleTelemetryPacket(ev.data);
  channel.postMessage({ type: 'panel-hello' });
}

window.addEventListener('message', (ev) => handleTelemetryPacket(ev.data));
if (window.opener && !window.opener.closed) {
  try {
    window.opener.postMessage({ type: 'panel-hello' }, '*');
  } catch {
    // ignore
  }
}
notifyFocusState();

window.addEventListener('beforeunload', () => {
  sendPacket({ type: 'panel-focus', focused: false });
  sendPacket({ type: 'panel-bye' });
});

try {
  const saved = localStorage.getItem(SNAPSHOT_KEY);
  if (saved) {
    const parsed = JSON.parse(saved);
    if (parsed && parsed.type === 'telemetry') {
      state = { ...state, ...parsed };
    }
  }
} catch {
  // ignore storage errors
}

// 画面左上 [□] タップまたはダブルクリックで全画面切替、右下 [☀] タップで実車同様の減光切替
function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen?.().catch(() => {});
  } else {
    document.exitFullscreen?.().catch(() => {});
  }
}

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

meterCanvas.addEventListener('dblclick', () => {
  toggleFullscreen();
});

// 別窓側にフォーカスがある場合もキーボード運転操作をメイン画面へそのまま転送
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
  } else if (e.code === 'KeyR' && !e.repeat) {
    e.preventDefault();
    sendCmd('toggleWeather');
  } else if (e.code === 'KeyY' && !e.repeat) {
    e.preventDefault();
    sendCmd('toggleWiper');
  } else if (e.code === 'KeyL' && !e.repeat) {
    e.preventDefault();
    sendCmd('toggleBeam');
  } else if (e.code === 'KeyB' && !e.repeat) {
    e.preventDefault();
    sendCmd('toggleSnowBrake');
  }
});

function renderLoop() {
  requestAnimationFrame(renderLoop);

  if (typeof document.hasFocus === 'function' && document.hasFocus()) {
    panelDengo.update(performance.now());
  }

  if (performance.now() - lastRxTime > 400) {
    try {
      const snap = localStorage.getItem(SNAPSHOT_KEY);
      if (snap) {
        const parsed = JSON.parse(snap);
        if (parsed && parsed.type === 'telemetry') {
          state = { ...state, ...parsed };
        }
      }
    } catch {
      // ignore
    }
  }

  drawDriverMeterScreen(meterCanvas, meterCtx, state, {
    win: window,
    dimmed: brightnessStep === 1,
  });
}

renderLoop();
