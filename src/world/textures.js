import * as THREE from 'three';

/**
 * 決定論的シード乱数
 */
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
 * グレースケール高さ配列から Sobel フィルタで Tangent-Space Normal Map を生成
 */
function heightToNormalCanvas(heights, width, height, strength = 2.5) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(width, height);
  const data = img.data;

  const sample = (x, y) => {
    const wx = ((x % width) + width) % width;
    const wy = ((y % height) + height) % height;
    return heights[wy * width + wx];
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const tl = sample(x - 1, y - 1);
      const t = sample(x, y - 1);
      const tr = sample(x + 1, y - 1);
      const l = sample(x - 1, y);
      const r = sample(x + 1, y);
      const bl = sample(x - 1, y + 1);
      const b = sample(x, y + 1);
      const br = sample(x + 1, y + 1);

      const dx = (tr + 2 * r + br - (tl + 2 * l + bl)) * strength;
      const dy = (bl + 2 * b + br - (tl + 2 * t + tr)) * strength;
      const dz = 1.0;
      const invLen = 1.0 / Math.sqrt(dx * dx + dy * dy + dz * dz);

      const idx = (y * width + x) * 4;
      data[idx] = Math.round((-dx * invLen * 0.5 + 0.5) * 255);
      data[idx + 1] = Math.round((-dy * invLen * 0.5 + 0.5) * 255);
      data[idx + 2] = Math.round((dz * invLen * 0.5 + 0.5) * 255);
      data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/**
 * 砕石バラスト（花崗岩・安山岩＋鉄粉汚れ）PBRテクスチャセット
 */
export function createBallastTextures(anisotropy = 8) {
  const size = 512;
  const rng = mulberry32(1067);

  const albedoCanvas = document.createElement('canvas');
  albedoCanvas.width = size;
  albedoCanvas.height = size;
  const ctx = albedoCanvas.getContext('2d');

  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = size;
  roughCanvas.height = size;
  const rCtx = roughCanvas.getContext('2d');

  ctx.fillStyle = '#3b3734';
  ctx.fillRect(0, 0, size, size);
  rCtx.fillStyle = '#e8e8e8';
  rCtx.fillRect(0, 0, size, size);

  const heights = new Float32Array(size * size);

  // 多数の角張った砕石を描画（タイリング対応のため9方向ラップ）
  const stoneCount = 4200;
  for (let i = 0; i < stoneCount; i++) {
    const cx = rng() * size;
    const cy = rng() * size;
    const rad = 2.2 + rng() * 5.2;
    const shade = 52 + Math.floor(rng() * 58);
    const warm = Math.floor((rng() - 0.35) * 16);
    const r = Math.min(255, Math.max(20, shade + warm));
    const g = Math.min(255, Math.max(20, shade + Math.floor(warm * 0.4)));
    const b = Math.min(255, Math.max(20, shade - Math.floor(warm * 0.3)));

    const hVal = 0.35 + rng() * 0.65;
    const roughVal = Math.floor(205 + rng() * 45);

    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        const px = cx + ox * size;
        const py = cy + oy * size;
        if (px < -rad || px > size + rad || py < -rad || py > size + rad) continue;

        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.beginPath();
        const verts = 5 + Math.floor(rng() * 3);
        for (let v = 0; v < verts; v++) {
          const ang = (v / verts) * Math.PI * 2 + i * 0.7;
          const rr = rad * (0.72 + ((v * 37 + i) % 5) * 0.08);
          const vx = px + Math.cos(ang) * rr;
          const vy = py + Math.sin(ang) * rr;
          if (v === 0) ctx.moveTo(vx, vy);
          else ctx.lineTo(vx, vy);
        }
        ctx.closePath();
        ctx.fill();

        rCtx.fillStyle = `rgb(${roughVal},${roughVal},${roughVal})`;
        rCtx.fill();
      }
    }

    // 高さマップ書き込み
    const ir = Math.ceil(rad);
    for (let dy = -ir; dy <= ir; dy++) {
      for (let dx = -ir; dx <= ir; dx++) {
        const distSq = (dx * dx + dy * dy) / (rad * rad);
        if (distSq <= 1.0) {
          const wx = (((Math.round(cx) + dx) % size) + size) % size;
          const wy = (((Math.round(cy) + dy) % size) + size) % size;
          const h = hVal * (1.0 - distSq * 0.75);
          const idx = wy * size + wx;
          if (h > heights[idx]) heights[idx] = h;
        }
      }
    }
  }

  // レール直下付近に制輪子・鉄粉の茶褐色の帯汚れを追加（U方向が線路幅方向）
  const stainGrad = ctx.createLinearGradient(0, 0, size, 0);
  stainGrad.addColorStop(0.0, 'rgba(32, 24, 18, 0.25)');
  stainGrad.addColorStop(0.32, 'rgba(72, 43, 24, 0.36)');
  stainGrad.addColorStop(0.5, 'rgba(40, 34, 28, 0.16)');
  stainGrad.addColorStop(0.68, 'rgba(72, 43, 24, 0.36)');
  stainGrad.addColorStop(1.0, 'rgba(32, 24, 18, 0.25)');
  ctx.fillStyle = stainGrad;
  ctx.fillRect(0, 0, size, size);

  const normalCanvas = heightToNormalCanvas(heights, size, size, 3.2);

  const setupTex = (canvas, isSRGB) => {
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = anisotropy;
    if (isSRGB) tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  };

  return {
    map: setupTex(albedoCanvas, true),
    normalMap: setupTex(normalCanvas, false),
    roughnessMap: setupTex(roughCanvas, false),
  };
}

/**
 * コンクリート高架壁・橋脚用 風化PBRテクスチャ
 */
export function createConcreteTextures(anisotropy = 8) {
  const size = 512;
  const rng = mulberry32(20531);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#8b8d8e';
  ctx.fillRect(0, 0, size, size);

  const heights = new Float32Array(size * size);

  // 微細骨材ノイズ
  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < size * size; i++) {
    const n = (rng() - 0.5) * 24;
    img.data[i * 4] = Math.min(255, Math.max(0, 136 + n));
    img.data[i * 4 + 1] = Math.min(255, Math.max(0, 138 + n));
    img.data[i * 4 + 2] = Math.min(255, Math.max(0, 139 + n * 0.9));
    img.data[i * 4 + 3] = 255;
    heights[i] = 0.5 + (n / 48) * 0.25;
  }
  ctx.putImageData(img, 0, 0);

  // 型枠目地と雨だれ汚れ
  ctx.strokeStyle = 'rgba(55, 56, 58, 0.38)';
  ctx.lineWidth = 2;
  for (let y = 0; y < size; y += 128) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size, y);
    ctx.stroke();
    for (let x = 0; x < size; x++) {
      heights[y * size + x] = 0.15;
    }
  }
  for (let x = 0; x < size; x += 256) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, size);
    ctx.stroke();
  }

  // 雨だれストリーク
  for (let s = 0; s < 45; s++) {
    const sx = rng() * size;
    const len = 80 + rng() * 260;
    const g = ctx.createLinearGradient(sx, 0, sx, len);
    g.addColorStop(0, 'rgba(42, 44, 42, 0.22)');
    g.addColorStop(1, 'rgba(42, 44, 42, 0.0)');
    ctx.fillStyle = g;
    ctx.fillRect(sx, 0, 3 + rng() * 8, len);
  }

  const normalCanvas = heightToNormalCanvas(heights, size, size, 1.8);

  const map = new THREE.CanvasTexture(canvas);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = anisotropy;
  map.colorSpace = THREE.SRGBColorSpace;

  const normalMap = new THREE.CanvasTexture(normalCanvas);
  normalMap.wrapS = THREE.RepeatWrapping;
  normalMap.wrapT = THREE.RepeatWrapping;
  normalMap.anisotropy = anisotropy;

  return { map, normalMap };
}

/**
 * 駅ホーム上面テクスチャ（アスファルト舗装＋黄色い点字ブロック＋白線）
 * U = 0.0 が線路側エッジ、U = 1.0 がホーム奥側になるよう設計
 */
export function createPlatformSurfaceTexture(anisotropy = 8) {
  const w = 512;
  const h = 512;
  const rng = mulberry32(415);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  // ベースアスファルト
  ctx.fillStyle = '#484b50';
  ctx.fillRect(0, 0, w, h);

  const img = ctx.getImageData(0, 0, w, h);
  for (let i = 0; i < w * h; i++) {
    const n = (rng() - 0.5) * 22;
    img.data[i * 4] = Math.min(255, Math.max(20, 72 + n));
    img.data[i * 4 + 1] = Math.min(255, Math.max(20, 75 + n));
    img.data[i * 4 + 2] = Math.min(255, Math.max(20, 80 + n));
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);

  // 線路端のコンクリート笠石 (U: 0.0 〜 0.055)
  ctx.fillStyle = '#9a9d9e';
  ctx.fillRect(0, 0, 28, h);
  ctx.fillStyle = 'rgba(30,30,30,0.35)';
  ctx.fillRect(27, 0, 2, h);

  // 白い安全ライン
  ctx.fillStyle = '#dcdcdc';
  ctx.fillRect(36, 0, 7, h);

  // 黄色い点字ブロック（警告ブロック: U 0.095 〜 0.155）
  ctx.fillStyle = '#d9ad16';
  ctx.fillRect(49, 0, 30, h);
  ctx.strokeStyle = 'rgba(90, 68, 5, 0.45)';
  ctx.lineWidth = 1.5;
  for (let y = 0; y < h; y += 32) {
    ctx.strokeRect(49, y, 30, 32);
    // 点字突起ドット
    ctx.fillStyle = '#f2c938';
    for (let dy = 5; dy < 28; dy += 6) {
      for (let dx = 53; dx < 76; dx += 6) {
        ctx.fillRect(dx, y + dy, 3, 3);
      }
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = anisotropy;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * 沿線ビル・マンション・雑居ビル・下町住宅・町工場・UR団地の多様なファサードPBRテクスチャ（全10種）
 * - キャンバス上部 y=0..46 (Three.js UV v=0.91..1.00) は非発光の屋上防水コンクリート専用領域（屋上が窓模様にならない！）
 * - キャンバス下部 y=456..512 (UV v=0.00..0.11) は1階エントランス・コンビニ/店舗・シャッター等の接地階表現
 */
export function createBuildingFacadeVariants(anisotropy = 4) {
  const variants = [
    // 0: モダン高層・中層レジデンス（チャコール＆ガラス手すりバルコニー）
    {
      seed: 101,
      arch: 'modern_mansion',
      wall: '#4a4f57',
      mullion: '#30353d',
      roof: '#5a5f66',
      rows: 16,
      cols: 8,
      litRate: 0.36,
    },
    // 1: 昭和・平成の赤茶磁気タイル張り分譲マンション（沿線の定番！）
    {
      seed: 202,
      arch: 'tile_mansion',
      wall: '#8f5843',
      mullion: '#9c8f83',
      roof: '#63666a',
      rows: 11,
      cols: 7,
      litRate: 0.40,
    },
    // 2: ブルーグリーン全面ガラスカーテンウォール近代オフィスビル
    {
      seed: 303,
      arch: 'curtain_office',
      wall: '#2b4054',
      mullion: '#728699',
      roof: '#4e555d',
      rows: 16,
      cols: 10,
      litRate: 0.48,
    },
    // 3: 白・アイボリー系デザイナーズマンション（明るい白磁タイル＋黒サッシ＆縦格子ルーバー）
    {
      seed: 404,
      arch: 'ivory_mansion',
      wall: '#e4dfd4',
      mullion: '#3d4147',
      roof: '#696e73',
      rows: 10,
      cols: 7,
      litRate: 0.38,
    },
    // 4: 駅前・通り沿いの商業雑居ビル・ペンシルビル（横長連窓＋腰壁スパンドレル＋1階コンビニ発光）
    {
      seed: 505,
      arch: 'zakkyo_commercial',
      wall: '#9d988e',
      mullion: '#595c61',
      roof: '#585c62',
      rows: 10,
      cols: 5,
      litRate: 0.54,
    },
    // 5: 下町2〜3階建て戸建て住宅・木造モルタルアパート（明るいクリームベージュ＋雨戸袋＋ベランダ）
    {
      seed: 606,
      arch: 'house_warm',
      wall: '#d8cab4',
      mullion: '#5a4a3f',
      roof: '#52565c',
      rows: 3,
      cols: 4,
      litRate: 0.42,
    },
    // 6: 現代都市型3階建て狭小住宅・コーポ（スレートネイビー＋木目玄関＋スリット窓）
    {
      seed: 707,
      arch: 'house_cool',
      wall: '#3c4a5c',
      mullion: '#222a35',
      roof: '#474c54',
      rows: 3,
      cols: 4,
      litRate: 0.40,
    },
    // 7: 荒川・三河島・南千住の町工場・倉庫・作業所（青灰波板スレート＋1階重量シャッター＋高窓作業灯）
    {
      seed: 808,
      arch: 'factory',
      wall: '#687983',
      mullion: '#424e56',
      roof: '#505860',
      rows: 3,
      cols: 5,
      litRate: 0.36,
    },
    // 8: 大型UR団地・リバーサイド板状集合住宅（オフホワイト連続ベランダ＋外階段スリット）
    {
      seed: 909,
      arch: 'ur_danchi',
      wall: '#e5e0d5',
      mullion: '#889490',
      roof: '#686d72',
      rows: 12,
      cols: 8,
      litRate: 0.42,
    },
    // 9: ヴィンテージ赤レンガ・テラコッタ商業ビル／ビジネスホテル（2連縦長窓＋1階暖色店舗）
    {
      seed: 1010,
      arch: 'retro_brick',
      wall: '#824637',
      mullion: '#a89a88',
      roof: '#56595e',
      rows: 9,
      cols: 6,
      litRate: 0.46,
    },
    // 10: 純白アルミスパンドレル水平連窓オフィス・クリニックビル（白い横縞が都会的で鮮烈！）
    {
      seed: 1111,
      arch: 'white_modern_office',
      wall: '#eaedf2',
      mullion: '#b8c0ca',
      roof: '#6a7077',
      rows: 12,
      cols: 6,
      litRate: 0.50,
    },
    // 11: エメラルドグリーン反射ハーフミラーガラスビル（90〜00年代東京オフィスの象徴色！）
    {
      seed: 1212,
      arch: 'emerald_glass_tower',
      wall: '#1f4f50',
      mullion: '#9cb0b5',
      roof: '#4d5759',
      rows: 15,
      cols: 9,
      litRate: 0.46,
    },
  ];

  return variants.map((cfg) => {
    const w = 256;
    const h = 512;
    const rng = mulberry32(cfg.seed);

    const colorCanvas = document.createElement('canvas');
    colorCanvas.width = w;
    colorCanvas.height = h;
    const cCtx = colorCanvas.getContext('2d');

    const emissiveCanvas = document.createElement('canvas');
    emissiveCanvas.width = w;
    emissiveCanvas.height = h;
    const eCtx = emissiveCanvas.getContext('2d');

    const roughCanvas = document.createElement('canvas');
    roughCanvas.width = w;
    roughCanvas.height = h;
    const rCtx = roughCanvas.getContext('2d');

    // 全体初期化
    cCtx.fillStyle = cfg.wall;
    cCtx.fillRect(0, 0, w, h);
    eCtx.fillStyle = '#000000';
    eCtx.fillRect(0, 0, w, h);
    rCtx.fillStyle = '#dcdcdc';
    rCtx.fillRect(0, 0, w, h);

    // 外壁の微細テクスチャ（タイル目地・波板・モルタル粒子）
    if (cfg.arch === 'tile_mansion' || cfg.arch === 'retro_brick' || cfg.arch === 'ivory_mansion') {
      cCtx.fillStyle = 'rgba(0,0,0,0.10)';
      for (let ty = 56; ty < 460; ty += 6) {
        cCtx.fillRect(0, ty, w, 1);
      }
      cCtx.fillStyle = 'rgba(255,255,255,0.05)';
      for (let tx = 0; tx < w; tx += 16) {
        cCtx.fillRect(tx, 56, 1, 404);
      }
    } else if (cfg.arch === 'factory' || cfg.arch === 'house_cool') {
      // ガルバリウム・スレート波板の縦リブ陰影
      for (let tx = 0; tx < w; tx += 6) {
        cCtx.fillStyle = tx % 12 === 0 ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.05)';
        cCtx.fillRect(tx, 56, 2, 456);
      }
    }

    // -------------------------------------------------------------------------
    // 1. 屋上防水コンクリート領域 (y = 0..46 -> UV v = 0.91..1.00) — 完全非発光！
    // -------------------------------------------------------------------------
    const roofBottom = 46;
    cCtx.fillStyle = cfg.roof;
    cCtx.fillRect(0, 0, w, roofBottom);
    rCtx.fillStyle = '#e8e8e8';
    rCtx.fillRect(0, 0, w, roofBottom);

    // 屋上防水シートの伸縮目地と縁の雨染み
    cCtx.strokeStyle = 'rgba(30, 34, 38, 0.32)';
    cCtx.lineWidth = 1;
    for (let rx = 0; rx <= w; rx += 32) {
      cCtx.beginPath();
      cCtx.moveTo(rx, 0);
      cCtx.lineTo(rx, roofBottom);
      cCtx.stroke();
    }
    for (let ry = 0; ry <= roofBottom; ry += 16) {
      cCtx.beginPath();
      cCtx.moveTo(0, ry);
      cCtx.lineTo(w, ry);
      cCtx.stroke();
    }
    for (let n = 0; n < 180; n++) {
      const nx = rng() * w;
      const ny = rng() * (roofBottom - 2);
      cCtx.fillStyle = rng() < 0.5 ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.06)';
      cCtx.fillRect(nx, ny, 3, 3);
    }

    // パラペット笠木帯 (y = 46..56 -> UV v = 0.89..0.91)
    cCtx.fillStyle = '#343940';
    cCtx.fillRect(0, roofBottom, w, 6);
    cCtx.fillStyle = 'rgba(0,0,0,0.35)';
    cCtx.fillRect(0, roofBottom + 6, w, 4);
    rCtx.fillStyle = '#787878';
    rCtx.fillRect(0, roofBottom, w, 6);

    // -------------------------------------------------------------------------
    // 2. 中間階ファサード領域 (y = 56..456 -> UV v = 0.11..0.89)
    // -------------------------------------------------------------------------
    const bodyTop = 56;
    const bodyBottom = 456;
    const bodyH = bodyBottom - bodyTop;
    const cellW = w / cfg.cols;
    const cellH = bodyH / cfg.rows;
    const isGlassCurtain = cfg.arch === 'curtain_office' || cfg.arch === 'emerald_glass_tower';

    const getLightPalette = () => {
      if (cfg.arch === 'emerald_glass_tower') return ['#d4fff4', '#e8fff9', '#fff4d8', '#c4f5ea'];
      if (isGlassCurtain || cfg.arch === 'white_modern_office') {
        return ['#d8eeff', '#eef7ff', '#fff3d6', '#c6e0ff'];
      }
      if (cfg.arch === 'zakkyo_commercial') return ['#fff5dd', '#dff2ff', '#ffd596', '#ffe4b5'];
      if (cfg.arch === 'factory') return ['#d4f7ee', '#e2f2ff', '#fff0cf'];
      return ['#ffcf87', '#ffdca8', '#ffe9c4', '#dcebff', '#ffc270'];
    };
    const palette = getLightPalette();

    for (let r = 0; r < cfg.rows; r++) {
      const fy = bodyTop + r * cellH;
      const isMechFloor = isGlassCurtain && r === Math.floor(cfg.rows * 0.45);

      // スラブ・幕板・胴蛇腹ライン
      cCtx.fillStyle = cfg.mullion;
      const slabH = isGlassCurtain
        ? Math.max(4, cellH * 0.24)
        : cfg.arch === 'white_modern_office'
          ? Math.max(3, cellH * 0.10)
          : Math.max(3, cellH * 0.14);
      cCtx.fillRect(0, fy, w, slabH);

      // 白い水平連窓ビルは純白スパンドレル腰壁をくっきり残す！
      if (cfg.arch === 'white_modern_office') {
        cCtx.fillStyle = '#eff2f7';
        cCtx.fillRect(0, fy + cellH * 0.60, w, cellH * 0.40);
      } else if (cfg.arch === 'zakkyo_commercial') {
        cCtx.fillStyle = '#aba69c';
        cCtx.fillRect(0, fy + cellH * 0.64, w, cellH * 0.36);
      }

      if (isMechFloor) {
        // 近代オフィスビル中層階の機械室ガラリ（ルーバー階）
        cCtx.fillStyle = '#25303a';
        cCtx.fillRect(0, fy + slabH, w, cellH - slabH);
        cCtx.fillStyle = '#465462';
        for (let ly = fy + slabH + 2; ly < fy + cellH - 2; ly += 4) {
          cCtx.fillRect(4, ly, w - 8, 1.5);
        }
        rCtx.fillStyle = '#909090';
        rCtx.fillRect(0, fy, w, cellH);
        continue;
      }

      for (let c = 0; c < cfg.cols; c++) {
        const fx = c * cellW;

        // UR団地の中央外階段スリット表現
        if (cfg.arch === 'ur_danchi' && (c === 2 || c === 6)) {
          cCtx.fillStyle = '#8b938f';
          cCtx.fillRect(fx + 3, fy, cellW - 6, cellH);
          cCtx.fillStyle = '#2a3338';
          cCtx.fillRect(fx + 7, fy + 5, cellW - 14, cellH - 9);
          eCtx.fillStyle = '#fff0d0';
          eCtx.globalAlpha = 0.72;
          eCtx.fillRect(fx + 8, fy + 7, cellW - 16, cellH - 13);
          eCtx.globalAlpha = 1.0;
          continue;
        }

        const padX =
          isGlassCurtain || cfg.arch === 'white_modern_office'
            ? 1.5
            : cfg.arch === 'zakkyo_commercial'
              ? 3.5
              : cfg.arch.startsWith('house_')
                ? 9
                : 5;
        const padTop = slabH + (cfg.arch.startsWith('house_') ? 14 : 2.5);
        const padBot =
          cfg.arch === 'white_modern_office'
            ? cellH * 0.40
            : cfg.arch === 'zakkyo_commercial'
              ? cellH * 0.36
              : cfg.arch.includes('mansion') || cfg.arch === 'ur_danchi'
                ? cellH * 0.34
                : cfg.arch.startsWith('house_')
                  ? 22
                  : 6;

        const wx = fx + padX;
        const wy = fy + padTop;
        const ww = Math.max(6, cellW - padX * 2);
        const wh = Math.max(6, cellH - padTop - padBot);

        // ガラス窓ベース（IBL空反射用の低ラフネス面）
        cCtx.fillStyle =
          cfg.arch === 'emerald_glass_tower'
            ? '#13383a'
            : isGlassCurtain || cfg.arch === 'white_modern_office'
              ? '#1a2c3d'
              : '#1c242e';
        cCtx.fillRect(wx, wy, ww, wh);
        rCtx.fillStyle = isGlassCurtain || cfg.arch === 'white_modern_office' ? '#1e1e1e' : '#2e2e2e';
        rCtx.fillRect(wx, wy, ww, wh);

        // 戸建て住宅の引き違いサッシ中桟＆雨戸戸袋
        if (cfg.arch.startsWith('house_')) {
          cCtx.fillStyle = cfg.arch === 'house_warm' ? '#4b3b30' : '#dce2ea';
          cCtx.fillRect(wx + ww * 0.48, wy, 2, wh);
          if (cfg.arch === 'house_warm') {
            cCtx.fillStyle = '#5c493c';
            cCtx.fillRect(wx + ww, wy, 5, wh);
          }
        }

        // 夕暮れ〜夜間の室内点灯
        if (rng() < cfg.litRate) {
          const lightColor = palette[Math.floor(rng() * palette.length)];
          const brightness = 0.48 + rng() * 0.52;
          const curtainRatio = rng() < 0.42 ? 0.52 + rng() * 0.38 : 1.0;
          const blindTop = isGlassCurtain && rng() < 0.35 ? 0.35 : 0.0;

          const lx = wx + 1;
          const ly = wy + 1 + (wh - 2) * blindTop;
          const lw = (ww - 2) * curtainRatio;
          const lh = (wh - 2) * (1 - blindTop);

          eCtx.save();
          eCtx.globalAlpha = brightness;
          eCtx.fillStyle = lightColor;
          eCtx.fillRect(lx, ly, lw, lh);
          eCtx.restore();

          cCtx.save();
          cCtx.globalAlpha = 0.52 * brightness;
          cCtx.fillStyle = lightColor;
          cCtx.fillRect(lx, ly, lw, lh);
          cCtx.restore();
        }

        // 雑居ビルの窓面テナントカッティングシートサイン（小ぶりでリアルに！）
        if (cfg.arch === 'zakkyo_commercial' && rng() < 0.16) {
          const signCols = ['#e64a2e', '#f2be1a', '#2494eb', '#2fb85d'];
          const sc = signCols[Math.floor(rng() * signCols.length)];
          cCtx.fillStyle = sc;
          cCtx.fillRect(wx + 2, wy + wh * 0.65, ww - 4, wh * 0.30);
          eCtx.save();
          eCtx.globalAlpha = 0.58;
          eCtx.fillStyle = sc;
          eCtx.fillRect(wx + 2, wy + wh * 0.65, ww - 4, wh * 0.30);
          eCtx.restore();
        }

        // マンション・UR団地のベランダ手すり・隔て板・室外機ディテール
        if (cfg.arch.includes('mansion') || cfg.arch === 'ur_danchi') {
          const balY = fy + cellH * 0.62;
          const balH = cellH * 0.36;
          if (cfg.arch === 'modern_mansion') {
            // 半透明ダークガラス手すり＋アルミ笠木
            cCtx.fillStyle = 'rgba(26, 34, 44, 0.72)';
            cCtx.fillRect(fx + 2, balY, cellW - 4, balH);
            cCtx.fillStyle = '#8b95a1';
            cCtx.fillRect(fx + 2, balY, cellW - 4, 2);
            rCtx.fillStyle = '#484848';
            rCtx.fillRect(fx + 2, balY, cellW - 4, balH);
          } else if (cfg.arch === 'ivory_mansion') {
            // 縦格子ルーバー手すり
            cCtx.fillStyle = '#2d3138';
            for (let lx = fx + 3; lx < fx + cellW - 3; lx += 4) {
              cCtx.fillRect(lx, balY, 2, balH);
            }
          } else {
            // コンクリート・タイル腰壁ベランダ＋曇りガラス隔て板
            cCtx.fillStyle = cfg.arch === 'ur_danchi' ? '#e2ddd4' : '#968a7e';
            cCtx.fillRect(fx + 1, balY, cellW - 2, balH);
            cCtx.fillStyle = 'rgba(210, 225, 235, 0.55)';
            cCtx.fillRect(fx, fy + slabH, 2, cellH - slabH);
          }
        }
      }

      // 戸建て2階のベランダ手すり帯
      if (cfg.arch.startsWith('house_') && r === 1) {
        const by = fy + cellH * 0.68;
        cCtx.fillStyle = cfg.arch === 'house_warm' ? '#6d5c4d' : '#262d37';
        cCtx.fillRect(14, by, w - 28, cellH * 0.26);
      }
    }

    // カーテンウォール・商業ビルの縦マリオン方立
    if (isGlassCurtain || cfg.arch === 'modern_mansion' || cfg.arch === 'retro_brick') {
      cCtx.fillStyle = cfg.mullion;
      const mw = cfg.arch === 'retro_brick' ? 4 : 2;
      for (let c = 0; c <= cfg.cols; c++) {
        cCtx.fillRect(Math.min(w - mw, c * cellW), bodyTop, mw, bodyH);
      }
    }

    // -------------------------------------------------------------------------
    // 3. 1階 接地フロア表現 (y = 456..512 -> UV v = 0.00..0.11)
    // -------------------------------------------------------------------------
    cCtx.fillStyle = '#2b2e33';
    cCtx.fillRect(0, bodyBottom, w, h - bodyBottom);
    rCtx.fillStyle = '#b0b0b0';
    rCtx.fillRect(0, bodyBottom, w, h - bodyBottom);

    if (
      cfg.arch === 'zakkyo_commercial' ||
      isGlassCurtain ||
      cfg.arch === 'white_modern_office' ||
      cfg.arch === 'retro_brick'
    ) {
      // コンビニ・カフェ・店舗・オフィスロビーの明るい1階ガラスファサード＆行灯看板帯
      const signBandCol =
        cfg.arch === 'zakkyo_commercial'
          ? '#00995c'
          : cfg.arch === 'retro_brick'
            ? '#9e3628'
            : cfg.arch === 'emerald_glass_tower'
              ? '#008c84'
              : '#2864a8';
      cCtx.fillStyle = signBandCol;
      cCtx.fillRect(4, bodyBottom + 3, w - 8, 10);
      cCtx.fillStyle = '#f8f9fa';
      cCtx.fillRect(4, bodyBottom + 13, w - 8, 4);

      eCtx.fillStyle = signBandCol;
      eCtx.globalAlpha = 0.75;
      eCtx.fillRect(4, bodyBottom + 3, w - 8, 10);
      eCtx.fillStyle = '#fffdf6';
      eCtx.fillRect(4, bodyBottom + 13, w - 8, 4);

      // 1Fショーウィンドウの暖かな光
      const shopGlow = cfg.arch === 'retro_brick' ? '#ffd08a' : '#eef6ff';
      for (let sx = 10; sx < w - 18; sx += 40) {
        cCtx.fillStyle = shopGlow;
        cCtx.globalAlpha = 0.68;
        cCtx.fillRect(sx, bodyBottom + 20, 32, 30);
        cCtx.globalAlpha = 1.0;

        eCtx.fillStyle = shopGlow;
        eCtx.globalAlpha = 0.72;
        eCtx.fillRect(sx, bodyBottom + 20, 32, 30);
      }
      eCtx.globalAlpha = 1.0;
    } else if (cfg.arch === 'factory') {
      // 町工場・倉庫の大型スチールシャッター2連＋安全警戒ライン
      for (const sx of [16, 140]) {
        cCtx.fillStyle = '#7c8790';
        cCtx.fillRect(sx, bodyBottom + 8, 98, 44);
        cCtx.fillStyle = 'rgba(0,0,0,0.22)';
        for (let sy = bodyBottom + 12; sy < h; sy += 4) {
          cCtx.fillRect(sx, sy, 98, 1);
        }
        cCtx.fillStyle = '#d9a514';
        cCtx.fillRect(sx, bodyBottom + 5, 98, 3);
      }
    } else if (cfg.arch.startsWith('house_')) {
      // 下町戸建てのブロック塀・木目玄関ドア・玄関ポーチ灯
      cCtx.fillStyle = cfg.arch === 'house_warm' ? '#8c857b' : '#4a5058';
      cCtx.fillRect(0, bodyBottom + 18, w, 38);
      cCtx.fillStyle = '#6b442a';
      cCtx.fillRect(36, bodyBottom + 10, 26, 42);
      // 玄関灯
      eCtx.fillStyle = '#ffd27d';
      eCtx.fillRect(66, bodyBottom + 14, 8, 10);
      cCtx.fillStyle = '#ffe0a3';
      cCtx.fillRect(66, bodyBottom + 14, 8, 10);
    } else {
      // マンション・団地の石貼りエントランスホール＆植栽帯
      cCtx.fillStyle = '#3e4248';
      cCtx.fillRect(0, bodyBottom, w, 56);
      cCtx.fillStyle = '#ffdca2';
      cCtx.globalAlpha = 0.65;
      cCtx.fillRect(w * 0.36, bodyBottom + 12, w * 0.28, 38);
      cCtx.globalAlpha = 1.0;
      eCtx.fillStyle = '#ffdca2';
      eCtx.globalAlpha = 0.62;
      eCtx.fillRect(w * 0.36, bodyBottom + 12, w * 0.28, 38);
      eCtx.globalAlpha = 1.0;
      // 植栽グリーン帯
      cCtx.fillStyle = '#2a422d';
      cCtx.fillRect(6, h - 14, w * 0.26, 14);
      cCtx.fillRect(w * 0.68, h - 14, w * 0.26, 14);
    }

    const wrap = (cvs, srgb) => {
      const t = new THREE.CanvasTexture(cvs);
      t.wrapS = THREE.RepeatWrapping;
      t.wrapT = THREE.ClampToEdgeWrapping;
      t.anisotropy = anisotropy;
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };

    return {
      map: wrap(colorCanvas, true),
      emissiveMap: wrap(emissiveCanvas, true),
      roughnessMap: wrap(roughCanvas, false),
    };
  });
}

/**
 * 雑居ビル袖看板・屋上広告塔用の内照式サインアトラス（4列×2段 = 全8種）
 */
export function createUrbanSignageTexture(anisotropy = 4) {
  const w = 512;
  const h = 512;
  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = w;
  colorCanvas.height = h;
  const ctx = colorCanvas.getContext('2d');

  const emissiveCanvas = document.createElement('canvas');
  emissiveCanvas.width = w;
  emissiveCanvas.height = h;
  const eCtx = emissiveCanvas.getContext('2d');

  const signs = [
    { bg: '#f5c418', fg: '#15181c', accent: '#15181c', top: 'P 24H', lines: ['駐', '車', '場'] },
    { bg: '#d92929', fg: '#ffffff', accent: '#ffdf4d', top: 'KARAOKE', lines: ['カ', 'ラ', 'オ', 'ケ'] },
    { bg: '#1565c0', fg: '#ffffff', accent: '#7be3ff', top: 'CLINIC', lines: ['歯', '科', '・', '内', '科'] },
    { bg: '#008c52', fg: '#ffffff', accent: '#b8ffcf', top: 'ESTATE', lines: ['不', '動', '産', '仲', '介'] },
    { bg: '#eb6b18', fg: '#fffaf0', accent: '#361a08', top: 'DINING', lines: ['居', '酒', '屋', '・', '肴'] },
    { bg: '#f4f6f9', fg: '#14284b', accent: '#d93228', top: 'ACADEMY', lines: ['進', '学', '予', '備', '校'] },
    { bg: '#222834', fg: '#ffe082', accent: '#c99b3b', top: 'HOTEL', lines: ['ホ', 'テ', 'ル', '駅', '前'] },
    { bg: '#00a2c7', fg: '#ffffff', accent: '#ffe600', top: 'DRUG', lines: ['処', '方', 'せ', 'ん', '薬'] },
  ];

  const cw = w / 4;
  const ch = h / 2;

  signs.forEach((s, idx) => {
    const gx = (idx % 4) * cw;
    const gy = Math.floor(idx / 4) * ch;

    for (const target of [ctx, eCtx]) {
      const isEm = target === eCtx;
      target.save();
      target.fillStyle = isEm ? '#08090b' : '#2a2e34';
      target.fillRect(gx, gy, cw, ch);

      target.fillStyle = s.bg;
      target.globalAlpha = isEm ? 0.85 : 1.0;
      target.fillRect(gx + 6, gy + 6, cw - 12, ch - 12);

      target.fillStyle = s.accent;
      target.fillRect(gx + 6, gy + 6, cw - 12, 36);

      target.fillStyle = s.accent === '#15181c' || s.accent === '#361a08' ? '#ffffff' : '#111418';
      target.font = '800 18px "Inter", sans-serif';
      target.textAlign = 'center';
      target.textBaseline = 'middle';
      target.fillText(s.top, gx + cw * 0.5, gy + 24, cw - 20);

      target.fillStyle = s.fg;
      const stepY = (ch - 64) / s.lines.length;
      target.font = `900 ${Math.min(36, Math.floor(stepY * 0.82))}px "Noto Sans JP", sans-serif`;
      s.lines.forEach((chStr, li) => {
        target.fillText(chStr, gx + cw * 0.5, gy + 54 + stepY * (li + 0.5));
      });
      target.restore();
    }
  });

  const makeTex = (cvs) => {
    const t = new THREE.CanvasTexture(cvs);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = anisotropy;
    return t;
  };

  return {
    map: makeTex(colorCanvas),
    emissiveMap: makeTex(emissiveCanvas),
  };
}


/**
 * JR東日本（常磐線快速 JJ）仕様の内照式駅名標テクスチャ生成
 */
export function createStationSignTexture(station) {
  const w = 1024;
  const h = 320;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  // 内照式アクリル白背景（わずかに暖かみのあるLEDホワイト）
  ctx.fillStyle = '#f6f7f2';
  ctx.fillRect(0, 0, w, h);

  // 上下のダークグレーフレーム
  ctx.fillStyle = '#25282a';
  ctx.fillRect(0, 0, w, 18);
  ctx.fillRect(0, h - 18, w, 18);

  // JR東日本グリーンのコーポレート帯＋常磐線快速エメラルドグリーン＆常磐線ブルーアクセント
  const bandY = 212;
  ctx.fillStyle = '#009e52'; // 常磐快速エメラルドグリーン
  ctx.fillRect(0, bandY, w, 30);
  ctx.fillStyle = '#0072bc'; // 常磐線中距離ブルー細帯
  ctx.fillRect(0, bandY + 30, w, 8);

  // 進行方向（下り：左から右、または右から左 — 両面対応で中央強調）
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(w - 48, bandY + 15);
  ctx.lineTo(w - 78, bandY + 4);
  ctx.lineTo(w - 78, bandY + 26);
  ctx.closePath();
  ctx.fill();

  // 駅ナンバリングバッジ (JJ 02 等)
  const badgeX = 335;
  const badgeY = 44;
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#009e52';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.roundRect(badgeX, badgeY, 84, 84, 12);
  ctx.fill();
  ctx.stroke();

  const [linePrefix, lineNum] = station.code.split(' ');
  ctx.fillStyle = '#181a1b';
  ctx.font = '700 26px "Inter", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(linePrefix, badgeX + 42, badgeY + 33);
  ctx.font = '800 34px "Inter", sans-serif';
  ctx.fillText(lineNum, badgeX + 42, badgeY + 71);

  // 漢字駅名
  ctx.fillStyle = '#161819';
  ctx.font = '700 84px "Noto Sans JP", "Hiragino Sans", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(station.nameKanji, 442, 114);

  // ひらがな & 英語表記
  ctx.font = '600 32px "Noto Sans JP", sans-serif';
  ctx.fillText(station.nameKana, 445, 164);

  ctx.font = '600 30px "Inter", sans-serif';
  ctx.fillStyle = '#2b2f32';
  ctx.textAlign = 'center';
  ctx.fillText(station.nameEn, w * 0.54, 286);

  // 隣駅表記
  ctx.fillStyle = '#1f2326';
  ctx.font = '600 28px "Noto Sans JP", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`◀ ${station.prevName}`, 42, 286);
  ctx.textAlign = 'right';
  ctx.fillText(`${station.nextName} ▶`, w - 42, 286);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/**
 * 停止位置目標（15両 / ×印 菱形標識）テクスチャ
 */
export function createStopTargetTexture(label = '15') {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.rotate(Math.PI / 4);

  ctx.fillStyle = '#f5f6f8';
  ctx.strokeStyle = '#1b1d20';
  ctx.lineWidth = 12;
  ctx.fillRect(-82, -82, 164, 164);
  ctx.strokeRect(-82, -82, 164, 164);

  ctx.strokeStyle = '#d63628';
  ctx.lineWidth = 8;
  ctx.strokeRect(-68, -68, 136, 136);
  ctx.restore();

  ctx.fillStyle = '#141618';
  ctx.font = '900 88px "Inter", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, size / 2, size / 2 + 4);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * 制限速度標識テクスチャ
 */
export function createSpeedSignTexture(limitKmH) {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#f3f4f6';
  ctx.fillRect(16, 40, size - 32, size - 80);
  ctx.strokeStyle = '#1b1e22';
  ctx.lineWidth = 14;
  ctx.strokeRect(16, 40, size - 32, size - 80);

  ctx.fillStyle = '#141618';
  ctx.font = '900 108px "Inter", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(limitKmH), size / 2, size / 2 + 4);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * 隅田川の水面さざ波ノーマルマップ（シームレス周期波合成）
 */
export function createWaterNormalTexture() {
  const size = 256;
  const rng = mulberry32(3945);
  const phases = Array.from({ length: 14 }, () => ({
    fx: Math.floor((rng() - 0.5) * 26) || 3,
    fy: Math.floor((rng() - 0.5) * 26) || 5,
    ph: rng() * Math.PI * 2,
    amp: 0.04 + rng() * 0.12,
  }));

  const heights = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const v = (y / size) * Math.PI * 2;
    for (let x = 0; x < size; x++) {
      const u = (x / size) * Math.PI * 2;
      let h = 0;
      for (let k = 0; k < phases.length; k++) {
        const p = phases[k];
        h += Math.sin(u * p.fx + v * p.fy + p.ph) * p.amp;
      }
      heights[y * size + x] = h * 0.5 + 0.5;
    }
  }

  const canvas = heightToNormalCanvas(heights, size, size, 1.35);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/**
 * JR東日本 ATOS 2段フルカラーLED発車標（電光掲示板）テクスチャ
 */
export function createAtosLedBoardTexture(station) {
  const w = 512;
  const h = 160;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  // 筐体ダークグレー枠
  ctx.fillStyle = '#1b1e22';
  ctx.fillRect(0, 0, w, h);

  // 上部番線ヘッダー（常磐線エメラルド帯）
  ctx.fillStyle = '#282d33';
  ctx.fillRect(8, 8, w - 16, 34);
  ctx.fillStyle = '#00a65a';
  ctx.fillRect(8, 38, w - 16, 5);

  ctx.fillStyle = '#f2f5f8';
  ctx.font = '700 18px "Noto Sans JP", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(station.trackLabel || '常磐線（快速）', 18, 31);

  // LEDマトリクス黒背景
  ctx.fillStyle = '#0a0c0e';
  ctx.fillRect(14, 50, w - 28, 96);

  // 1段目: 快速 取手
  ctx.fillStyle = '#00c86f';
  ctx.fillRect(24, 58, 72, 34);
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 21px "Noto Sans JP", sans-serif';
  ctx.fillText('快 速', 34, 83);

  ctx.fillStyle = '#ff9e2c';
  ctx.font = '700 24px "JetBrains Mono", monospace';
  ctx.fillText('17:08', 112, 84);

  ctx.fillStyle = '#ffb84d';
  ctx.font = '700 24px "Noto Sans JP", sans-serif';
  ctx.fillText('取 手', 214, 84);

  ctx.fillStyle = '#6ce08b';
  ctx.font = '700 20px "Noto Sans JP", sans-serif';
  ctx.fillText('15両', 418, 83);

  // 2段目: 特別快速 土浦
  ctx.fillStyle = '#0072bc';
  ctx.fillRect(24, 102, 72, 34);
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 18px "Noto Sans JP", sans-serif';
  ctx.fillText('特 快', 36, 126);

  ctx.fillStyle = '#ff9e2c';
  ctx.font = '700 24px "JetBrains Mono", monospace';
  ctx.fillText('17:16', 112, 127);

  ctx.fillStyle = '#ffb84d';
  ctx.font = '700 24px "Noto Sans JP", sans-serif';
  ctx.fillText('土 浦', 214, 127);

  ctx.fillStyle = '#6ce08b';
  ctx.font = '700 20px "Noto Sans JP", sans-serif';
  ctx.fillText('15両', 418, 126);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * JR東日本 黄色い出口・乗換案内吊り下げサインボード
 */
export function createExitTransferSignTexture(station) {
  const w = 512;
  const h = 128;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#1e2124';
  ctx.fillRect(0, 0, w, h);

  // 左側：黄色い「↑ 出口 Exit」ブロック
  ctx.fillStyle = '#f5c71a';
  ctx.fillRect(8, 10, 176, h - 20);
  ctx.fillStyle = '#141618';
  ctx.font = '900 32px "Noto Sans JP", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('↑ 出 口', 22, 58);
  ctx.font = '700 19px "Inter", sans-serif';
  ctx.fillText('Exit / Way out', 24, 92);

  // 右側：白地または濃灰地の乗換路線案内
  ctx.fillStyle = '#f4f6f8';
  ctx.fillRect(190, 10, w - 198, h - 20);
  ctx.fillStyle = '#181b1f';
  ctx.font = '700 22px "Noto Sans JP", sans-serif';
  ctx.fillText('のりかえ Transfer', 206, 46);
  ctx.fillStyle = '#2d353e';
  ctx.font = '600 18px "Noto Sans JP", sans-serif';
  ctx.fillText(station.transferText || '改札・コンコース方面', 206, 86, w - 220);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * 運転士用 ITV ホーム監視4分割カラーモニター画面テクスチャ
 */
export function createItvMonitorTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#14171c';
  ctx.fillRect(0, 0, size, size);

  const quads = [
    [10, 10],
    [130, 10],
    [10, 130],
    [130, 130],
  ];
  quads.forEach(([qx, qy], i) => {
    ctx.fillStyle = '#232e38';
    ctx.fillRect(qx, qy, 116, 112);
    // ホーム点字ブロックと電車側面の監視カメラ映像風グラフィック
    ctx.fillStyle = '#5a6068';
    ctx.beginPath();
    ctx.moveTo(qx, qy + 112);
    ctx.lineTo(qx + 58, qy + 28);
    ctx.lineTo(qx + 116, qy + 112);
    ctx.fill();

    ctx.strokeStyle = '#e5be28';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(qx + 22, qy + 112);
    ctx.lineTo(qx + 58, qy + 32);
    ctx.stroke();

    ctx.fillStyle = '#8ef5a2';
    ctx.font = '700 13px monospace';
    ctx.fillText(`CAM ${i + 1}`, qx + 8, qy + 20);
  });

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * 駅ホーム上の飲料自動販売機（acure風バックライトディスプレイ）テクスチャ
 */
export function createVendingMachineTexture() {
  const w = 128;
  const h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#dce2e8';
  ctx.fillRect(0, 0, w, h);

  // ディスプレイ発光窓
  ctx.fillStyle = '#e8f4ff';
  ctx.fillRect(12, 20, w - 24, 128);

  const bottleColors = ['#2d8cf0', '#19be6b', '#ff9900', '#ed4014', '#8c6239', '#5cadff'];
  for (let r = 0; r < 3; r++) {
    ctx.fillStyle = '#9aa6b2';
    ctx.fillRect(14, 58 + r * 40, w - 28, 4);
    for (let c = 0; c < 6; c++) {
      ctx.fillStyle = bottleColors[(r * 6 + c) % bottleColors.length];
      ctx.fillRect(18 + c * 15, 34 + r * 40, 10, 22);
    }
  }

  // 取り出し口
  ctx.fillStyle = '#1f2429';
  ctx.fillRect(18, 188, w - 36, 36);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

