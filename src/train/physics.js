import * as THREE from 'three';
import { STATIONS, ROUTE_TOTAL_LENGTH } from '../world/routeData.js';

/**
 * ワンハンドルマスコン全15段定義（index 0 = EB 〜 index 14 = P5）
 */
export const NOTCH_STEPS = [
  { id: 'EB', type: 'eb', level: 9, label: 'EB (非常)', targetBcKpa: 480 },
  { id: 'B8', type: 'brake', level: 8, label: 'B8', targetBcKpa: 395 },
  { id: 'B7', type: 'brake', level: 7, label: 'B7', targetBcKpa: 345 },
  { id: 'B6', type: 'brake', level: 6, label: 'B6', targetBcKpa: 295 },
  { id: 'B5', type: 'brake', level: 5, label: 'B5', targetBcKpa: 245 },
  { id: 'B4', type: 'brake', level: 4, label: 'B4', targetBcKpa: 195 },
  { id: 'B3', type: 'brake', level: 3, label: 'B3', targetBcKpa: 145 },
  { id: 'B2', type: 'brake', level: 2, label: 'B2', targetBcKpa: 95 },
  { id: 'B1', type: 'brake', level: 1, label: 'B1', targetBcKpa: 50 },
  { id: 'N', type: 'neutral', level: 0, label: 'N (惰行)', targetBcKpa: 0 },
  { id: 'P1', type: 'power', level: 1, label: 'P1', targetBcKpa: 0 },
  { id: 'P2', type: 'power', level: 2, label: 'P2', targetBcKpa: 0 },
  { id: 'P3', type: 'power', level: 3, label: 'P3', targetBcKpa: 0 },
  { id: 'P4', type: 'power', level: 4, label: 'P4', targetBcKpa: 0 },
  { id: 'P5', type: 'power', level: 5, label: 'P5', targetBcKpa: 0 },
];

export const NEUTRAL_INDEX = 9;

/**
 * JR東日本 E531系・E231系（常磐線快速 15両編成相当）縦方向運動・空気ブレーキ・台車継目トラッカー
 */
export class TrainPhysics {
  constructor(route) {
    this.route = route;
    this.serviceType = 'rapid'; // 'rapid' (各駅停車: 全4駅) | 'special_rapid' (特快: 日暮里→北千住直行)

    this._jointPositions = this._generateRailJoints();
    this.reset(0);
  }

  /**
   * 路線全体のレール継目座標リストを生成（分岐器・急曲線25m定尺・橋梁伸縮継目・高架50mロングレール）
   */
  _generateRailJoints() {
    const joints = [];
    let d = -230;
    while (d < 5490) {
      const zone = this.route.getTrackZoneAt(d);
      let step = 48.0; // ロングレール溶接継目
      if (zone.type === 'turnout') {
        // ポイント・クロッシング部の不規則な継目リズム
        step = 9.5 + ((Math.abs(Math.round(d)) * 7) % 9);
      } else if (zone.type === 'sharp_curve') {
        step = 25.0; // 25m 定尺レール区間
      } else if (zone.type === 'truss_bridge') {
        step = 20.5; // トラス橋桁継目
      }
      d += step;
      joints.push({ d, zoneType: zone.type });
    }
    return joints;
  }

  setServiceType(type) {
    this.serviceType = type;
  }

  getScheduledStations() {
    return STATIONS.filter((st) =>
      this.serviceType === 'special_rapid' ? st.stopSpecialRapid : st.stopRapid
    );
  }

  reset(startDistance = 0) {
    this.distance = startDistance; // 日暮里停止目標 = 0.0 m
    this.speedMps = 0;             // m/s
    this.speedKmh = 0;             // km/h
    this.accelerationMps2 = 0;     // m/s^2 (正=加速, 負=減速)

    this.notchIndex = 5;           // 初期状態 B4 制動保持
    this.bcPressure = 195;         // ブレーキシリンダ圧力 (kPa)
    this.mrPressure = 840;         // 元空気ダメ圧力 (kPa: 780〜880)
    this.doorsOpen = false;        // 初期状態は戸閉完了（すぐ発車可能）
    this.motorEffort = 0;          // -1.0 (最大回生) 〜 +1.0 (最大力行)

    this._prevAxle1 = startDistance - 2.1;
    this._prevAxle2 = startDistance - 4.2;
    this._prevTargetBc = 195;
  }

  get currentNotch() {
    return NOTCH_STEPS[this.notchIndex];
  }

  /**
   * マスコンを手前に引く（制動解除 → 力行側へ +1段）
   */
  pullHandle() {
    if (this.notchIndex < NOTCH_STEPS.length - 1) {
      // 戸開中は N より上（P1〜P5）へ入らない戸閉保安インターロック
      if (this.doorsOpen && this.notchIndex >= NEUTRAL_INDEX) {
        return { changed: false, blockedByDoor: true };
      }
      this.notchIndex++;
      return { changed: true, notch: this.currentNotch };
    }
    return { changed: false };
  }

  /**
   * マスコンを奥へ押す（力行解除 → 制動側へ -1段）
   */
  pushHandle() {
    if (this.notchIndex > 0) {
      this.notchIndex--;
      return { changed: true, notch: this.currentNotch };
    }
    return { changed: false };
  }

  setNeutral() {
    if (this.notchIndex !== NEUTRAL_INDEX) {
      this.notchIndex = NEUTRAL_INDEX;
      return { changed: true, notch: this.currentNotch };
    }
    return { changed: false };
  }

  applyEmergencyBrake() {
    if (this.notchIndex !== 0) {
      this.notchIndex = 0;
      return { changed: true, notch: this.currentNotch, isEB: true };
    }
    return { changed: false };
  }

  /**
   * 駅ホーム停車中のドア開閉トグル
   */
  toggleDoors() {
    if (this.speedKmh > 0.4) return { toggled: false, reason: 'moving' };
    this.doorsOpen = !this.doorsOpen;
    if (this.doorsOpen && this.notchIndex > NEUTRAL_INDEX) {
      this.notchIndex = NEUTRAL_INDEX;
    }
    return { toggled: true, doorsOpen: this.doorsOpen };
  }

  /**
   * 現在位置から見て次の停車予定駅を返す
   */
  getNextScheduledStop() {
    const stops = this.getScheduledStations();
    for (const st of stops) {
      // 停止目標を +25m 以上過ぎるまではその駅を案内対象とする（日暮里 0m 発車直後は三河島/北千住へ切替）
      if (st.stopDistance === 0 && this.distance > 18) continue;
      if (st.stopDistance === 0 && this.distance <= 18 && this.speedKmh > 6) continue;
      if (this.distance <= st.stopDistance + 25 && st.stopDistance > 0) {
        return st;
      }
    }
    return stops[stops.length - 1];
  }

  /**
   * ホーム有効長内に停車中かどうか判定
   */
  getCurrentStationAtPlatform() {
    for (const st of STATIONS) {
      if (this.distance >= st.platformStart + 30 && this.distance <= st.platformEnd + 15) {
        return st;
      }
    }
    return null;
  }

  /**
   * 毎フレーム物理積分・台車ジョイント通過イベント生成
   */
  update(dt, callbacks = {}) {
    const safeDt = Math.min(dt, 0.05);
    const notch = this.currentNotch;
    const frame = this.route.getFrameAt(this.distance);

    // 1. 空気ブレーキ圧 (BC) の一次遅れ応答 & 緩解排気音トリガー
    const targetBc = notch.targetBcKpa;
    if (targetBc < this._prevTargetBc - 45 && this.bcPressure > 60) {
      const releaseStrength = Math.min(1.0, (this.bcPressure - targetBc) / 340);
      if (callbacks.onBrakeAirRelease) callbacks.onBrakeAirRelease(releaseStrength);
    }
    this._prevTargetBc = targetBc;

    const bcRate =
      notch.type === 'eb'
        ? 410 // 非常ブレーキは急速立ち上がり
        : targetBc > this.bcPressure
          ? 235 // 込め速度 (kPa/s)
          : 265; // 緩め速度 (kPa/s)

    if (this.bcPressure < targetBc) {
      this.bcPressure = Math.min(targetBc, this.bcPressure + bcRate * safeDt);
      this.mrPressure = Math.max(760, this.mrPressure - safeDt * 9);
    } else if (this.bcPressure > targetBc) {
      this.bcPressure = Math.max(targetBc, this.bcPressure - bcRate * safeDt);
    }

    // コンプレッサーによる元空気ダメ自動補充
    if (this.mrPressure < 865) {
      this.mrPressure = Math.min(865, this.mrPressure + safeDt * 6.5);
    }

    // 2. VVVF主電動機 引張力加速度 (m/s^2)
    // E531系・E231系: P5起動加速度 2.5 km/h/s (= 0.694 m/s^2)
    let tractiveAccel = 0;
    if (notch.type === 'power' && !this.doorsOpen) {
      const notchFactor = [0, 0.24, 0.45, 0.66, 0.84, 1.0][notch.level];
      const baseAccel = 0.70 * notchFactor; // m/s^2
      // 36 km/h まで定トルク、以降は定出力・特性領域で滑らかに減衰
      let speedCurve = 1.0;
      if (this.speedKmh > 36) {
        speedCurve = Math.pow(36 / this.speedKmh, 0.78);
      }
      // P1〜P3 での均衡速度リミット感
      const maxBalanceKmh = 38 + notch.level * 20; // P1:58 .. P5:138 km/h
      if (this.speedKmh > maxBalanceKmh) {
        speedCurve *= Math.max(0, 1 - (this.speedKmh - maxBalanceKmh) / 15);
      }
      tractiveAccel = baseAccel * speedCurve;
      this.motorEffort = THREE.MathUtils.lerp(this.motorEffort, notchFactor, safeDt * 5.0);
    } else if (notch.type === 'brake' && this.speedKmh > 7.5) {
      // 電気指令式・回生ブレーキ併用（7.5km/h以下で純空気ブレーキへフェードアウト＝電制失効再現）
      const regenFade = THREE.MathUtils.clamp((this.speedKmh - 7.5) / 8.0, 0, 1);
      const regenLevel = -(notch.level / 8.0) * regenFade;
      this.motorEffort = THREE.MathUtils.lerp(this.motorEffort, regenLevel, safeDt * 6.0);
    } else {
      this.motorEffort = THREE.MathUtils.lerp(this.motorEffort, 0, safeDt * 7.0);
    }

    // 3. 制動減速度 (m/s^2) — B8常用最大 約 4.0 km/h/s (1.11 m/s^2), EB 約 4.9 km/h/s (1.36 m/s^2)
    const brakeDecel = (this.bcPressure / 395) * 1.11;

    // 4. 走行抵抗 + 曲線抵抗 + 勾配抵抗 (m/s^2)
    // Davis式近似: a + b*V + c*V^2
    const rollingDrag = 0.014 + 0.00018 * this.speedKmh + 0.000014 * this.speedKmh * this.speedKmh;
    const curveDrag = Math.abs(frame.curvature) * 8.5;
    // 勾配抵抗: 1‰ あたり g/1000 ≒ 0.0098 m/s^2（上り勾配で減速、下り勾配で加速）
    const gradeAccel = -(frame.gradient * 0.0098);

    // 合成縦加速度
    let netAccel = tractiveAccel + gradeAccel;
    if (this.speedMps > 0.001) {
      netAccel -= brakeDecel + rollingDrag + curveDrag;
    } else {
      // 停止保持判定（ブレーキまたは抵抗が下り勾配力に勝っていれば完全静止）
      const holdForce = brakeDecel + rollingDrag;
      if (netAccel <= holdForce) {
        netAccel = 0;
        this.speedMps = 0;
      } else {
        netAccel -= holdForce;
      }
    }

    const prevSpeed = this.speedMps;
    this.speedMps = Math.max(0, this.speedMps + netAccel * safeDt);
    // 終端過走防止安全ストッパ (5,440m 付近でATS自動非常制動)
    if (this.distance > ROUTE_TOTAL_LENGTH + 220 && this.notchIndex > 0) {
      this.notchIndex = 0;
    }

    this.accelerationMps2 = (this.speedMps - prevSpeed) / Math.max(0.0001, safeDt);
    this.speedKmh = this.speedMps * 3.6;
    this.distance += this.speedMps * safeDt;

    // 5. 前台車2軸 (先頭より -2.1m, -4.2m) のレール継目通過判定 -> リアルな「ガタン・ゴトン」発生！
    const axle1 = this.distance - 2.1;
    const axle2 = this.distance - 4.2;

    if (this.speedMps > 0.15) {
      this._checkAxleJointCrossings(this._prevAxle1, axle1, 1, callbacks);
      this._checkAxleJointCrossings(this._prevAxle2, axle2, 2, callbacks);
    }
    this._prevAxle1 = axle1;
    this._prevAxle2 = axle2;

    return {
      distance: this.distance,
      speedKmh: this.speedKmh,
      speedMps: this.speedMps,
      accelerationMps2: this.accelerationMps2,
      bcPressure: this.bcPressure,
      mrPressure: this.mrPressure,
      motorEffort: this.motorEffort,
      frame,
      zone: this.route.getTrackZoneAt(this.distance),
    };
  }

  _checkAxleJointCrossings(prevX, currX, axleNumber, callbacks) {
    if (currX <= prevX) return;
    // 二分探索で prevX より大きい最初のジョイントを検索
    const arr = this._jointPositions;
    let lo = 0;
    let hi = arr.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid].d <= prevX) lo = mid + 1;
      else hi = mid;
    }

    for (let i = lo; i < arr.length && arr[i].d <= currX; i++) {
      if (callbacks.onRailJoint) {
        callbacks.onRailJoint({
          axle: axleNumber,
          zoneType: arr[i].zoneType,
          speedKmh: this.speedKmh,
        });
      }
    }
  }
}
