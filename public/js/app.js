/**
 * SyncSub Meeting — 雙邊前端會議室
 * 流程：大廳加入 → Socket 進房 → Web Speech 收音 → 中繼翻譯 → 雙邊字幕
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const els = {
    lobby: $('lobby'),
    room: $('room'),
    displayName: $('displayName'),
    roomId: $('roomId'),
    serverUrl: $('serverUrl'),
    enterBtn: $('enterBtn'),
    roleTw: $('roleTw'),
    roleJp: $('roleJp'),
    inviteRole: $('inviteRole'),
    inviteExpiry: $('inviteExpiry'),
    createInviteBtn: $('createInviteBtn'),
    inviteOutput: $('inviteOutput'),
    topbar: $('topbar'),
    connDot: $('connDot'),
    roomLabel: $('roomLabel'),
    myLang: $('myLang'),
    targetLang: $('targetLang'),
    toggleBtn: $('toggleBtn'),
    volumeWrap: $('volumeWrap'),
    volumeBar: $('volumeBar'),
    fontDown: $('fontDown'),
    fontUp: $('fontUp'),
    exportBtn: $('exportBtn'),
    leaveBtn: $('leaveBtn'),
    hidePanelBtn: $('hidePanelBtn'),
    showPanelBtn: $('showPanelBtn'),
    statusPill: $('statusPill'),
    debugLog: $('debugLog'),
    membersPill: $('membersPill'),
    stream: $('stream'),
    placeholder: $('placeholder'),
    interimBox: $('interimBox'),
  };

  const state = {
    role: 'tw',
    socket: null,
    selfId: null,
    roomId: '',
    displayName: '',
    translateMode: 'server',
    hostLane: !!(window.__SYNCSUB_HOST__ || /^\/r\//.test(location.pathname)),
    hostToken: /^\/r\/([^/]+)/.exec(location.pathname)?.[1] || '',
    invite: /^\/j\/([A-Za-z0-9_-]+)\/?$/.exec(location.pathname)?.[1] || new URLSearchParams(location.search).get('invite') || '',
    isRecording: false,
    recognition: null,
    restartTimer: null,
    audioContext: null,
    analyser: null,
    micStream: null,
    rafId: null,
    fontScale: 1,
    history: [],
    pingTimer: null,
    pendingMsgs: {},
    remoteMsgAt: {},
    pendingTranslations: {},
    metrics: { rtt: null, lastTranslateMs: null },
    uiLocale: 'zh-TW',
  };

  const jaCopy = {
    '已連線中繼站': '字幕サーバーに接続しました',
    '已連線，待命中': '接続済み・待機中',
    '尚未連線': '未接続',
    '麥克風開啟中': 'マイクはオンです',
    '麥克風已啟動': 'マイクを開始しました',
    '正在聽寫…': '音声を認識中…',
    '等待發話…': '発話をお待ちしています…',
    '麥克風權限被拒': 'マイクの許可が拒否されました',
    '語音辨識網路錯誤（需連上網路）': '音声認識のネットワークエラーです（インターネット接続を確認してください）',
    '無法讀取麥克風音量': 'マイク音量を取得できません',
    '啟動失敗：請用 localhost 或 HTTPS': '開始できません。HTTPS の招待URLを Chrome で開いてください。',
    '翻譯中…': '翻訳中…',
    '邀請已驗證｜伺服器翻譯': '招待を確認しました・サーバー翻訳',
  };

  function ui(text) {
    return state.uiLocale === 'ja-JP' ? (jaCopy[text] || text) : text;
  }

  function setChipLabel(select, label) {
    const chip = select?.closest('.chip');
    if (chip?.firstChild?.nodeType === Node.TEXT_NODE) chip.firstChild.nodeValue = `${label} `;
  }

  function ensureLatencyPill() {
    if (els.latencyPill) return;
    const leftCol = els.statusPill?.parentElement;
    if (!leftCol) return;
    const pill = document.createElement('div');
    pill.id = 'latencyPill';
    pill.className = 'latency-pill';
    pill.title = state.uiLocale === 'ja-JP'
      ? 'RTT：字幕サーバーとの往復時間／訳：翻訳APIの処理時間'
      : 'RTT：與中繼站來回延遲；譯：伺服器呼叫翻譯 API 耗時';
    pill.textContent = state.uiLocale === 'ja-JP' ? '遅延：—' : '延遲：—';
    leftCol.insertBefore(pill, els.debugLog);
    els.latencyPill = pill;
  }

  function updateLatencyUI() {
    ensureLatencyPill();
    if (!els.latencyPill) return;
    const rtt = state.metrics.rtt != null ? `${state.metrics.rtt}ms` : '—';
    const tr = state.metrics.lastTranslateMs != null ? `${state.metrics.lastTranslateMs}ms` : '—';
    els.latencyPill.textContent = `RTT ${rtt}｜${state.uiLocale === 'ja-JP' ? '訳' : '譯'} ${tr}`;
    const r = state.metrics.rtt || 0;
    els.latencyPill.classList.remove('warn', 'bad');
    if (r > 2000) els.latencyPill.classList.add('bad');
    else if (r > 800) els.latencyPill.classList.add('warn');
  }

  function recordRtt(rtt) {
    state.metrics.rtt = rtt;
    updateLatencyUI();
  }

  // ---- Lobby ----
  function setRole(role) {
    state.role = role;
    els.roleTw.classList.toggle('active', role === 'tw');
    els.roleJp.classList.toggle('active', role === 'jp');
    if (role === 'tw') {
      els.myLang.value = 'zh-TW';
      els.targetLang.value = 'ja-JP';
    } else {
      els.myLang.value = 'ja-JP';
      els.targetLang.value = 'zh-TW';
    }
  }

  els.roleTw.addEventListener('click', () => setRole('tw'));
  els.roleJp.addEventListener('click', () => setRole('jp'));

  async function applyInviteDefaults() {
    if (!state.invite) return;
    els.enterBtn.disabled = true;
    let claim;
    try {
      const response = await fetch('/api/invites/resolve', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invite: state.invite }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error);
      claim = result.claim;
    } catch (error) {
      showLobbyError(error.message || '接続を確認して再読み込みしてください。／請檢查網路並重新整理。');
      return;
    }
    els.roomId.value = claim.roomId;
    els.roomId.readOnly = true;
    setRole(claim.role);
    els.enterBtn.disabled = false;
    const expiryNotice = document.createElement('p');
    expiryNotice.className = 'hint';
    const japanese = claim.role === 'jp';
    const expiryText = new Intl.DateTimeFormat(japanese ? 'ja-JP' : 'zh-TW', {
      timeZone: japanese ? 'Asia/Tokyo' : 'Asia/Taipei', dateStyle: 'medium', timeStyle: 'short',
    }).format(new Date(claim.exp));
    expiryNotice.textContent = japanese
      ? `このリンクは練習にも使えます。有効期限：${expiryText}（日本時間）。練習後も同じリンクから再入室できます。`
      : `此連結可提前練習，有效至 ${expiryText}（台灣時間），可重複進入。`;
    els.enterBtn.before(expiryNotice);
    els.inviteRole?.closest('.field')?.classList.add('hidden');
    els.roleTw?.closest('.field')?.classList.add('hidden');
    const lead = document.querySelector('.lobby .lead');
    if (claim.role !== 'jp') return;

    state.uiLocale = 'ja-JP';
    document.documentElement.lang = 'ja';
    document.title = 'KirokuFlow 日中リアルタイム字幕';
    document.querySelector('.badge-host').textContent = 'KirokuFlow · 招待制リアルタイム字幕';
    if (lead) lead.textContent = '会議への招待を確認しました。日本語の発言は繁體中文に翻訳されます。';
    els.displayName.closest('.field').querySelector('label').textContent = '表示名';
    els.displayName.placeholder = '例：田中教授';
    els.roomId.closest('.field').querySelector('label').textContent = '会議室番号（設定済み）';
    els.serverUrl.closest('.field').classList.add('hidden');
    els.enterBtn.textContent = '会議室に入る';
    document.querySelector('.lobby .hint').innerHTML =
      '<strong>使い方（約30秒）</strong><br>1. 表示名を入力し、「会議室に入る」を押します。<br>2. ブラウザが表示したら、マイクを「許可」します。<br>3. 「マイクを開始」を押して日本語で話します。字幕は相手に繁體中文で表示されます。';
    setChipLabel(els.myLang, '話す言語');
    setChipLabel(els.targetLang, '翻訳先');
    els.myLang.disabled = true;
    els.targetLang.disabled = true;
    els.toggleBtn.textContent = 'マイクを開始';
    els.exportBtn.title = '字幕を保存';
    els.leaveBtn.title = '会議室を退出';
    els.hidePanelBtn.title = '操作パネルを隠す';
    els.showPanelBtn.title = '操作パネルを表示';
    els.placeholder.innerHTML = '「マイクを開始」を押すと、あなたの発言がここに表示されます。<br>相手には繁體中文の翻訳字幕が同期されます。';
    els.interimBox.textContent = '認識中…';
  }

  function showLobbyError(message) {
    let notice = document.getElementById('inviteError');
    if (!notice) {
      notice = document.createElement('p');
      notice.id = 'inviteError';
      notice.setAttribute('role', 'alert');
      notice.style.color = 'var(--danger)';
      els.enterBtn.before(notice);
    }
    notice.textContent = message;
  }

  function requestedRoleFromLanguages() {
    return els.myLang.value === 'ja-JP' || els.targetLang.value === 'zh-TW' ? 'jp' : 'tw';
  }

  function changeMeetingRole() {
    const requestedRole = requestedRoleFromLanguages();
    const previousRole = state.role;
    // Keep the two controls a valid Chinese/Japanese pair immediately.
    setRole(requestedRole);
    if (!state.socket?.connected || !state.roomId) return;
    state.socket.emit('set_role', { role: requestedRole }, (res) => {
      if (!res?.ok) {
        setRole(previousRole);
        showDebug(res?.error || '無法變更語言設定');
        return;
      }
      setRole(res.role);
      showDebug(res.role === 'jp' ? '已切換：日文 → 繁中' : '已切換：繁中 → 日文');
    });
  }

  els.myLang.addEventListener('change', changeMeetingRole);
  els.targetLang.addEventListener('change', changeMeetingRole);

  // 從 URL 預填：?room=xxx&role=jp&name=Tanaka
  (function hydrateFromQuery() {
    const q = new URLSearchParams(location.search);
    if (q.get('room')) els.roomId.value = q.get('room');
    if (q.get('name')) els.displayName.value = q.get('name');
    if (q.get('role') === 'jp') setRole('jp');
    if (q.get('server') && els.serverUrl) els.serverUrl.value = q.get('server');
    applyInviteDefaults();
  })();

  els.enterBtn.addEventListener('click', enterRoom);

  function enterRoom() {
    const roomId = els.roomId.value.trim();
    const displayName = els.displayName.value.trim() || (state.role === 'tw' ? '台灣端' : '日本端');
    if (!roomId) {
      alert('請輸入會議房號');
      return;
    }

    if (!state.hostToken && !state.invite) {
      alert('請使用主持人提供的有效會議邀請連結。');
      return;
    }

    state.roomId = roomId;
    state.displayName = displayName;
    setRole(state.role);

    els.lobby.classList.add('hidden');
    els.room.classList.remove('hidden');
    els.roomLabel.textContent = `#${roomId}`;
    ensureLatencyPill();
    updateLatencyUI();

    connectSocket();
  }

  // ---- Socket ----
  function connectSocket() {
    if (state.socket) {
      state.socket.removeAllListeners();
      state.socket.disconnect();
    }

    const url = els.serverUrl.value.trim() || undefined;
    state.socket = io(url, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 800,
      reconnectionDelayMax: 5000,
    });

    const s = state.socket;

    s.on('connect', () => {
      setConn('live', '已連線中繼站');
      joinRoom();
      startPing();
    });

    s.on('disconnect', (reason) => {
      setConn('warn', `連線中斷：${reason}`);
      stopPing();
    });

    s.on('connect_error', (err) => {
      setConn('warn', `連線失敗：${err.message}`);
      showDebug(err.message);
    });

    s.on('room_update', (snap) => {
      renderMembers(snap?.members || []);
      // Snapshots repair missed originals/translations after reconnect and preserve server order.
      if (Array.isArray(snap?.history)) {
        for (const item of snap.history) {
          const existing = document.getElementById(item.msgId);
          if (!existing) {
            const mine = item.senderId === state.selfId;
            appendBubble({
              msgId: item.msgId,
              text: item.text,
              senderName: item.senderName,
              mine,
              translatedText: item.translatedText,
            });
          } else if (item.translatedText) {
            applyTranslation(item.msgId, item.translatedText, item.provider === 'error', { provider: item.provider });
          }
        }
      }
    });

    s.on('receive_original', (data) => {
      if (data.senderId === state.selfId) return;
      if (data.msgId && data.at) state.remoteMsgAt[data.msgId] = data.at;
      appendBubble({
        msgId: data.msgId,
        text: data.text,
        senderName: data.senderName || '遠端與會者',
        mine: false,
      });
      const pending = state.pendingTranslations[data.msgId];
      if (pending) {
        delete state.pendingTranslations[data.msgId];
        applyTranslation(data.msgId, pending.translatedText, pending.error, pending);
      }
    });

    s.on('receive_translation', (data) => {
      if (data.translateMs != null) {
        state.metrics.lastTranslateMs = data.translateMs;
        updateLatencyUI();
      }

      let latencyNote = '';
      const pending = state.pendingMsgs[data.msgId];
      if (pending) {
        latencyNote = `往返 ${Date.now() - pending.sentAt}ms`;
        delete state.pendingMsgs[data.msgId];
      } else if (state.remoteMsgAt[data.msgId]) {
        latencyNote = `端到端 ${Date.now() - state.remoteMsgAt[data.msgId]}ms`;
        delete state.remoteMsgAt[data.msgId];
      }

      const meta = {
        translateMs: data.translateMs,
        latencyNote,
        provider: data.provider,
        reason: data.reason,
      };
      if (document.getElementById(data.msgId)) applyTranslation(data.msgId, data.translatedText, data.error, meta);
      else state.pendingTranslations[data.msgId] = { ...meta, translatedText: data.translatedText, error: data.error };
    });

    s.on('server_error', (data) => {
      showDebug(data.message || '伺服器錯誤');
    });
  }

  function joinRoom() {
    state.socket.emit(
      'join_room',
      {
        roomId: state.roomId,
        displayName: state.displayName,
        role: state.role,
        hostToken: state.hostToken,
        invite: state.invite,
      },
      (res) => {
        if (!res?.ok) {
          showDebug(res?.error || '加入房間失敗');
          showLobbyError(state.uiLocale === 'ja-JP'
            ? '会議室に入れませんでした。招待の期限切れや満室の可能性があります。主催者に新しいリンクをご依頼ください。'
            : (res?.error || '加入房間失敗，請重新取得邀請。'));
          els.room.classList.add('hidden');
          els.lobby.classList.remove('hidden');
          return;
        }
        state.selfId = res.selfId;
        state.translateMode = res.translateMode || 'server';
        renderMembers(res.snapshot?.members || []);
        const modeLabel = res.access === 'host' ? '主持人已驗證｜伺服器翻譯' : '邀請已驗證｜伺服器翻譯';
        showDebug(`已加入房間 ${res.roomId}｜${modeLabel}`);
        setConn('live', modeLabel);
      }
    );
  }

  function startPing() {
    stopPing();
    const pingOnce = () => {
      if (!state.socket?.connected) return;
      const t0 = Date.now();
      state.socket.emit('client_ping', t0, (res) => {
        const rtt = Date.now() - (res?.clientTs || t0);
        recordRtt(rtt);
      });
    };
    pingOnce();
    state.pingTimer = setInterval(pingOnce, 5000);
  }

  function stopPing() {
    if (state.pingTimer) clearInterval(state.pingTimer);
    state.pingTimer = null;
  }

  function setConn(mode, text) {
    els.connDot.className = `dot ${mode}`;
    els.statusPill.textContent = ui(text);
  }

  function renderMembers(members) {
    const names = members.map((m) => m.displayName).join('、') || (state.uiLocale === 'ja-JP' ? 'ほかの参加者はいません' : '尚無其他成員');
    els.membersPill.textContent = state.uiLocale === 'ja-JP'
      ? `参加者：${members.length}名｜${names}`
      : `房間人數：${members.length}｜${names}`;
  }

  function showDebug(msg) {
    console.log('[SyncSub]', msg);
    els.debugLog.textContent = ui(msg);
    els.debugLog.classList.add('show');
  }

  // ---- Bubbles ----
  function appendBubble({ msgId, text, senderName, mine, translatedText }) {
    if (document.getElementById(msgId)) return msgId;
    if (els.placeholder) els.placeholder.style.display = 'none';

    const div = document.createElement('div');
    div.id = msgId;
    div.className = `bubble ${mine ? 'mine' : 'theirs'}${translatedText ? (mine ? ' done' : '') : ''}`;
    div.innerHTML = `
      <div class="who">${escapeHtml(senderName)}${mine ? '' : ''}</div>
      <div class="original">${escapeHtml(text)}</div>
      <div class="translation-target ${translatedText ? 'translated' : 'pending'}">
        ${translatedText ? escapeHtml(translatedText) : ui('翻譯中…')}
      </div>
      <div class="latency-meta hidden"></div>
    `;
    els.stream.appendChild(div);
    state.history.push({ msgId, text, senderName, mine, translatedText: translatedText || '' });
    scrollBottom();
    return msgId;
  }

  function applyTranslation(msgId, translatedText, isError, meta = {}) {
    const box = document.getElementById(msgId);
    if (!box) return;
    const target = box.querySelector('.translation-target');
    if (!target) return;
    target.classList.remove('pending');
    target.classList.add('translated');
    if (isError) target.style.color = 'var(--danger)';
    target.textContent = translatedText;
    if (isError && meta.reason) showDebug(meta.reason);
    if (box.classList.contains('mine')) box.classList.add('done');

    const metaEl = box.querySelector('.latency-meta');
    if (metaEl) {
      const parts = [];
      if (meta.translateMs != null) parts.push(`譯 ${meta.translateMs}ms`);
      if (meta.latencyNote) parts.push(meta.latencyNote);
      if (meta.provider && meta.provider !== 'error') parts.push(meta.provider);
      if (parts.length) {
        metaEl.textContent = parts.join(' · ');
        metaEl.classList.remove('hidden');
      }
    }

    const hist = state.history.find((h) => h.msgId === msgId);
    if (hist) hist.translatedText = translatedText;
    scrollBottom();
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function scrollBottom() {
    els.stream.scrollTop = els.stream.scrollHeight;
  }

  // ---- Speech ----
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    els.toggleBtn.disabled = true;
    els.toggleBtn.textContent = state.uiLocale === 'ja-JP' ? 'Chrome を使用' : '請用 Chrome';
    els.toggleBtn.title = state.uiLocale === 'ja-JP' ? 'Chrome または Edge で招待URLを開き直してください。' : '請使用 Chrome 或 Edge，並重新開啟此邀請網址。';
  } else {
    initRecognition();
  }

  function initRecognition() {
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = els.myLang.value;
    state.recognition = recognition;

    recognition.onstart = () => {
      state.isRecording = true;
      updateRecUI();
      showDebug('麥克風已啟動');
    };

    recognition.onspeechstart = () => {
      els.statusPill.textContent = ui('正在聽寫…');
    };

    recognition.onresult = (event) => {
      let interim = '';
      let finalText = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const chunk = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalText += chunk;
        else interim += chunk;
      }

      if (interim.trim()) {
        els.interimBox.textContent = interim;
        els.interimBox.classList.add('show');
      } else {
        els.interimBox.classList.remove('show');
      }

      if (finalText.trim()) {
        const msgId = `msg-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
        appendBubble({
          msgId,
          text: finalText.trim(),
          senderName: state.displayName || '我',
          mine: true,
        });
        state.socket?.emit('send_speech', {
          roomId: state.roomId,
          msgId,
          text: finalText.trim(),
          sourceLang: els.myLang.value,
          targetLang: els.targetLang.value,
        });
        state.pendingMsgs[msgId] = { sentAt: Date.now() };
      }
    };

    recognition.onerror = (event) => {
      if (event.error === 'not-allowed') {
        showDebug('麥克風權限被拒');
        alert('請允許麥克風權限。正式會議請用 HTTPS 網址開啟。');
        stopRecording();
      } else if (event.error === 'no-speech') {
        els.statusPill.textContent = ui('等待發話…');
      } else if (event.error === 'network') {
        showDebug('語音辨識網路錯誤（需連上網路）');
      } else {
        showDebug(`語音錯誤：${event.error}`);
      }
    };

    recognition.onend = () => {
      if (!state.isRecording) {
        updateRecUI();
        return;
      }
      // Chrome 會自動結束 session，必須重啟以維持整場會議
      clearTimeout(state.restartTimer);
      state.restartTimer = setTimeout(() => {
        if (!state.isRecording) return;
        try {
          recognition.lang = els.myLang.value;
          recognition.start();
        } catch (e) {
          setTimeout(() => {
            try {
              if (state.isRecording) recognition.start();
            } catch (_) {}
          }, 600);
        }
      }, 250);
    };
  }

  els.toggleBtn.addEventListener('click', () => {
    if (state.isRecording) stopRecording();
    else startRecording();
  });

  async function startRecording() {
    if (!state.recognition) return;
    if (!state.socket?.connected) {
      alert('尚未連上中繼站，請確認伺服器已啟動。');
      return;
    }
    state.recognition.lang = els.myLang.value;
    try {
      state.isRecording = true;
      state.recognition.start();
      await startVolumeMeter();
      updateRecUI();
    } catch (e) {
      state.isRecording = false;
      showDebug('啟動失敗：請用 localhost 或 HTTPS');
    }
  }

  function stopRecording() {
    state.isRecording = false;
    clearTimeout(state.restartTimer);
    try {
      state.recognition?.stop();
    } catch (_) {}
    stopVolumeMeter();
    els.interimBox.classList.remove('show');
    updateRecUI();
  }

  function updateRecUI() {
    if (state.isRecording) {
      els.toggleBtn.textContent = state.uiLocale === 'ja-JP' ? 'マイクを停止' : '停止收音';
      els.toggleBtn.classList.add('stop');
      els.statusPill.textContent = ui('麥克風開啟中');
    } else {
      els.toggleBtn.textContent = state.uiLocale === 'ja-JP' ? 'マイクを開始' : '開始收音';
      els.toggleBtn.classList.remove('stop');
      els.statusPill.textContent = ui(state.socket?.connected ? '已連線，待命中' : '尚未連線');
    }
  }

  async function startVolumeMeter() {
    try {
      state.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      state.analyser = state.audioContext.createAnalyser();
      state.analyser.fftSize = 256;
      state.audioContext.createMediaStreamSource(state.micStream).connect(state.analyser);
      els.volumeWrap.classList.add('show');
      drawVolume();
    } catch (err) {
      showDebug('無法讀取麥克風音量');
    }
  }

  function stopVolumeMeter() {
    if (state.rafId) cancelAnimationFrame(state.rafId);
    state.micStream?.getTracks().forEach((t) => t.stop());
    state.micStream = null;
    if (state.audioContext && state.audioContext.state !== 'closed') {
      state.audioContext.close().catch(() => {});
    }
    state.audioContext = null;
    els.volumeWrap.classList.remove('show');
    els.volumeBar.style.width = '0%';
  }

  function drawVolume() {
    if (!state.isRecording || !state.analyser) return;
    const data = new Uint8Array(state.analyser.frequencyBinCount);
    state.analyser.getByteFrequencyData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i];
    const pct = Math.min(100, (sum / data.length) * 1.6);
    els.volumeBar.style.width = `${pct}%`;
    state.rafId = requestAnimationFrame(drawVolume);
  }

  els.myLang.addEventListener('change', () => {
    if (state.isRecording) {
      stopRecording();
      setTimeout(startRecording, 350);
    }
  });

  // ---- UI helpers ----
  els.hidePanelBtn.addEventListener('click', () => {
    els.topbar.classList.add('collapsed');
    els.showPanelBtn.classList.remove('hidden');
  });

  els.showPanelBtn.addEventListener('click', () => {
    els.topbar.classList.remove('collapsed');
    els.showPanelBtn.classList.add('hidden');
  });

  els.fontUp.addEventListener('click', () => {
    state.fontScale = Math.min(1.6, state.fontScale + 0.1);
    els.stream.style.setProperty('font-size', `${state.fontScale}rem`);
  });

  els.fontDown.addEventListener('click', () => {
    state.fontScale = Math.max(0.8, state.fontScale - 0.1);
    els.stream.style.setProperty('font-size', `${state.fontScale}rem`);
  });

  els.exportBtn.addEventListener('click', () => {
    const lines = state.history.map((h) => {
      const side = h.mine ? '我' : h.senderName;
      return `[${side}]\n${h.text}\n→ ${h.translatedText || '(無譯文)'}\n`;
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `syncsub-${state.roomId}-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  els.leaveBtn.addEventListener('click', () => {
    stopRecording();
    stopPing();
    state.socket?.disconnect();
    location.href = location.pathname + location.search;
  });

  if (els.createInviteBtn) {
    els.createInviteBtn.addEventListener('click', async () => {
      if (!state.hostToken) return;
      const roomId = els.roomId.value.trim();
      if (!roomId) return alert('請先輸入會議房號，再建立邀請。');
      els.createInviteBtn.disabled = true;
      try {
        const expiryValue = els.inviteExpiry?.value || '45';
        const expiry = expiryValue.includes('T') ? { expiresAt: expiryValue } : { expiresInMinutes: expiryValue };
        const response = await fetch('/api/invites', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.hostToken}` },
          body: JSON.stringify({ roomId, role: els.inviteRole?.value || 'jp', ...expiry }),
        });
        const result = await response.json();
        if (!result.ok) throw new Error(result.error || '無法建立邀請');
        els.inviteOutput.value = result.joinUrl;
        els.inviteOutput.select();
        await navigator.clipboard?.writeText(result.joinUrl);
        showDebug('已建立限時邀請連結，已複製到剪貼簿。');
      } catch (error) { alert(error.message || '建立邀請失敗'); }
      finally { els.createInviteBtn.disabled = false; }
    });
  }
})();
