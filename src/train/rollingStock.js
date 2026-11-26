import * as THREE from 'three';

/**
 * 超高精細 JR東日本 実車準拠ローリングストック・ファクトリー
 *   - 'E531'          : 常磐線 E531系0番台（白逆台形＋45°斜め青マスク・上部HID・クハ1-2扉間小窓・サロ2階建て連結）
 *   - 'E231'          : 常磐快速線 E231系0番台（緑2色帯の下に独立黒ライト帯・緑塗乗務員扉・クハE231-49準拠側面）
 *   - 'UTSUNOMIYA'    : 東北本線（宇都宮・高崎線 上野東京ライン）E231系1000番台 湘南色（サロ2階建て連結）
 *   - 'YAMANOTE'      : 山手線 E235系0番台（黒マスク＋ウグイスドット顔・縦ドットグラデ扉・腰帯なし）
 *   - 'KEIHIN'        : 京浜東北線 E233系1000番台（スカイブルー帯＋E233ブラックフェイス）
 *   - 'SHINKANSEN_E5' : 東北・北海道新幹線 E5系「はやぶさ」（常盤グリーン＋はやてピンク帯＋超ロングノーズ）
 */

// ---------------------------------------------------------------------------
// JR東日本 2,950mm 拡幅車体（裾絞り断面）共通プロファイル定義
// ---------------------------------------------------------------------------
const STD_SIDE_Y_MIN = 1.00;
const STD_SIDE_Y_MAX = 3.34;
const STD_SIDE_PROFILE = [
  [1.330, 1.00], // 0: 下端（裾絞り最下部：全幅 2,660mm）
  [1.356, 1.10], // 1
  [1.390, 1.22], // 2
  [1.425, 1.34], // 3
  [1.455, 1.44], // 4
  [1.471, 1.52], // 5: 裾絞り折り目R（腰帯下端に一致）
  [1.475, 1.62], // 6
  [1.475, 2.25], // 7: 客室窓面（最大幅 2,950mm）
  [1.475, 2.97], // 8: 客用ドア上端（ここまで物理的に窪む！）
  [1.475, 2.99], // 9: ドア鴨居エッジ（上は面一）
  [1.472, 3.14], // 10: 幕板上部
  [1.452, 3.25], // 11: 雨樋肩R
  [1.408, 3.34], // 12: 屋根接合端
];
const STD_DOOR_TOP_IDX = 8;

const STD_ROOF_PROFILE = [
  [1.408, 3.34],
  [1.240, 3.445],
  [0.920, 3.540],
  [0.480, 3.600],
  [0.000, 3.620],
  [-0.480, 3.600],
  [-0.920, 3.540],
  [-1.240, 3.445],
  [-1.408, 3.34],
];

// サロE531 / サロE231 2階建てグリーン車 裾絞り＋丸肩プロファイル（image_6.png 準拠）
const DD_SIDE_Y_MIN = 0.50;
const DD_SIDE_Y_MAX = 3.84;
const DD_SIDE_UPPER = [
  [1.362, 1.02], // 0: 平屋・台車上部の車体下端
  [1.442, 1.14], // 1
  [1.475, 1.26], // 2
  [1.475, 2.20], // 3
  [1.475, 3.13], // 4: デッキ扉上端（ここまで物理的に窪む！）
  [1.475, 3.16], // 5: 扉鴨居エッジ
  [1.456, 3.32], // 6: 2階窓の肩カーブ開始
  [1.405, 3.52], // 7
  [1.320, 3.70], // 8
  [1.195, 3.84], // 9
];
const DD_DOOR_TOP_IDX = 4;
const DD_SIDE_BELLY = [
  [1.265, 0.50], // 中央低床バスタブ底面（台車間のみ）
  [1.302, 0.68],
  [1.335, 0.85],
  [1.362, 1.02],
];
const DD_ROOF_PROFILE = [
  [1.195, 3.84],
  [0.920, 3.945],
  [0.480, 4.005],
  [0.000, 4.025],
  [-0.480, 4.005],
  [-0.920, 3.945],
  [-1.195, 3.84],
];

function computeProfileNormals(pts) {
  const n = pts.length;
  const normals = [];
  for (let i = 0; i < n; i++) {
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(n - 1, i + 1)];
    const dx = next[0] - prev[0];
    const dy = next[1] - prev[1];
    // +X側（右側面）の外向き法線：(dy, -dx)
    const len = Math.hypot(dx, dy) || 1;
    normals.push([dy / len, -dx / len]);
  }
  return normals;
}

/**
 * 側面プロファイルへ物理的な3Dドア窪み（戸袋段差・縦枠・上部鴨居）を自動構築する共通ビルダー
 */
function buildRecessedSideSegments({
  length,
  profile,
  pNorms,
  yMin,
  yMax,
  doorTopIdx,
  doorPixelRanges,
  cabOnRear,
  recessDepth,
  sideSign,
  addVert,
  targetIdx,
}) {
  const halfL = length * 0.5;
  const ySpan = yMax - yMin;
  const nPts = profile.length;

  // ドア位置（2048px座標系）を車両Z座標 [-halfL, +halfL] の昇順区間へ変換
  const doorIntervals = doorPixelRanges
    .map(([px0, px1]) => {
      const zA = cabOnRear ? halfL - (px1 / 2048) * length : -halfL + (px0 / 2048) * length;
      const zB = cabOnRear ? halfL - (px0 / 2048) * length : -halfL + (px1 / 2048) * length;
      return [Math.max(-halfL + 0.02, Math.min(zA, zB)), Math.min(halfL - 0.02, Math.max(zA, zB))];
    })
    .sort((a, b) => a[0] - b[0]);

  const segments = [];
  let cursor = -halfL;
  for (const [d0, d1] of doorIntervals) {
    if (d0 > cursor + 1e-4) segments.push({ z0: cursor, z1: d0, isDoor: false });
    if (d1 > d0 + 1e-4) segments.push({ z0: d0, z1: d1, isDoor: true });
    cursor = Math.max(cursor, d1);
  }
  if (halfL > cursor + 1e-4) segments.push({ z0: cursor, z1: halfL, isDoor: false });

  const uOfZ = (z) => (sideSign < 0 ? (z + halfL) / length : (halfL - z) / length);
  const vOfY = (y) => (y - yMin) / ySpan;

  // 指定法線方向へ厳密に表向きとなるクワッド出力（裏返りゼロ保証）
  const pushOrientedQuad = (p0, p1, p2, p3, nx, ny, nz, uv0, uv1, uv2, uv3) => {
    const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
    const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
    const cx = uy * vz - uz * vy;
    const cy = uz * vx - ux * vz;
    const cz = ux * vy - uy * vx;
    const dot = cx * nx + cy * ny + cz * nz;
    const a = addVert(p0[0], p0[1], p0[2], nx, ny, nz, uv0[0], uv0[1]);
    const b = addVert(p1[0], p1[1], p1[2], nx, ny, nz, uv1[0], uv1[1]);
    const c = addVert(p2[0], p2[1], p2[2], nx, ny, nz, uv2[0], uv2[1]);
    const d = addVert(p3[0], p3[1], p3[2], nx, ny, nz, uv3[0], uv3[1]);
    if (dot >= 0) {
      targetIdx.push(a, b, c, a, c, d);
    } else {
      targetIdx.push(a, c, b, a, d, c);
    }
  };

  const ptFlush = (i, z) => [sideSign * profile[i][0], profile[i][1], z];
  const ptRecess = (i, z) => {
    const [px, py] = profile[i];
    const [nx, ny] = pNorms[i];
    return [sideSign * (px - nx * recessDepth), py - ny * recessDepth, z];
  };

  const addRibbonRange = (z0, z1, iStart, iEnd, recessed) => {
    const base = targetIdx.length; // unused, using vertex count via addVert
    void base;
    const zA = sideSign < 0 ? z0 : z1;
    const zB = sideSign < 0 ? z1 : z0;
    const uA = uOfZ(zA);
    const uB = uOfZ(zB);
    const rowStart = [];
    for (let i = iStart; i <= iEnd; i++) {
      const [nx, ny] = pNorms[i];
      const pA = recessed ? ptRecess(i, zA) : ptFlush(i, zA);
      const pB = recessed ? ptRecess(i, zB) : ptFlush(i, zB);
      const v = vOfY(profile[i][1]);
      const vA = addVert(pA[0], pA[1], pA[2], sideSign * nx, ny, 0, uA, v);
      const vB = addVert(pB[0], pB[1], pB[2], sideSign * nx, ny, 0, uB, v);
      rowStart.push([vA, vB]);
    }
    for (let k = 0; k < rowStart.length - 1; k++) {
      const [a0, a1] = rowStart[k];
      const [b0, b1] = rowStart[k + 1];
      targetIdx.push(a0, a1, b1, a0, b1, b0);
    }
  };

  for (const seg of segments) {
    if (!seg.isDoor) {
      addRibbonRange(seg.z0, seg.z1, 0, nPts - 1, false);
    } else {
      // 1. 窪んだドア本体（裾絞りカーブに沿ったまま内側へ 4.2cm 凹む！）
      addRibbonRange(seg.z0, seg.z1, 0, doorTopIdx, true);
      // 2. ドアより上の幕板は面一のまま
      addRibbonRange(seg.z0, seg.z1, doorTopIdx + 1, nPts - 1, false);

      // 3. ドア上部の立体鴨居ソフィット（下向き法線でリアルな影が落ちる！）
      const pL0 = ptRecess(doorTopIdx, seg.z0);
      const pL1 = ptRecess(doorTopIdx, seg.z1);
      const pU1 = ptFlush(doorTopIdx + 1, seg.z1);
      const pU0 = ptFlush(doorTopIdx + 1, seg.z0);
      const vTop = vOfY(profile[doorTopIdx][1]);
      pushOrientedQuad(
        pL0,
        pL1,
        pU1,
        pU0,
        0,
        -1,
        0,
        [uOfZ(seg.z0), vTop],
        [uOfZ(seg.z1), vTop],
        [uOfZ(seg.z1), vTop],
        [uOfZ(seg.z0), vTop]
      );

      // 4. 左右の立体ドア縦戸袋枠（z = z0 側は +Z 向き、z = z1 側は -Z 向き）
      for (const [zEdge, nz] of [
        [seg.z0, +1],
        [seg.z1, -1],
      ]) {
        const uE = uOfZ(zEdge);
        for (let i = 0; i < doorTopIdx; i++) {
          const f0 = ptFlush(i, zEdge);
          const f1 = ptFlush(i + 1, zEdge);
          const r1 = ptRecess(i + 1, zEdge);
          const r0 = ptRecess(i, zEdge);
          const v0 = vOfY(profile[i][1]);
          const v1 = vOfY(profile[i + 1][1]);
          pushOrientedQuad(f0, f1, r1, r0, 0, 0, nz, [uE, v0], [uE, v1], [uE, v1], [uE, v0]);
        }
        // 上端コーナーステップを閉じる三角面
        const fT0 = ptFlush(doorTopIdx, zEdge);
        const fT1 = ptFlush(doorTopIdx + 1, zEdge);
        const rT0 = ptRecess(doorTopIdx, zEdge);
        const vT0 = vOfY(profile[doorTopIdx][1]);
        const vT1 = vOfY(profile[doorTopIdx + 1][1]);
        pushOrientedQuad(fT0, fT1, rT0, rT0, 0, 0, nz, [uE, vT0], [uE, vT1], [uE, vT0], [uE, vT0]);
      }
    }
  }
}

/**
 * 一般4扉車：裾絞り側面＋物理3Dドア窪みをボディ本体と完全一体化したマルチマテリアル3Dジオメトリ
 *   group 0 : 屋根・妻面・床下面（stainlessMat）
 *   group 1 : 左側面（x < 0, 裾絞り曲面＋3Dドア窪み＋正確UV）
 *   group 2 : 右側面（x > 0, 裾絞り曲面＋3Dドア窪み＋正確UV）
 */
function createStandardWideBodyGeometry(length = 19.46, doorPixelRanges = [], cabOnRear = false) {
  const halfL = length * 0.5;
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices0 = []; // roof + ends + underbelly
  const indices1 = []; // left side (x < 0)
  const indices2 = []; // right side (x > 0)

  const addVert = (x, y, z, nx, ny, nz, u, v) => {
    const idx = positions.length / 3;
    positions.push(x, y, z);
    normals.push(nx, ny, nz);
    uvs.push(u, v);
    return idx;
  };

  const sideNorms = computeProfileNormals(STD_SIDE_PROFILE);

  // 1 & 2. 左右の裾絞り側面（全客用扉・乗務員扉を 4.2cm 物理的に窪ませる！）
  buildRecessedSideSegments({
    length,
    profile: STD_SIDE_PROFILE,
    pNorms: sideNorms,
    yMin: STD_SIDE_Y_MIN,
    yMax: STD_SIDE_Y_MAX,
    doorTopIdx: STD_DOOR_TOP_IDX,
    doorPixelRanges,
    cabOnRear,
    recessDepth: 0.042,
    sideSign: -1,
    addVert,
    targetIdx: indices1,
  });
  buildRecessedSideSegments({
    length,
    profile: STD_SIDE_PROFILE,
    pNorms: sideNorms,
    yMin: STD_SIDE_Y_MIN,
    yMax: STD_SIDE_Y_MAX,
    doorTopIdx: STD_DOOR_TOP_IDX,
    doorPixelRanges,
    cabOnRear,
    recessDepth: 0.042,
    sideSign: +1,
    addVert,
    targetIdx: indices2,
  });

  // 3. 屋根曲面 (group 0)
  {
    const roofNorms = computeProfileNormals(STD_ROOF_PROFILE);
    const base = positions.length / 3;
    const nPts = STD_ROOF_PROFILE.length;
    for (let i = 0; i < nPts; i++) {
      const [px, py] = STD_ROOF_PROFILE[i];
      const [nx, ny] = roofNorms[i];
      const u = i / (nPts - 1);
      addVert(px, py, +halfL, nx, ny, 0, u, 0);
      addVert(px, py, -halfL, nx, ny, 0, u, 1);
    }
    for (let i = 0; i < nPts - 1; i++) {
      const a0 = base + i * 2;
      const a1 = a0 + 1;
      const b0 = a0 + 2;
      const b1 = a0 + 3;
      indices0.push(a0, a1, b1, a0, b1, b0);
    }
  }

  // 4. 床下面 (y = 1.00, 法線 -Y, group 0)
  {
    const bx = STD_SIDE_PROFILE[0][0];
    const by = STD_SIDE_PROFILE[0][1];
    const b0 = addVert(-bx, by, -halfL, 0, -1, 0, 0, 0);
    const b1 = addVert(+bx, by, -halfL, 0, -1, 0, 1, 0);
    const b2 = addVert(+bx, by, +halfL, 0, -1, 0, 1, 1);
    const b3 = addVert(-bx, by, +halfL, 0, -1, 0, 0, 1);
    indices0.push(b0, b1, b2, b0, b2, b3);
  }

  // 5. 前後妻面キャップ（裾絞り＋丸屋根の閉じた断面、連結面も隙間ゼロ）
  const ring = [];
  for (let i = 0; i < STD_SIDE_PROFILE.length; i++) ring.push(STD_SIDE_PROFILE[i]);
  for (let i = 1; i < STD_ROOF_PROFILE.length - 1; i++) ring.push(STD_ROOF_PROFILE[i]);
  for (let i = STD_SIDE_PROFILE.length - 1; i >= 0; i--) {
    ring.push([-STD_SIDE_PROFILE[i][0], STD_SIDE_PROFILE[i][1]]);
  }

  for (const zSign of [-1, 1]) {
    const zVal = zSign * halfL;
    const cIdx = addVert(0, 2.25, zVal, 0, 0, zSign, 0.5, 0.5);
    const startIdx = positions.length / 3;
    for (const [rx, ry] of ring) {
      addVert(rx, ry, zVal, 0, 0, zSign, (rx + 1.5) / 3.0, (ry - 1.0) / 2.65);
    }
    const m = ring.length;
    for (let i = 0; i < m; i++) {
      const i0 = startIdx + i;
      const i1 = startIdx + ((i + 1) % m);
      if (zSign > 0) {
        indices0.push(cIdx, i0, i1);
      } else {
        indices0.push(cIdx, i1, i0);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));

  const allIndices = [...indices0, ...indices1, ...indices2];
  geo.setIndex(allIndices);
  geo.addGroup(0, indices0.length, 0);
  geo.addGroup(indices0.length, indices1.length, 1);
  geo.addGroup(indices0.length + indices1.length, indices2.length, 2);
  return geo;
}

/**
 * サロE531 / サロE231 2階建てグリーン車：台車上切り欠き＋低床バスタブ＋物理3Dデッキ扉窪み
 *   group 0 : 屋根・妻面・床下・斜めバスタブ端壁（stainlessMat）
 *   group 1 : 左側面（x < 0）
 *   group 2 : 右側面（x > 0）
 */
function createDoubleDeckerWideBodyGeometry(length = 19.46) {
  const halfL = length * 0.5;
  const wellTopHalf = 5.32; // 台車手前の斜め下がり開始位置 (image_6.png 準拠)
  const wellBotHalf = 4.92; // 低床底面の前後端
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices0 = [];
  const indices1 = [];
  const indices2 = [];

  const addVert = (x, y, z, nx, ny, nz, u, v) => {
    const idx = positions.length / 3;
    positions.push(x, y, z);
    normals.push(nx, ny, nz);
    uvs.push(u, v);
    return idx;
  };

  const ySpan = DD_SIDE_Y_MAX - DD_SIDE_Y_MIN;
  const upperNorms = computeProfileNormals(DD_SIDE_UPPER);
  const bellyNorms = computeProfileNormals(DD_SIDE_BELLY);

  const addSideRibbon = (profile, pNorms, zStartFn, zEndFn, sideSign, targetIdx) => {
    const base = positions.length / 3;
    const nPts = profile.length;
    for (let i = 0; i < nPts; i++) {
      const [px, py] = profile[i];
      const [nx, ny] = pNorms[i];
      const v = (py - DD_SIDE_Y_MIN) / ySpan;
      const zA = zStartFn(py);
      const zB = zEndFn(py);
      if (sideSign < 0) {
        addVert(-px, py, zA, -nx, ny, 0, (zA + halfL) / length, v);
        addVert(-px, py, zB, -nx, ny, 0, (zB + halfL) / length, v);
      } else {
        addVert(+px, py, zB, +nx, ny, 0, (halfL - zB) / length, v);
        addVert(+px, py, zA, +nx, ny, 0, (halfL - zA) / length, v);
      }
    }
    for (let i = 0; i < nPts - 1; i++) {
      const a0 = base + i * 2;
      const a1 = a0 + 1;
      const b0 = a0 + 2;
      const b1 = a0 + 3;
      targetIdx.push(a0, a1, b1, a0, b1, b0);
    }
  };

  // 上部全体 (y = 1.02 .. 3.84)：両端の片開きデッキ扉を 4.0cm 物理的に窪ませる！
  const ddDoors = [
    [404, 492],
    [2048 - 492, 2048 - 404],
  ];
  buildRecessedSideSegments({
    length,
    profile: DD_SIDE_UPPER,
    pNorms: upperNorms,
    yMin: DD_SIDE_Y_MIN,
    yMax: DD_SIDE_Y_MAX,
    doorTopIdx: DD_DOOR_TOP_IDX,
    doorPixelRanges: ddDoors,
    cabOnRear: false,
    recessDepth: 0.04,
    sideSign: -1,
    addVert,
    targetIdx: indices1,
  });
  buildRecessedSideSegments({
    length,
    profile: DD_SIDE_UPPER,
    pNorms: upperNorms,
    yMin: DD_SIDE_Y_MIN,
    yMax: DD_SIDE_Y_MAX,
    doorTopIdx: DD_DOOR_TOP_IDX,
    doorPixelRanges: ddDoors,
    cabOnRear: false,
    recessDepth: 0.04,
    sideSign: +1,
    addVert,
    targetIdx: indices2,
  });

  // 中央低床バスタブ部 (y = 0.50 .. 1.02, 台車間のみ斜めカット付き！)
  const wellZ = (py) => {
    const t = (py - 0.50) / (1.02 - 0.50);
    return wellBotHalf + (wellTopHalf - wellBotHalf) * t;
  };
  addSideRibbon(DD_SIDE_BELLY, bellyNorms, (py) => -wellZ(py), (py) => +wellZ(py), -1, indices1);
  addSideRibbon(DD_SIDE_BELLY, bellyNorms, (py) => -wellZ(py), (py) => +wellZ(py), +1, indices2);

  // 屋根曲面 (group 0)
  {
    const roofNorms = computeProfileNormals(DD_ROOF_PROFILE);
    const base = positions.length / 3;
    const nPts = DD_ROOF_PROFILE.length;
    for (let i = 0; i < nPts; i++) {
      const [px, py] = DD_ROOF_PROFILE[i];
      const [nx, ny] = roofNorms[i];
      const u = i / (nPts - 1);
      addVert(px, py, +halfL, nx, ny, 0, u, 0);
      addVert(px, py, -halfL, nx, ny, 0, u, 1);
    }
    for (let i = 0; i < nPts - 1; i++) {
      const a0 = base + i * 2;
      const a1 = a0 + 1;
      const b0 = a0 + 2;
      const b1 = a0 + 3;
      indices0.push(a0, a1, b1, a0, b1, b0);
    }
  }

  // 床下面（台車上2箇所 + 低床中央部 + 斜め仕切り壁2箇所）
  const pushQuad0 = (p0, p1, p2, p3, nx, ny, nz) => {
    const a = addVert(p0[0], p0[1], p0[2], nx, ny, nz, 0, 0);
    const b = addVert(p1[0], p1[1], p1[2], nx, ny, nz, 1, 0);
    const c = addVert(p2[0], p2[1], p2[2], nx, ny, nz, 1, 1);
    const d = addVert(p3[0], p3[1], p3[2], nx, ny, nz, 0, 1);
    indices0.push(a, b, c, a, c, d);
  };
  const endX = DD_SIDE_UPPER[0][0];
  const botX = DD_SIDE_BELLY[0][0];
  // 前後台車上床面 (y = 1.02)
  pushQuad0([-endX, 1.02, -halfL], [endX, 1.02, -halfL], [endX, 1.02, -wellTopHalf], [-endX, 1.02, -wellTopHalf], 0, -1, 0);
  pushQuad0([-endX, 1.02, wellTopHalf], [endX, 1.02, wellTopHalf], [endX, 1.02, halfL], [-endX, 1.02, halfL], 0, -1, 0);
  // 低床中央底面 (y = 0.50)
  pushQuad0([-botX, 0.50, -wellBotHalf], [botX, 0.50, -wellBotHalf], [botX, 0.50, wellBotHalf], [-botX, 0.50, wellBotHalf], 0, -1, 0);
  // 前後斜めバスタブ端壁
  pushQuad0([-endX, 1.02, -wellTopHalf], [endX, 1.02, -wellTopHalf], [botX, 0.50, -wellBotHalf], [-botX, 0.50, -wellBotHalf], 0, -0.5, -0.86);
  pushQuad0([endX, 1.02, wellTopHalf], [-endX, 1.02, wellTopHalf], [-botX, 0.50, wellBotHalf], [botX, 0.50, wellBotHalf], 0, -0.5, 0.86);

  // 前後妻面キャップ
  const ring = [];
  for (let i = 0; i < DD_SIDE_UPPER.length; i++) ring.push(DD_SIDE_UPPER[i]);
  for (let i = 1; i < DD_ROOF_PROFILE.length - 1; i++) ring.push(DD_ROOF_PROFILE[i]);
  for (let i = DD_SIDE_UPPER.length - 1; i >= 0; i--) {
    ring.push([-DD_SIDE_UPPER[i][0], DD_SIDE_UPPER[i][1]]);
  }
  for (const zSign of [-1, 1]) {
    const zVal = zSign * halfL;
    const cIdx = addVert(0, 2.45, zVal, 0, 0, zSign, 0.5, 0.5);
    const startIdx = positions.length / 3;
    for (const [rx, ry] of ring) {
      addVert(rx, ry, zVal, 0, 0, zSign, (rx + 1.5) / 3.0, (ry - 1.0) / 3.0);
    }
    const m = ring.length;
    for (let i = 0; i < m; i++) {
      const i0 = startIdx + i;
      const i1 = startIdx + ((i + 1) % m);
      if (zSign > 0) indices0.push(cIdx, i0, i1);
      else indices0.push(cIdx, i1, i0);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  const allIndices = [...indices0, ...indices1, ...indices2];
  geo.setIndex(allIndices);
  geo.addGroup(0, indices0.length, 0);
  geo.addGroup(indices0.length, indices1.length, 1);
  geo.addGroup(indices0.length + indices1.length, indices2.length, 2);
  return geo;
}

/**
 * 車体と同じ裾絞り＋丸屋根断面から前頭へ滑らかに絞り込む3D FRP先頭シェル＆前面キャップ
 */
function createCabNoseGeometries() {
  // 閉じた断面リング（反時計回り：下辺 → 右側裾絞り → 屋根 → 左側裾絞り）
  const baseRing = [];
  baseRing.push([0.0, 1.00]);
  baseRing.push([0.75, 1.00]);
  for (const pt of STD_SIDE_PROFILE) baseRing.push([pt[0], pt[1]]);
  for (let i = 1; i < STD_ROOF_PROFILE.length - 1; i++) baseRing.push(STD_ROOF_PROFILE[i]);
  for (let i = STD_SIDE_PROFILE.length - 1; i >= 0; i--) {
    baseRing.push([-STD_SIDE_PROFILE[i][0], STD_SIDE_PROFILE[i][1]]);
  }
  baseRing.push([-0.75, 1.00]);

  const M = baseRing.length;
  const yc = 2.26;

  // 前面の微後退角（上部がわずかに後ろへ倒れる現代JR東日本の精悍な輪郭）
  const zFrontOfY = (y) => -0.32 + Math.max(0, (y - 1.80) * 0.045);

  const N = 7;
  const sPos = [];
  const sUv = [];
  const sIdx = [];
  const frontPts = [];
  const ySideSpan = STD_SIDE_Y_MAX - STD_SIDE_Y_MIN;

  for (let i = 0; i <= N; i++) {
    const t = i / N;
    // 前縁に向かって滑らかなR面取り
    const bevel = Math.pow(t, 2.8);
    const scaleX = 1.0 - 0.032 * bevel;
    const scaleY = 1.0 - 0.022 * bevel;
    for (let m = 0; m < M; m++) {
      const [bx, by] = baseRing[m];
      const x = bx * scaleX;
      const y = yc + (by - yc) * scaleY;
      const zEnd = zFrontOfY(y);
      const z = 0.02 * (1 - t) + zEnd * t;
      sPos.push(x, y, z);
      // 側面頬部のみ帯を連続させるため、屋根上・床下は v=0.99 にクランプ
      const isCheek = Math.abs(bx) > 1.20 && by <= STD_SIDE_Y_MAX + 0.02;
      const v = isCheek ? Math.min(1, Math.max(0, (y - STD_SIDE_Y_MIN) / ySideSpan)) : 0.99;
      sUv.push(t, v);
      if (i === N) frontPts.push([x, y, z]);
    }
  }
  for (let i = 0; i < N; i++) {
    for (let m = 0; m < M; m++) {
      const a0 = i * M + m;
      const a1 = i * M + ((m + 1) % M);
      const b0 = (i + 1) * M + m;
      const b1 = (i + 1) * M + ((m + 1) % M);
      sIdx.push(a0, a1, b1, a0, b1, b0);
    }
  }
  const shroudGeo = new THREE.BufferGeometry();
  shroudGeo.setAttribute('position', new THREE.Float32BufferAttribute(sPos, 3));
  shroudGeo.setAttribute('uv', new THREE.Float32BufferAttribute(sUv, 2));
  shroudGeo.setIndex(sIdx);
  shroudGeo.computeVertexNormals();

  // 前面キャップ（裾絞り外周そのままに顔テクスチャを正確にマッピング・法線は厳密に -Z 外向き）
  const cPos = [];
  const cNorm = [];
  const cUv = [];
  const cIdx = [];
  const yCapMin = 1.00;
  const yCapMax = 3.52;
  const yCapSpan = yCapMax - yCapMin;
  const wCap = 2.86;

  const pushCapV = (x, y, z) => {
    const idx = cPos.length / 3;
    cPos.push(x, y, z - 0.004);
    const ny = y > 1.80 ? 0.045 : 0.0;
    const nl = Math.hypot(ny, 1);
    cNorm.push(0, ny / nl, -1 / nl);
    // -Z方向から見て +X が画面左(u=0), -X が画面右(u=1)
    const u = Math.min(1, Math.max(0, 0.5 - x / wCap));
    const v = Math.min(1, Math.max(0, (y - yCapMin) / yCapSpan));
    cUv.push(u, v);
    return idx;
  };

  // 中央点 + 外周リング（三角形の向きを外積のZ成分<0で厳密保証）
  const centerV = pushCapV(0, yc, zFrontOfY(yc));
  const ringStart = cPos.length / 3;
  for (const [fx, fy, fz] of frontPts) {
    pushCapV(fx, fy, fz);
  }
  for (let m = 0; m < M; m++) {
    const pA = frontPts[m];
    const pB = frontPts[(m + 1) % M];
    const crossZ = pA[0] * (pB[1] - yc) - (pA[1] - yc) * pB[0];
    const iA = ringStart + m;
    const iB = ringStart + ((m + 1) % M);
    if (crossZ < 0) {
      cIdx.push(centerV, iA, iB);
    } else {
      cIdx.push(centerV, iB, iA);
    }
  }

  const capGeo = new THREE.BufferGeometry();
  capGeo.setAttribute('position', new THREE.Float32BufferAttribute(cPos, 3));
  capGeo.setAttribute('normal', new THREE.Float32BufferAttribute(cNorm, 3));
  capGeo.setAttribute('uv', new THREE.Float32BufferAttribute(cUv, 2));
  capGeo.setIndex(cIdx);

  return { shroudGeo, capGeo, zFrontOfY };
}

// ---------------------------------------------------------------------------
// 前面マスク 1024x1024 PBR テクスチャ生成（全形式：E531 / E231 / UTSUNOMIYA / YAMANOTE / KEIHIN）
// ---------------------------------------------------------------------------
function createFrontMaskTextures(series) {
  const S = 1024;
  const cCanvas = document.createElement('canvas');
  cCanvas.width = S;
  cCanvas.height = S;
  const ctx = cCanvas.getContext('2d');

  const eCanvas = document.createElement('canvas');
  eCanvas.width = S;
  eCanvas.height = S;
  const eCtx = eCanvas.getContext('2d');
  eCtx.fillStyle = '#000000';
  eCtx.fillRect(0, 0, S, S);

  const rCanvas = document.createElement('canvas');
  rCanvas.width = S;
  rCanvas.height = S;
  const rCtx = rCanvas.getContext('2d');
  rCtx.fillStyle = '#484848';
  rCtx.fillRect(0, 0, S, S);

  const mCanvas = document.createElement('canvas');
  mCanvas.width = S;
  mCanvas.height = S;
  const mCtx = mCanvas.getContext('2d');
  mCtx.fillStyle = '#181818'; // FRP部は低メタリック
  mCtx.fillRect(0, 0, S, S);

  const ccCanvas = document.createElement('canvas');
  ccCanvas.width = S;
  ccCanvas.height = S;
  const ccCtx = ccCanvas.getContext('2d');
  ccCtx.fillStyle = '#000000';
  ccCtx.fillRect(0, 0, S, S);

  // 共通：全車両統一の「真っ黒塗りつぶし＋鏡面仕上げ」前面ガラス
  const drawCabWindshield = (gx, gy, gw, gh, badgeText, badgeCol) => {
    ctx.fillStyle = '#000002'; // 漆黒ベース（真っ黒塗りつぶし）
    ctx.fillRect(gx, gy, gw, gh);

    // 極低粗さ＋クリアコート鏡面仕上げ（黒の深みを保ちつつ鋭い空・光沢反射）
    rCtx.fillStyle = '#030303';
    rCtx.fillRect(gx, gy, gw, gh);
    mCtx.fillStyle = '#000000';
    mCtx.fillRect(gx, gy, gw, gh);
    ccCtx.fillStyle = '#d8d8d8';
    ccCtx.fillRect(gx, gy, gw, gh);

    // 左上の編成番号札
    if (badgeText) {
      ctx.fillStyle = badgeCol || '#1d4475';
      ctx.fillRect(gx + 22, gy + 18, 92, 38);
      mCtx.fillStyle = '#181818';
      mCtx.fillRect(gx + 22, gy + 18, 92, 38);
      rCtx.fillStyle = '#555555';
      rCtx.fillRect(gx + 22, gy + 18, 92, 38);
      ctx.fillStyle = '#d4e8ff';
      ctx.font = '700 26px "JetBrains Mono", monospace';
      ctx.fillText(badgeText, gx + 31, gy + 46);
    }
  };

  if (series === 'E531') {
    // === image_4.png 完全準拠：E531系0番台 正面 ===
    ctx.fillStyle = '#f2f5f8';
    ctx.fillRect(0, 0, S, S);

    // 下端の無塗装ステンレス裾ステップ段差 (y=860..1024) — 金属銀色！
    const stepGrad = ctx.createLinearGradient(0, 858, 0, S);
    stepGrad.addColorStop(0, '#c8d1da');
    stepGrad.addColorStop(0.18, '#edf2f7');
    stepGrad.addColorStop(0.55, '#d6dee6');
    stepGrad.addColorStop(1, '#aeb7c2');
    ctx.fillStyle = stepGrad;
    ctx.fillRect(0, 860, S, S - 860);
    mCtx.fillStyle = '#dcdcdc';
    mCtx.fillRect(0, 860, S, S - 860);
    rCtx.fillStyle = '#383838';
    rCtx.fillRect(0, 860, S, S - 860);

    // ブラックフェイス外枠（上辺アーチ型角丸パネル）
    ctx.fillStyle = '#111419';
    ctx.beginPath();
    ctx.moveTo(64, 678);
    ctx.lineTo(64, 122);
    ctx.quadraticCurveTo(64, 62, 134, 56);
    ctx.quadraticCurveTo(S * 0.5, 34, S - 134, 56);
    ctx.quadraticCurveTo(S - 64, 62, S - 64, 122);
    ctx.lineTo(S - 64, 678);
    ctx.closePath();
    ctx.fill();

    // 上部 LED 行先表示器
    ctx.fillStyle = '#090b0f';
    ctx.beginPath();
    ctx.roundRect(245, 74, S - 490, 72, 10);
    ctx.fill();

    eCtx.fillStyle = '#ff9626';
    eCtx.font = '700 32px "JetBrains Mono", monospace';
    eCtx.fillText('3184M', 268, 121);
    eCtx.fillStyle = '#ff4434';
    eCtx.fillRect(398, 86, 146, 46);
    eCtx.fillStyle = '#ffffff';
    eCtx.font = '700 30px "Noto Sans JP", sans-serif';
    eCtx.fillText('特別快速', 410, 120);
    eCtx.fillStyle = '#ffaa33';
    eCtx.font = '700 38px "Noto Sans JP", sans-serif';
    eCtx.fillText('上 野', 575, 122);

    // 左右おでこの丸型HIDヘッドライト＋内側赤尾灯
    for (const side of [-1, 1]) {
      const hx = S * 0.5 + side * 372;
      const hy = 110;
      ctx.fillStyle = '#eef8ff';
      ctx.beginPath();
      ctx.arc(hx, hy, 20, 0, Math.PI * 2);
      ctx.fill();

      eCtx.fillStyle = '#e8f7ff';
      eCtx.beginPath();
      eCtx.arc(hx, hy, 22, 0, Math.PI * 2);
      eCtx.fill();

      ctx.fillStyle = '#401418';
      ctx.beginPath();
      ctx.arc(hx - side * 46, hy + 2, 12, 0, Math.PI * 2);
      ctx.fill();
    }

    drawCabWindshield(84, 162, S - 168, 398, 'K409', '#1d3b66');

    // 窓下ブラックエプロンの白い JR マーク（image_4.png 右下）
    ctx.fillStyle = '#f2f6fa';
    ctx.font = 'italic 900 44px "Inter", sans-serif';
    ctx.fillText('JR', S - 172, 654);

    // 中央の白い逆台形＋左右両端45°斜めコバルトブルー
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 682, S, 178);

    ctx.fillStyle = '#0056b0';
    ctx.beginPath();
    ctx.moveTo(0, 682);
    ctx.lineTo(140, 682);
    ctx.lineTo(276, 860);
    ctx.lineTo(0, 860);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(S, 682);
    ctx.lineTo(S - 140, 682);
    ctx.lineTo(S - 276, 860);
    ctx.lineTo(S, 860);
    ctx.closePath();
    ctx.fill();

    // 下段ステンレスとの段差影ライン
    ctx.fillStyle = 'rgba(20, 26, 34, 0.45)';
    ctx.fillRect(0, 858, S, 5);
  } else if (series === 'E231') {
    // === image_3.png 完全準拠：E231系0番台（常磐快速 1585H）正面 ===
    ctx.fillStyle = '#eff2f5';
    ctx.fillRect(0, 0, S, S);

    ctx.fillStyle = '#14181d';
    ctx.beginPath();
    ctx.roundRect(60, 56, S - 120, 520, 38);
    ctx.fill();

    ctx.fillStyle = '#0a0d10';
    ctx.fillRect(126, 80, 162, 56);
    ctx.fillRect(354, 76, 316, 64);

    eCtx.fillStyle = '#ff9828';
    eCtx.font = '700 38px "JetBrains Mono", monospace';
    eCtx.fillText('1482H', 140, 122);

    eCtx.fillStyle = '#ff9e2c';
    eCtx.font = '700 44px "Noto Sans JP", sans-serif';
    eCtx.fillText('上  野', 446, 120);
    eCtx.font = '600 18px "Inter", sans-serif';
    eCtx.fillText('Ueno', 488, 137);

    drawCabWindshield(84, 162, S - 168, 356, '134', '#255285');

    // ガラス下端の手すりステップ溝
    ctx.fillStyle = '#0c0f12';
    ctx.fillRect(84, 526, S - 168, 24);

    // エメラルドグリーン（JR青緑1号・シアン系）＋ウグイス黄緑 2色帯＋白 JR マーク
    ctx.fillStyle = '#00b8a8';
    ctx.fillRect(0, 610, S, 94);
    ctx.fillStyle = '#76c448';
    ctx.fillRect(0, 704, S, 40);

    ctx.fillStyle = '#f5f8fa';
    ctx.font = 'italic 900 46px "Inter", sans-serif';
    ctx.fillText('JR', S - 182, 692);

    // 緑2色帯の下に独立した横長ブラックライトケース帯（image_3.png！）
    ctx.fillStyle = '#13161b';
    ctx.beginPath();
    ctx.roundRect(80, 774, S - 160, 92, 18);
    ctx.fill();

    for (const side of [-1, 1]) {
      const innerX = S * 0.5 + side * 240;
      const outerX = S * 0.5 + side * 340;

      ctx.fillStyle = '#fff4d6';
      ctx.beginPath();
      ctx.roundRect(innerX - 36, 792, 72, 56, 8);
      ctx.fill();

      eCtx.fillStyle = '#ffebbd';
      eCtx.beginPath();
      eCtx.roundRect(innerX - 36, 792, 72, 56, 8);
      eCtx.fill();

      ctx.fillStyle = '#3c1418';
      ctx.fillRect(outerX - 28, 798, 56, 44);
    }

    ctx.fillStyle = '#e8edf1';
    ctx.fillRect(0, 872, S, S - 872);
  } else if (series === 'UTSUNOMIYA') {
    // === 東北本線（宇都宮・高崎線 上野東京ライン）E231系1000番台 湘南色 ===
    ctx.fillStyle = '#eef2f6';
    ctx.fillRect(0, 0, S, S);

    ctx.fillStyle = '#13171d';
    ctx.beginPath();
    ctx.roundRect(62, 52, S - 124, 566, 42);
    ctx.fill();

    eCtx.fillStyle = '#ff9828';
    eCtx.font = '700 34px monospace';
    eCtx.fillText('1588E', 175, 118);
    eCtx.fillStyle = '#00a859';
    eCtx.fillRect(365, 78, 178, 46);
    eCtx.fillStyle = '#ffffff';
    eCtx.font = '700 25px sans-serif';
    eCtx.fillText('上野東京ライン', 374, 110);
    eCtx.fillStyle = '#ffaa33';
    eCtx.font = '700 36px sans-serif';
    eCtx.fillText('小田原', 575, 116);

    for (const side of [-1, 1]) {
      eCtx.fillStyle = '#eef8ff';
      eCtx.beginPath();
      eCtx.arc(S * 0.5 + side * 368, 106, 21, 0, Math.PI * 2);
      eCtx.fill();
    }

    drawCabWindshield(84, 160, S - 168, 384, 'U524', '#1d4c36');

    ctx.fillStyle = '#f2f6fa';
    ctx.font = 'italic 900 44px "Inter", sans-serif';
    ctx.fillText('JR', S - 175, 600);

    // 湘南色（緑＋オレンジ＋緑）前面帯
    ctx.fillStyle = '#00703c';
    ctx.fillRect(0, 646, S, 64);
    ctx.fillStyle = '#ee7800';
    ctx.fillRect(0, 710, S, 86);
    ctx.fillStyle = '#00703c';
    ctx.fillRect(0, 796, S, 44);

    // 下段ステンレスステップ
    ctx.fillStyle = '#d6dee6';
    ctx.fillRect(0, 862, S, S - 862);
    mCtx.fillStyle = '#d8d8d8';
    mCtx.fillRect(0, 862, S, S - 862);
  } else if (series === 'YAMANOTE') {
    // === 山手線 E235系0番台（象徴的な黒フェイス＋ウグイス色ドットグラデーション額縁！） ===
    ctx.fillStyle = '#121519';
    ctx.fillRect(0, 0, S, S);

    ctx.strokeStyle = '#dce2e8';
    ctx.lineWidth = 28;
    ctx.strokeRect(20, 20, S - 40, S - 40);
    mCtx.strokeStyle = '#d8d8d8';
    mCtx.lineWidth = 28;
    mCtx.strokeRect(20, 20, S - 40, S - 40);

    // 窓下ウグイス色（#80c342）ドットマトリクス・グラデーション帯
    for (let row = 0; row < 15; row++) {
      const ratio = 1.0 - Math.abs(row - 7.0) / 8.0;
      const dotSize = Math.max(4, ratio * 15);
      ctx.fillStyle = '#80c342';
      for (let col = 0; col < 44; col++) {
        const dx = 66 + col * 20.5;
        const dy = 620 + row * 18.5;
        ctx.fillRect(dx, dy, dotSize, dotSize);
      }
    }

    eCtx.fillStyle = '#ffffff';
    eCtx.font = '700 36px sans-serif';
    eCtx.fillText('東京・品川方面', 378, 118);

    for (const side of [-1, 1]) {
      eCtx.fillStyle = '#f2f8ff';
      eCtx.beginPath();
      eCtx.roundRect(S * 0.5 + side * 355 - 30, 80, 60, 46, 14);
      eCtx.fill();
    }

    drawCabWindshield(84, 160, S - 168, 412, 'トウ08', '#2a4a24');

    ctx.fillStyle = '#f2f6fa';
    ctx.font = 'italic 900 42px "Inter", sans-serif';
    ctx.fillText('JR', S - 172, 604);
  } else if (series === 'KEIHIN') {
    // === 京浜東北線 E233系1000番台（ブラックフェイス＋スカイブルー帯＋上部HIDライト！） ===
    ctx.fillStyle = '#edf1f5';
    ctx.fillRect(0, 0, S, S);

    ctx.fillStyle = '#13171d';
    ctx.beginPath();
    ctx.roundRect(56, 48, S - 112, 588, 34);
    ctx.fill();

    eCtx.fillStyle = '#00a8e8';
    eCtx.fillRect(345, 78, 115, 46);
    eCtx.fillStyle = '#ffffff';
    eCtx.font = '700 28px sans-serif';
    eCtx.fillText('快 速', 364, 111);
    eCtx.fillText('大 船', 495, 113);

    for (const side of [-1, 1]) {
      eCtx.fillStyle = '#ecf7ff';
      eCtx.beginPath();
      eCtx.arc(S * 0.5 + side * 368, 104, 22, 0, Math.PI * 2);
      eCtx.fill();
    }

    drawCabWindshield(84, 156, S - 168, 396, '134', '#005b8a');

    ctx.fillStyle = '#f5f8fa';
    ctx.font = 'italic 900 44px "Inter", sans-serif';
    ctx.fillText('JR', S - 172, 616);

    ctx.fillStyle = '#00a0de';
    ctx.fillRect(0, 646, S, 158);

    ctx.fillStyle = '#d6dee6';
    ctx.fillRect(0, 858, S, S - 858);
    mCtx.fillStyle = '#d8d8d8';
    mCtx.fillRect(0, 858, S, S - 858);
  }

  ctx.globalCompositeOperation = 'lighter';
  ctx.drawImage(eCanvas, 0, 0);
  ctx.globalCompositeOperation = 'source-over';

  const setup = (cvs, srgb) => {
    const t = new THREE.CanvasTexture(cvs);
    t.anisotropy = 4;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };

  return {
    map: setup(cCanvas, true),
    emissiveMap: setup(eCanvas, true),
    roughnessMap: setup(rCanvas, false),
    metalnessMap: setup(mCanvas, false),
    clearcoatMap: setup(ccCanvas, false),
  };
}

// ---------------------------------------------------------------------------
// 2048x512 超高精細・実車図面準拠 車体側面PBRテクスチャ生成
//   - image_2.png (クハE231-49) / image_5.png (クハE531-11) / image_6.png (サロE531) 完全準拠
//   - 本物の銀色ステンレス（ダルフィニッシュ車体 vs 光沢ヘアライン扉の質感差 + 溶接継ぎ目 + バンプマップ）
//   - 全車両統一の「真っ黒塗りつぶし＋鏡面クリアコート仕上げ」ガラス窓
//   - 先頭車左右で運転台端を反転しても文字（JR・車番・LED）が鏡文字にならない設計
// ---------------------------------------------------------------------------
function createSideBodyTextures(
  series,
  { isGreenCar = false, isLeadCar = false, cabOnRight = false } = {}
) {
  const W = 2048;
  const H = 512;

  const mkCanvas = (fill) => {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d');
    if (fill) {
      g.fillStyle = fill;
      g.fillRect(0, 0, W, H);
    }
    return [c, g];
  };

  const [cCanvas, ctx] = mkCanvas();
  const [eCanvas, eCtx] = mkCanvas('#000000');
  const [rCanvas, rCtx] = mkCanvas('#3a3a3a'); // ダルフィニッシュステンレス roughness ~0.23
  const [mCanvas, mCtx] = mkCanvas('#e4e4e8'); // 無塗装ステンレス銀色 metalness ~0.89
  const [bCanvas, bCtx] = mkCanvas('#808080'); // ニュートラルバンプ
  const [ccCanvas, ccCtx] = mkCanvas('#000000'); // クリアコートマスク（窓ガラスのみ 1.0）

  // 1. 本物の銀色ステンレス地肌（SUS301L / SUS304 ダルフィニッシュ＋ベルトグラインド：白飛びしない金属銀）
  const stGrad = ctx.createLinearGradient(0, 0, 0, H);
  stGrad.addColorStop(0.00, '#c0cad4'); // 雨樋上部
  stGrad.addColorStop(0.06, '#dce3ec'); // 上部エッジ金属ハイライト
  stGrad.addColorStop(0.28, '#ced7e0'); // 窓周りダルフィニッシュ銀
  stGrad.addColorStop(0.62, '#d5dde6'); // 腰板上部銀
  stGrad.addColorStop(0.79, '#e0e7ef'); // 裾絞り折り目エッジハイライト
  stGrad.addColorStop(0.92, '#c5ced8'); // 裾絞り下部（3D下向き法線で自然な暖色金属反射）
  stGrad.addColorStop(1.00, '#adb7c2');
  ctx.fillStyle = stGrad;
  ctx.fillRect(0, 0, W, H);

  // 繊細な水平ヘアライン筋（本物の圧延ステンレスの微細異方性光沢感）
  for (let y = 3; y < H; y += 2) {
    const v = ((y * 41) % 23) / 23;
    ctx.fillStyle =
      v > 0.5 ? `rgba(255,255,255,${(v - 0.5) * 0.18})` : `rgba(80,92,106,${(0.5 - v) * 0.16})`;
    ctx.fillRect(0, y, W, 1.2);
  }

  // 上部の雨樋ライン＆ステンレスビード（立体バンプ付き）
  ctx.fillStyle = 'rgba(72, 82, 94, 0.42)';
  ctx.fillRect(0, 16, W, 4);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
  ctx.fillRect(0, 20, W, 2);
  bCtx.fillStyle = '#383838';
  bCtx.fillRect(0, 16, W, 4);
  bCtx.fillStyle = '#b8b8b8';
  bCtx.fillRect(0, 20, W, 3);

  // 裾絞り折り目・下端溶接ライン
  ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
  ctx.fillRect(0, 405, W, 2);
  ctx.fillStyle = 'rgba(75, 84, 94, 0.35)';
  ctx.fillRect(0, H - 5, W, 5);

  const paintStripe = (x, y, w, h, color) => {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
    // 塗装・フィルム帯は非金属セミグロスにして銀色ステンレスとの強烈な質感差を演出
    mCtx.fillStyle = '#141414';
    mCtx.fillRect(x, y, w, h);
    rCtx.fillStyle = '#5c5c5c';
    rCtx.fillRect(x, y, w, h);
  };

  // X座標変換（先頭車右側面では運転台を右端へ鏡像配置しつつ文字描画は常に正立！）
  const mapX = (x, w = 0) => (cabOnRight ? W - x - w : x);

  // 全車両統一：「真っ黒塗りつぶし＋鏡面クリアコート仕上げ」ガラス窓
  const drawRealisticWindow = (rx, ry, rw, rh, { splitRatio = 0, hasDropSash = false, radius = 14 } = {}) => {
    // 1. 外周ステンレス押さえ縁の微細ハイライト＋凹みバンプ
    ctx.fillStyle = 'rgba(255,255,255,0.42)';
    ctx.beginPath();
    ctx.roundRect(rx - 2, ry - 2, rw + 4, rh + 4, radius + 2);
    ctx.fill();
    bCtx.fillStyle = '#323232';
    bCtx.beginPath();
    bCtx.roundRect(rx, ry, rw, rh, radius);
    bCtx.fill();

    // 2. 黒EPDMゴムガスケット外枠
    ctx.fillStyle = '#12161a';
    ctx.beginPath();
    ctx.roundRect(rx, ry, rw, rh, radius);
    ctx.fill();
    mCtx.fillStyle = '#040404';
    mCtx.fillRect(rx, ry, rw, rh);
    rCtx.fillStyle = '#dcdcdc';
    rCtx.fillRect(rx, ry, rw, rh);
    ccCtx.fillStyle = '#000000';
    ccCtx.fillRect(rx, ry, rw, rh);

    // 3. 真っ黒塗りつぶし＋鏡面クリアコートガラス本体
    const gx = rx + 5;
    const gy = ry + 5;
    const gw = rw - 10;
    const gh = rh - 10;
    const gRad = Math.max(4, radius - 4);

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(gx, gy, gw, gh, gRad);
    ctx.fillStyle = '#000002'; // 漆黒ベース（真っ黒塗りつぶし）
    ctx.fill();
    ctx.restore();

    // 極低粗さ＋クリアコート鏡面仕上げ（斜め角度でも真っ黒を保ちつつ鋭い空反射！）
    rCtx.save();
    rCtx.beginPath();
    rCtx.roundRect(gx, gy, gw, gh, gRad);
    rCtx.fillStyle = '#030303';
    rCtx.fill();
    rCtx.restore();

    mCtx.save();
    mCtx.beginPath();
    mCtx.roundRect(gx, gy, gw, gh, gRad);
    mCtx.fillStyle = '#000000';
    mCtx.fill();
    mCtx.restore();

    ccCtx.save();
    ccCtx.beginPath();
    ccCtx.roundRect(gx, gy, gw, gh, gRad);
    ccCtx.fillStyle = '#d8d8d8';
    ccCtx.fill();
    ccCtx.restore();

    // 4. E231/E531/E233/E235 特有の「60:40 縦アルミサッシ桟」＋「下降窓の水平中桟」
    if (splitRatio > 0) {
      const splitX = Math.round(gx + gw * splitRatio);
      if (hasDropSash) {
        const dropLeft = splitRatio >= 0.5 ? gx : splitX;
        const dropW = splitRatio >= 0.5 ? splitX - gx : gx + gw - splitX;
        const barY = Math.round(gy + gh * 0.32);
        ctx.fillStyle = '#14191e';
        ctx.fillRect(dropLeft, barY, dropW, 5);
        mCtx.fillStyle = '#101010';
        mCtx.fillRect(dropLeft, barY, dropW, 5);
        rCtx.fillStyle = '#b0b0b0';
        rCtx.fillRect(dropLeft, barY, dropW, 5);
        ccCtx.fillStyle = '#000000';
        ccCtx.fillRect(dropLeft, barY, dropW, 5);
      }

      ctx.fillStyle = '#12161b';
      ctx.fillRect(splitX - 4, ry + 2, 8, rh - 4);
      mCtx.fillStyle = '#0c0c0c';
      mCtx.fillRect(splitX - 4, ry + 2, 8, rh - 4);
      rCtx.fillStyle = '#b8b8b8';
      rCtx.fillRect(splitX - 4, ry + 2, 8, rh - 4);
      ccCtx.fillStyle = '#000000';
      ccCtx.fillRect(splitX - 4, ry + 2, 8, rh - 4);
    }
  };

  if (isGreenCar) {
    // === image_6.png 完全準拠：サロE531 / サロE231 2階建てグリーン車 ===
    // y_world ∈ [0.50, 3.84] -> y_px = (3.84 - y) / 3.34 * 512
    const mainBandCol = series === 'UTSUNOMIYA' ? '#00703c' : '#0056b0';
    const subBandCol = series === 'UTSUNOMIYA' ? '#ee7800' : null;

    // 1. 中央低床部のダークグレー塗装カバー (y = 0.50..0.98 -> y_px = 438..512)
    paintStripe(440, 434, W - 880, 78, '#626a75');
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.fillRect(440, 434, W - 880, 2);

    // 2. 両端平屋部の幕板帯＆腰板帯（image_6.png 準拠）
    paintStripe(12, 68, 412, 22, mainBandCol);
    paintStripe(W - 424, 68, 412, 22, mainBandCol);
    paintStripe(12, 308, 386, 56, mainBandCol);
    paintStripe(W - 398, 308, 386, 56, mainBandCol);
    if (subBandCol) {
      paintStripe(12, 326, 386, 26, subBandCol);
      paintStripe(W - 398, 326, 386, 26, subBandCol);
    }

    // 3. 中央ダブルデッカー部：1階窓と2階窓の間を貫く極太帯（image_6.png！）
    paintStripe(494, 170, W - 988, 92, mainBandCol);
    if (subBandCol) {
      paintStripe(494, 200, W - 988, 42, subBandCol);
    }

    // 4. 両端の片開きデッキ扉（光沢ステンレス扉）
    for (const dx of [404, W - 492]) {
      const dw = 88;
      const dGrad = ctx.createLinearGradient(dx, 0, dx + dw, 0);
      dGrad.addColorStop(0, '#d8e0e8');
      dGrad.addColorStop(0.5, '#f2f6fa');
      dGrad.addColorStop(1, '#d4dce4');
      ctx.fillStyle = dGrad;
      ctx.fillRect(dx, 102, dw, 324);
      mCtx.fillStyle = '#ececee';
      mCtx.fillRect(dx, 102, dw, 324);
      rCtx.fillStyle = '#2d2d2d';
      rCtx.fillRect(dx, 102, dw, 324);
      ctx.strokeStyle = '#48505a';
      ctx.lineWidth = 2.5;
      ctx.strokeRect(dx, 102, dw, 324);
      bCtx.strokeStyle = '#303030';
      bCtx.lineWidth = 3;
      bCtx.strokeRect(dx, 102, dw, 324);

      drawRealisticWindow(dx + 22, 122, 44, 126, { radius: 8 });
    }

    // 5. 平屋部の角丸窓（左2枚、右3枚 — image_6.png そのまま！）
    const endWindows = [
      [182, 86], [282, 86],
      [W - 368, 82], [W - 270, 82], [W - 172, 82],
    ];
    for (const [wx, ww] of endWindows) {
      drawRealisticWindow(wx, 128, ww, 146, { radius: 11 });
    }

    // 6. 中央2階席（4枚大窓＋右端1枚小窓）＆ 1階席（4枚大窓）— image_6.png 準拠！
    for (let i = 0; i < 5; i++) {
      const wx = 594 + i * 182;
      const ww = i === 4 ? 92 : 162;
      // 2階窓（肩カーブに沿って上部が斜め反射）
      drawRealisticWindow(wx, 28, ww, 122, { radius: 12 });
      // 1階窓（4枚のみ！image_6.png 通り5番目の下は機器室壁で無塗装ステンレス！）
      if (i < 4) {
        drawRealisticWindow(wx, 276, ww, 122, { splitRatio: 0.5, radius: 10 });
      }
    }

    // 7. 四つ葉のグリーン車マーク（本物のクローバー形状＋号車番号「5」）
    for (const gx of [536, W - 548]) {
      ctx.fillStyle = '#70c44b';
      for (const [ox, oy] of [[-7, -7], [7, -7], [-7, 7], [7, 7]]) {
        ctx.beginPath();
        ctx.arc(gx + ox, 134 + oy, 8.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(gx, 134, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = '700 15px "Inter", sans-serif';
      ctx.fillText('5', gx - 24, 118);
    }

    // 右端幕板の側面LED行先表示器＋車番表記
    ctx.fillStyle = '#11151a';
    ctx.fillRect(W - 266, 66, 86, 26);
    eCtx.fillStyle = '#ff9828';
    eCtx.font = '700 15px sans-serif';
    eCtx.fillText(series === 'UTSUNOMIYA' ? '上野東京' : '特別快速', W - 258, 84);

    ctx.fillStyle = '#363e48';
    ctx.font = '700 13px "Inter", sans-serif';
    ctx.fillText(series === 'UTSUNOMIYA' ? 'サロE231-1001' : 'サロE531-1', 274, 396);
  } else {
    // === 4扉一般車（image_2.png クハE231-49 / image_5.png クハE531-11 / E233 / E235 / 宇都宮線）===
    // y_world ∈ [1.00, 3.34] -> y_px = (3.34 - y) / 2.34 * 512
    //   幕板帯: y_px = 34..62
    //   客室窓: y_px = 104..312
    //   腰板帯: y_px = 330..404（直下の y_px=405..512 が3D裾絞りシルバー面！）
    //   ドア枠: y_px = 78..496（ドア下部も裾絞りに沿って曲がる！）

    // 1. 路線カラー帯の描画（後でドア部のみ銀色ステンレスで抜くので扉間でスパッと切れる！）
    if (series === 'E531') {
      paintStripe(0, 36, W, 24, '#0056b0');
      paintStripe(0, 330, W, 74, '#0056b0');
    } else if (series === 'E231') {
      paintStripe(0, 36, W, 24, '#00b8a8');
      paintStripe(0, 330, W, 54, '#00b8a8');
      paintStripe(0, 384, W, 20, '#76c448');
    } else if (series === 'UTSUNOMIYA') {
      paintStripe(0, 36, W, 22, '#00703c');
      paintStripe(0, 330, W, 22, '#00703c');
      paintStripe(0, 352, W, 34, '#ee7800');
      paintStripe(0, 386, W, 18, '#00703c');
    } else if (series === 'KEIHIN') {
      paintStripe(0, 36, W, 24, '#00a0de');
      paintStripe(0, 330, W, 74, '#00a0de');
    } else if (series === 'YAMANOTE') {
      // E235系山手線は腰帯なし！幕板のウグイス帯のみ（ドアに縦ドットグラデーション！）
      paintStripe(0, 34, W, 22, '#80c342');
    }

    // 2. 先頭車（クハ）前位のFRP回り込み・乗務員室小窓・乗務員室扉
    if (isLeadCar) {
      const frpCol =
        series === 'YAMANOTE' ? '#161a20' : series === 'E531' ? '#f2f5f8' : '#eef1f4';
      // 車体最前端の白/黒FRP接合縁（帯はFRP側面へも連続）
      const fx = mapX(0, 36);
      paintStripe(fx, 18, 36, 312, frpCol);
      paintStripe(fx, 404, 36, 98, '#dde3ea'); // 裾ステップ
      // 溶接/FRP境界の縦目地ライン
      const seamX = cabOnRight ? W - 36 : 36;
      ctx.fillStyle = 'rgba(40, 48, 56, 0.55)';
      ctx.fillRect(seamX, 18, 3, H - 22);
      bCtx.fillStyle = '#303030';
      bCtx.fillRect(seamX, 18, 3, H - 22);

      if (series === 'E231') {
        // image_2.png 左端そのまま！小窓なし＋青緑1号（シアン系エメラルド）塗装の乗務員室扉！
        const cdx = mapX(68, 68);
        ctx.fillStyle = '#dce3ea';
        ctx.fillRect(cdx, 82, 68, 386);
        mCtx.fillStyle = '#e6e6e8';
        mCtx.fillRect(cdx, 82, 68, 386);
        rCtx.fillStyle = '#303030';
        rCtx.fillRect(cdx, 82, 68, 386);
        paintStripe(cdx + 6, 92, 56, 312, '#00b8a8'); // 乗務員扉のシアン系エメラルド塗装（image_2.png！）
        ctx.strokeStyle = '#3d454e';
        ctx.lineWidth = 2.5;
        ctx.strokeRect(cdx, 82, 68, 386);
        bCtx.strokeStyle = '#303030';
        bCtx.lineWidth = 3;
        bCtx.strokeRect(cdx, 82, 68, 386);
        drawRealisticWindow(cdx + 12, 108, 44, 118, { radius: 6 });
        // シルバーのドアノブ・縦手すり
        const handleX = cabOnRight ? cdx + 8 : cdx + 54;
        ctx.fillStyle = '#f2f6fa';
        ctx.fillRect(handleX, 276, 5, 28);
      } else {
        // image_5.png (E531) & E231-1000 / E233 / E235：クラッシャブルゾーンの角丸小窓＋無塗装ステンレス乗務員扉！
        const cwX = mapX(58, 72);
        drawRealisticWindow(cwX, 112, 72, 92, { radius: 11 });

        const cdx = mapX(148, 62);
        const cdGrad = ctx.createLinearGradient(cdx, 0, cdx + 62, 0);
        cdGrad.addColorStop(0, '#d6dee6');
        cdGrad.addColorStop(0.5, '#f2f6fa');
        cdGrad.addColorStop(1, '#d2dae2');
        ctx.fillStyle = cdGrad;
        ctx.fillRect(cdx, 86, 62, 384);
        mCtx.fillStyle = '#ececee';
        mCtx.fillRect(cdx, 86, 62, 384);
        rCtx.fillStyle = '#2d2d2d';
        rCtx.fillRect(cdx, 86, 62, 384);
        ctx.strokeStyle = '#48505a';
        ctx.lineWidth = 2.5;
        ctx.strokeRect(cdx, 86, 62, 384);
        bCtx.strokeStyle = '#303030';
        bCtx.lineWidth = 3;
        bCtx.strokeRect(cdx, 86, 62, 384);
        drawRealisticWindow(cdx + 11, 112, 40, 112, { radius: 6 });
        // 縦グラブレール（手すり）
        const railX = cabOnRight ? cdx + 5 : cdx + 53;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(railX, 224, 3, 148);
      }
    }

    // 3. 4箇所の客用両開きドア（光沢ステンレス仕上げ・正確な実車ピッチ・ドア部帯抜き）
    const doorW = 136; // 1,300mm 実寸比
    const doorCentersRaw = isLeadCar
      ? series === 'E231'
        ? [298, 762, 1274, 1778] // image_2.png クハE231-49 ピッチ
        : [396, 768, 1274, 1758] // image_5.png クハE531-11 等 クラッシャブル先頭車ピッチ
      : [265, 771, 1277, 1783];  // 中間車 4,820mm 均等ピッチ

    for (const dcRaw of doorCentersRaw) {
      const dx = mapX(dcRaw - doorW * 0.5, doorW);
      const dc = dx + doorW * 0.5;

      // ドア枠の極細くぼみ溝（ペン描き風の太枠を排し、金属の精密な戸袋段差に）
      ctx.fillStyle = 'rgba(42, 50, 60, 0.72)';
      ctx.fillRect(dx - 1, 77, doorW + 2, 415);
      bCtx.fillStyle = '#282828';
      bCtx.fillRect(dx - 1, 77, doorW + 2, 415);

      // 左右ドア扉本体（車体ダルフィニッシュより光沢の強いヘアライン銀ステンレス！image_2 & image_5！）
      const dGrad = ctx.createLinearGradient(dx, 0, dx + doorW, 0);
      dGrad.addColorStop(0.00, '#c8d2dc');
      dGrad.addColorStop(0.22, '#e6ecf2');
      dGrad.addColorStop(0.49, '#d6dee7');
      dGrad.addColorStop(0.51, '#d6dee7');
      dGrad.addColorStop(0.78, '#e6ecf2');
      dGrad.addColorStop(1.00, '#c4ced8');
      ctx.fillStyle = dGrad;
      ctx.fillRect(dx + 1, 79, doorW - 2, 411);
      mCtx.fillStyle = '#f2f2f5'; // metalness ~0.95
      mCtx.fillRect(dx + 1, 79, doorW - 2, 411);
      rCtx.fillStyle = '#222222'; // roughness ~0.13（扉の鮮やかな銀光沢コントラスト！）
      rCtx.fillRect(dx + 1, 79, doorW - 2, 411);
      bCtx.fillStyle = '#747474';
      bCtx.fillRect(dx + 2, 80, doorW - 4, 409);

      // E235系山手線：扉全面の象徴的なウグイス色縦ドットグラデーション帯！
      if (series === 'YAMANOTE') {
        const stripeX = dx + 10;
        const stripeW = doorW - 20;
        // 下半分のソリッドグリーン帯
        paintStripe(stripeX, 294, stripeW, 134, '#80c342');
        // 上下へドットが小さくなるハーフトーングラデーション
        for (let r = 0; r < 6; r++) {
          const sz = Math.max(2, (6 - r) * 1.45);
          ctx.fillStyle = '#80c342';
          for (let px = stripeX + 3; px < stripeX + stripeW - 6; px += 10) {
            ctx.fillRect(px, 282 - r * 11, sz, sz);
            ctx.fillRect(px, 434 + r * 9, sz, sz);
          }
        }
      }

      // 裾絞り下部の微細シルバーシャドウ（ドアも裾絞りに沿って反射）
      const dFoot = ctx.createLinearGradient(0, 404, 0, 490);
      dFoot.addColorStop(0, 'rgba(255,255,255,0.18)');
      dFoot.addColorStop(1, 'rgba(72,78,86,0.20)');
      ctx.fillStyle = dFoot;
      ctx.fillRect(dx + 1, 404, doorW - 2, 86);

      // ドア縁の微細ハイライト＆中央戸当たり黒ゴム
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.lineWidth = 1;
      ctx.strokeRect(dx + 1.5, 79.5, doorW - 3, 409);

      ctx.fillStyle = '#1b2025';
      ctx.fillRect(dc - 1.5, 79, 3, 411);
      bCtx.fillStyle = '#202020';
      bCtx.fillRect(dc - 1.5, 79, 3, 411);
      mCtx.fillStyle = '#080808';
      mCtx.fillRect(dc - 1.5, 79, 3, 411);
      rCtx.fillStyle = '#d0d0d0';
      rCtx.fillRect(dc - 1.5, 79, 3, 411);

      // 左右のフラッシュドア窓＋実車サイズの控えめな「ドアにご注意」ステッカー
      for (const ox of [-56, 10]) {
        const dwx = dc + ox;
        drawRealisticWindow(dwx, 102, 46, 186, { radius: 9 });

        // 胸の高さの小さなドア注意ステッカー（白枠＋控えめなアクセント、光らせない！）
        ctx.fillStyle = '#e8edf0';
        ctx.fillRect(dwx + 15, 198, 16, 18);
        ctx.fillStyle = series === 'E531' ? '#0068b7' : '#2a9c5a';
        ctx.fillRect(dwx + 17, 200, 12, 8);
        ctx.fillStyle = '#d84038';
        ctx.fillRect(dwx + 17, 210, 12, 4);
      }

      // 扉下部の水抜きスリット・ドアレール縁
      ctx.fillStyle = 'rgba(30, 36, 42, 0.55)';
      ctx.fillRect(dx, 488, doorW, 3);
    }

    // 4. 扉間の客室窓（実車比率・60/40縦桟・下降窓横桟・クハE531の1-2扉間1枚窓まで忠実再現！）
    const rawWindows = [];
    if (!isLeadCar) {
      rawWindows.push({ x0: 44, x1: 152, split: 0, drop: false, end: true });
      rawWindows.push({ x0: 386, x1: 646, split: 0.60, drop: true });
      rawWindows.push({ x0: 892, x1: 1152, split: 0.60, drop: true });
      rawWindows.push({ x0: 1398, x1: 1658, split: 0.60, drop: true });
      rawWindows.push({ x0: 1896, x1: 2004, split: 0, drop: false, end: true });
    } else if (series === 'E531') {
      // image_5.png クハE531-11 完全準拠！
      rawWindows.push({ x0: 540, x1: 636, split: 0, drop: false }); // 1-2扉間の単独1枚窓！
      rawWindows.push({ x0: 908, x1: 1138, split: 0.58, drop: true });
      rawWindows.push({ x0: 1414, x1: 1644, split: 0.58, drop: true });
      // 4扉後方は無窓ステンレス車椅子・トイレ側壁（image_5.png！）
    } else if (series === 'E231') {
      // image_2.png クハE231-49 完全準拠！
      rawWindows.push({ x0: 442, x1: 626, split: 0.56, drop: true });
      rawWindows.push({ x0: 906, x1: 1136, split: 0.58, drop: true });
      rawWindows.push({ x0: 1418, x1: 1648, split: 0.58, drop: true });
      rawWindows.push({ x0: 1924, x1: 2014, split: 0, drop: false, end: true });
    } else {
      // E231-1000 宇都宮 / E233 京浜東北 / E235 山手線 先頭車
      rawWindows.push({ x0: 514, x1: 650, split: 0.54, drop: true });
      rawWindows.push({ x0: 908, x1: 1138, split: 0.58, drop: true });
      rawWindows.push({ x0: 1414, x1: 1644, split: 0.58, drop: true });
      rawWindows.push({ x0: 1906, x1: 2002, split: 0, drop: false, end: true });
    }

    for (const wDef of rawWindows) {
      const ww = wDef.x1 - wDef.x0;
      const wx = mapX(wDef.x0, ww);
      const splitRatio = wDef.split > 0 ? (cabOnRight ? 1 - wDef.split : wDef.split) : 0;
      drawRealisticWindow(wx, 108, ww, 198, {
        splitRatio,
        hasDropSash: wDef.drop,
        radius: 14,
        isEndWin: !!wDef.end,
      });
    }

    // 5. ステンレス車体パネル縦継ぎ目＆裾部点検フタ（情報密度を高める実車ディテール）
    ctx.fillStyle = 'rgba(72, 82, 92, 0.20)';
    for (const sx of [200, 480, 680, 860, 1185, 1368, 1682, 1872]) {
      ctx.fillRect(sx, 22, 1.5, H - 28);
      bCtx.fillStyle = '#6c6c6c';
      bCtx.fillRect(sx, 22, 1.5, H - 28);
    }
    // 床下点検小ハッチ・コック表示（image_2 & image_5 下端・車番と重ならない位置に配置）
    for (const hx of [488, 1168, 1468]) {
      const rx = mapX(hx, 20);
      ctx.strokeStyle = 'rgba(65, 74, 84, 0.48)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(rx, 434, 20, 26);
    }

    // 6. 幕板中央の側面LED行先表示器＋赤い車側灯＋黄色保安装置灯（常に正立文字！）
    const ledX = mapX(980, 96);
    ctx.fillStyle = '#11151a';
    ctx.fillRect(ledX, 34, 96, 28);
    ctx.strokeStyle = '#68727c';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(ledX, 34, 96, 28);
    mCtx.fillStyle = '#080808';
    mCtx.fillRect(ledX, 34, 96, 28);
    rCtx.fillStyle = '#181818';
    rCtx.fillRect(ledX, 34, 96, 28);

    const ledLabel =
      series === 'E531'
        ? '特別快速'
        : series === 'E231'
          ? '快速 上野'
          : series === 'UTSUNOMIYA'
            ? '上野東京'
            : series === 'KEIHIN'
              ? '快速 大船'
              : '山手線';
    eCtx.fillStyle = series === 'KEIHIN' ? '#4ad4ff' : series === 'YAMANOTE' ? '#c8ff8c' : '#ff9828';
    eCtx.font = '700 16px "Noto Sans JP", sans-serif';
    eCtx.fillText(ledLabel, ledX + 10, 54);

    // 赤色車側灯（閉扉時暗赤）
    const lampX = cabOnRight ? ledX - 18 : ledX + 108;
    ctx.fillStyle = '#781d1d';
    ctx.fillRect(lampX, 43, 10, 9);

    // 7. 3-4扉間腰帯内の白「JR」ロゴ（常に正立・image_2 & image_5 準拠位置！）
    const jrX = mapX(1498, 46);
    ctx.fillStyle = series === 'YAMANOTE' ? '#2c343c' : '#ffffff';
    ctx.font = 'italic 900 34px "Inter", sans-serif';
    ctx.fillText('JR', jrX, series === 'YAMANOTE' ? 380 : 378);

    // 8. 裾部シルバー上の形式番号標記（常に正立）
    const numMap = {
      E531: isLeadCar ? 'クハE531-11' : 'モハE531-11',
      E231: isLeadCar ? 'クハE231-49' : 'モハE231-98',
      UTSUNOMIYA: isLeadCar ? 'クハE231-8001' : 'モハE231-1501',
      KEIHIN: isLeadCar ? 'クハE233-1001' : 'モハE233-1001',
      YAMANOTE: isLeadCar ? 'クハE235-8' : 'モハE235-22',
    };
    const numX = mapX(982, 110);
    ctx.fillStyle = '#2d353e';
    ctx.font = '700 14px "Inter", sans-serif';
    ctx.fillText(numMap[series] || 'クハE531-11', numX, 444);

    // 9. 車端部の車椅子・ベビーカーピクトグラム＆号車表示（image_2 & image_5！）
    if (isLeadCar) {
      const picX = mapX(1844, 38);
      ctx.fillStyle = '#58626d';
      ctx.font = '700 13px "Inter", sans-serif';
      ctx.fillText('10', picX + 2, 112);
      ctx.fillStyle = '#0068b7';
      ctx.fillRect(picX, 118, 17, 17);
      ctx.fillStyle = '#00a0e9';
      ctx.fillRect(picX + 19, 118, 17, 17);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(picX + 5, 122, 7, 9);
      ctx.fillRect(picX + 24, 122, 7, 9);
    }
  }

  const setup = (cvs, srgb) => {
    const t = new THREE.CanvasTexture(cvs);
    t.anisotropy = 4;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };

  return {
    map: setup(cCanvas, true),
    emissiveMap: setup(eCanvas, true),
    roughnessMap: setup(rCanvas, false),
    metalnessMap: setup(mCanvas, false),
    bumpMap: setup(bCanvas, false),
    clearcoatMap: setup(ccCanvas, false),
  };
}

function createNoseShroudTexture(series) {
  const W = 64;
  const H = 512;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  const baseCol =
    series === 'YAMANOTE' ? '#161a20' : series === 'E531' ? '#f2f5f8' : '#eef1f4';
  ctx.fillStyle = baseCol;
  ctx.fillRect(0, 0, W, H);

  // 裾部シルバー金属ステップ（y_px = 404..512）
  if (series !== 'YAMANOTE') {
    const sg = ctx.createLinearGradient(0, 404, 0, H);
    sg.addColorStop(0, '#cfd7e0');
    sg.addColorStop(0.5, '#dce3ec');
    sg.addColorStop(1, '#aeb8c4');
    ctx.fillStyle = sg;
    ctx.fillRect(0, 404, W, H - 404);
  }

  // 側面から前面へシームレスに回り込む腰部カラー帯（y_px = 330..404）
  if (series === 'E531') {
    ctx.fillStyle = '#0056b0';
    ctx.fillRect(0, 330, W, 74);
  } else if (series === 'E231') {
    ctx.fillStyle = '#00b8a8';
    ctx.fillRect(0, 330, W, 54);
    ctx.fillStyle = '#76c448';
    ctx.fillRect(0, 384, W, 20);
  } else if (series === 'UTSUNOMIYA') {
    ctx.fillStyle = '#00703c';
    ctx.fillRect(0, 330, W, 22);
    ctx.fillStyle = '#ee7800';
    ctx.fillRect(0, 352, W, 34);
    ctx.fillStyle = '#00703c';
    ctx.fillRect(0, 386, W, 18);
  } else if (series === 'KEIHIN') {
    ctx.fillStyle = '#00a0de';
    ctx.fillRect(0, 330, W, 74);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class RollingStockFactory {
  constructor() {
    // 物理3Dドア窪み付き拡幅裾絞り車体ジオメトリ（中間車・E231先頭前後・E531/E233/E235先頭前後・サロ2階建て）
    const midDoors = [265, 771, 1277, 1783].map((c) => [c - 68, c + 68]);
    const e231LeadDoors = [
      [68, 136], // 乗務員扉も窪ませる！
      ...[298, 762, 1274, 1778].map((c) => [c - 68, c + 68]),
    ];
    const stdLeadDoors = [
      [148, 210], // 乗務員扉も窪ませる！
      ...[396, 768, 1274, 1758].map((c) => [c - 68, c + 68]),
    ];

    this.stdMidBodyGeo = createStandardWideBodyGeometry(19.46, midDoors, false);
    this.stdLeadE231FrontGeo = createStandardWideBodyGeometry(19.46, e231LeadDoors, false);
    this.stdLeadE231RearGeo = createStandardWideBodyGeometry(19.46, e231LeadDoors, true);
    this.stdLeadStdFrontGeo = createStandardWideBodyGeometry(19.46, stdLeadDoors, false);
    this.stdLeadStdRearGeo = createStandardWideBodyGeometry(19.46, stdLeadDoors, true);
    this.ddBodyGeo = createDoubleDeckerWideBodyGeometry(19.46);
    const nose = createCabNoseGeometries();
    this.noseShroudGeo = nose.shroudGeo;
    this.noseCapGeo = nose.capGeo;
    this.noseZFrontOfY = nose.zFrontOfY;

    // 本物の銀色ステンレス（屋根端・妻面・車体ベース：高コントラストIBLで金属光沢を発色）
    this.stainlessMat = new THREE.MeshStandardMaterial({
      color: 0xd6dfe8,
      metalness: 0.90,
      roughness: 0.22,
      envMapIntensity: 1.55,
    });
    this.roofMat = new THREE.MeshStandardMaterial({
      color: 0x626a73,
      metalness: 0.28,
      roughness: 0.72,
    });
    this.acCaseMat = new THREE.MeshStandardMaterial({
      color: 0xe6ecf2,
      metalness: 0.68,
      roughness: 0.28,
      envMapIntensity: 1.5,
    });
    this.acGrilleMat = new THREE.MeshStandardMaterial({
      color: 0x262b31,
      metalness: 0.6,
      roughness: 0.55,
    });
    this.bogieMat = new THREE.MeshStandardMaterial({
      color: 0x24282e,
      metalness: 0.48,
      roughness: 0.62,
    });
    this.underEquipMat = new THREE.MeshStandardMaterial({
      color: 0x484f57,
      metalness: 0.38,
      roughness: 0.58,
    });
    this.skirtWhiteMat = new THREE.MeshStandardMaterial({
      color: 0xdce2e8,
      metalness: 0.32,
      roughness: 0.34,
      envMapIntensity: 1.25,
    });
    this.insulatorRedMat = new THREE.MeshStandardMaterial({
      color: 0xa82828,
      roughness: 0.28,
      metalness: 0.15,
    });

    this.hidBloomMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(4.5, 5.0, 5.8),
    });
    this.halogenBloomMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(5.0, 4.1, 2.8),
    });
    this.tailRedMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(3.4, 0.12, 0.08),
    });

    // 共通再利用マテリアル
    this.wheelMat = new THREE.MeshStandardMaterial({
      color: 0x3b4046,
      metalness: 0.72,
      roughness: 0.40,
    });
    this.antMat = new THREE.MeshStandardMaterial({
      color: 0xc8d0d8,
      roughness: 0.4,
    });
    this.frpMats = {
      white: new THREE.MeshStandardMaterial({
        color: 0xf0f4f8,
        metalness: 0.12,
        roughness: 0.26,
        envMapIntensity: 1.25,
      }),
      pearl: new THREE.MeshStandardMaterial({
        color: 0xebeff2,
        metalness: 0.12,
        roughness: 0.26,
        envMapIntensity: 1.25,
      }),
      black: new THREE.MeshStandardMaterial({
        color: 0x161a20,
        metalness: 0.18,
        roughness: 0.24,
        envMapIntensity: 1.25,
      }),
    };
    this.e5TokiwaMat = new THREE.MeshStandardMaterial({
      color: 0x009174,
      metalness: 0.55,
      roughness: 0.20,
      envMapIntensity: 1.8,
    });
    this.e5PinkMat = new THREE.MeshStandardMaterial({
      color: 0xe4007f,
      metalness: 0.35,
      roughness: 0.28,
    });
    this.e5WhiteMat = new THREE.MeshStandardMaterial({
      color: 0xf0f4f8,
      metalness: 0.25,
      roughness: 0.22,
      envMapIntensity: 1.4,
    });
    this.e5CanopyMat = new THREE.MeshPhysicalMaterial({
      color: 0x000002,
      roughness: 0.015,
      metalness: 0.0,
      ior: 1.48,
      specularIntensity: 0.22,
      clearcoat: 0.42,
      clearcoatRoughness: 0.015,
      envMapIntensity: 1.45,
    });
    this.e5WinMat = this.e5CanopyMat;
    this.e5PaneGeo = new THREE.BoxGeometry(3.38, 0.44, 0.72);

    // 共通再利用ジオメトリ
    this.roofSheetGeo = new THREE.BoxGeometry(2.15, 0.07, 19.38);
    this.gangwayGeo = new THREE.BoxGeometry(1.12, 2.15, 0.56);
    this.bogieSideGeo = new THREE.BoxGeometry(0.18, 0.34, 2.65);
    this.airSpringGeo = new THREE.CylinderGeometry(0.32, 0.30, 0.28, 10);
    this.axleGeo = new THREE.CylinderGeometry(0.09, 0.09, 1.95, 6);
    this.axleGeo.rotateZ(Math.PI / 2);
    this.wheelGeo = new THREE.CylinderGeometry(0.43, 0.43, 0.13, 14);
    this.wheelGeo.rotateZ(Math.PI / 2);
    this.vvvfBoxGeo = new THREE.BoxGeometry(2.26, 0.56, 3.85);
    this.subBoxGeo = new THREE.BoxGeometry(2.10, 0.48, 1.45);
    this.airTankGeo = new THREE.CylinderGeometry(0.25, 0.25, 1.38, 10);
    this.airTankGeo.rotateX(Math.PI / 2);
    this.ladderGeo = new THREE.BoxGeometry(2.30, 0.50, 0.48);
    this.fanDiscGeo = new THREE.CylinderGeometry(0.46, 0.46, 0.04, 12);

    this.seriesCache = {};
  }

  _getSeriesAssets(series) {
    if (this.seriesCache[series]) return this.seriesCache[series];

    const frontTex = createFrontMaskTextures(series);
    const sideMidTex = createSideBodyTextures(series, { isGreenCar: false, isLeadCar: false });
    const sideLeadLeftTex = createSideBodyTextures(series, {
      isGreenCar: false,
      isLeadCar: true,
      cabOnRight: false,
    });
    const sideLeadRightTex = createSideBodyTextures(series, {
      isGreenCar: false,
      isLeadCar: true,
      cabOnRight: true,
    });
    const hasGreen = series === 'E531' || series === 'UTSUNOMIYA';
    const sideGreenTex = hasGreen
      ? createSideBodyTextures(series, { isGreenCar: true, isLeadCar: false })
      : null;

    const makeSideMat = (t) =>
      new THREE.MeshPhysicalMaterial({
        map: t.map,
        emissive: new THREE.Color(0xffffff),
        emissiveMap: t.emissiveMap,
        emissiveIntensity: 1.0,
        roughnessMap: t.roughnessMap,
        roughness: 1.0,
        metalnessMap: t.metalnessMap,
        metalness: 1.0,
        bumpMap: t.bumpMap,
        bumpScale: 0.015,
        clearcoat: 0.36,
        clearcoatMap: t.clearcoatMap,
        clearcoatRoughness: 0.015,
        ior: 1.48,
        specularIntensity: 0.20,
        envMapIntensity: 1.50,
      });

    const frontMat = new THREE.MeshPhysicalMaterial({
      map: frontTex.map,
      emissive: new THREE.Color(0xffffff),
      emissiveMap: frontTex.emissiveMap,
      emissiveIntensity: 1.55,
      roughnessMap: frontTex.roughnessMap,
      roughness: 1.0,
      metalnessMap: frontTex.metalnessMap,
      metalness: 1.0,
      clearcoat: 0.42,
      clearcoatMap: frontTex.clearcoatMap,
      clearcoatRoughness: 0.015,
      ior: 1.48,
      specularIntensity: 0.24,
      envMapIntensity: 1.42,
    });

    const noseShroudMat = new THREE.MeshStandardMaterial({
      map: createNoseShroudTexture(series),
      metalness: 0.14,
      roughness: 0.28,
      envMapIntensity: 1.25,
    });

    const assets = {
      frontMat,
      noseShroudMat,
      midSideMat: makeSideMat(sideMidTex),
      leadLeftSideMat: makeSideMat(sideLeadLeftTex),
      leadRightSideMat: makeSideMat(sideLeadRightTex),
      greenSideMat: sideGreenTex ? makeSideMat(sideGreenTex) : null,
    };
    this.seriesCache[series] = assets;
    return assets;
  }

  /**
   * 東北新幹線 E5系「はやぶさ」専用・超ロングノーズ流線型車両生成！
   */
  createShinkansenE5Car({ carIndex = 0, totalCars = 10, headlightsOn = true }) {
    const g = new THREE.Group();
    const tokiwaGreen = this.e5TokiwaMat;
    const hayatePink = this.e5PinkMat;
    const hiuWhite = this.e5WhiteMat;

    const isNoseLead = carIndex === 0;
    const isNoseTail = carIndex === totalCars - 1;

    if (isNoseLead || isNoseTail) {
      const noseHolder = new THREE.Group();
      if (isNoseTail) noseHolder.rotation.y = Math.PI;

      const rearUpper = new THREE.Mesh(new THREE.BoxGeometry(3.32, 1.55, 10.5), tokiwaGreen);
      rearUpper.position.set(0, 2.75, 6.75);
      noseHolder.add(rearUpper);

      const rearPink = new THREE.Mesh(new THREE.BoxGeometry(3.35, 0.16, 10.52), hayatePink);
      rearPink.position.set(0, 1.94, 6.75);
      noseHolder.add(rearPink);

      const rearLower = new THREE.Mesh(new THREE.BoxGeometry(3.32, 1.35, 10.5), hiuWhite);
      rearLower.position.set(0, 1.22, 6.75);
      noseHolder.add(rearLower);

      const segs = 7;
      for (let s = 0; s < segs; s++) {
        const tMid = (s + 0.5) / segs;
        const zLen = 13.6 / segs;
        const zPos = 1.5 - (s + 0.5) * zLen;
        const wScale = Math.pow(1.0 - tMid * 0.78, 0.65);
        const hUpper = (1.0 - tMid * 0.88) * 1.45;

        const lowPart = new THREE.Mesh(
          new THREE.BoxGeometry(3.32 * wScale, 1.15 * (1.0 - tMid * 0.55), zLen + 0.15),
          hiuWhite
        );
        lowPart.position.set(0, 1.05 - tMid * 0.22, zPos);
        noseHolder.add(lowPart);

        const topPart = new THREE.Mesh(
          new THREE.BoxGeometry(3.26 * wScale, Math.max(0.22, hUpper), zLen + 0.15),
          tokiwaGreen
        );
        topPart.position.set(0, 1.85 - tMid * 0.52 + hUpper * 0.35, zPos);
        noseHolder.add(topPart);

        const pinkPart = new THREE.Mesh(
          new THREE.BoxGeometry(3.35 * wScale, 0.13, zLen + 0.15),
          hayatePink
        );
        pinkPart.position.set(0, 1.65 - tMid * 0.42, zPos);
        noseHolder.add(pinkPart);
      }

      const canopy = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.48, 3.2), this.e5CanopyMat);
      canopy.position.set(0, 2.95, 0.8);
      canopy.rotation.x = 0.22;
      noseHolder.add(canopy);

      if (isNoseLead && headlightsOn) {
        for (const lx of [-0.78, 0.78]) {
          const hl = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 8), this.hidBloomMat);
          hl.position.set(lx, 1.55, -7.8);
          noseHolder.add(hl);
        }
      }

      g.add(noseHolder);
    } else {
      const upper = new THREE.Mesh(new THREE.BoxGeometry(3.34, 1.58, 24.4), tokiwaGreen);
      upper.position.y = 2.76;
      g.add(upper);

      const pink = new THREE.Mesh(new THREE.BoxGeometry(3.37, 0.16, 24.42), hayatePink);
      pink.position.y = 1.94;
      g.add(pink);

      const lower = new THREE.Mesh(new THREE.BoxGeometry(3.34, 1.42, 24.4), hiuWhite);
      lower.position.y = 1.18;
      g.add(lower);

      for (let wz = -9.6; wz <= 9.6; wz += 1.28) {
        const pane = new THREE.Mesh(this.e5PaneGeo, this.e5WinMat);
        pane.position.set(0, 2.48, wz);
        g.add(pane);
      }
    }
    return g;
  }

  /**
   * 在来線1両分の超高精細3Dメッシュを生成（E531 / E231 / UTSUNOMIYA / YAMANOTE / KEIHIN）
   * 裾絞り側面がボディ本体に完全統合されているため、下側の浮き・隙間はゼロ！
   */
  createCarMesh({
    series = 'E531',
    carIndex = 0,
    totalCars = 10,
    headlightsOn = true,
  }) {
    if (series === 'SHINKANSEN_E5') {
      return this.createShinkansenE5Car({ carIndex, totalCars, headlightsOn });
    }

    const assets = this._getSeriesAssets(series);
    const isLeadFront = carIndex === 0;
    const isRearEnd = carIndex === totalCars - 1;
    const isGreenCar =
      (series === 'E531' || series === 'UTSUNOMIYA') &&
      totalCars >= 8 &&
      (carIndex === 3 || carIndex === 4);
    const hasPantograph = !isGreenCar && (carIndex === 2 || carIndex === 6);

    const carGroup = new THREE.Group();

    // 1. 裾絞り曲面側面が完全一体化した2,950mm拡幅車体（group 0=屋根/妻面, 1=左側面, 2=右側面）
    let leftMat = assets.midSideMat;
    let rightMat = assets.midSideMat;
    if (isGreenCar && assets.greenSideMat) {
      leftMat = assets.greenSideMat;
      rightMat = assets.greenSideMat;
    } else if (isLeadFront) {
      leftMat = assets.leadLeftSideMat;
      rightMat = assets.leadRightSideMat;
    } else if (isRearEnd) {
      leftMat = assets.leadRightSideMat;
      rightMat = assets.leadLeftSideMat;
    }

    let bodyGeo = this.stdMidBodyGeo;
    if (isGreenCar) {
      bodyGeo = this.ddBodyGeo;
    } else if (isLeadFront) {
      bodyGeo = series === 'E231' ? this.stdLeadE231FrontGeo : this.stdLeadStdFrontGeo;
    } else if (isRearEnd) {
      bodyGeo = series === 'E231' ? this.stdLeadE231RearGeo : this.stdLeadStdRearGeo;
    }

    const bodyMesh = new THREE.Mesh(bodyGeo, [this.stainlessMat, leftMat, rightMat]);
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    carGroup.add(bodyMesh);

    // 屋根上のダークグレー絶縁塗装シート
    if (!isGreenCar) {
      const roofSheet = new THREE.Mesh(this.roofSheetGeo, this.roofMat);
      roofSheet.position.set(0, 3.60, 0);
      carGroup.add(roofSheet);
    }

    // 2. 立体造形 AU726 / AU725 集中式冷房装置
    if (!isGreenCar) {
      this._attachDetailedAcUnit(carGroup, 0, 3.74, 4.35);
    } else {
      this._attachDetailedAcUnit(carGroup, -6.9, 4.02, 2.75);
      this._attachDetailedAcUnit(carGroup, 6.9, 4.02, 2.75);
    }

    if (hasPantograph) {
      this._attachPantograph(carGroup, series, -5.6);
    }

    // 3. 精密ボルスタレス台車 ＆ 個別床下機器箱
    for (const bz of [-6.85, 6.85]) {
      this._attachDetailedBogie(carGroup, bz);
    }

    if (!isGreenCar) {
      this._attachUnderfloorEquipment(carGroup, isLeadFront || isRearEnd);
    }

    // 4. 車両間 連結幌
    if (!isRearEnd) {
      const gangway = new THREE.Mesh(this.gangwayGeo, this.bogieMat);
      gangway.position.set(0, 2.14, 9.86);
      carGroup.add(gangway);
    }

    // 5. 先頭車（クハ）の裾絞り一体FRP先頭マスク・ワイパー・強化スカート・密着連結器
    if (isLeadFront || isRearEnd) {
      const zSign = isLeadFront ? -1 : 1;
      const showHead = isLeadFront ? headlightsOn : false;
      this._attachDetailedCabFront(
        carGroup,
        series,
        assets.frontMat,
        assets.noseShroudMat,
        zSign,
        showHead
      );
    }

    return carGroup;
  }

  _attachDetailedAcUnit(parent, zCenter, yBase, length) {
    const acGroup = new THREE.Group();
    acGroup.position.set(0, yBase, zCenter);

    const mainBox = new THREE.Mesh(new THREE.BoxGeometry(2.14, 0.30, length), this.acCaseMat);
    acGroup.add(mainBox);

    const sideGrille = new THREE.Mesh(
      new THREE.BoxGeometry(2.17, 0.14, length * 0.62),
      this.acGrilleMat
    );
    sideGrille.position.set(0, -0.02, 0.25);
    acGroup.add(sideGrille);

    for (const fz of [-length * 0.24, length * 0.24]) {
      const fanDisc = new THREE.Mesh(this.fanDiscGeo, this.acGrilleMat);
      fanDisc.position.set(0, 0.15, fz);
      acGroup.add(fanDisc);
    }

    parent.add(acGroup);
  }

  _attachDetailedBogie(parent, zPos) {
    const bg = new THREE.Group();
    bg.position.set(0, 0, zPos);

    for (const sx of [-1.02, 1.02]) {
      const sideFrame = new THREE.Mesh(this.bogieSideGeo, this.bogieMat);
      sideFrame.position.set(sx, 0.56, 0);
      bg.add(sideFrame);

      const airSpring = new THREE.Mesh(this.airSpringGeo, this.bogieMat);
      airSpring.position.set(sx, 0.84, 0);
      bg.add(airSpring);
    }

    for (const wz of [-1.05, 1.05]) {
      const axle = new THREE.Mesh(this.axleGeo, this.bogieMat);
      axle.position.set(0, 0.43, wz);
      bg.add(axle);

      for (const wx of [-0.54, 0.54]) {
        const wheel = new THREE.Mesh(this.wheelGeo, this.wheelMat);
        wheel.position.set(wx, 0.43, wz);
        bg.add(wheel);
      }
    }

    parent.add(bg);
  }

  _attachUnderfloorEquipment(parent, isCabCar) {
    const vvvfBox = new THREE.Mesh(this.vvvfBoxGeo, this.underEquipMat);
    vvvfBox.position.set(0, 0.72, 1.15);
    parent.add(vvvfBox);

    const subBox = new THREE.Mesh(this.subBoxGeo, this.bogieMat);
    subBox.position.set(0, 0.74, 4.15);
    parent.add(subBox);

    const airTank = new THREE.Mesh(this.airTankGeo, this.underEquipMat);
    airTank.position.set(0.68, 0.76, -1.85);
    parent.add(airTank);

    if (isCabCar) {
      const ladder = new THREE.Mesh(this.ladderGeo, this.bogieMat);
      ladder.position.set(0, 0.66, -4.45);
      parent.add(ladder);
    }
  }

  _attachPantograph(parent, series, zPos) {
    const pGroup = new THREE.Group();
    pGroup.position.set(0, 3.62, zPos);

    const lowerArm = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.95, 0.11), this.skirtWhiteMat);
    lowerArm.position.set(0, 0.42, -0.25);
    lowerArm.rotation.x = 0.62;
    pGroup.add(lowerArm);

    const upperArm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.98, 0.08), this.skirtWhiteMat);
    upperArm.position.set(0, 1.08, -0.22);
    upperArm.rotation.x = -0.58;
    pGroup.add(upperArm);

    const shoe = new THREE.Mesh(new THREE.BoxGeometry(1.65, 0.05, 0.24), this.skirtWhiteMat);
    shoe.position.set(0, 1.48, 0.05);
    pGroup.add(shoe);

    if (series === 'E531') {
      for (const ix of [-0.65, 0.65]) {
        for (const iz of [0.9, 1.5, 2.1]) {
          const ins = new THREE.Mesh(
            new THREE.CylinderGeometry(0.09, 0.11, 0.34, 8),
            this.insulatorRedMat
          );
          ins.position.set(ix, 0.18, iz);
          pGroup.add(ins);
        }
      }
      const vcbBox = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.28, 1.4), this.roofMat);
      vcbBox.position.set(0, 0.15, 2.0);
      pGroup.add(vcbBox);
    }

    parent.add(pGroup);
  }

  /**
   * 裾絞り断面と完全一致する3D FRP先頭マスク・ワイパー・灯具・大型V字強化スカート・密着連結器
   */
  _attachDetailedCabFront(parent, series, frontMat, noseShroudMat, zSign, showHeadlights) {
    const noseGroup = new THREE.Group();
    noseGroup.position.set(0, 0, zSign * 9.73);
    if (zSign > 0) {
      noseGroup.rotation.y = Math.PI;
    }

    const frpShellMat =
      noseShroudMat ||
      (series === 'YAMANOTE'
        ? this.frpMats.black
        : series === 'E531'
          ? this.frpMats.white
          : this.frpMats.pearl);

    // 1. 裾絞り＋丸屋根と完全一致する立体FRP先頭シェル＆前面キャップ（浮き・飛び出しゼロ・側面帯シームレス回り込み）
    const shroudMesh = new THREE.Mesh(this.noseShroudGeo, frpShellMat);
    shroudMesh.castShadow = true;
    noseGroup.add(shroudMesh);

    const capMesh = new THREE.Mesh(this.noseCapGeo, frontMat);
    noseGroup.add(capMesh);

    const zFront = this.noseZFrontOfY;

    // 2. 立体ワイパー（前面ガラス表面の手前へ正しく配置）
    for (const wx of [-0.46, 0.36]) {
      const wy = 2.26;
      const wiper = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.026, 0.024), this.bogieMat);
      wiper.position.set(wx, wy, zFront(wy) - 0.018);
      wiper.rotation.z = 0.14;
      noseGroup.add(wiper);
    }

    // 3. 屋根上列車無線アンテナ＆信号炎管
    const ant1 = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.075, 0.36, 8), this.antMat);
    ant1.position.set(-0.55, 3.74, 0.65);
    noseGroup.add(ant1);

    const ant2 = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.28, 8), this.roofMat);
    ant2.position.set(0.62, 3.71, 0.85);
    noseGroup.add(ant2);

    // 4. 裾絞り車体下端にピタリと収まる大型V字強化スカート（image_3 & image_4 準拠）
    const skirtLeftWing = new THREE.Mesh(
      new THREE.BoxGeometry(0.98, 0.56, 0.16),
      this.skirtWhiteMat
    );
    skirtLeftWing.position.set(-0.82, 0.72, -0.14);
    skirtLeftWing.rotation.y = 0.22;
    skirtLeftWing.rotation.z = 0.06;
    noseGroup.add(skirtLeftWing);

    const skirtRightWing = new THREE.Mesh(
      new THREE.BoxGeometry(0.98, 0.56, 0.16),
      this.skirtWhiteMat
    );
    skirtRightWing.position.set(0.82, 0.72, -0.14);
    skirtRightWing.rotation.y = -0.22;
    skirtRightWing.rotation.z = -0.06;
    noseGroup.add(skirtRightWing);

    const skirtBottomChin = new THREE.Mesh(
      new THREE.BoxGeometry(1.48, 0.17, 0.18),
      this.skirtWhiteMat
    );
    skirtBottomChin.position.set(0, 0.48, -0.23);
    noseGroup.add(skirtBottomChin);

    for (const sx of [-0.44, 0.44]) {
      const diag = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.44, 0.16), this.skirtWhiteMat);
      diag.position.set(sx, 0.66, -0.19);
      diag.rotation.z = sx < 0 ? -0.36 : 0.36;
      noseGroup.add(diag);
    }

    // 5. 連結器胴受・柴田式密着連結器・電気連結器
    const couplerBeam = new THREE.Mesh(new THREE.BoxGeometry(1.40, 0.18, 0.24), this.bogieMat);
    couplerBeam.position.set(0, 0.94, -0.12);
    noseGroup.add(couplerBeam);

    const couplerHead = new THREE.Mesh(
      new THREE.BoxGeometry(0.32, 0.25, 0.54),
      this.underEquipMat
    );
    couplerHead.position.set(0, 0.82, -0.34);
    noseGroup.add(couplerHead);

    const elecCoupler = new THREE.Mesh(
      new THREE.BoxGeometry(0.36, 0.15, 0.34),
      this.underEquipMat
    );
    elecCoupler.position.set(0, 0.64, -0.29);
    noseGroup.add(elecCoupler);

    // 6. 3D前照灯・尾灯（前面キャップの厳密な手前へ配置）
    if (showHeadlights) {
      if (series === 'E531' || series === 'UTSUNOMIYA' || series === 'KEIHIN') {
        const ly = 3.24;
        for (const lx of [-1.02, 1.02]) {
          const upperHid = new THREE.Mesh(
            new THREE.SphereGeometry(0.072, 10, 8),
            this.hidBloomMat
          );
          upperHid.position.set(lx, ly, zFront(ly) - 0.015);
          noseGroup.add(upperHid);
        }
      } else if (series === 'E231') {
        const ly = 1.49;
        for (const lx of [-0.66, 0.66]) {
          const lowHalogen = new THREE.Mesh(
            new THREE.BoxGeometry(0.20, 0.13, 0.04),
            this.halogenBloomMat
          );
          lowHalogen.position.set(lx, ly, zFront(ly) - 0.015);
          noseGroup.add(lowHalogen);
        }
      } else if (series === 'YAMANOTE') {
        const ly = 3.24;
        for (const lx of [-0.98, 0.98]) {
          const ymLed = new THREE.Mesh(
            new THREE.BoxGeometry(0.16, 0.12, 0.04),
            this.hidBloomMat
          );
          ymLed.position.set(lx, ly, zFront(ly) - 0.015);
          noseGroup.add(ymLed);
        }
      }
    } else {
      const tailY = series === 'E231' ? 1.49 : 3.24;
      const tailX = series === 'E231' ? 0.93 : 0.89;
      for (const tx of [-tailX, tailX]) {
        const tl = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 8), this.tailRedMat);
        tl.position.set(tx, tailY, zFront(tailY) - 0.015);
        noseGroup.add(tl);
      }
    }

    parent.add(noseGroup);
  }

  createConsist(parentGroup, { series = 'E531', cars = 10, headlightsOn = true }) {
    const carMeshes = [];
    const spacing = series === 'SHINKANSEN_E5' ? 25.0 : 20.0;
    for (let c = 0; c < cars; c++) {
      const car = this.createCarMesh({
        series,
        carIndex: c,
        totalCars: cars,
        headlightsOn,
      });
      parentGroup.add(car);
      carMeshes.push(car);
    }
    carMeshes.carSpacing = spacing;
    return carMeshes;
  }
}
