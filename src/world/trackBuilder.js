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
import { createSpeedSignTexture } from './textures.js';

const WORLD_UP = new THREE.Vector3(0, 1, 0);

/**
 * 複線本線＋北千住2番線（中線待避線）＋日暮里14線メガコリドー
 * （常磐2線＋東北本線・高崎・尾久4線＋東北新幹線2線[地下抗口〜急勾配高架]＋京浜東北・山手方向別複々線4線＋京成2線）、
 * 2層PBR金属レール、PC枕木、スラブ軌道、門型架線柱・カテナリー架線、閉塞信号機を構築するクラス
 */
export class TrackSystem {
  constructor(scene, route, textures) {
    this.scene = scene;
    this.route = route;
    this.textures = textures;
    this.group = new THREE.Group();
    this.scene.add(this.group);

    this.signals = [];

    this._buildViaductAndBallast();
    this._buildRails();
    this._buildSleepers();
    this._buildCatenarySystem();
    this._buildSignalsAndSigns();
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
   * 門型ラーメン架線柱（日暮里14線ワイドトラスビーム＋東北新幹線専用高架架線柱＋北千住2面3線対応）＋ カテナリー架線
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
      color: 0x6b7278,
      metalness: 0.72,
      roughness: 0.44,
      envMapIntensity: 1.1,
    });
    const insulatorMat = new THREE.MeshStandardMaterial({
      color: 0xe6eaee,
      metalness: 0.15,
      roughness: 0.22,
    });

    const poleGeo = new THREE.BoxGeometry(0.28, 7.6, 0.28);
    const beamGeo = new THREE.BoxGeometry(1.0, 0.30, 0.26);
    const insGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.42, 8);

    const maxPoles = validMasts.length * 2 + nipCorridorMasts.length * 4 + shinkansenMasts.length * 2 + 16;
    const maxBeams = validMasts.length + nipCorridorMasts.length * 2 + shinkansenMasts.length + 16;
    const maxIns =
      validMasts.length * 5 + nipCorridorMasts.length * 8 + shinkansenMasts.length * 2 + 32;

    const poleInst = new THREE.InstancedMesh(poleGeo, steelMat, maxPoles);
    const beamInst = new THREE.InstancedMesh(beamGeo, steelMat, maxBeams);
    const insInst = new THREE.InstancedMesh(insGeo, insulatorMat, maxIns);

    poleInst.castShadow = true;
    poleInst.receiveShadow = true;
    beamInst.castShadow = true;

    const dummy = new THREE.Object3D();
    const basis = new THREE.Matrix4();
    let pIdx = 0;
    let bIdx = 0;
    let iIdx = 0;

    // 1. 常磐線本線（＋北千住中線）の架線柱
    for (const d of validMasts) {
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
          .addScaledVector(WORLD_UP, 3.2);
        dummy.updateMatrix();
        poleInst.setMatrixAt(pIdx++, dummy.matrix);
      }

      const span = rightX - leftX + 0.5;
      const midX = (leftX + rightX) * 0.5;
      dummy.quaternion.copy(rotQ);
      dummy.scale.set(span, 1, 1);
      dummy.position
        .copy(down.position)
        .addScaledVector(horizRight, midX)
        .addScaledVector(WORLD_UP, 6.45);
      dummy.updateMatrix();
      beamInst.setMatrixAt(bIdx++, dummy.matrix);

      dummy.scale.set(1, 1, 1);
      const insXs = [0, upOffset, leftX + 0.45, rightX - 0.45];
      const midSiding = this.route.getKitaSenjuMiddleTrackOffset(d);
      if (midSiding !== null) insXs.push(midSiding);

      for (const ix of insXs) {
        dummy.position
          .copy(down.position)
          .addScaledVector(horizRight, ix)
          .addScaledVector(WORLD_UP, 6.18);
        dummy.updateMatrix();
        insInst.setMatrixAt(iIdx++, dummy.matrix);
      }
    }

    // 2. 日暮里メガコリドー 在来線8線（東北本線4線ガントリー ＋ 京浜東北・山手4線ガントリー）
    for (const d of nipCorridorMasts) {
      const ref = this.route.getNipporiParallelPoint(d, 0);
      basis.makeBasis(ref.right, WORLD_UP, ref.tangent.clone().negate());
      const rotQ = new THREE.Quaternion().setFromRotationMatrix(basis);

      // (a) 東北本線・高崎線・尾久回送線 4線スパン (-2.8m .. -18.8m)
      for (const px of d < 105 ? [-18.8] : [-2.8, -18.8]) {
        dummy.quaternion.copy(rotQ);
        dummy.scale.set(1, 1, 1);
        dummy.position
          .copy(ref.position)
          .addScaledVector(ref.right, px)
          .addScaledVector(WORLD_UP, 3.2);
        dummy.updateMatrix();
        poleInst.setMatrixAt(pIdx++, dummy.matrix);
      }
      dummy.quaternion.copy(rotQ);
      dummy.scale.set(16.6, 1, 1);
      dummy.position
        .copy(ref.position)
        .addScaledVector(ref.right, -10.8)
        .addScaledVector(WORLD_UP, 6.45);
      dummy.updateMatrix();
      beamInst.setMatrixAt(bIdx++, dummy.matrix);

      // (b) 京浜東北・山手線 9〜12番線 4線ワイドスパン (-30.0m .. -56.2m)
      for (const px of [-30.0, -56.2]) {
        dummy.quaternion.copy(rotQ);
        dummy.scale.set(1, 1, 1);
        dummy.position
          .copy(ref.position)
          .addScaledVector(ref.right, px)
          .addScaledVector(WORLD_UP, 3.2);
        dummy.updateMatrix();
        poleInst.setMatrixAt(pIdx++, dummy.matrix);
      }
      dummy.quaternion.copy(rotQ);
      dummy.scale.set(26.8, 1, 1);
      dummy.position
        .copy(ref.position)
        .addScaledVector(ref.right, -43.1)
        .addScaledVector(WORLD_UP, 6.45);
      dummy.updateMatrix();
      beamInst.setMatrixAt(bIdx++, dummy.matrix);

      // 8線すべての懸垂がいし
      dummy.scale.set(1, 1, 1);
      for (const ix of NIPPORI_SURFACE_TRACKS) {
        dummy.position
          .copy(ref.position)
          .addScaledVector(ref.right, ix)
          .addScaledVector(WORLD_UP, 6.18);
        dummy.updateMatrix();
        insInst.setMatrixAt(iIdx++, dummy.matrix);
      }
    }

    // 3. 東北新幹線 専用高架門型架線柱（急勾配アプローチから高架橋へ連続追従！）
    for (const d of shinkansenMasts) {
      // 京成オーバークロス (d=95m付近) の直下だけは干渉防止でスキップ
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

      dummy.scale.set(1, 1, 1.3);
      for (const shLat of NIPPORI_SHINKANSEN_TRACKS) {
        dummy.position
          .copy(shRef.position)
          .addScaledVector(shRef.right, shLat - -24.3)
          .addScaledVector(WORLD_UP, 5.85);
        dummy.updateMatrix();
        insInst.setMatrixAt(iIdx++, dummy.matrix);
      }
    }

    poleInst.count = pIdx;
    beamInst.count = bIdx;
    insInst.count = iIdx;
    poleInst.instanceMatrix.needsUpdate = true;
    beamInst.instanceMatrix.needsUpdate = true;
    insInst.instanceMatrix.needsUpdate = true;
    this.group.add(poleInst);
    this.group.add(beamInst);
    this.group.add(insInst);

    // トロリー線＋ちょう架線（常磐本線2線 ＋ 北千住中線 ＋ 日暮里並走8線 ＋ 東北新幹線2線！）
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

    addCatenaryWireRun(mastDistances, (d) => {
      const f = this.route.getFrameAt(d);
      return { basePos: f.position, right: f.right };
    });
    addCatenaryWireRun(mastDistances, (d) => {
      const f = this.route.getUpTrackFrameAt(d);
      return { basePos: f.position, right: f.horizRight };
    });

    // 北千住 2番線中線の架線
    const midMasts = [];
    for (let d = 4810; d <= 5360; d += 44) midMasts.push(d);
    addCatenaryWireRun(midMasts, (d) => {
      const down = this.route.getFrameAt(d);
      const r = new THREE.Vector3().crossVectors(down.tangent, WORLD_UP).normalize();
      const off = this.route.getKitaSenjuMiddleTrackOffset(d) ?? 4.25;
      return { basePos: down.position.clone().addScaledVector(r, off), right: r };
    });

    // 日暮里並走8線（東北本線4線＋京浜東北・山手4線）の架線
    for (const latOff of NIPPORI_SURFACE_TRACKS) {
      addCatenaryWireRun(nipCorridorMasts, (d) => {
        const pt = this.route.getNipporiParallelPoint(d, latOff);
        return { basePos: pt.position, right: pt.right };
      });
    }

    // 東北新幹線2線の25kV交流き電ちょう架・トロリー架線
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
      color: 0x262a30,
      transparent: true,
      opacity: 0.78,
    });
    this.group.add(new THREE.LineSegments(wireGeo, wireMat));
  }

  _buildSignalsAndSigns() {
    const postMat = new THREE.MeshStandardMaterial({
      color: 0x5c6268,
      metalness: 0.6,
      roughness: 0.5,
    });
    const hoodMat = new THREE.MeshStandardMaterial({
      color: 0x1a1c1e,
      metalness: 0.3,
      roughness: 0.75,
    });

    // 閉塞・場内・出発信号機（北千住進入手前 4800m には1番線用＋2番線中線用の2基併設場内信号機！）
    const signalLocations = [
      38, 480, 920, 1255, 1820, 2450, 3120, 3465, 3910, 4420, 4815, 5242,
    ];

    const poleGeo = new THREE.CylinderGeometry(0.07, 0.08, 4.4, 8);
    const headGeo = new THREE.BoxGeometry(0.46, 1.25, 0.32);
    const lampGeo = new THREE.SphereGeometry(0.095, 12, 10);

    for (const d of signalLocations) {
      const frame = this.route.getFrameAt(d);
      const horizRight = new THREE.Vector3().crossVectors(frame.tangent, WORLD_UP).normalize();

      let offsetLeft = -2.45;
      for (const st of STATIONS) {
        if (d >= st.platformStart - 5 && d <= st.platformEnd + 18 && st.platformSide === 'left') {
          offsetLeft = -2.15;
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
      pole.position.y = 2.1;
      sigGroup.add(pole);

      const head = new THREE.Mesh(headGeo, hoodMat);
      head.position.set(0, 4.15, 0);
      sigGroup.add(head);

      const greenMat = new THREE.MeshBasicMaterial({ color: 0x00ff88 });
      const yellowMat = new THREE.MeshBasicMaterial({ color: 0xffaa00 });
      const redMat = new THREE.MeshBasicMaterial({ color: 0xff2626 });

      const yLamp = new THREE.Mesh(lampGeo, yellowMat);
      yLamp.position.set(0, 4.5, 0.15);
      const rLamp = new THREE.Mesh(lampGeo, redMat);
      rLamp.position.set(0, 4.15, 0.15);
      const gLamp = new THREE.Mesh(lampGeo, greenMat);
      gLamp.position.set(0, 3.8, 0.15);
      sigGroup.add(yLamp, rLamp, gLamp);

      // 北千住場内信号機(4815m)は中線2番線進入用の第2信号機（赤現示）を腕木で併設！
      if (d === 4815) {
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
        subRed.position.set(0.88, 3.95, 0.15);
        sigGroup.add(subRed);
      }

      this.group.add(sigGroup);
      this.signals.push({
        distance: d,
        greenMat,
        yellowMat,
        redMat,
        isTerminalEnd: d > 5210,
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
        new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4, metalness: 0.1 })
      );
      board.position.set(0, 2.05, 0.04);
      g.add(board);

      this.group.add(g);
    }
  }

  updateSignals(trainDistance, nextStopDistance) {
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
  }
}
