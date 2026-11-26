import * as THREE from 'three';
import {
  STATIONS,
  LANDMARKS,
  ROUTE_START_BUFFER,
  ROUTE_END_BUFFER,
} from './routeData.js';
import {
  createStationSignTexture,
  createStopTargetTexture,
  createAtosLedBoardTexture,
  createExitTransferSignTexture,
  createItvMonitorTexture,
  createVendingMachineTexture,
  createUrbanSignageTexture,
} from './textures.js';
import { RollingStockFactory } from '../train/rollingStock.js';

const WORLD_UP = new THREE.Vector3(0, 1, 0);

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 複数の BufferGeometry を 1 つの BufferGeometry に結合する軽量ヘルパー
 */
function mergeBufferGeos(geos) {
  let totalVerts = 0;
  let totalIndices = 0;
  for (const g of geos) {
    totalVerts += g.attributes.position.count;
    totalIndices += g.index ? g.index.count : g.attributes.position.count;
  }

  const pos = new Float32Array(totalVerts * 3);
  const norm = new Float32Array(totalVerts * 3);
  const uv = new Float32Array(totalVerts * 2);
  const idx = new Uint32Array(totalIndices);

  let vOff = 0;
  let iOff = 0;
  for (const g of geos) {
    const pAttr = g.attributes.position;
    const nAttr = g.attributes.normal;
    const uAttr = g.attributes.uv;
    const vCount = pAttr.count;

    pos.set(pAttr.array, vOff * 3);
    if (nAttr) norm.set(nAttr.array, vOff * 3);
    if (uAttr) uv.set(uAttr.array, vOff * 2);

    if (g.index) {
      const gIdx = g.index.array;
      for (let i = 0; i < gIdx.length; i++) {
        idx[iOff + i] = gIdx[i] + vOff;
      }
      iOff += gIdx.length;
    } else {
      for (let i = 0; i < vCount; i++) {
        idx[iOff + i] = vOff + i;
      }
      iOff += vCount;
    }
    vOff += vCount;
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

/**
 * 屋上面 (+Y / -Y) を非発光コンクリート防水UV領域 (v = 0.92..0.99) に割り当てた建築用ボックス
 */
function createCleanRoofBoxGeo(
  w,
  h,
  d,
  cx = 0,
  cy = h * 0.5,
  cz = 0,
  { uRepeatX = 1, uRepeatZ = 1, vMin = 0.0, vMax = 0.90 } = {}
) {
  const geo = new THREE.BoxGeometry(w, h, d);
  geo.translate(cx, cy, cz);
  const uvAttr = geo.attributes.uv;

  // BoxGeometry の面順: 0:+X, 1:-X, 2:+Y(屋上), 3:-Y(底面), 4:+Z, 5:-Z
  for (let face = 0; face < 6; face++) {
    const base = face * 4;
    if (face === 2 || face === 3) {
      uvAttr.setXY(base + 0, 0.08, 0.99);
      uvAttr.setXY(base + 1, 0.92, 0.99);
      uvAttr.setXY(base + 2, 0.08, 0.92);
      uvAttr.setXY(base + 3, 0.92, 0.92);
    } else {
      const uRep = face < 2 ? uRepeatZ : uRepeatX;
      uvAttr.setXY(base + 0, 0.0, vMax);
      uvAttr.setXY(base + 1, uRep, vMax);
      uvAttr.setXY(base + 2, 0.0, vMin);
      uvAttr.setXY(base + 3, uRep, vMin);
    }
  }
  uvAttr.needsUpdate = true;
  return geo;
}

/**
 * 多様な都市建築シルエットの単位ジオメトリ群（すべて底面 y = 0 基準、1×1×1 正規化）
 */
function createBuildingSilhouetteTemplates() {
  // 0: パラペット立ち上がり縁付きフラットルーフビル（凹んだ防水屋上スラブが見える！）
  const pw = 0.045;
  const parapetBlock = mergeBufferGeos([
    createCleanRoofBoxGeo(1.0, 0.955, 1.0, 0, 0.4775, 0, { vMin: 0.0, vMax: 0.895 }),
    createCleanRoofBoxGeo(1.0, 0.045, pw, 0, 0.9775, 0.5 - pw * 0.5, { vMin: 0.885, vMax: 0.91 }),
    createCleanRoofBoxGeo(1.0, 0.045, pw, 0, 0.9775, -0.5 + pw * 0.5, { vMin: 0.885, vMax: 0.91 }),
    createCleanRoofBoxGeo(pw, 0.045, 1.0 - pw * 2, 0.5 - pw * 0.5, 0.9775, 0, { vMin: 0.885, vMax: 0.91 }),
    createCleanRoofBoxGeo(pw, 0.045, 1.0 - pw * 2, -0.5 + pw * 0.5, 0.9775, 0, { vMin: 0.885, vMax: 0.91 }),
  ]);

  // 1: 東京特有の斜線制限3段セットバックマンション・雑居ビル（ルーフバルコニー段差！）
  const setbackStep = mergeBufferGeos([
    createCleanRoofBoxGeo(1.0, 0.54, 1.0, 0, 0.27, 0, { vMin: 0.0, vMax: 0.51 }),
    createCleanRoofBoxGeo(0.80, 0.27, 0.82, -0.07, 0.675, -0.06, { vMin: 0.51, vMax: 0.75 }),
    createCleanRoofBoxGeo(0.58, 0.19, 0.64, -0.14, 0.905, -0.11, { vMin: 0.75, vMax: 0.90 }),
  ]);

  // 2: L字型ウイング＋突出エレベーター塔付き分譲マンション
  const lWingMansion = mergeBufferGeos([
    createCleanRoofBoxGeo(1.0, 0.96, 0.52, 0, 0.48, 0.22, { vMin: 0.0, vMax: 0.895 }),
    createCleanRoofBoxGeo(0.48, 0.88, 0.48, -0.26, 0.44, -0.26, { vMin: 0.11, vMax: 0.895 }),
    createCleanRoofBoxGeo(0.22, 1.06, 0.22, -0.12, 0.53, -0.02, { vMin: 0.15, vMax: 0.905 }),
  ]);

  // 3: 外階段・エレベーターシャフト2本が突出した大型UR団地・板状集合住宅
  const twinCoreSlab = mergeBufferGeos([
    createCleanRoofBoxGeo(1.0, 0.96, 0.78, 0, 0.48, -0.05, {
      uRepeatX: 2,
      uRepeatZ: 1,
      vMin: 0.0,
      vMax: 0.895,
    }),
    createCleanRoofBoxGeo(0.15, 1.04, 0.20, -0.26, 0.52, 0.42, { vMin: 0.11, vMax: 0.905 }),
    createCleanRoofBoxGeo(0.15, 1.04, 0.20, 0.26, 0.52, 0.42, { vMin: 0.11, vMax: 0.905 }),
  ]);

  // 4: 駅前・幹線道路沿いの細身ペンシル商業雑居ビル（1階庇＋側面階段コア＋塔屋）
  const pencilCommercial = mergeBufferGeos([
    createCleanRoofBoxGeo(0.88, 0.93, 0.94, -0.04, 0.465, 0, { vMin: 0.0, vMax: 0.895 }),
    createCleanRoofBoxGeo(0.24, 1.02, 0.36, 0.36, 0.51, -0.24, { vMin: 0.12, vMax: 0.905 }),
    createCleanRoofBoxGeo(0.96, 0.028, 1.04, -0.02, 0.115, 0.02, { vMin: 0.89, vMax: 0.91 }),
  ]);

  // 5: 勾配屋根（切妻・寄棟・片流れ・のこぎり屋根）を載せる下町戸建て・アパート・町工場ボディ
  const lowRiseBody = createCleanRoofBoxGeo(1.0, 1.0, 1.0, 0, 0.5, 0, { vMin: 0.0, vMax: 0.89 });

  // 6: 1階ビルトインガレージ凹み＋2・3階オーバーハングの現代都市型3階建て住宅ボディ
  const steppedHouseBody = mergeBufferGeos([
    createCleanRoofBoxGeo(0.86, 0.35, 0.88, -0.04, 0.175, -0.04, { vMin: 0.0, vMax: 0.34 }),
    createCleanRoofBoxGeo(1.0, 0.65, 1.0, 0, 0.675, 0, { vMin: 0.34, vMax: 0.89 }),
  ]);

  // 円筒・多角柱の屋上/底面キャップUVを非発光コンクリート領域へリマップするヘルパー
  const makeCleanPrism = (rTop, rBot, h, segs, cx, cy, cz, { uRep = 2, vMin = 0.11, vMax = 0.895 } = {}) => {
    const g = new THREE.CylinderGeometry(rTop, rBot, h, segs, 1, false);
    g.translate(cx, cy, cz);
    const nAttr = g.attributes.normal;
    const uAttr = g.attributes.uv;
    for (let i = 0; i < uAttr.count; i++) {
      if (Math.abs(nAttr.getY(i)) > 0.75) {
        uAttr.setXY(i, 0.5, 0.95);
      } else {
        const u = uAttr.getX(i);
        const v = uAttr.getY(i);
        uAttr.setXY(i, u * uRep, vMin + v * (vMax - vMin));
      }
    }
    uAttr.needsUpdate = true;
    return g;
  };

  // 7: アール壁面・円筒カーテンウォールタワー＋低層角型商業ポディウム（都会的な曲線ビル！）
  const cylinderTower = mergeBufferGeos([
    createCleanRoofBoxGeo(0.98, 0.20, 0.98, 0, 0.10, 0, { vMin: 0.0, vMax: 0.26 }),
    makeCleanPrism(0.45, 0.45, 0.75, 18, 0, 0.575, 0, { uRep: 2, vMin: 0.12, vMax: 0.895 }),
    makeCleanPrism(0.30, 0.32, 0.06, 16, 0, 0.97, 0, { uRep: 1, vMin: 0.82, vMax: 0.905 }),
  ]);

  // 8: 交差点隅切り8角形シャフト＋段付きクラウンの近代オフィス・商業ビル
  const chamferCrown = mergeBufferGeos([
    makeCleanPrism(0.52, 0.52, 0.84, 8, 0, 0.42, 0, { uRep: 2, vMin: 0.0, vMax: 0.86 }),
    makeCleanPrism(0.37, 0.44, 0.16, 8, 0, 0.92, 0, { uRep: 2, vMin: 0.76, vMax: 0.905 }),
  ]);

  // 9: 共通商業基壇の上に高さの異なる非対称ツインタワーが載る複合再開発ビル
  const twinPodium = mergeBufferGeos([
    createCleanRoofBoxGeo(1.0, 0.22, 1.0, 0, 0.11, 0, { vMin: 0.0, vMax: 0.28 }),
    createCleanRoofBoxGeo(0.43, 0.78, 0.84, -0.26, 0.61, 0, { vMin: 0.12, vMax: 0.895 }),
    createCleanRoofBoxGeo(0.43, 0.58, 0.80, 0.26, 0.51, -0.02, { vMin: 0.12, vMax: 0.895 }),
  ]);

  // 10: コの字型（両翼ウイング＋中央コートヤード）中層マンション・オフィスビル
  const courtyardUBlock = mergeBufferGeos([
    createCleanRoofBoxGeo(1.0, 0.96, 0.38, 0, 0.48, -0.31, { vMin: 0.0, vMax: 0.895 }),
    createCleanRoofBoxGeo(0.34, 0.92, 0.62, -0.33, 0.46, 0.19, { vMin: 0.11, vMax: 0.895 }),
    createCleanRoofBoxGeo(0.34, 0.92, 0.62, 0.33, 0.46, 0.19, { vMin: 0.11, vMax: 0.895 }),
  ]);

  return {
    parapetBlock,
    setbackStep,
    lWingMansion,
    twinCoreSlab,
    pencilCommercial,
    lowRiseBody,
    steppedHouseBody,
    cylinderTower,
    chamferCrown,
    twinPodium,
    courtyardUBlock,
  };
}

/**
 * 勾配屋根ジオメトリ生成ヘルパー（切妻・寄棟・片流れ・町工場のこぎり屋根、すべて外向き法線＆軒出付き）
 */
function buildSolidMeshFromQuadsAndTris(builders) {
  const pos = [];
  const uv = [];
  const idx = [];
  const pushQuad = (a, b, c, d) => {
    const base = pos.length / 3;
    pos.push(...a, ...b, ...c, ...d);
    uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  const pushTri = (a, b, c) => {
    const base = pos.length / 3;
    pos.push(...a, ...b, ...c);
    uv.push(0, 0, 1, 0, 0.5, 1);
    idx.push(base, base + 1, base + 2);
  };
  builders(pushQuad, pushTri);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function createPitchedRoofTemplates() {
  // 0: 切妻屋根 (Gable Roof)
  const gable = buildSolidMeshFromQuadsAndTris((quad, tri) => {
    const x = 0.55;
    const z = 0.55;
    const h = 1.0;
    quad([x, 0, z], [x, 0, -z], [0, h, -z], [0, h, z]); // 右流れ面
    quad([-x, 0, -z], [-x, 0, z], [0, h, z], [0, h, -z]); // 左流れ面
    tri([-x, 0, z], [x, 0, z], [0, h, z]); // 前妻壁
    tri([x, 0, -z], [-x, 0, -z], [0, h, -z]); // 後妻壁
    quad([-x, 0, -z], [x, 0, -z], [x, 0, z], [-x, 0, z]); // 軒裏
  });

  // 1: 寄棟屋根 (Hipped Roof)
  const hip = buildSolidMeshFromQuadsAndTris((quad, tri) => {
    const x = 0.56;
    const z = 0.56;
    const rz = 0.22;
    const h = 1.0;
    quad([x, 0, z], [x, 0, -z], [0, h, -rz], [0, h, rz]);
    quad([-x, 0, -z], [-x, 0, z], [0, h, rz], [0, h, -rz]);
    tri([-x, 0, z], [x, 0, z], [0, h, rz]);
    tri([x, 0, -z], [-x, 0, -z], [0, h, -rz]);
    quad([-x, 0, -z], [x, 0, -z], [x, 0, z], [-x, 0, z]);
  });

  // 2: 片流れ屋根 (Modern Asymmetric Shed Roof — 都内狭小3階建て住宅の定番！)
  const shed = buildSolidMeshFromQuadsAndTris((quad) => {
    const x = 0.54;
    const z = 0.54;
    const hLow = 0.12;
    const hHigh = 1.0;
    quad([-x, hLow, z], [x, hHigh, z], [x, hHigh, -z], [-x, hLow, -z]); // 傾斜屋根上面
    quad([x, 0, z], [x, 0, -z], [x, hHigh, -z], [x, hHigh, z]); // 高側壁
    quad([-x, 0, -z], [-x, 0, z], [-x, hLow, z], [-x, hLow, -z]); // 低側軒先
    quad([-x, 0, z], [x, 0, z], [x, hHigh, z], [-x, hLow, z]); // 前側面
    quad([x, 0, -z], [-x, 0, -z], [-x, hLow, -z], [x, hHigh, -z]); // 後側面
    quad([-x, 0, -z], [x, 0, -z], [x, 0, z], [-x, 0, z]); // 底面
  });

  // 3: 2連のこぎり屋根 (Sawtooth Factory Roof — 荒川・三河島・南千住の町工場・倉庫！)
  const sawtooth = buildSolidMeshFromQuadsAndTris((quad, tri) => {
    const z = 0.53;
    const spans = [
      [-0.53, 0.0],
      [0.0, 0.53],
    ];
    for (const [x0, x1] of spans) {
      const peakX = x1 - 0.08;
      const h = 1.0;
      quad([x0, 0, z], [peakX, h, z], [peakX, h, -z], [x0, 0, -z]); // 緩勾配スレート面
      quad([x1, 0, z], [x1, 0, -z], [peakX, h, -z], [peakX, h, z]); // 急勾配採光窓面
      tri([x0, 0, z], [x1, 0, z], [peakX, h, z]);
      tri([x1, 0, -z], [x0, 0, -z], [peakX, h, -z]);
    }
    quad([-0.53, 0, -z], [0.53, 0, -z], [0.53, 0, z], [-0.53, 0, z]);
  });

  return { gable, hip, shed, sawtooth };
}

/**
 * 昭和・平成マンション・雑居ビル屋上の名物「高架水槽（FRP貯水タンク＋鉄骨架台）」＆「大型空調室外機群」
 */
function createWaterTankGeo() {
  const parts = [];
  for (const lx of [-0.34, 0.34]) {
    for (const lz of [-0.34, 0.34]) {
      const leg = new THREE.BoxGeometry(0.08, 0.38, 0.08);
      leg.translate(lx, 0.19, lz);
      parts.push(leg);
    }
  }
  const frame = new THREE.BoxGeometry(0.84, 0.06, 0.84);
  frame.translate(0, 0.38, 0);
  parts.push(frame);

  const tank = new THREE.BoxGeometry(0.78, 0.52, 0.78);
  tank.translate(0, 0.67, 0);
  parts.push(tank);

  const hatch = new THREE.CylinderGeometry(0.16, 0.18, 0.08, 8);
  hatch.translate(0.14, 0.97, 0.12);
  parts.push(hatch);

  return mergeBufferGeos(parts);
}

function createHvacClusterGeo() {
  const parts = [];
  const unitA = new THREE.BoxGeometry(0.46, 0.72, 0.88);
  unitA.translate(-0.26, 0.36, 0);
  parts.push(unitA);

  const unitB = new THREE.BoxGeometry(0.46, 0.72, 0.88);
  unitB.translate(0.26, 0.36, 0);
  parts.push(unitB);

  for (const fx of [-0.26, 0.26]) {
    const fan = new THREE.CylinderGeometry(0.17, 0.19, 0.14, 8);
    fan.translate(fx, 0.79, 0.16);
    parts.push(fan);
    const fan2 = new THREE.CylinderGeometry(0.17, 0.19, 0.14, 8);
    fan2.translate(fx, 0.79, -0.20);
    parts.push(fan2);
  }
  return mergeBufferGeos(parts);
}

/**
 * 8種サインアトラスの特定セル (0..7) にUVマッピングされた内照式看板ジオメトリ（袖看板・屋上広告塔共用）
 */
function createSignCellGeo(cellIdx) {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const col = cellIdx % 4;
  const row = Math.floor(cellIdx / 4);
  const u0 = col * 0.25 + 0.005;
  const u1 = (col + 1) * 0.25 - 0.005;
  // CanvasTexture flipY=true のため row=0(上段) が v=0.5..1.0, row=1(下段) が v=0.0..0.5
  const v0 = row === 0 ? 0.505 : 0.005;
  const v1 = row === 0 ? 0.995 : 0.495;

  const uvAttr = geo.attributes.uv;
  for (let face = 0; face < 6; face++) {
    const base = face * 4;
    if (face === 2 || face === 3) {
      uvAttr.setXY(base + 0, u0, v1);
      uvAttr.setXY(base + 1, u0 + 0.02, v1);
      uvAttr.setXY(base + 2, u0, v1 - 0.02);
      uvAttr.setXY(base + 3, u0 + 0.02, v1 - 0.02);
    } else {
      uvAttr.setXY(base + 0, u0, v1);
      uvAttr.setXY(base + 1, u1, v1);
      uvAttr.setXY(base + 2, u0, v0);
      uvAttr.setXY(base + 3, u1, v0);
    }
  }
  uvAttr.needsUpdate = true;
  return geo;
}

/**
 * JR常磐線（日暮里〜北千住）高密度現代駅構造物・実物配線施設・沿線ランドマーク・E531/E231対向列車
 */
export class ScenerySystem {
  constructor(scene, route, textures) {
    this.scene = scene;
    this.route = route;
    this.textures = textures;
    this.group = new THREE.Group();
    this.scene.add(this.group);

    this.rollingStock = new RollingStockFactory();

    this.buildingMaterials = [];
    this.signageMaterial = null;
    this.obstructionLights = [];
    this.waterMaterial = null;
    this.oncomingTrains = [];
    this.parallelTrains = [];

    this._buildUrbanGroundAndViaductPiers();
    this._buildStations();
    this._buildNipporiComplex();
    this._buildKitaSenjuComplex();
    this._buildSumidaRiverAndTrussBridge();
    this._buildLandmarksAndFreightYard();
    this._buildCityscape();
    this._buildOncomingAndParallelTrains();
  }

  setWindowGlowMultiplier(mult) {
    for (const mat of this.buildingMaterials) {
      if (mat) mat.emissiveIntensity = 1.35 * mult;
    }
    if (this.signageMaterial) {
      this.signageMaterial.emissiveIntensity = 0.42 + 1.05 * mult;
    }
  }

  _buildUrbanGroundAndViaductPiers() {
    const groundGeo = new THREE.PlaneGeometry(18000, 18000);
    groundGeo.rotateX(-Math.PI / 2);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x1e2024,
      roughness: 0.94,
      metalness: 0.05,
      envMapIntensity: 0.35,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.position.set(900, 0, -2200);
    ground.receiveShadow = true;
    this.group.add(ground);

    const pierLocations = [];
    for (let d = 110; d <= 5450; d += 28) {
      if (d > LANDMARKS.sumidaBridgeStart - 12 && d < LANDMARKS.sumidaBridgeEnd + 12) continue;
      pierLocations.push(d);
    }

    const pierGeo = new THREE.BoxGeometry(0.85, 1.0, 0.85);
    const pierMat = new THREE.MeshStandardMaterial({
      color: 0x76787a,
      map: this.textures.concrete.map,
      roughness: 0.9,
      metalness: 0.04,
    });
    const pierInst = new THREE.InstancedMesh(pierGeo, pierMat, pierLocations.length * 2);

    const dummy = new THREE.Object3D();
    let idx = 0;
    for (const d of pierLocations) {
      const down = this.route.getFrameAt(d);
      const upOffset = this.route.getUpTrackOffset(d);
      const horizRight = new THREE.Vector3().crossVectors(down.tangent, WORLD_UP).normalize();
      const h = Math.max(1.0, down.position.y - 1.5);

      for (const lx of [-2.4, upOffset + 2.4]) {
        dummy.position.copy(down.position).addScaledVector(horizRight, lx);
        dummy.position.y = h * 0.5;
        dummy.scale.set(1, h, 1);
        dummy.rotation.set(0, Math.atan2(down.tangent.x, down.tangent.z), 0);
        dummy.updateMatrix();
        pierInst.setMatrixAt(idx++, dummy.matrix);
      }
    }
    pierInst.count = idx;
    pierInst.instanceMatrix.needsUpdate = true;
    this.group.add(pierInst);
  }

  /**
   * 現代のJR東日本らしい情報量豊かな全4駅（ATOS発車標・黄色出口案内・ITV監視モニタ・待合室・階段室・自販機・橋上駅舎）
   */
  _buildStations() {
    const platformSideMat = new THREE.MeshStandardMaterial({
      color: 0x6d7073,
      map: this.textures.concrete.map,
      roughness: 0.88,
      metalness: 0.05,
    });
    const platformTopMat = new THREE.MeshStandardMaterial({
      map: this.textures.platformTop,
      roughness: 0.82,
      metalness: 0.06,
      envMapIntensity: 0.75,
    });
    const roofMat = new THREE.MeshStandardMaterial({
      color: 0x383e45,
      metalness: 0.58,
      roughness: 0.46,
    });
    const roofUndersideMat = new THREE.MeshStandardMaterial({
      color: 0x9299a1,
      metalness: 0.25,
      roughness: 0.62,
    });
    const steelBeamMat = new THREE.MeshStandardMaterial({
      color: 0x454d56,
      metalness: 0.68,
      roughness: 0.38,
    });
    const glassRoomMat = new THREE.MeshStandardMaterial({
      color: 0x8bb8c8,
      metalness: 0.35,
      roughness: 0.14,
      transparent: true,
      opacity: 0.52,
    });
    const stairWallMat = new THREE.MeshStandardMaterial({
      color: 0xc8cfd6,
      roughness: 0.62,
      metalness: 0.18,
    });
    const ledFixtureMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(2.4, 2.38, 2.2),
    });

    const stopTargetTex = createStopTargetTexture('15');
    const stopBoardMat = new THREE.MeshStandardMaterial({
      map: stopTargetTex,
      transparent: true,
      roughness: 0.35,
      metalness: 0.1,
      emissive: new THREE.Color(0xffffff),
      emissiveMap: stopTargetTex,
      emissiveIntensity: 0.26,
    });

    const itvTex = createItvMonitorTexture();
    const itvScreenMat = new THREE.MeshStandardMaterial({
      map: itvTex,
      emissive: new THREE.Color(0xffffff),
      emissiveMap: itvTex,
      emissiveIntensity: 0.95,
      roughness: 0.25,
    });

    const vendingTex = createVendingMachineTexture();
    const vendingMat = new THREE.MeshStandardMaterial({
      map: vendingTex,
      emissive: new THREE.Color(0xffffff),
      emissiveMap: vendingTex,
      emissiveIntensity: 0.75,
      roughness: 0.32,
    });

    for (const st of STATIONS) {
      const stGroup = new THREE.Group();
      this._buildPlatformDeckAndCanopy(
        st,
        stGroup,
        platformTopMat,
        platformSideMat,
        roofMat,
        roofUndersideMat,
        steelBeamMat,
        ledFixtureMat
      );

      // 現代のJR駅ホーム上ディテール（駅名標・ATOS発車標・黄色出口案内・待合室・階段エスカレーター囲い・自販機・ベンチ）
      const signTex = createStationSignTexture(st);
      const signMat = new THREE.MeshStandardMaterial({
        map: signTex,
        emissive: new THREE.Color(0xfffcf2),
        emissiveMap: signTex,
        emissiveIntensity: 0.78,
        roughness: 0.28,
      });

      const atosTex = createAtosLedBoardTexture(st);
      const atosMat = new THREE.MeshStandardMaterial({
        map: atosTex,
        emissive: new THREE.Color(0xffffff),
        emissiveMap: atosTex,
        emissiveIntensity: 0.95,
        roughness: 0.25,
      });

      const exitTex = createExitTransferSignTexture(st);
      const exitMat = new THREE.MeshStandardMaterial({
        map: exitTex,
        emissive: new THREE.Color(0xfffef8),
        emissiveMap: exitTex,
        emissiveIntensity: 0.82,
        roughness: 0.28,
      });

      const isLeft = st.platformSide === 'left';
      const centerLat = isLeft ? -4.55 : +4.85;
      const trackSideLat = isLeft ? -2.65 : +2.65;

      // 1. 吊り下げ駅名標 + ATOS LED発車標 + 黄色出口・乗換案内ボード（交互リズミカル配置！）
      let itemIdx = 0;
      for (let d = st.platformStart + 22; d <= st.platformEnd - 8; d += 19) {
        const frame = this.route.getFrameAt(d);
        const horizRight = new THREE.Vector3().crossVectors(frame.tangent, WORLD_UP).normalize();
        const basis = new THREE.Matrix4().makeBasis(
          horizRight,
          WORLD_UP,
          frame.tangent.clone().negate()
        );
        const q = new THREE.Quaternion().setFromRotationMatrix(basis);

        if (itemIdx % 2 === 0) {
          // 駅名標（天井吊りステー付き）
          const signMesh = new THREE.Mesh(new THREE.BoxGeometry(2.35, 0.72, 0.12), signMat);
          signMesh.quaternion.copy(q);
          signMesh.position
            .copy(frame.position)
            .addScaledVector(horizRight, centerLat)
            .addScaledVector(WORLD_UP, 3.32);
          signMesh.rotateY(isLeft ? 0.35 : -0.35);
          stGroup.add(signMesh);

          // 黄色い「↑出口・のりかえ」サインボード（線路寄りで見やすい位置）
          const exitSign = new THREE.Mesh(new THREE.BoxGeometry(2.15, 0.54, 0.10), exitMat);
          exitSign.quaternion.copy(q);
          exitSign.position
            .copy(frame.position)
            .addScaledVector(horizRight, trackSideLat)
            .addScaledVector(WORLD_UP, 3.45);
          stGroup.add(exitSign);
        } else {
          // ATOS 2段フルカラーLED発車標（線路に正対して吊り下げ！）
          const atosBoard = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.56, 0.16), atosMat);
          atosBoard.quaternion.copy(q);
          atosBoard.position
            .copy(frame.position)
            .addScaledVector(horizRight, trackSideLat)
            .addScaledVector(WORLD_UP, 3.38);
          stGroup.add(atosBoard);

          // 吊り下げパイプ2本
          for (const sx of [-0.65, 0.65]) {
            const hanger = new THREE.Mesh(
              new THREE.CylinderGeometry(0.02, 0.02, 0.85, 6),
              steelBeamMat
            );
            hanger.quaternion.copy(q);
            hanger.position
              .copy(frame.position)
              .addScaledVector(horizRight, trackSideLat + sx)
              .addScaledVector(WORLD_UP, 3.98);
            stGroup.add(hanger);
          }
        }
        itemIdx++;
      }

      // 2. ホーム上の階段・エスカレーター建屋、エレベーター塔、ガラス張り空調待合室、acure自販機、ベンチ
      const midPlatD = (st.platformStart + st.platformEnd) * 0.5;
      const facilityOffsets = [midPlatD - 48, midPlatD + 36];

      for (let f = 0; f < facilityOffsets.length; f++) {
        const fd = facilityOffsets[f];
        const frame = this.route.getFrameAt(fd);
        const horizRight = new THREE.Vector3().crossVectors(frame.tangent, WORLD_UP).normalize();
        const basis = new THREE.Matrix4().makeBasis(
          horizRight,
          WORLD_UP,
          frame.tangent.clone().negate()
        );
        const q = new THREE.Quaternion().setFromRotationMatrix(basis);

        // 階段・エスカレーター囲い室（ダークスチール枠＋スモークガラス張りの現代JR仕様！）
        const stairCore = new THREE.Mesh(
          new THREE.BoxGeometry(2.35, 3.30, 12.6),
          new THREE.MeshStandardMaterial({
            color: 0x323b44,
            metalness: 0.45,
            roughness: 0.25,
          })
        );
        stairCore.quaternion.copy(q);
        stairCore.position
          .copy(frame.position)
          .addScaledVector(horizRight, centerLat)
          .addScaledVector(WORLD_UP, 2.75);
        stGroup.add(stairCore);

        const stairHeader = new THREE.Mesh(new THREE.BoxGeometry(2.55, 0.36, 12.9), steelBeamMat);
        stairHeader.quaternion.copy(q);
        stairHeader.position
          .copy(frame.position)
          .addScaledVector(horizRight, centerLat)
          .addScaledVector(WORLD_UP, 4.25);
        stGroup.add(stairHeader);

        // ガラス張り待合室（空調付きグリーンガラスルーム + 内部照明 + ベンチ）
        const waitFrame = this.route.getFrameAt(fd + 16);
        const waitRight = new THREE.Vector3().crossVectors(waitFrame.tangent, WORLD_UP).normalize();
        const wq = new THREE.Quaternion().setFromRotationMatrix(
          new THREE.Matrix4().makeBasis(waitRight, WORLD_UP, waitFrame.tangent.clone().negate())
        );

        const waitRoom = new THREE.Mesh(new THREE.BoxGeometry(2.35, 2.55, 6.8), glassRoomMat);
        waitRoom.quaternion.copy(wq);
        waitRoom.position
          .copy(waitFrame.position)
          .addScaledVector(waitRight, centerLat)
          .addScaledVector(WORLD_UP, 2.38);
        stGroup.add(waitRoom);

        const waitFrameRoof = new THREE.Mesh(new THREE.BoxGeometry(2.48, 0.16, 6.95), steelBeamMat);
        waitFrameRoof.quaternion.copy(wq);
        waitFrameRoof.position
          .copy(waitFrame.position)
          .addScaledVector(waitRight, centerLat)
          .addScaledVector(WORLD_UP, 3.68);
        stGroup.add(waitFrameRoof);

        // acure 飲料自動販売機（2台並びで明るく発光！）
        for (const vz of [-4.6, -3.4]) {
          const vmFrame = this.route.getFrameAt(fd + 24 + vz);
          const vmRight = new THREE.Vector3().crossVectors(vmFrame.tangent, WORLD_UP).normalize();
          const vq = new THREE.Quaternion().setFromRotationMatrix(
            new THREE.Matrix4().makeBasis(vmRight, WORLD_UP, vmFrame.tangent.clone().negate())
          );
          const vm = new THREE.Mesh(new THREE.BoxGeometry(0.82, 1.92, 1.05), vendingMat);
          vm.quaternion.copy(vq);
          vm.position
            .copy(vmFrame.position)
            .addScaledVector(vmRight, centerLat)
            .addScaledVector(WORLD_UP, 2.06);
          stGroup.add(vm);
        }
      }

      // ホームベンチ群
      const benchMat = new THREE.MeshStandardMaterial({ color: 0x2b547e, roughness: 0.5 });
      for (let bd = st.platformStart + 35; bd <= st.platformEnd - 25; bd += 34) {
        if (Math.abs(bd - facilityOffsets[0]) < 14 || Math.abs(bd - facilityOffsets[1]) < 14) {
          continue;
        }
        const bf = this.route.getFrameAt(bd);
        const br = new THREE.Vector3().crossVectors(bf.tangent, WORLD_UP).normalize();
        const bq = new THREE.Quaternion().setFromRotationMatrix(
          new THREE.Matrix4().makeBasis(br, WORLD_UP, bf.tangent.clone().negate())
        );
        const bench = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.48, 0.62), benchMat);
        bench.quaternion.copy(bq);
        bench.position
          .copy(bf.position)
          .addScaledVector(br, centerLat)
          .addScaledVector(WORLD_UP, 1.35);
        stGroup.add(bench);
      }

      // 3. 停止目標手前に吊り下がる「運転士用4画面ITVホーム監視モニター」＋「[15] 停止位置目標」＋ ホーム端安全柵！
      {
        const itvFrame = this.route.getFrameAt(st.stopDistance + 5.8);
        const itvRight = new THREE.Vector3().crossVectors(itvFrame.tangent, WORLD_UP).normalize();
        const iq = new THREE.Quaternion().setFromRotationMatrix(
          new THREE.Matrix4().makeBasis(itvRight, WORLD_UP, itvFrame.tangent.clone().negate())
        );
        const itvX = isLeft ? -2.25 : +2.25;

        const itvHousing = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.92, 0.45), steelBeamMat);
        itvHousing.quaternion.copy(iq);
        itvHousing.position
          .copy(itvFrame.position)
          .addScaledVector(itvRight, itvX)
          .addScaledVector(WORLD_UP, 3.45);
        stGroup.add(itvHousing);

        const itvScreen = new THREE.Mesh(new THREE.PlaneGeometry(1.04, 0.78), itvScreenMat);
        itvScreen.quaternion.copy(iq);
        itvScreen.position
          .copy(itvFrame.position)
          .addScaledVector(itvRight, itvX)
          .addScaledVector(WORLD_UP, 3.45)
          .addScaledVector(itvFrame.tangent, -0.24);
        stGroup.add(itvScreen);

        // [15] 停止位置目標
        const stopFrame = this.route.getFrameAt(st.stopDistance + 3.4);
        const horizRight = new THREE.Vector3().crossVectors(stopFrame.tangent, WORLD_UP).normalize();
        const stopX = isLeft ? -1.92 : +1.92;

        const markerGroup = new THREE.Group();
        markerGroup.position.copy(stopFrame.position).addScaledVector(horizRight, stopX);
        markerGroup.quaternion.setFromRotationMatrix(
          new THREE.Matrix4().makeBasis(horizRight, WORLD_UP, stopFrame.tangent.clone().negate())
        );

        const pole = new THREE.Mesh(
          new THREE.CylinderGeometry(0.035, 0.035, 2.25, 8),
          steelBeamMat
        );
        pole.position.y = 1.12;
        markerGroup.add(pole);

        const diamond = new THREE.Mesh(new THREE.PlaneGeometry(0.64, 0.64), stopBoardMat);
        diamond.position.set(0, 2.15, 0.04);
        markerGroup.add(diamond);
        stGroup.add(markerGroup);

        // ホーム先端の黄色い保護柵
        const endFrame = this.route.getFrameAt(st.platformEnd - 0.6);
        const endRight = new THREE.Vector3().crossVectors(endFrame.tangent, WORLD_UP).normalize();
        const eq = new THREE.Quaternion().setFromRotationMatrix(
          new THREE.Matrix4().makeBasis(endRight, WORLD_UP, endFrame.tangent.clone().negate())
        );
        const endFence = new THREE.Mesh(
          new THREE.BoxGeometry(5.2, 1.05, 0.12),
          new THREE.MeshStandardMaterial({ color: 0xd9b326, roughness: 0.5 })
        );
        endFence.quaternion.copy(eq);
        endFence.position
          .copy(endFrame.position)
          .addScaledVector(endRight, centerLat)
          .addScaledVector(WORLD_UP, 1.62);
        stGroup.add(endFence);
      }

      // 三河島・南千住にも高架連絡跨線橋・橋上駅舎ボリュームを追加
      if (st.id === 'mikawashima' || st.id === 'minamisenju') {
        const bridgeD = st.id === 'mikawashima' ? 1140 : 3375;
        const bf = this.route.getFrameAt(bridgeD);
        const br = new THREE.Vector3().crossVectors(bf.tangent, WORLD_UP).normalize();
        const bq = new THREE.Quaternion().setFromRotationMatrix(
          new THREE.Matrix4().makeBasis(br, WORLD_UP, bf.tangent.clone().negate())
        );
        const stationHouse = new THREE.Mesh(
          new THREE.BoxGeometry(20.5, 4.4, 24.0),
          stairWallMat
        );
        stationHouse.quaternion.copy(bq);
        stationHouse.position
          .copy(bf.position)
          .addScaledVector(br, 4.8)
          .addScaledVector(WORLD_UP, 7.6);
        stationHouse.castShadow = true;
        stGroup.add(stationHouse);
      }

      this.group.add(stGroup);
    }
  }

  _addColumns(g, f, r, lats, tangentOffs, topY, mat, size = 1.1) {
    for (const lat of lats) {
      for (const t of tangentOffs) {
        const h = topY + 0.6;
        const col = new THREE.Mesh(new THREE.BoxGeometry(size, h, size), mat);
        col.position.copy(f.position).addScaledVector(r, lat).addScaledVector(f.tangent, t);
        col.position.y = f.position.y - 0.6 + h * 0.5;
        col.castShadow = true;
        g.add(col);
      }
    }
  }

  _buildPlatformDeckAndCanopy(
    st,
    parentGroup,
    topMat,
    sideMat,
    roofMat,
    roofUndersideMat,
    steelBeamMat,
    ledMat
  ) {
    const step = 3.0;
    const sampleCount = Math.floor((st.platformEnd - st.platformStart) / step) + 1;
    const isLeft = st.platformSide === 'left';
    const platHeight = 1.10;

    const topPos = [];
    const topUv = [];
    const topIdx = [];
    const sidePos = [];
    const sideUv = [];
    const sideIdx = [];

    for (let i = 0; i < sampleCount; i++) {
      const d = Math.min(st.platformEnd, st.platformStart + i * step);
      const frame = this.route.getFrameAt(d);
      const horizRight = new THREE.Vector3().crossVectors(frame.tangent, WORLD_UP).normalize();

      if (isLeft) {
        const xInner = -1.62;
        const xOuter = -7.6;
        topPos.push(
          frame.position.x + horizRight.x * xInner,
          frame.position.y + platHeight,
          frame.position.z + horizRight.z * xInner,
          frame.position.x + horizRight.x * xOuter,
          frame.position.y + platHeight,
          frame.position.z + horizRight.z * xOuter
        );
        topUv.push(0.0, d * 0.22, 1.0, d * 0.22);

        if (i < sampleCount - 1) {
          const r0 = i * 2;
          const r1 = r0 + 2;
          topIdx.push(r0, r1, r0 + 1, r0 + 1, r1, r1 + 1);
        }

        sidePos.push(
          frame.position.x + horizRight.x * xInner,
          frame.position.y + platHeight,
          frame.position.z + horizRight.z * xInner,
          frame.position.x + horizRight.x * xInner,
          frame.position.y - 0.3,
          frame.position.z + horizRight.z * xInner
        );
        sideUv.push(d * 0.2, 1.0, d * 0.2, 0.0);
        if (i < sampleCount - 1) {
          const s0 = i * 2;
          const s1 = s0 + 2;
          sideIdx.push(s0, s0 + 1, s1, s0 + 1, s1 + 1, s1);
        }
      } else {
        // 島式ホーム（日暮里3・4番線、三河島1・2番線、南千住1・2番線）
        const upOffset = this.route.getUpTrackOffset(d);
        const xDownEdge = 1.62;
        const xUpEdge = Math.max(5.2, upOffset - 1.62);
        const xMid = (xDownEdge + xUpEdge) * 0.5;

        const xs = [xDownEdge, xMid, xUpEdge];
        const us = [0.0, 0.85, 0.0];

        for (let k = 0; k < 3; k++) {
          topPos.push(
            frame.position.x + horizRight.x * xs[k],
            frame.position.y + platHeight,
            frame.position.z + horizRight.z * xs[k]
          );
          topUv.push(us[k], d * 0.22);
        }

        if (i < sampleCount - 1) {
          const r0 = i * 3;
          const r1 = r0 + 3;
          topIdx.push(r0, r0 + 1, r1, r0 + 1, r1 + 1, r1);
          topIdx.push(r0 + 1, r0 + 2, r1 + 1, r0 + 2, r1 + 2, r1 + 1);
        }

        sidePos.push(
          frame.position.x + horizRight.x * xDownEdge,
          frame.position.y + platHeight,
          frame.position.z + horizRight.z * xDownEdge,
          frame.position.x + horizRight.x * xDownEdge,
          frame.position.y - 0.3,
          frame.position.z + horizRight.z * xDownEdge
        );
        sideUv.push(d * 0.2, 1.0, d * 0.2, 0.0);
        if (i < sampleCount - 1) {
          const s0 = i * 2;
          const s1 = s0 + 2;
          sideIdx.push(s0, s1, s0 + 1, s0 + 1, s1, s1 + 1);
        }
      }
    }

    const topGeo = new THREE.BufferGeometry();
    topGeo.setAttribute('position', new THREE.Float32BufferAttribute(topPos, 3));
    topGeo.setAttribute('uv', new THREE.Float32BufferAttribute(topUv, 2));
    topGeo.setIndex(topIdx);
    topGeo.computeVertexNormals();
    const topMesh = new THREE.Mesh(topGeo, topMat);
    topMesh.receiveShadow = true;
    parentGroup.add(topMesh);

    const sideGeo = new THREE.BufferGeometry();
    sideGeo.setAttribute('position', new THREE.Float32BufferAttribute(sidePos, 3));
    sideGeo.setAttribute('uv', new THREE.Float32BufferAttribute(sideUv, 2));
    sideGeo.setIndex(sideIdx);
    sideGeo.computeVertexNormals();
    topMat.side = THREE.DoubleSide;
    sideMat.side = THREE.DoubleSide;
    parentGroup.add(new THREE.Mesh(sideGeo, sideMat));

    // 閉じた中実ホーム：外縁壁・基礎スカート・両端キャップ・底面
    {
      const n = isLeft ? 2 : 3;
      const rows = sampleCount;
      const skirtY = -1.6;
      const wp = [];
      const wi = [];
      const wuv = [];
      const V = (r, k) => [topPos[(r * n + k) * 3], topPos[(r * n + k) * 3 + 1], topPos[(r * n + k) * 3 + 2]];
      const quad = (a, b, c, d2) => {
        const base = wp.length / 3;
        for (const p of [a, b, c, d2]) {
          wp.push(p[0], p[1], p[2]);
          wuv.push(p[0] * 0.2, p[1] * 0.2);
        }
        wi.push(base, base + 1, base + 2, base, base + 2, base + 3);
      };
      const low = (p) => [p[0], p[1] - platHeight + skirtY, p[2]];
      for (let r = 0; r < rows - 1; r++) {
        for (const k of [0, n - 1]) {
          const a = V(r, k);
          const b = V(r + 1, k);
          quad(a, b, low(b), low(a));
        }
        // 底面
        const a0 = V(r, 0), a1 = V(r + 1, 0), b0 = V(r, n - 1), b1 = V(r + 1, n - 1);
        quad(low(a0), low(a1), low(b1), low(b0));
      }
      for (const r of [0, rows - 1]) {
        const a = V(r, 0);
        const b = V(r, n - 1);
        quad(a, b, low(b), low(a));
      }
      const wg = new THREE.BufferGeometry();
      wg.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3));
      wg.setAttribute('uv', new THREE.Float32BufferAttribute(wuv, 2));
      wg.setIndex(wi);
      wg.computeVertexNormals();
      const wallMesh = new THREE.Mesh(wg, sideMat);
      wallMesh.receiveShadow = true;
      parentGroup.add(wallMesh);
    }

    // ホーム上屋（鉄骨H鋼梁＋折板屋根＋スピーカー＋LED連続照明）
    const roofLen = (st.platformEnd - st.platformStart) * st.roofRatio;
    const roofStart = st.platformEnd - roofLen;
    const roofStep = 8.5;
    const pillarGeo = new THREE.BoxGeometry(0.28, 3.65, 0.28);
    const crossBeamGeo = new THREE.BoxGeometry(6.6, 0.24, 0.26);
    const roofSegGeo = new THREE.BoxGeometry(6.75, 0.18, roofStep + 0.18);
    const roofUnderGeo = new THREE.PlaneGeometry(6.5, roofStep + 0.15);
    roofUnderGeo.rotateX(Math.PI / 2);
    const ledGeo = new THREE.BoxGeometry(0.14, 0.06, 3.4);

    for (let d = roofStart; d <= st.platformEnd - 3; d += roofStep) {
      const frame = this.route.getFrameAt(d);
      const horizRight = new THREE.Vector3().crossVectors(frame.tangent, WORLD_UP).normalize();
      const centerLat = isLeft ? -4.55 : +4.80;

      const basis = new THREE.Matrix4().makeBasis(
        horizRight,
        WORLD_UP,
        frame.tangent.clone().negate()
      );
      const q = new THREE.Quaternion().setFromRotationMatrix(basis);

      // H鋼支柱（Y字ブレース感）
      const pillar = new THREE.Mesh(pillarGeo, steelBeamMat);
      pillar.quaternion.copy(q);
      pillar.position
        .copy(frame.position)
        .addScaledVector(horizRight, centerLat)
        .addScaledVector(WORLD_UP, platHeight + 1.82);
      pillar.castShadow = true;
      parentGroup.add(pillar);

      // 屋根裏の鉄骨横梁リブ（これがあるだけで天井の情報量が劇的に向上！）
      const crossBeam = new THREE.Mesh(crossBeamGeo, steelBeamMat);
      crossBeam.quaternion.copy(q);
      crossBeam.position
        .copy(frame.position)
        .addScaledVector(horizRight, centerLat)
        .addScaledVector(WORLD_UP, platHeight + 3.48);
      parentGroup.add(crossBeam);

      const roof = new THREE.Mesh(roofSegGeo, roofMat);
      roof.quaternion.copy(q);
      roof.position
        .copy(frame.position)
        .addScaledVector(horizRight, centerLat)
        .addScaledVector(WORLD_UP, platHeight + 3.68);
      roof.castShadow = true;
      parentGroup.add(roof);

      const roofUnder = new THREE.Mesh(roofUnderGeo, roofUndersideMat);
      roofUnder.quaternion.copy(q);
      roofUnder.position
        .copy(frame.position)
        .addScaledVector(horizRight, centerLat)
        .addScaledVector(WORLD_UP, platHeight + 3.57);
      parentGroup.add(roofUnder);

      for (const lx of [centerLat - 1.9, centerLat + 1.9]) {
        const led = new THREE.Mesh(ledGeo, ledMat);
        led.quaternion.copy(q);
        led.position
          .copy(frame.position)
          .addScaledVector(horizRight, lx)
          .addScaledVector(WORLD_UP, platHeight + 3.48);
        parentGroup.add(led);
      }
    }
  }

  /**
   * 日暮里駅（JJ02）の実物14線メガコリドー複合構内：
   * - 東側 (+17.2m)：京成本線 2層高架駅舎 ＆ 駅前超高層「ステーションガーデンタワー」
   * - 中央東 (0m, +9.6m)：常磐線 3・4番線ホーム
   * - 中央 (-4.6m .. -16.6m)：東北本線（宇都宮・高崎線）＆ 尾久回送線 4線（欠番の5〜8番線相当）
   * - 中央西 (-22.2m, -26.4m)：東北・上越・北陸新幹線「第1上野トンネル日暮里抗口」＋ U字擁壁急勾配アプローチ ＋ 白壁新幹線高架橋！
   * - 西側 (-32.2m .. -53.6m)：京浜東北線・山手線 方向別複々線（9・10番線、11・12番線 島式ホーム2面4線）
   * - 最西端 (-68m)：谷中霊園・夕やけだんだん方面の樹林崖線
   * - 頭上：エキュート日暮里 北改札橋上駅舎 (d=-38m) ＆ トレインミュージアム「下御隠殿橋」(d=+18m) ＆ 舎人ライナー (d=+35m)
   */
  _buildNipporiComplex() {
    const g = new THREE.Group();
    const concreteMat = new THREE.MeshStandardMaterial({
      color: 0x767a80,
      map: this.textures.concrete.map,
      roughness: 0.85,
    });
    const shinkansenWallMat = new THREE.MeshStandardMaterial({
      color: 0xdbe0e6, // 東北新幹線特有の明るいアイボリーホワイト防音高架側壁！
      map: this.textures.concrete.map,
      roughness: 0.68,
      metalness: 0.06,
    });
    const steelMat = new THREE.MeshStandardMaterial({
      color: 0x434b54,
      metalness: 0.6,
      roughness: 0.45,
    });
    const concourseMat = new THREE.MeshStandardMaterial({
      color: 0xd4dae0,
      roughness: 0.52,
      metalness: 0.22,
    });
    const platTopMat = new THREE.MeshStandardMaterial({
      map: this.textures.platformTop,
      roughness: 0.82,
      metalness: 0.06,
    });
    const ledMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.3, 2.28, 2.1) });

    // 1. 常磐線4番線↔東北本線5番線相当の間の防護柵 (x = -2.28m) ＆ 東北本線8番線相当↔新幹線掘割の防護柵 (x = -19.1m)
    for (let d = -215; d <= 165; d += 12) {
      const pt = this.route.getNipporiParallelPoint(d, 0);
      const q = new THREE.Quaternion().setFromRotationMatrix(
        new THREE.Matrix4().makeBasis(pt.right, WORLD_UP, pt.tangent.clone().negate())
      );

      if (d <= 85) {
        const fenceEast = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.15, 11.8), steelMat);
        fenceEast.quaternion.copy(q);
        fenceEast.position
          .copy(pt.position)
          .addScaledVector(pt.right, -2.28)
          .addScaledVector(WORLD_UP, 0.35);
        g.add(fenceEast);
      }

      const fenceWest = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.25, 11.8), steelMat);
      fenceWest.quaternion.copy(q);
      fenceWest.position
        .copy(pt.position)
        .addScaledVector(pt.right, -19.15)
        .addScaledVector(WORLD_UP, 0.42);
      g.add(fenceWest);
    }

    // 2. 東北・上越・北陸新幹線「第1上野トンネル日暮里抗口 (d=+28m) 〜 U字擁壁アプローチ 〜 白壁高架橋 (d=+460m)」！
    {
      // (a) d = -225m .. +28m：地下トンネル天井スラブ（日暮里駅構内および下御隠殿橋の下はまだ地下トンネル内！）
      for (let d = -215; d <= 20; d += 20) {
        const pt = this.route.getNipporiParallelPoint(d, -24.3);
        const q = new THREE.Quaternion().setFromRotationMatrix(
          new THREE.Matrix4().makeBasis(pt.right, WORLD_UP, pt.tangent.clone().negate())
        );
        const roofCap = new THREE.Mesh(new THREE.BoxGeometry(9.8, 0.65, 20.4), concreteMat);
        roofCap.quaternion.copy(q);
        roofCap.position.copy(pt.position).addScaledVector(WORLD_UP, -0.55);
        roofCap.receiveShadow = true;
        g.add(roofCap);
      }

      // (b) d = +28m：第1上野トンネル コンクリート抗口ポータル壁 ＋ 上下線2連ブラックトンネル開口部！
      const portalPt = this.route.getNipporiParallelPoint(28, -24.3);
      const portalQ = new THREE.Quaternion().setFromRotationMatrix(
        new THREE.Matrix4().makeBasis(portalPt.right, WORLD_UP, portalPt.tangent.clone().negate())
      );

      // 抗口上部ヘッドウォール胸壁
      const headWall = new THREE.Mesh(new THREE.BoxGeometry(10.0, 2.35, 2.6), concreteMat);
      headWall.quaternion.copy(portalQ);
      headWall.position.copy(portalPt.position).addScaledVector(WORLD_UP, 0.15);
      headWall.castShadow = true;
      g.add(headWall);

      // トンネル内部の暗闇ボックス（車両が暗闇から自然に飛び出してくる奥行き構造！）
      const darkVoidMat = new THREE.MeshBasicMaterial({ color: 0x050608 });
      for (const boreOff of [2.1, -2.1]) {
        const bore = new THREE.Mesh(new THREE.BoxGeometry(3.75, 4.9, 24.0), darkVoidMat);
        bore.quaternion.copy(portalQ);
        bore.position
          .copy(portalPt.position)
          .addScaledVector(portalPt.right, boreOff)
          .addScaledVector(portalPt.tangent, -11.5)
          .addScaledVector(WORLD_UP, -2.55);
        g.add(bore);
      }
      // 上下線を仕切る中央ピラー
      const centerPier = new THREE.Mesh(new THREE.BoxGeometry(0.65, 5.2, 3.0), concreteMat);
      centerPier.quaternion.copy(portalQ);
      centerPier.position.copy(portalPt.position).addScaledVector(WORLD_UP, -2.5);
      g.add(centerPier);

      // (c) d = +28m .. +168m：地下から地上・高架へ駆け上がるコンクリートの「U字擁壁アプローチ」側壁！
      for (let d = 34; d <= 168; d += 12) {
        const surfPt = this.route.getNipporiParallelPoint(d, -24.3);
        const shY = this.route.getNipporiShinkansenOffsetY(d);
        const q = new THREE.Quaternion().setFromRotationMatrix(
          new THREE.Matrix4().makeBasis(surfPt.right, WORLD_UP, surfPt.tangent.clone().negate())
        );

        const wallBottom = shY - 0.8;
        const wallTop = Math.max(1.35, shY + 1.95);
        const wallH = wallTop - wallBottom;
        const wallMidY = (wallBottom + wallTop) * 0.5;

        for (const sideX of [-4.65, 4.65]) {
          const rWall = new THREE.Mesh(new THREE.BoxGeometry(0.55, wallH, 12.4), concreteMat);
          rWall.quaternion.copy(q);
          rWall.position
            .copy(surfPt.position)
            .addScaledVector(surfPt.right, sideX)
            .addScaledVector(WORLD_UP, wallMidY);
          rWall.castShadow = true;
          rWall.receiveShadow = true;
          g.add(rWall);
        }
      }

      // (d) d = +168m .. +460m：在来線を見下ろす「東北新幹線 ホワイト防音壁付き高架橋＆ラーメン橋脚」！
      for (let d = 174; d <= 456; d += 14) {
        const shPt = this.route.getNipporiShinkansenPoint(d, -24.3);
        const q = new THREE.Quaternion().setFromRotationMatrix(
          new THREE.Matrix4().makeBasis(shPt.right, shPt.up, shPt.tangent.clone().negate())
        );

        // 高架桁ボリューム
        const girder = new THREE.Mesh(new THREE.BoxGeometry(9.2, 1.35, 14.3), concreteMat);
        girder.quaternion.copy(q);
        girder.position.copy(shPt.position).addScaledVector(shPt.up, -0.95);
        girder.castShadow = true;
        g.add(girder);

        // 左右の白い新幹線防音パラペット壁
        for (const sideX of [-4.45, 4.45]) {
          const soundWall = new THREE.Mesh(
            new THREE.BoxGeometry(0.38, 2.15, 14.3),
            shinkansenWallMat
          );
          soundWall.quaternion.copy(q);
          soundWall.position
            .copy(shPt.position)
            .addScaledVector(shPt.right, sideX)
            .addScaledVector(shPt.up, 0.85);
          soundWall.castShadow = true;
          g.add(soundWall);
        }

        // 28mごとの新幹線高架橋脚
        if (true) {
          const pierH = Math.max(2.0, shPt.position.y - 1.4);
          for (const px of [-3.6, 3.6]) {
            const pier = new THREE.Mesh(new THREE.BoxGeometry(0.95, pierH, 1.15), concreteMat);
            pier.position.copy(shPt.position).addScaledVector(shPt.right, px);
            pier.position.y = pierH * 0.5;
            pier.rotation.y = Math.atan2(shPt.tangent.x, shPt.tangent.z);
            g.add(pier);
          }
        }
      }
    }

    // 3. 西側に並ぶ京浜東北・山手線 島式ホーム2面4線（9・10番線 x=-36.5m、11・12番線 x=-49.3m）
    const parallelPlatforms = [
      { x: -36.5, bandCol: 0x00a3e0 }, // 9番線(京浜東北)・10番線(山手外回り)
      { x: -49.3, bandCol: 0x82c442 }, // 11番線(山手内回り)・12番線(京浜東北)
    ];
    for (const pInfo of parallelPlatforms) {
      const bandMat = new THREE.MeshStandardMaterial({
        color: pInfo.bandCol,
        emissive: new THREE.Color(pInfo.bandCol),
        emissiveIntensity: 0.35,
        roughness: 0.35,
      });

      for (let d = -210; d <= 18; d += 16) {
        const pt = this.route.getNipporiParallelPoint(d, pInfo.x);
        const q = new THREE.Quaternion().setFromRotationMatrix(
          new THREE.Matrix4().makeBasis(pt.right, WORLD_UP, pt.tangent.clone().negate())
        );

        const deck = new THREE.Mesh(new THREE.BoxGeometry(5.36, 3.2, 16.15), concreteMat);
        deck.quaternion.copy(q);
        deck.position.copy(pt.position).addScaledVector(WORLD_UP, -0.5);
        g.add(deck);

        platTopMat.side = THREE.DoubleSide;
        const topSurf = new THREE.Mesh(new THREE.PlaneGeometry(5.34, 16.15), platTopMat);
        topSurf.rotation.x = -Math.PI / 2;
        const topHolder = new THREE.Group();
        topHolder.quaternion.copy(q);
        topHolder.position.copy(pt.position).addScaledVector(WORLD_UP, 1.11);
        topHolder.add(topSurf);
        g.add(topHolder);

        const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.28, 3.5, 0.28), steelMat);
        pillar.quaternion.copy(q);
        pillar.position.copy(pt.position).addScaledVector(WORLD_UP, 2.85);
        g.add(pillar);

        const roof = new THREE.Mesh(new THREE.BoxGeometry(5.75, 0.22, 16.2), steelMat);
        roof.quaternion.copy(q);
        roof.position.copy(pt.position).addScaledVector(WORLD_UP, 4.62);
        g.add(roof);

        const led = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, 6.0), ledMat);
        led.quaternion.copy(q);
        led.position.copy(pt.position).addScaledVector(WORLD_UP, 4.46);
        g.add(led);

        // 路線カラー入り吊り下げ駅名標アクセント
        if (Math.abs(d) % 32 === 0) {
          const sign = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.58, 0.12), bandMat);
          sign.quaternion.copy(q);
          sign.position.copy(pt.position).addScaledVector(WORLD_UP, 3.45);
          g.add(sign);
        }
      }
    }

    // 4. 日暮里駅 北改札・エキュート日暮里 橋上駅舎コンコース（d = -38m：東口京成〜12番線西口まで全14線を横断！）
    {
      const f = this.route.getFrameAt(-38);
      const r = new THREE.Vector3().crossVectors(f.tangent, WORLD_UP).normalize();
      const q = new THREE.Quaternion().setFromRotationMatrix(
        new THREE.Matrix4().makeBasis(r, WORLD_UP, f.tangent.clone().negate())
      );
      const concourse = new THREE.Mesh(new THREE.BoxGeometry(78, 5.8, 36), concourseMat);
      concourse.quaternion.copy(q);
      concourse.position
        .copy(f.position)
        .addScaledVector(r, -21.0)
        .addScaledVector(WORLD_UP, 9.4);
      concourse.castShadow = true;
      g.add(concourse);
      this._addColumns(g, f, r, [4.8, -2.3, -6.5, -10.6, -14.7, -19.1, -24.3, -29, -36.5, -42.9, -49.3, -57], [-12, 12], 6.5, concreteMat, 1.0);
    }

    // 5. 日暮里北端の名所「下御隠殿橋（トレインミュージアム跨線道路橋）」(d = +18m で全線を跨ぐ！)
    {
      const pt = this.route.getNipporiParallelPoint(18, -21.5);
      const q = new THREE.Quaternion().setFromRotationMatrix(
        new THREE.Matrix4().makeBasis(pt.right, WORLD_UP, pt.tangent.clone().negate())
      );
      const bridgeDeck = new THREE.Mesh(new THREE.BoxGeometry(78, 1.15, 9.5), concreteMat);
      bridgeDeck.quaternion.copy(q);
      bridgeDeck.position.copy(pt.position).addScaledVector(WORLD_UP, 7.65);
      bridgeDeck.castShadow = true;
      g.add(bridgeDeck);

      const railFence = new THREE.Mesh(new THREE.BoxGeometry(78, 1.25, 9.9), steelMat);
      railFence.quaternion.copy(q);
      railFence.position.copy(pt.position).addScaledVector(WORLD_UP, 8.65);
      g.add(railFence);
      const bf = this.route.getFrameAt(18);
      const br = new THREE.Vector3().crossVectors(bf.tangent, WORLD_UP).normalize();
      this._addColumns(g, bf, br, [4.8, -2.3, -6.5, -10.6, -14.7, -19.1, -24.3, -29, -36.5, -42.9, -49.3, -57], [-3.6, 3.6], 7.1, concreteMat, 0.9);
    }

    // 6. 東側（右手 x = +17.2m）：京成本線 日暮里駅の2層高架ホーム駅舎（スカイライナー発着駅）
    {
      const f = this.route.getFrameAt(-55);
      const r = new THREE.Vector3().crossVectors(f.tangent, WORLD_UP).normalize();
      const q = new THREE.Quaternion().setFromRotationMatrix(
        new THREE.Matrix4().makeBasis(r, WORLD_UP, f.tangent.clone().negate())
      );
      const keiseiStation = new THREE.Mesh(new THREE.BoxGeometry(10.5, 13.5, 165), concourseMat);
      keiseiStation.quaternion.copy(q);
      keiseiStation.position
        .copy(f.position)
        .addScaledVector(r, 17.2)
        .addScaledVector(WORLD_UP, 5.2);
      g.add(keiseiStation);

      const blueBand = new THREE.Mesh(
        new THREE.BoxGeometry(10.7, 0.85, 165.2),
        new THREE.MeshStandardMaterial({ color: 0x005bac, roughness: 0.4 })
      );
      blueBand.quaternion.copy(q);
      blueBand.position
        .copy(f.position)
        .addScaledVector(r, 17.2)
        .addScaledVector(WORLD_UP, 8.8);
      g.add(blueBand);
    }

    // 7. 日暮里・舎人ライナーの高架駅＆高層ガイドウェイ (d = +35m で東口から北西へ高くオーバークロス！)
    {
      const f = this.route.getFrameAt(LANDMARKS.toneriLinerOverpass);
      const r = new THREE.Vector3().crossVectors(f.tangent, WORLD_UP).normalize();
      const q = new THREE.Quaternion().setFromRotationMatrix(
        new THREE.Matrix4().makeBasis(r, WORLD_UP, f.tangent.clone().negate())
      );
      const toneriBeam = new THREE.Mesh(new THREE.BoxGeometry(115, 1.9, 6.2), concreteMat);
      toneriBeam.quaternion.copy(q);
      toneriBeam.rotateY(0.28);
      toneriBeam.position
        .copy(f.position)
        .addScaledVector(r, -16)
        .addScaledVector(WORLD_UP, 13.5);
      toneriBeam.castShadow = true;
      g.add(toneriBeam);
      for (const along of [-50, -25, 0, 25, 50]) {
        const col = new THREE.Mesh(new THREE.BoxGeometry(1.8, 14, 1.8), concreteMat);
        col.position
          .copy(f.position)
          .addScaledVector(r, -16 + along * Math.cos(0.28))
          .addScaledVector(f.tangent, along * Math.sin(0.28) * -1);
        col.position.y = 6.5;
        g.add(col);
      }
    }

    // 8. 西端（12番線のさらに外側 x = -72m）：「谷中霊園・御殿坂（夕やけだんだん方面）」の樹林崖線シルエット
    const foliageMat = new THREE.MeshStandardMaterial({
      color: 0x263828,
      roughness: 0.92,
    });
    for (let d = -190; d <= 260; d += 26) {
      const pt = this.route.getNipporiParallelPoint(d, -72);
      const hill = new THREE.Mesh(new THREE.SphereGeometry(18, 10, 8), foliageMat);
      hill.scale.set(1.35, 0.82, 1.4);
      hill.position.copy(pt.position).addScaledVector(WORLD_UP, 2.8);
      g.add(hill);
    }

    // 9. 日暮里東口ランドマーク「ステーションガーデンタワー（商業基壇部＋40階建てタワー＋屋上塔屋クラウン）」
    {
      const f = this.route.getFrameAt(25);
      const r = new THREE.Vector3().crossVectors(f.tangent, WORLD_UP).normalize();
      const q = new THREE.Quaternion().setFromRotationMatrix(
        new THREE.Matrix4().makeBasis(r, WORLD_UP, f.tangent.clone().negate())
      );
      const towerGeo = mergeBufferGeos([
        createCleanRoofBoxGeo(40, 22, 42, 0, 11, 0, { uRepeatX: 2, uRepeatZ: 2, vMin: 0.0, vMax: 0.32 }),
        createCleanRoofBoxGeo(30, 108, 32, 0, 76, 0, { uRepeatX: 2, uRepeatZ: 2, vMin: 0.12, vMax: 0.895 }),
        createCleanRoofBoxGeo(22, 9, 24, 0, 134.5, 0, { vMin: 0.80, vMax: 0.905 }),
      ]);
      const tower = new THREE.Mesh(towerGeo, this._getOrCreateBuildingMaterial(3));
      tower.quaternion.copy(q);
      tower.position.copy(f.position).addScaledVector(r, 50);
      tower.position.y = 0;
      g.add(tower);

      const bMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 0.12, 0.08) });
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 8), bMat);
      beacon.position.set(tower.position.x, 140.4, tower.position.z);
      g.add(beacon);
      this.obstructionLights.push({ mat: bMat, phase: 0.5 });

      const subGeo = mergeBufferGeos([
        createCleanRoofBoxGeo(32, 18, 34, 0, 9, 0, { uRepeatX: 2, uRepeatZ: 2, vMin: 0.0, vMax: 0.30 }),
        createCleanRoofBoxGeo(25, 76, 27, 0, 56, 0, { uRepeatX: 2, uRepeatZ: 2, vMin: 0.12, vMax: 0.895 }),
        createCleanRoofBoxGeo(14, 6, 16, 0, 97, 0, { vMin: 0.82, vMax: 0.905 }),
      ]);
      const subTower = new THREE.Mesh(subGeo, this._getOrCreateBuildingMaterial(2));
      subTower.quaternion.copy(q);
      subTower.position.copy(f.position).addScaledVector(r, 48).addScaledVector(f.tangent, 48);
      subTower.position.y = 0;
      g.add(subTower);
    }

    this.group.add(g);
  }

  /**
   * 北千住駅（JJ05）の実物 2面3線＋巨大複合ターミナル構造：
   * - 左：1番線単式ホーム（_buildStations で生成済み）
   * - 中央 (+4.25m)：2番線（中線・待避線）＋ 停車中のE531系待避列車！
   * - その右 (+5.88m .. +12.38m)：2・3番線 大型島式ホーム（屋根・ATOS発車標・階段室完備）！
   * - その右 (+14.0m)：3番線（上り本線）
   * - 東側 (+26m)：東京メトロ日比谷線・東武スカイツリーライン 地上14.4m 3階建て高架ホーム駅舎！
   * - 西側 (-26m)：ルミネ北千住 ＆ 北千住マルイ（0101赤丸アクセント付き大型商業ビル）！
   */
  _buildKitaSenjuComplex() {
    const st = STATIONS.find((s) => s.id === 'kitasenju');
    if (!st) return;

    const g = new THREE.Group();
    const topMat = new THREE.MeshStandardMaterial({
      map: this.textures.platformTop,
      roughness: 0.82,
      metalness: 0.06,
    });
    const sideMat = new THREE.MeshStandardMaterial({
      color: 0x6d7073,
      map: this.textures.concrete.map,
      roughness: 0.88,
    });
    const roofMat = new THREE.MeshStandardMaterial({
      color: 0x383e45,
      metalness: 0.58,
      roughness: 0.46,
    });
    const steelMat = new THREE.MeshStandardMaterial({
      color: 0x454d56,
      metalness: 0.65,
      roughness: 0.4,
    });
    const ledMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 2.38, 2.2) });

    // 1. 2・3番線 島式ホーム（中線2番線 x=+4.25m と 上り3番線 x=+14.0m の間に位置: x = +5.87m .. +12.38m）
    const step = 4.0;
    const count = Math.floor((st.platformEnd - st.platformStart) / step) + 1;
    const topPos = [];
    const topUv = [];
    const topIdx = [];
    const sidePos = [];
    const sideUv = [];
    const sideIdx = [];

    for (let i = 0; i < count; i++) {
      const d = Math.min(st.platformEnd, st.platformStart + i * step);
      const f = this.route.getFrameAt(d);
      const r = new THREE.Vector3().crossVectors(f.tangent, WORLD_UP).normalize();

      const xLeftEdge = 5.87;  // 2番線（中線）側エッジ
      const xRightEdge = 12.38; // 3番線（上り本線）側エッジ
      const xMid = (xLeftEdge + xRightEdge) * 0.5;
      const xs = [xLeftEdge, xMid, xRightEdge];
      const us = [0.0, 0.88, 0.0];

      for (let k = 0; k < 3; k++) {
        topPos.push(
          f.position.x + r.x * xs[k],
          f.position.y + 1.10,
          f.position.z + r.z * xs[k]
        );
        topUv.push(us[k], d * 0.22);
      }

      if (i < count - 1) {
        const r0 = i * 3;
        const r1 = r0 + 3;
        topIdx.push(r0, r0 + 1, r1, r0 + 1, r1 + 1, r1);
        topIdx.push(r0 + 1, r0 + 2, r1 + 1, r0 + 2, r1 + 2, r1 + 1);
      }

      sidePos.push(
        f.position.x + r.x * xLeftEdge,
        f.position.y + 1.10,
        f.position.z + r.z * xLeftEdge,
        f.position.x + r.x * xLeftEdge,
        f.position.y - 0.3,
        f.position.z + r.z * xLeftEdge
      );
      sideUv.push(d * 0.2, 1.0, d * 0.2, 0.0);
      if (i < count - 1) {
        const s0 = i * 2;
        const s1 = s0 + 2;
        sideIdx.push(s0, s1, s0 + 1, s0 + 1, s1, s1 + 1);
      }
    }

    const tGeo = new THREE.BufferGeometry();
    tGeo.setAttribute('position', new THREE.Float32BufferAttribute(topPos, 3));
    tGeo.setAttribute('uv', new THREE.Float32BufferAttribute(topUv, 2));
    tGeo.setIndex(topIdx);
    tGeo.computeVertexNormals();
    g.add(new THREE.Mesh(tGeo, topMat));

    const sGeo = new THREE.BufferGeometry();
    sGeo.setAttribute('position', new THREE.Float32BufferAttribute(sidePos, 3));
    sGeo.setAttribute('uv', new THREE.Float32BufferAttribute(sideUv, 2));
    sGeo.setIndex(sideIdx);
    sGeo.computeVertexNormals();
    g.add(new THREE.Mesh(sGeo, sideMat));

    // 2・3番線島式ホームの上屋・支柱・LED照明
    for (let d = st.platformStart + 8; d <= st.platformEnd - 6; d += 9.5) {
      const f = this.route.getFrameAt(d);
      const r = new THREE.Vector3().crossVectors(f.tangent, WORLD_UP).normalize();
      const q = new THREE.Quaternion().setFromRotationMatrix(
        new THREE.Matrix4().makeBasis(r, WORLD_UP, f.tangent.clone().negate())
      );

      const pil = new THREE.Mesh(new THREE.BoxGeometry(0.28, 3.6, 0.28), steelMat);
      pil.quaternion.copy(q);
      pil.position.copy(f.position).addScaledVector(r, 9.1).addScaledVector(WORLD_UP, 2.9);
      g.add(pil);

      const roof = new THREE.Mesh(new THREE.BoxGeometry(6.9, 0.2, 9.7), roofMat);
      roof.quaternion.copy(q);
      roof.position.copy(f.position).addScaledVector(r, 9.1).addScaledVector(WORLD_UP, 4.75);
      g.add(roof);

      const led = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.06, 3.5), ledMat);
      led.quaternion.copy(q);
      led.position.copy(f.position).addScaledVector(r, 7.1).addScaledVector(WORLD_UP, 4.6);
      g.add(led);
    }

    // 2. 北千住 2番線（中線・待避線）に停車中の E531系 10両編成！（2面3線の実在感が圧倒的に際立つ！）
    const parkedCars = this.rollingStock.createConsist(g, {
      series: 'E531',
      cars: 10,
      headlightsOn: false, // 下り待避中（手前が最後尾＝赤色テールライト点灯！）
    });
    const basis = new THREE.Matrix4();
    for (let c = 0; c < parkedCars.length; c++) {
      const carD = 5195 - c * 20.0;
      const down = this.route.getFrameAt(carD);
      const r = new THREE.Vector3().crossVectors(down.tangent, WORLD_UP).normalize();
      const midOff = this.route.getKitaSenjuMiddleTrackOffset(carD) ?? 4.25;
      parkedCars[c].position.copy(down.position).addScaledVector(r, midOff);
      basis.makeBasis(r, WORLD_UP, down.tangent.clone().negate());
      parkedCars[c].quaternion.setFromRotationMatrix(basis);
    }

    // 3. 北千住 南改札・北改札の2大橋上コンコース ＆ 西口「ルミネ北千住」「北千住マルイ」
    for (const cd of [5045, 5175]) {
      const cf = this.route.getFrameAt(cd);
      const cr = new THREE.Vector3().crossVectors(cf.tangent, WORLD_UP).normalize();
      const cq = new THREE.Quaternion().setFromRotationMatrix(
        new THREE.Matrix4().makeBasis(cr, WORLD_UP, cf.tangent.clone().negate())
      );
      const bridge = new THREE.Mesh(
        new THREE.BoxGeometry(44, 6.2, 42),
        new THREE.MeshStandardMaterial({ color: 0x3b434d, roughness: 0.52, metalness: 0.4 })
      );
      bridge.quaternion.copy(cq);
      bridge.position.copy(cf.position).addScaledVector(cr, 7.0).addScaledVector(WORLD_UP, 9.5);
      bridge.castShadow = true;
      g.add(bridge);
    }

    // 西口：ルミネ北千住 + 北千住マルイ（ミルディスI番館）
    {
      const kf = this.route.getFrameAt(5140);
      const kr = new THREE.Vector3().crossVectors(kf.tangent, WORLD_UP).normalize();
      const kq = new THREE.Quaternion().setFromRotationMatrix(
        new THREE.Matrix4().makeBasis(kr, WORLD_UP, kf.tangent.clone().negate())
      );

      const lumineGeo = mergeBufferGeos([
        createCleanRoofBoxGeo(26, 38, 108, 0, 19, 0, { uRepeatX: 1, uRepeatZ: 4, vMin: 0.0, vMax: 0.895 }),
        createCleanRoofBoxGeo(18, 5.5, 42, -2, 40.75, -14, { uRepeatX: 1, uRepeatZ: 2, vMin: 0.78, vMax: 0.905 }),
      ]);
      const lumine = new THREE.Mesh(lumineGeo, this._getOrCreateBuildingMaterial(2));
      lumine.quaternion.copy(kq);
      lumine.position.copy(kf.position).addScaledVector(kr, -23.5);
      lumine.position.y = 0;
      g.add(lumine);

      // 北千住マルイ（ミルディス：低層百貨店基壇＋セットバック高層棟＋赤い0101サインアクセント）
      const maruiGeo = mergeBufferGeos([
        createCleanRoofBoxGeo(40, 32, 82, 0, 16, 0, { uRepeatX: 2, uRepeatZ: 3, vMin: 0.0, vMax: 0.56 }),
        createCleanRoofBoxGeo(32, 24, 66, -2, 44, 4, { uRepeatX: 2, uRepeatZ: 2, vMin: 0.50, vMax: 0.895 }),
        createCleanRoofBoxGeo(16, 6, 26, -3, 59, 4, { vMin: 0.80, vMax: 0.905 }),
      ]);
      const marui = new THREE.Mesh(maruiGeo, this._getOrCreateBuildingMaterial(3));
      marui.quaternion.copy(kq);
      marui.position
        .copy(kf.position)
        .addScaledVector(kr, -62)
        .addScaledVector(kf.tangent, 35);
      marui.position.y = 0;
      g.add(marui);

      const maruiSign = new THREE.Mesh(
        new THREE.BoxGeometry(1.2, 7.5, 14),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(2.8, 0.22, 0.22) })
      );
      maruiSign.quaternion.copy(kq);
      maruiSign.position
        .copy(kf.position)
        .addScaledVector(kr, -45.5)
        .addScaledVector(kf.tangent, 35);
      maruiSign.position.y = 48;
      g.add(maruiSign);
    }

    // 4. 東側（x = +26m）：東京メトロ日比谷線・東武スカイツリーラインの巨大な地上3階高架ホーム駅舎！
    {
      const tf = this.route.getFrameAt(5110);
      const tr = new THREE.Vector3().crossVectors(tf.tangent, WORLD_UP).normalize();
      const tq = new THREE.Quaternion().setFromRotationMatrix(
        new THREE.Matrix4().makeBasis(tr, WORLD_UP, tf.tangent.clone().negate())
      );
      const tobuViaduct = new THREE.Mesh(
        new THREE.BoxGeometry(18, 16.5, 240),
        new THREE.MeshStandardMaterial({ color: 0x828890, roughness: 0.72 })
      );
      tobuViaduct.quaternion.copy(tq);
      tobuViaduct.position.copy(tf.position).addScaledVector(tr, 27.5);
      tobuViaduct.position.y = 8.25;
      g.add(tobuViaduct);

      // 3階ホームの大屋根と明るい照明帯
      const tobuLightStrip = new THREE.Mesh(
        new THREE.BoxGeometry(18.4, 1.4, 220),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(1.9, 1.85, 1.65) })
      );
      tobuLightStrip.quaternion.copy(tq);
      tobuLightStrip.position.copy(tf.position).addScaledVector(tr, 27.5);
      tobuLightStrip.position.y = 14.8;
      g.add(tobuLightStrip);
    }

    this.group.add(g);
  }

  /**
   * 隅田川水面 ＆ 常磐線 隅田川橋梁（2連曲弦ワーレントラス）＆ 下流の千住大橋アーチ・並走TX橋
   */
  _buildSumidaRiverAndTrussBridge() {
    const bStart = LANDMARKS.sumidaBridgeStart;
    const bEnd = LANDMARKS.sumidaBridgeEnd;
    const midD = (bStart + bEnd) * 0.5;
    const midFrame = this.route.getFrameAt(midD);
    const horizRight = new THREE.Vector3().crossVectors(midFrame.tangent, WORLD_UP).normalize();
    const bridgeQuat = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(horizRight, WORLD_UP, midFrame.tangent.clone().negate())
    );

    const riverWidthAlongTrack = bEnd - bStart + 22;
    const riverGeo = new THREE.PlaneGeometry(2600, riverWidthAlongTrack, 1, 1);
    riverGeo.rotateX(-Math.PI / 2);

    const waterNorm = this.textures.waterNormal;
    waterNorm.repeat.set(150, 24);

    this.waterMaterial = new THREE.MeshStandardMaterial({
      color: 0x1a2834,
      normalMap: waterNorm,
      normalScale: new THREE.Vector2(0.28, 0.28),
      metalness: 0.92,
      roughness: 0.09,
      envMapIntensity: 2.35,
    });

    const riverMesh = new THREE.Mesh(riverGeo, this.waterMaterial);
    riverMesh.quaternion.copy(bridgeQuat);
    riverMesh.position.set(midFrame.position.x, 1.15, midFrame.position.z);
    riverMesh.receiveShadow = true;
    this.group.add(riverMesh);

    const bankMat = new THREE.MeshStandardMaterial({
      color: 0x74777a,
      map: this.textures.concrete.map,
      roughness: 0.88,
    });
    for (const bankD of [bStart - 8, bEnd + 8]) {
      const bf = this.route.getFrameAt(bankD);
      const bank = new THREE.Mesh(new THREE.BoxGeometry(2600, 4.8, 16), bankMat);
      bank.quaternion.copy(bridgeQuat);
      bank.position.set(bf.position.x, 2.2, bf.position.z);
      bank.receiveShadow = true;
      this.group.add(bank);
    }

    const trussMat = new THREE.MeshStandardMaterial({
      color: 0x5c786e,
      metalness: 0.64,
      roughness: 0.45,
      envMapIntensity: 1.2,
    });

    const totalLen = bEnd - bStart;
    const spanLen = totalLen / 2;
    for (let s = 0; s < 2; s++) {
      this._buildSingleWarrenTrussSpan(bStart + s * spanLen, bStart + (s + 1) * spanLen, trussMat, bankMat);
    }

    // 右手（下流側）：つくばエクスプレス・日比谷線の隅田川橋梁
    const pDeck = new THREE.Mesh(new THREE.BoxGeometry(8.5, 2.2, totalLen + 30), bankMat);
    pDeck.quaternion.copy(bridgeQuat);
    pDeck.position
      .copy(midFrame.position)
      .addScaledVector(horizRight, 28)
      .addScaledVector(WORLD_UP, 0.8);
    this.group.add(pDeck);

    // 左手（上流側 x = -185m）：国道4号「千住大橋（タイドアーチ橋）」シルエット！
    const archBridgeMat = new THREE.MeshStandardMaterial({
      color: 0x3b6e5c,
      metalness: 0.55,
      roughness: 0.5,
    });
    const senjuOhashiDeck = new THREE.Mesh(
      new THREE.BoxGeometry(16, 2.0, totalLen + 10),
      archBridgeMat
    );
    senjuOhashiDeck.quaternion.copy(bridgeQuat);
    senjuOhashiDeck.position
      .copy(midFrame.position)
      .addScaledVector(horizRight, -185)
      .addScaledVector(WORLD_UP, -2.5);
    this.group.add(senjuOhashiDeck);
  }

  _buildSingleWarrenTrussSpan(s0, s1, trussMat, pierMat) {
    const panels = 10;
    const panelLen = (s1 - s0) / panels;
    const leftSideX = -3.45;
    const rightSideX = 3.8 + 3.45;
    const trussWidth = rightSideX - leftSideX;
    const centerX = (leftSideX + rightSideX) * 0.5;

    const topHeightAt = (panelIdx) => {
      const u = panelIdx / panels;
      if (panelIdx === 0 || panelIdx === panels) return 0.2;
      return 6.4 + Math.sin(u * Math.PI) * 3.8;
    };

    const addBeamBetween = (pA, pB, thickness = 0.38) => {
      const diff = new THREE.Vector3().subVectors(pB, pA);
      const len = diff.length();
      if (len < 0.01) return;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(thickness, thickness, len), trussMat);
      mesh.position.addVectors(pA, pB).multiplyScalar(0.5);
      mesh.lookAt(pB);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    };

    for (let i = 0; i < panels; i++) {
      const dA = s0 + i * panelLen;
      const dB = s0 + (i + 1) * panelLen;
      const fA = this.route.getFrameAt(dA);
      const fB = this.route.getFrameAt(dB);
      const rA = new THREE.Vector3().crossVectors(fA.tangent, WORLD_UP).normalize();
      const rB = new THREE.Vector3().crossVectors(fB.tangent, WORLD_UP).normalize();

      const hTopA = topHeightAt(i);
      const hTopB = topHeightAt(i + 1);

      for (const sideX of [leftSideX, rightSideX]) {
        const botA = fA.position.clone().addScaledVector(rA, sideX).addScaledVector(WORLD_UP, -0.35);
        const botB = fB.position.clone().addScaledVector(rB, sideX).addScaledVector(WORLD_UP, -0.35);
        const topA = fA.position.clone().addScaledVector(rA, sideX).addScaledVector(WORLD_UP, hTopA);
        const topB = fB.position.clone().addScaledVector(rB, sideX).addScaledVector(WORLD_UP, hTopB);

        addBeamBetween(botA, botB, 0.46);
        if (i === 0) {
          addBeamBetween(botA, topB, 0.50);
        } else if (i === panels - 1) {
          addBeamBetween(topA, botB, 0.50);
        } else {
          addBeamBetween(topA, topB, 0.46);
          if (i % 2 === 1) addBeamBetween(botA, topB, 0.34);
          else addBeamBetween(topA, botB, 0.34);
        }
        if (i > 0) addBeamBetween(botA, topA, 0.28);
      }

      if (i > 0) {
        const topLeft = fA.position.clone().addScaledVector(rA, leftSideX).addScaledVector(WORLD_UP, hTopA);
        const topRight = fA.position.clone().addScaledVector(rA, rightSideX).addScaledVector(WORLD_UP, hTopA);
        addBeamBetween(topLeft, topRight, 0.36);

        if (i < panels - 1) {
          const nextLeft = fB.position.clone().addScaledVector(rB, leftSideX).addScaledVector(WORLD_UP, hTopB);
          const nextRight = fB.position.clone().addScaledVector(rB, rightSideX).addScaledVector(WORLD_UP, hTopB);
          addBeamBetween(topLeft, nextRight, 0.20);
          addBeamBetween(topRight, nextLeft, 0.20);
        }
      }
    }

    for (const pierD of [s0, s1]) {
      const pf = this.route.getFrameAt(pierD);
      const pr = new THREE.Vector3().crossVectors(pf.tangent, WORLD_UP).normalize();
      const pier = new THREE.Mesh(
        new THREE.BoxGeometry(trussWidth + 2.8, pf.position.y + 1.5, 2.8),
        pierMat
      );
      pier.quaternion.setFromRotationMatrix(
        new THREE.Matrix4().makeBasis(pr, WORLD_UP, pf.tangent.clone().negate())
      );
      pier.position.copy(pf.position).addScaledVector(pr, centerX);
      pier.position.y = (pf.position.y - 1.2) * 0.5;
      this.group.add(pier);
    }
  }

  /**
   * 沿線実在ランドマーク群：
   * 1. 東京スカイツリー (634m 実寸プロポーション・展望台2段・粋ブルー夕景ライトアップ)
   * 2. 東京ガス 千住整圧所の巨大球形ガスタンク × 2基 (南千住手前左側の名物車窓！)
   * 3. 三河島駅前 アトラスブランズタワー & 田端貨物線オーバークロス合流高架
   * 4. JR貨物 隅田川駅（EH500金太郎電気機関車＋コキ貨物編成＋コンテナヤード）
   * 5. 南千住東口・汐入リバーサイド超高層タワマン群 ＆ 京成本線オーバークロス/アンダークロス
   */
  _buildLandmarksAndFreightYard() {
    const concreteMat = new THREE.MeshStandardMaterial({
      color: 0x76797d,
      map: this.textures.concrete.map,
      roughness: 0.86,
    });
    const girderMat = new THREE.MeshStandardMaterial({
      color: 0x8c3b32,
      metalness: 0.58,
      roughness: 0.52,
    });

    // ---- 1. 東京スカイツリー (634m) — 三河島〜南千住〜隅田川橋梁の右手（南東・押上方向）にそびえる象徴！ ----
    {
      const stPos = this.route.getFrameAt(3400).position.clone();
      // 南千住から南東(押上方面: 東へ +1450m, 南へ +1150m) の実距離感ロケーション
      const skytreeGroup = new THREE.Group();
      skytreeGroup.position.set(stPos.x + 1420, 0, stPos.z + 1080);

      const latticeMat = new THREE.MeshStandardMaterial({
        color: 0xdce6f0,
        metalness: 0.45,
        roughness: 0.35,
        emissive: new THREE.Color(0x3a88c8), // 夕暮れに浮かび上がる「粋」ペールブルー照明
        emissiveIntensity: 0.55,
      });
      const deckMat = new THREE.MeshStandardMaterial({
        color: 0xc8d4e2,
        metalness: 0.72,
        roughness: 0.22,
        emissive: new THREE.Color(0xd8ecff),
        emissiveIntensity: 0.85,
      });

      // 三角足元 -> 円筒テーパータワー本体 (0〜350m, 350〜450m, 450〜495m, ゲイン塔 495〜634m)
      const lowerShaft = new THREE.Mesh(new THREE.CylinderGeometry(16, 36, 350, 12), latticeMat);
      lowerShaft.position.y = 175;
      skytreeGroup.add(lowerShaft);

      // 天望デッキ (350m)
      const temboDeck = new THREE.Mesh(new THREE.CylinderGeometry(24, 21, 22, 20), deckMat);
      temboDeck.position.y = 352;
      skytreeGroup.add(temboDeck);

      const midShaft = new THREE.Mesh(new THREE.CylinderGeometry(11, 15, 95, 12), latticeMat);
      midShaft.position.y = 405;
      skytreeGroup.add(midShaft);

      // 天望回廊 (450m)
      const galleria = new THREE.Mesh(new THREE.CylinderGeometry(15.5, 15.5, 14, 20), deckMat);
      galleria.position.y = 450;
      skytreeGroup.add(galleria);

      const upperShaft = new THREE.Mesh(new THREE.CylinderGeometry(6.5, 10.5, 50, 10), latticeMat);
      upperShaft.position.y = 480;
      skytreeGroup.add(upperShaft);

      // ゲイン塔 (634m 頂点)
      const gainMast = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 5.2, 134, 8), deckMat);
      gainMast.position.y = 567;
      skytreeGroup.add(gainMast);

      // 頂部航空障害灯
      const topBeaconMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(4.0, 0.15, 0.1) });
      const topBeacon = new THREE.Mesh(new THREE.SphereGeometry(2.8, 8, 8), topBeaconMat);
      topBeacon.position.y = 635;
      skytreeGroup.add(topBeacon);
      this.obstructionLights.push({ mat: topBeaconMat, phase: 0.0 });

      this.group.add(skytreeGroup);
    }

    // ---- 2. 東京ガス 千住整圧所の巨大球形ガスタンク × 2基（d=2630m..2740m 左手！南千住名物！） ----
    {
      const gasMat = new THREE.MeshStandardMaterial({
        color: 0xcfe0d2, // 東京ガス特有の淡いパステルグリーン・アイボリー
        roughness: 0.42,
        metalness: 0.28,
        envMapIntensity: 1.25,
      });
      const legMat = new THREE.MeshStandardMaterial({
        color: 0x5c6662,
        metalness: 0.6,
        roughness: 0.45,
      });

      for (const [gd, latOff, radius] of [
        [2635, -48, 17.5],
        [2715, -56, 16.0],
      ]) {
        const gf = this.route.getFrameAt(gd);
        const gr = new THREE.Vector3().crossVectors(gf.tangent, WORLD_UP).normalize();
        const holder = new THREE.Group();
        holder.position.copy(gf.position).addScaledVector(gr, latOff);
        holder.position.y = 0;

        const sphere = new THREE.Mesh(new THREE.SphereGeometry(radius, 28, 22), gasMat);
        sphere.position.y = radius + 7.5;
        holder.add(sphere);

        // 赤道リング＆支持脚8本
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(radius + 0.35, 0.4, 8, 28),
          legMat
        );
        ring.rotation.x = Math.PI / 2;
        ring.position.y = radius + 7.5;
        holder.add(ring);

        for (let k = 0; k < 8; k++) {
          const ang = (k / 8) * Math.PI * 2;
          const leg = new THREE.Mesh(
            new THREE.CylinderGeometry(0.42, 0.52, radius + 7.5, 8),
            legMat
          );
          leg.position.set(
            Math.cos(ang) * (radius - 0.6),
            (radius + 7.5) * 0.5,
            Math.sin(ang) * (radius - 0.6)
          );
          holder.add(leg);
        }
        this.group.add(holder);
      }
    }

    // ---- 3. 日暮里 京成本線オーバークロス (d=95m：全14線を斜めに跨ぐプレートガーダー橋) ----
    {
      const f = this.route.getFrameAt(LANDMARKS.keiseiNipporiOverpass);
      const r = new THREE.Vector3().crossVectors(f.tangent, WORLD_UP).normalize();
      const g = new THREE.Group();
      g.position.copy(f.position);
      g.quaternion.setFromRotationMatrix(
        new THREE.Matrix4().makeBasis(r, WORLD_UP, f.tangent.clone().negate())
      );
      g.rotateY(0.48);

      const deck = new THREE.Mesh(new THREE.BoxGeometry(118, 1.85, 9.4), girderMat);
      deck.position.set(-22, 8.2, 0);
      deck.castShadow = true;
      g.add(deck);

      const parapet = new THREE.Mesh(new THREE.BoxGeometry(118, 1.1, 9.8), concreteMat);
      parapet.position.set(-22, 9.5, 0);
      parapet.castShadow = true;
      g.add(parapet);
      this.group.add(g);
    }

    // 田端貨物線（常磐貨物支線）アプローチ高架 (d=1420..1620m 左側に並走合流)
    for (let d = 1380; d <= 1620; d += 20) {
      const f = this.route.getFrameAt(d);
      const r = new THREE.Vector3().crossVectors(f.tangent, WORLD_UP).normalize();
      const q = new THREE.Quaternion().setFromRotationMatrix(
        new THREE.Matrix4().makeBasis(r, WORLD_UP, f.tangent.clone().negate())
      );
      const t = (d - 1380) / 240;
      const lat = THREE.MathUtils.lerp(-18, -5.2, t);
      const freightGirder = new THREE.Mesh(new THREE.BoxGeometry(4.4, 1.6, 20.4), girderMat);
      freightGirder.quaternion.copy(q);
      freightGirder.position.copy(f.position).addScaledVector(r, lat).addScaledVector(WORLD_UP, -1.2);
      this.group.add(freightGirder);
    }

    // 三河島駅前ランドマーク「アトラスブランズタワー三河島（商業基壇＋34階建てレジデンス＋塔屋）」
    {
      const mf = this.route.getFrameAt(1185);
      const mr = new THREE.Vector3().crossVectors(mf.tangent, WORLD_UP).normalize();
      const mq = new THREE.Quaternion().setFromRotationMatrix(
        new THREE.Matrix4().makeBasis(mr, WORLD_UP, mf.tangent.clone().negate())
      );
      const atlasGeo = mergeBufferGeos([
        createCleanRoofBoxGeo(34, 15, 34, 0, 7.5, 0, { uRepeatX: 2, uRepeatZ: 2, vMin: 0.0, vMax: 0.28 }),
        createCleanRoofBoxGeo(26, 92, 26, 0, 61, 0, { uRepeatX: 2, uRepeatZ: 2, vMin: 0.12, vMax: 0.895 }),
        createCleanRoofBoxGeo(16, 7, 16, 0, 110.5, 0, { vMin: 0.80, vMax: 0.905 }),
      ]);
      const atlas = new THREE.Mesh(atlasGeo, this._getOrCreateBuildingMaterial(1));
      atlas.quaternion.copy(mq);
      atlas.position.copy(mf.position).addScaledVector(mr, -35);
      atlas.position.y = 0;
      this.group.add(atlas);

      const abMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 0.12, 0.08) });
      const abeacon = new THREE.Mesh(new THREE.SphereGeometry(0.55, 8, 8), abMat);
      abeacon.position.set(atlas.position.x, 115.4, atlas.position.z);
      this.group.add(abeacon);
      this.obstructionLights.push({ mat: abMat, phase: 1.8 });
    }

    // 南千住東口・汐入リバーサイド超高層タワーマンション群 (d=3480..3760m 右手：各棟異なる意匠とシルエット！)
    for (const [sd, sLat, sH, matIdx, rotOff] of [
      [3490, 56, 128, 0, 0.08],
      [3595, 68, 136, 3, -0.14],
      [3715, 54, 118, 1, 0.22],
    ]) {
      const sf = this.route.getFrameAt(sd);
      const sr = new THREE.Vector3().crossVectors(sf.tangent, WORLD_UP).normalize();
      const sq = new THREE.Quaternion().setFromRotationMatrix(
        new THREE.Matrix4().makeBasis(sr, WORLD_UP, sf.tangent.clone().negate())
      );
      const towerGeo = mergeBufferGeos([
        createCleanRoofBoxGeo(36, 14, 38, 0, 7, 0, { uRepeatX: 2, uRepeatZ: 2, vMin: 0.0, vMax: 0.26 }),
        createCleanRoofBoxGeo(29, sH - 21, 26, 0, 14 + (sH - 21) * 0.5, 2, {
          uRepeatX: 2,
          uRepeatZ: 2,
          vMin: 0.11,
          vMax: 0.895,
        }),
        createCleanRoofBoxGeo(16, sH - 30, 14, -6, 14 + (sH - 30) * 0.5, -12, {
          vMin: 0.11,
          vMax: 0.895,
        }),
        createCleanRoofBoxGeo(17, 7, 17, 0, sH - 3.5, 1, { vMin: 0.80, vMax: 0.905 }),
      ]);
      const shioiriTower = new THREE.Mesh(towerGeo, this._getOrCreateBuildingMaterial(matIdx));
      shioiriTower.quaternion.copy(sq);
      shioiriTower.rotateY(rotOff);
      shioiriTower.position.copy(sf.position).addScaledVector(sr, sLat);
      shioiriTower.position.y = 0;
      this.group.add(shioiriTower);

      const bMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 0.12, 0.08) });
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.55, 8, 8), bMat);
      beacon.position.set(shioiriTower.position.x, sH + 1.4, shioiriTower.position.z);
      this.group.add(beacon);
      this.obstructionLights.push({ mat: bMat, phase: sd * 0.01 });
    }

    // ---- 4. JR貨物 隅田川駅（コンテナヤード＋EH500金太郎機関車牽引のコキ貨物列車＋高出力照明塔） ----
    const rng = mulberry32(8810);
    const cStart = LANDMARKS.sumidaFreightYardStart;
    const cEnd = LANDMARKS.sumidaFreightYardEnd;

    const yardMid = this.route.getFrameAt((cStart + cEnd) * 0.5);
    const yardRight = new THREE.Vector3().crossVectors(yardMid.tangent, WORLD_UP).normalize();
    const yardBasis = new THREE.Matrix4().makeBasis(
      yardRight,
      WORLD_UP,
      yardMid.tangent.clone().negate()
    );
    const yardSlab = new THREE.Mesh(
      new THREE.BoxGeometry(62, 0.5, cEnd - cStart + 40),
      new THREE.MeshStandardMaterial({ color: 0x33363b, roughness: 0.9 })
    );
    yardSlab.quaternion.setFromRotationMatrix(yardBasis);
    yardSlab.position.copy(yardMid.position).addScaledVector(yardRight, 40);
    yardSlab.position.y = 0.25;
    yardSlab.receiveShadow = true;
    this.group.add(yardSlab);

    // 留置線上の EH500「金太郎」2車体連結赤色電気機関車 ＋ コキ貨車編成！
    const ehRedMat = new THREE.MeshStandardMaterial({
      color: 0x9e1f28,
      metalness: 0.45,
      roughness: 0.38,
    });
    for (const unitOff of [0, 13.0]) {
      const lf = this.route.getFrameAt(2960 - unitOff);
      const lr = new THREE.Vector3().crossVectors(lf.tangent, WORLD_UP).normalize();
      const lq = new THREE.Quaternion().setFromRotationMatrix(
        new THREE.Matrix4().makeBasis(lr, WORLD_UP, lf.tangent.clone().negate())
      );
      const loco = new THREE.Mesh(new THREE.BoxGeometry(2.88, 3.65, 12.2), ehRedMat);
      loco.quaternion.copy(lq);
      loco.position.copy(lf.position).addScaledVector(lr, 14.5);
      loco.position.y = 2.4;
      this.group.add(loco);
    }

    const containerGeo = new THREE.BoxGeometry(2.45, 2.55, 6.05);
    const containerMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.62,
      metalness: 0.35,
    });
    const maxContainers = 280;
    const containerInst = new THREE.InstancedMesh(containerGeo, containerMat, maxContainers);

    const palette = [
      new THREE.Color(0x7a1e38),
      new THREE.Color(0x7a1e38),
      new THREE.Color(0x1f528f),
      new THREE.Color(0xd8dde2),
      new THREE.Color(0x2a6b5e),
    ];

    const dummy = new THREE.Object3D();
    let cCount = 0;
    for (let d = cStart; d < cEnd && cCount < maxContainers; d += 14) {
      const f = this.route.getFrameAt(d);
      const r = new THREE.Vector3().crossVectors(f.tangent, WORLD_UP).normalize();
      const q = new THREE.Quaternion().setFromRotationMatrix(
        new THREE.Matrix4().makeBasis(r, WORLD_UP, f.tangent.clone().negate())
      );

      for (const laneX of [14.5, 22, 31, 41, 51]) {
        if (laneX === 14.5 && d > 2935) continue; // EH500機関車の前方は空ける
        if (rng() < 0.28) continue;
        const stacks = laneX === 14.5 ? 1 : rng() < 0.45 ? 2 : 1;
        for (let st = 0; st < stacks && cCount < maxContainers; st++) {
          dummy.quaternion.copy(q);
          dummy.position.copy(f.position).addScaledVector(r, laneX + (rng() - 0.5) * 0.3);
          dummy.position.y = (laneX === 14.5 ? 2.25 : 1.75) + st * 2.58;
          dummy.updateMatrix();
          containerInst.setMatrixAt(cCount, dummy.matrix);
          containerInst.setColorAt(cCount, palette[Math.floor(rng() * palette.length)]);
          cCount++;
        }
      }
    }
    containerInst.count = cCount;
    containerInst.instanceMatrix.needsUpdate = true;
    if (containerInst.instanceColor) containerInst.instanceColor.needsUpdate = true;
    this.group.add(containerInst);

    const towerPoleMat = new THREE.MeshStandardMaterial({
      color: 0x5c636a,
      metalness: 0.7,
      roughness: 0.45,
    });
    const floodLampMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(3.4, 2.7, 1.7),
    });

    for (let d = cStart + 40; d <= cEnd - 20; d += 145) {
      const f = this.route.getFrameAt(d);
      const r = new THREE.Vector3().crossVectors(f.tangent, WORLD_UP).normalize();
      const tower = new THREE.Group();
      tower.position.copy(f.position).addScaledVector(r, 28);
      tower.position.y = 0;

      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.42, 24, 6), towerPoleMat);
      mast.position.y = 12;
      tower.add(mast);

      const lampBank = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.75, 0.75), floodLampMat);
      lampBank.position.set(0, 24.1, 0);
      tower.add(lampBank);

      this.group.add(tower);
    }
  }

  _getOrCreateBuildingMaterial(variantIdx) {
    const safeIdx = variantIdx % this.textures.buildingFacades.length;
    if (this.buildingMaterials[safeIdx]) return this.buildingMaterials[safeIdx];
    const v = this.textures.buildingFacades[safeIdx];
    const isCurtain = safeIdx === 2 || safeIdx === 10 || safeIdx === 11;
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: v.map,
      emissive: new THREE.Color(0xffffff),
      emissiveMap: v.emissiveMap,
      emissiveIntensity: 1.45,
      roughnessMap: v.roughnessMap,
      roughness: 0.92,
      metalness: isCurtain ? 0.42 : 0.18,
      envMapIntensity: isCurtain ? 1.50 : 1.08,
    });
    this.buildingMaterials[safeIdx] = mat;
    return mat;
  }

  /**
   * 沿線エリア特性（駅前繁華街・下町密集住宅街・町工場地帯・リバーサイド再開発・UR団地）に応じた
   * 超多様な東京下町〜城東エリア都市建築ジェネレーター：
   * - 12種の建築ファサード × 11種の3D建築シルエット（パラペット・斜線セットバック・L字/コの字マンション・円筒アールタワー・隅切り8角ビル・ツインタワー基壇・UR外階段棟・ペンシル雑居・切妻/寄棟/片流れ住宅・のこぎり屋根町工場）
   * - 屋上設備（高架水槽FRPタンク・空調室外機チラー・エレベーター塔屋）
   * - 駅前・商業ビルの突き出し袖看板＆屋上広告塔ネオンサイン
   */
  _buildCityscape() {
    const rng = mulberry32(20261126);
    const silhouettes = createBuildingSilhouetteTemplates();
    const pitchedRoofs = createPitchedRoofTemplates();

    const silKeys = [
      'parapetBlock',     // 0
      'setbackStep',      // 1
      'lWingMansion',     // 2
      'twinCoreSlab',     // 3
      'pencilCommercial', // 4
      'lowRiseBody',      // 5
      'steppedHouseBody', // 6
      'cylinderTower',    // 7
      'chamferCrown',     // 8
      'twinPodium',       // 9
      'courtyardUBlock',  // 10
    ];
    const roofKeys = ['gable', 'hip', 'shed', 'sawtooth'];

    // (facadeIdx * silKeys.length + silIdx) ごとのインスタンスバケット
    const bodyBuckets = new Map();
    const pushBody = (facadeIdx, silIdx, item) => {
      const key = `${facadeIdx}:${silIdx}`;
      let arr = bodyBuckets.get(key);
      if (!arr) {
        arr = { facadeIdx, silIdx, items: [] };
        bodyBuckets.set(key, arr);
      }
      arr.items.push(item);
    };

    const roofInstBuckets = [[], [], [], []]; // gable, hip, shed, sawtooth
    const waterTankItems = [];
    const hvacItems = [];
    const penthouseItems = [];
    const signBuckets = Array.from({ length: 8 }, () => []);
    const roofBeacons = [];

    // 外壁の微妙な色味バリエーション（同じテクスチャでも棟ごとに個体差を出す！）
    const wallTints = [
      new THREE.Color(0xffffff),
      new THREE.Color(0xfaf3e8),
      new THREE.Color(0xeef3f8),
      new THREE.Color(0xe8e4dc),
      new THREE.Color(0xf5e9dc),
      new THREE.Color(0xe2e8ee),
    ];

    // 日本の瓦・トタン・ガルバリウム・スレート工場屋根のリアルな色彩パレット
    const houseRoofPalette = [
      new THREE.Color(0x2d333b), // いぶし銀和瓦
      new THREE.Color(0x24425c), // 青緑釉薬瓦・青トタン
      new THREE.Color(0x7a3d30), // 赤茶トタン屋根
      new THREE.Color(0x3a434c), // ダークスレート
      new THREE.Color(0x885339), // 洋風テラコッタ
      new THREE.Color(0x252a32), // ブラックガルバリウム
    ];
    const factoryRoofPalette = [
      new THREE.Color(0x4b5c68), // スレートブルーグレー
      new THREE.Color(0x35574b), // モスグリーン折板屋根
      new THREE.Color(0x733f35), // 錆止め赤茶トタン
      new THREE.Color(0x646e78), // 亜鉛メッキ鋼板シルバー
    ];

    // 隅田川の水面・堤防との厳密な3D平面距離判定用
    const riverMidD = (LANDMARKS.sumidaBridgeStart + LANDMARKS.sumidaBridgeEnd) * 0.5;
    const riverMidFrame = this.route.getFrameAt(riverMidD);
    const riverPos = riverMidFrame.position;
    const riverNormal = riverMidFrame.tangent;

    // 駅からの近さに応じた「駅前商業度 (0.0 .. 1.0)」と地区特性の算出
    const getDistrictProfile = (d) => {
      let stationWeight = 0;
      for (const st of STATIONS) {
        const dist = Math.abs(d - (st.platformStart + st.platformEnd) * 0.5);
        const radius = st.id === 'kitasenju' ? 380 : st.id === 'nippori' ? 300 : 230;
        if (dist < radius) {
          stationWeight = Math.max(stationWeight, 1.0 - dist / radius);
        }
      }
      const isRiverside = d > 3320 && d < 3920; // 南千住・汐入リバーサイド再開発・URエリア
      const isIndustrial = (d > 1420 && d < 3180) || (d > 4220 && d < 4680); // 三河島〜隅田川貨物〜千住関屋の町工場・倉庫帯
      const isShitamachi = (d > 180 && d < 1020) || (d > 1320 && d < 2650) || (d > 4210 && d < 4820);
      return { stationWeight, isRiverside, isIndustrial, isShitamachi };
    };

    // 奥行4層レイヤー設定（線路際の狭小密集地から遠景の高層スカイラインまで！）
    const layerConfigs = [
      { layer: 0, step: 13.0, baseDist: 16.5, jitter: 5.5, skipChance: 0.10 },
      { layer: 1, step: 18.5, baseDist: 39.0, jitter: 12.0, skipChance: 0.14 },
      { layer: 2, step: 27.0, baseDist: 78.0, jitter: 22.0, skipChance: 0.18 },
      { layer: 3, step: 44.0, baseDist: 148.0, jitter: 58.0, skipChance: 0.26 },
    ];

    for (const layerCfg of layerConfigs) {
      for (let d = ROUTE_START_BUFFER + 16; d <= ROUTE_END_BUFFER - 16; d += layerCfg.step) {
        const frame = this.route.getFrameAt(d);
        const upOffset = this.route.getUpTrackOffset(d);
        const horizRight = new THREE.Vector3().crossVectors(frame.tangent, WORLD_UP).normalize();
        const trackYaw = Math.atan2(frame.tangent.x, frame.tangent.z);
        const profile = getDistrictProfile(d);

        for (const side of [-1, 1]) {
          if (rng() < layerCfg.skipChance) continue;

          const sideTrackExtra = side > 0 ? upOffset : 0;
          const absDist = sideTrackExtra + layerCfg.baseDist + rng() * layerCfg.jitter;

          // --- 各種鉄道施設・駅舎・ランドマークとの干渉回避 ---
          if (d < 468 && side < 0 && absDist < 94) continue;
          if (d < 135 && side > 0 && absDist < 74) continue;
          if (d > 970 && d < 1235 && absDist < (side > 0 ? 25 : 20)) continue;
          if (d > 1148 && d < 1222 && side < 0 && absDist < 58) continue;
          if (d > 1365 && d < 1635 && side < 0 && absDist < 27) continue;
          if (d > 2575 && d < 2775 && side < 0 && absDist < 82) continue;

          if (
            side > 0 &&
            absDist < 80 &&
            d >= LANDMARKS.sumidaFreightYardStart - 20 &&
            d <= LANDMARKS.sumidaFreightYardEnd + 20
          ) {
            continue;
          }

          if (d > 3170 && d < 3435 && absDist < (side > 0 ? 27 : 20)) continue;
          if (d > 3455 && d < 3755 && side > 0 && absDist > 34 && absDist < 92) continue;

          if (d > 4935 && d < 5275) {
            if (side < 0 && absDist < 90) continue;
            if (side > 0 && absDist < 48) continue;
          }

          const lat = side * absDist;
          const pos = frame.position.clone().addScaledVector(horizRight, lat);
          pos.y = 0;

          const riverSignedDist =
            (pos.x - riverPos.x) * riverNormal.x + (pos.z - riverPos.z) * riverNormal.z;
          if (Math.abs(riverSignedDist) < 156) continue;

          // --- 地区特性とレイヤーに応じた建物カテゴリー決定 ---
          // 下町住宅・町工場ポケットでは連続して低層建築が並び、高架車窓に瓦・トタン屋根の海と中層ビルの落差を生む！
          const lowRisePocket = Math.sin(d * 0.022 + side * 1.7) > 0.15;
          let category = 'mansion';
          const rCat = rng();

          if (layerCfg.layer === 0) {
            if (profile.stationWeight > 0.42) {
              category = rCat < 0.48 ? 'zakkyo' : rCat < 0.78 ? 'office' : 'mansion';
            } else if (profile.isIndustrial && (lowRisePocket ? rCat < 0.44 : rCat < 0.25)) {
              category = 'factory';
            } else if (profile.isShitamachi && (lowRisePocket ? rCat < 0.72 : rCat < 0.46)) {
              category = 'house';
            } else if (rCat < 0.62) {
              category = 'mansion';
            } else if (rCat < 0.84) {
              category = 'zakkyo';
            } else {
              category = 'office';
            }
          } else if (layerCfg.layer === 1) {
            if (profile.stationWeight > 0.35) {
              category = rCat < 0.34 ? 'zakkyo' : rCat < 0.70 ? 'office' : 'mansion';
            } else if (profile.isRiverside && rCat < 0.38) {
              category = 'danchi';
            } else if (profile.isIndustrial && rCat < 0.32) {
              category = 'factory';
            } else if (profile.isShitamachi && lowRisePocket && rCat < 0.44) {
              category = 'house';
            } else {
              category = rCat < 0.58 ? 'mansion' : rCat < 0.80 ? 'office' : 'zakkyo';
            }
          } else if (layerCfg.layer === 2) {
            if (profile.isRiverside && rCat < 0.44) {
              category = 'danchi';
            } else if (rCat < 0.38) {
              category = 'office';
            } else if (rCat < 0.50 && profile.isIndustrial) {
              category = 'factory';
            } else {
              category = 'mansion';
            }
          } else {
            category = rCat < 0.46 ? 'office' : rCat < 0.72 ? 'mansion' : 'danchi';
          }

          const cardinalRot = Math.floor(rng() * 4) * (Math.PI * 0.5);
          const rotY = trackYaw + cardinalRot + (rng() - 0.5) * 0.16;
          const tint = wallTints[Math.floor(rng() * wallTints.length)];

          let w = 10;
          let depth = 10;
          let h = 15;
          let facadeIdx = 0;
          let silIdx = 0;
          let hasFlatRoof = true;

          if (category === 'house') {
            // 2〜3階建て下町戸建て・都市型3階建て狭小住宅・木造アパート（高架運転席から屋根がしっかり見える実寸高！）
            facadeIdx = rng() < 0.56 ? 5 : 6; // house_warm / house_cool
            const isModern3F = facadeIdx === 6 || rng() < 0.45;
            silIdx = isModern3F && rng() < 0.65 ? 6 : 5;
            w = 5.8 + rng() * 5.2;
            depth = 6.8 + rng() * 5.6;
            h = isModern3F ? 9.2 + rng() * 3.2 : 7.8 + rng() * 2.4;
            hasFlatRoof = false;

            const roofType = isModern3F && facadeIdx === 6 ? (rng() < 0.68 ? 2 : 0) : rng() < 0.58 ? 0 : 1;
            const roofH = roofType === 2 ? 1.4 + rng() * 0.8 : 1.8 + rng() * 1.1;
            const roofColor = houseRoofPalette[Math.floor(rng() * houseRoofPalette.length)];
            roofInstBuckets[roofType].push({
              x: pos.x,
              y: h - 0.05,
              z: pos.z,
              w,
              h: roofH,
              depth,
              rotY,
              color: roofColor,
            });
          } else if (category === 'factory') {
            // 荒川・三河島・南千住の町工場・倉庫（のこぎり屋根または緩勾配折板切妻屋根）
            facadeIdx = 7;
            silIdx = 5;
            w = 11.5 + rng() * 14.5;
            depth = 12.5 + rng() * 15.0;
            h = 8.8 + rng() * 5.2;
            hasFlatRoof = false;

            const roofType = rng() < 0.66 ? 3 : 0; // sawtooth or low-pitch gable
            const roofH = roofType === 3 ? 2.2 + rng() * 1.2 : 1.5 + rng() * 0.9;
            const roofColor = factoryRoofPalette[Math.floor(rng() * factoryRoofPalette.length)];
            roofInstBuckets[roofType].push({
              x: pos.x,
              y: h - 0.05,
              z: pos.z,
              w,
              h: roofH,
              depth,
              rotY,
              color: roofColor,
            });
          } else if (category === 'zakkyo') {
            // 駅前・通り沿いの商業雑居ビル・白スパンドレル雑居ビル・赤レンガビル
            const fPick = rng();
            facadeIdx = fPick < 0.50 ? 4 : fPick < 0.78 ? 10 : 9; // zakkyo / white_modern_office / retro_brick
            const sPick = rng();
            silIdx =
              sPick < 0.36
                ? 4 // pencilCommercial
                : sPick < 0.62
                  ? 1 // setbackStep
                  : sPick < 0.82
                    ? 8 // chamferCrown (交差点隅切り8角ビル！)
                    : 0; // parapetBlock
            w = layerCfg.layer === 0 ? 7.0 + rng() * 6.8 : 9.8 + rng() * 8.8;
            depth = 8.5 + rng() * 8.5;
            h = 14.0 + rng() * 19.0 + profile.stationWeight * 9.0;
          } else if (category === 'danchi') {
            // UR団地・大型リバーサイド板状集合住宅（外階段コア付きワイドスラブ / コの字棟）
            facadeIdx = rng() < 0.74 ? 8 : 3; // ur_danchi / ivory_mansion
            silIdx = rng() < 0.75 ? 3 : 10; // twinCoreSlab / courtyardUBlock
            w = 24.0 + rng() * 18.0;
            depth = silIdx === 10 ? 16.0 + rng() * 6.0 : 11.0 + rng() * 4.5;
            h = 24.0 + rng() * 24.0;
          } else if (category === 'office') {
            // ブルーガラス・エメラルドミラー・純白水平連窓の多様なオフィス・複合ビル（円筒タワー・隅切り・ツインタワー含む！）
            const fPick = rng();
            facadeIdx = fPick < 0.34 ? 2 : fPick < 0.68 ? 11 : fPick < 0.90 ? 10 : 0;
            const sPick = rng();
            silIdx =
              sPick < 0.24
                ? 7 // cylinderTower (円筒アールタワー！)
                : sPick < 0.46
                  ? 8 // chamferCrown (8角隅切りビル！)
                  : sPick < 0.64
                    ? 9 // twinPodium (非対称ツインタワー複合ビル！)
                    : sPick < 0.82
                      ? 1 // setbackStep
                      : 0; // parapetBlock
            w = silIdx === 7 || silIdx === 8 ? 14.0 + rng() * 12.0 : 13.0 + rng() * 16.0;
            depth = silIdx === 7 || silIdx === 8 ? w * (0.9 + rng() * 0.2) : 13.0 + rng() * 15.0;
            h =
              layerCfg.layer >= 2
                ? 34.0 + rng() * 58.0
                : 20.0 + rng() * 26.0 + profile.stationWeight * 14.0;
          } else {
            // 分譲マンション・デザイナーズマンション（赤茶タイル・白磁アイボリー・チャコール・純白）
            const fPick = rng();
            facadeIdx = fPick < 0.36 ? 1 : fPick < 0.72 ? 3 : fPick < 0.90 ? 0 : 10;
            const sPick = rng();
            silIdx =
              sPick < 0.28
                ? 2 // lWingMansion
                : sPick < 0.54
                  ? 1 // setbackStep
                  : sPick < 0.74
                    ? 10 // courtyardUBlock (コの字マンション！)
                    : sPick < 0.88
                      ? 9 // twinPodium
                      : 0; // parapetBlock
            w = 10.5 + rng() * 14.5;
            depth = 10.5 + rng() * 13.5;
            h =
              layerCfg.layer === 0
                ? 14.0 + rng() * 19.0
                : layerCfg.layer >= 2
                  ? 28.0 + rng() * 52.0
                  : 17.0 + rng() * 27.0;
          }

          pushBody(facadeIdx, silIdx, {
            x: pos.x,
            y: 0,
            z: pos.z,
            w,
            h,
            depth,
            rotY,
            color: tint,
          });

          // 建物のローカル座標 (lx, lz) を rotY でワールド座標へ変換するヘルパー
          const cosY = Math.cos(rotY);
          const sinY = Math.sin(rotY);
          const localToWorld = (lx, lz) => ({
            wx: pos.x + lx * cosY + lz * sinY,
            wz: pos.z - lx * sinY + lz * cosY,
          });

          // --- 屋上ストラクチャ（高架水槽・空調室外機群・エレベーター塔屋：フラット上面を持つシルエット0..4に配置！） ---
          if (hasFlatRoof && silIdx <= 4 && layerCfg.layer <= 2 && h >= 13.0) {
            const roofZone =
              silIdx === 1
                ? { cx: -0.14, cz: -0.11, sx: 0.22, sz: 0.24, y: h }
                : silIdx === 2
                  ? { cx: 0.16, cz: 0.22, sx: 0.24, sz: 0.20, y: h * 0.96 }
                  : silIdx === 3
                    ? { cx: 0.0, cz: -0.05, sx: 0.56, sz: 0.34, y: h * 0.96 }
                    : silIdx === 4
                      ? { cx: -0.12, cz: 0.10, sx: 0.26, sz: 0.28, y: h * 0.93 }
                      : { cx: 0.0, cz: 0.0, sx: 0.52, sz: 0.52, y: h * 0.955 };

            // 昭和・平成マンションや雑居ビルの象徴「FRP高架水槽タンク」
            if ((facadeIdx === 1 || facadeIdx === 4 || facadeIdx === 8 || facadeIdx === 9) && rng() < 0.52) {
              const tankSize = 2.0 + rng() * 1.0;
              const tp = localToWorld(
                (roofZone.cx + (rng() - 0.5) * roofZone.sx) * w,
                (roofZone.cz + (rng() - 0.5) * roofZone.sz) * depth
              );
              waterTankItems.push({
                x: tp.wx,
                y: roofZone.y,
                z: tp.wz,
                w: tankSize,
                h: tankSize * 1.25,
                depth: tankSize,
                rotY: rotY + (rng() - 0.5) * 0.2,
                color: rng() < 0.75 ? new THREE.Color(0xded9cb) : new THREE.Color(0xc5ced4),
              });
            }
            // オフィス・商業・モダンマンション屋上の「大型空調室外機チラー群」
            if (rng() < 0.58) {
              const cw = 2.2 + rng() * 1.6;
              const hp = localToWorld(
                (roofZone.cx + (rng() - 0.5) * roofZone.sx) * w,
                (roofZone.cz + (rng() - 0.5) * roofZone.sz) * depth
              );
              hvacItems.push({
                x: hp.wx,
                y: roofZone.y,
                z: hp.wz,
                w: cw,
                h: 1.5 + rng() * 0.75,
                depth: cw * 0.95,
                rotY,
                color: new THREE.Color(0x9aa2aa),
              });
            }
            // フラットルーフビルの「エレベーター機械室・階段室ペントハウス（塔屋）」
            if (silIdx === 0 && rng() < 0.65) {
              const pp = localToWorld((rng() - 0.5) * w * 0.26, (rng() - 0.5) * depth * 0.26);
              penthouseItems.push({
                x: pp.wx,
                y: h * 0.955,
                z: pp.wz,
                w: Math.min(w * 0.36, 4.5),
                h: 2.5 + rng() * 1.6,
                depth: Math.min(depth * 0.36, 4.6),
                rotY,
                color:
                  facadeIdx === 1
                    ? new THREE.Color(0x825b4c)
                    : facadeIdx === 3 || facadeIdx === 8
                      ? new THREE.Color(0xc8c2b8)
                      : new THREE.Color(0x6c727a),
              });
            }
          }

          // --- 駅前・線路沿い商業ビルの内照式「突き出し袖看板」＆「屋上広告塔ビルボード」 ---
          if (
            (category === 'zakkyo' || (category === 'office' && profile.stationWeight > 0.25)) &&
            layerCfg.layer <= 1
          ) {
            const toTrackX = -horizRight.x * side;
            const toTrackZ = -horizRight.z * side;
            const signIdx = Math.floor(rng() * 8);
            const cosCard = Math.abs(Math.cos(cardinalRot));
            const halfTowardTrack =
              (cosCard > 0.5 ? w : depth) * 0.5 * (silIdx === 4 ? 0.88 : silIdx === 1 ? 0.85 : 1.0);
            const halfAlongTrack = (cosCard > 0.5 ? depth : w) * 0.32;

            // 縦長突き出し袖看板（線路側壁面に密着して突き出し、運転席から正面が見える！）
            if (rng() < 0.78) {
              const maxSignTop = silIdx === 1 ? h * 0.52 : h * 0.88;
              const signH = Math.min(maxSignTop * 0.45, 3.4 + rng() * 3.2);
              const signY = Math.max(4.8, maxSignTop - signH * 0.55 - rng() * 2.0);
              const edgeDist = halfTowardTrack + 0.44;
              signBuckets[signIdx].push({
                x: pos.x + toTrackX * edgeDist + frame.tangent.x * halfAlongTrack,
                y: signY,
                z: pos.z + toTrackZ * edgeDist + frame.tangent.z * halfAlongTrack,
                w: 0.92,
                h: signH,
                depth: 0.24,
                rotY: trackYaw + Math.PI * 0.5,
              });
            }

            // 屋上大型広告看板（駅前エリアのフラットルーフ商業ビル頭上に輝くネオン広告塔！）
            if (hasFlatRoof && (silIdx === 0 || silIdx === 4) && (profile.stationWeight > 0.26 || rng() < 0.24)) {
              const bIdx = Math.floor(rng() * 8);
              const bw = Math.min(w * 0.72, 4.6 + rng() * 3.4);
              const bh = 2.5 + rng() * 1.7;
              const roofBase = silIdx === 4 ? h * 0.93 : h * 0.96;
              signBuckets[bIdx].push({
                x: pos.x + toTrackX * (halfTowardTrack * 0.35),
                y: roofBase + bh * 0.5 + 0.15,
                z: pos.z + toTrackZ * (halfTowardTrack * 0.35),
                w: bw,
                h: bh,
                depth: 0.42,
                rotY: trackYaw + (side > 0 ? -0.32 : 0.32),
              });
            }
          }

          // 60m超の高層建築には赤色点滅の航空障害灯を設置
          if (h >= 60) {
            roofBeacons.push(new THREE.Vector3(pos.x, h + 1.3, pos.z));
          }
        }
      }
    }

    const dummy = new THREE.Object3D();

    // 1. 全建築ボディ InstancedMesh 構築
    for (const bucket of bodyBuckets.values()) {
      const { facadeIdx, silIdx, items } = bucket;
      if (!items.length) continue;
      const geo = silhouettes[silKeys[silIdx]];
      const mat = this._getOrCreateBuildingMaterial(facadeIdx);
      const inst = new THREE.InstancedMesh(geo, mat, items.length);
      inst.receiveShadow = true;
      inst.castShadow = true;

      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        dummy.position.set(it.x, it.y, it.z);
        dummy.scale.set(it.w, it.h, it.depth);
        dummy.rotation.set(0, it.rotY, 0);
        dummy.updateMatrix();
        inst.setMatrixAt(i, dummy.matrix);
        inst.setColorAt(i, it.color);
      }
      inst.instanceMatrix.needsUpdate = true;
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
      this.group.add(inst);
    }

    // 2. 勾配屋根（切妻・寄棟・片流れ・町工場のこぎり屋根）InstancedMesh 構築（全種でマテリアル1個共有！）
    const pitchedRoofMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.64,
      metalness: 0.28,
      envMapIntensity: 0.95,
    });
    for (let rIdx = 0; rIdx < roofKeys.length; rIdx++) {
      const list = roofInstBuckets[rIdx];
      if (!list.length) continue;
      const inst = new THREE.InstancedMesh(pitchedRoofs[roofKeys[rIdx]], pitchedRoofMat, list.length);
      inst.receiveShadow = true;
      inst.castShadow = true;
      for (let i = 0; i < list.length; i++) {
        const it = list[i];
        dummy.position.set(it.x, it.y, it.z);
        dummy.scale.set(it.w, it.h, it.depth);
        dummy.rotation.set(0, it.rotY, 0);
        dummy.updateMatrix();
        inst.setMatrixAt(i, dummy.matrix);
        inst.setColorAt(i, it.color);
      }
      inst.instanceMatrix.needsUpdate = true;
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
      this.group.add(inst);
    }

    // 3. 屋上設備（高架水槽タンク・空調室外機群・塔屋ペントハウス）InstancedMesh 構築（マテリアル1個共有！）
    const rooftopEquipMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.68,
      metalness: 0.24,
      envMapIntensity: 0.9,
    });
    const equipBatches = [
      { geo: createWaterTankGeo(), list: waterTankItems },
      { geo: createHvacClusterGeo(), list: hvacItems },
      { geo: createCleanRoofBoxGeo(1, 1, 1, 0, 0.5, 0), list: penthouseItems },
    ];
    for (const batch of equipBatches) {
      if (!batch.list.length) continue;
      const inst = new THREE.InstancedMesh(batch.geo, rooftopEquipMat, batch.list.length);
      for (let i = 0; i < batch.list.length; i++) {
        const it = batch.list[i];
        dummy.position.set(it.x, it.y, it.z);
        dummy.scale.set(it.w, it.h, it.depth);
        dummy.rotation.set(0, it.rotY, 0);
        dummy.updateMatrix();
        inst.setMatrixAt(i, dummy.matrix);
        inst.setColorAt(i, it.color);
      }
      inst.instanceMatrix.needsUpdate = true;
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
      this.group.add(inst);
    }

    // 4. 袖看板・屋上広告塔 InstancedMesh 構築（8セルすべて1個のサインマテリアルを共有！）
    const signTex = createUrbanSignageTexture(4);
    this.signageMaterial = new THREE.MeshStandardMaterial({
      map: signTex.map,
      emissive: new THREE.Color(0xffffff),
      emissiveMap: signTex.emissiveMap,
      emissiveIntensity: 1.25,
      roughness: 0.36,
      metalness: 0.12,
    });
    for (let sIdx = 0; sIdx < 8; sIdx++) {
      const list = signBuckets[sIdx];
      if (!list.length) continue;
      const inst = new THREE.InstancedMesh(createSignCellGeo(sIdx), this.signageMaterial, list.length);
      for (let i = 0; i < list.length; i++) {
        const it = list[i];
        dummy.position.set(it.x, it.y, it.z);
        dummy.scale.set(it.w, it.h, it.depth);
        dummy.rotation.set(0, it.rotY, 0);
        dummy.updateMatrix();
        inst.setMatrixAt(i, dummy.matrix);
      }
      inst.instanceMatrix.needsUpdate = true;
      this.group.add(inst);
    }

    // 5. 高層ビル航空障害灯
    const beaconGeo = new THREE.SphereGeometry(0.45, 8, 8);
    for (let i = 0; i < roofBeacons.length; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 0.12, 0.08) });
      const mesh = new THREE.Mesh(beaconGeo, mat);
      mesh.position.copy(roofBeacons[i]);
      this.group.add(mesh);
      this.obstructionLights.push({ mat, phase: i * 1.3 });
    }
  }

  /**
   * 超高精細 E531系0番台（サロ2階建て連結）＆ E231系0番台（常磐快速）対向列車
   * ＋ 日暮里14線メガコリドーを実車通りの番線・進行方向で駆け抜ける他路線フルラインナップ！
   *   - 東北新幹線 下り (-26.4m): E5系「はやぶさ」（第1上野トンネル抗口から急勾配を駆け上がり高架橋へ！）
   *   - 東北本線 上り (-4.6m) / 下り (-8.4m): E231系1000番台 湘南色（サロ2階建てグリーン車連結）
   *   - 9番線 (-32.2m, 南行) / 12番線 (-53.6m, 北行): 京浜東北線 E233系1000番台 スカイブルー
   *   - 10番線 (-40.8m, 外回り) / 11番線 (-45.0m, 内回り): 山手線 E235系0番台 ウグイスドット顔
   */
  _buildOncomingAndParallelTrains() {
    // 常磐線上り本線：現実の夕方ダイヤ（約3.5分間隔・閉塞距離4,500m）に準拠し、同一速度で絶対に追いつかない安全運行
    const configs = [
      { startD: 2150, speedMps: 21.5, series: 'E531', cars: 10 }, // 1本目: E531系0番台（サロ2階建てグリーン車連結）
      { startD: 6650, speedMps: 21.5, series: 'E231', cars: 10 }, // 2本目: E231系0番台（4,500m後方＝約3分半間隔）
    ];

    for (const cfg of configs) {
      const carMeshes = this.rollingStock.createConsist(this.group, {
        series: cfg.series,
        cars: cfg.cars,
        headlightsOn: true,
      });

      this.oncomingTrains.push({
        headD: cfg.startD,
        speedMps: cfg.speedMps,
        cars: cfg.cars,
        carMeshes,
        passedPlayer: false,
      });
    }

    // 日暮里14線並走区間：各路線とも実車相応の運転間隔（山手3分・京浜東北3.5分・東北本線4分・新幹線4分）へ拡張
    const parallelConfigs = [
      // 1. 東北新幹線 E5系「はやぶさ」下り（約4分間隔・仮想ループ6,600m）
      {
        series: 'SHINKANSEN_E5',
        cars: 8,
        lat: -26.4,
        startD: 195,
        speedMps: 27.5,
        dir: 1,
        minWrapD: -2600,
        maxWrapD: 4000,
        isShinkansen: true,
      },
      // 2. 東北本線（宇都宮・高崎線）下り E231系1000番台・サロ連結 (-8.4m, 北行・約4分間隔)
      {
        series: 'UTSUNOMIYA',
        cars: 10,
        lat: -8.4,
        startD: 140,
        speedMps: 21.5,
        dir: 1,
        minWrapD: -2200,
        maxWrapD: 2960,
        isShinkansen: false,
      },
      // 3. 東北本線（上野東京ライン）上り E231系1000番台・サロ連結 (-4.6m, 南行・約4分間隔)
      {
        series: 'UTSUNOMIYA',
        cars: 10,
        lat: -4.6,
        startD: 1120,
        speedMps: 21.5,
        dir: -1,
        minWrapD: -2400,
        maxWrapD: 2760,
        isShinkansen: false,
      },
      // 4. 9番線：京浜東北線 南行 E233系1000番台 スカイブルー (-32.2m, 南行・約3.5分間隔)
      {
        series: 'KEIHIN',
        cars: 8,
        lat: -32.2,
        startD: 760,
        speedMps: 18.5,
        dir: -1,
        minWrapD: -1950,
        maxWrapD: 1950,
        isShinkansen: false,
      },
      // 5. 10番線：山手線 外回り E235系0番台 (-40.8m, 南行・約3分間隔)
      {
        series: 'YAMANOTE',
        cars: 8,
        lat: -40.8,
        startD: 185,
        speedMps: 16.5,
        dir: -1,
        minWrapD: -1500,
        maxWrapD: 1500,
        isShinkansen: false,
      },
      // 6. 11番線：山手線 内回り E235系0番台 (-45.0m, 北行・約3分間隔)
      {
        series: 'YAMANOTE',
        cars: 8,
        lat: -45.0,
        startD: -680,
        speedMps: 16.5,
        dir: 1,
        minWrapD: -1500,
        maxWrapD: 1500,
        isShinkansen: false,
      },
      // 7. 12番線：京浜東北線 北行 E233系1000番台 スカイブルー (-53.6m, 北行・約3.5分間隔)
      {
        series: 'KEIHIN',
        cars: 8,
        lat: -53.6,
        startD: -290,
        speedMps: 18.5,
        dir: 1,
        minWrapD: -1950,
        maxWrapD: 1950,
        isShinkansen: false,
      },
    ];

    for (const pCfg of parallelConfigs) {
      const meshes = this.rollingStock.createConsist(this.group, {
        series: pCfg.series,
        cars: pCfg.cars,
        headlightsOn: true,
      });
      this.parallelTrains.push({
        ...pCfg,
        d: pCfg.startD,
        meshes,
      });
    }
  }

  update(dt, elapsedTime, playerDistance, onTrainPassCallback) {
    if (this.waterMaterial && this.waterMaterial.normalMap) {
      this.waterMaterial.normalMap.offset.x = elapsedTime * 0.035;
      this.waterMaterial.normalMap.offset.y = elapsedTime * 0.018;
    }

    for (const light of this.obstructionLights) {
      const pulse = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(elapsedTime * 2.4 + light.phase));
      light.mat.color.setRGB(3.2 * pulse, 0.1 * pulse, 0.08 * pulse);
    }

    const basis = new THREE.Matrix4();
    const carForward = new THREE.Vector3();
    const carBack = new THREE.Vector3();
    const carRight = new THREE.Vector3();
    const carUp = new THREE.Vector3();

    const orientCarByBogies = (mesh, pFront, pRear) => {
      mesh.position.addVectors(pFront, pRear).multiplyScalar(0.5);
      carForward.subVectors(pFront, pRear);
      if (carForward.lengthSq() < 1e-8) return;
      carForward.normalize();
      carBack.copy(carForward).negate();
      carRight.crossVectors(carForward, WORLD_UP).normalize();
      carUp.crossVectors(carBack, carRight).normalize();
      basis.makeBasis(carRight, carUp, carBack);
      mesh.quaternion.setFromRotationMatrix(basis);
    };

    // 常磐線上り本線 対向列車（E531系・E231系0番台）の走行更新
    // 前後台車中心（±6.85m）を実際の上りS字曲線上に厳密追従させ、自然なヨー角・ピッチ角で車体が首を振る！
    for (const tr of this.oncomingTrains) {
      tr.headD -= tr.speedMps * dt;
      if (tr.headD < ROUTE_START_BUFFER - 240) {
        tr.headD += 9000;
        tr.passedPlayer = false;
      }

      if (!tr.passedPlayer && tr.headD <= playerDistance + 12 && tr.headD >= playerDistance - 45) {
        tr.passedPlayer = true;
        if (onTrainPassCallback) onTrainPassCallback();
      }

      const spacing = tr.carMeshes.carSpacing || 20.0;
      const halfBogie = 6.85;
      for (let c = 0; c < tr.cars; c++) {
        const carD = tr.headD + c * spacing;
        const mesh = tr.carMeshes[c];
        if (carD < ROUTE_START_BUFFER + 5 || carD > ROUTE_END_BUFFER - 5) {
          mesh.visible = false;
          continue;
        }
        mesh.visible = true;
        const pFront = this.route.getUpTrackPositionAt(carD - halfBogie);
        const pRear = this.route.getUpTrackPositionAt(carD + halfBogie);
        orientCarByBogies(mesh, pFront, pRear);
      }
    }

    // 日暮里14線メガコリドー（東北新幹線E5系・東北本線湘南色・京浜東北E233・山手線E235）走行更新
    const visibleNearNippori = playerDistance < 1400;
    for (const pt of this.parallelTrains) {
      pt.d += pt.dir * pt.speedMps * dt;
      if (pt.dir > 0 && pt.d > pt.maxWrapD) pt.d = pt.minWrapD;
      if (pt.dir < 0 && pt.d < pt.minWrapD) pt.d = pt.maxWrapD;

      const spacing = pt.meshes.carSpacing || 20.0;
      const halfBogie = pt.isShinkansen ? 8.75 : 6.85;
      for (let c = 0; c < pt.meshes.length; c++) {
        const mesh = pt.meshes[c];
        if (!visibleNearNippori) {
          mesh.visible = false;
          continue;
        }

        const cd = pt.d - pt.dir * c * spacing;
        if (pt.isShinkansen) {
          // 第1上野トンネル抗口(d=+28m)の暗闇奥(d=14m)より手前は地下トンネル内のため非表示！
          if (cd < 14 || cd > 455) {
            mesh.visible = false;
            continue;
          }
          mesh.visible = true;
          const pFront = this.route.getNipporiShinkansenPoint(cd + pt.dir * halfBogie, pt.lat).position;
          const pRear = this.route.getNipporiShinkansenPoint(cd - pt.dir * halfBogie, pt.lat).position;
          orientCarByBogies(mesh, pFront, pRear);
        } else {
          if (cd < -232 || cd > 425) {
            mesh.visible = false;
            continue;
          }
          mesh.visible = true;
          const pFront = this.route.getNipporiParallelPoint(cd + pt.dir * halfBogie, pt.lat).position;
          const pRear = this.route.getNipporiParallelPoint(cd - pt.dir * halfBogie, pt.lat).position;
          orientCarByBogies(mesh, pFront, pRear);
        }
      }
    }
  }
}
