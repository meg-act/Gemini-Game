import * as THREE from 'three';
import { STATIONS, SPEED_LIMITS, ROUTE_TOTAL_LENGTH } from '../world/routeData.js';
import { NOTCH_STEPS, NEUTRAL_INDEX } from './notchConstants.js';

export { NOTCH_STEPS, NEUTRAL_INDEX };

/**
 * JR東日本 E531系・E231系（常磐線快速 15両編成相当）縦方向運動・空気ブレーキ・ATS-P連続パターン・雨天粘着・台車継目トラッカー
 */
export class TrainPhysics {
  constructor(route) {
    this.route = route;
    this.serviceType = 'rapid'; // 'rapid' (各駅停車: 全4駅) | 'special_rapid' (特快: 日暮里→北千住直行)
    this.isRaining = false;
    this.snowBrake = false;
    this._turnoutPoints = [46, 96, 156, 4848, 4928, 5260];

    this._jointPositions = this._generateRailJoints();
    this.reset(0);
  }

  /**
   * 路線全体のレール継目座標リストを生成
   *   - turnout_frog : 日暮里・北千住構内の片渡り・両渡り分岐器（トングレール・クロッシング欠線部）
   *   - expansion_ej : 隅田川橋梁・幹線道路架道橋前後のレール伸縮継目 (EJ)
   *   - standard_25m : 急曲線（R300三河島大カーブ等）および駅ホーム構内の25m定尺レール継目
   *   - bridge_deck  : 隅田川トラス鉄橋上の無道床枕木・橋桁継目
   *   - cwr_weld     : 高架直線・緩曲線区間のロングレール (CWR) 溶接部・閉塞絶縁継目 (IJ: 約180m間隔)
   */
  _generateRailJoints() {
    const joints = [];
    // 橋梁前後の実在伸縮継目 (EJ) 位置
    const ejPoints = [1088, 1116, 2166, 2196, 3882, 4068, 4368, 4394];
    for (const ejD of ejPoints) {
      joints.push({ d: ejD, zoneType: this.route.getTrackZoneAt(ejD).type, jointKind: 'expansion_ej' });
    }

    const isStationPlatform = (pos) =>
      STATIONS.some((st) => pos >= st.platformStart - 10 && pos <= st.platformEnd + 15);

    let d = -230;
    while (d < 5490) {
      const zone = this.route.getTrackZoneAt(d);
      let step = 180.0;
      let jointKind = 'cwr_weld';

      if (zone.type === 'turnout') {
        step = 11.0 + ((Math.abs(Math.round(d)) * 7) % 8);
        jointKind = 'turnout_frog';
      } else if (zone.type === 'sharp_curve') {
        step = 25.0;
        jointKind = 'standard_25m';
      } else if (zone.type === 'truss_bridge') {
        step = 20.5;
        jointKind = 'bridge_deck';
      } else if (isStationPlatform(d)) {
        step = 25.0;
        jointKind = 'standard_25m';
      } else {
        // 高架ロングレール区間（閉塞境界の絶縁継目 IJ・テルミット溶接部のみ）
        step = 175.0 + ((Math.abs(Math.round(d)) * 13) % 35);
        jointKind = 'cwr_weld';
      }

      d += step;
      // EJ近傍 (±5m) の重複を避ける
      if (!ejPoints.some((ej) => Math.abs(ej - d) < 5.0)) {
        joints.push({ d, zoneType: zone.type, jointKind });
      }
    }

    joints.sort((a, b) => a.d - b.d);
    return joints;
  }

  setServiceType(type) {
    this.serviceType = type;
  }

  setWeatherRain(raining) {
    this.isRaining = Boolean(raining);
    this.snowBrake = Boolean(raining);
  }

  toggleSnowBrake() {
    this.snowBrake = !this.snowBrake;
    this.notifyDriverActivity();
    return this.snowBrake;
  }

  /**
   * 運転士の機器操作通知（マスコン・警笛・ワイパー・前照灯・EBリセット等で60秒EBタイマーをクリア）
   */
  notifyDriverActivity() {
    this.ebTimer = 0;
    if (this.ebWarningActive || this.ebBrakeActive) {
      this.ebWarningActive = false;
      this.ebBrakeActive = false;
      return true;
    }
    return false;
  }

  /**
   * 運転台「EBリセット」黄色押しボタン操作
   */
  resetEbDevice() {
    const wasActive = this.ebWarningActive || this.ebBrakeActive;
    this.ebTimer = 0;
    this.ebWarningActive = false;
    this.ebBrakeActive = false;
    return { wasActive };
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

    this.atsPatternSpeedKmh = this._computeAtsPatternSpeedKmh(startDistance);
    this.atsPatternApproach = false;
    this.atsBrakeActive = false;
    this.ebTimer = 0;
    this.ebWarningActive = false;
    this.ebBrakeActive = false;
    this.wheelSlip = 0;

    this._prevDistance = startDistance;
    this._prevAxle1 = startDistance - 2.1;
    this._prevAxle2 = startDistance - 4.2;
  }

  /**
   * ATS-P 連続照査速度パターン (km/h) の算出
   * 現在区間の制限速度、前方650m以内の下位速度制限区間、および北千住終端過走防止パターンを統合照査
   */
  _computeAtsPatternSpeedKmh(d) {
    const curLimObj = this.route.getSpeedLimitAt(d);
    const curLimit = curLimObj ? curLimObj.limit : 95;
    let patternKmh = curLimit + 3.0; // 実車ATS-Pの常用パターン照査マージン (+3 km/h)
    const aPat = 0.88; // パターン減速度 (m/s^2 ≒ 3.17 km/h/s)

    for (let i = 0; i < SPEED_LIMITS.length; i++) {
      const sl = SPEED_LIMITS[i];
      if (sl.start > d && sl.start - d < 650 && sl.limit < curLimit) {
        const distAhead = Math.max(0, sl.start - d - 8.0);
        const vTargetMps = (sl.limit + 2.5) / 3.6;
        const vPatKmh = 3.6 * Math.sqrt(vTargetMps * vTargetMps + 2 * aPat * distAhead);
        if (vPatKmh < patternKmh) patternKmh = vPatKmh;
      }
    }

    // 北千住1番線 終端過走防止0km/hパターン（5,200m停止目標の48m奥＝5,248mを終端防護点に設定）
    const terminalGuardD = ROUTE_TOTAL_LENGTH + 48;
    if (d > terminalGuardD - 620) {
      const remTerm = Math.max(0, terminalGuardD - d);
      const vTermKmh = 3.6 * Math.sqrt(2 * aPat * remTerm);
      if (vTermKmh < patternKmh) patternKmh = vTermKmh;
    }

    return Math.max(0, Math.min(140, patternKmh));
  }

  get currentNotch() {
    return NOTCH_STEPS[this.notchIndex];
  }

  /**
   * マスコンを手前に引く（制動解除 → 力行側へ +1段）
   */
  pullHandle() {
    this.notifyDriverActivity();
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
    this.notifyDriverActivity();
    if (this.notchIndex > 0) {
      this.notchIndex--;
      return { changed: true, notch: this.currentNotch };
    }
    return { changed: false };
  }

  setNeutral() {
    this.notifyDriverActivity();
    if (this.notchIndex !== NEUTRAL_INDEX) {
      this.notchIndex = NEUTRAL_INDEX;
      return { changed: true, notch: this.currentNotch };
    }
    return { changed: false };
  }

  applyEmergencyBrake() {
    this.notifyDriverActivity();
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
    this.notifyDriverActivity();
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
   * 毎フレーム物理積分・ATS-P照査・EB装置60秒監視・雨天粘着・分岐器横揺れ・停止カックン判定
   */
  update(dt, callbacks = {}) {
    const safeDt = Math.min(dt, 0.05);
    const frame = this.route.getFrameAt(this.distance);

    // 0A. EB装置（緊急列車防護装置）：走行中60秒無操作で警報ブザー → さらに5秒放置で非常ブレーキ自動投入！
    if (this.speedKmh > 1.0 && !this.doorsOpen) {
      this.ebTimer += safeDt;
      if (this.ebTimer >= 60.0 && !this.ebWarningActive) {
        this.ebWarningActive = true;
        if (callbacks.onEbEvent) callbacks.onEbEvent({ type: 'warning_start' });
      }
      if (this.ebTimer >= 65.0 && !this.ebBrakeActive) {
        this.ebBrakeActive = true;
        this.notchIndex = 0; // EB投入
        if (callbacks.onEbEvent) callbacks.onEbEvent({ type: 'eb_apply' });
      }
    } else if (!this.ebBrakeActive) {
      if (this.ebWarningActive && callbacks.onEbEvent) {
        callbacks.onEbEvent({ type: 'reset' });
      }
      this.ebTimer = 0;
      this.ebWarningActive = false;
    }

    const notch = this.currentNotch;

    // 0B. ATS-P 連続速度パターン照査
    this.atsPatternSpeedKmh = this._computeAtsPatternSpeedKmh(this.distance);
    const prevApproach = this.atsPatternApproach;
    this.atsPatternApproach =
      this.atsBrakeActive ||
      (this.speedKmh > 4.0 && this.speedKmh >= this.atsPatternSpeedKmh - 5.0);

    if (!this.atsBrakeActive && this.speedKmh > this.atsPatternSpeedKmh + 0.4) {
      this.atsBrakeActive = true;
      if (callbacks.onAtsEvent) callbacks.onAtsEvent({ type: 'brake_apply' });
    } else if (
      this.atsBrakeActive &&
      this.speedKmh <= Math.max(0, this.atsPatternSpeedKmh - 4.0)
    ) {
      this.atsBrakeActive = false;
      if (callbacks.onAtsEvent) callbacks.onAtsEvent({ type: 'brake_release' });
    } else if (!prevApproach && this.atsPatternApproach && callbacks.onAtsEvent) {
      callbacks.onAtsEvent({ type: 'pattern_approach' });
    }

    // 1. 電気指令式ブレーキ圧 (BC) の一次遅れ応答 & 耐雪ブレーキ最低圧保持 & ATS-P / EB装置指令
    const snowHoldKpa = this.snowBrake && this.speedKmh > 4.0 ? 26 : 0;
    const atsCommandKpa = this.atsBrakeActive ? 355 : 0;
    const ebCommandKpa = this.ebBrakeActive ? 480 : 0;
    const targetBc = Math.max(notch.targetBcKpa, snowHoldKpa, atsCommandKpa, ebCommandKpa);

    const bcRate =
      notch.type === 'eb' || this.atsBrakeActive || this.ebBrakeActive
        ? 410 // 非常またはATS-P常用最大は急速立ち上がり
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

    // 2. VVVF主電動機 引張力加速度 (m/s^2) ＋ 雨天時の微小空転再粘着制御
    let tractiveAccel = 0;
    if (notch.type === 'power' && !this.doorsOpen && !this.atsBrakeActive && !this.ebBrakeActive) {
      const notchFactor = [0, 0.24, 0.45, 0.66, 0.84, 1.0][notch.level];
      const baseAccel = 0.70 * notchFactor; // m/s^2
      let speedCurve = 1.0;
      if (this.speedKmh > 36) {
        speedCurve = Math.pow(36 / this.speedKmh, 0.78);
      }
      const maxBalanceKmh = 38 + notch.level * 20; // P1:58 .. P5:138 km/h
      if (this.speedKmh > maxBalanceKmh) {
        speedCurve *= Math.max(0, 1 - (this.speedKmh - maxBalanceKmh) / 15);
      }
      if (this.isRaining && notch.level >= 4 && this.speedKmh < 34) {
        const slipPulse = 0.5 + 0.5 * Math.sin(this.distance * 1.9 + this.speedMps * 8.0);
        this.wheelSlip = THREE.MathUtils.lerp(this.wheelSlip, 0.08 + 0.07 * slipPulse, safeDt * 6.0);
      } else {
        this.wheelSlip = THREE.MathUtils.lerp(this.wheelSlip, 0, safeDt * 8.0);
      }
      tractiveAccel = baseAccel * speedCurve * (1.0 - this.wheelSlip * 0.65);
      this.motorEffort = THREE.MathUtils.lerp(this.motorEffort, notchFactor, safeDt * 5.0);
    } else if ((notch.type === 'brake' || this.atsBrakeActive) && !this.ebBrakeActive && this.speedKmh > 7.5) {
      this.wheelSlip = THREE.MathUtils.lerp(this.wheelSlip, 0, safeDt * 8.0);
      const effLevel = this.atsBrakeActive ? 7.2 : notch.level;
      const regenFade = THREE.MathUtils.clamp((this.speedKmh - 7.5) / 8.0, 0, 1);
      const regenLevel = -(effLevel / 8.0) * regenFade;
      this.motorEffort = THREE.MathUtils.lerp(this.motorEffort, regenLevel, safeDt * 6.0);
    } else {
      this.wheelSlip = THREE.MathUtils.lerp(this.wheelSlip, 0, safeDt * 8.0);
      this.motorEffort = THREE.MathUtils.lerp(this.motorEffort, 0, safeDt * 7.0);
    }

    // 3. 制動減速度 (m/s^2)
    const effectiveRetardBc =
      notch.type === 'power' || notch.type === 'neutral'
        ? this.atsBrakeActive || this.ebBrakeActive
          ? this.bcPressure
          : Math.max(0, this.bcPressure - snowHoldKpa)
        : this.bcPressure;
    const wetBrakeFactor = this.isRaining ? (this.snowBrake ? 0.94 : 0.86) : 1.0;
    const brakeDecel = (effectiveRetardBc / 395) * 1.11 * wetBrakeFactor;

    // 4. 走行抵抗 + 曲線抵抗 + 勾配抵抗 (m/s^2)
    const rollingDrag = 0.014 + 0.00018 * this.speedKmh + 0.000014 * this.speedKmh * this.speedKmh;
    const curveDrag = Math.abs(frame.curvature) * 8.5;
    const gradeAccel = -(frame.gradient * 0.0098);

    // 合成縦加速度
    let netAccel = tractiveAccel + gradeAccel;
    if (this.speedMps > 0.001) {
      netAccel -= brakeDecel + rollingDrag + curveDrag;
    } else {
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
    // 終端過走防止安全ストッパ
    if (this.distance > ROUTE_TOTAL_LENGTH + 220 && this.notchIndex > 0) {
      this.notchIndex = 0;
    }

    // 停止瞬間の静摩擦ロック反動
    if (prevSpeed > 0.025 && this.speedMps === 0 && callbacks.onStopJerk) {
      callbacks.onStopJerk(this.bcPressure);
    }

    this.accelerationMps2 = (this.speedMps - prevSpeed) / Math.max(0.0001, safeDt);
    this.speedKmh = this.speedMps * 3.6;
    const prevDist = this.distance;
    this.distance += this.speedMps * safeDt;

    // 5. 分岐器ポイント通過時の横方向スラスト揺れイベント
    if (this.distance > prevDist) {
      for (let i = 0; i < this._turnoutPoints.length; i++) {
        const tp = this._turnoutPoints[i];
        if (prevDist < tp && this.distance >= tp) {
          if (callbacks.onTurnoutJolt) {
            const dir = i % 2 === 0 ? 1 : -1;
            const strength = dir * THREE.MathUtils.clamp(this.speedKmh / 55, 0.25, 1.15);
            callbacks.onTurnoutJolt(strength);
          }
        }
      }
    }
    this._prevDistance = this.distance;

    // 6. 前台車2軸 (先頭より -2.1m, -4.2m) のレール継目通過判定（ロングレール・EJ・定尺・分岐器を区別！）
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
      atsPatternSpeedKmh: this.atsPatternSpeedKmh,
      atsPatternApproach: this.atsPatternApproach,
      atsBrakeActive: this.atsBrakeActive,
      ebTimer: this.ebTimer,
      ebWarningActive: this.ebWarningActive,
      ebBrakeActive: this.ebBrakeActive,
      snowBrake: this.snowBrake,
      isRaining: this.isRaining,
      wheelSlip: this.wheelSlip,
      frame,
      zone: this.route.getTrackZoneAt(this.distance),
    };
  }

  _checkAxleJointCrossings(prevX, currX, axleNumber, callbacks) {
    if (currX <= prevX) return;
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
          jointKind: arr[i].jointKind || 'standard_25m',
          speedKmh: this.speedKmh,
        });
      }
    }
  }
}
