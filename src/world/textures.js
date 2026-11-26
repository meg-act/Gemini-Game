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
 * 沿線ビル・マンション群のリアルなファサードPBRテクスチャ（夕暮れ窓明かり＆ガラス反射）
 */
export function createBuildingFacadeVariants(anisotropy = 4) {
  const variants = [
    { seed: 101, wall: '#565961', mullion: '#3a3d45', litRate: 0.34, style: 'residential' },
    { seed: 202, wall: '#6c655e', mullion: '#4c4640', litRate: 0.38, style: 'apartment_warm' },
    { seed: 303, wall: '#3c4652', mullion: '#262e38', litRate: 0.44, style: 'office_glass' },
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

    // 外壁ベース
    cCtx.fillStyle = cfg.wall;
    cCtx.fillRect(0, 0, w, h);
    eCtx.fillStyle = '#000000';
    eCtx.fillRect(0, 0, w, h);
    rCtx.fillStyle = '#d8d8d8'; // 外壁はマット (roughness ~0.85)
    rCtx.fillRect(0, 0, w, h);

    const cols = cfg.style === 'office_glass' ? 12 : 9;
    const rows = 24;
    const cellW = w / cols;
    const cellH = h / rows;

    for (let r = 0; r < rows; r++) {
      // 階層スラブ・スパンドレル帯（コンクリート・アルミパネルの重厚感）
      cCtx.fillStyle = cfg.mullion;
      cCtx.fillRect(0, r * cellH, w, 5);

      if (cfg.style !== 'office_glass') {
        // マンションのバルコニー手すり腰壁
        cCtx.fillStyle = 'rgba(22, 25, 30, 0.42)';
        cCtx.fillRect(0, r * cellH + cellH * 0.58, w, cellH * 0.42);
      }

      for (let c = 0; c < cols; c++) {
        const padX = cfg.style === 'office_glass' ? 3 : 5;
        const padY = 6;
        const wx = c * cellW + padX;
        const wy = r * cellH + padY;
        const ww = cellW - padX * 2;
        const wh = cellH - padY * 1.7;

        // ガラス面（暗い反射面、roughness低めでマジックアワーの空をIBL反射！）
        cCtx.fillStyle = '#1d2530';
        cCtx.fillRect(wx, wy, ww, wh);
        rCtx.fillStyle = '#2c2c2c'; // ガラス roughness ~0.17
        rCtx.fillRect(wx, wy, ww, wh);

        // 夕暮れに点灯している部屋・オフィス
        if (rng() < cfg.litRate && r > 0) {
          const palette =
            cfg.style === 'office_glass'
              ? ['#d9ecff', '#fff0d4', '#cfe2ff']
              : ['#ffcf87', '#ffdca8', '#ffe9c4', '#dcebff'];
          const lightColor = palette[Math.floor(rng() * palette.length)];
          const brightness = 0.45 + rng() * 0.55;

          eCtx.save();
          eCtx.globalAlpha = brightness;
          eCtx.fillStyle = lightColor;
          // カーテンやブラインドで一部遮られたリアルな窓明かり
          const curtainRatio = rng() < 0.4 ? 0.55 + rng() * 0.35 : 1.0;
          eCtx.fillRect(wx + 1, wy + 1, (ww - 2) * curtainRatio, wh - 2);
          eCtx.restore();

          cCtx.fillStyle = lightColor;
          cCtx.globalAlpha = 0.5 * brightness;
          cCtx.fillRect(wx + 1, wy + 1, (ww - 2) * curtainRatio, wh - 2);
          cCtx.globalAlpha = 1.0;
        }
      }
    }

    const wrap = (cvs, srgb) => {
      const t = new THREE.CanvasTexture(cvs);
      t.wrapS = THREE.RepeatWrapping;
      t.wrapT = THREE.RepeatWrapping;
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

