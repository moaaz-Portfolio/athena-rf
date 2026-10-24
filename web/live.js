(() => {
  const $ = (selector) => document.querySelector(selector);
  let socket = null;
  let wantsLive = true;
  let retryTimer = null;
  let lastState = null;
  let currentRecording = false;

  function toast(message) {
    let el = $('#toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'athenaLocalToast';
      el.style.cssText = 'position:fixed;bottom:24px;left:24px;z-index:99999;max-width:85vw;padding:12px 16px;border:1px solid #28516a;border-radius:10px;background:#102234;color:#e9f7ff;box-shadow:0 8px 30px #0008;font-size:13px';
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.hidden = false;
    clearTimeout(el._hideTimer);
    el._hideTimer = setTimeout(() => { el.hidden = true; }, 3500);
  }

  function setMode(live) {
    wantsLive = !!live;
    if (window.athenaSetLiveMode) window.athenaSetLiveMode(wantsLive);
    const button = $('#liveConnectButton');
    if (button) button.textContent = wantsLive ? '◉ وضع البيانات الحقيقية' : '⌁ عرض المحاكاة';
    if (wantsLive && lastState && window.athenaSetLiveState) window.athenaSetLiveState(lastState);
    else if (!wantsLive) toast('تم تفعيل المحاكاة البصرية فقط؛ الأرقام ليست قياسات حقيقية.');
  }

  function connect() {
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
    if (!('WebSocket' in window)) return;
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(`${protocol}//${location.host}/ws/live`);
    socket.onopen = () => {
      if (wantsLive) setMode(true);
      const stateEl = $('#recordingState');
      if (stateEl) stateEl.textContent = 'الخدمة متصلة؛ في انتظار عينات CSI من القطعة';
      fetch('/api/status').then(r => r.json()).then(data => receiveState(data)).catch(() => {});
    };
    socket.onmessage = (event) => {
      try { receiveState(JSON.parse(event.data)); } catch (_) { /* ignore malformed frames */ }
    };
    socket.onerror = () => {
      const stateEl = $('#recordingState');
      if (stateEl) stateEl.textContent = 'تعذر الاتصال بالخدمة — شغّل START-ATHENA.bat';
    };
    socket.onclose = () => {
      if (wantsLive) {
        const stateEl = $('#recordingState');
        if (stateEl) stateEl.textContent = 'اتصال الخدمة منقطع؛ تجري إعادة المحاولة';
      }
      clearTimeout(retryTimer);
      retryTimer = setTimeout(connect, 2500);
    };
  }

  function receiveState(data) {
    lastState = data;
    if (wantsLive && window.athenaSetLiveState) window.athenaSetLiveState(data);
    else {
      const frames = $('#liveFrames'); if (frames) frames.textContent = String(data.frames_total ?? 0);
      const recorded = $('#recordedFrames'); if (recorded) recorded.textContent = String(data.recording_frames ?? 0);
      const modelState = $('#mlModelState'); if (modelState) modelState.textContent = data.model_loaded ? 'نموذج محمّل' : 'لا يوجد نموذج مُدرّب';
      const modelTag = $('#modelTag'); if (modelTag) modelTag.textContent = data.model_loaded ? 'MODEL LOADED' : 'MODEL NOT TRAINED';
    }
    const start = $('#startRecording'), stop = $('#stopRecording');
    currentRecording = !!data.recording;
    if (start) start.disabled = currentRecording;
    if (stop) stop.disabled = !currentRecording;
    const stateEl = $('#recordingState');
    if (stateEl) {
      if (currentRecording) stateEl.textContent = `تسجيل ${data.recording_label || ''} — ${data.recording_frames || 0} إطار`;
      else if (!data.device_seen) stateEl.textContent = 'الخدمة تعمل لكن لا تصل عينات CSI بعد';
      else if (data.last_error) stateEl.textContent = `تنبيه: ${data.last_error}`;
      else stateEl.textContent = `وصلت CSI من القطعة — ${data.frames_total || 0} إطار إجمالًا`;
    }
  }

  async function api(url, body) {
    const response = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {})
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.detail || `HTTP ${response.status}`);
    return result;
  }

  $('#liveConnectButton')?.addEventListener('click', () => {
    if (wantsLive) setMode(false);
    else {
      setMode(true);
      connect();
      if (!socket || socket.readyState !== WebSocket.OPEN) toast('جارٍ الاتصال بخدمة ATHENA RF…');
    }
  });

  $('#startRecording')?.addEventListener('click', async () => {
    const label = $('#recordLabel')?.value || 'still';
    const subject_code = ($('#subjectCode')?.value || 'P01').trim().slice(0, 24);
    const notes = ($('#recordNotes')?.value || '').trim().slice(0, 200);
    try {
      const result = await api('/api/recording/start', { label, subject_code: subject_code || 'P01', notes });
      currentRecording = true;
      $('#startRecording').disabled = true;
      $('#stopRecording').disabled = false;
      $('#recordingState').textContent = `بدأ التسجيل: ${result.session_id}`;
      toast('بدأ التسجيل. نفّذ الحركة التي اخترت وسمها ثم أوقف التسجيل.');
    } catch (error) { toast(`تعذر بدء التسجيل: ${error.message}`); }
  });

  $('#stopRecording')?.addEventListener('click', async () => {
    try {
      const result = await api('/api/recording/stop', {});
      currentRecording = false;
      $('#startRecording').disabled = false;
      $('#stopRecording').disabled = true;
      $('#recordingState').textContent = `تم حفظ ${result.frames} إطار في ${result.file}`;
      toast(`تم حفظ الجلسة (${result.frames} إطار).`);
      connect();
    } catch (error) { toast(`تعذر إيقاف التسجيل: ${error.message}`); }
  });

  $('#reloadModel')?.addEventListener('click', async () => {
    try {
      const result = await api('/api/model/reload', {});
      toast(result.loaded ? `تم تحميل النموذج: ${(result.labels || []).join('، ')}` : 'لم يتم تحميل نموذج. شغّل START-TRAIN.bat أولًا.');
      if (lastState && window.athenaSetLiveState) window.athenaSetLiveState({ ...lastState, model_loaded: !!result.loaded, model_labels: result.labels || [] });
    } catch (error) { toast(`تعذر تحميل النموذج: ${error.message}`); }
  });

  connect();
})();
