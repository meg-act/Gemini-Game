/**
 * JR東日本 常磐線（快速・特別快速）
 * 日英一体型 車内自動放送 ＆ 駅ホーム ATOS 戸閉放送 システム
 *   - 実録サンプリング音源（src/audio/samples/ またはブラウザ読込）と連携再生
 *   - 運転士指差喚呼（自動発声・字幕）および車内放送前4音チャイム・ブラウザ合成TTSは廃止
 */
export class AnnouncementAndCalloutSystem {
  constructor(soundEngine, captionContainerEl) {
    this.sound = soundEngine;
    this.containerEl = captionContainerEl;
    this.badgeEl = captionContainerEl ? captionContainerEl.querySelector('#comms-badge') : null;
    this.jpEl = captionContainerEl ? captionContainerEl.querySelector('#comms-text-jp') : null;
    this.enEl = captionContainerEl ? captionContainerEl.querySelector('#comms-text-en') : null;

    this.firedTriggers = new Set();
    this._hideTimer = null;
    this._delayedTimers = [];
    this._lastAtosTimeMs = 0;
    this._lastAtosStationId = null;
  }

  reset(startDistance = 0) {
    this.cancelAll();
    this.firedTriggers.clear();
    this._lastAtosTimeMs = 0;
    this._lastAtosStationId = null;

    // 途中区間へジャンプした際は、それより手前の車内自動放送を発火済みとしてマーク
    const checkpoints = [
      ['pa_nippori', 115],
      ['pa_mikawashima', 1315],
      ['pa_minamisenju', 3515],
      ['pa_kitasenju_arr', 4645],
    ];
    for (const [id, dist] of checkpoints) {
      if (startDistance > dist + 15) {
        this.firedTriggers.add(id);
      }
    }
  }

  cancelAll() {
    if (this._hideTimer) {
      clearTimeout(this._hideTimer);
      this._hideTimer = null;
    }
    for (const t of this._delayedTimers) clearTimeout(t);
    this._delayedTimers = [];

    if (this.sound) {
      this.sound.stopVoiceSamples();
    }
    if (this.containerEl) {
      this.containerEl.classList.add('hidden');
    }
  }

  _schedule(fn, delayMs) {
    const id = setTimeout(fn, delayMs);
    this._delayedTimers.push(id);
    return id;
  }

  _showCaption({ category = 'pa', badge = '車内自動放送', jp = '', en = '', durationMs = 6000 }) {
    if (!this.containerEl) return;
    if (this.badgeEl) {
      this.badgeEl.textContent = badge;
      this.badgeEl.className = `comms-badge kind-${category}`;
    }
    if (this.jpEl) this.jpEl.textContent = jp;
    if (this.enEl) {
      this.enEl.textContent = en || '';
      this.enEl.classList.toggle('hidden', !en);
    }
    this.containerEl.classList.remove('hidden');

    if (this._hideTimer) clearTimeout(this._hideTimer);
    this._hideTimer = setTimeout(() => {
      this.containerEl.classList.add('hidden');
    }, durationMs);
  }

  /**
   * 各駅の実車 ATOS（宇都宮改良型）戸閉放送文面を返す
   *   - 日暮里 (4番線) : 「4番線、ドアが閉まります。ご注意ください。」 + 英語付帯
   *   - 三河島 (2番線) : ※実車仕様で番線名を言わない「ドアが閉まります。ご注意ください。」 + 英語付帯
   *   - 南千住 (1番線) : 「1番線、ドアが閉まります。ご注意ください。」 + 英語付帯
   *   - 北千住 (1番線) : ※実車仕様で英語戸閉放送なし「1番線、ドアが閉まります。ご注意ください。」
   */
  getStationAtosDoorText(station) {
    if (!station) return { badge: 'ATOS', jp: 'ドアが閉まります。ご注意ください。', en: '' };
    switch (station.id) {
      case 'nippori':
        return {
          badge: '日暮里駅 4番線 · ATOS',
          jp: '4番線、ドアが閉まります。ご注意ください。',
          en: 'Please stand clear of the closing doors.',
        };
      case 'mikawashima':
        return {
          badge: '三河島駅 2番線 · ATOS',
          jp: 'ドアが閉まります。ご注意ください。',
          en: 'Please stand clear of the closing doors.',
        };
      case 'minamisenju':
        return {
          badge: '南千住駅 1番線 · ATOS',
          jp: '1番線、ドアが閉まります。ご注意ください。',
          en: 'Please stand clear of the closing doors.',
        };
      case 'kitasenju':
        return {
          badge: '北千住駅 1番線 · ATOS',
          jp: '1番線、ドアが閉まります。ご注意ください。',
          en: '',
        };
      default:
        return {
          badge: `${station.nameKanji}駅 · ATOS`,
          jp: 'ドアが閉まります。ご注意ください。',
          en: '',
        };
    }
  }

  /**
   * 発車ベルスイッチ OFF 時（メロディ停止直後）の駅ホーム ATOS 戸閉放送
   */
  onMelodyOff(station) {
    if (!station) return;
    const info = this.getStationAtosDoorText(station);
    const played = this.sound ? this.sound.playPlatformAtos(station.id) : { played: false };
    const durMs = played.played && played.duration ? Math.max(3800, played.duration * 1000 + 400) : 4500;

    this._lastAtosTimeMs = performance.now();
    this._lastAtosStationId = station.id;
    this._showCaption({
      category: 'atos',
      badge: info.badge,
      jp: info.jp,
      en: info.en,
      durationMs: durMs,
    });
  }

  /**
   * ドア閉操作時：直前に発車スイッチOFFで戸閉放送が流れていなければATOS戸閉放送を鳴らし、
   * 戸閉完了後に車掌出発合図ブザー（約420Hz 大音量「ツー・ツー」）を鳴動させる
   */
  onDoorsClosing(station) {
    if (!station) return;
    const nowMs = performance.now();
    const recentlyPlayedAtos =
      this._lastAtosStationId === station.id && nowMs - this._lastAtosTimeMs < 12000;

    if (!recentlyPlayedAtos) {
      this.onMelodyOff(station);
    }

    this._schedule(() => {
      if (this.sound && !this.sound.isTimeStopped) {
        this.sound.playConductorBuzzer();
      }
    }, 1750);
  }

  /**
   * ATS-P パターン非常／常用最大ブレーキ動作時の警報表示（指差喚呼は出さない）
   */
  onAtsEvent(evt) {
    if (!evt) return;
    if (evt.type === 'brake_apply') {
      this._showCaption({
        category: 'ats',
        badge: 'ATS-P 動作',
        jp: 'ATS-P パターン常用最大ブレーキ動作中',
        en: 'ATS-P Automatic Pattern Brake Active',
        durationMs: 4200,
      });
    }
  }

  /**
   * EB装置（緊急列車防護装置）60秒無操作警報・非常制動表示
   */
  onEbEvent(evt) {
    if (!evt) return;
    if (evt.type === 'warning_start') {
      this._showCaption({
        category: 'ats',
        badge: 'EB装置 警報',
        jp: 'EBブザー鳴動中！ 5秒以内に EBリセット（Xキー／黄色ボタン）またはマスコンを操作してください',
        en: 'EB Vigilance Alarm — Press EB Reset (X) within 5 seconds',
        durationMs: 5200,
      });
    } else if (evt.type === 'eb_apply') {
      this._showCaption({
        category: 'ats',
        badge: 'EB非常制動',
        jp: 'EB装置作動：非常ブレーキ投入中（Xキーまたは黄色ボタンでEBリセット）',
        en: 'EB Emergency Brake Applied — Press EB Reset (X)',
        durationMs: 6000,
      });
    } else if (evt.type === 'reset') {
      if (this.containerEl && this.badgeEl?.textContent?.startsWith('EB')) {
        this.containerEl.classList.add('hidden');
      }
    }
  }

  /**
   * 走行距離に応じた車内自動放送（日英一体型サンプリング音源対応・前チャイムなし）更新
   */
  update({ distance, speedKmh, serviceType, doorsOpen, isDrivingStarted }) {
    if (!isDrivingStarted || doorsOpen) return;
    const isSpecial = serviceType === 'special_rapid';

    const fireOnce = (id, cond, fn) => {
      if (!this.firedTriggers.has(id) && cond) {
        this.firedTriggers.add(id);
        fn();
      }
    };

    // 1. 日暮里発車後の車内自動放送（日英統合 1ファイル再生・前チャイムなし）
    fireOnce('pa_nippori', distance >= 115 && speedKmh > 12, () => {
      const sampleKey = isSpecial ? 'pa_spec_kitasenju' : 'pa_rapid_mikawashima';
      const jp = isSpecial
        ? '本日も、JR東日本をご利用くださいまして、ありがとうございます。この電車は、常磐線、特別快速、土浦行きです。次は、北千住に停まります。三河島、南千住には停まりませんので、ご注意ください。'
        : '本日も、JR東日本をご利用くださいまして、ありがとうございます。この電車は、常磐線、快速、取手行きです。次は、三河島、三河島です。お出口は、右側です。';
      const en = isSpecial
        ? 'Thank you for riding with JR East. This is the Joban Line Special Rapid service bound for Tsuchiura. The next station is Kita-Senju, JJ-05.'
        : 'Thank you for riding with JR East. This is the Joban Line Rapid service bound for Toride. The next station is Mikawashima, JJ-03. The doors on the right side will open.';

      const res = this.sound ? this.sound.playOnboardAnnouncement(sampleKey) : { played: false };
      const durMs = res.played && res.duration ? Math.max(7000, res.duration * 1000 + 500) : 9000;
      this._showCaption({
        category: 'pa',
        badge: '車内自動放送 · PA',
        jp,
        en,
        durationMs: durMs,
      });
    });

    // 2. 三河島発車後の車内自動放送（快速のみ）
    if (!isSpecial) {
      fireOnce('pa_mikawashima', distance >= 1315 && speedKmh > 12, () => {
        const jp =
          '次は、南千住、南千住です。お出口は、右側です。東京メトロ日比谷線と、つくばエクスプレス線は、お乗り換えです。';
        const en =
          'The next station is Minami-Senju, JJ-04. The doors on the right side will open. Please change here for the Tokyo Metro Hibiya Line and the Tsukuba Express Line.';
        const res = this.sound
          ? this.sound.playOnboardAnnouncement('pa_rapid_minamisenju')
          : { played: false };
        const durMs = res.played && res.duration ? Math.max(6500, res.duration * 1000 + 500) : 8400;
        this._showCaption({
          category: 'pa',
          badge: '車内自動放送 · PA',
          jp,
          en,
          durationMs: durMs,
        });
      });

      // 3. 南千住発車後の車内自動放送（快速のみ）
      fireOnce('pa_minamisenju', distance >= 3515 && speedKmh > 12, () => {
        const jp =
          '次は、北千住、北千住です。お出口は、左側です。千代田線、日比谷線、東武スカイツリーライン、つくばエクスプレス線は、お乗り換えです。';
        const en =
          'The next station is Kita-Senju, JJ-05. The doors on the left side will open. Please change here for the Chiyoda Line, the Hibiya Line, the Tobu Skytree Line, and the Tsukuba Express.';
        const res = this.sound
          ? this.sound.playOnboardAnnouncement('pa_rapid_kitasenju')
          : { played: false };
        const durMs = res.played && res.duration ? Math.max(6500, res.duration * 1000 + 500) : 8800;
        this._showCaption({
          category: 'pa',
          badge: '車内自動放送 · PA',
          jp,
          en,
          durationMs: durMs,
        });
      });
    }

    // 4. 北千住到着前の車内自動放送（快速・特快共通）
    fireOnce('pa_kitasenju_arr', distance >= 4645 && distance < 4740, () => {
      const jp =
        'まもなく、北千住、北千住です。お出口は、左側です。お忘れ物のないよう、お手回り品にご注意ください。';
      const en =
        'We will soon make a brief stop at Kita-Senju, JJ-05. The doors on the left side will open.';
      const res = this.sound
        ? this.sound.playOnboardAnnouncement('pa_kitasenju_arr')
        : { played: false };
      const durMs = res.played && res.duration ? Math.max(6000, res.duration * 1000 + 500) : 7600;
      this._showCaption({
        category: 'pa',
        badge: '車内自動放送 · PA',
        jp,
        en,
        durationMs: durMs,
      });
    });
  }
}
