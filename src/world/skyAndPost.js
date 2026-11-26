import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/**
 * 時間帯プリセット（夕暮れ〜マジックアワー〜薄暮）
 * 方位角 azimuthDeg: 北(-Z)を0°、西(-X)を-90°とした太陽方向
 */
export const ATMOSPHERE_PRESETS = {
  magic_hour: {
    id: 'magic_hour',
    label: '茜色マジックアワー (17:05)',
    elevationDeg: 2.6,
    azimuthDeg: -56,
    turbidity: 8.8,
    rayleigh: 3.15,
    mieCoefficient: 0.0065,
    mieDirectionalG: 0.86,
    sunColor: 0xff853d,
    sunIntensity: 3.4,
    hemiSkyColor: 0x5c6d99,
    hemiGroundColor: 0x3b2820,
    hemiIntensity: 0.72,
    fogColor: 0x413544,
    fogDensity: 0.00046,
    exposure: 0.94,
    bloomStrength: 0.42,
    bloomThreshold: 0.82,
    windowGlowMultiplier: 1.25,
  },
  golden_hour: {
    id: 'golden_hour',
    label: '黄金色の夕暮れ (16:35)',
    elevationDeg: 7.2,
    azimuthDeg: -52,
    turbidity: 6.4,
    rayleigh: 2.15,
    mieCoefficient: 0.0055,
    mieDirectionalG: 0.84,
    sunColor: 0xffb268,
    sunIntensity: 4.1,
    hemiSkyColor: 0x899ec4,
    hemiGroundColor: 0x4a382b,
    hemiIntensity: 0.85,
    fogColor: 0x6f5b52,
    fogDensity: 0.00036,
    exposure: 0.92,
    bloomStrength: 0.36,
    bloomThreshold: 0.86,
    windowGlowMultiplier: 0.65,
  },
  twilight: {
    id: 'twilight',
    label: '群青の薄暮 (17:30)',
    elevationDeg: -0.5,
    azimuthDeg: -60,
    turbidity: 9.5,
    rayleigh: 3.6,
    mieCoefficient: 0.004,
    mieDirectionalG: 0.82,
    sunColor: 0xd95a38,
    sunIntensity: 1.15,
    hemiSkyColor: 0x364975,
    hemiGroundColor: 0x1d1b24,
    hemiIntensity: 0.62,
    fogColor: 0x22263a,
    fogDensity: 0.00052,
    exposure: 1.02,
    bloomStrength: 0.52,
    bloomThreshold: 0.74,
    windowGlowMultiplier: 1.85,
  },
};

/**
 * 実写カメラの光学特性を模したシネマティック・シェーダー（微細フィルムグレイン・周辺減光・極微小色収差）
 */
const CinematicLensShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignette: { value: 0.24 },
    uGrain: { value: 0.016 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uVignette;
    uniform float uGrain;
    varying vec2 vUv;

    float hash12(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    void main() {
      vec2 centered = vUv - 0.5;
      float r2 = dot(centered, centered);

      // 画面端のみ極わずかなレンズ色収差
      vec2 caOffset = centered * (0.0016 * r2);
      float r = texture2D(tDiffuse, vUv + caOffset).r;
      float g = texture2D(tDiffuse, vUv).g;
      float b = texture2D(tDiffuse, vUv - caOffset).b;
      vec3 col = vec3(r, g, b);

      // 自然な周辺減光 (Vignette)
      float vig = smoothstep(0.85, 0.18, r2 * (1.0 + uVignette * 1.4));
      col *= mix(1.0 - uVignette, 1.0, vig);

      // バンディングを防ぎ空気感を与える微細グレイン
      float n = hash12(vUv * 1280.0 + fract(uTime * 13.7)) - 0.5;
      col += n * uGrain;

      gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
    }
  `,
};

export class AtmosphereAndPost {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;

    this.sunDirection = new THREE.Vector3();
    this.currentPreset = ATMOSPHERE_PRESETS.magic_hour;
    this.onPresetCallbacks = [];

    // 1. 物理大気散乱 Sky ドーム
    this.sky = new Sky();
    this.sky.scale.setScalar(18000);
    this.scene.add(this.sky);

    // PMREM 用の軽量ミニSkyシーン（シーン内オブジェクトを含めず純粋な空＋地面照り返しをIBL化）
    this.pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    this.pmremGenerator.compileEquirectangularShader();
    this.envScene = new THREE.Scene();
    this.envSky = new Sky();
    this.envSky.scale.setScalar(500);
    this.envScene.add(this.envSky);

    // 下半球にバラスト・コンクリート照り返しドームを配置（裾絞りステンレス下部が自然な暖色シルバー反射を拾うように）
    const groundGeo = new THREE.SphereGeometry(400, 24, 12, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5);
    this.envGroundMat = new THREE.MeshBasicMaterial({ color: 0x58504d, side: THREE.BackSide });
    this.envScene.add(new THREE.Mesh(groundGeo, this.envGroundMat));

    // 高コントラスト金属反射用ホライゾン環境帯（空の青銀・明るい地平ハイライト・都市シルエット暗帯・暖色バラスト照り返し）
    // → これによりステンレス車体が白飛びせず、本物の銀色金属光沢と裾絞りグラデーションを発色する！
    const envCvs = document.createElement('canvas');
    envCvs.width = 64;
    envCvs.height = 128;
    const ectx = envCvs.getContext('2d');
    const eg = ectx.createLinearGradient(0, 0, 0, 128);
    eg.addColorStop(0.00, '#5a6e8e'); // 上空クールブルー
    eg.addColorStop(0.28, '#9cb0c8'); // 中空シルバーブルー
    eg.addColorStop(0.45, '#e8e2d8'); // 地平線直上の明るい銀白ハイライト帯
    eg.addColorStop(0.51, '#f4d9be'); // 夕暮れ地平線グレア
    eg.addColorStop(0.55, '#2b2d36'); // 都市ビル群の暗い水平シルエット（金属光沢の決め手！）
    eg.addColorStop(0.68, '#464144'); // 沿線構造物・高架反射
    eg.addColorStop(0.84, '#6b6058'); // バラスト・路盤の暖色照り返し
    eg.addColorStop(1.00, '#4a433e');
    ectx.fillStyle = eg;
    ectx.fillRect(0, 0, 64, 128);
    const envHorizTex = new THREE.CanvasTexture(envCvs);
    envHorizTex.colorSpace = THREE.SRGBColorSpace;

    const horizonGeo = new THREE.CylinderGeometry(380, 380, 380, 32, 1, true);
    this.envHorizonMat = new THREE.MeshBasicMaterial({
      map: envHorizTex,
      color: 0xffffff,
      side: THREE.BackSide,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
    });
    const horizonRing = new THREE.Mesh(horizonGeo, this.envHorizonMat);
    horizonRing.position.y = 0;
    this.envScene.add(horizonRing);
    this.envRT = null;

    // GPU / ソフトウェアWebGL判定（クラウド・低電力環境でも滑らかなフレームレートを保証）
    const gl = this.renderer.getContext();
    const dbgInfo = gl.getExtension('WEBGL_debug_renderer_info');
    const rendererName = dbgInfo ? gl.getParameter(dbgInfo.UNMASKED_RENDERER_WEBGL) || '' : '';
    this.isSoftwareGL = /SwiftShader|llvmpipe|Software/i.test(rendererName);

    // 2. 太陽光 DirectionalLight（プレイヤー追従シャドウ）+ 半球環境光
    this.sunLight = new THREE.DirectionalLight(0xff853d, 3.4);
    this.sunLight.castShadow = true;
    const shadowRes = this.isSoftwareGL ? 1024 : 2048;
    this.sunLight.shadow.mapSize.set(shadowRes, shadowRes);
    this.sunLight.shadow.camera.near = 10;
    this.sunLight.shadow.camera.far = 340;
    const shadowSpan = 74;
    this.sunLight.shadow.camera.left = -shadowSpan;
    this.sunLight.shadow.camera.right = shadowSpan;
    this.sunLight.shadow.camera.top = shadowSpan;
    this.sunLight.shadow.camera.bottom = -shadowSpan;
    this.sunLight.shadow.bias = -0.00045;
    this.sunLight.shadow.normalBias = 0.025;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    this.hemiLight = new THREE.HemisphereLight(0x5c6d99, 0x3b2820, 0.72);
    this.scene.add(this.hemiLight);

    // 3. 大気フォグ
    this.scene.fog = new THREE.FogExp2(0x413544, 0.00046);

    // 4. HDR マルチサンプル EffectComposer + UnrealBloomPass + CinematicLens + OutputPass
    this._initComposer();

    // 初期プリセット反映
    this.applyPreset('magic_hour');
  }

  _initComposer() {
    const size = new THREE.Vector2();
    this.renderer.getDrawingBufferSize(size);
    const maxSamples = this.isSoftwareGL
      ? 0
      : Math.min(4, this.renderer.capabilities.maxSamples || 0);

    const renderTarget = new THREE.WebGLRenderTarget(
      Math.max(1, size.x),
      Math.max(1, size.y),
      {
        type: THREE.HalfFloatType,
        samples: maxSamples,
      }
    );

    this.composer = new EffectComposer(this.renderer, renderTarget);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);

    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(Math.max(1, window.innerWidth), Math.max(1, window.innerHeight)),
      0.42, // strength
      0.62, // radius
      0.82  // threshold
    );
    this.composer.addPass(this.bloomPass);

    this.lensPass = new ShaderPass(CinematicLensShader);
    this.composer.addPass(this.lensPass);

    this.outputPass = new OutputPass();
    this.composer.addPass(this.outputPass);
  }

  onPresetChange(cb) {
    this.onPresetCallbacks.push(cb);
  }

  applyPreset(presetId) {
    const p = ATMOSPHERE_PRESETS[presetId] || ATMOSPHERE_PRESETS.magic_hour;
    this.currentPreset = p;

    // 太陽方向ベクトル (北 = -Z, 東 = +X)
    const elevRad = THREE.MathUtils.degToRad(p.elevationDeg);
    const azimRad = THREE.MathUtils.degToRad(p.azimuthDeg);
    const cosElev = Math.cos(elevRad);
    this.sunDirection.set(
      Math.sin(azimRad) * cosElev,
      Math.sin(elevRad),
      -Math.cos(azimRad) * cosElev
    ).normalize();

    const applySkyUniforms = (skyObj) => {
      const u = skyObj.material.uniforms;
      u['turbidity'].value = p.turbidity;
      u['rayleigh'].value = p.rayleigh;
      u['mieCoefficient'].value = p.mieCoefficient;
      u['mieDirectionalG'].value = p.mieDirectionalG;
      u['sunPosition'].value.copy(this.sunDirection);
    };

    applySkyUniforms(this.sky);
    applySkyUniforms(this.envSky);
    const groundBounce = new THREE.Color(p.hemiGroundColor).lerp(new THREE.Color(0x7c746e), 0.36);
    this.envGroundMat.color.copy(groundBounce);
    if (p.id === 'golden_hour') {
      this.envHorizonMat.color.setHex(0xeef2f6);
      this.envHorizonMat.opacity = 0.62;
    } else if (p.id === 'twilight') {
      this.envHorizonMat.color.setHex(0x8899bc);
      this.envHorizonMat.opacity = 0.56;
    } else {
      this.envHorizonMat.color.setHex(0xe8dfd8);
      this.envHorizonMat.opacity = 0.72;
    }

    // リアルタイム IBL 環境マップを再ベイク（レール金属光沢やガラス反射に直結）
    if (this.envRT) this.envRT.dispose();
    this.envRT = this.pmremGenerator.fromScene(this.envScene, 0.02);
    this.scene.environment = this.envRT.texture;

    this.sunLight.color.setHex(p.sunColor);
    this.sunLight.intensity = p.sunIntensity;
    this.hemiLight.color.setHex(p.hemiSkyColor);
    this.hemiLight.groundColor.setHex(p.hemiGroundColor);
    this.hemiLight.intensity = p.hemiIntensity;

    this.scene.fog.color.setHex(p.fogColor);
    this.scene.fog.density = p.fogDensity;

    this.renderer.toneMappingExposure = p.exposure;
    this.bloomPass.strength = p.bloomStrength;
    this.bloomPass.threshold = p.bloomThreshold;

    for (const cb of this.onPresetCallbacks) {
      cb(p);
    }
  }

  /**
   * 毎フレーム列車の現在位置に Sky ドームとシャドウカメラを追従させる
   */
  update(trainWorldPos, elapsedTime) {
    this.sky.position.copy(trainWorldPos);

    // シャドウのチラつきを抑えるためターゲット座標を緩やかにクォンタイズ
    const snap = 1.0;
    const tx = Math.round(trainWorldPos.x / snap) * snap;
    const ty = Math.round(trainWorldPos.y / snap) * snap;
    const tz = Math.round(trainWorldPos.z / snap) * snap;

    this.sunLight.target.position.set(tx, ty, tz);
    // 太陽が地平線スレスレでも安定した影角度を確保
    const shadowDir = this.sunDirection.clone();
    shadowDir.y = Math.max(0.11, shadowDir.y);
    shadowDir.normalize();
    this.sunLight.position.set(
      tx + shadowDir.x * 165,
      ty + shadowDir.y * 165,
      tz + shadowDir.z * 165
    );
    this.sunLight.target.updateMatrixWorld();

    this.lensPass.uniforms.uTime.value = elapsedTime;
  }

  resize(width, height) {
    this.composer.setSize(width, height);
    this.bloomPass.resolution.set(width, height);
  }

  render() {
    this.composer.render();
  }
}
