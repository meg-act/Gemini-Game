/**
 * JR東日本 常磐線（快速・特別快速）
 * 日英バイリンガル車内自動放送・駅ホームATOS戸閉放送・運転士指差喚呼システム
 *   - Web Audio チャイム・出発合図ブザーと連携
 *   - ブラウザ SpeechSynthesis（日本語・英語音声が存在する環境では実音声読み上げ、非対応環境でも字幕ティッカーを完全表示）
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
    this._departedStationIds = new Set();
    this._speechAvailable =
      typeof window !== 'undefined' &&
      'speechSynthesis' in window &&
      typeof window.SpeechSynthesisUtterance !== 'undefined';

    this._jaVoice = null;
    this._enVoice = null;
    if (this._speechAvailable) {
      const loadVoices = () => {
        try {
          const voices = window.speechSynthesis.getVoices() || [];
          this._jaVoice =
            voices.find((v) => /ja[-_]JP/i.test(v.lang) && /Kyoko|O-Ren|Nanami|Google|Haruka/i.test(v.name)) ||
            voices.find((v) => /^ja/i.test(v.lang)) ||
            null;
          this._enVoice =
            voices.find((v) => /en[-_]US/i.test(v.lang) && /Samantha|Ava|Aria|Google/i.test(v.name)) ||
            voices.find((v) => /^en/i.test(v.lang)) ||
            null;
        } catch {
          // ignore headless speechSynthesis quirks
        }
      };
      loadVoices();
      if (window.speechSynthesis.onvoiceschanged !== undefined) {
        window.speechSynthesis.onvoiceschanged = loadVoices;
      }
    }
  }

  reset(startDistance = 0) {
    this.cancelAll();
    this.firedTriggers.clear();
    this._departedStationIds.clear();

    // 途中区間へジャンプした際は、それより手前のイベントを発火済みとしてマーク
    const checkpoints = [
      ['pa_nippori', 115],
      ['call_lim60', 164],
      ['call_app_mikawashima', 905],
      ['call_lim75_mika', 985],
      ['pass_mikawashima', 1195],
      ['pa_mikawashima', 1315],
      ['call_lim95', 1385],
      ['call_app_minamisenju', 3090],
      ['pass_minamisenju', 3395],
      ['pa_minamisenju', 3515],
      ['call_sumida85', 3825],
      ['call_sekiya75', 4325],
      ['pa_kitasenju_arr', 4645],
      ['call_kitasenju45', 4852],
    ];
    for (const [id, dist] of checkpoints) {
      if (startDistance > dist + 15) {
        this.firedTriggers.add(id);
      }
    }
    if (startDistance > 35) this._departedStationIds.add('nippori');
    if (startDistance > 1235) this._departedStationIds.add('mikawashima');
    if (startDistance > 3435) this._departedStationIds.add('minamisenju');
  }

  cancelAll() {
    if (this._hideTimer) {
      clearTimeout(this._hideTimer);
      this._hideTimer = null;
    }
    for (const t of this._delayedTimers) clearTimeout(t);
    this._delayedTimers = [];

    if (this._speechAvailable) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // ignore
      }
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

  _showCaption({ category = 'call', badge = '指差喚呼', jp = '', en = '', durationMs = 5200 }) {
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

  _speak(jpSpeech, enSpeech = '', { rateJa = 1.05, pitchJa = 1.04 } = {}) {
    if (
      !this._speechAvailable ||
      !this.sound ||
      this.sound.isMuted ||
      this.sound.isTimeStopped
    ) {
      return;
    }
    try {
      window.speechSynthesis.cancel();
      if (jpSpeech && this._jaVoice) {
        const uJa = new window.SpeechSynthesisUtterance(jpSpeech);
        uJa.lang = 'ja-JP';
        uJa.voice = this._jaVoice;
        uJa.rate = rateJa;
        uJa.pitch = pitchJa;
        uJa.volume = 0.78;
        window.speechSynthesis.speak(uJa);
      }
      if (enSpeech && this._enVoice) {
        const uEn = new window.SpeechSynthesisUtterance(enSpeech);
        uEn.lang = 'en-US';
        uEn.voice = this._enVoice;
        uEn.rate = 1.02;
        uEn.pitch = 1.02;
        uEn.volume = 0.72;
        window.speechSynthesis.speak(uEn);
      }
    } catch {
      // ignore browser TTS restrictions
    }
  }

  /**
   * 駅ホーム ATOS 戸閉放送 → 車掌出発合図ブザー「ツー・ツー」→ 運転士戸閉喚呼
   */
  onDoorsClosing(station) {
    if (!station) return;
    const trackNum = station.id === 'nippori' ? '4番線' : '1番線';
    const jp = `${trackNum}の、常磐線、ドアが閉まります。ご注意ください。`;
    const en = 'Please stand clear of the closing doors.';
    this._showCaption({
      category: 'atos',
      badge: `${station.nameKanji}駅 ATOS`,
      jp,
      en,
      durationMs: 4200,
    });
    this._speak(jp, en, { rateJa: 1.06, pitchJa: 0.96 });

    this._schedule(() => {
      if (this.sound && !this.sound.isTimeStopped) {
        this.sound.playConductorBuzzer();
        this._showCaption({
          category: 'call',
          badge: '車掌合図 · 指差喚呼',
          jp: '（ブザー ツー・ツー） 「戸閉めよし！ 出発進行！」',
          en: '',
          durationMs: 3600,
        });
      }
    }, 1750);
  }

  /**
   * 駅停車完了時の運転士指差喚呼
   */
  onStationStop(station, diffMeters) {
    if (!station) return;
    const signStr = diffMeters >= 0 ? `+${diffMeters.toFixed(2)}` : diffMeters.toFixed(2);
    const jp =
      station.id === 'kitasenju'
        ? `「北千住1番線、停車完了！ 停止位置 ${signStr}m、乗務完了よし！」`
        : `「${station.nameKanji}、停車完了！ 15両停止位置 ${signStr}m、よし！」`;
    this._showCaption({
      category: 'call',
      badge: '指差喚呼',
      jp,
      en: '',
      durationMs: 4800,
    });
  }

  /**
   * ATS-P パターン接近・ブレーキ動作イベント時の喚呼表示
   */
  onAtsEvent(evt) {
    if (!evt) return;
    if (evt.type === 'brake_apply') {
      this._showCaption({
        category: 'ats',
        badge: 'ATS-P 動作',
        jp: '（キンコン・キンコン） ATS-P パターン常用最大ブレーキ動作中！',
        en: 'ATS-P Automatic Pattern Brake Active',
        durationMs: 4400,
      });
    } else if (evt.type === 'pattern_approach') {
      this._showCaption({
        category: 'ats',
        badge: 'ATS-P 接近',
        jp: '「ATS-P パターン接近、制限速度注意！」',
        en: '',
        durationMs: 3000,
      });
    }
  }

  /**
   * 走行距離・速度に応じた自動放送・指差喚呼トリガー更新
   */
  update({ distance, speedKmh, serviceType, doorsOpen, isDrivingStarted }) {
    if (!isDrivingStarted || doorsOpen) return;
    const isSpecial = serviceType === 'special_rapid';

    // 1. 各駅発車直後の「出発進行！」指差喚呼
    if (speedKmh > 2.5 && speedKmh < 24) {
      if (distance > -12 && distance < 32 && !this._departedStationIds.has('nippori')) {
        this._departedStationIds.add('nippori');
        this._showCaption({
          category: 'call',
          badge: '指差喚呼',
          jp: '「日暮里4番線、出発進行！ 制限55！」',
          durationMs: 3800,
        });
      } else if (distance > 1185 && distance < 1232 && !this._departedStationIds.has('mikawashima') && !isSpecial) {
        this._departedStationIds.add('mikawashima');
        this._showCaption({
          category: 'call',
          badge: '指差喚呼',
          jp: '「三河島1番線、出発進行！ 制限75！」',
          durationMs: 3800,
        });
      } else if (distance > 3385 && distance < 3432 && !this._departedStationIds.has('minamisenju') && !isSpecial) {
        this._departedStationIds.add('minamisenju');
        this._showCaption({
          category: 'call',
          badge: '指差喚呼',
          jp: '「南千住1番線、出発進行！」',
          durationMs: 3600,
        });
      }
    }

    const fireOnce = (id, cond, fn) => {
      if (!this.firedTriggers.has(id) && cond) {
        this.firedTriggers.add(id);
        fn();
      }
    };

    // 2. 日暮里発車後の車内自動放送（日英バイリンガル）
    fireOnce('pa_nippori', distance >= 115 && speedKmh > 12, () => {
      this.sound?.playOnboardChime();
      const jp = isSpecial
        ? '本日も、JR東日本をご利用くださいまして、ありがとうございます。この電車は、常磐線、特別快速、土浦行きです。次は、北千住に停まります。三河島、南千住には停まりませんので、ご注意ください。'
        : '本日も、JR東日本をご利用くださいまして、ありがとうございます。この電車は、常磐線、快速、取手行きです。次は、三河島、三河島です。お出口は、右側です。';
      const en = isSpecial
        ? 'Thank you for riding with JR East. This is the Joban Line Special Rapid service bound for Tsuchiura. The next station is Kita-Senju, JJ-05.'
        : 'Thank you for riding with JR East. This is the Joban Line Rapid service bound for Toride. The next station is Mikawashima, JJ-03. The doors on the right side will open.';
      this._schedule(() => {
        this._showCaption({
          category: 'pa',
          badge: '車内自動放送 · PA',
          jp,
          en,
          durationMs: 9200,
        });
        this._speak(jp, en);
      }, 650);
    });

    // 3. 三河島大カーブ制限60 指差喚呼
    fireOnce('call_lim60', distance >= 164 && distance < 220, () => {
      this._showCaption({
        category: 'call',
        badge: '指差喚呼',
        jp: '「第2閉塞進行！ 三河島大カーブ、制限60！」',
        durationMs: 3400,
      });
    });

    // 4. 三河島接近 / 通過
    if (!isSpecial) {
      fireOnce('call_app_mikawashima', distance >= 905 && distance < 960, () => {
        this._showCaption({
          category: 'call',
          badge: '指差喚呼',
          jp: '「三河島、停車！ 15両停止目標、確認！」',
          durationMs: 3800,
        });
      });
    } else {
      fireOnce('call_lim75_mika', distance >= 985 && distance < 1040, () => {
        this._showCaption({
          category: 'call',
          badge: '指差喚呼',
          jp: '「三河島構内、制限75！」',
          durationMs: 3200,
        });
      });
      fireOnce('pass_mikawashima', distance >= 1195 && distance < 1245, () => {
        this._showCaption({
          category: 'call',
          badge: '指差喚呼',
          jp: '「三河島、通過！ 定時！」',
          durationMs: 3200,
        });
      });
    }

    // 5. 三河島発車後の車内自動放送（快速のみ）
    if (!isSpecial) {
      fireOnce('pa_mikawashima', distance >= 1315 && speedKmh > 12, () => {
        this.sound?.playOnboardChime();
        const jp =
          '次は、南千住、南千住です。お出口は、右側です。東京メトロ日比谷線と、つくばエクスプレス線は、お乗り換えです。';
        const en =
          'The next station is Minami-Senju, JJ-04. The doors on the right side will open. Please change here for the Tokyo Metro Hibiya Line and the Tsukuba Express Line.';
        this._schedule(() => {
          this._showCaption({
            category: 'pa',
            badge: '車内自動放送 · PA',
            jp,
            en,
            durationMs: 8400,
          });
          this._speak(jp, en);
        }, 650);
      });
    }

    // 6. 高架直線 95km/h 制限解除喚呼
    fireOnce('call_lim95', distance >= 1385 && distance < 1450, () => {
      this._showCaption({
        category: 'call',
        badge: '指差喚呼',
        jp: '「制限解除、95！ 高架直線、進行よし！」',
        durationMs: 3500,
      });
    });

    // 7. 南千住接近 / 通過 ＆ 発車後放送
    if (!isSpecial) {
      fireOnce('call_app_minamisenju', distance >= 3090 && distance < 3150, () => {
        this._showCaption({
          category: 'call',
          badge: '指差喚呼',
          jp: '「南千住、停車！ 15両停止目標、確認！」',
          durationMs: 3800,
        });
      });
      fireOnce('pa_minamisenju', distance >= 3515 && speedKmh > 12, () => {
        this.sound?.playOnboardChime();
        const jp =
          '次は、北千住、北千住です。お出口は、左側です。千代田線、日比谷線、東武スカイツリーライン、つくばエクスプレス線は、お乗り換えです。';
        const en =
          'The next station is Kita-Senju, JJ-05. The doors on the left side will open. Please change here for the Chiyoda Line, the Hibiya Line, the Tobu Skytree Line, and the Tsukuba Express.';
        this._schedule(() => {
          this._showCaption({
            category: 'pa',
            badge: '車内自動放送 · PA',
            jp,
            en,
            durationMs: 8800,
          });
          this._speak(jp, en);
        }, 650);
      });
    } else {
      fireOnce('pass_minamisenju', distance >= 3395 && distance < 3445, () => {
        this._showCaption({
          category: 'call',
          badge: '指差喚呼',
          jp: '「南千住、通過！ 定時！」',
          durationMs: 3200,
        });
      });
    }

    // 8. 隅田川橋梁 85km/h ＆ 千住関屋カーブ 75km/h
    fireOnce('call_sumida85', distance >= 3825 && distance < 3885, () => {
      this._showCaption({
        category: 'call',
        badge: '指差喚呼',
        jp: '「隅田川橋梁、制限85！」',
        durationMs: 3400,
      });
    });

    fireOnce('call_sekiya75', distance >= 4325 && distance < 4390, () => {
      this._showCaption({
        category: 'call',
        badge: '指差喚呼',
        jp: '「千住関屋カーブ、制限75！」',
        durationMs: 3400,
      });
    });

    // 9. 北千住到着前自動放送 ＆ 場内1番線進入制限45 指差喚呼
    fireOnce('pa_kitasenju_arr', distance >= 4645 && distance < 4740, () => {
      this.sound?.playOnboardChime();
      const jp =
        'まもなく、北千住、北千住です。お出口は、左側です。お忘れ物のないよう、お手回り品にご注意ください。';
      const en =
        'We will soon make a brief stop at Kita-Senju, JJ-05. The doors on the left side will open.';
      this._schedule(() => {
        this._showCaption({
          category: 'pa',
          badge: '車内自動放送 · PA',
          jp,
          en,
          durationMs: 7600,
        });
        this._speak(jp, en);
      }, 650);
    });

    fireOnce('call_kitasenju45', distance >= 4852 && distance < 4920, () => {
      this._showCaption({
        category: 'call',
        badge: '指差喚呼',
        jp: '「場内注意！ 進路表示［1］確認、北千住1番線進入、制限45！」',
        durationMs: 4500,
      });
    });
  }
}
