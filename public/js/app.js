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
    billingHost: $('billingHost'),
    billingByok: $('billingByok'),
    byokFields: $('byokFields'),
    clientApiKey: $('clientApiKey'),
    clientApiModel: $('clientApiModel'),
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
    billingMode: 'host',
    apiKey: '',
    apiModel: 'gemini-2.5-flash',
    translateMode: 'server',
    requireClientApiKey: false,
    guestLane: !!(
      window.__SYNCSUB_GUEST__ ||
      /^\/(try|guest)\/?$/.test(location.pathname)
    ),
    hostLane: !!(window.__SYNCSUB_HOST__ || /^\/r\//.test(location.pathname)),
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
    metrics: { rtt: null, lastTranslateMs: null },
  };

  function ensureLatencyPill() {
    if (els.latencyPill) return;
    const leftCol = els.statusPill?.parentElement;
    if (!leftCol) return;
    const pill = document.createElement('div');
    pill.id = 'latencyPill';
    pill.className = 'latency-pill';
    pill.title = 'RTT：與中繼站來回延遲；譯：伺服器呼叫翻譯 API 耗時';
    pill.textContent = '延遲：—';
    leftCol.insertBefore(pill, els.debugLog);
    els.latencyPill = pill;
  }

  function updateLatencyUI() {
    ensureLatencyPill();
    if (!els.latencyPill) return;
    const rtt = state.metrics.rtt != null ? `${state.metrics.rtt}ms` : '—';
    const tr = state.metrics.lastTranslateMs != null ? `${state.metrics.lastTranslateMs}ms` : '—';
    els.latencyPill.textContent = `RTT ${rtt}｜譯 ${tr}`;
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

  // 訪客通道：固定 BYOK；主辦首頁：固定伺服器額度
  if (state.guestLane && els.billingByok) {
    els.billingByok.checked = true;
    state.billingMode = 'byok';
    state.requireClientApiKey = true;
  } else if (els.billingHost) {
    els.billingHost.checked = true;
    state.billingMode = 'host';
  }

  // 從 URL 預填：?room=xxx&role=jp&name=Tanaka
  (function hydrateFromQuery() {
    const q = new URLSearchParams(location.search);
    if (q.get('room')) els.roomId.value = q.get('room');
    if (q.get('name')) els.displayName.value = q.get('name');
    if (q.get('role') === 'jp') setRole('jp');
    if (q.get('server') && els.serverUrl) els.serverUrl.value = q.get('server');
  })();

  els.enterBtn.addEventListener('click', enterRoom);

  function enterRoom() {
    const roomId = els.roomId.value.trim();
    const displayName = els.displayName.value.trim() || (state.role === 'tw' ? '台灣端' : '日本端');
    if (!roomId) {
      alert('請輸入會議房號');
      return;
    }

    const byok = state.guestLane || els.billingByok?.checked;
    const apiKey = (els.clientApiKey?.value || '').trim();
    if (byok && !apiKey) {
      alert(state.guestLane ? '請輸入你自己的 Gemini API Key 才能進入測試會議室' : '請輸入 Gemini API Key');
      return;
    }

    state.roomId = roomId;
    state.displayName = displayName;
    state.billingMode = byok ? 'byok' : 'host';
    state.apiKey = byok ? apiKey : '';
    state.apiModel = els.clientApiModel?.value || 'gemini-2.5-flash';
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
      // 晚進房：補歷史（只補尚無 DOM 的訊息）
      if (Array.isArray(snap?.history)) {
        for (const item of snap.history) {
          if (!document.getElementById(item.msgId)) {
            const mine = item.senderId === state.selfId;
            appendBubble({
              msgId: item.msgId,
              text: item.text,
              senderName: item.senderName,
              mine,
              translatedText: item.translatedText,
            });
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

      applyTranslation(data.msgId, data.translatedText, data.error, {
        translateMs: data.translateMs,
        latencyNote,
        provider: data.provider,
      });
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
        myLang: els.myLang.value,
        targetLang: els.targetLang.value,
        apiKey: state.apiKey || '',
        apiModel: state.apiModel || 'gemini-2.5-flash',
        guestLane: !!state.guestLane,
      },
      (res) => {
        if (!res?.ok) {
          showDebug(res?.error || '加入房間失敗');
          els.room.classList.add('hidden');
          els.lobby.classList.remove('hidden');
          return;
        }
        state.selfId = res.selfId;
        state.translateMode = res.translateMode || (state.apiKey ? 'byok' : 'server');
        renderMembers(res.snapshot?.members || []);
        const modeLabel = state.guestLane
          ? '測試通道｜自備 Gemini Key'
          : state.translateMode === 'byok'
            ? '翻譯：自備 Gemini Key'
            : '翻譯：主辦方伺服器額度';
        showDebug(`已加入房間 ${res.roomId}｜${modeLabel}`);
        setConn('live', modeLabel);
        const shareParams = new URLSearchParams();
        shareParams.set('room', state.roomId);
        shareParams.set('role', state.role);
        // 自用路徑保留完整 pathname，避免洩漏到公開 /；測試用 /try
        const basePath = state.guestLane
          ? '/try'
          : state.hostLane
            ? location.pathname.replace(/\/$/, '') || '/'
            : '/';
        history.replaceState(null, '', `${basePath}?${shareParams.toString()}`);
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
    els.statusPill.textContent = text;
  }

  function renderMembers(members) {
    const names = members.map((m) => m.displayName).join('、') || '尚無其他成員';
    els.membersPill.textContent = `房間人數：${members.length}｜${names}`;
  }

  function showDebug(msg) {
    console.log('[SyncSub]', msg);
    els.debugLog.textContent = msg;
    els.debugLog.classList.add('show');
  }

  // ---- Bubbles ----
  function appendBubble({ msgId, text, senderName, mine, translatedText }) {
    if (els.placeholder) els.placeholder.style.display = 'none';

    const div = document.createElement('div');
    div.id = msgId;
    div.className = `bubble ${mine ? 'mine' : 'theirs'}${translatedText ? (mine ? ' done' : '') : ''}`;
    div.innerHTML = `
      <div class="who">${escapeHtml(senderName)}${mine ? '' : ''}</div>
      <div class="original">${escapeHtml(text)}</div>
      <div class="translation-target ${translatedText ? 'translated' : 'pending'}">
        ${translatedText ? escapeHtml(translatedText) : '翻譯中…'}
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
    els.toggleBtn.textContent = '請用 Chrome';
    alert('此瀏覽器不支援 Web Speech API，請使用 Google Chrome 或 Edge。');
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
      els.statusPill.textContent = '正在聽寫…';
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
        els.statusPill.textContent = '等待發話…';
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
      els.toggleBtn.textContent = '停止收音';
      els.toggleBtn.classList.add('stop');
      els.statusPill.textContent = '麥克風開啟中';
    } else {
      els.toggleBtn.textContent = '開始收音';
      els.toggleBtn.classList.remove('stop');
      els.statusPill.textContent = state.socket?.connected ? '已連線，待命中' : '尚未連線';
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
    location.href = location.pathname;
  });
})();
