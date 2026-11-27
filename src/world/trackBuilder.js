import * as THREE from 'three';
import {
  ROUTE_START_BUFFER,
  ROUTE_END_BUFFER,
  TRACK_GAUGE,
  SHINKANSEN_GAUGE,
  NIPPORI_TOHOKU_TRACKS,
  NIPPORI_KEIHIN_YAMANOTE_TRACKS,
  NIPPORI_SURFACE_TRACKS,
  NIPPORI_SHINKANSEN_TRACKS,
  LANDMARKS,
  SPEED_LIMITS,
  STATIONS,
} from './routeData.js';
import {
  createSpeedSignTexture,
  createKilometerPostTexture,
  createGradientPostTexture,
} from './textures.js';

const WORLD_UP = new THREE.Vector3(0, 1, 0);

function mergeTrackGeos(geos) {
  let totalV = 0;
  let totalI = 0;
  for (const g of geos) {
    totalV += g.attributes.position.count;
    totalI += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(totalV * 3);
  const norm = new Float32Array(totalV * 3);
  const uv = new Float32Array(totalV * 2);
  const idx = new Uint32Array(totalI);
  let vOff = 0;
  let iOff = 0;
  for (const g of geos) {
    const p = g.attributes.position;
    const n = g.attributes.normal;
    const u = g.attributes.uv;
    pos.set(p.array, vOff * 3);
    if (n) norm.set(n.array, vOff * 3);
    if (u) uv.set(u.array, vOff * 2);
    if (g.index) {
      const gi = g.index.array;
      for (let k = 0; k < gi.length; k++) idx[iOff + k] = gi[k] + vOff;
      iOff += gi.length;
    } else {
      for (let k = 0; k < p.count; k++) idx[iOff + k] = vOff + k;
      iOff += p.count;
    }
    vOff += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

/**
 * JR高架区間特有のH形鋼＋ラチスブレース架線柱＋基礎アンカー＋頂部き電線腕金ジオメトリ（中心基準、全高 ~8.2m）
 */
function createHBeamMastGeo() {
  const parts = [];
  // 前後フランジ (H鋼)
  const flangeF = new THREE.BoxGeometry(0.28, 7.85, 0.048);
  flangeF.translate(0, 0.12, 0.12);
  parts.push(flangeF);
  const flangeB = new THREE.BoxGeometry(0.28, 7.85, 0.048);
  flangeB.translate(0, 0.12, -0.12);
  parts.push(flangeB);
  // 中央ウェブ
  const web = new THREE.BoxGeometry(0.052, 7.85, 0.20);
  web.translate(0, 0.12, 0);
  parts.push(web);
  // 足元フランジベースプレート＆アンカー台座
  const basePlate = new THREE.BoxGeometry(0.46, 0.28, 0.46);
  basePlate.translate(0, -3.55, 0);
  parts.push(basePlate);
  // 柱頭き電線支持腕金 (Feeder Cross-Arm)
  const topArm = new THREE.BoxGeometry(0.76, 0.09, 0.09);
  topArm.translate(0, 3.82, 0);
  parts.push(topArm);
  return mergeTrackGeos(parts);
}

/**
 * 空が透けて見える立体アングル鉄骨ワーレントラス架線ビーム（正規化幅 1.0: x = -0.5..+0.5）
 */
function createLatticeTrussBeamGeo() {
  const parts = [];
  const h = 0.46;
  const d = 0.26;
  // 上弦材・下弦材（前後2本ずつ＝4本のアングル材で立体トラス構成！）
  for (const sy of [-h * 0.5, h * 0.5]) {
    for (const sz of [-d * 0.5, d * 0.5]) {
      const chord = new THREE.BoxGeometry(1.0, 0.052, 0.048);
      chord.translate(0, sy, sz);
      parts.push(chord);
    }
  }
  // 10パネルの鉛直束材＋斜材ラチス＋上面横つなぎ材
  const bays = 10;
  const bayW = 1.0 / bays;
  const diagLen = Math.hypot(bayW, h);
  const diagAng = Math.atan2(h, bayW);
  for (let i = 0; i <= bays; i++) {
    const x = -0.5 + i * bayW;
    for (const sz of [-d * 0.5, d * 0.5]) {
      const post = new THREE.BoxGeometry(0.016, h, 0.036);
      post.translate(x, 0, sz);
      parts.push(post);
    }
    const tieTop = new THREE.BoxGeometry(0.016, 0.032, d);
    tieTop.translate(x, h * 0.5, 0);
    parts.push(tieTop);
    const tieBot = new THREE.BoxGeometry(0.016, 0.032, d);
    tieBot.translate(x, -h * 0.5, 0);
    parts.push(tieBot);

    if (i < bays) {
      const mx = x + bayW * 0.5;
      const sign = i % 2 === 0 ? 1 : -1;
      for (const sz of [-d * 0.5, d * 0.5]) {
        const diag = new THREE.BoxGeometry(diagLen, 0.034, 0.030);
        diag.rotateZ(sign * diagAng);
        diag.translate(mx, 0, sz);
        parts.push(diag);
      }
    }
  }
  return mergeTrackGeos(parts);
}

/**
 * 白色懸垂がいし連＋斜め腕金＋曲引き金具（可動ブラケット）一体ジオメトリ
 */
function createRegistrationBracketGeo() {
  const parts = [];
  // 懸垂がいし本体＋4枚の磁器ひだ（シェード）
  const core = new THREE.CylinderGeometry(0.048, 0.048, 0.44, 8);
  core.translate(0, 0.04, 0);
  parts.push(core);
  for (const sy of [-0.10, -0.01, 0.08, 0.17]) {
    const shed = new THREE.CylinderGeometry(0.105, 0.115, 0.028, 10);
    shed.translate(0, sy, 0);
    parts.push(shed);
  }
  // 下方に伸びる可動ブラケット支柱＆斜め曲引きアーム（トロリー線高さ y=-1.10 付近まで支持！）
  const dropPipe = new THREE.BoxGeometry(0.038, 0.96, 0.038);
  dropPipe.translate(0.32, -0.46, 0);
  parts.push(dropPipe);

  const upperArm = new THREE.BoxGeometry(0.42, 0.036, 0.036);
  upperArm.translate(0.15, -0.14, 0);
  parts.push(upperArm);

  const pullOffArm = new THREE.BoxGeometry(0.46, 0.032, 0.032);
  pullOffArm.rotateZ(0.46);
  pullOffArm.translate(0.16, -0.78, 0);
  parts.push(pullOffArm);

  const steadyArm = new THREE.BoxGeometry(0.38, 0.024, 0.024);
  steadyArm.rotateZ(-0.18);
  steadyArm.translate(0.15, -0.96, 0);
  parts.push(steadyArm);

  return mergeTrackGeos(parts);
}

/**
 * 複線本線＋北千住2番線（中線待避線）＋日暮里14線メガコリドー
 * （常磐2線＋東北本線・高崎・尾久4線＋東北新幹線2線[地下抗口〜急勾配高架]＋京浜東北・山手方向別複々線4線＋京成2線）、
 * 2層PBR金属レール、PC枕木、スラブ軌道、3Dラチス架線柱・曲引き金具・き電線、ATS-P地上子・ケーブルトラフ・中継信号機を構築するクラス
 */
export class TrackSystem {
  constructor(scene, route, textures) {
    this.scene = scene;
    this.route = route;
    this.textures = textures;
    this.group = new THREE.Group();
    this.scene.add(this.group);

    this.signals = [];
    this.repeaterSignals = [];
    this.ballastMaterial = null;
    this.viaductMaterial = null;

    this._buildViaductAndBallast();
    this._buildRails();
    this._buildSleepers();
    this._buildCatenarySystem();
    this._buildSignalsAndSigns();
    this._buildTracksideInfrastructure();
  }

  setWetness(wetAmount) {
    const w = THREE.MathUtils.clamp(wetAmount, 0, 1);
    if (this.ballastMaterial) {
      this.ballastMaterial.roughness = THREE.MathUtils.lerp(0.93, 0.42, w);
      this.ballastMaterial.metalness = THREE.MathUtils.lerp(0.04, 0.22, w);
      this.ballastMaterial.envMapIntensity = THREE.MathUtils.lerp(0.55, 1.45, w);
      this.ballastMaterial.color.setHex(w > 0.3 ? 0xb5bec8 : 0xffffff);
    }
    if (this.viaductMaterial) {
      this.viaductMaterial.roughness = THREE.MathUtils.lerp(0.88, 0.36, w);
      this.viaductMaterial.envMapIntensity = THREE.MathUtils.lerp(0.50, 1.35, w);
    }
  }

  getNipporiParallelTrackPoint(d, lateralOffset) {
    return this.route.getNipporiParallelPoint(d, lateralOffset);
  }

  _buildCrossoverFrame(d, dStart, dEnd, posFn) {
    const clamped = Math.min(dEnd, Math.max(dStart, d));
    const position = posFn(clamped);
    const eps = 0.45;
    const pA = posFn(Math.max(dStart, clamped - eps));
    const pB = posFn(Math.min(dEnd, clamped + eps));
    const tangent = pB.sub(pA).normalize();
    const right = new THREE.Vector3().crossVectors(tangent, WORLD_UP).normalize();
    return { position, center: position, tangent, right, up: WORLD_UP };
  }

  _getNipporiJobanCrossoverFrame(d) {
    return this._buildCrossoverFrame(d, 95, 168, (xD) => {
      const down = this.route.getFrameAt(xD);
      const horizRight = new THREE.Vector3().crossVectors(down.tangent, WORLD_UP).normalize();
      const t = (xD - 95) / (168 - 95);
      const s = t * t * (3 - 2 * t);
      const upOff = this.route.getUpTrackOffset(xD);
      return down.position.clone().addScaledVector(horizRight, THREE.MathUtils.lerp(0, upOff, s));
    });
  }

  _getKitaSenjuCrossoverFrame(d) {
    return this._buildCrossoverFrame(d, 4845, 4935, (xD) => {
      const down = this.route.getFrameAt(xD);
      const horizRight = new THREE.Vector3().crossVectors(down.tangent, WORLD_UP).normalize();
      const t = (xD - 4845) / (4935 - 4845);
      const s = t * t * (3 - 2 * t);
      const upOff = this.route.getUpTrackOffset(xD);
      return down.position.clone().addScaledVector(horizRight, THREE.MathUtils.lerp(upOff, 4.25, s));
    });
  }

  _getTohokuOkuCrossoverFrame(d) {
    return this._buildCrossoverFrame(d, 118, 192, (xD) => {
      const t = (xD - 118) / (192 - 118);
      const s = t * t * (3 - 2 * t);
      const lat = THREE.MathUtils.lerp(-8.4, -12.8, s);
      return this.route.getNipporiParallelPoint(xD, lat).position;
    });
  }

  _buildViaductAndBallast() {
    const step = 2.5;
    const minD = ROUTE_START_BUFFER;
    const maxD = ROUTE_END_BUFFER;

    const ballastPos = [];
    const ballastNorm = [];
    const ballastUv = [];
    const ballastIdx = [];

    const appendBallastRibbon = (dStart, dEnd, stepLen, frameGetter) => {
      const count = Math.floor((dEnd - dStart) / stepLen) + 1;
      const baseVertexOffset = ballastPos.length / 3;
      const profX = [-1.85, -1.25, 1.25, 1.85];
      const profY = [-0.28, -0.045, -0.045, -0.28];
      const profU = [0.0, 0.22, 0.78, 1.0];

      for (let i = 0; i < count; i++) {
        const d = Math.min(dEnd, dStart + i * stepLen);
        const { center, right, up } = frameGetter(d);
        const onBridge = d >= LANDMARKS.sumidaBridgeStart && d <= LANDMARKS.sumidaBridgeEnd;
        const bridgeScaleY = onBridge ? 0.35 : 1.0;

        for (let p = 0; p < 4; p++) {
          ballastPos.push(
            center.x + right.x * profX[p] + up.x * (profY[p] * bridgeScaleY),
            center.y + right.y * profX[p] + up.y * (profY[p] * bridgeScaleY),
            center.z + right.z * profX[p] + up.z * (profY[p] * bridgeScaleY)
          );
          const nx = p === 0 ? -0.45 : p === 3 ? 0.45 : 0;
          const ny = 0.9;
          ballastNorm.push(
            right.x * nx + up.x * ny,
            right.y * nx + up.y * ny,
            right.z * nx + up.z * ny
          );
          ballastUv.push(profU[p], d * 0.28);
        }

        if (i < count - 1) {
          const r0 = baseVertexOffset + i * 4;
          const r1 = r0 + 4;
          for (let s = 0; s < 3; s++) {
            ballastIdx.push(r0 + s, r0 + s + 1, r1 + s);
            ballastIdx.push(r0 + s + 1, r1 + s + 1, r1 + s);
          }
        }
      }
    };

    // 分岐器区間全面の連続バラストエプロン（本線↔渡り線↔隣接線の間を隙間なくバラスト敷設）
    const appendTurnoutBallastApron = (dStart, dEnd, stepLen, spanCallback) => {
      const count = Math.floor((dEnd - dStart) / stepLen) + 1;
      const baseV = ballastPos.length / 3;
      for (let i = 0; i < count; i++) {
        const d = Math.min(dEnd, dStart + i * stepLen);
        const { origin, right, leftX, rightX } = spanCallback(d);
        const width = Math.max(1.0, rightX - leftX);
        const xs = [leftX - 0.55, leftX, rightX, rightX + 0.55];
        const ys = [-0.28, -0.055, -0.055, -0.28];
        const us = [0, 0.22, 0.22 + width * 0.25, 0.44 + width * 0.25];
        for (let p = 0; p < 4; p++) {
          ballastPos.push(
            origin.x + right.x * xs[p],
            origin.y + ys[p],
            origin.z + right.z * xs[p]
          );
          ballastNorm.push(p === 0 ? -right.x * 0.35 : p === 3 ? right.x * 0.35 : 0, 0.94, 0);
          ballastUv.push(us[p], d * 0.28);
        }
        if (i < count - 1) {
          const r0 = baseV + i * 4;
          const r1 = r0 + 4;
          for (let s = 0; s < 3; s++) {
            ballastIdx.push(r0 + s, r0 + s + 1, r1 + s);
            ballastIdx.push(r0 + s + 1, r1 + s + 1, r1 + s);
          }
        }
      }
    };

    // 1. 常磐快速 下り本線
    appendBallastRibbon(minD, maxD, step, (d) => {
      const f = this.route.getFrameAt(d);
      return { center: f.position, right: f.right, up: f.up };
    });

    // 2. 常磐快速 上り本線
    appendBallastRibbon(minD, maxD, step, (d) => {
      const f = this.route.getUpTrackFrameAt(d);
      return { center: f.position, right: f.horizRight, up: WORLD_UP };
    });

    // 3. 北千住 2番線（中線・待避線）バラスト (4810m .. 5360m)
    appendBallastRibbon(
      LANDMARKS.kitasenjuTurnoutStart,
      LANDMARKS.kitasenjuTurnoutEnd,
      2.5,
      (d) => {
        const down = this.route.getFrameAt(d);
        const horizRight = new THREE.Vector3().crossVectors(down.tangent, WORLD_UP).normalize();
        const midOff = this.route.getKitaSenjuMiddleTrackOffset(d) ?? 0;
        return {
          center: down.position.clone().addScaledVector(horizRight, midOff),
          right: horizRight,
          up: WORLD_UP,
        };
      }
    );

    // 3B. 日暮里駅発車直後 常磐線片渡り分岐バラスト＆全面道床 (d = 90m .. 174m)
    appendBallastRibbon(95, 168, 1.8, (d) => this._getNipporiJobanCrossoverFrame(d));
    appendTurnoutBallastApron(88, 176, 2.0, (d) => {
      const down = this.route.getFrameAt(d);
      const horizRight = new THREE.Vector3().crossVectors(down.tangent, WORLD_UP).normalize();
      const upOff = this.route.getUpTrackOffset(d);
      return { origin: down.position, right: horizRight, leftX: -1.35, rightX: upOff + 1.35 };
    });

    // 3C. 北千住構内 上り3番線↔中線2番線 渡り線バラスト＆全面道床 (d = 4838m .. 4942m)
    appendBallastRibbon(4845, 4935, 1.8, (d) => this._getKitaSenjuCrossoverFrame(d));
    appendTurnoutBallastApron(4838, 4942, 2.0, (d) => {
      const down = this.route.getFrameAt(d);
      const horizRight = new THREE.Vector3().crossVectors(down.tangent, WORLD_UP).normalize();
      const upOff = this.route.getUpTrackOffset(d);
      return { origin: down.position, right: horizRight, leftX: 2.9, rightX: upOff + 1.35 };
    });

    // 3D. 東北本線↔尾久回送線 渡り線バラスト＆全面道床 (d = 112m .. 198m)
    appendBallastRibbon(118, 192, 2.0, (d) => this._getTohokuOkuCrossoverFrame(d));
    appendTurnoutBallastApron(112, 198, 2.5, (d) => {
      const pt = this.route.getNipporiParallelPoint(d, 0);
      return { origin: pt.position, right: pt.right, leftX: -14.1, rightX: -7.1 };
    });

    // 4. 日暮里メガコリドー 在来線8線すべて（東北本線・高崎線・尾久回送線 4線 ＋ 京浜東北・山手方向別複々線 4線）
    for (const latOff of NIPPORI_SURFACE_TRACKS) {
      appendBallastRibbon(-235, 430, 3.5, (d) => {
        const pt = this.route.getNipporiParallelPoint(d, latOff);
        return { center: pt.position, right: pt.right, up: WORLD_UP };
      });
    }

    const ballastGeo = new THREE.BufferGeometry();
    ballastGeo.setAttribute('position', new THREE.Float32BufferAttribute(ballastPos, 3));
    ballastGeo.setAttribute('normal', new THREE.Float32BufferAttribute(ballastNorm, 3));
    ballastGeo.setAttribute('uv', new THREE.Float32BufferAttribute(ballastUv, 2));
    ballastGeo.setIndex(ballastIdx);

    const ballastMat = new THREE.MeshStandardMaterial({
      map: this.textures.ballast.map,
      normalMap: this.textures.ballast.normalMap,
      normalScale: new THREE.Vector2(1.25, 1.25),
      roughnessMap: this.textures.ballast.roughnessMap,
      roughness: 0.93,
      metalness: 0.04,
      envMapIntensity: 0.55,
    });
    this.ballastMaterial = ballastMat;
    const ballastMesh = new THREE.Mesh(ballastGeo, ballastMat);
    ballastMesh.receiveShadow = true;
    this.group.add(ballastMesh);

    // 5. 高架コンクリート床版・掘割路盤
    // ※日暮里の東北新幹線U字擁壁アプローチ(x = -19.6m .. -29.0m)を塞がないよう東側路盤と西側路盤を正確に分離！
    const viaPos = [];
    const viaUv = [];
    const viaIdx = [];

    const appendSlabRibbon = (dStart, dEnd, stepLen, profileCallback) => {
      const count = Math.floor((dEnd - dStart) / stepLen) + 1;
      const baseV = viaPos.length / 3;

      for (let i = 0; i < count; i++) {
        const d = Math.min(dEnd, dStart + i * stepLen);
        const { origin, right, leftExtend, rightExtend, wallLeftH, wallRightH, slabBottom } =
          profileCallback(d);

        const ptsX = [
          leftExtend - 0.28,
          leftExtend - 0.22,
          leftExtend,
          rightExtend,
          rightExtend + 0.22,
          rightExtend + 0.28,
        ];
        const ptsY = [slabBottom, wallLeftH, -0.28, -0.28, wallRightH, slabBottom];
        const ptsU = [0.0, 0.15, 0.28, 0.72, 0.85, 1.0];

        for (let p = 0; p < 6; p++) {
          viaPos.push(
            origin.x + right.x * ptsX[p],
            origin.y + ptsY[p],
            origin.z + right.z * ptsX[p]
          );
          viaUv.push(ptsU[p] * 3.0, d * 0.12);
        }

        if (i < count - 1) {
          const r0 = baseV + i * 6;
          const r1 = r0 + 6;
          for (let s = 0; s < 5; s++) {
            viaIdx.push(r0 + s, r0 + s + 1, r1 + s);
            viaIdx.push(r0 + s + 1, r1 + s + 1, r1 + s);
          }
          viaIdx.push(r0 + 5, r0, r1 + 5);
          viaIdx.push(r0, r1, r1 + 5);
        }
      }
    };

    // 5A. 常磐線本線（日暮里 d<115m では東北本線4線 [-19.4m] まで一体路盤）
    appendSlabRibbon(minD, maxD, 4.0, (d) => {
      const down = this.route.getFrameAt(d);
      const upOffset = this.route.getUpTrackOffset(d);
      const horizRight = new THREE.Vector3().crossVectors(down.tangent, WORLD_UP).normalize();
      const onBridge = d >= LANDMARKS.sumidaBridgeStart && d <= LANDMARKS.sumidaBridgeEnd;
      const inNippori = d < 115;

      let leftExtend = inNippori ? -19.4 : -3.35;
      let rightExtend = upOffset + (inNippori ? 4.2 : 3.35);

      for (const st of STATIONS) {
        if (d >= st.platformStart - 12 && d <= st.platformEnd + 12) {
          if (st.platformSide === 'left') leftExtend = Math.min(leftExtend, -8.8);
          if (st.hasCenterSiding) rightExtend = Math.max(rightExtend, upOffset + 3.6);
        }
      }

      return {
        origin: down.position,
        right: horizRight,
        leftExtend,
        rightExtend,
        wallLeftH: onBridge ? 0.12 : inNippori ? 0.10 : 0.92,
        wallRightH: onBridge ? 0.12 : 0.92,
        slabBottom: onBridge ? -0.95 : -1.65,
      };
    });

    // 5B. 常磐線が右カーブで離れた後も直進する「東北本線4線路盤」 (d = 105m .. 435m)
    appendSlabRibbon(105, 435, 5.0, (d) => {
      const pt = this.route.getNipporiParallelPoint(d, 0);
      return {
        origin: pt.position,
        right: pt.right,
        leftExtend: -19.4,
        rightExtend: -2.2,
        wallLeftH: 0.25,
        wallRightH: 0.55,
        slabBottom: -1.65,
      };
    });

    // 5C. 新幹線U字アプローチの西側を並走する「京浜東北・山手線 方向別複々線（9〜12番線）路盤」 (d = -235m .. 435m)
    appendSlabRibbon(-235, 435, 5.0, (d) => {
      const pt = this.route.getNipporiParallelPoint(d, 0);
      return {
        origin: pt.position,
        right: pt.right,
        leftExtend: -57.2,
        rightExtend: -29.3,
        wallLeftH: 0.65,
        wallRightH: 0.20,
        slabBottom: -1.65,
      };
    });

    // 5D. 東北新幹線 スラブ軌道コンクリート道床（地下抗口 d=15m -> 急勾配U字アプローチ -> 高架橋 d=460m）
    appendSlabRibbon(15, 460, 4.0, (d) => {
      const shRef = this.route.getNipporiShinkansenPoint(d, -24.3);
      return {
        origin: shRef.position,
        right: shRef.right,
        leftExtend: -4.1,
        rightExtend: 4.1,
        wallLeftH: 0.02,
        wallRightH: 0.02,
        slabBottom: -0.75,
      };
    });

    const viaGeo = new THREE.BufferGeometry();
    viaGeo.setAttribute('position', new THREE.Float32BufferAttribute(viaPos, 3));
    viaGeo.setAttribute('uv', new THREE.Float32BufferAttribute(viaUv, 2));
    viaGeo.setIndex(viaIdx);
    viaGeo.computeVertexNormals();

    const viaMat = new THREE.MeshStandardMaterial({
      map: this.textures.concrete.map,
      normalMap: this.textures.concrete.normalMap,
      normalScale: new THREE.Vector2(0.8, 0.8),
      roughness: 0.88,
      metalness: 0.05,
      envMapIntensity: 0.5,
    });
    this.viaductMaterial = viaMat;
    const viaMesh = new THREE.Mesh(viaGeo, viaMat);
    viaMesh.receiveShadow = true;
    this.group.add(viaMesh);
  }

  /**
   * 2層PBR立体レール（本線複線＋北千住2番線中線＋渡り線＋日暮里在来線8線＋東北新幹線1435mm標準軌2線！）
   */
  _buildRails() {
    const minD = ROUTE_START_BUFFER;
    const maxD = ROUTE_END_BUFFER;
    const halfGauge = TRACK_GAUGE * 0.5;
    const shinkansenHalfGauge = SHINKANSEN_GAUGE * 0.5;

    const crownPos = [];
    const crownNorm = [];
    const crownIdx = [];

    const webPos = [];
    const webNorm = [];
    const webIdx = [];

    const cX = [-0.034, -0.02, 0.02, 0.034];
    const cY = [-0.012, 0.0, 0.0, -0.012];
    const cNx = [-0.52, -0.14, 0.14, 0.52];
    const cNy = [0.85, 0.99, 0.99, 0.85];

    const wX = [-0.062, -0.016, 0.016, 0.062];
    const wY = [-0.152, -0.014, -0.014, -0.152];
    const wNx = [-0.85, -0.95, 0.95, 0.85];
    const wNy = [0.52, 0.25, 0.25, 0.52];

    const addRailPairFromCallback = (
      dStart,
      dEnd,
      step,
      frameCallback,
      customHalfGauge = halfGauge
    ) => {
      const count = Math.floor((dEnd - dStart) / step) + 1;
      for (const railSign of [-1, 1]) {
        const lateralOffset = railSign * customHalfGauge;
        const crownBase = crownPos.length / 3;
        const webBase = webPos.length / 3;

        for (let i = 0; i < count; i++) {
          const d = Math.min(dEnd, dStart + i * step);
          const { position, right, up } = frameCallback(d);

          const basePx = position.x + right.x * lateralOffset;
          const basePy = position.y + right.y * lateralOffset;
          const basePz = position.z + right.z * lateralOffset;

          for (let p = 0; p < 4; p++) {
            crownPos.push(
              basePx + right.x * cX[p] + up.x * cY[p],
              basePy + right.y * cX[p] + up.y * cY[p],
              basePz + right.z * cX[p] + up.z * cY[p]
            );
            crownNorm.push(
              right.x * cNx[p] + up.x * cNy[p],
              right.y * cNx[p] + up.y * cNy[p],
              right.z * cNx[p] + up.z * cNy[p]
            );

            webPos.push(
              basePx + right.x * wX[p] + up.x * wY[p],
              basePy + right.y * wX[p] + up.y * wY[p],
              basePz + right.z * wX[p] + up.z * wY[p]
            );
            webNorm.push(
              right.x * wNx[p] + up.x * wNy[p],
              right.y * wNx[p] + up.y * wNy[p],
              right.z * wNx[p] + up.z * wNy[p]
            );
          }

          if (i < count - 1) {
            const r0 = crownBase + i * 4;
            const r1 = r0 + 4;
            for (let s = 0; s < 3; s++) {
              crownIdx.push(r0 + s, r0 + s + 1, r1 + s);
              crownIdx.push(r0 + s + 1, r1 + s + 1, r1 + s);
            }
            const w0 = webBase + i * 4;
            const w1 = w0 + 4;
            for (let s = 0; s < 3; s++) {
              webIdx.push(w0 + s, w0 + s + 1, w1 + s);
              webIdx.push(w0 + s + 1, w1 + s + 1, w1 + s);
            }
          }
        }
      }
    };

    // 1. 常磐快速 下り本線 (4番線 -> 1番線)
    addRailPairFromCallback(minD, maxD, 2.0, (d) => {
      const f = this.route.getFrameAt(d);
      return { position: f.position, right: f.right, up: f.up };
    });

    // 2. 常磐快速 上り本線 (3番線 -> 2番線 -> 3番線)
    addRailPairFromCallback(minD, maxD, 2.0, (d) => {
      const f = this.route.getUpTrackFrameAt(d);
      return { position: f.position, right: f.horizRight, up: WORLD_UP };
    });

    // 3. 北千住駅 2番線（中線・待避線 4810m .. 5360m）
    addRailPairFromCallback(
      LANDMARKS.kitasenjuTurnoutStart,
      LANDMARKS.kitasenjuTurnoutEnd,
      1.8,
      (d) => {
        const down = this.route.getFrameAt(d);
        const horizRight = new THREE.Vector3().crossVectors(down.tangent, WORLD_UP).normalize();
        const midOff = this.route.getKitaSenjuMiddleTrackOffset(d) ?? 0;
        return {
          position: down.position.clone().addScaledVector(horizRight, midOff),
          right: horizRight,
          up: WORLD_UP,
        };
      }
    );

    // 4. 北千住構内 上り3番線 ↔ 中線2番線 渡り線分岐レール (4845m .. 4935m)
    addRailPairFromCallback(4845, 4935, 1.8, (d) => this._getKitaSenjuCrossoverFrame(d));

    // 5. 日暮里駅構内 常磐線渡り線レール (d = 95m .. 168m)
    addRailPairFromCallback(95, 168, 1.8, (d) => this._getNipporiJobanCrossoverFrame(d));

    // 6. 日暮里駅 西側並走8線すべて（東北本線・高崎線・尾久回送線 4線 ＋ 京浜東北・山手方向別複々線 4線）
    for (const latOff of NIPPORI_SURFACE_TRACKS) {
      addRailPairFromCallback(-235, 430, 3.0, (d) => {
        const pt = this.route.getNipporiParallelPoint(d, latOff);
        return { position: pt.position, right: pt.right, up: WORLD_UP };
      });
    }

    // 7. 東北本線↔尾久回送線 渡り線分岐器レール (d = 118m .. 192m)
    addRailPairFromCallback(118, 192, 2.0, (d) => this._getTohokuOkuCrossoverFrame(d));

    // 8. 東北・上越・北陸新幹線（1,435mm 標準軌 2線：第1上野トンネル抗口 d=16m -> 急勾配アプローチ -> 高架橋 d=460m）
    for (const shLat of NIPPORI_SHINKANSEN_TRACKS) {
      addRailPairFromCallback(
        16,
        460,
        2.5,
        (d) => {
          const pt = this.route.getNipporiShinkansenPoint(d, shLat);
          return { position: pt.position, right: pt.right, up: pt.up };
        },
        shinkansenHalfGauge
      );
    }

    const crownGeo = new THREE.BufferGeometry();
    crownGeo.setAttribute('position', new THREE.Float32BufferAttribute(crownPos, 3));
    crownGeo.setAttribute('normal', new THREE.Float32BufferAttribute(crownNorm, 3));
    crownGeo.setIndex(crownIdx);

    const crownMat = new THREE.MeshStandardMaterial({
      color: 0xdce2e8,
      metalness: 0.96,
      roughness: 0.14,
      envMapIntensity: 2.35,
    });
    const crownMesh = new THREE.Mesh(crownGeo, crownMat);
    crownMesh.receiveShadow = true;
    this.group.add(crownMesh);

    const webGeo = new THREE.BufferGeometry();
    webGeo.setAttribute('position', new THREE.Float32BufferAttribute(webPos, 3));
    webGeo.setAttribute('normal', new THREE.Float32BufferAttribute(webNorm, 3));
    webGeo.setIndex(webIdx);

    const webMat = new THREE.MeshStandardMaterial({
      color: 0x4b3326,
      metalness: 0.52,
      roughness: 0.82,
      envMapIntensity: 0.7,
    });
    const webMesh = new THREE.Mesh(webGeo, webMat);
    webMesh.receiveShadow = true;
    this.group.add(webMesh);
  }

  /**
   * PC枕木・スラブ軌道締結ブロックの InstancedMesh（本線＋北千住中線＋日暮里在来線8線＋東北新幹線2線）
   */
  _buildSleepers() {
    const spacing = 0.65;
    const minD = ROUTE_START_BUFFER;
    const maxD = ROUTE_END_BUFFER;
    const perMainTrack = Math.floor((maxD - minD) / spacing);
    const midCount = Math.floor(
      (LANDMARKS.kitasenjuTurnoutEnd - LANDMARKS.kitasenjuTurnoutStart) / spacing
    );
    const nipStep = 0.85;
    const nipParallelPerTrack = Math.floor((390 - -225) / nipStep);
    const shinkansenStep = 0.95;
    const shinkansenPerTrack = Math.floor((450 - 20) / shinkansenStep);
    const crossStep = 0.68;
    const crossoverDefs = [
      { dStart: 95, dEnd: 168, fn: (d) => this._getNipporiJobanCrossoverFrame(d), withClips: true },
      { dStart: 4845, dEnd: 4935, fn: (d) => this._getKitaSenjuCrossoverFrame(d), withClips: true },
      { dStart: 118, dEnd: 192, fn: (d) => this._getTohokuOkuCrossoverFrame(d), withClips: false },
    ];
    let crossSleeperTotal = 0;
    let crossClipTotal = 0;
    for (const cDef of crossoverDefs) {
      const n = Math.floor((cDef.dEnd - cDef.dStart) / crossStep) + 1;
      crossSleeperTotal += n;
      if (cDef.withClips) crossClipTotal += n * 2;
    }

    const totalInstances =
      perMainTrack * 2 +
      midCount +
      crossSleeperTotal +
      nipParallelPerTrack * NIPPORI_SURFACE_TRACKS.length +
      shinkansenPerTrack * NIPPORI_SHINKANSEN_TRACKS.length;

    const sleeperGeo = new THREE.BoxGeometry(2.05, 0.10, 0.22);
    const sleeperMat = new THREE.MeshStandardMaterial({
      color: 0x7c7974,
      map: this.textures.concrete.map,
      roughness: 0.86,
      metalness: 0.08,
    });
    const sleeperInst = new THREE.InstancedMesh(sleeperGeo, sleeperMat, totalInstances);
    sleeperInst.receiveShadow = true;

    const clipGeo = new THREE.BoxGeometry(0.19, 0.035, 0.25);
    const clipMat = new THREE.MeshStandardMaterial({
      color: 0x2c2420,
      roughness: 0.65,
      metalness: 0.65,
    });
    const clipInst = new THREE.InstancedMesh(
      clipGeo,
      clipMat,
      (perMainTrack * 2 + midCount) * 2 + crossClipTotal
    );

    const dummy = new THREE.Object3D();
    const basis = new THREE.Matrix4();
    let sIdx = 0;
    let cIdx = 0;
    const halfGauge = TRACK_GAUGE * 0.5;

    // 下り本線 & 上り本線
    for (let track = 0; track < 2; track++) {
      const isUp = track === 1;
      for (let i = 0; i < perMainTrack; i++) {
        const d = minD + i * spacing;
        const frame = isUp ? this.route.getUpTrackFrameAt(d) : this.route.getFrameAt(d);
        const right = isUp ? frame.horizRight : frame.right;
        const up = isUp ? WORLD_UP : frame.up;
        const fwd = isUp ? frame.forwardAlongRoute : frame.tangent;

        basis.makeBasis(right, up, fwd.clone().negate());
        dummy.quaternion.setFromRotationMatrix(basis);
        dummy.scale.set(1, 1, 1);
        dummy.position.copy(frame.position).addScaledVector(up, -0.185);
        dummy.updateMatrix();
        sleeperInst.setMatrixAt(sIdx++, dummy.matrix);

        for (const sign of [-1, 1]) {
          dummy.position
            .copy(frame.position)
            .addScaledVector(right, sign * halfGauge)
            .addScaledVector(up, -0.135);
          dummy.updateMatrix();
          clipInst.setMatrixAt(cIdx++, dummy.matrix);
        }
      }
    }

    // 北千住 2番線（中線）枕木
    for (let i = 0; i < midCount; i++) {
      const d = LANDMARKS.kitasenjuTurnoutStart + i * spacing;
      const down = this.route.getFrameAt(d);
      const horizRight = new THREE.Vector3().crossVectors(down.tangent, WORLD_UP).normalize();
      const midOff = this.route.getKitaSenjuMiddleTrackOffset(d) ?? 0;
      const center = down.position.clone().addScaledVector(horizRight, midOff);

      basis.makeBasis(horizRight, WORLD_UP, down.tangent.clone().negate());
      dummy.quaternion.setFromRotationMatrix(basis);
      dummy.scale.set(1, 1, 1);
      dummy.position.copy(center).addScaledVector(WORLD_UP, -0.185);
      dummy.updateMatrix();
      sleeperInst.setMatrixAt(sIdx++, dummy.matrix);

      for (const sign of [-1, 1]) {
        dummy.position
          .copy(center)
          .addScaledVector(horizRight, sign * halfGauge)
          .addScaledVector(WORLD_UP, -0.135);
        dummy.updateMatrix();
        clipInst.setMatrixAt(cIdx++, dummy.matrix);
      }
    }

    // 日暮里並走8線（東北本線4線 ＋ 京浜東北・山手線4線）すべてのPC枕木
    for (const latOff of NIPPORI_SURFACE_TRACKS) {
      for (let i = 0; i < nipParallelPerTrack; i++) {
        const d = -225 + i * nipStep;
        const pt = this.route.getNipporiParallelPoint(d, latOff);
        basis.makeBasis(pt.right, WORLD_UP, pt.tangent.clone().negate());
        dummy.quaternion.setFromRotationMatrix(basis);
        dummy.scale.set(1, 1, 1);
        dummy.position.copy(pt.position).addScaledVector(WORLD_UP, -0.185);
        dummy.updateMatrix();
        sleeperInst.setMatrixAt(sIdx++, dummy.matrix);
      }
    }

    // 東北新幹線 スラブ軌道プレート (1,435mm 標準軌幅に合わせて横1.16倍スケール)
    for (const shLat of NIPPORI_SHINKANSEN_TRACKS) {
      for (let i = 0; i < shinkansenPerTrack; i++) {
        const d = 20 + i * shinkansenStep;
        const pt = this.route.getNipporiShinkansenPoint(d, shLat);
        basis.makeBasis(pt.right, pt.up, pt.tangent.clone().negate());
        dummy.quaternion.setFromRotationMatrix(basis);
        dummy.scale.set(1.16, 0.75, 2.2);
        dummy.position.copy(pt.position).addScaledVector(pt.up, -0.16);
        dummy.updateMatrix();
        sleeperInst.setMatrixAt(sIdx++, dummy.matrix);
      }
    }

    // 日暮里片渡り分岐・北千住渡り線・東北↔尾久渡り線のPC分岐枕木＆締結装置
    for (const cDef of crossoverDefs) {
      const n = Math.floor((cDef.dEnd - cDef.dStart) / crossStep) + 1;
      for (let i = 0; i < n; i++) {
        const d = Math.min(cDef.dEnd, cDef.dStart + i * crossStep);
        const cf = cDef.fn(d);
        basis.makeBasis(cf.right, WORLD_UP, cf.tangent.clone().negate());
        dummy.quaternion.setFromRotationMatrix(basis);
        dummy.scale.set(1.06, 1, 1);
        dummy.position.copy(cf.position).addScaledVector(WORLD_UP, -0.185);
        dummy.updateMatrix();
        sleeperInst.setMatrixAt(sIdx++, dummy.matrix);

        if (cDef.withClips) {
          dummy.scale.set(1, 1, 1);
          for (const sign of [-1, 1]) {
            dummy.position
              .copy(cf.position)
              .addScaledVector(cf.right, sign * halfGauge)
              .addScaledVector(WORLD_UP, -0.135);
            dummy.updateMatrix();
            clipInst.setMatrixAt(cIdx++, dummy.matrix);
          }
        }
      }
    }

    sleeperInst.count = sIdx;
    clipInst.count = cIdx;
    sleeperInst.instanceMatrix.needsUpdate = true;
    clipInst.instanceMatrix.needsUpdate = true;
    this.group.add(sleeperInst);
    this.group.add(clipInst);
  }

  /**
   * 3Dラチストラスビーム＋H形鋼架線柱＋可動曲引きブラケットがいし＋高圧き電線＋カテナリー架線
   */
  _buildCatenarySystem() {
    const mastSpacing = 44.0;
    const minD = -200;
    const maxD = 5460;
    const mastDistances = [];
    for (let d = minD; d <= maxD; d += mastSpacing) {
      mastDistances.push(d);
    }

    const validMasts = mastDistances.filter(
      (d) => d < LANDMARKS.sumidaBridgeStart - 4 || d > LANDMARKS.sumidaBridgeEnd + 4
    );

    const nipCorridorMasts = [];
    for (let d = -200; d <= 396; d += 44) nipCorridorMasts.push(d);

    const shinkansenMasts = [];
    for (let d = 40; d <= 440; d += 40) shinkansenMasts.push(d);

    const steelMat = new THREE.MeshStandardMaterial({
      color: 0x6f777e,
      metalness: 0.74,
      roughness: 0.42,
      envMapIntensity: 1.15,
    });
    const insulatorMat = new THREE.MeshStandardMaterial({
      color: 0xe6ebef,
      metalness: 0.22,
      roughness: 0.24,
      envMapIntensity: 1.1,
    });

    const poleGeo = createHBeamMastGeo();
    const beamGeo = createLatticeTrussBeamGeo();
    const regBracketGeo = createRegistrationBracketGeo();
    const feederInsGeo = new THREE.CylinderGeometry(0.075, 0.085, 0.36, 8);

    const maxPoles = validMasts.length * 2 + nipCorridorMasts.length * 4 + shinkansenMasts.length * 2 + 16;
    const maxBeams = validMasts.length + nipCorridorMasts.length * 2 + shinkansenMasts.length + 16;
    const maxBrackets =
      validMasts.length * 3 + nipCorridorMasts.length * 8 + shinkansenMasts.length * 2 + 32;
    const maxFeederIns = validMasts.length * 2 + 16;

    const poleInst = new THREE.InstancedMesh(poleGeo, steelMat, maxPoles);
    const beamInst = new THREE.InstancedMesh(beamGeo, steelMat, maxBeams);
    const regInst = new THREE.InstancedMesh(regBracketGeo, insulatorMat, maxBrackets);
    const feederInsInst = new THREE.InstancedMesh(feederInsGeo, insulatorMat, maxFeederIns);

    poleInst.castShadow = true;
    poleInst.receiveShadow = true;
    beamInst.castShadow = true;

    const dummy = new THREE.Object3D();
    const basis = new THREE.Matrix4();
    let pIdx = 0;
    let bIdx = 0;
    let rIdx = 0;
    let fIdx = 0;

    // 1. 常磐線本線（＋北千住中線）のH形鋼架線柱＆ワーレントラスビーム＆曲引きブラケット
    for (let m = 0; m < validMasts.length; m++) {
      const d = validMasts[m];
      const down = this.route.getFrameAt(d);
      const upOffset = this.route.getUpTrackOffset(d);
      const horizRight = new THREE.Vector3().crossVectors(down.tangent, WORLD_UP).normalize();

      let leftX = -3.15;
      let rightX = upOffset + 3.15;
      for (const st of STATIONS) {
        if (d >= st.platformStart - 6 && d <= st.platformEnd + 6) {
          if (st.platformSide === 'left') leftX = -7.6;
        }
      }

      basis.makeBasis(horizRight, WORLD_UP, down.tangent.clone().negate());
      const rotQ = new THREE.Quaternion().setFromRotationMatrix(basis);

      for (const px of [leftX, rightX]) {
        dummy.quaternion.copy(rotQ);
        dummy.scale.set(1, 1, 1);
        dummy.position
          .copy(down.position)
          .addScaledVector(horizRight, px)
          .addScaledVector(WORLD_UP, 3.25);
        dummy.updateMatrix();
        poleInst.setMatrixAt(pIdx++, dummy.matrix);

        // 柱頭き電線がいし (y = 7.05m)
        dummy.position
          .copy(down.position)
          .addScaledVector(horizRight, px + (px < 0 ? -0.22 : 0.22))
          .addScaledVector(WORLD_UP, 7.22);
        dummy.updateMatrix();
        feederInsInst.setMatrixAt(fIdx++, dummy.matrix);
      }

      const span = rightX - leftX + 0.45;
      const midX = (leftX + rightX) * 0.5;
      dummy.quaternion.copy(rotQ);
      dummy.scale.set(span, 1, 1);
      dummy.position
        .copy(down.position)
        .addScaledVector(horizRight, midX)
        .addScaledVector(WORLD_UP, 6.46);
      dummy.updateMatrix();
      beamInst.setMatrixAt(bIdx++, dummy.matrix);

      // 各線路直上の曲引き可動ブラケット（ジグザグ偏位に合わせて左右交互向き！）
      const trackCenters = [0, upOffset];
      const midSiding = this.route.getKitaSenjuMiddleTrackOffset(d);
      if (midSiding !== null) trackCenters.push(midSiding);

      const flipSign = m % 2 === 0 ? 1 : -1;
      for (const tx of trackCenters) {
        dummy.quaternion.copy(rotQ);
        dummy.scale.set(flipSign, 1, 1);
        dummy.position
          .copy(down.position)
          .addScaledVector(horizRight, tx)
          .addScaledVector(WORLD_UP, 6.12);
        dummy.updateMatrix();
        regInst.setMatrixAt(rIdx++, dummy.matrix);
      }
    }

    // 2. 日暮里メガコリドー 在来線8線（東北本線4線ガントリー ＋ 京浜東北・山手4線ガントリー）
    for (let m = 0; m < nipCorridorMasts.length; m++) {
      const d = nipCorridorMasts[m];
      const ref = this.route.getNipporiParallelPoint(d, 0);
      basis.makeBasis(ref.right, WORLD_UP, ref.tangent.clone().negate());
      const rotQ = new THREE.Quaternion().setFromRotationMatrix(basis);

      for (const px of d < 105 ? [-18.8] : [-2.8, -18.8]) {
        dummy.quaternion.copy(rotQ);
        dummy.scale.set(1, 1, 1);
        dummy.position
          .copy(ref.position)
          .addScaledVector(ref.right, px)
          .addScaledVector(WORLD_UP, 3.25);
        dummy.updateMatrix();
        poleInst.setMatrixAt(pIdx++, dummy.matrix);
      }
      dummy.quaternion.copy(rotQ);
      dummy.scale.set(16.6, 1.12, 1);
      dummy.position
        .copy(ref.position)
        .addScaledVector(ref.right, -10.8)
        .addScaledVector(WORLD_UP, 6.46);
      dummy.updateMatrix();
      beamInst.setMatrixAt(bIdx++, dummy.matrix);

      for (const px of [-30.0, -56.2]) {
        dummy.quaternion.copy(rotQ);
        dummy.scale.set(1, 1, 1);
        dummy.position
          .copy(ref.position)
          .addScaledVector(ref.right, px)
          .addScaledVector(WORLD_UP, 3.25);
        dummy.updateMatrix();
        poleInst.setMatrixAt(pIdx++, dummy.matrix);
      }
      dummy.quaternion.copy(rotQ);
      dummy.scale.set(26.8, 1.18, 1);
      dummy.position
        .copy(ref.position)
        .addScaledVector(ref.right, -43.1)
        .addScaledVector(WORLD_UP, 6.46);
      dummy.updateMatrix();
      beamInst.setMatrixAt(bIdx++, dummy.matrix);

      const flipSign = m % 2 === 0 ? 1 : -1;
      for (const ix of NIPPORI_SURFACE_TRACKS) {
        dummy.quaternion.copy(rotQ);
        dummy.scale.set(flipSign, 1, 1);
        dummy.position
          .copy(ref.position)
          .addScaledVector(ref.right, ix)
          .addScaledVector(WORLD_UP, 6.12);
        dummy.updateMatrix();
        regInst.setMatrixAt(rIdx++, dummy.matrix);
      }
    }

    // 3. 東北新幹線 専用高架門型架線柱
    for (let m = 0; m < shinkansenMasts.length; m++) {
      const d = shinkansenMasts[m];
      if (Math.abs(d - LANDMARKS.keiseiNipporiOverpass) < 18) continue;

      const shRef = this.route.getNipporiShinkansenPoint(d, -24.3);
      basis.makeBasis(shRef.right, WORLD_UP, shRef.tangent.clone().negate());
      const rotQ = new THREE.Quaternion().setFromRotationMatrix(basis);

      for (const px of [-4.2, 4.2]) {
        dummy.quaternion.copy(rotQ);
        dummy.scale.set(0.95, 0.92, 0.95);
        dummy.position
          .copy(shRef.position)
          .addScaledVector(shRef.right, px)
          .addScaledVector(WORLD_UP, 3.0);
        dummy.updateMatrix();
        poleInst.setMatrixAt(pIdx++, dummy.matrix);
      }

      dummy.quaternion.copy(rotQ);
      dummy.scale.set(9.0, 0.95, 0.95);
      dummy.position.copy(shRef.position).addScaledVector(WORLD_UP, 6.15);
      dummy.updateMatrix();
      beamInst.setMatrixAt(bIdx++, dummy.matrix);

      const flipSign = m % 2 === 0 ? 1 : -1;
      for (const shLat of NIPPORI_SHINKANSEN_TRACKS) {
        dummy.quaternion.copy(rotQ);
        dummy.scale.set(flipSign, 0.92, 1.1);
        dummy.position
          .copy(shRef.position)
          .addScaledVector(shRef.right, shLat - -24.3)
          .addScaledVector(WORLD_UP, 5.88);
        dummy.updateMatrix();
        regInst.setMatrixAt(rIdx++, dummy.matrix);
      }
    }

    poleInst.count = pIdx;
    beamInst.count = bIdx;
    regInst.count = rIdx;
    feederInsInst.count = fIdx;
    poleInst.instanceMatrix.needsUpdate = true;
    beamInst.instanceMatrix.needsUpdate = true;
    regInst.instanceMatrix.needsUpdate = true;
    feederInsInst.instanceMatrix.needsUpdate = true;
    this.group.add(poleInst);
    this.group.add(beamInst);
    this.group.add(regInst);
    this.group.add(feederInsInst);

    // 4. トロリー線＋ちょう架線＋ドロッパ＋柱頭高圧き電線（Feeder Wires）
    const wireVerts = [];
    const subSteps = 8;

    const addCatenaryWireRun = (dList, posGetter, contactH = 5.08, messengerH = 5.95) => {
      for (let m = 0; m < dList.length - 1; m++) {
        const d0 = dList[m];
        const d1 = dList[m + 1];
        const stag0 = (m % 2 === 0 ? 1 : -1) * 0.16;
        const stag1 = (m % 2 === 0 ? -1 : 1) * 0.16;
        let prevContact = null;
        let prevMessenger = null;

        for (let s = 0; s <= subSteps; s++) {
          const t = s / subSteps;
          const d = THREE.MathUtils.lerp(d0, d1, t);
          const stagger = THREE.MathUtils.lerp(stag0, stag1, t);
          const sag = 4.0 * t * (1.0 - t);
          const { basePos, right } = posGetter(d);

          const cPt = basePos
            .clone()
            .addScaledVector(right, stagger)
            .addScaledVector(WORLD_UP, contactH);
          const mPt = basePos
            .clone()
            .addScaledVector(right, stagger)
            .addScaledVector(WORLD_UP, messengerH - sag * 0.62);

          if (prevContact) {
            wireVerts.push(prevContact.x, prevContact.y, prevContact.z, cPt.x, cPt.y, cPt.z);
            wireVerts.push(prevMessenger.x, prevMessenger.y, prevMessenger.z, mPt.x, mPt.y, mPt.z);
          }
          if (s > 0 && s < subSteps) {
            wireVerts.push(cPt.x, cPt.y, cPt.z, mPt.x, mPt.y, mPt.z);
          }
          prevContact = cPt;
          prevMessenger = mPt;
        }
      }
    };

    // 高圧き電線・保護線（両側の架線柱頭頂部 y=7.38m をゆるやかな懸垂曲線で結ぶ電線！）
    for (const sideSign of [-1, 1]) {
      for (let m = 0; m < validMasts.length - 1; m++) {
        const d0 = validMasts[m];
        const d1 = validMasts[m + 1];
        if (d1 - d0 > mastSpacing * 1.6) continue; // 隅田川トラス橋区間はスキップ
        let prevF = null;
        for (let s = 0; s <= 6; s++) {
          const t = s / 6;
          const d = THREE.MathUtils.lerp(d0, d1, t);
          const down = this.route.getFrameAt(d);
          const upOff = this.route.getUpTrackOffset(d);
          const hr = new THREE.Vector3().crossVectors(down.tangent, WORLD_UP).normalize();
          let lat = sideSign < 0 ? -3.37 : upOff + 3.37;
          for (const st of STATIONS) {
            if (d >= st.platformStart - 6 && d <= st.platformEnd + 6 && st.platformSide === 'left' && sideSign < 0) {
              lat = -7.82;
            }
          }
          const sag = 4.0 * t * (1.0 - t) * 0.42;
          const fPt = down.position.clone().addScaledVector(hr, lat).addScaledVector(WORLD_UP, 7.38 - sag);
          if (prevF) {
            wireVerts.push(prevF.x, prevF.y, prevF.z, fPt.x, fPt.y, fPt.z);
          }
          prevF = fPt;
        }
      }
    }

    addCatenaryWireRun(mastDistances, (d) => {
      const f = this.route.getFrameAt(d);
      return { basePos: f.position, right: f.right };
    });
    addCatenaryWireRun(mastDistances, (d) => {
      const f = this.route.getUpTrackFrameAt(d);
      return { basePos: f.position, right: f.horizRight };
    });

    const midMasts = [];
    for (let d = 4810; d <= 5360; d += 44) midMasts.push(d);
    addCatenaryWireRun(midMasts, (d) => {
      const down = this.route.getFrameAt(d);
      const r = new THREE.Vector3().crossVectors(down.tangent, WORLD_UP).normalize();
      const off = this.route.getKitaSenjuMiddleTrackOffset(d) ?? 4.25;
      return { basePos: down.position.clone().addScaledVector(r, off), right: r };
    });

    for (const latOff of NIPPORI_SURFACE_TRACKS) {
      addCatenaryWireRun(nipCorridorMasts, (d) => {
        const pt = this.route.getNipporiParallelPoint(d, latOff);
        return { basePos: pt.position, right: pt.right };
      });
    }

    const shWireMasts = [28, ...shinkansenMasts];
    for (const shLat of NIPPORI_SHINKANSEN_TRACKS) {
      addCatenaryWireRun(
        shWireMasts,
        (d) => {
          const pt = this.route.getNipporiShinkansenPoint(d, shLat);
          return { basePos: pt.position, right: pt.right };
        },
        4.95,
        5.68
      );
    }

    const wireGeo = new THREE.BufferGeometry();
    wireGeo.setAttribute('position', new THREE.Float32BufferAttribute(wireVerts, 3));
    const wireMat = new THREE.LineBasicMaterial({
      color: 0x22262c,
      transparent: true,
      opacity: 0.82,
    });
    this.group.add(new THREE.LineSegments(wireGeo, wireMat));
  }

  /**
   * 3現示閉塞・場内・出発信号機（フード庇・点検台・進路表示器付き）＋ 曲線見通し補助「中継信号機」＋ 制限標識
   */
  _buildSignalsAndSigns() {
    const postMat = new THREE.MeshStandardMaterial({
      color: 0x626970,
      metalness: 0.62,
      roughness: 0.46,
    });
    const hoodMat = new THREE.MeshStandardMaterial({
      color: 0x17191c,
      metalness: 0.28,
      roughness: 0.72,
    });

    const signalLocations = [
      38, 480, 920, 1255, 1820, 2450, 3120, 3465, 3910, 4420, 4815, 5242,
    ];

    const poleGeo = new THREE.CylinderGeometry(0.072, 0.085, 4.45, 8);
    const headGeo = new THREE.BoxGeometry(0.50, 1.32, 0.26);
    const visorGeo = new THREE.CylinderGeometry(0.115, 0.115, 0.22, 10, 1, true, 0, Math.PI);
    visorGeo.rotateZ(Math.PI * 0.5);
    visorGeo.rotateY(Math.PI * 0.5);
    const lampGeo = new THREE.SphereGeometry(0.095, 12, 10);
    const stepPlatGeo = new THREE.BoxGeometry(0.62, 0.06, 0.52);

    for (const d of signalLocations) {
      const frame = this.route.getFrameAt(d);
      const horizRight = new THREE.Vector3().crossVectors(frame.tangent, WORLD_UP).normalize();

      let offsetLeft = -2.48;
      for (const st of STATIONS) {
        if (d >= st.platformStart - 5 && d <= st.platformEnd + 18 && st.platformSide === 'left') {
          offsetLeft = -2.12;
        }
      }

      const sigGroup = new THREE.Group();
      sigGroup.position.copy(frame.position).addScaledVector(horizRight, offsetLeft);
      const basis = new THREE.Matrix4().makeBasis(
        horizRight,
        WORLD_UP,
        frame.tangent.clone().negate()
      );
      sigGroup.quaternion.setFromRotationMatrix(basis);

      const pole = new THREE.Mesh(poleGeo, postMat);
      pole.position.y = 2.15;
      sigGroup.add(pole);

      // 点検用作業ステップ台＆手すり枠
      const stepPlat = new THREE.Mesh(stepPlatGeo, postMat);
      stepPlat.position.set(0, 3.28, -0.18);
      sigGroup.add(stepPlat);

      const head = new THREE.Mesh(headGeo, hoodMat);
      head.position.set(0, 4.15, 0);
      sigGroup.add(head);

      const greenMat = new THREE.MeshBasicMaterial({ color: 0x00ff88 });
      const yellowMat = new THREE.MeshBasicMaterial({ color: 0xffaa00 });
      const redMat = new THREE.MeshBasicMaterial({ color: 0xff2626 });

      for (const [ly, lMat] of [
        [4.52, yellowMat],
        [4.15, redMat],
        [3.78, greenMat],
      ]) {
        const lamp = new THREE.Mesh(lampGeo, lMat);
        lamp.position.set(0, ly, 0.13);
        sigGroup.add(lamp);

        const visor = new THREE.Mesh(visorGeo, hoodMat);
        visor.position.set(0, ly + 0.02, 0.21);
        sigGroup.add(visor);
      }

      // 北千住場内信号機(4815m)：1番線進路表示器「[ 1 ]」＋ 中線2番線用第2場内信号機！
      if (d === 4815) {
        const routeBox = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.42, 0.22), hoodMat);
        routeBox.position.set(0, 3.22, 0.04);
        sigGroup.add(routeBox);
        const ledWhiteMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.8, 2.8, 2.5) });
        const digitBar = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.26, 0.04), ledWhiteMat);
        digitBar.position.set(0, 3.22, 0.16);
        sigGroup.add(digitBar);

        const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.12, 0.12), postMat);
        bracket.position.set(0.45, 3.35, 0);
        sigGroup.add(bracket);
        const subHead = new THREE.Mesh(headGeo, hoodMat);
        subHead.position.set(0.88, 3.95, 0);
        sigGroup.add(subHead);
        const subRed = new THREE.Mesh(
          lampGeo,
          new THREE.MeshBasicMaterial({ color: new THREE.Color(3.5, 0.12, 0.1) })
        );
        subRed.position.set(0.88, 3.95, 0.14);
        sigGroup.add(subRed);
      }

      this.group.add(sigGroup);
      this.signals.push({
        distance: d,
        greenMat,
        yellowMat,
        redMat,
        aspect: 'G',
        isTerminalEnd: d > 5210,
      });
    }

    // ---- 曲線区間の見通しを補う JR東日本「中継信号機（7灯白色ドット円形背板）」 ----
    const repeaterDefs = [
      { d: 315, parentSignalD: 480 },   // 三河島R300大カーブ前半
      { d: 760, parentSignalD: 920 },   // 三河島場内中継
      { d: 3730, parentSignalD: 3910 }, // 隅田川橋梁アプローチ中継
      { d: 4615, parentSignalD: 4815 }, // 千住関屋カーブ→北千住場内中継
    ];
    const discGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.08, 18);
    discGeo.rotateX(Math.PI * 0.5);
    const repDotGeo = new THREE.SphereGeometry(0.042, 8, 8);

    for (const rDef of repeaterDefs) {
      const f = this.route.getFrameAt(rDef.d);
      const hr = new THREE.Vector3().crossVectors(f.tangent, WORLD_UP).normalize();
      const rg = new THREE.Group();
      rg.position.copy(f.position).addScaledVector(hr, -2.46);
      rg.quaternion.setFromRotationMatrix(
        new THREE.Matrix4().makeBasis(hr, WORLD_UP, f.tangent.clone().negate())
      );

      const rPole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 3.5, 8), postMat);
      rPole.position.y = 1.75;
      rg.add(rPole);

      const disc = new THREE.Mesh(discGeo, hoodMat);
      disc.position.set(0, 3.55, 0);
      rg.add(disc);

      // 中央常時点灯ドット ＋ 進行(縦)・制限(斜め45°)・停止(横) の3組マテリアル
      const centerMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 2.55, 2.3) });
      const gMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 2.55, 2.3) });
      const yMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.1, 0.1, 0.1) });
      const rMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.1, 0.1, 0.1) });

      const addDot = (dx, dy, m) => {
        const dot = new THREE.Mesh(repDotGeo, m);
        dot.position.set(dx, 3.55 + dy, 0.055);
        rg.add(dot);
      };
      addDot(0, 0, centerMat);
      addDot(0, 0.22, gMat);
      addDot(0, -0.22, gMat);
      addDot(-0.16, 0.16, yMat);
      addDot(0.16, -0.16, yMat);
      addDot(-0.22, 0, rMat);
      addDot(0.22, 0, rMat);

      this.group.add(rg);
      this.repeaterSignals.push({
        distance: rDef.d,
        parentSignalD: rDef.parentSignalD,
        gMat,
        yMat,
        rMat,
      });
    }

    // 速度制限標識
    const signGeo = new THREE.PlaneGeometry(0.68, 0.54);
    const signPoleGeo = new THREE.CylinderGeometry(0.04, 0.04, 2.2, 6);

    for (const sl of SPEED_LIMITS) {
      if (sl.start < 0) continue;
      const d = sl.start;
      const frame = this.route.getFrameAt(d);
      const horizRight = new THREE.Vector3().crossVectors(frame.tangent, WORLD_UP).normalize();

      const g = new THREE.Group();
      g.position.copy(frame.position).addScaledVector(horizRight, -2.55);
      const basis = new THREE.Matrix4().makeBasis(
        horizRight,
        WORLD_UP,
        frame.tangent.clone().negate()
      );
      g.quaternion.setFromRotationMatrix(basis);

      const p = new THREE.Mesh(signPoleGeo, postMat);
      p.position.y = 1.1;
      g.add(p);

      const tex = createSpeedSignTexture(sl.limit);
      const board = new THREE.Mesh(
        signGeo,
        new THREE.MeshStandardMaterial({ map: tex, roughness: 0.36, metalness: 0.12 })
      );
      board.position.set(0, 2.05, 0.04);
      g.add(board);

      this.group.add(g);
    }
  }

  /**
   * 線路脇インフラ高密度ディテール：
   * 1. コンクリート製連続ケーブルトラフ（U字溝・蓋目地付き）
   * 2. 軌道内 ATS-P 地上子（オレンジ/アイボリー車上子対向トランスポンダ箱）
   * 3. 信号機器箱・中継箱（シルバーグレー筐体＋点検台）
   * 4. 距離標（キロポスト 2.2k〜7.4k ＋ 200m毎百メートル標）＆ 勾配標（‰腕木標）
   * 5. 日暮里・北千住 分岐器（ポイント）周りの護輪軌条・NS形電気転轍機・動作桿・開通方向表示器・床板油汚れ
   */
  _buildTracksideInfrastructure() {
    const dummy = new THREE.Object3D();
    const basis = new THREE.Matrix4();

    // ---- 1. コンクリート製連続ケーブルトラフ（高架バラスト両脇を走る蓋付き配線ダクト！） ----
    {
      const trPos = [];
      const trUv = [];
      const trIdx = [];
      const step = 4.0;

      const isBlockedByPlatform = (d, side) => {
        for (const st of STATIONS) {
          if (d >= st.platformStart - 3 && d <= st.platformEnd + 3) {
            if (side < 0 && st.platformSide === 'left') return true;
            if (side > 0 && st.platformSide === 'right') return true;
          }
        }
        return false;
      };

      for (const side of [-1, 1]) {
        let segStart = null;
        const flushSegment = (s0, s1) => {
          if (s1 - s0 < 8) return;
          const cnt = Math.floor((s1 - s0) / step) + 1;
          const baseV = trPos.length / 3;
          const px = [-0.21, -0.20, 0.20, 0.21];
          const py = [-0.28, -0.10, -0.10, -0.28];
          const pu = [0.0, 0.25, 0.75, 1.0];

          for (let i = 0; i < cnt; i++) {
            const d = Math.min(s1, s0 + i * step);
            const down = this.route.getFrameAt(d);
            const upOff = this.route.getUpTrackOffset(d);
            const hr = new THREE.Vector3().crossVectors(down.tangent, WORLD_UP).normalize();
            const lat = side < 0 ? -2.08 : upOff + 2.08;

            for (let k = 0; k < 4; k++) {
              trPos.push(
                down.position.x + hr.x * (lat + px[k]),
                down.position.y + py[k],
                down.position.z + hr.z * (lat + px[k])
              );
              trUv.push(pu[k], d * 0.9);
            }
            if (i < cnt - 1) {
              const r0 = baseV + i * 4;
              const r1 = r0 + 4;
              for (let s = 0; s < 3; s++) {
                trIdx.push(r0 + s, r0 + s + 1, r1 + s, r0 + s + 1, r1 + s + 1, r1 + s);
              }
            }
          }
        };

        for (let d = -210; d <= 5440; d += step) {
          const onBridge = d >= LANDMARKS.sumidaBridgeStart - 4 && d <= LANDMARKS.sumidaBridgeEnd + 4;
          const inTurnout =
            (d >= 88 && d <= 176) || (side > 0 && d >= 4835 && d <= 4945);
          const blocked = onBridge || inTurnout || isBlockedByPlatform(d, side);

          if (!blocked && segStart === null) {
            segStart = d;
          } else if (blocked && segStart !== null) {
            flushSegment(segStart, d - step);
            segStart = null;
          }
        }
        if (segStart !== null) flushSegment(segStart, 5440);
      }

      const troughGeo = new THREE.BufferGeometry();
      troughGeo.setAttribute('position', new THREE.Float32BufferAttribute(trPos, 3));
      troughGeo.setAttribute('uv', new THREE.Float32BufferAttribute(trUv, 2));
      troughGeo.setIndex(trIdx);
      troughGeo.computeVertexNormals();

      const troughMat = new THREE.MeshStandardMaterial({
        color: 0xaab0b5,
        map: this.textures.concrete.map,
        roughness: 0.82,
        metalness: 0.06,
      });
      const troughMesh = new THREE.Mesh(troughGeo, troughMat);
      troughMesh.receiveShadow = true;
      this.group.add(troughMesh);
    }

    // ---- 2. 軌道内 ATS-P 地上子（オレンジ＆白の車上子対向トランスポンダ箱：下り線＆上り線） ----
    {
      const atsPositions = [];
      const pushPair = (baseD, isUp = false) => {
        atsPositions.push({ d: baseD, isUp, color: 0xeb6a1e });      // 橙色 ATS-P 情報地上子
        atsPositions.push({ d: baseD + 3.9, isUp, color: 0xeaeef2 }); // 白色 ATS-P/Ps 地上子
      };

      // 信号機手前・制限速度手前・各駅停止目標手前に実車通りの配置！
      for (const sig of this.signals) {
        if (sig.distance > -180) {
          pushPair(sig.distance - 165, false);
          pushPair(sig.distance - 24, false);
        }
      }
      for (const sl of SPEED_LIMITS) {
        if (sl.start > 0) pushPair(sl.start - 95, false);
      }
      for (const st of STATIONS) {
        pushPair(st.stopDistance - 260, false);
        pushPair(st.stopDistance - 75, false);
        pushPair(st.stopDistance - 11, false);
      }
      // 上り線の地上子も要所に配置して対向線のリアリティ向上
      for (let ud = 150; ud <= 5100; ud += 380) {
        pushPair(ud, true);
      }

      const transGeo = mergeTrackGeos([
        (() => {
          const base = new THREE.BoxGeometry(0.46, 0.045, 0.66);
          base.translate(0, -0.02, 0);
          return base;
        })(),
        (() => {
          const top = new THREE.BoxGeometry(0.34, 0.055, 0.52);
          top.translate(0, 0.025, 0);
          return top;
        })(),
      ]);
      const transMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.42,
        metalness: 0.14,
      });
      const transInst = new THREE.InstancedMesh(transGeo, transMat, atsPositions.length);
      const colTmp = new THREE.Color();

      atsPositions.forEach((item, idx) => {
        const f = item.isUp
          ? this.route.getUpTrackFrameAt(item.d)
          : this.route.getFrameAt(item.d);
        const right = item.isUp ? f.horizRight : f.right;
        const up = item.isUp ? WORLD_UP : f.up;
        const fwd = item.isUp ? f.forwardAlongRoute : f.tangent;

        basis.makeBasis(right, up, fwd.clone().negate());
        dummy.quaternion.setFromRotationMatrix(basis);
        dummy.scale.set(1, 1, 1);
        dummy.position.copy(f.position).addScaledVector(up, -0.085);
        dummy.updateMatrix();
        transInst.setMatrixAt(idx, dummy.matrix);
        transInst.setColorAt(idx, colTmp.setHex(item.color));
      });
      transInst.instanceMatrix.needsUpdate = true;
      if (transInst.instanceColor) transInst.instanceColor.needsUpdate = true;
      this.group.add(transInst);
    }

    // ---- 3. 信号機器箱・中継箱（高架橋側壁沿いのシルバーグレー器具箱） ----
    {
      const relayLocations = [];
      for (const sig of this.signals) relayLocations.push(sig.distance - 5.5);
      for (let d = -120; d <= 5320; d += 155) {
        if (d > LANDMARKS.sumidaBridgeStart - 12 && d < LANDMARKS.sumidaBridgeEnd + 12) continue;
        relayLocations.push(d);
      }

      const relayGeo = mergeTrackGeos([
        (() => {
          const legL = new THREE.BoxGeometry(0.08, 0.45, 0.42);
          legL.translate(-0.34, 0.225, 0);
          return legL;
        })(),
        (() => {
          const legR = new THREE.BoxGeometry(0.08, 0.45, 0.42);
          legR.translate(0.34, 0.225, 0);
          return legR;
        })(),
        (() => {
          const box = new THREE.BoxGeometry(0.86, 1.18, 0.46);
          box.translate(0, 1.02, 0);
          return box;
        })(),
        (() => {
          const roof = new THREE.BoxGeometry(0.94, 0.06, 0.54);
          roof.translate(0, 1.63, 0);
          return roof;
        })(),
      ]);
      const relayMat = new THREE.MeshStandardMaterial({
        color: 0xc2c9cf,
        roughness: 0.48,
        metalness: 0.42,
      });
      const relayInst = new THREE.InstancedMesh(relayGeo, relayMat, relayLocations.length);
      let rCnt = 0;

      for (const rd of relayLocations) {
        let skip = false;
        for (const st of STATIONS) {
          if (rd >= st.platformStart - 6 && rd <= st.platformEnd + 6 && st.platformSide === 'left') {
            skip = true;
          }
        }
        if (skip) continue;
        const f = this.route.getFrameAt(rd);
        const hr = new THREE.Vector3().crossVectors(f.tangent, WORLD_UP).normalize();
        basis.makeBasis(hr, WORLD_UP, f.tangent.clone().negate());
        dummy.quaternion.setFromRotationMatrix(basis);
        dummy.scale.set(1, 1, 1);
        dummy.position.copy(f.position).addScaledVector(hr, -2.85).addScaledVector(WORLD_UP, -0.22);
        dummy.updateMatrix();
        relayInst.setMatrixAt(rCnt++, dummy.matrix);
      }
      relayInst.count = rCnt;
      relayInst.instanceMatrix.needsUpdate = true;
      this.group.add(relayInst);
    }

    // ---- 4. 距離標（上野起点 2.0k 〜 7.6k キロポスト＆200m毎の百メートル標）＋ 勾配標 ----
    {
      // 日暮里駅停止目標 (d=0m) が実物の上野起点 2.20km (2,200m) に相当！
      const kmTexCache = new Map();
      const getKmMat = (kmInt, subDigit) => {
        const key = `${kmInt}_${subDigit ?? 'full'}`;
        if (kmTexCache.has(key)) return kmTexCache.get(key);
        const tex = createKilometerPostTexture(kmInt, subDigit);
        const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45, metalness: 0.08 });
        kmTexCache.set(key, mat);
        return mat;
      };

      const fullPostGeo = new THREE.BoxGeometry(0.22, 0.92, 0.14);
      const subPostGeo = new THREE.BoxGeometry(0.18, 0.62, 0.10);

      for (let uenoMeters = 2000; uenoMeters <= 7600; uenoMeters += 200) {
        const d = uenoMeters - 2200; // d = -200m .. 5400m
        if (d < ROUTE_START_BUFFER + 10 || d > ROUTE_END_BUFFER - 10) continue;
        if (d > LANDMARKS.sumidaBridgeStart && d < LANDMARKS.sumidaBridgeEnd) continue;

        let onLeftPlat = false;
        for (const st of STATIONS) {
          if (d >= st.platformStart - 3 && d <= st.platformEnd + 3 && st.platformSide === 'left') {
            onLeftPlat = true;
          }
        }
        if (onLeftPlat) continue;

        const kmInt = Math.floor(uenoMeters / 1000);
        const remHundred = Math.round((uenoMeters % 1000) / 100);
        const isFullKm = remHundred === 0;

        const f = this.route.getFrameAt(d);
        const hr = new THREE.Vector3().crossVectors(f.tangent, WORLD_UP).normalize();
        const postMesh = new THREE.Mesh(
          isFullKm ? fullPostGeo : subPostGeo,
          getKmMat(kmInt, isFullKm ? null : remHundred)
        );
        basis.makeBasis(hr, WORLD_UP, f.tangent.clone().negate());
        postMesh.quaternion.setFromRotationMatrix(basis);
        postMesh.position
          .copy(f.position)
          .addScaledVector(hr, -2.38)
          .addScaledVector(WORLD_UP, isFullKm ? 0.28 : 0.14);
        this.group.add(postMesh);
      }

      // 勾配標（実路線縱断勾配の変曲点に設置！）
      const gradePosts = [
        { d: 82, label: '6.5', slope: 'up' },
        { d: 755, label: 'L', slope: 'level' },
        { d: 1505, label: '3.0', slope: 'up' },
        { d: 2210, label: 'L', slope: 'level' },
        { d: 3455, label: '10.0', slope: 'up' },
        { d: 3925, label: 'L', slope: 'level' },
        { d: 4355, label: '11.5', slope: 'down' },
        { d: 4925, label: 'L', slope: 'level' },
      ];
      const gPoleMat = new THREE.MeshStandardMaterial({ color: 0xf0f2f5, roughness: 0.5 });
      const gPoleGeo = new THREE.BoxGeometry(0.09, 1.55, 0.09);
      const gBladeGeo = new THREE.BoxGeometry(0.58, 0.22, 0.04);

      for (const gp of gradePosts) {
        const f = this.route.getFrameAt(gp.d);
        const hr = new THREE.Vector3().crossVectors(f.tangent, WORLD_UP).normalize();
        const holder = new THREE.Group();
        holder.position.copy(f.position).addScaledVector(hr, -2.52);
        basis.makeBasis(hr, WORLD_UP, f.tangent.clone().negate());
        holder.quaternion.setFromRotationMatrix(basis);

        const pole = new THREE.Mesh(gPoleGeo, gPoleMat);
        pole.position.y = 0.62;
        holder.add(pole);

        const bladeMat = new THREE.MeshStandardMaterial({
          map: createGradientPostTexture(gp.label, gp.slope),
          roughness: 0.4,
        });
        const blade = new THREE.Mesh(gBladeGeo, bladeMat);
        blade.position.set(0.24, 1.24, 0.02);
        blade.rotation.z = gp.slope === 'up' ? 0.18 : gp.slope === 'down' ? -0.18 : 0.0;
        holder.add(blade);

        this.group.add(holder);
      }
    }

    // ---- 5. 日暮里・北千住 分岐器（ポイント）ディテール：護輪軌条・電気転轍機・動作桿・床板油汚れ・開通表示器 ----
    {
      const switchMachineMat = new THREE.MeshStandardMaterial({
        color: 0x22262b,
        metalness: 0.65,
        roughness: 0.42,
      });
      const rodMat = new THREE.MeshStandardMaterial({
        color: 0xcfd6de,
        metalness: 0.88,
        roughness: 0.22,
      });
      const greaseMat = new THREE.MeshStandardMaterial({
        color: 0x141210,
        roughness: 0.24,
        metalness: 0.35,
      });
      const guardRailMat = new THREE.MeshStandardMaterial({
        color: 0x7b604e,
        metalness: 0.72,
        roughness: 0.44,
      });
      const switchTargetMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(0.35, 1.8, 3.2), // 定位開通を示す青白い内照式ダルマ・開通標識！
      });

      const turnoutPoints = [
        { d: 97, lat: 0.0, machineSide: -1 },   // 日暮里 4番線側 トング先端
        { d: 165, lat: 4.1, machineSide: +1 },  // 日暮里 上り3番線側 合流端
        { d: 4847, lat: 8.6, machineSide: +1 }, // 北千住 上り本線側 分岐端
        { d: 4932, lat: 4.25, machineSide: -1 }, // 北千住 2番線中線側 分岐端
      ];

      for (const tp of turnoutPoints) {
        const f = this.route.getFrameAt(tp.d);
        const hr = new THREE.Vector3().crossVectors(f.tangent, WORLD_UP).normalize();
        const tg = new THREE.Group();
        tg.position.copy(f.position).addScaledVector(hr, tp.lat);
        basis.makeBasis(hr, WORLD_UP, f.tangent.clone().negate());
        tg.quaternion.setFromRotationMatrix(basis);

        // トングレール摺動床板の黒い潤滑グリス汚れ
        const greasePatch = new THREE.Mesh(new THREE.PlaneGeometry(1.55, 6.5), greaseMat);
        greasePatch.rotation.x = -Math.PI * 0.5;
        greasePatch.position.set(0, -0.125, -2.5);
        tg.add(greasePatch);

        // 護輪軌条（ガードレール 2本）
        for (const gx of [-0.38, 0.38]) {
          const gr = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.09, 5.2), guardRailMat);
          gr.position.set(gx, -0.045, -3.5);
          tg.add(gr);
        }

        // NS形電気転轍機（ポイントマシン筐体）＋ 銀色の動作桿・鎖錠桿 2本
        const mX = tp.machineSide * 1.42;
        const machine = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.28, 1.05), switchMachineMat);
        machine.position.set(mX, -0.06, 0);
        tg.add(machine);

        for (const rz of [-0.22, 0.22]) {
          const rod = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.03, 0.04), rodMat);
          rod.position.set(mX * 0.5, -0.10, rz);
          tg.add(rod);
        }

        // 開通方向表示器（青白色発光ターゲット）
        const indPost = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.55, 6), switchMachineMat);
        indPost.position.set(tp.machineSide * 1.85, 0.12, 0.4);
        tg.add(indPost);

        const indLamp = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.20, 0.16), switchTargetMat);
        indLamp.position.set(tp.machineSide * 1.85, 0.42, 0.4);
        tg.add(indLamp);

        this.group.add(tg);
      }
    }
  }

  updateSignals(trainDistance, nextStopDistance) {
    const aspectByDist = new Map();

    for (const sig of this.signals) {
      let aspect = 'G';
      if (sig.isTerminalEnd) {
        aspect = 'R';
      } else if (
        nextStopDistance !== null &&
        sig.distance >= nextStopDistance - 440 &&
        sig.distance <= nextStopDistance + 30
      ) {
        aspect = 'Y';
      } else if (trainDistance > sig.distance + 8) {
        aspect = 'R';
      }

      sig.aspect = aspect;
      aspectByDist.set(sig.distance, aspect);

      sig.greenMat.color.setRGB(
        aspect === 'G' ? 0.1 : 0.01,
        aspect === 'G' ? 3.2 : 0.04,
        aspect === 'G' ? 1.5 : 0.02
      );
      sig.yellowMat.color.setRGB(
        aspect === 'Y' ? 3.5 : 0.04,
        aspect === 'Y' ? 1.8 : 0.02,
        aspect === 'Y' ? 0.08 : 0.01
      );
      sig.redMat.color.setRGB(
        aspect === 'R' ? 3.6 : 0.04,
        aspect === 'R' ? 0.14 : 0.01,
        aspect === 'R' ? 0.1 : 0.01
      );
    }

    // 中継信号機を主信号機の現示と完全連動（G=縦3灯, Y=斜め3灯, R=横3灯）
    for (const rep of this.repeaterSignals) {
      const aspect = trainDistance > rep.distance + 8 ? 'R' : aspectByDist.get(rep.parentSignalD) || 'G';
      rep.gMat.color.setRGB(
        aspect === 'G' ? 2.8 : 0.06,
        aspect === 'G' ? 2.75 : 0.06,
        aspect === 'G' ? 2.4 : 0.06
      );
      rep.yMat.color.setRGB(
        aspect === 'Y' ? 2.8 : 0.06,
        aspect === 'Y' ? 2.75 : 0.06,
        aspect === 'Y' ? 2.4 : 0.06
      );
      rep.rMat.color.setRGB(
        aspect === 'R' ? 2.8 : 0.06,
        aspect === 'R' ? 2.75 : 0.06,
        aspect === 'R' ? 2.4 : 0.06
      );
    }
  }
}

