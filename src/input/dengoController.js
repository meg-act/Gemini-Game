import { NOTCH_STEPS, NEUTRAL_INDEX } from '../train/notchConstants.js';

const STORAGE_KEY = 'joban-dengo-settings-v1';

/**
 * 対応プロファイル一覧
 *   - auto           : Gamepad ID / mapping / 16ボタン特徴から JC-PS101USV・標準PS・瑞起を自動判定
 *   - jc_ps101       : ELECOM JC-PS101USV / JC-PS201USV / MP-8888 等 (Raw HID 配列)
 *   - ps_standard    : macOS Safari / Chrome W3C "standard" リマップ適用時の PlayStation 配列
 *   - jc_ps101_swap  : 他社 PS→USB 変換機互換 (L1/R1 と L2/R2 が入れ替わるタイプ)
 *   - zuiki_onehandle: 瑞起 (ZUIKI) ワンハンドルマスコン for Switch / PC (Y軸15段)
 *   - calibrated     : 実機キャリブレーションウィザードで記録した専用真理値テーブル
 */
export const CONTROLLER_PROFILES = [
  {
    id: 'auto',
    label: '自動判定（推奨：JC-PS101USV / PS変換機 / 瑞起マスコン）',
  },
  {
    id: 'jc_ps101',
    label: 'ELECOM JC-PS101USV / JC-PS201USV（Raw HID 標準）',
  },
  {
    id: 'ps_standard',
    label: 'PlayStation 標準リマップ（W3C Standard / Safari等）',
  },
  {
    id: 'jc_ps101_swap',
    label: '他社 PS変換アダプタ互換（L1/R1 ⇔ L2/R2 入替型）',
  },
  {
    id: 'zuiki_onehandle',
    label: '瑞起 (ZUIKI) ワンハンドルマスコン（USB アナログ軸）',
  },
  {
    id: 'calibrated',
    label: '実機キャリブレーション学習データを使用',
  },
];

export const BRAKE_CURVE_MODES = [
  {
    id: 'direct_8',
    label: 'ワンハンドル / 2ハンドル標準（B1〜B8 直結 ＋ 非常EB）',
  },
  {
    id: 'scale_13',
    label: '2ハンドル深制動全域（常用13段を B1〜B8 に均等割当 ＋ EB）',
  },
];

export const BUTTON_ACTIONS = [
  { id: 'horn_elec', label: '電笛（短警笛）※開始画面では運転開始' },
  { id: 'horn_air', label: '空笛（タイフォン本警笛）' },
  { id: 'context_door_eb', label: '停車中: ドア開閉 ／ 走行中・警報中: EBリセット' },
  { id: 'doors', label: 'ドア開閉のみ (D)' },
  { id: 'eb_reset', label: 'EBリセットボタンのみ (X)' },
  { id: 'melody', label: '駅発車メロディ ON/OFF (F)' },
  { id: 'view_toggle', label: '視点切替 (V) ／ 長押し: ザ・ワールド (T)' },
  { id: 'reset_look', label: '視点を正面へリセット (C)' },
  { id: 'wiper', label: 'ワイパー動作 ON/OFF (Y)' },
  { id: 'headlight', label: '前照灯 ハイビーム/減光 (L)' },
  { id: 'snow_brake', label: '耐雪ブレーキ ON/OFF (B)' },
  { id: 'the_world', label: 'ザ・ワールド 時間停止切替 (T)' },
  { id: 'none', label: '割り当てなし' },
];

export const DEFAULT_BUTTON_MAP = {
  a: 'horn_elec',
  b: 'horn_air',
  c: 'context_door_eb',
  select: 'melody',
  start: 'view_toggle',
};

export const CALIBRATION_NOTCH_STEPS = NOTCH_STEPS.map((step, index) => ({
  index,
  id: step.id,
  label: step.label,
}));

export const CALIBRATION_BUTTON_STEPS = [
  { key: 'a', label: 'A ボタン（□）' },
  { key: 'b', label: 'B ボタン（×）' },
  { key: 'c', label: 'C ボタン（○）' },
  { key: 'select', label: 'SELECT ボタン' },
  { key: 'start', label: 'START ボタン' },
];

/**
 * PlayStation『電車でGO!』専用コントローラー ブレーキ4bitデコード表
 * b_val = (R2 << 3) | (R1 << 2) | (L2 << 1) | L1
 *   14 (1110): 緩解 (B0 — N / P1〜P5 領域)
 *   13 (1101): B1  ...  6 (0110): B8
 *   5〜1     : 2ハンドル深制動域（ワンハンドルでは接点通過ノイズになり得るため時間フィルタ併用）
 *   0  (0000): EB (非常ブレーキ)
 *   15 (1111): 接点移動中の一瞬のオープン/ショート遷移ノイズ → 無効 (-1)
 */
const PS_BRAKE_CODE_TO_STEP14 = {
  14: 0,  // 緩解 (B0)
  13: 1,  // B1
  12: 2,  // B2
  11: 3,  // B3
  10: 4,  // B4
  9: 5,   // B5
  8: 6,   // B6
  7: 7,   // B7
  6: 8,   // B8
  5: 9,   // B9  (2ハンドル無段階域)
  4: 10,  // B10
  3: 11,  // B11
  2: 12,  // B12
  1: 13,  // B13
  0: 14,  // EB (非常)
};

/**
 * PlayStation『電車でGO!』専用コントローラー マスコン3bitデコード表
 * キー: `${right},${left},${triangle}`
 */
const PS_MASCON_PAT_TO_POWER = {
  '1,1,0': 0, // N
  '1,0,1': 1, // P1
  '1,0,0': 2, // P2
  '0,1,1': 3, // P3
  '0,1,0': 4, // P4
  '0,0,1': 5, // P5
};

/**
 * 瑞起ワンハンドルマスコン Y軸 (axes[1]) 閾値テーブル (EB=-1.0 〜 N=0.0 〜 P5=+1.0)
 */
const ZUIKI_AXIS_CENTERS = [
  -1.0,   // 0: EB
  -0.85,  // 1: B8
  -0.75,  // 2: B7
  -0.65,  // 3: B6
  -0.54,  // 4: B5
  -0.43,  // 5: B4
  -0.32,  // 6: B3
  -0.21,  // 7: B2
  -0.10,  // 8: B1
  0.0,    // 9: N
  0.20,   // 10: P1
  0.40,   // 11: P2
  0.60,   // 12: P3
  0.80,   // 13: P4
  1.0,    // 14: P5
];

function quantizeAxis(v) {
  if (!Number.isFinite(v)) return 0;
  if (Math.abs(v) < 0.25) return 0;
  return Math.round(v * 10) / 10;
}

function isBtnPressed(buttons, idx) {
  if (!buttons || idx < 0 || idx >= buttons.length) return false;
  const b = buttons[idx];
  if (typeof b === 'object' && b !== null) {
    return Boolean(b.pressed || b.value > 0.5);
  }
  return Boolean(b);
}

/**
 * HID Hat Switch (0..7 or -1..+1 形式) から Left / Right を抽出
 */
function decodeHatLeftRight(axisVal) {
  if (!Number.isFinite(axisVal)) return null;
  // Chromium macOS Raw HID Hat Switch 典型値:
  // North=-1.0, NE=-0.714, E=-0.42857, SE=-0.14285, S=+0.14285, SW=+0.42857, W=+0.71428, NW=+1.0, Center > 1.1 or 0
  if (Math.abs(axisVal) > 1.05) return { left: 0, right: 0 };
  const eDist = Math.min(
    Math.abs(axisVal - (-5 / 7)),
    Math.abs(axisVal - (-3 / 7)),
    Math.abs(axisVal - (-1 / 7))
  );
  const wDist = Math.min(
    Math.abs(axisVal - (3 / 7)),
    Math.abs(axisVal - (5 / 7)),
    Math.abs(axisVal - 1.0)
  );
  if (eDist < 0.06) return { left: 0, right: 1 };
  if (wDist < 0.06) return { left: 1, right: 0 };
  return null;
}

export class DenGoControllerManager {
  constructor({ onNotchChange, onAction, onConnectionChange } = {}) {
    this.onNotchChange = onNotchChange || (() => {});
    this.onAction = onAction || (() => {});
    this.onConnectionChange = onConnectionChange || (() => {});

    // ユーザー設定（localStorage 永続化）
    this.profile = 'auto';
    this.brakeCurveMode = 'direct_8';
    this.buttonMap = { ...DEFAULT_BUTTON_MAP };
    this.calibration = null; // { notchSignatures: [...15], brakeBtnMask, masconBtnMask, axesUsed: [], buttonIndices: {a,b,c,select,start} }

    this._loadSettings();

    // 接続状態
    this.connected = false;
    this.activeSource = 'none'; // 'gamepad' | 'webhid' | 'mock' | 'none'
    this.controllerId = '';
    this.controllerMapping = '';
    this.resolvedProfile = 'jc_ps101';

    // ノッチ確定＆チャタリング除去ステート
    this.confirmedNotchIndex = null;
    this._candidateNotchIndex = null;
    this._candidateSinceMs = 0;
    this._deepBrakeSinceMs = 0;
    this._lastCommittedBrakeStep = 0; // 2ハンドルインターロック用
    this._lastValidPowerStep = 0;

    // ボタンエッジ＆長押し検出ステート
    this._btnState = {
      a: { held: false, rawHeld: false, rawSinceMs: 0, longFired: false, pressedAtMs: 0 },
      b: { held: false, rawHeld: false, rawSinceMs: 0, longFired: false, pressedAtMs: 0 },
      c: { held: false, rawHeld: false, rawSinceMs: 0, longFired: false, pressedAtMs: 0 },
      select: { held: false, rawHeld: false, rawSinceMs: 0, longFired: false, pressedAtMs: 0 },
      start: { held: false, rawHeld: false, rawSinceMs: 0, longFired: false, pressedAtMs: 0 },
    };

    // キャリブレーション進行状態
    this.calibrationWizard = {
      active: false,
      mode: null, // 'notches' | 'buttons'
      stepIndex: 0,
      recordedNotches: [],
      recordedButtons: {},
      baselinePressedSet: new Set(),
    };

    // WebHID 直接接続ステート
    this.hidDevice = null;
    this._hidVirtualPad = null;

    // テスト用モック入力
    this._mockPad = null;

    // 診断スナップショット（UIモニター表示用）
    this._lastDiag = {
      connected: false,
      source: 'none',
      id: '',
      mapping: '',
      profile: this.profile,
      resolvedProfile: 'jc_ps101',
      confirmedNotchIndex: null,
      confirmedNotchId: '---',
      rawNotchIndex: -1,
      pressedIndices: [],
      axes: [],
      brakeCode: null,
      powerPat: '',
      dpadSource: '',
      buttonsHeld: { a: false, b: false, c: false, select: false, start: false },
    };

    this._bindBrowserEvents();
  }

  _loadSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        if (CONTROLLER_PROFILES.some((p) => p.id === parsed.profile)) {
          this.profile = parsed.profile;
        }
        if (BRAKE_CURVE_MODES.some((m) => m.id === parsed.brakeCurveMode)) {
          this.brakeCurveMode = parsed.brakeCurveMode;
        }
        if (parsed.buttonMap && typeof parsed.buttonMap === 'object') {
          for (const k of Object.keys(DEFAULT_BUTTON_MAP)) {
            if (BUTTON_ACTIONS.some((a) => a.id === parsed.buttonMap[k])) {
              this.buttonMap[k] = parsed.buttonMap[k];
            }
          }
        }
        if (parsed.calibration && typeof parsed.calibration === 'object') {
          this.calibration = parsed.calibration;
        }
      }
    } catch {
      // ignore storage read error
    }
  }

  saveSettings() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          profile: this.profile,
          brakeCurveMode: this.brakeCurveMode,
          buttonMap: this.buttonMap,
          calibration: this.calibration,
        })
      );
    } catch {
      // ignore storage quota error
    }
  }

  setProfile(profileId) {
    if (!CONTROLLER_PROFILES.some((p) => p.id === profileId)) return;
    this.profile = profileId;
    this._candidateNotchIndex = null;
    this.saveSettings();
  }

  setBrakeCurveMode(modeId) {
    if (!BRAKE_CURVE_MODES.some((m) => m.id === modeId)) return;
    this.brakeCurveMode = modeId;
    this._candidateNotchIndex = null;
    this.saveSettings();
  }

  setButtonAction(btnKey, actionId) {
    if (!(btnKey in this.buttonMap)) return;
    if (!BUTTON_ACTIONS.some((a) => a.id === actionId)) return;
    this.buttonMap[btnKey] = actionId;
    this.saveSettings();
  }

  resetCalibration() {
    this.calibration = null;
    if (this.profile === 'calibrated') {
      this.profile = 'auto';
    }
    this.confirmedNotchIndex = null;
    this._candidateNotchIndex = null;
    this.saveSettings();
  }

  /**
   * 現在の物理ハンドル位置を即座に車両側へ再同期する
   */
  syncCurrentNotchNow() {
    if (this.confirmedNotchIndex !== null && this.confirmedNotchIndex >= 0) {
      const step = NOTCH_STEPS[this.confirmedNotchIndex];
      this.onNotchChange(this.confirmedNotchIndex, step.id, { manualSync: true });
    }
  }

  _bindBrowserEvents() {
    if (typeof window === 'undefined') return;
    window.addEventListener('gamepadconnected', () => {
      // 次フレームの update() で即座に詳細検出・通知
    });
    window.addEventListener('gamepaddisconnected', () => {
      // 次フレームの update() で切断反映
    });
  }

  /**
   * 複数ゲームパッド接続時に『電車でGO!』変換機 (ELECOM / MP-8888 / USB GamePad / ZUIKI) を最優先で選択
   */
  _pickActiveGamepad() {
    if (this._mockPad) {
      return { pad: this._mockPad, source: 'mock' };
    }
    if (this._hidVirtualPad) {
      return { pad: this._hidVirtualPad, source: 'webhid' };
    }
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') {
      return { pad: null, source: 'none' };
    }

    let pads = [];
    try {
      pads = Array.from(navigator.getGamepads() || []).filter((p) => p && p.connected);
    } catch {
      pads = [];
    }
    if (pads.length === 0) return { pad: null, source: 'none' };

    const scorePad = (p) => {
      const id = String(p.id || '').toLowerCase();
      let score = 10;
      if (/056e|jc-ps|elecom|mp-8888|8888|0925|twin usb|usb gamepad|usb joystick|0e8f/i.test(id)) {
        score += 100;
      }
      if (/zuiki|mascon|densha|taito|tcp|slph|0ae4|33dd/i.test(id)) {
        score += 110;
      }
      if ((p.buttons?.length || 0) >= 10) score += 15;
      return score;
    };

    pads.sort((a, b) => scorePad(b) - scorePad(a));
    return { pad: pads[0], source: 'gamepad' };
  }

  /**
   * auto プロファイル時の実効プロファイル解決
   */
  _resolveProfile(pad) {
    if (this.profile === 'calibrated' && this.calibration?.notchSignatures?.length === 15) {
      return 'calibrated';
    }
    if (this.profile !== 'auto' && this.profile !== 'calibrated') {
      return this.profile;
    }

    const id = String(pad.id || '').toLowerCase();
    if (/zuiki|mascon|0ae4|33dd/i.test(id)) {
      return 'zuiki_onehandle';
    }

    // W3C Standard リマップが適用されている場合 (Safari / Chrome 一部パッド定義)
    if (pad.mapping === 'standard') {
      return 'ps_standard';
    }

    // デフォルトは ELECOM JC-PS101USV / JC-PS201USV / MP-8888 Raw HID 配列
    return 'jc_ps101';
  }

  /**
   * PlayStation『電車でGO!』ビットパターンのデコード
   */
  _decodePlayStationDenGo(pad, variant, nowMs) {
    const btns = pad.buttons || [];
    const axes = pad.axes || [];

    let tri = 0;
    let l1 = 0;
    let r1 = 0;
    let l2 = 0;
    let r2 = 0;
    let btnA = false;
    let btnB = false;
    let btnC = false;
    let btnSelect = false;
    let btnStart = false;

    if (variant === 'ps_standard') {
      // W3C Standard Gamepad 配置
      btnB = isBtnPressed(btns, 0);      // Cross (×)
      btnC = isBtnPressed(btns, 1);      // Circle (○)
      btnA = isBtnPressed(btns, 2);      // Square (□)
      tri = isBtnPressed(btns, 3) ? 1 : 0; // Triangle (△)
      l1 = isBtnPressed(btns, 4) ? 1 : 0;
      r1 = isBtnPressed(btns, 5) ? 1 : 0;
      l2 = isBtnPressed(btns, 6) ? 1 : 0;
      r2 = isBtnPressed(btns, 7) ? 1 : 0;
      btnSelect = isBtnPressed(btns, 8);
      btnStart = isBtnPressed(btns, 9);
    } else if (variant === 'jc_ps101_swap') {
      // 他社 PS変換アダプタ互換 (0:△, 1:○, 2:×, 3:□, 4:L1, 5:R1, 6:L2, 7:R2)
      tri = isBtnPressed(btns, 0) ? 1 : 0;
      btnC = isBtnPressed(btns, 1);
      btnB = isBtnPressed(btns, 2);
      btnA = isBtnPressed(btns, 3);
      l1 = isBtnPressed(btns, 4) ? 1 : 0;
      r1 = isBtnPressed(btns, 5) ? 1 : 0;
      l2 = isBtnPressed(btns, 6) ? 1 : 0;
      r2 = isBtnPressed(btns, 7) ? 1 : 0;
      btnStart = isBtnPressed(btns, 8);
      btnSelect = isBtnPressed(btns, 9);
    } else {
      // ELECOM JC-PS101USV / JC-PS201USV / MP-8888 標準 Raw HID 配置
      // 0:△, 1:○(C), 2:×(B), 3:□(A), 4:L2, 5:R2, 6:L1, 7:R1, 8:START, 9:SELECT
      tri = isBtnPressed(btns, 0) ? 1 : 0;
      btnC = isBtnPressed(btns, 1);
      btnB = isBtnPressed(btns, 2);
      btnA = isBtnPressed(btns, 3);
      l2 = isBtnPressed(btns, 4) ? 1 : 0;
      r2 = isBtnPressed(btns, 5) ? 1 : 0;
      l1 = isBtnPressed(btns, 6) ? 1 : 0;
      r1 = isBtnPressed(btns, 7) ? 1 : 0;
      btnStart = isBtnPressed(btns, 8);
      btnSelect = isBtnPressed(btns, 9);
    }

    // ボタンのみ個別学習されている場合はオーバーライド
    if (this.calibration?.buttonIndices) {
      const bi = this.calibration.buttonIndices;
      if (Number.isInteger(bi.a)) btnA = isBtnPressed(btns, bi.a);
      if (Number.isInteger(bi.b)) btnB = isBtnPressed(btns, bi.b);
      if (Number.isInteger(bi.c)) btnC = isBtnPressed(btns, bi.c);
      if (Number.isInteger(bi.select)) btnSelect = isBtnPressed(btns, bi.select);
      if (Number.isInteger(bi.start)) btnStart = isBtnPressed(btns, bi.start);
    }

    // D-Pad Left / Right 抽出
    //   1. 16ボタン独立出力時:
    //      - ELECOM Raw 16btn 配列 (12:Up=1, 13:Right, 14:Down=1, 15:Left)
    //      - W3C Standard 16btn 配列 (12:Up=1, 13:Down=1, 14:Left, 15:Right)
    //   2. 12ボタン + X軸 (axes[0]) 出力時 (ELECOM JC-PS101USV 標準デジタルモード):
    //      - Rightのみ: axes[0] > +0.45
    //      - Leftのみ : axes[0] < -0.45
    //      - 中立 (|axes[0]| <= 0.45): △=1 なら P5(0,0,1)、△=0 なら N(1,1,0)
    let right = 0;
    let left = 0;
    let dpadSource = 'axis0';

    const hasDiscrete16 =
      btns.length >= 16 &&
      (isBtnPressed(btns, 12) ||
        isBtnPressed(btns, 13) ||
        isBtnPressed(btns, 14) ||
        isBtnPressed(btns, 15));

    if (hasDiscrete16) {
      if (variant === 'ps_standard' || (isBtnPressed(btns, 12) && isBtnPressed(btns, 13) && !isBtnPressed(btns, 14))) {
        left = isBtnPressed(btns, 14) ? 1 : 0;
        right = isBtnPressed(btns, 15) ? 1 : 0;
        dpadSource = 'btn16_w3c';
      } else if (isBtnPressed(btns, 12) && isBtnPressed(btns, 14)) {
        right = isBtnPressed(btns, 13) ? 1 : 0;
        left = isBtnPressed(btns, 15) ? 1 : 0;
        dpadSource = 'btn16_elecom';
      } else {
        left = isBtnPressed(btns, 14) ? 1 : 0;
        right = isBtnPressed(btns, 15) ? 1 : 0;
        dpadSource = 'btn16_generic';
      }
    } else {
      const ax0 = axes.length > 0 ? axes[0] : 0;
      const hat9 = axes.length >= 10 ? decodeHatLeftRight(axes[9]) : null;

      if (Math.abs(ax0) > 0.45) {
        right = ax0 > 0.45 ? 1 : 0;
        left = ax0 < -0.45 ? 1 : 0;
        dpadSource = 'axis0';
      } else if (hat9 && (hat9.left || hat9.right)) {
        left = hat9.left;
        right = hat9.right;
        dpadSource = 'hat9';
      } else {
        // JC-PS101USV X軸中立 (0.0): N時は Left+Right 同時押しで 0.0 になる / P5時は両方OFFで 0.0 + △=1
        if (tri === 1) {
          right = 0;
          left = 0;
        } else {
          right = 1;
          left = 1;
        }
        dpadSource = 'axis0';
      }
    }

    // ブレーキ 4bit 算出
    const brakeCode = (r2 << 3) | (r1 << 2) | (l2 << 1) | l1;
    const rawStep14 = PS_BRAKE_CODE_TO_STEP14[brakeCode] ?? -1;

    // マスコン 3bit 算出
    const powerPat = `${right},${left},${tri}`;
    const rawPower = PS_MASCON_PAT_TO_POWER[powerPat] ?? -1;

    // ブレーキ段数 → シミュレーターの NOTCH_STEPS インデックス (0=EB, 1=B8 .. 8=B1, 9=N, 10=P1 .. 14=P5)
    let rawNotchIndex = -1;

    if (rawStep14 === -1) {
      // 0b1111 (15) は接点移動中ノイズのため直前値を維持
      this._deepBrakeSinceMs = 0;
      rawNotchIndex = -1;
    } else if (rawStep14 === 14) {
      // EB (0b0000)
      this._deepBrakeSinceMs = 0;
      rawNotchIndex = 0;
    } else if (rawStep14 >= 1 && rawStep14 <= 13) {
      if (this.brakeCurveMode === 'scale_13') {
        // 2ハンドルの常用13段階 (1..13) を E531系 B1(idx=8)〜B8(idx=1) に均等スケーリング
        const bLevel = Math.max(1, Math.min(8, Math.round((rawStep14 / 13) * 8)));
        rawNotchIndex = 9 - bLevel;
      } else {
        // 標準 8段直結モード:
        //   step 1..8  -> B1..B8 (idx 8..1)
        //   step 9..13 -> ワンハンドル B6↔B7 等の多ビット同時反転時の瞬間グリッチを弾きつつ、
        //                 85ms以上継続した場合は2ハンドル深制動域として B8 (idx 1) に保持！
        if (rawStep14 <= 8) {
          this._deepBrakeSinceMs = 0;
          rawNotchIndex = 9 - rawStep14;
        } else {
          if (this._deepBrakeSinceMs === 0) {
            this._deepBrakeSinceMs = nowMs;
          }
          if (nowMs - this._deepBrakeSinceMs >= 85) {
            rawNotchIndex = 1; // B8
          } else {
            rawNotchIndex = -1;
          }
        }
      }
    } else if (rawStep14 === 0) {
      // ブレーキ緩解 (B0 = 1110) → マスコン側 (N / P1〜P5) を採用
      this._deepBrakeSinceMs = 0;
      if (rawPower >= 0) {
        rawNotchIndex = NEUTRAL_INDEX + rawPower;
      } else {
        rawNotchIndex = -1;
      }
    }

    return {
      rawNotchIndex,
      dpadSource,
      brakeCode,
      powerPat,
      buttons: { a: btnA, b: btnB, c: btnC, select: btnSelect, start: btnStart },
    };
  }

  /**
   * 瑞起ワンハンドルマスコン（USB アナログ軸）のデコード
   */
  _decodeZuikiOneHandle(pad) {
    const btns = pad.buttons || [];
    const axes = pad.axes || [];
    const y = axes.length > 1 ? axes[1] : axes[0] || 0;

    let bestIdx = NEUTRAL_INDEX;
    let bestDist = Infinity;
    for (let i = 0; i < ZUIKI_AXIS_CENTERS.length; i++) {
      const dist = Math.abs(y - ZUIKI_AXIS_CENTERS[i]);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }

    // Switch / PC 瑞起ボタン配置 (0:B, 1:A, 2:Y, 3:X, 8:-/SELECT, 9:+/START)
    let btnB = isBtnPressed(btns, 0);
    let btnA = isBtnPressed(btns, 1);
    let btnC = isBtnPressed(btns, 2) || isBtnPressed(btns, 3);
    let btnSelect = isBtnPressed(btns, 8);
    let btnStart = isBtnPressed(btns, 9);

    if (this.calibration?.buttonIndices) {
      const bi = this.calibration.buttonIndices;
      if (Number.isInteger(bi.a)) btnA = isBtnPressed(btns, bi.a);
      if (Number.isInteger(bi.b)) btnB = isBtnPressed(btns, bi.b);
      if (Number.isInteger(bi.c)) btnC = isBtnPressed(btns, bi.c);
      if (Number.isInteger(bi.select)) btnSelect = isBtnPressed(btns, bi.select);
      if (Number.isInteger(bi.start)) btnStart = isBtnPressed(btns, bi.start);
    }

    return {
      rawNotchIndex: bestDist < 0.12 ? bestIdx : -1,
      dpadSource: 'zuiki_axis1',
      brakeCode: null,
      powerPat: `Y=${y.toFixed(2)}`,
      buttons: { a: btnA, b: btnB, c: btnC, select: btnSelect, start: btnStart },
    };
  }

  /**
   * 実機キャリブレーション学習データによる汎用スナップショット照合デコード
   * （ワンハンドル・2ハンドル・特殊コンバータのすべてに対応）
   */
  _decodeCalibrated(pad) {
    const btns = pad.buttons || [];
    const axes = pad.axes || [];
    const cal = this.calibration;

    const curBtns = btns.map((_, i) => (isBtnPressed(btns, i) ? 1 : 0));
    const curAxes = axes.map((v) => quantizeAxis(v));

    let rawNotchIndex = -1;
    if (cal && Array.isArray(cal.notchSignatures) && cal.notchSignatures.length === 15) {
      const brakeBtns = cal.brakeBtns || [];
      const brakeAxes = cal.brakeAxes || [];
      const masconBtns = cal.masconBtns || [];
      const masconAxes = cal.masconAxes || [];

      const pureBrakeBtns = brakeBtns.filter((b) => !masconBtns.includes(b));
      const pureBrakeAxes = brakeAxes.filter((a) => !masconAxes.includes(a));
      const hasIndependentBrake = pureBrakeBtns.length > 0 || pureBrakeAxes.length > 0;

      const axisError = (sig, axisList) => {
        let maxErr = 0;
        for (const ai of axisList) {
          const err = Math.abs((curAxes[ai] || 0) - (sig.axes[ai] || 0));
          if (err > maxErr) maxErr = err;
        }
        return maxErr;
      };

      const btnsMatch = (sig, btnList) => {
        for (const bi of btnList) {
          if ((curBtns[bi] || 0) !== (sig.btns[bi] || 0)) return false;
        }
        return true;
      };

      const findBestInRange = (startIdx, endIdx, btnList, axisList, tol = 0.28) => {
        let bestIdx = -1;
        let bestErr = Infinity;
        for (let idx = startIdx; idx <= endIdx; idx++) {
          const sig = cal.notchSignatures[idx];
          if (!btnsMatch(sig, btnList)) continue;
          const err = axisError(sig, axisList);
          if (err <= tol && err < bestErr) {
            bestErr = err;
            bestIdx = idx;
          }
        }
        return bestIdx;
      };

      if (hasIndependentBrake) {
        const neutralSig = cal.notchSignatures[NEUTRAL_INDEX];
        const isBrakeReleased =
          btnsMatch(neutralSig, pureBrakeBtns) && axisError(neutralSig, pureBrakeAxes) <= 0.28;

        if (isBrakeReleased) {
          rawNotchIndex = findBestInRange(NEUTRAL_INDEX, 14, masconBtns, masconAxes, 0.28);
        } else {
          rawNotchIndex = findBestInRange(0, NEUTRAL_INDEX - 1, pureBrakeBtns, pureBrakeAxes, 0.28);
        }
      } else {
        const allBtns = Array.from(new Set([...brakeBtns, ...masconBtns]));
        const allAxes = Array.from(new Set([...brakeAxes, ...masconAxes]));
        rawNotchIndex = findBestInRange(0, 14, allBtns, allAxes, 0.14);
      }
    }

    const bi = cal?.buttonIndices || {};
    const btnA = Number.isInteger(bi.a) ? isBtnPressed(btns, bi.a) : isBtnPressed(btns, 3);
    const btnB = Number.isInteger(bi.b) ? isBtnPressed(btns, bi.b) : isBtnPressed(btns, 2);
    const btnC = Number.isInteger(bi.c) ? isBtnPressed(btns, bi.c) : isBtnPressed(btns, 1);
    const btnSelect = Number.isInteger(bi.select) ? isBtnPressed(btns, bi.select) : isBtnPressed(btns, 9);
    const btnStart = Number.isInteger(bi.start) ? isBtnPressed(btns, bi.start) : isBtnPressed(btns, 8);

    return {
      rawNotchIndex,
      dpadSource: 'calibrated',
      brakeCode: null,
      powerPat: 'CAL',
      buttons: { a: btnA, b: btnB, c: btnC, select: btnSelect, start: btnStart },
    };
  }

  /**
   * 毎フレーム呼び出し：入力ポーリング・チャタリング除去・ノッチ＆ボタン発火
   */
  update(nowMs = performance.now()) {
    const { pad, source } = this._pickActiveGamepad();

    if (!pad) {
      if (this.connected) {
        this.connected = false;
        this.activeSource = 'none';
        this.controllerId = '';
        this.confirmedNotchIndex = null;
        this._candidateNotchIndex = null;
        this._lastDiag.connected = false;
        this.onConnectionChange({ connected: false, id: '' });
      }
      return this._lastDiag;
    }

    const resolvedProfile = this._resolveProfile(pad);
    const wasConnected = this.connected;
    const prevId = this.controllerId;
    this.connected = true;
    this.activeSource = source;
    this.controllerId = String(pad.id || 'USB Controller');
    this.controllerMapping = String(pad.mapping || '');
    this.resolvedProfile = resolvedProfile;

    if (!wasConnected || prevId !== this.controllerId) {
      this.confirmedNotchIndex = null;
      this._candidateNotchIndex = null;
      this.onConnectionChange({
        connected: true,
        id: this.controllerId,
        mapping: this.controllerMapping,
        source,
        resolvedProfile,
      });
    }

    // 生入力配列（診断＆キャリブレーション用）
    const pressedIndices = [];
    const btns = pad.buttons || [];
    for (let i = 0; i < btns.length; i++) {
      if (isBtnPressed(btns, i)) pressedIndices.push(i);
    }
    const rawAxes = Array.from(pad.axes || []).map((v) => Number(Number(v || 0).toFixed(2)));

    // ボタンキャリブレーション実行中の自動キャプチャ（新たに押されたボタンを検出！）
    if (this.calibrationWizard.active && this.calibrationWizard.mode === 'buttons') {
      this._pollButtonCalibrationStep(pressedIndices);
    }

    // プロファイル別デコード
    let decoded;
    if (resolvedProfile === 'calibrated') {
      decoded = this._decodeCalibrated(pad);
    } else if (resolvedProfile === 'zuiki_onehandle') {
      decoded = this._decodeZuikiOneHandle(pad);
    } else {
      decoded = this._decodePlayStationDenGo(pad, resolvedProfile, nowMs);
    }

    // キャリブレーション操作中は物理ノッチ送信を一時停止
    if (!this.calibrationWizard.active) {
      this._processNotchDebounce(decoded.rawNotchIndex, decoded.dpadSource, nowMs);
      this._processActionButtons(decoded.buttons, nowMs);
    }

    this._lastDiag = {
      connected: true,
      source,
      id: this.controllerId,
      mapping: this.controllerMapping,
      profile: this.profile,
      resolvedProfile,
      confirmedNotchIndex: this.confirmedNotchIndex,
      confirmedNotchId:
        this.confirmedNotchIndex !== null ? NOTCH_STEPS[this.confirmedNotchIndex].id : '---',
      rawNotchIndex: decoded.rawNotchIndex,
      pressedIndices,
      axes: rawAxes,
      brakeCode: decoded.brakeCode,
      powerPat: decoded.powerPat,
      dpadSource: decoded.dpadSource,
      buttonsHeld: decoded.buttons,
    };

    return this._lastDiag;
  }

  /**
   * 36ms 安定デバウンス（12ボタン X軸中立 N 遷移時のみ P2↔P3 接点通過ギャップ対策で 48ms）
   */
  _processNotchDebounce(rawNotchIndex, dpadSource, nowMs) {
    if (rawNotchIndex < 0 || rawNotchIndex >= NOTCH_STEPS.length) {
      // 無効遷移コード (0b1111 等) は候補を破棄し、直前の確定ノッチを堅持
      this._candidateNotchIndex = null;
      return;
    }

    if (rawNotchIndex === this.confirmedNotchIndex) {
      this._candidateNotchIndex = null;
      return;
    }

    if (this._candidateNotchIndex !== rawNotchIndex) {
      this._candidateNotchIndex = rawNotchIndex;
      this._candidateSinceMs = nowMs;
      return;
    }

    // P2(11)〜P5(14) から N(9) への遷移かつ X軸アナログ合算モード時は 48ms 要求してワイパー開放ギャップを完全遮断
    const isPowerToNeutralOnAxis =
      dpadSource === 'axis0' &&
      rawNotchIndex === NEUTRAL_INDEX &&
      this.confirmedNotchIndex !== null &&
      this.confirmedNotchIndex >= NEUTRAL_INDEX + 2;

    const requiredMs = isPowerToNeutralOnAxis ? 48 : 34;
    if (nowMs - this._candidateSinceMs >= requiredMs) {
      const isInitialSync = this.confirmedNotchIndex === null;
      this.confirmedNotchIndex = rawNotchIndex;
      this._candidateNotchIndex = null;
      const step = NOTCH_STEPS[rawNotchIndex];
      this.onNotchChange(rawNotchIndex, step.id, { initialSync: isInitialSync });
    }
  }

  /**
   * A / B / C / SELECT / START ボタンのチャタリング防止 (22ms) ＆ 長押し検出 (650ms)
   */
  _processActionButtons(rawButtons, nowMs) {
    for (const key of ['a', 'b', 'c', 'select', 'start']) {
      const st = this._btnState[key];
      const raw = Boolean(rawButtons[key]);

      if (raw !== st.rawHeld) {
        st.rawHeld = raw;
        st.rawSinceMs = nowMs;
      }

      if (raw !== st.held && nowMs - st.rawSinceMs >= 22) {
        st.held = raw;
        const assignedAction = this.buttonMap[key] || 'none';

        if (raw) {
          st.pressedAtMs = nowMs;
          st.longFired = false;
          // view_toggle 割り当て時は短押し確定または長押し(ザ・ワールド)を判定するため離した瞬間に短押し発火、
          // それ以外の即応アクション（警笛・ドア・EBリセット等）は押した瞬間にゼロ遅延発火！
          if (assignedAction !== 'view_toggle' && assignedAction !== 'none') {
            this.onAction(assignedAction, key);
          }
        } else {
          if (assignedAction === 'view_toggle' && !st.longFired) {
            this.onAction('view_toggle', key);
          }
        }
      }

      // view_toggle 長押し (650ms) → ザ・ワールド切替！
      if (st.held && !st.longFired && this.buttonMap[key] === 'view_toggle') {
        if (nowMs - st.pressedAtMs >= 650) {
          st.longFired = true;
          this.onAction('the_world', key);
        }
      }
    }
  }

  // =========================================================================
  // 実機キャリブレーション（ハンドル全15段 ＆ ボタン5種 ガイド付き学習）
  // =========================================================================

  startHandleCalibration() {
    this.calibrationWizard = {
      active: true,
      mode: 'notches',
      stepIndex: 0,
      recordedNotches: [],
      recordedButtons: this.calibration?.buttonIndices ? { ...this.calibration.buttonIndices } : {},
      baselinePressedSet: new Set(),
    };
    return this.getCalibrationStatus();
  }

  captureCalibrationNotchStep() {
    if (!this.calibrationWizard.active || this.calibrationWizard.mode !== 'notches') {
      return null;
    }
    const { pad } = this._pickActiveGamepad();
    if (!pad) return { error: 'no_controller' };

    const btns = Array.from(pad.buttons || []).map((_, i) => (isBtnPressed(pad.buttons, i) ? 1 : 0));
    const axes = Array.from(pad.axes || []).map((v) => quantizeAxis(v));

    this.calibrationWizard.recordedNotches.push({ btns, axes });
    this.calibrationWizard.stepIndex++;

    if (this.calibrationWizard.stepIndex >= CALIBRATION_NOTCH_STEPS.length) {
      this._finalizeNotchCalibration();
      this.calibrationWizard.active = false;
      this.calibrationWizard.mode = null;
      return { completed: true };
    }
    return this.getCalibrationStatus();
  }

  _finalizeNotchCalibration() {
    const sigs = this.calibrationWizard.recordedNotches;
    if (sigs.length !== 15) return;

    const maxBtns = Math.max(...sigs.map((s) => s.btns.length), 0);
    const maxAxes = Math.max(...sigs.map((s) => s.axes.length), 0);

    const brakeBtns = [];
    const masconBtns = [];
    const brakeAxes = [];
    const masconAxes = [];

    const neutral = sigs[NEUTRAL_INDEX];

    // EB(0)〜N(9) 間で変化したボタン・軸 ＝ ブレーキハンドル系統
    for (let bi = 0; bi < maxBtns; bi++) {
      const ref = neutral.btns[bi] || 0;
      for (let idx = 0; idx <= NEUTRAL_INDEX; idx++) {
        if ((sigs[idx].btns[bi] || 0) !== ref) {
          brakeBtns.push(bi);
          break;
        }
      }
    }
    for (let ai = 0; ai < maxAxes; ai++) {
      const ref = neutral.axes[ai] || 0;
      for (let idx = 0; idx <= NEUTRAL_INDEX; idx++) {
        if (Math.abs((sigs[idx].axes[ai] || 0) - ref) > 0.25) {
          brakeAxes.push(ai);
          break;
        }
      }
    }

    // N(9)〜P5(14) 間で変化したボタン・軸 ＝ マスコンハンドル系統
    for (let bi = 0; bi < maxBtns; bi++) {
      const ref = neutral.btns[bi] || 0;
      for (let idx = NEUTRAL_INDEX; idx < 15; idx++) {
        if ((sigs[idx].btns[bi] || 0) !== ref) {
          masconBtns.push(bi);
          break;
        }
      }
    }
    for (let ai = 0; ai < maxAxes; ai++) {
      const ref = neutral.axes[ai] || 0;
      for (let idx = NEUTRAL_INDEX; idx < 15; idx++) {
        if (Math.abs((sigs[idx].axes[ai] || 0) - ref) > 0.25) {
          masconAxes.push(ai);
          break;
        }
      }
    }

    this.calibration = {
      ...(this.calibration || {}),
      notchSignatures: sigs,
      brakeBtns,
      brakeAxes,
      masconBtns,
      masconAxes,
      buttonIndices: this.calibration?.buttonIndices || null,
    };
    this.profile = 'calibrated';
    this.confirmedNotchIndex = null;
    this._candidateNotchIndex = null;
    this.saveSettings();
  }

  startButtonCalibration() {
    const { pad } = this._pickActiveGamepad();
    const baseline = new Set();
    if (pad && pad.buttons) {
      for (let i = 0; i < pad.buttons.length; i++) {
        if (isBtnPressed(pad.buttons, i)) baseline.add(i);
      }
    }
    this.calibrationWizard = {
      active: true,
      mode: 'buttons',
      stepIndex: 0,
      recordedNotches: [],
      recordedButtons: {},
      baselinePressedSet: baseline,
      waitingRelease: false,
      onButtonStepUpdate: this.calibrationWizard.onButtonStepUpdate || null,
    };
    return this.getCalibrationStatus();
  }

  _pollButtonCalibrationStep(pressedIndices) {
    const wiz = this.calibrationWizard;
    // ハンドルが常時ONにしているボタン（R1/R2/L2/Up/Down等）を除外して新しく押されたボタンのみ検出
    const newlyPressed = pressedIndices.filter((idx) => !wiz.baselinePressedSet.has(idx));

    if (wiz.waitingRelease) {
      if (newlyPressed.length === 0) {
        wiz.waitingRelease = false;
      }
      return;
    }

    if (newlyPressed.length === 1) {
      const btnIdx = newlyPressed[0];
      const targetStep = CALIBRATION_BUTTON_STEPS[wiz.stepIndex];
      wiz.recordedButtons[targetStep.key] = btnIdx;
      wiz.stepIndex++;
      wiz.waitingRelease = true;

      if (wiz.stepIndex >= CALIBRATION_BUTTON_STEPS.length) {
        this.calibration = {
          ...(this.calibration || {}),
          buttonIndices: { ...wiz.recordedButtons },
        };
        wiz.active = false;
        wiz.mode = null;
        this.saveSettings();
      }
      if (typeof wiz.onButtonStepUpdate === 'function') {
        wiz.onButtonStepUpdate(this.getCalibrationStatus());
      }
    }
  }

  cancelCalibration() {
    this.calibrationWizard.active = false;
    this.calibrationWizard.mode = null;
  }

  getCalibrationStatus() {
    const wiz = this.calibrationWizard;
    if (!wiz.active) {
      return { active: false, hasCalibration: Boolean(this.calibration) };
    }
    if (wiz.mode === 'notches') {
      const step = CALIBRATION_NOTCH_STEPS[wiz.stepIndex];
      return {
        active: true,
        mode: 'notches',
        stepIndex: wiz.stepIndex,
        totalSteps: CALIBRATION_NOTCH_STEPS.length,
        targetId: step.id,
        targetLabel: step.label,
      };
    }
    const btnStep = CALIBRATION_BUTTON_STEPS[wiz.stepIndex];
    return {
      active: true,
      mode: 'buttons',
      stepIndex: wiz.stepIndex,
      totalSteps: CALIBRATION_BUTTON_STEPS.length,
      targetKey: btnStep.key,
      targetLabel: btnStep.label,
    };
  }

  // =========================================================================
  // WebHID 直接接続モード（Chromium系ブラウザ用・OS Gamepad層バイパス）
  // =========================================================================

  isWebHidSupported() {
    return typeof navigator !== 'undefined' && 'hid' in navigator;
  }

  async connectWebHid() {
    if (!this.isWebHidSupported()) {
      throw new Error('お使いのブラウザは WebHID に対応していません（Chrome / Edge 等をご利用ください）');
    }

    const devices = await navigator.hid.requestDevice({
      filters: [
        { usagePage: 0x01, usage: 0x04 }, // Generic Desktop: Joystick (JC-PS101USV 等)
        { usagePage: 0x01, usage: 0x05 }, // Generic Desktop: Gamepad
      ],
    });
    if (!devices || devices.length === 0) return null;

    const device = devices[0];
    if (!device.opened) {
      await device.open();
    }

    if (this.hidDevice && this.hidDevice !== device) {
      try {
        await this.hidDevice.close();
      } catch {
        // ignore
      }
    }

    this.hidDevice = device;
    const layout = this._buildHidReportLayout(device);

    this._hidVirtualPad = {
      id: `${device.productName || 'USB HID'} (${device.vendorId.toString(16).padStart(4, '0')}:${device.productId.toString(16).padStart(4, '0')})`,
      mapping: '',
      connected: true,
      buttons: Array.from({ length: Math.max(16, layout.buttonCount) }, () => ({
        pressed: false,
        value: 0,
      })),
      axes: [0, 0, 0, 0],
    };

    device.oninputreport = (event) => {
      this._parseHidInputReport(event.reportId, event.data, layout);
    };

    return this._hidVirtualPad.id;
  }

  async disconnectWebHid() {
    if (this.hidDevice) {
      try {
        this.hidDevice.oninputreport = null;
        await this.hidDevice.close();
      } catch {
        // ignore
      }
      this.hidDevice = null;
    }
    this._hidVirtualPad = null;
    this.confirmedNotchIndex = null;
    this._candidateNotchIndex = null;
  }

  _buildHidReportLayout(device) {
    const fields = [];
    let buttonCount = 0;

    for (const col of device.collections || []) {
      for (const rep of col.inputReports || []) {
        let bitOffset = 0;
        for (const item of rep.items || []) {
          const size = item.reportSize || 0;
          const count = item.reportCount || 0;
          const usages = item.usages || [];
          fields.push({
            reportId: rep.reportId || 0,
            bitOffset,
            size,
            count,
            usages,
            isConstant: Boolean(item.isConstant),
            logicalMin: item.logicalMinimum ?? 0,
            logicalMax: item.logicalMaximum ?? 255,
          });
          for (const u of usages) {
            if ((u >>> 16) === 0x09) buttonCount++;
          }
          if (usages.length === 1 && (usages[0] >>> 16) === 0x09 && count > 1) {
            buttonCount += count - 1;
          }
          bitOffset += size * count;
        }
      }
    }
    return { fields, buttonCount: Math.max(16, buttonCount) };
  }

  _parseHidInputReport(reportId, dataView, layout) {
    if (!this._hidVirtualPad) return;

    const readBitsUnsigned = (bitPos, bitLen) => {
      let val = 0;
      for (let b = 0; b < bitLen; b++) {
        const totalBit = bitPos + b;
        const byteIdx = totalBit >>> 3;
        if (byteIdx >= dataView.byteLength) break;
        const bitInByte = totalBit & 7;
        if ((dataView.getUint8(byteIdx) >>> bitInByte) & 1) {
          val |= 1 << b;
        }
      }
      return val >>> 0;
    };

    const matchingFields = layout.fields.filter((f) => f.reportId === (reportId || 0));
    if (matchingFields.length === 0 && dataView.byteLength >= 4) {
      // フォールバック：標準的な JC-PS101USV / MP-8888 HID レポート (byte0=X, byte1=Y, byte2..3 / byte5..6=Buttons)
      const xRaw = dataView.getUint8(0);
      const yRaw = dataView.getUint8(1);
      this._hidVirtualPad.axes[0] = Math.abs(xRaw - 128) <= 12 ? 0 : (xRaw - 127.5) / 127.5;
      this._hidVirtualPad.axes[1] = Math.abs(yRaw - 128) <= 12 ? 0 : (yRaw - 127.5) / 127.5;
      const btnBase = dataView.byteLength >= 7 ? 5 : 2;
      for (let i = 0; i < 16; i++) {
        const byteIdx = btnBase + (i >>> 3);
        const pressed =
          byteIdx < dataView.byteLength ? Boolean((dataView.getUint8(byteIdx) >>> (i & 7)) & 1) : false;
        this._hidVirtualPad.buttons[i] = { pressed, value: pressed ? 1 : 0 };
      }
      return;
    }

    let nextBtnSlot = 0;
    for (const f of matchingFields) {
      if (f.isConstant) continue;
      for (let c = 0; c < f.count; c++) {
        const raw = readBitsUnsigned(f.bitOffset + c * f.size, f.size);
        const usage = f.usages[Math.min(c, Math.max(0, f.usages.length - 1))] || 0;
        const usagePage = usage >>> 16;
        const usageId = usage & 0xffff;

        if (usagePage === 0x09) {
          const btnIdx = usageId >= 1 && usageId <= 32 ? usageId - 1 : nextBtnSlot;
          nextBtnSlot = Math.max(nextBtnSlot, btnIdx + 1);
          const pressed = raw !== 0;
          if (btnIdx < this._hidVirtualPad.buttons.length) {
            this._hidVirtualPad.buttons[btnIdx] = { pressed, value: pressed ? 1 : 0 };
          }
        } else if (usagePage === 0x01) {
          if (usageId === 0x30 || usageId === 0x31) {
            const span = Math.max(1, f.logicalMax - f.logicalMin);
            const norm = ((raw - f.logicalMin) / span) * 2 - 1;
            const clean = Math.abs(norm) < 0.12 ? 0 : Math.max(-1, Math.min(1, norm));
            this._hidVirtualPad.axes[usageId === 0x30 ? 0 : 1] = clean;
          } else if (usageId === 0x39) {
            // Hat Switch (0=N, 1=NE, 2=E, 3=SE, 4=S, 5=SW, 6=W, 7=NW, >=8 Center)
            const hatIdx = raw - f.logicalMin;
            let hx = 0;
            if (hatIdx === 1 || hatIdx === 2 || hatIdx === 3) hx = 1;
            else if (hatIdx === 5 || hatIdx === 6 || hatIdx === 7) hx = -1;
            this._hidVirtualPad.axes[0] = hx;
          }
        }
      }
    }
  }

  // =========================================================================
  // 診断情報 ＆ 自動テスト用モックインターフェース
  // =========================================================================

  getDiagnostics() {
    return {
      ...this._lastDiag,
      profile: this.profile,
      calibrationStatus: this.getCalibrationStatus(),
      buttonMap: { ...this.buttonMap },
      brakeCurveMode: this.brakeCurveMode,
    };
  }

  setMockGamepad(mockState) {
    if (!mockState) {
      this._mockPad = null;
      return;
    }
    const btnCount = Math.max(16, mockState.buttonCount || 16);
    const pressedSet = new Set(mockState.pressedButtons || []);
    this._mockPad = {
      id: mockState.id || 'MP-8888 USB Joypad (Vendor: 056e Product: 2003)',
      mapping: mockState.mapping ?? '',
      connected: true,
      buttons: Array.from({ length: btnCount }, (_, i) => ({
        pressed: pressedSet.has(i),
        value: pressedSet.has(i) ? 1 : 0,
      })),
      axes: Array.isArray(mockState.axes) ? [...mockState.axes] : [0, -1, 0, 0],
    };
  }
}
