import * as THREE from 'three';

/**
 * JR常磐線（快速線 JJ）日暮里 (JJ02) 〜 北千住 (JJ05) 実寸 5,200m 路線・配線データ
 *
 * 実物配線準拠:
 *   - 日暮里   (JJ02,    0m): 島式3・4番線ホーム（下り4番線＝右側ホーム、右隣+9.6mに上り3番線、
 *                             左側には東北本線通過複線・京浜東北・山手線ホーム群、右上に京成2層高架駅）
 *   - 三河島   (JJ03, 1200m): 島式1・2番線高架ホーム（下り1番線＝右側ホーム）
 *   - 南千住   (JJ04, 3400m): 島式1・2番線高架ホーム（下り1番線＝右側ホーム）
 *   - 北千住   (JJ05, 5200m): 都内JR唯一の2面3線（左側＝1番線単式ホーム、中央+4.3m＝2番線中線待避線、
 *                             その右＝2・3番線島式ホーム、+14.0m＝3番線上り本線、さらに東側に東武・日比谷線3階高架駅）
 */

export const ROUTE_START_BUFFER = -240;
export const ROUTE_END_BUFFER = 5500;
export const ROUTE_TOTAL_LENGTH = 5200;
export const TRACK_GAUGE = 1.067;
export const TRACK_SEPARATION = 3.8;

export const STATIONS = [
  {
    id: 'nippori',
    code: 'JJ 02',
    nameKanji: '日暮里',
    nameKana: 'にっぽり',
    nameEn: 'Nippori',
    prevName: '上野',
    nextName: '三河島',
    trackLabel: '4番線 常磐線（快速）松戸・取手・水戸方面',
    transferText: '山手線・京浜東北線・京成線・日暮里-舎人ライナー',
    stopDistance: 0,
    platformStart: -218,
    platformEnd: 24,
    platformSide: 'right', // 実物通り：下り4番線は進行方向「右側」が3・4番線島式ホーム！
    stopRapid: true,
    stopSpecialRapid: true,
    roofRatio: 0.92,
  },
  {
    id: 'mikawashima',
    code: 'JJ 03',
    nameKanji: '三河島',
    nameKana: 'みかわしま',
    nameEn: 'Mikawashima',
    prevName: '日暮里',
    nextName: '南千住',
    trackLabel: '1番線 常磐線（快速）松戸・柏・取手方面',
    transferText: '出口 荒川仲町通り・尾竹橋通り方面',
    stopDistance: 1200,
    platformStart: 982,
    platformEnd: 1220,
    platformSide: 'right', // 島式1面2線（右側ホーム）
    stopRapid: true,
    stopSpecialRapid: false,
    roofRatio: 0.80,
  },
  {
    id: 'minamisenju',
    code: 'JJ 04',
    nameKanji: '南千住',
    nameKana: 'みなみせんじゅ',
    nameEn: 'Minami-Senju',
    prevName: '三河島',
    nextName: '北千住',
    trackLabel: '1番線 常磐線（快速）北千住・松戸・取手方面',
    transferText: '日比谷線・つくばエクスプレス線・東口(汐入)',
    stopDistance: 3400,
    platformStart: 3182,
    platformEnd: 3420,
    platformSide: 'right', // 島式1面2線（右側ホーム）
    stopRapid: true,
    stopSpecialRapid: false,
    roofRatio: 0.84,
  },
  {
    id: 'kitasenju',
    code: 'JJ 05',
    nameKanji: '北千住',
    nameKana: 'きたせんじゅ',
    nameEn: 'Kita-Senju',
    prevName: '南千住',
    nextName: '松戸',
    trackLabel: '1番線 常磐線（快速）松戸・柏・取手・水戸方面',
    transferText: '千代田線・日比谷線・東武スカイツリーライン・TX線',
    stopDistance: 5200,
    platformStart: 4955,
    platformEnd: 5230,
    platformSide: 'left', // 下り1番線は進行方向「左側」の単式ホーム！右隣に2番線中線＋2・3番線島式ホーム！
    hasCenterSiding: true,
    stopRapid: true,
    stopSpecialRapid: true,
    roofRatio: 0.98,
  },
];

export const SPEED_LIMITS = [
  { start: -250, end: 160, limit: 55, label: '日暮里構内分岐' },
  { start: 160, end: 980, limit: 60, label: '三河島大カーブ R300' },
  { start: 980, end: 1380, limit: 75, label: '三河島構内' },
  { start: 1380, end: 3820, limit: 95, label: '高架直線区間' },
  { start: 3820, end: 4320, limit: 85, label: '隅田川橋梁' },
  { start: 4320, end: 4850, limit: 75, label: '千住関屋カーブ' },
  { start: 4850, end: 5550, limit: 45, label: '北千住進入分岐' },
];

export const TRACK_ZONES = [
  { start: -250, end: 160, type: 'turnout', label: '日暮里駅構内' },
  { start: 160, end: 980, type: 'sharp_curve', label: '日暮里〜三河島 急曲線' },
  { start: 980, end: 2350, type: 'viaduct_ballast', label: '三河島高架' },
  { start: 2350, end: 3250, type: 'freight_yard', label: '隅田川貨物駅並走区間' },
  { start: 3250, end: 3940, type: 'viaduct_ballast', label: '南千住高架' },
  { start: 3940, end: 4195, type: 'truss_bridge', label: '隅田川橋梁（鋼トラス）' },
  { start: 4195, end: 4840, type: 'viaduct_ballast', label: '千住関屋高架（京成線跨線）' },
  { start: 4840, end: 5550, type: 'turnout', label: '北千住駅構内' },
];

export const LANDMARKS = {
  keiseiNipporiOverpass: 95,
  toneriLinerOverpass: 35,
  greatCurveCenter: 560,
  tabataFreightMerge: 1480,
  sumidaFreightYardStart: 2380,
  sumidaFreightYardEnd: 3180,
  senjuGasHolders: 2680,
  sumidaBridgeStart: 3945,
  sumidaBridgeEnd: 4190,
  keiseiSekiyaUnderpass: 4380,
  kitasenjuTurnoutStart: 4810,
  kitasenjuTurnoutEnd: 5360,
};

const WORLD_UP = new THREE.Vector3(0, 1, 0);

function smoothstep(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function headingAtDistance(d) {
  let h = -30;
  h += 106 * smoothstep(160, 960, d);    // 日暮里(-30°) -> 三河島大カーブ(+76°)
  h -= 58 * smoothstep(1350, 2280, d);   // -> 隅田川貨物駅・南千住(+18°)
  h -= 8 * smoothstep(3480, 3880, d);    // -> 隅田川橋梁(+10°)
  h -= 8 * smoothstep(4260, 4820, d);    // -> 北千住ターミナル(+2°)
  return (h * Math.PI) / 180;
}

function elevationAtDistance(d) {
  let y = 5.2;
  y += 3.0 * smoothstep(80, 750, d);     // 日暮里掘割地平(5.2m) -> 三河島高架(8.2m)
  y += 0.6 * smoothstep(1500, 2200, d);  // -> 8.8m
  y += 2.6 * smoothstep(3450, 3920, d);  // -> 隅田川橋梁(11.4m)
  y -= 4.6 * smoothstep(4350, 4920, d);  // -> 北千住1階ホーム(6.8m)
  return y;
}

export class RouteGeometry {
  constructor() {
    this.minD = ROUTE_START_BUFFER;
    this.maxD = ROUTE_END_BUFFER;
    this.count = this.maxD - this.minD + 1;

    this.positions = new Array(this.count);
    this.tangents = new Array(this.count);
    this.rights = new Array(this.count);
    this.ups = new Array(this.count);
    this.cants = new Float32Array(this.count);
    this.curvatures = new Float32Array(this.count);
    this.gradients = new Float32Array(this.count);

    this._buildTable();
  }

  _buildTable() {
    const rawPos = new Array(this.count);
    let x = 0;
    let z = 0;

    for (let i = 0; i < this.count; i++) {
      const d = this.minD + i;
      const y = elevationAtDistance(d);
      rawPos[i] = new THREE.Vector3(x, y, z);

      const yawMid = headingAtDistance(d + 0.5);
      x += Math.sin(yawMid) * 1.0;
      z += -Math.cos(yawMid) * 1.0;
    }

    const zeroIdx = -this.minD;
    const originOffset = new THREE.Vector3(rawPos[zeroIdx].x, 0, rawPos[zeroIdx].z);
    for (let i = 0; i < this.count; i++) {
      rawPos[i].sub(originOffset);
      this.positions[i] = rawPos[i];
    }

    for (let i = 0; i < this.count; i++) {
      const prev = this.positions[Math.max(0, i - 1)];
      const next = this.positions[Math.min(this.count - 1, i + 1)];
      const tangent = new THREE.Vector3().subVectors(next, prev).normalize();
      this.tangents[i] = tangent;
      this.gradients[i] = tangent.y * 1000;

      const d = this.minD + i;
      const yaw1 = headingAtDistance(d - 2);
      const yaw2 = headingAtDistance(d + 2);
      const curvature = (yaw2 - yaw1) / 4.0;
      this.curvatures[i] = curvature;

      const maxCantRad = THREE.MathUtils.degToRad(5.6);
      const targetCant = THREE.MathUtils.clamp(curvature * 31.0, -maxCantRad, maxCantRad);
      this.cants[i] = targetCant;

      const horizRight = new THREE.Vector3().crossVectors(tangent, WORLD_UP).normalize();
      const normalUp = new THREE.Vector3().crossVectors(horizRight, tangent).normalize();

      const cosC = Math.cos(targetCant);
      const sinC = Math.sin(targetCant);

      this.rights[i] = new THREE.Vector3()
        .addScaledVector(horizRight, cosC)
        .addScaledVector(normalUp, -sinC)
        .normalize();

      this.ups[i] = new THREE.Vector3()
        .addScaledVector(horizRight, sinC)
        .addScaledVector(normalUp, cosC)
        .normalize();
    }
  }

  getFrameAt(d, target = null) {
    const clamped = Math.max(this.minD, Math.min(this.maxD - 1.001, d));
    const fIdx = clamped - this.minD;
    const i0 = Math.floor(fIdx);
    const i1 = Math.min(this.count - 1, i0 + 1);
    const alpha = fIdx - i0;

    const out = target || {
      position: new THREE.Vector3(),
      tangent: new THREE.Vector3(),
      right: new THREE.Vector3(),
      up: new THREE.Vector3(),
      cant: 0,
      curvature: 0,
      gradient: 0,
    };

    out.position.lerpVectors(this.positions[i0], this.positions[i1], alpha);
    out.tangent.lerpVectors(this.tangents[i0], this.tangents[i1], alpha).normalize();
    out.right.lerpVectors(this.rights[i0], this.rights[i1], alpha).normalize();
    out.up.lerpVectors(this.ups[i0], this.ups[i1], alpha).normalize();
    out.cant = THREE.MathUtils.lerp(this.cants[i0], this.cants[i1], alpha);
    out.curvature = THREE.MathUtils.lerp(this.curvatures[i0], this.curvatures[i1], alpha);
    out.gradient = THREE.MathUtils.lerp(this.gradients[i0], this.gradients[i1], alpha);

    return out;
  }

  /**
   * 上り本線（常磐線上り：日暮里3番線・三河島2番線・南千住2番線・北千住3番線）の横オフセット (m)
   * 実物配線準拠:
   *   - 日暮里(-240..+185m): 3・4番線島式ホームを挟むため +9.6m -> 発車後に +3.8m へ収束！
   *   - 三河島(820..1380m) & 南千住(3020..3580m): 島式ホームを挟むため +9.6m へ拡幅！
   *   - 北千住(4700..5500m): 2番線中線(+4.3m)と2・3番線島式ホーム(+5.9..+12.3m)を挟むため +14.0m へ拡幅！
   */
  getUpTrackOffset(d) {
    const bell = (start, pStart, pEnd, end) => {
      if (d <= start || d >= end) return 0;
      if (d >= pStart && d <= pEnd) return 1;
      if (d < pStart) return smoothstep(start, pStart, d);
      return 1.0 - smoothstep(pEnd, end, d);
    };

    // 日暮里3・4番線島式ホーム拡幅 (+5.8m -> 計 9.6m)
    const widenNippori = (1.0 - smoothstep(32, 185, d)) * 5.8;
    // 三河島・南千住 島式ホーム拡幅 (+5.8m -> 計 9.6m)
    const widenMikawashima = bell(825, 965, 1235, 1375) * 5.8;
    const widenMinamiSenju = bell(3025, 3165, 3435, 3575) * 5.8;
    // 北千住 2面3線（中線＋島式ホーム）拡幅 (+10.2m -> 計 14.0m)
    const widenKitaSenju = bell(4680, 4890, 5265, 5475) * 10.2;

    return TRACK_SEPARATION + widenNippori + widenMikawashima + widenMinamiSenju + widenKitaSenju;
  }

  getUpTrackPositionAt(d) {
    const down = this.getFrameAt(d);
    const horizRight = new THREE.Vector3().crossVectors(down.tangent, WORLD_UP).normalize();
    const offset = this.getUpTrackOffset(d);
    return down.position.clone().addScaledVector(horizRight, offset);
  }

  getUpTrackFrameAt(d) {
    const position = this.getUpTrackPositionAt(d);
    const offset = this.getUpTrackOffset(d);
    const down = this.getFrameAt(d);

    // 島式ホーム拡幅などのS字カーブに追従する「実際の上り線路接線」を中央差分で算出！
    const eps = 0.6;
    const pPrev = this.getUpTrackPositionAt(d - eps);
    const pNext = this.getUpTrackPositionAt(d + eps);
    const trueForward = pNext.sub(pPrev);
    if (trueForward.lengthSq() < 1e-8) {
      trueForward.copy(down.tangent);
    } else {
      trueForward.normalize();
    }
    const horizRight = new THREE.Vector3().crossVectors(trueForward, WORLD_UP).normalize();
    const trueUp = new THREE.Vector3().crossVectors(horizRight, trueForward).normalize();

    return {
      position,
      tangent: trueForward.clone().negate(),
      forwardAlongRoute: trueForward,
      right: horizRight,
      up: trueUp,
      horizRight,
      offset,
    };
  }

  /**
   * 北千住駅 2番線（上下共用 中線・待避線：d = 4810m .. 5360m）の座標フレーム
   * 4810m で下り1番線(0.0m)から右へ分岐して +4.25m へ達し、5250..5360m で再び本線側へ収束
   */
  getKitaSenjuMiddleTrackOffset(d) {
    if (d < LANDMARKS.kitasenjuTurnoutStart || d > LANDMARKS.kitasenjuTurnoutEnd) {
      return null;
    }
    if (d < 4935) {
      return smoothstep(LANDMARKS.kitasenjuTurnoutStart, 4935, d) * 4.25;
    }
    if (d > 5245) {
      return (1.0 - smoothstep(5245, LANDMARKS.kitasenjuTurnoutEnd, d)) * 4.25;
    }
    return 4.25;
  }

  getSpeedLimitAt(d) {
    for (let i = 0; i < SPEED_LIMITS.length; i++) {
      const s = SPEED_LIMITS[i];
      if (d >= s.start && d < s.end) return s;
    }
    return SPEED_LIMITS[SPEED_LIMITS.length - 1];
  }

  getTrackZoneAt(d) {
    for (let i = 0; i < TRACK_ZONES.length; i++) {
      const z = TRACK_ZONES[i];
      if (d >= z.start && d < z.end) return z;
    }
    return TRACK_ZONES[0];
  }

  /**
   * 日暮里駅西側に並走し、西日暮里・田端・尾久方面へ直進分岐していく在来線8線（東北本線4線＋京浜東北・山手4線）座標
   */
  getNipporiParallelPoint(d, lateralOffset) {
    if (!this._nipporiRefReady) {
      const nipRef = this.getFrameAt(20);
      this._nipporiBasePos = nipRef.position.clone();
      this._nipporiStraightDir = nipRef.tangent.clone();
      this._nipporiStraightDir.y = 0.002;
      this._nipporiStraightDir.normalize();
      this._nipporiHorizRight = new THREE.Vector3()
        .crossVectors(this._nipporiStraightDir, WORLD_UP)
        .normalize();
      this._nipporiRefReady = true;
    }

    if (d <= 20) {
      const f = this.getFrameAt(d);
      const r = new THREE.Vector3().crossVectors(f.tangent, WORLD_UP).normalize();
      return {
        position: f.position.clone().addScaledVector(r, lateralOffset),
        tangent: f.tangent.clone(),
        right: r,
        up: WORLD_UP,
      };
    }

    const distFrom20 = d - 20;
    const pos = this._nipporiBasePos
      .clone()
      .addScaledVector(this._nipporiStraightDir, distFrom20)
      .addScaledVector(this._nipporiHorizRight, lateralOffset);
    return {
      position: pos,
      tangent: this._nipporiStraightDir.clone(),
      right: this._nipporiHorizRight.clone(),
      up: WORLD_UP,
    };
  }

  /**
   * 東北新幹線（日暮里 第1上野トンネル抗口 d=+28m -> U字擁壁急勾配アプローチ -> 高架橋 d=+240m..+460m）の相対高さ (m)
   */
  getNipporiShinkansenOffsetY(d) {
    if (d <= 28) return -4.55;
    if (d >= 240) return 6.80;
    return -4.55 + 11.35 * smoothstep(28, 240, d);
  }

  /**
   * 東北新幹線の3D座標・勾配ピッチ付き接線フレームを取得
   */
  getNipporiShinkansenPoint(d, lateralOffset) {
    const base = this.getNipporiParallelPoint(d, lateralOffset);
    const offY = this.getNipporiShinkansenOffsetY(d);
    const slope =
      (this.getNipporiShinkansenOffsetY(d + 1.0) - this.getNipporiShinkansenOffsetY(d - 1.0)) * 0.5;

    const position = base.position.clone().addScaledVector(WORLD_UP, offY);
    const tangent = base.tangent.clone();
    tangent.y += slope;
    tangent.normalize();
    const right = base.right.clone();
    const up = new THREE.Vector3().crossVectors(right, tangent).normalize();

    return { position, tangent, right, up, offsetY: offY };
  }
}

// 日暮里コリドー 在来線並走8線（東から順に：東北本線・高崎線・尾久回送線 4線 ＋ 京浜東北・山手線方向別複々線 4線）
export const NIPPORI_TOHOKU_TRACKS = [-4.6, -8.4, -12.8, -16.6];
export const NIPPORI_KEIHIN_YAMANOTE_TRACKS = [-32.2, -40.8, -45.0, -53.6]; // 9番線, 10番線, 11番線, 12番線
export const NIPPORI_SURFACE_TRACKS = [
  ...NIPPORI_TOHOKU_TRACKS,
  ...NIPPORI_KEIHIN_YAMANOTE_TRACKS,
];
export const NIPPORI_SHINKANSEN_TRACKS = [-22.2, -26.4]; // 東北新幹線上り, 東北新幹線下り
export const SHINKANSEN_GAUGE = 1.435;

