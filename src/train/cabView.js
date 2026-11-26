import * as THREE from 'three';
import { NEUTRAL_INDEX } from './physics.js';

const WORLD_UP = new THREE.Vector3(0, 1, 0);

/**
 * JR東日本 E531系 実車写真準拠 グラスコックピット3D運転台
 * - 上段ダークチャコール計器コンソール ＋ 下段ライトグレーデスクのツートン造形
 * - 左液晶（160km/h アーク速度計・デジタル速度・縦バー式BC/MR圧力計・架線電圧/電流計）
 * - 中央コラム（赤色「緊急」キノコボタン・アンバー照明フード付き鉄道懐中時計）
 * - 右液晶（TIMS モニタ：採時駅時刻表・15両編成状態図・ICカードスロット）
 * - 右端（黄色「VQS受入」銘板・赤枠デジタル列車無線パネル・緑発光ボタン＆銀丸ボタン付スイッチ台）
 * - 左手片持ちT字ワンハンドルマスコン（右端グリーンキャップ・黒革リストレスト付き）
 */
export class DriverCabView {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;

    this.trainRoot = new THREE.Group();
    this.scene.add(this.trainRoot);

    this.bodyRig = new THREE.Group();
    this.trainRoot.add(this.bodyRig);

    this.cabInterior = new THREE.Group();
    this.bodyRig.add(this.cabInterior);

    // E531系 左側運転士アイポイント（左手ワンハンドルマスコン・右手握り棒・2画面LCDすべてが自然に入る実車視点）
    this.eyeHolder = new THREE.Group();
    this.eyeHolder.position.set(-0.55, 2.365, 0.29);
    this.bodyRig.add(this.eyeHolder);
    this.eyeHolder.add(this.camera);

    this.basePitch = -0.142;
    this.lookYawOffset = 0;
    this.lookPitchOffset = 0;
    this.viewMode = 'cab';

    // 空気バネ＆台車継目サスペンション状態
    this.suspY = 0;
    this.suspVelY = 0;
    this.suspPitch = 0;
    this.suspVelPitch = 0;
    this.suspRoll = 0;
    this.suspVelRoll = 0;
    this.accelPitch = 0;
    this.masconVisualAngle = 0;

    this._panelTimer = 1.0;

    this._buildE531CabInterior();
    this._buildHeadlight();
    this._applyViewMode();
  }

  toggleViewMode() {
    this.viewMode = this.viewMode === 'cab' ? 'front' : 'cab';
    this._applyViewMode();
    return this.viewMode;
  }

  _applyViewMode() {
    if (this.viewMode === 'cab') {
      this.cabInterior.visible = true;
      this.eyeHolder.position.set(-0.55, 2.365, 0.29);
      this.basePitch = -0.142;
    } else {
      this.cabInterior.visible = false;
      this.eyeHolder.position.set(0.0, 2.42, -0.85);
      this.basePitch = -0.02;
    }
  }

  addLookOffset(dYaw, dPitch) {
    this.lookYawOffset = THREE.MathUtils.clamp(this.lookYawOffset + dYaw, -0.56, 0.56);
    this.lookPitchOffset = THREE.MathUtils.clamp(this.lookPitchOffset + dPitch, -0.36, 0.28);
  }

  resetLookOffset() {
    this.lookYawOffset = 0;
    this.lookPitchOffset = 0;
  }

  triggerJointImpulse({ axle = 1, zoneType = 'viaduct_ballast', speedKmh = 40 }) {
    const scale = Math.min(1.2, Math.max(0.15, speedKmh / 75));
    const zoneBoost = zoneType === 'turnout' ? 1.45 : zoneType === 'truss_bridge' ? 1.2 : 0.85;
    const amp = scale * zoneBoost;

    this.suspVelY += (axle === 1 ? 0.082 : 0.062) * amp;
    this.suspVelPitch += (axle === 1 ? 0.013 : -0.010) * amp;
    this.suspVelRoll += ((Math.random() - 0.5) * 0.020) * amp;
  }

  _buildE531CabInterior() {
    // E531系 実車インテリアマテリアル
    const upperConsoleMat = new THREE.MeshStandardMaterial({
      color: 0x262a2f, // 上部ダークチャコールコンソール
      roughness: 0.68,
      metalness: 0.16,
      envMapIntensity: 0.4,
    });
    const hoodLipMat = new THREE.MeshStandardMaterial({
      color: 0x1b1e23, // 最上部遮光ひさしリップ
      roughness: 0.58,
      metalness: 0.22,
    });
    const deskGreyMat = new THREE.MeshStandardMaterial({
      color: 0xa4abac, // E531系特有の明るいウォームグレーデスク天板！
      roughness: 0.48,
      metalness: 0.12,
      envMapIntensity: 0.65,
    });
    const wallLightMat = new THREE.MeshStandardMaterial({
      color: 0xcfd6da, // 運転室側壁のアイボリーホワイト内張り
      roughness: 0.55,
      metalness: 0.08,
    });
    const leatherPadMat = new THREE.MeshStandardMaterial({
      color: 0x181a1d, // 黒革アームレスト・グリップ
      roughness: 0.44,
      metalness: 0.18,
    });
    const chromeMat = new THREE.MeshStandardMaterial({
      color: 0xd8dfe6, // 銀メッキボタン・懐中時計ベゼル
      roughness: 0.16,
      metalness: 0.94,
      envMapIntensity: 1.4,
    });
    const emergencyRedMat = new THREE.MeshStandardMaterial({
      color: 0xd62c2c,
      roughness: 0.32,
      metalness: 0.1,
      emissive: new THREE.Color(0x450808),
    });

    // ---- 1. 下段ライトグレーデスクテーブル ＆ 左手黒革アームレスト ----
    const lowerPedestal = new THREE.Mesh(
      new THREE.BoxGeometry(2.76, 0.56, 0.74),
      new THREE.MeshStandardMaterial({ color: 0x3b4046, roughness: 0.7 })
    );
    lowerPedestal.position.set(0, 1.56, -0.56);
    this.cabInterior.add(lowerPedestal);

    // ライトグレー天板
    const deskTable = new THREE.Mesh(new THREE.BoxGeometry(2.74, 0.055, 0.56), deskGreyMat);
    deskTable.position.set(0, 1.862, -0.47);
    deskTable.receiveShadow = true;
    this.cabInterior.add(deskTable);

    // image.png 完全準拠：デスク手前縁の左右分割ブラックソフトパッド肘当て ＋ 中央逆台形切り欠き＆赤ランプ！
    const leftBolster = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.068, 0.085), leatherPadMat);
    leftBolster.position.set(-0.88, 1.882, -0.215);
    leftBolster.receiveShadow = true;
    this.cabInterior.add(leftBolster);

    const rightBolster = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.068, 0.085), leatherPadMat);
    rightBolster.position.set(-0.52, 1.882, -0.215);
    rightBolster.receiveShadow = true;
    this.cabInterior.add(rightBolster);

    // 切り欠き中央の赤色パイロットランプ（image.png 手前中央の赤い丸！）
    const recessLamp = new THREE.Mesh(
      new THREE.CylinderGeometry(0.008, 0.008, 0.012, 12),
      emergencyRedMat
    );
    recessLamp.rotation.x = Math.PI / 2;
    recessLamp.position.set(-0.70, 1.868, -0.205);
    this.cabInterior.add(recessLamp);

    // 左LCD手前の斜めグレー補助ブロック（image.png でマスコンすぐ右奥にある台形突起！）
    const leftWedge = new THREE.Mesh(new THREE.BoxGeometry(0.072, 0.048, 0.088), deskGreyMat);
    leftWedge.position.set(-0.73, 1.902, -0.51);
    leftWedge.rotation.x = 0.38;
    this.cabInterior.add(leftWedge);

    // ---- 2. 上段ダークチャコール傾斜コンソール筐体（fasciaMesh より確実に奥 z=-0.88 へ配置！） ----
    const consoleBack = new THREE.Mesh(new THREE.BoxGeometry(2.74, 0.33, 0.22), upperConsoleMat);
    consoleBack.position.set(0, 2.025, -0.88);
    consoleBack.rotation.x = -0.36;
    consoleBack.receiveShadow = true;
    this.cabInterior.add(consoleBack);

    // 上端を横断するスリム遮光ひさし
    const visorLip = new THREE.Mesh(new THREE.BoxGeometry(2.76, 0.028, 0.14), hoodLipMat);
    visorLip.position.set(0, 2.192, -0.79);
    visorLip.rotation.x = 0.04;
    visorLip.castShadow = true;
    visorLip.receiveShadow = true;
    this.cabInterior.add(visorLip);

    // ---- 3. 高精細 E531系 コンソールフェイス Canvas（左LCD + 中央懐中時計 + TIMS + ICカード + 無線器） ----
    this.panelCanvas = document.createElement('canvas');
    this.panelCanvas.width = 2048;
    this.panelCanvas.height = 440;
    this.panelCtx = this.panelCanvas.getContext('2d');
    this.panelTex = new THREE.CanvasTexture(this.panelCanvas);
    this.panelTex.colorSpace = THREE.SRGBColorSpace;
    this.panelTex.anisotropy = 4;

    const fasciaMat = new THREE.MeshStandardMaterial({
      map: this.panelTex,
      emissive: new THREE.Color(0xffffff),
      emissiveMap: this.panelTex,
      emissiveIntensity: 0.95,
      roughness: 0.32,
      metalness: 0.12,
    });
    // consoleBack の前面(-0.77)より手前 z = -0.745 にクリアに配置！
    const fasciaMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.48, 0.318), fasciaMat);
    fasciaMesh.position.set(-0.30, 2.032, -0.745);
    fasciaMesh.rotation.x = -0.36;
    this.cabInterior.add(fasciaMesh);

    // ---- 4. インパネ上の立体3Dパーツ（赤色「緊急」ボタン・照明フード付き鉄道懐中時計・ICカードスロット） ----
    const slopeGroup = new THREE.Group();
    slopeGroup.position.set(-0.30, 2.032, -0.742);
    slopeGroup.rotation.x = -0.36;
    this.cabInterior.add(slopeGroup);

    // (a) 赤い丸型「緊急」キノコボタン (X_px=716 -> x=-0.223m, Y_px=100 -> y=+0.087m)
    const emgBezel = new THREE.Mesh(new THREE.BoxGeometry(0.086, 0.086, 0.012), hoodLipMat);
    emgBezel.position.set(-0.223, 0.087, 0.004);
    slopeGroup.add(emgBezel);

    const emgButton = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.023, 0.022, 20),
      emergencyRedMat
    );
    emgButton.rotation.x = Math.PI / 2;
    emgButton.position.set(-0.223, 0.087, 0.015);
    slopeGroup.add(emgButton);

    // (b) 黒い半円照明フード ＋ オレンジ電球 ＋ 銀縁の鉄道懐中時計くぼみホルダー！
    const lampHood = new THREE.Mesh(
      new THREE.CylinderGeometry(0.022, 0.026, 0.030, 16, 1, false, 0, Math.PI),
      hoodLipMat
    );
    lampHood.position.set(-0.223, -0.016, 0.016);
    lampHood.rotation.z = Math.PI / 2;
    slopeGroup.add(lampHood);

    const watchBulbMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(3.8, 2.1, 0.55),
    });
    const watchBulb = new THREE.Mesh(new THREE.SphereGeometry(0.010, 10, 8), watchBulbMat);
    watchBulb.position.set(-0.223, -0.022, 0.014);
    slopeGroup.add(watchBulb);

    const watchRing = new THREE.Mesh(new THREE.TorusGeometry(0.0345, 0.0042, 10, 24), chromeMat);
    watchRing.position.set(-0.223, -0.068, 0.007);
    slopeGroup.add(watchRing);

    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.12, 6), leatherPadMat);
    cord.position.set(-0.182, -0.062, 0.011);
    cord.rotation.z = -0.18;
    slopeGroup.add(cord);

    // (c) TIMS右隣の立体ICカードスロット枠＆調光ツマミ (X_px=1611 -> +0.424m)
    const icSlot = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.102, 0.014), hoodLipMat);
    icSlot.position.set(0.424, -0.020, 0.006);
    slopeGroup.add(icSlot);

    const icCardEdge = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.066, 0.022), wallLightMat);
    icCardEdge.position.set(0.424, -0.022, 0.014);
    slopeGroup.add(icCardEdge);

    const dimmerKnob = new THREE.Mesh(
      new THREE.CylinderGeometry(0.010, 0.011, 0.018, 12),
      leatherPadMat
    );
    dimmerKnob.rotation.x = Math.PI / 2;
    dimmerKnob.position.set(0.386, -0.102, 0.012);
    slopeGroup.add(dimmerKnob);

    // ---- 5A. image.png 完全準拠：左デスク埋め込み式の本物「左手操作ワンハンドル主幹制御器（マスコン）」 ----
    // デスク天板にフラットに埋め込まれた黒いノッチガイドプレート (x = -0.89m, z = -0.42m)
    const masconTopPlate = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.012, 0.27), hoodLipMat);
    masconTopPlate.position.set(-0.89, 1.892, -0.42);
    this.cabInterior.add(masconTopPlate);

    // レバーが前後に走るスリット溝
    const masconSlot = new THREE.Mesh(
      new THREE.BoxGeometry(0.024, 0.015, 0.22),
      new THREE.MeshBasicMaterial({ color: 0x090b0e })
    );
    masconSlot.position.set(-0.835, 1.894, -0.42);
    this.cabInterior.add(masconSlot);

    // カラーノッチ目盛り帯（奥から EB赤・B黄橙・N白・P緑 — image.png の黄色・緑ライン再現！）
    const notchColors = [
      { z: -0.505, len: 0.032, col: 0xd93025 }, // EB
      { z: -0.445, len: 0.078, col: 0xe8b923 }, // B8..B1
      { z: -0.392, len: 0.020, col: 0xf2f5f8 }, // 切 (N)
      { z: -0.345, len: 0.065, col: 0x22a85c }, // P1..P5
    ];
    for (const nc of notchColors) {
      const strip = new THREE.Mesh(
        new THREE.BoxGeometry(0.014, 0.015, nc.len),
        new THREE.MeshBasicMaterial({ color: nc.col })
      );
      strip.position.set(-0.808, 1.895, nc.z);
      this.cabInterior.add(strip);
    }

    // マスコンプレート左奥の黒い丸玉レバーサー（前後切換ハンドル：image.png 左奥の黒玉レバー！）
    const revStalk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.005, 0.005, 0.048, 8),
      chromeMat
    );
    revStalk.position.set(-0.945, 1.918, -0.515);
    revStalk.rotation.x = -0.18;
    this.cabInterior.add(revStalk);

    const revBall = new THREE.Mesh(new THREE.SphereGeometry(0.016, 12, 10), leatherPadMat);
    revBall.position.set(-0.945, 1.942, -0.522);
    this.cabInterior.add(revBall);

    // 可動する左手ワンハンドルマスコンレバー（銀色の平板金属ステー＋黒L字グリップ＋銀ロック解除ボタン！）
    this.masconPivot = new THREE.Group();
    this.masconPivot.position.set(-0.835, 1.886, -0.42);
    this.cabInterior.add(this.masconPivot);

    // 銀色のヘアライン金属平板アーム（image.png でスロットから斜めに伸びる銀色ステー！）
    const masconArm = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.138, 0.034), chromeMat);
    masconArm.position.set(0, 0.064, 0);
    this.masconPivot.add(masconArm);

    // 黒い人間工学グリップ（ステー上端から左へも少し張り出すT/L字形状）
    const masconGrip = new THREE.Mesh(
      new THREE.CylinderGeometry(0.023, 0.021, 0.155, 18),
      leatherPadMat
    );
    masconGrip.rotation.z = Math.PI / 2;
    masconGrip.position.set(-0.048, 0.126, 0);
    this.masconPivot.add(masconGrip);

    // グリップ端の銀色リング＆ロック解除ボタン（image.png で光っている銀色の丸キャップ！）
    const unlockBtn = new THREE.Mesh(
      new THREE.CylinderGeometry(0.015, 0.015, 0.016, 16),
      chromeMat
    );
    unlockBtn.rotation.z = Math.PI / 2;
    unlockBtn.position.set(0.032, 0.126, 0);
    this.masconPivot.add(unlockBtn);

    // ---- 5B. 中央の「固定式 右手用握り棒（勾配起動スイッチ付）」 ※ただの持ち手なので絶対動かない！ ----
    const grabGroup = new THREE.Group();
    grabGroup.position.set(-0.47, 1.882, -0.41);
    this.cabInterior.add(grabGroup);

    const grabStalk = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.108, 0.046), leatherPadMat);
    grabStalk.position.set(0, 0.050, 0);
    grabGroup.add(grabStalk);

    const grabBar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.021, 0.021, 0.185, 16),
      leatherPadMat
    );
    grabBar.rotation.z = Math.PI / 2;
    grabBar.position.set(-0.072, 0.098, 0);
    grabGroup.add(grabBar);

    const hillStartCapMat = new THREE.MeshStandardMaterial({
      color: 0x1b8a4b, // 右端の緑色勾配起動スイッチ
      roughness: 0.32,
      metalness: 0.25,
    });
    const hillStartCap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.015, 0.015, 0.008, 14),
      hillStartCapMat
    );
    hillStartCap.rotation.z = Math.PI / 2;
    hillStartCap.position.set(0.022, 0.098, 0);
    grabGroup.add(hillStartCap);

    // 握り棒のすぐ右にある青・白・赤の小型角表示灯＆黒スイッチ座（image.png 中央のディテール！）
    const miniIndCols = [0x1e5aa8, 0xeef2f6, 0xc93232];
    miniIndCols.forEach((col, i) => {
      const ind = new THREE.Mesh(
        new THREE.BoxGeometry(0.018, 0.008, 0.022),
        new THREE.MeshStandardMaterial({ color: col, roughness: 0.4 })
      );
      ind.position.set(-0.41 + i * 0.026, 1.892, -0.35);
      this.cabInterior.add(ind);
    });
    const midSwitchBlock = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.026, 0.065), hoodLipMat);
    midSwitchBlock.position.set(-0.36, 1.898, -0.45);
    this.cabInterior.add(midSwitchBlock);

    // ---- 6. 右側の一段高いライトグレースイッチボックス ＋ 白い受話器（指令・車内電話）！ ----
    const rightConsole = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.068, 0.36), deskGreyMat);
    rightConsole.position.set(-0.05, 1.902, -0.41);
    rightConsole.rotation.x = 0.06;
    rightConsole.receiveShadow = true;
    this.cabInterior.add(rightConsole);

    this.greenSwitchMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.15, 2.8, 0.65),
    });
    const greenLampBtn = new THREE.Mesh(
      new THREE.BoxGeometry(0.040, 0.016, 0.030),
      this.greenSwitchMat
    );
    greenLampBtn.position.set(-0.17, 1.943, -0.49);
    this.cabInterior.add(greenLampBtn);

    for (const tx of [-0.20, -0.15]) {
      const tog = new THREE.Mesh(new THREE.BoxGeometry(0.010, 0.034, 0.014), leatherPadMat);
      tog.position.set(tx, 1.946, -0.43);
      tog.rotation.x = -0.25;
      this.cabInterior.add(tog);
    }
    const whiteKnob = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.026, 0.016), wallLightMat);
    whiteKnob.position.set(-0.10, 1.944, -0.43);
    this.cabInterior.add(whiteKnob);

    for (const bx of [-0.19, -0.10, -0.01]) {
      const btnRing = new THREE.Mesh(
        new THREE.CylinderGeometry(0.020, 0.022, 0.015, 16),
        chromeMat
      );
      btnRing.position.set(bx, 1.940, -0.35);
      this.cabInterior.add(btnRing);
    }

    const reverserKnob = new THREE.Mesh(
      new THREE.CylinderGeometry(0.018, 0.014, 0.042, 12),
      leatherPadMat
    );
    reverserKnob.position.set(-0.02, 1.955, -0.49);
    this.cabInterior.add(reverserKnob);

    // 右端のアイボリーホワイト指令・車内電話機＆受話器（image.png 右手前の白い受話器！）
    const phoneCradleMat = new THREE.MeshStandardMaterial({ color: 0xdadbd4, roughness: 0.42 });
    const phoneBase = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.055, 0.19), phoneCradleMat);
    phoneBase.position.set(0.22, 1.945, -0.38);
    phoneBase.rotation.x = 0.18;
    phoneBase.rotation.y = 0.12;
    this.cabInterior.add(phoneBase);

    const phoneHandset = new THREE.Mesh(new THREE.BoxGeometry(0.054, 0.038, 0.21), phoneCradleMat);
    phoneHandset.position.set(0.22, 1.985, -0.38);
    phoneHandset.rotation.x = 0.18;
    phoneHandset.rotation.y = 0.12;
    this.cabInterior.add(phoneHandset);

    // ---- 7. E531系 左上小型モニタ・蛇腹配線ダクト・左乗務員室角丸窓・前面窓ピラー ----
    // コンソール左上端に載っている放送デッキ＋黒小型モニタ＋黒蛇腹ダクト（image.png 左上の特徴的機器！）
    const leftDeckUnit = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.068, 0.18), upperConsoleMat);
    leftDeckUnit.position.set(-1.05, 2.23, -0.82);
    leftDeckUnit.rotation.y = 0.22;
    this.cabInterior.add(leftDeckUnit);

    const leftMiniMon = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.135, 0.045), hoodLipMat);
    leftMiniMon.position.set(-1.05, 2.335, -0.82);
    leftMiniMon.rotation.y = 0.24;
    this.cabInterior.add(leftMiniMon);

    const conduitPipe = new THREE.Mesh(
      new THREE.CylinderGeometry(0.028, 0.028, 0.62, 10),
      leatherPadMat
    );
    conduitPipe.position.set(-1.02, 2.66, -0.86);
    conduitPipe.rotation.z = 0.18;
    this.cabInterior.add(conduitPipe);

    // 左端 乗務員室側壁（角丸2枚引き違い窓枠を表現して左側方の抜け感を再現！）
    const leftWallLower = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.68, 1.18), wallLightMat);
    leftWallLower.position.set(-1.26, 1.95, -0.32);
    this.cabInterior.add(leftWallLower);

    const leftWallUpper = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.28, 1.18), wallLightMat);
    leftWallUpper.position.set(-1.26, 2.90, -0.32);
    this.cabInterior.add(leftWallUpper);

    const sideWinSash = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.50, 0.78), hoodLipMat);
    sideWinSash.position.set(-1.23, 2.52, -0.36);
    // 中央サッシ縦桟のみ残して外の線路・並走列車もチラッと見えるように！
    sideWinSash.scale.set(1, 1, 0.04);
    this.cabInterior.add(sideWinSash);

    // 左フロントコーナーピラー
    const cornerPillar = new THREE.Mesh(new THREE.BoxGeometry(0.055, 1.32, 0.065), wallLightMat);
    cornerPillar.position.set(-1.08, 2.52, -0.88);
    cornerPillar.rotation.z = -0.035;
    cornerPillar.castShadow = true;
    this.cabInterior.add(cornerPillar);

    const sashStrip = new THREE.Mesh(new THREE.BoxGeometry(0.018, 1.32, 0.07), hoodLipMat);
    sashStrip.position.set(-1.048, 2.52, -0.885);
    sashStrip.rotation.z = -0.035;
    this.cabInterior.add(sashStrip);

    // 右端ピラー
    const rightPillar = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.38, 0.16), wallLightMat);
    rightPillar.position.set(1.36, 2.50, -0.84);
    rightPillar.rotation.z = 0.04;
    this.cabInterior.add(rightPillar);

    // 天井ルーフ＆上端サッシ
    const ceiling = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.22, 1.25), wallLightMat);
    ceiling.position.set(0, 3.04, -0.45);
    ceiling.castShadow = true;
    this.cabInterior.add(ceiling);

    // 右上の日除け・確認ミラーブラケット（写真右上に写っている金属ステー）
    const visorBracket = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.22, 0.04), deskGreyMat);
    visorBracket.position.set(0.24, 2.86, -0.82);
    this.cabInterior.add(visorBracket);

    // 上部遮光グラデーションフィルム
    const sunTint = new THREE.Mesh(
      new THREE.PlaneGeometry(2.68, 0.12),
      new THREE.MeshBasicMaterial({
        color: 0x0d252b,
        transparent: true,
        opacity: 0.34,
        depthWrite: false,
      })
    );
    sunTint.position.set(0, 2.86, -0.90);
    this.cabInterior.add(sunTint);

    // 極薄の低反射フロントガラス
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0xe4f3ff,
      roughness: 0.05,
      metalness: 0.0,
      transparent: true,
      opacity: 0.045,
      envMapIntensity: 0.85,
      depthWrite: false,
    });
    const windshield = new THREE.Mesh(new THREE.PlaneGeometry(2.68, 0.96), glassMat);
    windshield.position.set(0, 2.48, -0.91);
    this.cabInterior.add(windshield);

    // 運転室内環境フィルライト（懐中時計照明の暖色＋液晶照り返し）
    this.cabFillLight = new THREE.PointLight(0xffdfb8, 0.32, 2.1);
    this.cabFillLight.position.set(-0.56, 2.22, -0.48);
    this.cabInterior.add(this.cabFillLight);
  }

  _buildHeadlight() {
    this.headlight = new THREE.SpotLight(0xf2f6ff, 7.5, 145, Math.PI / 5.2, 0.88, 1.35);
    this.headlight.position.set(0, 2.95, -1.05);
    this.headlight.target.position.set(0, 0.35, -85);
    this.bodyRig.add(this.headlight);
    this.bodyRig.add(this.headlight.target);
  }

  /**
   * 添付写真を忠実に再現した E531系 2画面グラスコックピット＋懐中時計＋無線器 描画
   */
  _redrawInstrumentPanel(state) {
    const ctx = this.panelCtx;
    const W = 2048;
    const H = 440;

    // 1. ダークチャコールインパネ地肌 + モジュール分割線・六角ボルト
    ctx.fillStyle = '#25292e';
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = '#181b1f';
    ctx.lineWidth = 4;
    ctx.strokeRect(18, 14, 590, 412);   // 左メーターベゼル
    ctx.strokeRect(618, 14, 196, 412);  // 中央懐中時計・緊急ボタンコラム
    ctx.strokeRect(824, 14, 920, 412);  // TIMSベゼル
    ctx.strokeRect(1754, 14, 276, 412); // 右端無線ベゼル

    // 六角ボルト頭ディテール
    ctx.fillStyle = '#171a1e';
    for (const [bx, by] of [
      [36, 32], [588, 32], [36, 408], [588, 408],
      [844, 32], [1724, 32], [844, 408], [1724, 408],
    ]) {
      ctx.beginPath();
      ctx.arc(bx, by, 5.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // 「緊急」ラベル（3D赤ボタン位置の上に重なる文字表現も補助）
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 18px "Noto Sans JP", sans-serif';
    ctx.textAlign = 'center';

    // =========================================================================
    // 2. 左液晶：E531系 グラスコックピット計器表示器 (x=52..574, y=46..394)
    // =========================================================================
    const lx = 52;
    const ly = 46;
    const lw = 522;
    const lh = 348;

    // 液晶枠の奥行き段差
    ctx.fillStyle = '#16191d';
    ctx.fillRect(lx - 8, ly - 8, lw + 16, lh + 16);

    // E531系特有のダークスレートグレー液晶バックライト
    const lcdGrad = ctx.createLinearGradient(lx, ly, lx, ly + lh);
    lcdGrad.addColorStop(0, '#2a333b');
    lcdGrad.addColorStop(1, '#232a31');
    ctx.fillStyle = lcdGrad;
    ctx.fillRect(lx, ly, lw, lh);

    // (a) 左上：交直流電源表示 [DC] / [AC]（写真ではオレンジ枠表示！）＋ 電圧・電流2連ミニメーター
    ctx.fillStyle = '#df8226';
    ctx.fillRect(lx + 112, ly + 16, 44, 24);
    ctx.fillStyle = '#141618';
    ctx.font = '800 16px "Inter", sans-serif';
    ctx.fillText('DC', lx + 134, ly + 34);

    // 架線電圧計 (1500V / kV) & 主電動機電流計 (A) ミニ円弧ゲージ
    const ampsNorm = state.motorEffort; // -1..+1
    const miniGauges = [
      { cx: lx + 92, cy: ly + 88, label: 'V', needleFrac: 0.68 },
      { cx: lx + 178, cy: ly + 88, label: 'A', needleFrac: 0.5 + ampsNorm * 0.42 },
    ];
    for (const mg of miniGauges) {
      ctx.strokeStyle = '#cfd8e0';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(mg.cx, mg.cy, 32, Math.PI * 1.1, Math.PI * 1.9);
      ctx.stroke();

      const na = Math.PI * (1.1 + THREE.MathUtils.clamp(mg.needleFrac, 0.05, 0.95) * 0.8);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(mg.cx, mg.cy);
      ctx.lineTo(mg.cx + Math.cos(na) * 28, mg.cy + Math.sin(na) * 28);
      ctx.stroke();

      ctx.fillStyle = '#aeb9c4';
      ctx.font = '600 12px "Inter", sans-serif';
      ctx.fillText(mg.label, mg.cx, mg.cy + 16);
    }

    // (b) 右上：保安装置ステータス枠 [ ] (写真の白い縦長枠2つ)
    ctx.strokeStyle = '#dce4ec';
    ctx.lineWidth = 2;
    ctx.strokeRect(lx + 312, ly + 22, 26, 56);
    ctx.strokeRect(lx + 468, ly + 22, 26, 56);
    ctx.fillStyle = '#8fa0b0';
    ctx.font = '600 13px "Inter", sans-serif';
    ctx.fillText('ATS-P', lx + 390, ly + 42);
    ctx.fillStyle = state.doorsOpen ? '#ff9f43' : '#4cd97b';
    ctx.fillText(state.doorsOpen ? '扉 開' : '戸 閉', lx + 390, ly + 66);

    // (c) 左下：縦型バーグラフ圧力計 BC (赤) / MR (白) 0〜1000 kPa（添付写真左下の完全再現！）
    const barBaseY = ly + 318;
    const barMaxH = 165;
    ctx.fillStyle = '#b8c4ce';
    ctx.font = '600 13px "Inter", sans-serif';
    ctx.fillText('BC', lx + 56, ly + 136);
    ctx.fillText('MR', lx + 116, ly + 136);

    // 目盛り線 (0, 200, 400, 600, 800, 1000)
    for (let k = 0; k <= 1000; k += 200) {
      const yTick = barBaseY - (k / 1000) * barMaxH;
      ctx.strokeStyle = 'rgba(210, 222, 232, 0.45)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(lx + 36, yTick);
      ctx.lineTo(lx + 138, yTick);
      ctx.stroke();

      ctx.fillStyle = '#9aa8b4';
      ctx.font = '600 11px "Inter", sans-serif';
      ctx.fillText(String(k), lx + 20, yTick + 4);
    }

    // BC 赤色バー
    const bcH = Math.min(1, state.bcPressure / 1000) * barMaxH;
    ctx.fillStyle = '#ff4d42';
    ctx.fillRect(lx + 46, barBaseY - bcH, 20, bcH);

    // MR 白色バー
    const mrH = Math.min(1, state.mrPressure / 1000) * barMaxH;
    ctx.fillStyle = '#eef5fc';
    ctx.fillRect(lx + 106, barBaseY - mrH, 20, mrH);

    // (d) 右下：E531系 160km/h アーク液晶スピードメーター ＋ 大型白デジタル速度表示！
    const sx = lx + 356;
    const sy = ly + 236;
    const sr = 116;
    const startAng = (142 * Math.PI) / 180;
    const sweepAng = (256 * Math.PI) / 180;

    for (let v = 0; v <= 160; v += 5) {
      const a = startAng + (v / 160) * sweepAng;
      const isMaj = v % 20 === 0;
      const rIn = isMaj ? sr - 17 : sr - 9;
      ctx.strokeStyle = v > state.speedLimit ? '#ffaa44' : '#e8f0f7';
      ctx.lineWidth = isMaj ? 2.8 : 1.3;
      ctx.beginPath();
      ctx.moveTo(sx + Math.cos(a) * rIn, sy + Math.sin(a) * rIn);
      ctx.lineTo(sx + Math.cos(a) * sr, sy + Math.sin(a) * sr);
      ctx.stroke();

      if (isMaj) {
        ctx.fillStyle = '#e8f0f7';
        ctx.font = '700 18px "Inter", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(v), sx + Math.cos(a) * (sr - 33), sy + Math.sin(a) * (sr - 33));
      }
    }

    // 白いシャープな液晶指針
    const spdAng = startAng + (Math.min(160, state.speedKmh) / 160) * sweepAng;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 4.5;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + Math.cos(spdAng) * (sr - 12), sy + Math.sin(spdAng) * (sr - 12));
    ctx.stroke();

    ctx.fillStyle = '#cfd8e2';
    ctx.beginPath();
    ctx.arc(sx, sy, 8, 0, Math.PI * 2);
    ctx.fill();

    // 下部大型デジタル速度（写真と同じ「108 km/h」スタイル！）
    ctx.fillStyle = '#ffffff';
    ctx.font = 'italic 800 48px "Inter", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(String(Math.round(state.speedKmh)), sx - 6, sy + 76);
    ctx.font = '600 16px "Inter", sans-serif';
    ctx.fillStyle = '#b9c6d2';
    ctx.fillText('km/h', sx + 54, sy + 84);

    // =========================================================================
    // 3. 中央コラム：アンバー照明に照らされたセイコー鉄道懐中時計 (cx=716, cy=314)
    // =========================================================================
    const wx = 716;
    const wy = 314;
    const wr = 46;

    // 時計くぼみへのオレンジ電球グラデーション照射
    const warmGlow = ctx.createRadialGradient(wx, wy - 44, 4, wx, wy - 10, 95);
    warmGlow.addColorStop(0, 'rgba(255, 175, 65, 0.55)');
    warmGlow.addColorStop(1, 'rgba(255, 140, 40, 0.0)');
    ctx.fillStyle = warmGlow;
    ctx.fillRect(wx - 85, wy - 95, 170, 180);

    // 懐中時計の白文字盤
    ctx.fillStyle = '#f5f4ec';
    ctx.beginPath();
    ctx.arc(wx, wy, wr, 0, Math.PI * 2);
    ctx.fill();

    // 1〜12 アラビア数字目盛り
    ctx.fillStyle = '#181a1c';
    ctx.font = '700 11px "Inter", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let hNum = 1; hNum <= 12; hNum++) {
      const ha = ((hNum * 30 - 90) * Math.PI) / 180;
      ctx.fillText(String(hNum), wx + Math.cos(ha) * (wr - 11), wy + Math.sin(ha) * (wr - 11));
    }

    // 17時05分基準でリアルタイムに秒針・分針が動く！
    const simSec = (5 * 60 + (state.elapsedTime || 0)) % 3600;
    const secAng = (((simSec % 60) * 6 - 90) * Math.PI) / 180;
    const minAng = ((((simSec / 60) % 60) * 6 - 90) * Math.PI) / 180;
    const hrAng = (((17 + simSec / 3600) * 30 - 90) * Math.PI) / 180;

    ctx.strokeStyle = '#111315';
    ctx.lineWidth = 3.0;
    ctx.beginPath();
    ctx.moveTo(wx, wy);
    ctx.lineTo(wx + Math.cos(hrAng) * 22, wy + Math.sin(hrAng) * 22);
    ctx.stroke();

    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(wx, wy);
    ctx.lineTo(wx + Math.cos(minAng) * 33, wy + Math.sin(minAng) * 33);
    ctx.stroke();

    ctx.strokeStyle = '#c92a2a';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(wx, wy);
    ctx.lineTo(wx + Math.cos(secAng) * 35, wy + Math.sin(secAng) * 35);
    ctx.stroke();

    // =========================================================================
    // 4. 右液晶：TIMS 運転士支援モニタ (x=900..1460, y=64..388) + ICカード表示
    // =========================================================================
    ctx.fillStyle = '#b8c0c8';
    ctx.font = '700 20px "Inter", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('TIMS', 1180, 42);

    const tx = 900;
    const ty = 62;
    const tw = 560;
    const th = 326;

    ctx.fillStyle = '#15181c';
    ctx.fillRect(tx - 8, ty - 8, tw + 16, th + 16);

    // 写真通りのE531系TIMSダークオリーブ液晶背景
    ctx.fillStyle = '#242f26';
    ctx.fillRect(tx, ty, tw, th);

    // 上段ステータス（列車番号・速度・キロ程・ノッチ）
    ctx.strokeStyle = '#4c6150';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(tx + 8, ty + 8, tw - 16, 62);

    ctx.textAlign = 'left';
    ctx.fillStyle = '#a8d8a0';
    ctx.font = '600 15px "JetBrains Mono", monospace';
    const trainNo = state.serviceType === 'special_rapid' ? '3185M 特快' : '1627M 快速';
    const uenoKm = (2.2 + state.distance / 1000).toFixed(2);
    ctx.fillText(`列車  ${trainNo}`, tx + 18, ty + 28);
    ctx.fillText(`速度  ${Math.round(state.speedKmh)} km/h   キロ程 ${uenoKm}k`, tx + 18, ty + 54);

    // 右上ノッチ＆制限表示バッジ
    let notchColor = '#5b7060';
    if (state.notch.type === 'power') notchColor = '#1c9c56';
    else if (state.notch.type === 'brake') notchColor = '#cc8018';
    else if (state.notch.type === 'eb') notchColor = '#d12c2c';
    ctx.fillStyle = notchColor;
    ctx.fillRect(tx + tw - 116, ty + 14, 98, 48);
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 28px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(state.notch.id, tx + tw - 67, ty + 47);

    // 中段：採時駅時刻表テーブル（写真中央の時刻・キロ程リスト再現！）
    const rows = [
      { name: '日暮里', km: '2.20k', arr: '17:04', dep: '05', pass: false },
      { name: '三河島', km: '3.40k', arr: '07', dep: '07', pass: state.serviceType === 'special_rapid' },
      { name: '南千住', km: '5.60k', arr: '09', dep: '10', pass: state.serviceType === 'special_rapid' },
      { name: '北千住', km: '7.40k', arr: '12', dep: '13', pass: false },
    ];

    ctx.textAlign = 'left';
    rows.forEach((r, idx) => {
      const ry = ty + 96 + idx * 31;
      const isNext = r.name === state.nextStopName;
      if (isNext) {
        ctx.fillStyle = 'rgba(235, 210, 75, 0.18)';
        ctx.fillRect(tx + 12, ry - 18, tw - 24, 26);
      }
      ctx.fillStyle = isNext ? '#ffe866' : '#c8dfc2';
      ctx.font = '700 18px "Noto Sans JP", sans-serif';
      ctx.fillText(r.name, tx + 24, ry);

      ctx.font = '600 17px "JetBrains Mono", monospace';
      ctx.fillText(r.km, tx + 156, ry);
      ctx.fillText(r.pass ? '  レ  ' : r.arr, tx + 278, ry);
      ctx.fillText(r.pass ? '  レ  ' : r.dep, tx + 382, ry);
    });

    // 次駅残距離ハイライト行
    ctx.strokeStyle = '#4c6150';
    ctx.beginPath();
    ctx.moveTo(tx + 10, ty + 206);
    ctx.lineTo(tx + tw - 10, ty + 206);
    ctx.stroke();

    ctx.fillStyle = '#ffe252';
    ctx.font = '700 18px "Noto Sans JP", sans-serif';
    const remStr =
      Math.abs(state.remainingMeters) < 1000
        ? `${state.remainingMeters >= 0 ? '残' : '過'} ${Math.abs(Math.round(state.remainingMeters))} m`
        : `残 ${(state.remainingMeters / 1000).toFixed(2)} km`;
    ctx.fillText(`次駅 ${state.nextStopName}   ${remStr}   (制限 ${state.speedLimit} km/h)`, tx + 22, ty + 231);

    // 下段：15両編成車両アイコン列（写真下部の15両インジケータ再現！4・5号車は2階建てサロ）
    for (let c = 1; c <= 15; c++) {
      const cxBox = tx + 22 + (c - 1) * 34;
      const cyBox = ty + 248;
      const isSaro = c === 4 || c === 5;
      ctx.strokeStyle = '#9ec09a';
      ctx.lineWidth = 1.4;
      ctx.strokeRect(cxBox, isSaro ? cyBox - 4 : cyBox, 28, isSaro ? 32 : 26);
      ctx.fillStyle = state.doorsOpen ? '#e08b2c' : '#439c62';
      ctx.fillRect(cxBox + 2, cyBox + 2, 24, 9);
      ctx.fillStyle = '#d8ead4';
      ctx.font = '600 11px "Inter", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(String(c), cxBox + 14, cyBox + 22);
    }

    // 下端の青いTIMSソフトキーボタン（写真の青い角ボタン3つ！）
    const softKeys = [
      { x: tx + 14, label: 'メニュー' },
      { x: tx + tw - 178, label: '運行表示' },
      { x: tx + tw - 88, label: '設 定' },
    ];
    for (const sk of softKeys) {
      ctx.fillStyle = '#2d5aa6';
      ctx.strokeStyle = '#7ea8f0';
      ctx.lineWidth = 1.5;
      ctx.fillRect(sk.x, ty + 288, 78, 28);
      ctx.strokeRect(sk.x, ty + 288, 78, 28);
      ctx.fillStyle = '#eef4ff';
      ctx.font = '700 14px "Noto Sans JP", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(sk.label, sk.x + 39, ty + 306);
    }

    // TIMS右隣の「ICカード」白銘板＆オレンジ確認灯
    ctx.fillStyle = '#eef2f6';
    ctx.fillRect(1568, 152, 86, 22);
    ctx.fillStyle = '#181a1d';
    ctx.font = '700 13px "Noto Sans JP", sans-serif';
    ctx.fillText('ICカード', 1611, 167);

    ctx.fillStyle = '#ff9c38';
    ctx.fillRect(1588, 342, 34, 28);

    // =========================================================================
    // 5. 右端：黄色い「VQS受入」銘板 ＋ 赤枠デジタル列車無線パネル (x=1770..2012)
    // =========================================================================
    ctx.fillStyle = '#f0c419';
    ctx.fillRect(1796, 36, 128, 36);
    ctx.fillStyle = '#1d1a10';
    ctx.font = '700 18px "Noto Sans JP", sans-serif';
    ctx.fillText('VQS受入', 1860, 58);

    // デジタル無線受話器・丸型操作ダイヤル（写真右端の赤枠パネル）
    ctx.fillStyle = '#1c2026';
    ctx.fillRect(1782, 118, 220, 284);
    ctx.strokeStyle = '#a82c2c';
    ctx.lineWidth = 5;
    ctx.strokeRect(1792, 128, 200, 128);

    ctx.strokeStyle = '#78828e';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(1892, 192, 42, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#c84b38';
    ctx.beginPath();
    ctx.arc(1892, 192, 14, 0, Math.PI * 2);
    ctx.fill();

    // テンキー格子
    ctx.fillStyle = '#cfd6de';
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 3; c++) {
        ctx.fillRect(1912 + c * 22, 292 + r * 22, 16, 16);
      }
    }

    this.panelTex.needsUpdate = true;
  }

  update(dt, elapsedTime, simState) {
    const safeDt = Math.min(dt, 0.05);
    const frame = simState.frame;

    const horizRight = new THREE.Vector3().crossVectors(frame.tangent, WORLD_UP).normalize();
    const normalUp = new THREE.Vector3().crossVectors(horizRight, frame.tangent).normalize();
    const basis = new THREE.Matrix4().makeBasis(
      horizRight,
      normalUp,
      frame.tangent.clone().negate()
    );
    this.trainRoot.position.copy(frame.position);
    this.trainRoot.quaternion.setFromRotationMatrix(basis);

    // 空気バネサスペンション更新
    const kSpring = 68.0;
    const cDamp = 11.5;

    this.suspVelY += (-kSpring * this.suspY - cDamp * this.suspVelY) * safeDt;
    this.suspY += this.suspVelY * safeDt;

    this.suspVelPitch += (-54 * this.suspPitch - 9.5 * this.suspVelPitch) * safeDt;
    this.suspPitch += this.suspVelPitch * safeDt;

    this.suspVelRoll += (-44 * this.suspRoll - 8.5 * this.suspVelRoll) * safeDt;
    this.suspRoll += this.suspVelRoll * safeDt;

    const speedFactor = Math.min(1.0, simState.speedKmh / 90);
    const microBobY =
      (Math.sin(elapsedTime * 8.7) * 0.0028 + Math.sin(elapsedTime * 19.3) * 0.0012) * speedFactor;
    const microSwayRoll =
      (Math.sin(elapsedTime * 2.3) * 0.0032 + Math.cos(elapsedTime * 5.7) * 0.0015) * speedFactor;

    const targetAccelPitch = THREE.MathUtils.clamp(simState.accelerationMps2 * 0.011, -0.018, 0.014);
    this.accelPitch = THREE.MathUtils.lerp(this.accelPitch, targetAccelPitch, safeDt * 6.0);

    this.bodyRig.position.set(0, this.suspY + microBobY, 0);
    this.bodyRig.rotation.order = 'ZYX';
    this.bodyRig.rotation.z = -frame.cant + this.suspRoll + microSwayRoll;
    this.bodyRig.rotation.x = this.suspPitch + this.accelPitch;

    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.lookYawOffset;
    this.camera.rotation.x = this.basePitch + this.lookPitchOffset;
    this.camera.rotation.z = 0;

    // 左手ワンハンドルマスコンの前後スイング＋スリット前後スライド（右手握り棒は固定！）
    const relNotch = simState.notchIndex - NEUTRAL_INDEX;
    const targetLeverX =
      relNotch >= 0 ? -0.04 + (relNotch / 5) * 0.44 : -0.04 + (relNotch / 9) * 0.56;
    this.masconVisualAngle = THREE.MathUtils.lerp(this.masconVisualAngle, targetLeverX, safeDt * 18.0);
    this.masconPivot.rotation.x = this.masconVisualAngle;
    this.masconPivot.position.z = -0.405 + this.masconVisualAngle * 0.085;

    // 右スイッチ台の緑色戸閉・起動ランプ連動
    if (this.greenSwitchMat) {
      if (simState.doorsOpen) {
        this.greenSwitchMat.color.setRGB(0.08, 0.22, 0.10);
      } else {
        this.greenSwitchMat.color.setRGB(0.15, 2.8, 0.65);
      }
    }

    this._panelTimer += safeDt;
    if (this._panelTimer >= 0.05) {
      this._panelTimer = 0;
      this._redrawInstrumentPanel({ ...simState, elapsedTime });
    }
  }
}
