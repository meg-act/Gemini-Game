/**
 * Web Audio API による JR常磐線 E531系 リアルタイム物理音響シンセサイザー
 * 外部音声ファイル不要で以下をリアルタイム物理合成:
 *   1. 日立2レベル IGBT-VVVF（非同期キャリア＋上下PWM側帯波 fc±2fm ＆ 同期遷移＋回生ブレーキ音）＋ TDカルダン歯車音
 *   2. 駅ホームPAスピーカー残響付き 発車メロディ（日暮里・三河島・南千住・北千住 4駅オリジナルフレーズ）
 *   3. JR東日本 E531/E231系 3連ドアチャイム（E6-C6 ベル倍音）＋ リニア/空気扉開閉・戸閉ロック音
 *   4. 重厚な鋼製カムディテント・ワンハンドルマスコン操作音（Nロック・EB重打撃音別）
 *   5. 「ザ・ワールド」時間停止音（重低音ピッチドロップ＋フィルター収束＋減速時計秒針）＆ 時間再開音
 *   6. ボギー台車2軸ジョイント音・隅田川鉄橋共鳴・急カーブフランジスキール・電笛/空笛警笛・ブレーキ緩解排気音
 */
export class TrainSoundEngine {
  constructor() {
    this.ctx = null;
    this.isInitialized = false;
    this.isMuted = false;
    this.isTimeStopped = false;
    this.masterGain = null;
    this.uiSfxGain = null;
    this.paInput = null;
    this._noiseBuffer = null;
    this._melodyStoppers = [];
    this.isMelodyPlaying = false;
  }

  init() {
    if (this.isInitialized) {
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
      return;
    }

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;

    this.ctx = new AudioCtx();

    // ソフトコンプレッサー（複数音源が重なってもクリップしない自然なダイナミクス）
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -13;
    comp.knee.value = 16;
    comp.ratio.value = 4.5;
    comp.attack.value = 0.004;
    comp.release.value = 0.14;
    comp.connect(this.ctx.destination);
    this._comp = comp;

    // 走行・環境音用マスターゲイン（時間停止時に 0 へフェード）
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.84;
    this.masterGain.connect(comp);

    // 時間停止音・操作UI用ゲイン（時間停止中も鳴るがユーザーミュートには追従）
    this.uiSfxGain = this.ctx.createGain();
    this.uiSfxGain.gain.value = 0.90;
    this.uiSfxGain.connect(comp);

    // 駅ホーム天井PAスピーカー＋高天井コンコース残響チェーン（発車メロディ用）
    this._setupStationPAChain();

    this._noiseBuffer = this._createPinkWhiteNoiseBuffer(3.0);
    this._setupContinuousNodes();
    this.isInitialized = true;
    this._syncMasterGain();
  }

  _syncMasterGain() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (this.masterGain) {
      const target = this.isMuted || this.isTimeStopped ? 0.0 : 0.84;
      this.masterGain.gain.setTargetAtTime(target, now, this.isTimeStopped ? 0.08 : 0.06);
    }
    if (this.uiSfxGain) {
      this.uiSfxGain.gain.setTargetAtTime(this.isMuted ? 0.0 : 0.90, now, 0.04);
    }
  }

  setMuted(muted) {
    this.isMuted = muted;
    this._syncMasterGain();
  }

  setTimeStopped(stopped) {
    if (this.isTimeStopped === stopped) return;
    this.isTimeStopped = stopped;
    if (stopped) this.stopDepartureMelody();
    this._syncMasterGain();
    this.playTimeStopEffect(stopped);
  }

  _setupStationPAChain() {
    const sr = this.ctx.sampleRate;
    // 1.35秒の駅ホーム上屋リバーブ・インパルス応答を生成
    const irLen = Math.floor(sr * 1.35);
    const irBuf = this.ctx.createBuffer(2, irLen, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = irBuf.getChannelData(ch);
      for (let i = 0; i < irLen; i++) {
        const t = i / sr;
        const env = Math.exp(-t * 3.8) * (i < 420 ? i / 420 : 1.0);
        // 初期反射（屋根・反対側ホーム壁）をわずかに強調
        const early =
          i === Math.floor(sr * 0.022) || i === Math.floor(sr * 0.047) || i === Math.floor(sr * 0.083)
            ? 0.55
            : 0;
        d[i] = ((Math.random() * 2 - 1) * 0.42 + early) * env;
      }
    }

    this.paInput = this.ctx.createGain();
    this.paInput.gain.value = 1.0;

    // 駅トランペットスピーカー特有の帯域制限（中域に芯があり高域がわずかに抜ける）
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 380;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 4600;
    const midPeak = this.ctx.createBiquadFilter();
    midPeak.type = 'peaking';
    midPeak.frequency.value = 1650;
    midPeak.Q.value = 1.4;
    midPeak.gain.value = 4.2;

    const dryGain = this.ctx.createGain();
    dryGain.gain.value = 0.62;
    const wetGain = this.ctx.createGain();
    wetGain.gain.value = 0.48;

    const conv = this.ctx.createConvolver();
    conv.buffer = irBuf;

    this.paInput.connect(hp);
    hp.connect(lp);
    lp.connect(midPeak);
    midPeak.connect(dryGain);
    midPeak.connect(conv);
    conv.connect(wetGain);
    dryGain.connect(this.masterGain);
    wetGain.connect(this.masterGain);
  }

  _createPinkWhiteNoiseBuffer(durationSec) {
    const sr = this.ctx.sampleRate;
    const len = Math.floor(sr * durationSec);
    const buf = this.ctx.createBuffer(1, len, sr);
    const data = buf.getChannelData(0);

    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      const pink = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
      data[i] = pink * 0.75 + white * 0.25;
    }
    return buf;
  }

  _setupContinuousNodes() {
    const now = this.ctx.currentTime;

    // 1. 車輪転動ゴロゴロ音 + 高速風切りノイズ
    this.rollingSource = this.ctx.createBufferSource();
    this.rollingSource.buffer = this._noiseBuffer;
    this.rollingSource.loop = true;

    this.rollingFilter = this.ctx.createBiquadFilter();
    this.rollingFilter.type = 'bandpass';
    this.rollingFilter.frequency.value = 140;
    this.rollingFilter.Q.value = 0.85;

    this.rollingGain = this.ctx.createGain();
    this.rollingGain.gain.value = 0.0;

    this.rollingSource.connect(this.rollingFilter);
    this.rollingFilter.connect(this.rollingGain);
    this.rollingGain.connect(this.masterGain);
    this.rollingSource.start(now);

    // 2. 隅田川橋梁（鋼トラス橋）通過時の「ゴォォォ」低中域鉄骨共鳴音
    this.bridgeSource = this.ctx.createBufferSource();
    this.bridgeSource.buffer = this._noiseBuffer;
    this.bridgeSource.loop = true;

    this.bridgeFilter = this.ctx.createBiquadFilter();
    this.bridgeFilter.type = 'bandpass';
    this.bridgeFilter.frequency.value = 245;
    this.bridgeFilter.Q.value = 3.5;

    this.bridgeGain = this.ctx.createGain();
    this.bridgeGain.gain.value = 0.0;

    this.bridgeSource.connect(this.bridgeFilter);
    this.bridgeFilter.connect(this.bridgeGain);
    this.bridgeGain.connect(this.masterGain);
    this.bridgeSource.start(now);

    // 3. 日立2レベル IGBT-VVVF（キャリア＋上下PWM側帯波 fc±2fm ＆ 同期モード＋TDカルダン歯車音）
    this.vvvfBus = this.ctx.createGain();
    this.vvvfBus.gain.value = 0.0;

    // 車体床下からの伝搬を再現するレゾナントフィルター
    this.vvvfFormant = this.ctx.createBiquadFilter();
    this.vvvfFormant.type = 'bandpass';
    this.vvvfFormant.frequency.value = 1050;
    this.vvvfFormant.Q.value = 0.65;
    this.vvvfBus.connect(this.vvvfFormant);
    this.vvvfFormant.connect(this.masterGain);

    // 主非同期キャリア (fc)
    this.vvvfCarrierOsc = this.ctx.createOscillator();
    this.vvvfCarrierOsc.type = 'sine';
    this.vvvfCarrierOsc.frequency.value = 920;
    this.vvvfCarrierGain = this.ctx.createGain();
    this.vvvfCarrierGain.gain.value = 0.52;
    this.vvvfCarrierOsc.connect(this.vvvfCarrierGain);
    this.vvvfCarrierGain.connect(this.vvvfBus);

    // 上側PWM側帯波 (fc + 2*fm)
    this.vvvfSideUpOsc = this.ctx.createOscillator();
    this.vvvfSideUpOsc.type = 'sine';
    this.vvvfSideUpOsc.frequency.value = 960;
    this.vvvfSideUpGain = this.ctx.createGain();
    this.vvvfSideUpGain.gain.value = 0.36;
    this.vvvfSideUpOsc.connect(this.vvvfSideUpGain);
    this.vvvfSideUpGain.connect(this.vvvfBus);

    // 下側PWM側帯波 (fc - 2*fm)
    this.vvvfSideDnOsc = this.ctx.createOscillator();
    this.vvvfSideDnOsc.type = 'sine';
    this.vvvfSideDnOsc.frequency.value = 880;
    this.vvvfSideDnGain = this.ctx.createGain();
    this.vvvfSideDnGain.gain.value = 0.34;
    this.vvvfSideDnOsc.connect(this.vvvfSideDnGain);
    this.vvvfSideDnGain.connect(this.vvvfBus);

    // 発車直後の日立IGBT特有の繊細な2倍キャリア倍音（澄んだ「ヒュイィィーン」成分）
    this.vvvfHarmOsc = this.ctx.createOscillator();
    this.vvvfHarmOsc.type = 'triangle';
    this.vvvfHarmOsc.frequency.value = 1840;
    this.vvvfHarmGain = this.ctx.createGain();
    this.vvvfHarmGain.gain.value = 0.14;
    this.vvvfHarmOsc.connect(this.vvvfHarmGain);
    this.vvvfHarmGain.connect(this.vvvfBus);

    // 主電動機（誘導電動機）基本波うなり音
    this.motorBaseOsc = this.ctx.createOscillator();
    this.motorBaseOsc.type = 'triangle';
    this.motorBaseOsc.frequency.value = 60;
    this.motorBaseFilter = this.ctx.createBiquadFilter();
    this.motorBaseFilter.type = 'lowpass';
    this.motorBaseFilter.frequency.value = 420;
    this.motorBaseGain = this.ctx.createGain();
    this.motorBaseGain.gain.value = 0.0;
    this.motorBaseOsc.connect(this.motorBaseFilter);
    this.motorBaseFilter.connect(this.motorBaseGain);
    this.motorBaseGain.connect(this.masterGain);

    // 平行カルダン駆動 歯車噛み合い音（中高速域の「フォォォォン」）
    this.gearHarmonicOsc = this.ctx.createOscillator();
    this.gearHarmonicOsc.type = 'sawtooth';
    this.gearHarmonicOsc.frequency.value = 180;
    this.gearFilter = this.ctx.createBiquadFilter();
    this.gearFilter.type = 'bandpass';
    this.gearFilter.frequency.value = 520;
    this.gearFilter.Q.value = 2.4;
    this.gearGain = this.ctx.createGain();
    this.gearGain.gain.value = 0.0;
    this.gearHarmonicOsc.connect(this.gearFilter);
    this.gearFilter.connect(this.gearGain);
    this.gearGain.connect(this.masterGain);

    this.vvvfCarrierOsc.start(now);
    this.vvvfSideUpOsc.start(now);
    this.vvvfSideDnOsc.start(now);
    this.vvvfHarmOsc.start(now);
    this.motorBaseOsc.start(now);
    this.gearHarmonicOsc.start(now);

    // 4. 急カーブ（日暮里〜三河島 R300）でのフランジきしみ音（2音レゾナンス）
    this.flangeOsc = this.ctx.createOscillator();
    this.flangeOsc.type = 'sine';
    this.flangeOsc.frequency.value = 2680;
    this.flangeGain = this.ctx.createGain();
    this.flangeGain.gain.value = 0.0;
    this.flangeOsc.connect(this.flangeGain);
    this.flangeGain.connect(this.masterGain);
    this.flangeOsc.start(now);

    // 5. 運転室内の微かな空調ブロワー＋SIV補助電源の静かな環境音（停車時のリアルな空気感）
    this.hvacSource = this.ctx.createBufferSource();
    this.hvacSource.buffer = this._noiseBuffer;
    this.hvacSource.loop = true;
    const hvacFilter = this.ctx.createBiquadFilter();
    hvacFilter.type = 'lowpass';
    hvacFilter.frequency.value = 210;
    const hvacGain = this.ctx.createGain();
    hvacGain.gain.value = 0.024;
    this.hvacSource.connect(hvacFilter);
    hvacFilter.connect(hvacGain);
    hvacGain.connect(this.masterGain);
    this.hvacSource.start(now);
  }

  /**
   * 毎フレーム車両速度・モータートルク・軌道区間と同期して連続音を更新
   */
  update({ speedKmh, motorEffort, zoneType, curvature }) {
    if (!this.isInitialized || !this.ctx) return;
    const now = this.ctx.currentTime;
    const speedNorm = Math.min(1.0, speedKmh / 100);

    // 1. 転動ノイズ
    const rollVol = Math.pow(speedNorm, 1.32) * 0.24;
    this.rollingGain.gain.setTargetAtTime(rollVol, now, 0.06);
    this.rollingFilter.frequency.setTargetAtTime(100 + speedKmh * 3.6, now, 0.08);

    // 2. 隅田川トラス鉄橋の共鳴轟音
    const isBridge = zoneType === 'truss_bridge';
    const bridgeTarget = isBridge ? Math.pow(speedNorm, 1.1) * 0.34 : 0.0;
    this.bridgeGain.gain.setTargetAtTime(bridgeTarget, now, 0.12);
    this.bridgeFilter.frequency.setTargetAtTime(190 + speedKmh * 2.1, now, 0.1);

    // 3. E531系 日立2レベル IGBT-VVVF（力行 & 純電気回生ブレーキ両対応！）
    const absEffort = Math.abs(motorEffort);
    const isBraking = motorEffort < -0.02;
    const activeElectric = absEffort > 0.03 && (isBraking ? speedKmh > 3.5 : speedKmh > 0.25);

    if (activeElectric) {
      // すべり周波数を加味した誘導電動機周波数 fm (約 0..130Hz)
      const slip = isBraking ? -1.8 : 2.2;
      const fm = Math.max(4, speedKmh * 1.18 + slip);

      let fc = 920;
      let sideSpread = 2.0 * fm;
      let carrierWeight = 0.55;
      let sideWeight = 0.38;
      let harmWeight = 0.16;
      let busVol = 0.0;

      if (speedKmh < 18) {
        // 非同期域前半：日立IGBT特有の澄んだ高純度スイープ（約 880Hz → 1,090Hz）
        const t = speedKmh / 18;
        fc = 885 + t * 205;
        sideSpread = 2.0 * fm;
        carrierWeight = 0.58;
        sideWeight = 0.32 + t * 0.14;
        harmWeight = 0.18 * (1 - t * 0.35);
        busVol = (0.048 + 0.018 * t) * Math.min(1, absEffort * 1.25);
      } else if (speedKmh < 40) {
        // 非同期域後半〜同期3パルス遷移：側帯波が大きく広がり「ヒュイィィーン→フォォォン」へ移行！
        const t = (speedKmh - 18) / 22;
        fc = 1090 + t * 380;
        sideSpread = (2.0 + t * 1.5) * fm;
        carrierWeight = 0.45 * (1 - t * 0.55);
        sideWeight = 0.46 * (1 - t * 0.25);
        harmWeight = 0.10 * (1 - t);
        busVol = 0.058 * (1 - t * 0.42) * Math.min(1, absEffort * 1.2);
      } else if (speedKmh < 58) {
        // 同期3パルス → 1パルス域（E531の力強い中速同期トーン）
        const t = (speedKmh - 40) / 18;
        fc = fm * (9.0 - t * 3.0);
        sideSpread = fm * 2.0;
        carrierWeight = 0.36;
        sideWeight = 0.32;
        harmWeight = 0.06;
        busVol = 0.034 * (1 - t * 0.55) * Math.min(1, absEffort * 1.15);
      } else {
        // 1パルス定出力高速域（主電動機と歯車音が主役）
        fc = fm * 5.0;
        sideSpread = fm * 2.0;
        carrierWeight = 0.22;
        sideWeight = 0.16;
        harmWeight = 0.0;
        busVol = 0.013 * Math.min(1, absEffort * 1.1);
      }

      this.vvvfCarrierOsc.frequency.setTargetAtTime(Math.max(80, fc), now, 0.035);
      this.vvvfSideUpOsc.frequency.setTargetAtTime(Math.max(90, fc + sideSpread), now, 0.035);
      this.vvvfSideDnOsc.frequency.setTargetAtTime(Math.max(75, Math.abs(fc - sideSpread)), now, 0.035);
      this.vvvfHarmOsc.frequency.setTargetAtTime(Math.min(4800, fc * 2.0), now, 0.035);

      this.vvvfCarrierGain.gain.setTargetAtTime(carrierWeight, now, 0.04);
      this.vvvfSideUpGain.gain.setTargetAtTime(sideWeight, now, 0.04);
      this.vvvfSideDnGain.gain.setTargetAtTime(sideWeight * 0.92, now, 0.04);
      this.vvvfHarmGain.gain.setTargetAtTime(harmWeight, now, 0.04);
      this.vvvfFormant.frequency.setTargetAtTime(Math.min(2600, Math.max(420, fc * 0.95)), now, 0.06);
      this.vvvfBus.gain.setTargetAtTime(busVol, now, 0.045);

      // 主電動機うなり音（2×fm / 4極誘導機の基本音）
      const motorTone = Math.max(36, fm * 3.2);
      this.motorBaseOsc.frequency.setTargetAtTime(motorTone, now, 0.04);
      this.motorBaseFilter.frequency.setTargetAtTime(260 + speedKmh * 8.5, now, 0.06);
      this.motorBaseGain.gain.setTargetAtTime(
        0.048 * Math.min(1, absEffort * 1.15) * Math.min(1, speedKmh / 14),
        now,
        0.05
      );

      // 平行カルダン歯車噛み合い音（実車歯数比に準じた滑らかな上昇）
      const gearFreq = Math.max(95, speedKmh * 16.8);
      this.gearHarmonicOsc.frequency.setTargetAtTime(gearFreq, now, 0.04);
      this.gearFilter.frequency.setTargetAtTime(Math.min(2400, gearFreq * 1.15), now, 0.05);
      this.gearGain.gain.setTargetAtTime(
        0.034 * Math.min(1, absEffort * 1.1) * Math.min(1, speedKmh / 24),
        now,
        0.05
      );
    } else {
      this.vvvfBus.gain.setTargetAtTime(0.0, now, 0.06);
      this.motorBaseGain.gain.setTargetAtTime(0.0, now, 0.06);
      // 惰行中も中高速域ではわずかな歯車空転うなりを残す
      const coastGear = speedKmh > 25 ? 0.009 * Math.min(1, (speedKmh - 25) / 65) : 0.0;
      if (coastGear > 0) {
        const gearFreq = speedKmh * 16.8;
        this.gearHarmonicOsc.frequency.setTargetAtTime(gearFreq, now, 0.05);
        this.gearFilter.frequency.setTargetAtTime(Math.min(2200, gearFreq * 1.1), now, 0.06);
      }
      this.gearGain.gain.setTargetAtTime(coastGear, now, 0.08);
    }

    // 4. 急カーブでのフランジきしみ音
    const absCurv = Math.abs(curvature || 0);
    if (absCurv > 0.0016 && speedKmh > 18 && speedKmh < 78) {
      const squeal = Math.min(0.015, (absCurv - 0.0016) * 6.2) * (0.55 + 0.45 * Math.sin(now * 6.8));
      this.flangeOsc.frequency.setTargetAtTime(2620 + Math.sin(now * 2.9) * 85, now, 0.08);
      this.flangeGain.gain.setTargetAtTime(Math.max(0, squeal), now, 0.12);
    } else {
      this.flangeGain.gain.setTargetAtTime(0.0, now, 0.1);
    }
  }

  /**
   * 車輪がレール継目を通過した瞬間の「ガタン・ゴトン」単発インパルス合成
   */
  playRailJoint({ axle = 1, zoneType = 'viaduct_ballast', speedKmh = 40 }) {
    if (!this.isInitialized || !this.ctx || this.isMuted || this.isTimeStopped) return;
    const now = this.ctx.currentTime;
    const speedScale = Math.min(1.15, Math.max(0.2, speedKmh / 65));
    const isBridge = zoneType === 'truss_bridge';
    const isTurnout = zoneType === 'turnout';

    const thudOsc = this.ctx.createOscillator();
    thudOsc.type = 'triangle';
    const basePitch = axle === 1 ? 104 : 82;
    thudOsc.frequency.setValueAtTime(isBridge ? basePitch * 1.32 : basePitch, now);
    thudOsc.frequency.exponentialRampToValueAtTime(34, now + (isBridge ? 0.135 : 0.088));

    const thudGain = this.ctx.createGain();
    const vol = (isTurnout ? 0.32 : isBridge ? 0.35 : 0.23) * speedScale;
    thudGain.gain.setValueAtTime(vol, now);
    thudGain.gain.exponentialRampToValueAtTime(0.001, now + (isBridge ? 0.155 : 0.095));

    thudOsc.connect(thudGain);
    thudGain.connect(this.masterGain);
    thudOsc.start(now);
    thudOsc.stop(now + 0.165);

    const clickSrc = this.ctx.createBufferSource();
    clickSrc.buffer = this._noiseBuffer;
    const clickFilter = this.ctx.createBiquadFilter();
    clickFilter.type = 'bandpass';
    clickFilter.frequency.value = isBridge ? 1180 : isTurnout ? 940 : 680;
    clickFilter.Q.value = isBridge ? 3.2 : 1.9;

    const clickGain = this.ctx.createGain();
    clickGain.gain.setValueAtTime(vol * (isBridge ? 0.95 : 0.68), now);
    clickGain.gain.exponentialRampToValueAtTime(0.001, now + (isBridge ? 0.09 : 0.052));

    clickSrc.connect(clickFilter);
    clickFilter.connect(clickGain);
    clickGain.connect(this.masterGain);
    clickSrc.start(now, Math.random() * 1.4, 0.12);
  }

  /**
   * 実車ワンハンドルマスコン 機械式カムディテント操作音（「ガチッ」「カコンッ」）
   *   notchKind: 'normal' | 'neutral' | 'eb'
   */
  playNotchClick(notchKind = false) {
    if (!this.isInitialized || !this.ctx || this.isMuted) return;
    const now = this.ctx.currentTime;
    const kind =
      notchKind === true ? 'neutral' : notchKind === false ? 'normal' : notchKind;
    const isHeavy = kind === 'neutral' || kind === 'eb';
    const isEB = kind === 'eb';

    const fireDetent = (t0, gainScale, pitchScale) => {
      // 1. 金属カムローラーのシャープな接触打撃ノイズ（約8ms）
      const snapSrc = this.ctx.createBufferSource();
      snapSrc.buffer = this._noiseBuffer;
      const snapBp = this.ctx.createBiquadFilter();
      snapBp.type = 'bandpass';
      snapBp.frequency.value = 2350 * pitchScale;
      snapBp.Q.value = 2.8;
      const snapG = this.ctx.createGain();
      snapG.gain.setValueAtTime(0.24 * gainScale, t0);
      snapG.gain.exponentialRampToValueAtTime(0.001, t0 + 0.014);
      snapSrc.connect(snapBp);
      snapBp.connect(snapG);
      snapG.connect(this.uiSfxGain);
      snapSrc.start(t0, Math.random() * 1.2, 0.025);

      // 2. 運転台コンソール筐体の低中域「コツン・ゴトン」共鳴
      const bodyOsc = this.ctx.createOscillator();
      bodyOsc.type = 'triangle';
      bodyOsc.frequency.setValueAtTime(165 * pitchScale, t0);
      bodyOsc.frequency.exponentialRampToValueAtTime(58, t0 + 0.032);
      const bodyG = this.ctx.createGain();
      bodyG.gain.setValueAtTime(0.18 * gainScale, t0);
      bodyG.gain.exponentialRampToValueAtTime(0.001, t0 + 0.036);
      bodyOsc.connect(bodyG);
      bodyG.connect(this.uiSfxGain);
      bodyOsc.start(t0);
      bodyOsc.stop(t0 + 0.04);

      // 3. 鋼製スプリング・ピン着座の極小金属リング
      const ringOsc = this.ctx.createOscillator();
      ringOsc.type = 'sine';
      ringOsc.frequency.setValueAtTime(3650 * pitchScale, t0);
      const ringG = this.ctx.createGain();
      ringG.gain.setValueAtTime(0.045 * gainScale, t0);
      ringG.gain.exponentialRampToValueAtTime(0.0008, t0 + 0.022);
      ringOsc.connect(ringG);
      ringG.connect(this.uiSfxGain);
      ringOsc.start(t0);
      ringOsc.stop(t0 + 0.026);
    };

    fireDetent(now, isEB ? 1.45 : isHeavy ? 1.18 : 0.85, isEB ? 0.82 : isHeavy ? 0.92 : 1.04);
    // Nロック解除・非常位置投入時は2段目の重厚ラッチ音を重ねる
    if (isHeavy) {
      fireDetent(now + 0.026, isEB ? 1.25 : 0.78, isEB ? 0.68 : 0.82);
    }
  }

  /**
   * ブレーキ緩解時の空気排気音（「プシューッ」）
   */
  playBrakeAirRelease(strength = 0.7) {
    if (!this.isInitialized || !this.ctx || this.isMuted || this.isTimeStopped) return;
    const now = this.ctx.currentTime;

    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(2550, now);
    filter.frequency.exponentialRampToValueAtTime(920, now + 0.52);
    filter.Q.value = 1.5;

    const g = this.ctx.createGain();
    const peak = 0.16 * Math.max(0.25, strength);
    g.gain.setValueAtTime(0.004, now);
    g.gain.linearRampToValueAtTime(peak, now + 0.035);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.56);

    src.connect(filter);
    filter.connect(g);
    g.connect(this.masterGain);
    src.start(now, Math.random() * 0.8, 0.62);
  }

  /**
   * JR東日本 E531系 電笛＋空笛タイフォン警笛（ブラスフォルマント＋エアアタック）
   */
  playHorn() {
    if (!this.isInitialized || !this.ctx || this.isMuted) return;
    const now = this.ctx.currentTime;

    // 空気噴射アタックノイズ
    const airSrc = this.ctx.createBufferSource();
    airSrc.buffer = this._noiseBuffer;
    const airBp = this.ctx.createBiquadFilter();
    airBp.type = 'bandpass';
    airBp.frequency.value = 1800;
    airBp.Q.value = 1.6;
    const airG = this.ctx.createGain();
    airG.gain.setValueAtTime(0.002, now);
    airG.gain.linearRampToValueAtTime(0.06, now + 0.025);
    airG.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
    airSrc.connect(airBp);
    airBp.connect(airG);
    airG.connect(this.masterGain);
    airSrc.start(now, 0.2, 0.18);

    // G4 (392Hz) + B4 (493.88Hz) 長三度タイフォン和音（デチューン2重発振で実物の太い共鳴）
    const chord = [392.0, 493.88];
    for (const baseFreq of chord) {
      for (const detune of [-4.5, 4.5]) {
        const osc = this.ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(baseFreq * 0.985, now);
        osc.frequency.exponentialRampToValueAtTime(baseFreq, now + 0.04);
        osc.frequency.setValueAtTime(baseFreq, now + 0.34);
        osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.975, now + 0.54);
        osc.detune.value = detune;

        const formant = this.ctx.createBiquadFilter();
        formant.type = 'bandpass';
        formant.frequency.value = 1120;
        formant.Q.value = 0.85;

        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.001, now);
        g.gain.linearRampToValueAtTime(0.068, now + 0.032);
        g.gain.setValueAtTime(0.064, now + 0.34);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.56);

        osc.connect(formant);
        formant.connect(g);
        g.connect(this.masterGain);
        osc.start(now);
        osc.stop(now + 0.58);
      }
    }
  }

  /**
   * 上り対向列車とのすれ違い風圧音（「ビュワッ！」）
   */
  playPassingTrainWhoosh() {
    if (!this.isInitialized || !this.ctx || this.isMuted || this.isTimeStopped) return;
    const now = this.ctx.currentTime;

    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer;

    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(175, now);
    bp.frequency.linearRampToValueAtTime(560, now + 0.24);
    bp.frequency.exponentialRampToValueAtTime(135, now + 0.95);
    bp.Q.value = 1.05;

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.002, now);
    g.gain.linearRampToValueAtTime(0.24, now + 0.22);
    g.gain.exponentialRampToValueAtTime(0.001, now + 1.02);

    src.connect(bp);
    bp.connect(g);
    g.connect(this.masterGain);
    src.start(now, 0, 1.08);
  }

  /**
   * JR東日本 E531/E231系 リアルドアチャイム（E6-C6 3連ベル倍音）＋ 電気/空気ドア開閉メカ音
   */
  playDoorChime(opening = true) {
    if (!this.isInitialized || !this.ctx || this.isMuted || this.isTimeStopped) return;
    const now = this.ctx.currentTime;

    // 1. 実車準拠 E6 (1318.51Hz) → C6 (1046.50Hz) 柔らかいベル倍音チャイム（閉扉3連・開扉2連）
    const cycles = opening ? 2 : 3;
    const pairStep = 0.52;
    const playBellNote = (freq, t0, dur) => {
      for (const [mult, amp, dec] of [
        [1.0, 0.11, dur],
        [2.0, 0.032, dur * 0.65],
        [3.0, 0.011, dur * 0.4],
      ]) {
        const osc = this.ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq * mult, t0);
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.0008, t0);
        g.gain.linearRampToValueAtTime(amp, t0 + 0.009);
        g.gain.exponentialRampToValueAtTime(0.0008, t0 + dec);
        osc.connect(g);
        g.connect(this.masterGain);
        osc.start(t0);
        osc.stop(t0 + dec + 0.02);
      }
    };

    for (let c = 0; c < cycles; c++) {
      const base = now + c * pairStep;
      playBellNote(1318.51, base, 0.26); // E6「ピン」
      playBellNote(1046.50, base + 0.22, 0.30); // C6「ポン」
    }

    // 2. 同期するドア駆動スライド音（「シュゥゥー」＋ 閉扉ラッチ「ドスン・ガチャン」）
    const slideStart = now + (opening ? 0.14 : 0.42);
    const slideDur = opening ? 0.92 : 1.18;

    const slideSrc = this.ctx.createBufferSource();
    slideSrc.buffer = this._noiseBuffer;
    const slideBp = this.ctx.createBiquadFilter();
    slideBp.type = 'bandpass';
    slideBp.frequency.setValueAtTime(opening ? 1750 : 1250, slideStart);
    slideBp.frequency.exponentialRampToValueAtTime(opening ? 880 : 1620, slideStart + slideDur);
    slideBp.Q.value = 1.9;

    const slideG = this.ctx.createGain();
    slideG.gain.setValueAtTime(0.001, slideStart);
    slideG.gain.linearRampToValueAtTime(0.075, slideStart + 0.08);
    slideG.gain.setValueAtTime(0.062, slideStart + slideDur - 0.12);
    slideG.gain.exponentialRampToValueAtTime(0.001, slideStart + slideDur);

    slideSrc.connect(slideBp);
    slideBp.connect(slideG);
    slideG.connect(this.masterGain);
    slideSrc.start(slideStart, 0.35, slideDur + 0.05);

    // 戸当たりクッション着座音（「ゴトン / ドスン」）
    const thumpT = slideStart + slideDur - 0.04;
    const thumpOsc = this.ctx.createOscillator();
    thumpOsc.type = 'triangle';
    thumpOsc.frequency.setValueAtTime(opening ? 96 : 118, thumpT);
    thumpOsc.frequency.exponentialRampToValueAtTime(42, thumpT + 0.085);
    const thumpG = this.ctx.createGain();
    thumpG.gain.setValueAtTime(opening ? 0.11 : 0.17, thumpT);
    thumpG.gain.exponentialRampToValueAtTime(0.001, thumpT + 0.095);
    thumpOsc.connect(thumpG);
    thumpG.connect(this.masterGain);
    thumpOsc.start(thumpT);
    thumpOsc.stop(thumpT + 0.11);
  }

  /**
   * 駅ホーム天井PAスピーカー残響付き 発車メロディ再生（4駅オリジナルJR東日本風フレーズ）
   */
  stopDepartureMelody() {
    for (const stopFn of this._melodyStoppers) {
      try {
        stopFn();
      } catch {
        // already stopped
      }
    }
    this._melodyStoppers = [];
    this.isMelodyPlaying = false;
  }

  playDepartureMelody(stationId = 'nippori') {
    if (!this.isInitialized || !this.ctx || this.isMuted || this.isTimeStopped) return;
    this.stopDepartureMelody();

    const now = this.ctx.currentTime + 0.03;
    // MIDI番号→周波数変換
    const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

    // JR東日本らしい爽やかで明るいベル・エレピ調の駅別オリジナル発車メロディ
    const melodies = {
      // 日暮里：朝の光が差し込む爽快アルペジオ（Gメジャー）
      nippori: [
        [79, 0.00, 0.24], [83, 0.18, 0.24], [86, 0.36, 0.28], [91, 0.56, 0.45],
        [88, 0.92, 0.24], [86, 1.12, 0.24], [83, 1.32, 0.34], [81, 1.60, 0.34],
        [79, 1.92, 0.24], [81, 2.12, 0.24], [83, 2.32, 0.26], [86, 2.54, 0.38],
        [91, 2.88, 0.72], [86, 2.88, 0.72], [83, 2.88, 0.72],
      ],
      // 三河島：優しく弾むダウンタウン・チャイム（Fメジャー）
      mikawashima: [
        [77, 0.00, 0.24], [81, 0.20, 0.24], [84, 0.40, 0.28], [86, 0.64, 0.42],
        [84, 1.00, 0.24], [81, 1.20, 0.24], [79, 1.40, 0.36],
        [81, 1.78, 0.24], [84, 1.98, 0.24], [89, 2.20, 0.68], [84, 2.20, 0.68], [81, 2.20, 0.68],
      ],
      // 南千住：隅田川の風を感じる伸びやかなフレーズ（Ebメジャー）
      minamisenju: [
        [75, 0.00, 0.28], [79, 0.22, 0.28], [82, 0.44, 0.32], [87, 0.70, 0.48],
        [86, 1.12, 0.26], [82, 1.34, 0.26], [80, 1.56, 0.38],
        [79, 1.92, 0.24], [82, 2.14, 0.26], [87, 2.38, 0.78], [82, 2.38, 0.78], [79, 2.38, 0.78],
      ],
      // 北千住：ターミナルらしい華やかな終着・発車ベル（Cメジャー）
      kitasenju: [
        [76, 0.00, 0.22], [79, 0.18, 0.22], [84, 0.36, 0.26], [88, 0.56, 0.36],
        [86, 0.88, 0.22], [84, 1.06, 0.22], [83, 1.24, 0.26], [79, 1.48, 0.36],
        [81, 1.82, 0.22], [83, 2.00, 0.22], [84, 2.18, 0.24], [88, 2.40, 0.32],
        [91, 2.68, 0.85], [84, 2.68, 0.85], [79, 2.68, 0.85],
      ],
    };

    const seq = melodies[stationId] || melodies.nippori;
    this.isMelodyPlaying = true;
    let maxEnd = 0;

    for (const [midi, offset, dur] of seq) {
      const t0 = now + offset;
      const freq = mtof(midi);
      maxEnd = Math.max(maxEnd, offset + dur);

      // FMベル＋エレクトリックピアノ倍音（JR駅メロ特有のキラキラした音色）
      const carrier = this.ctx.createOscillator();
      carrier.type = 'sine';
      carrier.frequency.setValueAtTime(freq, t0);

      const mod = this.ctx.createOscillator();
      mod.type = 'sine';
      mod.frequency.setValueAtTime(freq * 2.0, t0);
      const modGain = this.ctx.createGain();
      modGain.gain.setValueAtTime(freq * 1.35, t0);
      modGain.gain.exponentialRampToValueAtTime(1.0, t0 + dur * 0.65);

      const overtone = this.ctx.createOscillator();
      overtone.type = 'triangle';
      overtone.frequency.setValueAtTime(freq * 0.5, t0);

      const noteGain = this.ctx.createGain();
      noteGain.gain.setValueAtTime(0.0008, t0);
      noteGain.gain.linearRampToValueAtTime(0.115, t0 + 0.012);
      noteGain.gain.exponentialRampToValueAtTime(0.0008, t0 + dur + 0.28);

      const subGain = this.ctx.createGain();
      subGain.gain.value = 0.26;

      mod.connect(modGain);
      modGain.connect(carrier.frequency);
      carrier.connect(noteGain);
      overtone.connect(subGain);
      subGain.connect(noteGain);
      noteGain.connect(this.paInput);

      carrier.start(t0);
      mod.start(t0);
      overtone.start(t0);
      carrier.stop(t0 + dur + 0.34);
      mod.stop(t0 + dur + 0.34);
      overtone.stop(t0 + dur + 0.34);

      this._melodyStoppers.push(() => {
        noteGain.gain.cancelScheduledValues(this.ctx.currentTime);
        noteGain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.03);
      });
    }

    const doneTimer = setTimeout(() => {
      this.isMelodyPlaying = false;
    }, (maxEnd + 0.45) * 1000);
    this._melodyStoppers.push(() => clearTimeout(doneTimer));
  }

  /**
   * 「ザ・ワールド」時間停止音（重低音ピッチドロップ＋フィルター収束＋減速する時計秒針）＆ 時間再開音
   */
  playTimeStopEffect(stopping = true) {
    if (!this.isInitialized || !this.ctx || this.isMuted) return;
    const now = this.ctx.currentTime;

    if (stopping) {
      // 1. 重厚サブベース時間圧縮ドロップ（「ドゥゥゥゥン…ブゥォォォン…」）
      const subOsc = this.ctx.createOscillator();
      subOsc.type = 'sawtooth';
      subOsc.frequency.setValueAtTime(215, now);
      subOsc.frequency.exponentialRampToValueAtTime(28, now + 0.68);

      const subSine = this.ctx.createOscillator();
      subSine.type = 'sine';
      subSine.frequency.setValueAtTime(140, now);
      subSine.frequency.exponentialRampToValueAtTime(26, now + 0.72);

      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = 6.5;
      lp.frequency.setValueAtTime(2800, now);
      lp.frequency.exponentialRampToValueAtTime(68, now + 0.66);

      const subGain = this.ctx.createGain();
      subGain.gain.setValueAtTime(0.005, now);
      subGain.gain.linearRampToValueAtTime(0.34, now + 0.03);
      subGain.gain.setValueAtTime(0.28, now + 0.38);
      subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.78);

      subOsc.connect(lp);
      subSine.connect(lp);
      lp.connect(subGain);
      subGain.connect(this.uiSfxGain);
      subOsc.start(now);
      subSine.start(now);
      subOsc.stop(now + 0.82);
      subSine.stop(now + 0.82);

      // 2. 真空収束ノイズスイープ
      const nSrc = this.ctx.createBufferSource();
      nSrc.buffer = this._noiseBuffer;
      const nBp = this.ctx.createBiquadFilter();
      nBp.type = 'bandpass';
      nBp.Q.value = 3.2;
      nBp.frequency.setValueAtTime(3400, now);
      nBp.frequency.exponentialRampToValueAtTime(95, now + 0.56);
      const nG = this.ctx.createGain();
      nG.gain.setValueAtTime(0.24, now);
      nG.gain.exponentialRampToValueAtTime(0.001, now + 0.60);
      nSrc.connect(nBp);
      nBp.connect(nG);
      nG.connect(this.uiSfxGain);
      nSrc.start(now, 0.1, 0.64);

      // 3. 減速しながら止まる機械式時計の秒針（「チッ…チッ……トッ…」）
      const tickTimes = [0.10, 0.25, 0.46];
      const tickFreqs = [1950, 1520, 1120];
      tickTimes.forEach((dt, idx) => {
        const t = now + dt;
        const tOsc = this.ctx.createOscillator();
        tOsc.type = 'triangle';
        tOsc.frequency.setValueAtTime(tickFreqs[idx], t);
        tOsc.frequency.exponentialRampToValueAtTime(380, t + 0.025);
        const tG = this.ctx.createGain();
        tG.gain.setValueAtTime(0.14 - idx * 0.02, t);
        tG.gain.exponentialRampToValueAtTime(0.001, t + 0.032);
        tOsc.connect(tG);
        tG.connect(this.uiSfxGain);
        tOsc.start(t);
        tOsc.stop(t + 0.036);
      });
    } else {
      // 時間再開：逆回転ピッチ上昇スイープ＋解放スナップ（「シュォォォン・パッ！」）
      const revOsc = this.ctx.createOscillator();
      revOsc.type = 'sawtooth';
      revOsc.frequency.setValueAtTime(32, now);
      revOsc.frequency.exponentialRampToValueAtTime(245, now + 0.36);

      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = 4.5;
      lp.frequency.setValueAtTime(110, now);
      lp.frequency.exponentialRampToValueAtTime(2800, now + 0.36);

      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.01, now);
      g.gain.exponentialRampToValueAtTime(0.24, now + 0.30);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.42);

      revOsc.connect(lp);
      lp.connect(g);
      g.connect(this.uiSfxGain);
      revOsc.start(now);
      revOsc.stop(now + 0.45);

      const snapOsc = this.ctx.createOscillator();
      snapOsc.type = 'sine';
      snapOsc.frequency.setValueAtTime(1760, now + 0.34);
      snapOsc.frequency.exponentialRampToValueAtTime(880, now + 0.44);
      const snapG = this.ctx.createGain();
      snapG.gain.setValueAtTime(0.11, now + 0.34);
      snapG.gain.exponentialRampToValueAtTime(0.001, now + 0.46);
      snapOsc.connect(snapG);
      snapG.connect(this.uiSfxGain);
      snapOsc.start(now + 0.34);
      snapOsc.stop(now + 0.48);
    }
  }
}
