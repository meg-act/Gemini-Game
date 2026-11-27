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
    this.rainIntensity = 0;
    this._atsChimeTimer = null;
    this.isAtsChimeActive = false;
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
    if (stopped) {
      this.stopDepartureMelody();
      this.setAtsChimeActive(false);
    }
    this._syncMasterGain();
    this.playTimeStopEffect(stopped);
  }

  setRainIntensity(intensity) {
    this.rainIntensity = Math.max(0, Math.min(1, intensity || 0));
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

    // 6. 雨天時の運転室屋根・ガラス雨音 ＆ 濡れたレールの水しぶき転動シャー音
    this.rainSource = this.ctx.createBufferSource();
    this.rainSource.buffer = this._noiseBuffer;
    this.rainSource.loop = true;
    this.rainFilter = this.ctx.createBiquadFilter();
    this.rainFilter.type = 'bandpass';
    this.rainFilter.frequency.value = 1850;
    this.rainFilter.Q.value = 0.75;
    this.rainGain = this.ctx.createGain();
    this.rainGain.gain.value = 0.0;
    this.rainSource.connect(this.rainFilter);
    this.rainFilter.connect(this.rainGain);
    this.rainGain.connect(this.masterGain);
    this.rainSource.start(now, 0.7);
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
      const slip = isBraking ? -1.8 : 2.2;
      const fm = Math.max(4, speedKmh * 1.18 + slip);

      let fc = 920;
      let sideSpread = 2.0 * fm;
      let carrierWeight = 0.55;
      let sideWeight = 0.38;
      let harmWeight = 0.16;
      let busVol = 0.0;

      if (speedKmh < 18) {
        const t = speedKmh / 18;
        fc = 885 + t * 205;
        sideSpread = 2.0 * fm;
        carrierWeight = 0.58;
        sideWeight = 0.32 + t * 0.14;
        harmWeight = 0.18 * (1 - t * 0.35);
        busVol = (0.048 + 0.018 * t) * Math.min(1, absEffort * 1.25);
      } else if (speedKmh < 40) {
        const t = (speedKmh - 18) / 22;
        fc = 1090 + t * 380;
        sideSpread = (2.0 + t * 1.5) * fm;
        carrierWeight = 0.45 * (1 - t * 0.55);
        sideWeight = 0.46 * (1 - t * 0.25);
        harmWeight = 0.10 * (1 - t);
        busVol = 0.058 * (1 - t * 0.42) * Math.min(1, absEffort * 1.2);
      } else if (speedKmh < 58) {
        const t = (speedKmh - 40) / 18;
        fc = fm * (9.0 - t * 3.0);
        sideSpread = fm * 2.0;
        carrierWeight = 0.36;
        sideWeight = 0.32;
        harmWeight = 0.06;
        busVol = 0.034 * (1 - t * 0.55) * Math.min(1, absEffort * 1.15);
      } else {
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

      const motorTone = Math.max(36, fm * 3.2);
      this.motorBaseOsc.frequency.setTargetAtTime(motorTone, now, 0.04);
      this.motorBaseFilter.frequency.setTargetAtTime(260 + speedKmh * 8.5, now, 0.06);
      this.motorBaseGain.gain.setTargetAtTime(
        0.048 * Math.min(1, absEffort * 1.15) * Math.min(1, speedKmh / 14),
        now,
        0.05
      );

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

    // 5. 雨天時の雨音＆濡れレール飛沫ノイズ（速度が上がるほど高域シャー音が増す）
    if (this.rainGain && this.rainFilter) {
      const targetRainVol = this.rainIntensity * (0.042 + speedNorm * 0.058);
      this.rainGain.gain.setTargetAtTime(targetRainVol, now, 0.15);
      this.rainFilter.frequency.setTargetAtTime(1650 + speedKmh * 14, now, 0.15);
    }
  }

  /**
   * JR東日本 ATS-P「キンコン・キンコン」2音電磁チャイム（単発または連続鳴動）
   */
  playAtsChimePair() {
    if (!this.isInitialized || !this.ctx || this.isMuted || this.isTimeStopped) return;
    const now = this.ctx.currentTime;
    const strikeBell = (baseFreq, t0, dur) => {
      for (const [ratio, amp, dec] of [
        [1.0, 0.12, dur],
        [2.756, 0.045, dur * 0.48],
        [4.14, 0.018, dur * 0.28],
      ]) {
        const osc = this.ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(baseFreq * ratio, t0);
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.0008, t0);
        g.gain.linearRampToValueAtTime(amp, t0 + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0006, t0 + dec);
        osc.connect(g);
        g.connect(this.masterGain);
        osc.start(t0);
        osc.stop(t0 + dec + 0.02);
      }
    };
    strikeBell(812, now, 0.22);        // 「キン」(G#5)
    strikeBell(659.25, now + 0.19, 0.28); // 「コン」(E5)
  }

  setAtsChimeActive(active) {
    const next = Boolean(active);
    if (this.isAtsChimeActive === next) return;
    this.isAtsChimeActive = next;
    if (this._atsChimeTimer) {
      clearInterval(this._atsChimeTimer);
      this._atsChimeTimer = null;
    }
    if (next) {
      this.playAtsChimePair();
      this._atsChimeTimer = setInterval(() => {
        if (!this.isAtsChimeActive) return;
        this.playAtsChimePair();
      }, 420);
    }
  }

  /**
   * 車掌→運転士 出発合図ブザー（「ツー・ツー」）
   */
  playConductorBuzzer() {
    if (!this.isInitialized || !this.ctx || this.isMuted || this.isTimeStopped) return;
    const now = this.ctx.currentTime;
    for (const [off, dur] of [
      [0.0, 0.18],
      [0.30, 0.25],
    ]) {
      const t0 = now + off;
      const osc = this.ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(935, t0);
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1150;
      bp.Q.value = 2.2;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.001, t0);
      g.gain.linearRampToValueAtTime(0.068, t0 + 0.012);
      g.gain.setValueAtTime(0.062, t0 + dur - 0.015);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      osc.connect(bp);
      bp.connect(g);
      g.connect(this.masterGain);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    }
  }

  /**
   * 車内自動放送 4音チャイム（E531/E231系 案内チャイム）
   */
  playOnboardChime() {
    if (!this.isInitialized || !this.ctx || this.isMuted || this.isTimeStopped) return;
    const now = this.ctx.currentTime;
    const notes = [783.99, 1046.50, 1318.51, 1567.98]; // G5 - C6 - E6 - G6
    notes.forEach((freq, i) => {
      const t0 = now + i * 0.14;
      const dur = i === 3 ? 0.45 : 0.24;
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t0);
      const over = this.ctx.createOscillator();
      over.type = 'triangle';
      over.frequency.setValueAtTime(freq * 2, t0);
      const og = this.ctx.createGain();
      og.gain.value = 0.18;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0008, t0);
      g.gain.linearRampToValueAtTime(0.072, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
      osc.connect(g);
      over.connect(og);
      og.connect(g);
      g.connect(this.masterGain);
      osc.start(t0);
      over.start(t0);
      osc.stop(t0 + dur + 0.03);
      over.stop(t0 + dur + 0.03);
    });
  }

  /**
   * ワイパーブレード反転・摺動音（控えめなゴム水切り音「シュッ…」）
   */
  playWiperBlade(dir = 1) {
    if (!this.isInitialized || !this.ctx || this.isMuted || this.isTimeStopped) return;
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(dir > 0 ? 780 : 690, now);
    bp.frequency.linearRampToValueAtTime(dir > 0 ? 1150 : 980, now + 0.22);
    bp.Q.value = 2.4;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0008, now);
    g.gain.linearRampToValueAtTime(0.026, now + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0008, now + 0.28);
    src.connect(bp);
    bp.connect(g);
    g.connect(this.masterGain);
    src.start(now, Math.random() * 0.8, 0.32);
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
   * 駅IDに対応する実在発車メロディ曲名を返す（下り：日暮里→三河島→南千住→北千住）
   */
  getMelodyTitle(stationId = 'nippori') {
    switch (stationId) {
      case 'nippori':
        return '線路の彼方';
      case 'mikawashima':
      case 'minamisenju':
        return 'JRE-IKST-013-02';
      case 'kitasenju':
        return '陽だまり V2';
      default:
        return '線路の彼方';
    }
  }

  /**
   * 駅ホーム天井PAスピーカー残響付き 実在駅発車メロディ再生
   *   - 日暮里 (4番線)   : 『線路の彼方』（櫻井隆仁 / テイチク FMエレピ＋クリスタルベル）
   *   - 三河島・南千住   : 『JRE-IKST-013-02』（F#メジャー BPM132 新汎用ビブラフォンベル＋伴奏）
   *   - 北千住 (1番線)   : 『陽だまり V2』（井出正彦 / ユニペックス オルゴールチェレスタ＋V2温もりパッド）
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

    const now = this.ctx.currentTime + 0.035;
    const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
    let maxEnd = 0;

    // 音色別のポリフォニック発音ヘルパー（すべて駅ホームPAスピーカーEQ＋残響へ送出）
    const scheduleVoice = (midi, offset, dur, patch = 'ep', vel = 1.0) => {
      const t0 = now + offset;
      const freq = mtof(midi);
      maxEnd = Math.max(maxEnd, offset + dur);

      const noteGain = this.ctx.createGain();
      noteGain.connect(this.paInput);

      const oscs = [];
      if (patch === 'sakurai_lead' || patch === 'ikst_lead') {
        // DX7風 2オペレータFMクリスタルベル＋エレピ倍音
        const isIkst = patch === 'ikst_lead';
        const carrier = this.ctx.createOscillator();
        carrier.type = 'sine';
        carrier.frequency.setValueAtTime(freq, t0);

        const mod = this.ctx.createOscillator();
        mod.type = 'sine';
        mod.frequency.setValueAtTime(freq * (isIkst ? 3.0 : 2.0), t0);

        const modGain = this.ctx.createGain();
        modGain.gain.setValueAtTime(freq * (isIkst ? 1.55 : 1.35), t0);
        modGain.gain.exponentialRampToValueAtTime(freq * 0.08, t0 + Math.max(0.08, dur * 0.68));

        const bodyOsc = this.ctx.createOscillator();
        bodyOsc.type = 'triangle';
        bodyOsc.frequency.setValueAtTime(freq, t0);
        const bodyG = this.ctx.createGain();
        bodyG.gain.value = isIkst ? 0.30 : 0.24;

        mod.connect(modGain);
        modGain.connect(carrier.frequency);
        carrier.connect(noteGain);
        bodyOsc.connect(bodyG);
        bodyG.connect(noteGain);

        const peak = 0.115 * vel;
        noteGain.gain.setValueAtTime(0.0006, t0);
        noteGain.gain.linearRampToValueAtTime(peak, t0 + 0.010);
        noteGain.gain.exponentialRampToValueAtTime(0.0006, t0 + dur + 0.26);

        oscs.push(carrier, mod, bodyOsc);
      } else if (patch === 'celesta_v2') {
        // ユニペックス『陽だまり V2』特有の澄んだオルゴール・チェレスタ音色（基音＋4倍音チャイム）
        const c1 = this.ctx.createOscillator();
        c1.type = 'sine';
        c1.frequency.setValueAtTime(freq, t0);

        const c2 = this.ctx.createOscillator();
        c2.type = 'sine';
        c2.frequency.setValueAtTime(freq * 4.0, t0);
        const c2G = this.ctx.createGain();
        c2G.gain.setValueAtTime(0.22, t0);
        c2G.gain.exponentialRampToValueAtTime(0.001, t0 + 0.14);

        const c3 = this.ctx.createOscillator();
        c3.type = 'triangle';
        c3.frequency.setValueAtTime(freq * 2.0, t0);
        const c3G = this.ctx.createGain();
        c3G.gain.setValueAtTime(0.14, t0);
        c3G.gain.exponentialRampToValueAtTime(0.002, t0 + dur * 0.55);

        c1.connect(noteGain);
        c2.connect(c2G);
        c2G.connect(noteGain);
        c3.connect(c3G);
        c3G.connect(noteGain);

        const peak = 0.118 * vel;
        noteGain.gain.setValueAtTime(0.0006, t0);
        noteGain.gain.linearRampToValueAtTime(peak, t0 + 0.008);
        noteGain.gain.exponentialRampToValueAtTime(0.0006, t0 + dur + 0.38);

        oscs.push(c1, c2, c3);
      } else if (patch === 'warm_pad') {
        // V2特有の包み込むコーラス・ストリングスパッド
        const lp = this.ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 1350;
        lp.connect(noteGain);

        for (const det of [-6, 6]) {
          const o = this.ctx.createOscillator();
          o.type = 'sawtooth';
          o.frequency.setValueAtTime(freq, t0);
          o.detune.value = det;
          o.connect(lp);
          oscs.push(o);
        }
        const peak = 0.026 * vel;
        noteGain.gain.setValueAtTime(0.0005, t0);
        noteGain.gain.linearRampToValueAtTime(peak, t0 + Math.min(0.18, dur * 0.3));
        noteGain.gain.setValueAtTime(peak * 0.88, t0 + Math.max(0.19, dur - 0.12));
        noteGain.gain.exponentialRampToValueAtTime(0.0005, t0 + dur + 0.35);
      } else if (patch === 'ep_chord') {
        // 伴奏用ソフトFMエレクトリックピアノ
        const c = this.ctx.createOscillator();
        c.type = 'sine';
        c.frequency.setValueAtTime(freq, t0);
        const m = this.ctx.createOscillator();
        m.type = 'sine';
        m.frequency.setValueAtTime(freq * 2.0, t0);
        const mg = this.ctx.createGain();
        mg.gain.setValueAtTime(freq * 0.55, t0);
        mg.gain.exponentialRampToValueAtTime(1.0, t0 + dur * 0.45);
        m.connect(mg);
        mg.connect(c.frequency);
        c.connect(noteGain);

        const peak = 0.044 * vel;
        noteGain.gain.setValueAtTime(0.0005, t0);
        noteGain.gain.linearRampToValueAtTime(peak, t0 + 0.012);
        noteGain.gain.exponentialRampToValueAtTime(0.0005, t0 + dur + 0.20);
        oscs.push(c, m);
      } else if (patch === 'bass') {
        // 駅メロの土台を支えるクリーン・エレクトリックベース
        const b = this.ctx.createOscillator();
        b.type = 'triangle';
        b.frequency.setValueAtTime(freq, t0);
        const sub = this.ctx.createOscillator();
        sub.type = 'sine';
        sub.frequency.setValueAtTime(freq, t0);
        b.connect(noteGain);
        sub.connect(noteGain);

        const peak = 0.058 * vel;
        noteGain.gain.setValueAtTime(0.0008, t0);
        noteGain.gain.linearRampToValueAtTime(peak, t0 + 0.014);
        noteGain.gain.exponentialRampToValueAtTime(0.0008, t0 + dur + 0.12);
        oscs.push(b, sub);
      }

      const stopAt = t0 + dur + 0.44;
      for (const o of oscs) {
        o.start(t0);
        o.stop(stopAt);
      }
      this._melodyStoppers.push(() => {
        noteGain.gain.cancelScheduledValues(this.ctx.currentTime);
        noteGain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.025);
      });
    };

    const scheduleChord = (midis, offset, dur, patch = 'ep_chord', vel = 0.85) => {
      for (const m of midis) {
        scheduleVoice(m, offset, dur, patch, vel);
      }
    };

    if (stationId === 'mikawashima' || stationId === 'minamisenju') {
      // =====================================================================
      // 三河島 (2番線)・南千住 (1番線)：『JRE-IKST-013-02』（首都圏12番・常磐線下り新汎用）
      // 実曲データ：Key = F# Major, BPM = 132 (8分音符 e = 0.2273s)
      // コード進行：| F# (3拍) F#dim (1拍) | F# | G#m/B (2拍) C#7(13) (2拍) | D (2拍) E (2拍) | F# |
      // 通称「アマリリスもどき」の弾む高音グロッケン・ビブラフォン旋律 (-02 下り音色)
      // =====================================================================
      const e = 60 / 132 / 2; // 0.22727s

      // リード旋律（高音域 F#5=78 〜 F#6=90 で伴奏と分離しクリアに響かせる！）
      const lead = [
        // Bar 1: F# (ド=F#5:78, レ=G#5:80, ミ=A#5:82, ファ=B5:83, ソ=C#6:85, ラ=D#6:87) -> F#dim (A5:81, C6:84)
        [85, 0.0 * e, 1.4 * e], // C#6 (ソ・)
        [82, 1.5 * e, 0.5 * e], // A#5 (ミ)
        [83, 2.0 * e, 1.0 * e], // B5  (ファ)
        [85, 3.0 * e, 1.0 * e], // C#6 (ソ)
        [82, 4.0 * e, 1.0 * e], // A#5 (ミ)
        [85, 5.0 * e, 1.0 * e], // C#6 (ソ)
        [87, 6.0 * e, 1.0 * e], // D#6 (ラ — F#dim!)
        [84, 7.0 * e, 1.0 * e], // C6  (♮ド — F#dim 特有の半音経過音！)
        // Bar 2: F#
        [85, 8.0 * e, 1.0 * e],  // C#6 (ソ)
        [82, 9.0 * e, 1.0 * e],  // A#5 (ミ)
        [78, 10.0 * e, 1.5 * e], // F#5 (ド・)
        [80, 11.5 * e, 0.5 * e], // G#5 (レ)
        [82, 12.0 * e, 2.8 * e], // A#5 (ミーーー)
        [80, 15.0 * e, 1.0 * e], // G#5 (レ)
        // Bar 3: G#m/B -> C#7(13)（アマリリス第2句そのままの「ファミファレ・ミレシレ」！）
        [83, 16.0 * e, 1.0 * e], // B5  (ファ)
        [82, 17.0 * e, 1.0 * e], // A#5 (ミ)
        [83, 18.0 * e, 1.0 * e], // B5  (ファ)
        [80, 19.0 * e, 1.0 * e], // G#5 (レ)
        [82, 20.0 * e, 1.0 * e], // A#5 (ミ — C#7 の 13th テンション！)
        [80, 21.0 * e, 1.0 * e], // G#5 (レ)
        [77, 22.0 * e, 1.0 * e], // E#5 (シ)
        [80, 23.0 * e, 1.0 * e], // G#5 (レ)
        // Bar 4: D -> E（♭VI → ♭VII への鮮やかな転調上昇！）
        [81, 24.0 * e, 1.5 * e], // A5  (♮ラ・ — Dメジャー!)
        [78, 25.5 * e, 0.5 * e], // F#5
        [81, 26.0 * e, 1.0 * e], // A5
        [86, 27.0 * e, 1.0 * e], // D6
        [83, 28.0 * e, 1.5 * e], // B5  (Eメジャー!)
        [80, 29.5 * e, 0.5 * e], // G#5
        [83, 30.0 * e, 1.0 * e], // B5
        [88, 31.0 * e, 1.0 * e], // E6
        // Bar 5: F# 解決（-02 の煌びやかな高音ベル終止）
        [90, 32.0 * e, 5.2 * e], // F#6
        [85, 32.0 * e, 5.0 * e], // C#6
      ];
      for (const [m, off, d] of lead) {
        scheduleVoice(m, off, d, 'ikst_lead', 1.08);
      }

      // 伴奏コード＆ベース（中低域 42〜70 に配置し、主旋律を邪魔せずリズムを刻む）
      // Bar 1: F# (6e) -> F#dim (2e)
      scheduleVoice(54, 0 * e, 5.8 * e, 'bass', 0.88);
      scheduleChord([61, 66, 70], 0 * e, 2.8 * e, 'ep_chord', 0.68);
      scheduleChord([61, 66, 70], 3 * e, 2.8 * e, 'ep_chord', 0.62);
      scheduleVoice(54, 6 * e, 1.9 * e, 'bass', 0.88);
      scheduleChord([60, 63, 69], 6 * e, 1.9 * e, 'ep_chord', 0.74); // F#dim
      // Bar 2: F#
      scheduleVoice(54, 8 * e, 3.8 * e, 'bass', 0.88);
      scheduleVoice(49, 12 * e, 3.8 * e, 'bass', 0.84);
      scheduleChord([61, 66, 70], 8 * e, 3.8 * e, 'ep_chord', 0.66);
      scheduleChord([61, 66, 70], 12 * e, 3.8 * e, 'ep_chord', 0.64);
      // Bar 3: G#m/B -> C#7(13)
      scheduleVoice(47, 16 * e, 3.8 * e, 'bass', 0.88); // B2
      scheduleChord([59, 63, 68], 16 * e, 3.8 * e, 'ep_chord', 0.68);
      scheduleVoice(49, 20 * e, 3.8 * e, 'bass', 0.88); // C#3
      scheduleChord([59, 65, 70], 20 * e, 3.8 * e, 'ep_chord', 0.72); // C#7(13)
      // Bar 4: D -> E
      scheduleVoice(50, 24 * e, 3.8 * e, 'bass', 0.92); // D3
      scheduleChord([62, 66, 69], 24 * e, 3.8 * e, 'ep_chord', 0.76);
      scheduleVoice(52, 28 * e, 3.8 * e, 'bass', 0.92); // E3
      scheduleChord([64, 68, 71], 28 * e, 3.8 * e, 'ep_chord', 0.78);
      // Bar 5: F#
      scheduleVoice(42, 32 * e, 5.5 * e, 'bass', 0.94);
      scheduleChord([58, 61, 66, 70], 32 * e, 5.5 * e, 'ep_chord', 0.75);
    } else if (stationId === 'kitasenju') {
      // =====================================================================
      // 北千住（1番線 下り）：『陽だまり V2』（井出正彦 / ユニペックス）
      // 実曲音符（ニ短調 / へ長調・♭1個）：
      //   ソラ｜シ♭ー レ ラ ソ ファ ソー｜ラーーー ソラ｜シ♭ー レ ラ ソ ファ ソー｜ファー シ♭ー ド↓〜
      // V2特有の温かいコーラス・ストリングスパッド＋透明なオルゴール・チェレスタ！
      // =====================================================================
      const e = 60 / 112 / 2; // 0.2679s

      const lead = [
        // アウフタクト「ソ・ラ」
        [79, 0.0 * e, 1.0 * e], // G5 (ソ)
        [81, 1.0 * e, 1.0 * e], // A5 (ラ)
        // Bar 1「シ♭ー レ ラ ソ ファ ソー」
        [82, 2.0 * e, 2.0 * e], // Bb5 (シ♭ー)
        [86, 4.0 * e, 1.0 * e], // D6  (レ)
        [81, 5.0 * e, 1.0 * e], // A5  (ラ)
        [79, 6.0 * e, 1.0 * e], // G5  (ソ)
        [77, 7.0 * e, 1.0 * e], // F5  (ファ)
        [79, 8.0 * e, 2.0 * e], // G5  (ソー)
        // Bar 2「ラーーー ソ・ラ」
        [81, 10.0 * e, 6.0 * e], // A5 (ラーーー)
        [79, 16.0 * e, 1.0 * e], // G5 (ソ)
        [81, 17.0 * e, 1.0 * e], // A5 (ラ)
        // Bar 3「シ♭ー レ ラ ソ ファ ソー」
        [82, 18.0 * e, 2.0 * e], // Bb5 (シ♭ー)
        [86, 20.0 * e, 1.0 * e], // D6  (レ)
        [81, 21.0 * e, 1.0 * e], // A5  (ラ)
        [79, 22.0 * e, 1.0 * e], // G5  (ソ)
        [77, 23.0 * e, 1.0 * e], // F5  (ファ)
        [79, 24.0 * e, 2.0 * e], // G5  (ソー)
        // Bar 4「ファー シ♭↓ー ド↓〜」（実曲通りの切なく優しい半終止ループエンド！）
        [77, 26.0 * e, 4.0 * e], // F5  (ファー)
        [70, 30.0 * e, 2.0 * e], // Bb4 (シ♭↓ー)
        [72, 32.0 * e, 5.2 * e], // C5  (ド↓〜)
      ];
      for (const [m, off, d] of lead) {
        scheduleVoice(m, off, d, 'celesta_v2', 1.06);
      }

      // V2 コーラス・ウォームパッド＆アルペジオ伴奏
      // Bar 1: Gm7 -> C7
      scheduleVoice(55, 2 * e, 4.0 * e, 'bass', 0.78);
      scheduleChord([62, 65, 70], 2 * e, 4.0 * e, 'warm_pad', 0.90);
      scheduleVoice(48, 6 * e, 4.0 * e, 'bass', 0.78);
      scheduleChord([60, 64, 67], 6 * e, 4.0 * e, 'warm_pad', 0.90);
      // Bar 2: FM7 -> Dm7
      scheduleVoice(53, 10 * e, 4.0 * e, 'bass', 0.80);
      scheduleChord([60, 65, 69], 10 * e, 4.0 * e, 'warm_pad', 0.92);
      scheduleVoice(65, 11 * e, 1.5 * e, 'ep_chord', 0.55);
      scheduleVoice(69, 12 * e, 1.5 * e, 'ep_chord', 0.55);
      scheduleVoice(72, 13 * e, 2.0 * e, 'ep_chord', 0.55);
      scheduleVoice(50, 14 * e, 4.0 * e, 'bass', 0.78);
      scheduleChord([62, 65, 69], 14 * e, 4.0 * e, 'warm_pad', 0.88);
      // Bar 3: Gm7 -> C7
      scheduleVoice(55, 18 * e, 4.0 * e, 'bass', 0.80);
      scheduleChord([62, 65, 70], 18 * e, 4.0 * e, 'warm_pad', 0.92);
      scheduleVoice(48, 22 * e, 4.0 * e, 'bass', 0.82);
      scheduleChord([60, 64, 67], 22 * e, 4.0 * e, 'warm_pad', 0.92);
      // Bar 4: Dm7 / BbM7 -> C7sus4 -> C（『ファー シ♭ー ド』を支える実曲ハーモニー）
      scheduleVoice(50, 26 * e, 4.0 * e, 'bass', 0.82);
      scheduleChord([62, 65, 69], 26 * e, 4.0 * e, 'warm_pad', 0.92);
      scheduleVoice(46, 30 * e, 2.0 * e, 'bass', 0.82);
      scheduleChord([58, 62, 65], 30 * e, 2.0 * e, 'warm_pad', 0.92);
      scheduleVoice(48, 32 * e, 5.2 * e, 'bass', 0.86);
      scheduleChord([60, 64, 67], 32 * e, 5.2 * e, 'warm_pad', 0.96);
    } else {
      // =====================================================================
      // 日暮里（4番線 常磐線下り）：『線路の彼方』（櫻井隆仁 / テイチク）
      // テイチク曲最大の特徴である「1拍目裏から食い込んで始まるシンコペーション（始まりをずらした構成）」と
      // 切ない王道進行 FM7 → G7 → Em7 → Am7 → Dm7 → G7 → Cadd9 ＋ 鈴/タンバリン系きらめき音！
      // =====================================================================
      const e = 60 / 128 / 2; // 0.2344s

      // テイチク音源特有の微かな高域シェイカー/鈴アクセント（2・4拍目）
      const scheduleShimmer = (offset, accent = 1.0) => {
        const t0 = now + offset;
        const src = this.ctx.createBufferSource();
        src.buffer = this._noiseBuffer;
        const hp = this.ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 5400;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.0005, t0);
        g.gain.linearRampToValueAtTime(0.015 * accent, t0 + 0.005);
        g.gain.exponentialRampToValueAtTime(0.0004, t0 + 0.065);
        src.connect(hp);
        hp.connect(g);
        g.connect(this.paInput);
        src.start(t0, Math.random() * 0.5, 0.08);
      };

      // リード旋律（1拍目表を休符にし、1.0*e 裏拍から切なく滑り込むシンコペーション！）
      const lead = [
        // Bar 1: FM7 (4e) -> G7 (4e)
        [81, 1.0 * e, 1.0 * e], // A5 (裏拍から入る!)
        [84, 2.0 * e, 1.0 * e], // C6
        [88, 3.0 * e, 2.0 * e], // E6 (小節中盤へタイでシンコペート!)
        [86, 5.0 * e, 1.0 * e], // D6
        [84, 6.0 * e, 1.0 * e], // C6
        [83, 7.0 * e, 2.0 * e], // B5 (Bar 2 頭へタイ!)
        // Bar 2: Em7 (4e) -> Am7 (4e)
        [79, 9.0 * e, 1.0 * e],  // G5
        [83, 10.0 * e, 1.0 * e], // B5
        [86, 11.0 * e, 2.0 * e], // D6 (シンコペート!)
        [84, 13.0 * e, 1.0 * e], // C6
        [83, 14.0 * e, 1.0 * e], // B5
        [81, 15.0 * e, 2.0 * e], // A5 (Bar 3 頭へタイ!)
        // Bar 3: Dm7 (4e) -> G7 (4e)
        [77, 17.0 * e, 1.0 * e], // F5
        [81, 18.0 * e, 1.0 * e], // A5
        [84, 19.0 * e, 2.0 * e], // C6
        [83, 21.0 * e, 1.0 * e], // B5
        [84, 22.0 * e, 1.0 * e], // C6
        [86, 23.0 * e, 2.5 * e], // D6 (高揚して伸ばす!)
        // Bar 4: Em7 (2e) -> A7sus4/A7 (2e) -> Dm7 (2e) -> G7 (2e)
        [88, 26.0 * e, 1.5 * e], // E6
        [86, 27.5 * e, 0.5 * e], // D6
        [85, 28.0 * e, 1.5 * e], // C#6 (切ないA7の色合い!)
        [86, 29.5 * e, 0.5 * e], // D6
        [88, 30.0 * e, 1.0 * e], // E6
        [86, 31.0 * e, 1.0 * e], // D6
        // Bar 5: Cadd9 終止
        [84, 32.0 * e, 5.2 * e], // C6
      ];
      for (const [m, off, d] of lead) {
        scheduleVoice(m, off, d, 'sakurai_lead', 1.08);
      }

      // 1拍目 (0.0*e) から始まる伴奏コード＆ベース（だから主旋律の「ずらし入り」が際立つ！）
      const accomp = [
        { bass: 41, t: 0 * e, notes: [57, 60, 64, 60] },  // FM7
        { bass: 43, t: 4 * e, notes: [55, 59, 62, 65] },  // G7
        { bass: 40, t: 8 * e, notes: [55, 59, 62, 59] },  // Em7
        { bass: 45, t: 12 * e, notes: [57, 60, 64, 60] }, // Am7
        { bass: 38, t: 16 * e, notes: [53, 57, 60, 62] }, // Dm7
        { bass: 43, t: 20 * e, notes: [55, 59, 62, 65] }, // G7
        { bass: 40, t: 24 * e, notes: [55, 59, 64, 59] }, // Em7 / A7
        { bass: 43, t: 28 * e, notes: [53, 57, 62, 59] }, // Dm7 -> G7
      ];
      for (const bar of accomp) {
        scheduleVoice(bar.bass, bar.t, 3.8 * e, 'bass', 0.88);
        bar.notes.forEach((n, idx) => {
          scheduleVoice(n, bar.t + idx * e, 1.35 * e, 'ep_chord', 0.66);
        });
        scheduleShimmer(bar.t + 2 * e, 1.0);
        scheduleShimmer(bar.t + 3 * e, 0.55);
      }
      // 最終 Cadd9 解決＋澄んだベルアルペジオ余韻
      scheduleVoice(48, 32 * e, 5.5 * e, 'bass', 0.94);
      scheduleChord([55, 60, 62, 64, 67], 32 * e, 5.5 * e, 'ep_chord', 0.74);
      scheduleVoice(86, 32.7 * e, 3.8 * e, 'sakurai_lead', 0.50); // D6
      scheduleVoice(88, 33.4 * e, 3.5 * e, 'sakurai_lead', 0.50); // E6
      scheduleVoice(91, 34.1 * e, 3.2 * e, 'sakurai_lead', 0.56); // G6
    }

    this.isMelodyPlaying = true;
    const doneTimer = setTimeout(() => {
      this.isMelodyPlaying = false;
    }, (maxEnd + 0.5) * 1000);
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
