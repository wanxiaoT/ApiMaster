/* ── API Detection Module ─────────────────── */

const ApiDetect = (() => {
  let isDetectionRunning = false;
  let isScanRunning = false;
  let latestDetectExport = null;
  let activeHistoryEntryId = '';
  const DEFAULT_MODEL_ID = 'claude-opus-4-6';
  const REQUEST_TYPE_DEFAULTS = {
    anthropic: 'stream',
    openai: 'nonstream',
  };

  function init() {
    setupProviderDropdown();
    setupModelGrid();
    setupModeSelector();
    setupRequestTypeSelector();
    setupAnalysisDepthSelector();
    setupKeyToggle();
    setupDetectButton();
    setupDetectScanButton();
    setupChecklistToggle();
    setupResultToggle();
    setupResultExportButtons();
    setupHistoryClear();
    setupHistoryInteractions();
    loadSavedConfig();
    renderHistory();
    resetResultMeta();
    resetSourceAnalysisUI();
    updateResultExportButtons();
    refreshUiText();
  }

  function getUiLang() {
    return typeof AppRuntime !== 'undefined' && AppRuntime.lang === 'en' ? 'en' : 'zh';
  }

  function getActiveMode() {
    return document.querySelector('.mode-btn.active')?.dataset.mode || loadConfig('mode', 'anthropic');
  }

  function getAnalysisDepth() {
    const value = document.getElementById('detect-analysis-depth')?.value;
    if (value === 'quick' || value === 'deep') return value;
    return loadConfig('detectAnalysisDepth', 'deep') === 'quick' ? 'quick' : 'deep';
  }

  function getDefaultSourceFactLabels(mode = getActiveMode()) {
    const isEn = getUiLang() === 'en';
    if (mode === 'anthropic') {
      return {
        tool: isEn ? 'tool_use fingerprint' : 'tool_use 指纹',
        message: isEn ? 'message id fingerprint' : 'message id 指纹',
        thinking: isEn ? 'thinking fingerprint' : 'thinking 指纹',
      };
    }

    return {
      tool: isEn ? 'tools / tool_calls' : 'Tools / tool_calls',
      message: isEn ? 'headers / ratelimit' : 'Headers / ratelimit',
      thinking: isEn ? 'structured outputs' : 'Structured Outputs',
    };
  }

  function applySourceFactLabels(labels = getDefaultSourceFactLabels()) {
    const toolLabel = document.getElementById('source-tool-label');
    const msgLabel = document.getElementById('source-msg-label');
    const thinkingLabel = document.getElementById('source-thinking-label');
    if (toolLabel) toolLabel.textContent = labels.tool || '--';
    if (msgLabel) msgLabel.textContent = labels.message || '--';
    if (thinkingLabel) thinkingLabel.textContent = labels.thinking || '--';
  }

  function isBusy() {
    return isDetectionRunning || isScanRunning;
  }

  function getDetectButtonLabel(running = false) {
    return getUiLang() === 'en'
      ? (running ? 'Detecting...' : 'Start Detection')
      : (running ? '检测中...' : '开始检测');
  }

  function getScanButtonLabel(running = false) {
    return getUiLang() === 'en'
      ? (running ? 'Scanning...' : 'Scan Common Models')
      : (running ? '扫描中...' : '扫描常见模型');
  }

  function getResultExportTexts() {
    return getUiLang() === 'en'
      ? {
          copy: 'Copy Result',
          copied: 'Copied',
          save: 'Save JSON',
          saved: 'Saved',
          copyShot: 'Copy Screenshot',
          copiedShot: 'Screenshot Copied',
          saveShot: 'Save PNG',
          savedShot: 'PNG Saved',
          copyFailed: 'Unable to copy to clipboard. Please check browser permissions.',
          saveFailed: 'Unable to save the result file.',
          copyShotFailed: 'Unable to copy the screenshot to clipboard. Please check browser support and permissions.',
          saveShotFailed: 'Unable to save the screenshot file.',
          empty: 'No detection result is available yet.',
        }
      : {
          copy: '复制结果',
          copied: '已复制',
          save: '保存 JSON',
          saved: '已保存',
          copyShot: '复制截图',
          copiedShot: '截图已复制',
          saveShot: '保存截图 PNG',
          savedShot: '截图已保存',
          copyFailed: '复制到剪贴板失败，请检查浏览器权限。',
          saveFailed: '保存结果文件失败。',
          copyShotFailed: '复制截图失败，请检查浏览器支持或剪贴板权限。',
          saveShotFailed: '保存截图失败。',
          empty: '暂无可导出的检测结果。',
        };
  }

  function resolveScreenshotExportErrorText(action, error) {
    const code = String(error?.message || error || '');
    const isEn = getUiLang() === 'en';

    if (code.includes('capture_') || code.includes('canvas_context_unavailable') || code.includes('foreignObject')) {
      return isEn
        ? 'Unable to capture the current WebUI view. Please keep the result card visible and try again in a Chromium-based browser.'
        : '无法按当前 WebUI 显示效果生成截图。请保持结果卡处于可见状态，并尽量使用 Chromium 内核浏览器重试。';
    }

    if (action === 'copy') {
      if (code === 'clipboard_secure_context_required') {
        return isEn
          ? 'Image clipboard access requires HTTPS or localhost. Please use Save PNG, or open this page via HTTPS / 127.0.0.1.'
          : '当前页面不是 HTTPS 或 localhost，浏览器不允许写入图片剪贴板。请改用“保存截图 PNG”，或通过 HTTPS / 127.0.0.1 打开页面。';
      }
      if (code === 'clipboard_image_write_unavailable' || code === 'clipboard_item_unavailable') {
        return isEn
          ? 'This browser does not support copying images to the clipboard. Please use Save PNG instead.'
          : '当前浏览器不支持将图片写入剪贴板，请改用“保存截图 PNG”。';
      }
      if (code === 'clipboard_write_permission_denied') {
        return isEn
          ? 'The browser blocked image clipboard access. Please allow clipboard permissions, keep the page focused, or use Save PNG instead.'
          : '浏览器拦截了图片写入剪贴板。请允许剪贴板权限、保持页面处于焦点状态，或改用“保存截图 PNG”。';
      }
      if (code === 'clipboard_write_aborted') {
        return isEn
          ? 'Writing the image to the clipboard was interrupted. Please try again, or use Save PNG instead.'
          : '写入图片到剪贴板时被中断，请重试，或改用“保存截图 PNG”。';
      }
      if (code === 'clipboard_write_failed') {
        return isEn
          ? 'The browser failed to write the image to the clipboard. Please use Save PNG instead.'
          : '浏览器未能把图片写入剪贴板，请改用“保存截图 PNG”。';
      }
    }

    if (action === 'save' && code === 'download_blob_missing') {
      return isEn
        ? 'Unable to generate the PNG data for download.'
        : '未能生成可下载的 PNG 数据。';
    }

    const texts = getResultExportTexts();
    return action === 'copy' ? texts.copyShotFailed : texts.saveShotFailed;
  }

  function syncActionButtons() {
    const detectBtn = document.getElementById('btn-detect');
    const scanBtn = document.getElementById('btn-detect-scan');

    if (detectBtn) {
      detectBtn.disabled = isBusy();
      detectBtn.classList.toggle('running', isDetectionRunning);
    }
    if (scanBtn) {
      scanBtn.disabled = isBusy();
      scanBtn.classList.toggle('running', isScanRunning);
    }
  }

  function setScanButtonText(running = false) {
    const btnText = document.getElementById('btn-detect-scan-text');
    if (btnText) {
      btnText.textContent = getScanButtonLabel(running);
    }
  }

  function updateDetectRunNote(mode = getActiveMode(), analysisDepth = getAnalysisDepth()) {
    const note = document.getElementById('detect-run-note');
    const scanNote = document.getElementById('scan-note');
    const isEn = getUiLang() === 'en';

    if (note) {
      if (analysisDepth === 'quick') {
        note.textContent = isEn
          ? 'Quick mode only sends the primary request and returns the compatibility score immediately. Source verdicts, ratelimit checks, tools/schema probes, and GPT-5.4 profile probes are skipped.'
          : '快速模式只发送主请求并尽快返回兼容性得分；来源判定、ratelimit 验证、tools/schema 探针与 GPT-5.4 画像探针都会跳过。';
      } else {
        note.textContent = mode === 'anthropic'
          ? (isEn
            ? 'Deep Anthropic mode adds three-source verdicting, evidence review, and ratelimit dynamic verification. Common-model scans help reveal mixed upstream channels.'
            : '深度 Anthropic 模式会额外给出三源来源判定、证据面板与 ratelimit 动态验证；扫描常见模型可用于判断是否存在混合渠道。')
          : (isEn
            ? 'Deep OpenAI mode checks Chat Completions protocol compatibility first: response shape, finish_reason, stream delta, usage, tools, and structured outputs. GPT-5.4 models also get upstream-profile probes.'
            : '深度 OpenAI 模式会先检查 Chat Completions 协议兼容性：响应结构、finish_reason、stream delta、usage、tools 与 Structured Outputs；若模型是 GPT-5.4，还会追加上游画像探针。');
      }
    }

    if (scanNote) {
      if (analysisDepth === 'quick') {
        scanNote.textContent = isEn
          ? 'Multi-model scan remains a deep analysis workflow even when the single-detect panel is set to quick mode.'
          : '即使单次检测切到快速模式，多模型扫描仍然会按深度分析流程执行。';
      } else {
        scanNote.textContent = mode === 'anthropic'
          ? (isEn
            ? 'Each scanned model shows a source verdict, confidence, average latency, and ratelimit verification result.'
            : '扫描结果会按模型展示来源判定、置信度、延迟和 ratelimit 验证情况。')
          : (isEn
            ? 'OpenAI scans summarize protocol compatibility first, then add GPT-5.4 upstream-profile probes when applicable.'
            : 'OpenAI 扫描会先总结协议兼容性，再在适用时追加 GPT-5.4 上游画像探针。');
      }
    }
  }

  function refreshUiText() {
    const sourceTitle = document.getElementById('source-title');
    const evidenceTitle = document.getElementById('source-evidence-title');
    const scanTitle = document.getElementById('scan-title');

    const detectText = document.getElementById('btn-detect-text');
    if (detectText) detectText.textContent = getDetectButtonLabel(isDetectionRunning);
    setScanButtonText(isScanRunning);

    const isEn = getUiLang() === 'en';
    const mode = getActiveMode();
    if (sourceTitle) sourceTitle.textContent = mode === 'anthropic'
      ? (isEn ? 'Source Verdict' : '来源判定')
      : (isEn ? 'Upstream Profile' : '接口画像');
    if (evidenceTitle) evidenceTitle.textContent = mode === 'anthropic'
      ? (isEn ? 'Evidence Panel' : '证据面板')
      : (isEn ? 'Probe Evidence' : '接口探针');
    if (scanTitle) scanTitle.textContent = mode === 'anthropic'
      ? (isEn ? 'Multi-model Source Scan' : '多模型来源扫描')
      : (isEn ? 'Multi-model Upstream Profiles' : '多模型接口画像');

    applySourceFactLabels(getDefaultSourceFactLabels(mode));
    updateDetectRunNote(mode, getAnalysisDepth());
    updateResultExportButtonTexts();
    syncActionButtons();
    updateResultExportButtons();
  }

  /* ── Provider Dropdown ── */
  function setupProviderDropdown() {
    const input = document.getElementById('api-url');
    const dropdown = document.getElementById('provider-dropdown');

    function render(filter) {
      const filtered = PROVIDERS.filter((p) =>
        p.name.toLowerCase().includes(filter.toLowerCase()) ||
        p.url.toLowerCase().includes(filter.toLowerCase())
      );
      dropdown.innerHTML = filtered.map((p) => `
        <button class="dropdown-item" data-url="${p.url}">
          <div class="dropdown-item-name">${p.name}</div>
          <div class="dropdown-item-url">${p.url}</div>
        </button>
      `).join('');

      if (filtered.length === 0) {
        dropdown.innerHTML = '<div style="padding:12px 16px;font-size:13px;color:var(--text-muted)">未找到匹配的服务商</div>';
      }
    }

    input.addEventListener('focus', () => {
      render(input.value);
      dropdown.classList.add('show');
    });

    input.addEventListener('input', () => {
      render(input.value);
      dropdown.classList.add('show');
      saveConfig('apiUrl', input.value);
    });

    input.addEventListener('blur', () => {
      setTimeout(() => dropdown.classList.remove('show'), 200);
    });

    dropdown.addEventListener('mousedown', (e) => {
      const item = e.target.closest('.dropdown-item');
      if (item) {
        input.value = item.dataset.url;
        dropdown.classList.remove('show');
        saveConfig('apiUrl', input.value);
      }
    });
  }

  /* ── Model Grid ── */
  function setupModelGrid() {
    const grid = document.getElementById('model-grid');
    const modelInput = document.getElementById('model-id');
    const defaultSelectedIdx = Math.max(0, PRESET_MODELS.findIndex((item) => item.id === DEFAULT_MODEL_ID));
    let selectedIdx = loadConfig('selectedModel', defaultSelectedIdx);

    function render() {
      const customModels = loadConfig('customModels', []);
      const allModels = [...PRESET_MODELS, ...customModels];
      const selectedModelId = loadConfig('selectedModelId', '');

      if (selectedModelId) {
        const matchedIdx = allModels.findIndex((item) => item.id === selectedModelId);
        if (matchedIdx >= 0) {
          selectedIdx = matchedIdx;
        }
      }

      grid.innerHTML = allModels.map((m, i) => `
        <button class="model-card ${i === selectedIdx ? 'active' : ''}" data-idx="${i}" data-id="${m.id}" data-mode="${m.mode || 'openai'}">
          <div class="model-card-check">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
          <div class="model-card-name">${m.name}</div>
          <div class="model-card-id">${m.id}</div>
        </button>
      `).join('') + `
        <button class="model-card add-card" id="btn-add-model">
          <div class="add-card-icon">＋</div>
          <div class="add-card-text">自定义</div>
        </button>
      `;

      if (selectedIdx < allModels.length) {
        const savedCustomId = loadConfig('customModelId', '');
        modelInput.value = savedCustomId || allModels[selectedIdx].id;
        setMode(allModels[selectedIdx].mode || 'openai');
      }

      grid.querySelectorAll('.model-card:not(.add-card)').forEach((card) => {
        card.addEventListener('click', () => {
          selectedIdx = parseInt(card.dataset.idx, 10);
          saveConfig('selectedModel', selectedIdx);
          saveConfig('selectedModelId', card.dataset.id);
          modelInput.value = card.dataset.id;
          saveConfig('customModelId', '');
          setMode(card.dataset.mode);
          render();
        });
      });

      const addBtn = document.getElementById('btn-add-model');
      if (addBtn) {
        addBtn.addEventListener('click', () => {
          const name = prompt('模型显示名称:', '自定义模型');
          if (!name) return;
          const id = prompt('模型ID (实际发送的名称):', '');
          if (!id) return;
          const mode = prompt('格式 (openai 或 anthropic):', 'openai');
          const customs = loadConfig('customModels', []);
          customs.push({ name, id, provider: '自定义', mode: mode || 'openai' });
          saveConfig('customModels', customs);
          selectedIdx = PRESET_MODELS.length + customs.length - 1;
          saveConfig('selectedModel', selectedIdx);
          saveConfig('selectedModelId', id);
          modelInput.value = id;
          render();
        });
      }
    }

    modelInput.addEventListener('input', () => {
      saveConfig('customModelId', modelInput.value);
    });

    render();
  }

  /* ── Mode Selector ── */
  function setupModeSelector() {
    document.querySelectorAll('.mode-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        setMode(btn.dataset.mode);
      });
    });
  }

  function setupRequestTypeSelector() {
    const select = document.getElementById('detect-request-type');
    if (!select) return;

    select.addEventListener('change', () => {
      const mode = document.querySelector('.mode-btn.active')?.dataset.mode || loadConfig('mode', 'anthropic');
      const requestType = select.value === 'stream' ? 'stream' : 'nonstream';
      const requestTypeMap = loadConfig('detectRequestTypeMap', {});
      requestTypeMap[mode] = requestType;
      saveConfig('detectRequestTypeMap', requestTypeMap);
      saveConfig('detectRequestType', requestType);
    });
  }

  function setupAnalysisDepthSelector() {
    const select = document.getElementById('detect-analysis-depth');
    if (!select) return;

    select.value = loadConfig('detectAnalysisDepth', 'deep');
    select.addEventListener('change', () => {
      const analysisDepth = select.value === 'quick' ? 'quick' : 'deep';
      saveConfig('detectAnalysisDepth', analysisDepth);
      updateDetectRunNote(getActiveMode(), analysisDepth);
    });
  }

  function setMode(mode) {
    document.querySelectorAll('.mode-btn').forEach((b) => b.classList.remove('active'));
    const target = document.querySelector(`.mode-btn[data-mode="${mode}"]`);
    if (target) target.classList.add('active');

    const thinkingWrap = document.getElementById('thinking-toggle-wrap');
    if (thinkingWrap) {
      thinkingWrap.style.display = mode === 'anthropic' ? 'block' : 'none';
    }

    saveConfig('mode', mode);
    syncRequestTypeByMode(mode);
    refreshUiText();
    resetSourceAnalysisUI();
  }

  function getRequestTypeForMode(mode) {
    const requestTypeMap = loadConfig('detectRequestTypeMap', {});
    return requestTypeMap?.[mode] || REQUEST_TYPE_DEFAULTS[mode] || 'nonstream';
  }

  function syncRequestTypeByMode(mode) {
    const select = document.getElementById('detect-request-type');
    if (!select) return;
    const requestType = getRequestTypeForMode(mode);
    select.value = requestType;
    saveConfig('detectRequestType', requestType);
  }

  /* ── Key Toggle ── */
  function setupKeyToggle() {
    const input = document.getElementById('api-key');
    const toggleBtn = document.getElementById('btn-toggle-key');
    const clearBtn = document.getElementById('btn-clear-key');

    toggleBtn.addEventListener('click', () => {
      input.type = input.type === 'password' ? 'text' : 'password';
    });

    clearBtn.addEventListener('click', () => {
      input.value = '';
      saveVolatileConfig('apiKey', '');
      removeConfig('apiKey');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    input.addEventListener('input', () => {
      saveVolatileConfig('apiKey', input.value);
    });
  }

  /* ── Detect Button ── */
  function setupDetectButton() {
    const btn = document.getElementById('btn-detect');
    btn.addEventListener('click', () => {
      if (isBusy()) return;
      runDetection();
    });
  }

  function setupDetectScanButton() {
    const btn = document.getElementById('btn-detect-scan');
    if (!btn) return;

    btn.addEventListener('click', () => {
      if (isBusy()) return;
      runDetectScan();
    });
  }

  function setupResultExportButtons() {
    const copyBtn = document.getElementById('btn-copy-detect-result');
    const saveBtn = document.getElementById('btn-save-detect-result');
    const copyShotBtn = document.getElementById('btn-copy-detect-shot');
    const saveShotBtn = document.getElementById('btn-save-detect-shot');

    if (copyBtn) {
      copyBtn.addEventListener('click', async () => {
        if (!latestDetectExport) {
          alert(getResultExportTexts().empty);
          return;
        }

        try {
          await copyTextToClipboard(buildDetectExportReport());
          flashResultExportButton(copyBtn, getResultExportTexts().copied);
        } catch (error) {
          console.warn('Copy detect result failed:', error);
          alert(getResultExportTexts().copyFailed);
        }
      });
    }

    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        if (!latestDetectExport) {
          alert(getResultExportTexts().empty);
          return;
        }

        try {
          const payload = buildDetectExportPayload();
          const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
          downloadBlobFile(blob, buildDetectExportFilename('result', 'json'));
          flashResultExportButton(saveBtn, getResultExportTexts().saved);
        } catch (error) {
          console.warn('Save detect result failed:', error);
          alert(getResultExportTexts().saveFailed);
        }
      });
    }

    if (copyShotBtn) {
      copyShotBtn.addEventListener('click', async () => {
        if (!latestDetectExport) {
          alert(getResultExportTexts().empty);
          return;
        }

        try {
          const blob = await buildDetectScreenshotBlob();
          await copyImageBlobToClipboard(blob);
          flashResultExportButton(copyShotBtn, getResultExportTexts().copiedShot);
        } catch (error) {
          console.warn('Copy detect screenshot failed:', error);
          alert(resolveScreenshotExportErrorText('copy', error));
        }
      });
    }

    if (saveShotBtn) {
      saveShotBtn.addEventListener('click', async () => {
        if (!latestDetectExport) {
          alert(getResultExportTexts().empty);
          return;
        }

        try {
          const blob = await buildDetectScreenshotBlob();
          downloadBlobFile(blob, buildDetectExportFilename('screenshot', 'png'));
          flashResultExportButton(saveShotBtn, getResultExportTexts().savedShot);
        } catch (error) {
          console.warn('Save detect screenshot failed:', error);
          alert(resolveScreenshotExportErrorText('save', error));
        }
      });
    }

    updateResultExportButtonTexts();
  }

  function setupChecklistToggle() {
    const list = document.getElementById('check-list');
    if (!list || list.dataset.toggleBound === 'true') return;

    list.dataset.toggleBound = 'true';
    list.addEventListener('click', (event) => {
      const btn = event.target.closest('.check-toggle-btn');
      if (!btn) return;

      const entry = btn.closest('.check-entry');
      const detail = entry?.querySelector('.check-detail');
      if (!entry || !detail) return;

      const expanded = btn.getAttribute('aria-expanded') === 'true';
      const shouldExpand = !expanded;

      list.querySelectorAll('.check-entry.expanded').forEach((openedEntry) => {
        if (openedEntry === entry) return;
        openedEntry.classList.remove('expanded');
        openedEntry.querySelector('.check-detail')?.classList.add('hidden');
        const openedBtn = openedEntry.querySelector('.check-toggle-btn');
        if (openedBtn) {
          openedBtn.setAttribute('aria-expanded', 'false');
          openedBtn.title = getChecklistToggleTexts().expand;
        }
      });

      btn.setAttribute('aria-expanded', String(shouldExpand));
      entry.classList.toggle('expanded', shouldExpand);
      detail.classList.toggle('hidden', !shouldExpand);
      btn.title = shouldExpand ? getChecklistToggleTexts().collapse : getChecklistToggleTexts().expand;
    });
  }

  async function runDetection() {
    const apiUrl = document.getElementById('api-url').value.trim();
    const apiKey = document.getElementById('api-key').value.trim();
    const modelId = document.getElementById('model-id').value.trim();
    const mode = document.querySelector('.mode-btn.active')?.dataset.mode || 'anthropic';
    const requestType = document.getElementById('detect-request-type')?.value === 'stream' ? 'stream' : 'nonstream';
    const analysisDepth = getAnalysisDepth();
    const withThinking = document.getElementById('with-thinking')?.checked ?? true;

    if (!apiUrl) {
      alert('请输入 API 接口地址');
      return;
    }
    if (!apiKey) {
      alert('请输入 API Key');
      return;
    }
    if (!modelId) {
      alert('请输入模型名');
      return;
    }

    isDetectionRunning = true;
    const btn = document.getElementById('btn-detect');
    const btnText = document.getElementById('btn-detect-text');
    syncActionButtons();
    btnText.textContent = getDetectButtonLabel(true);
    btn.querySelector('svg')?.replaceWith(createSpinner());

    const resultSection = document.getElementById('result-section');
    resultSection.classList.remove('hidden');
    latestDetectExport = null;
    resetResultUI();
    updateResultExportButtons();
    if (requestType === 'stream') {
      showLivePreviewState();
    }
    updateResultMeta({
      statusText: '检测中',
      modelId,
      apiUrl,
      summaryCopy: requestType === 'stream'
        ? '正在建立流式检测连接，响应内容会实时显示在下方预览区。'
        : '正在发送请求并解析返回结构，请稍候。'
    });
    dispatchAppEvent('apimaster:detect-status', {
      state: 'running',
      statusText: '检测中',
      modelId,
      endpoint: extractHostname(apiUrl)
    });

    try {
      const payload = { apiUrl, apiKey, modelId, mode, withThinking, requestType, analysisDepth };
      const data = requestType === 'stream'
        ? await requestStreamingDetection(payload)
        : await requestDetection(payload);

      if (!data.ok) {
        showError(data.error || '检测失败', { modelId, apiUrl, mode, requestType, analysisDepth });
        return;
      }

      handleDetectionSuccess(data, { modelId, apiUrl, mode, requestType, analysisDepth });
    } catch (err) {
      showError(err.message, { modelId, apiUrl, mode, requestType, analysisDepth });
    } finally {
      isDetectionRunning = false;
      syncActionButtons();
      updateResultExportButtons();
      btnText.textContent = getDetectButtonLabel(false);
      restoreDetectButtonIcon();
    }
  }

  async function requestDetection(payload) {
    const resp = await fetch('/__detect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return resp.json();
  }

  async function requestStreamingDetection(payload) {
    const resp = await fetch('/__detect-live', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }
    if (!resp.body) {
      throw new Error('浏览器未返回可读取的流');
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finalData = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        let message;
        try {
          message = JSON.parse(trimmed);
        } catch {
          continue;
        }

        if (message.type === 'preview') {
          appendLivePreview(message.delta || message.text || '');
        } else if (message.type === 'status' && message.summaryCopy) {
          updateResultMeta({
            statusText: '检测中',
            modelId: payload.modelId,
            apiUrl: payload.apiUrl,
            summaryCopy: message.summaryCopy,
          });
        } else if (message.type === 'error') {
          throw new Error(message.error || '检测失败');
        } else if (message.type === 'final') {
          finalData = message.data || null;
        }
      }
    }

    const tail = decoder.decode();
    if (tail) {
      buffer += tail;
    }

    if (buffer.trim()) {
      try {
        const message = JSON.parse(buffer.trim());
        if (message.type === 'preview') {
          appendLivePreview(message.delta || message.text || '');
        } else if (message.type === 'error') {
          throw new Error(message.error || '检测失败');
        } else if (message.type === 'final') {
          finalData = message.data || null;
        }
      } catch {
        // ignore malformed trailing data
      }
    }

    if (!finalData) {
      throw new Error('流式检测未返回最终结果');
    }
    return finalData;
  }

  async function requestDetectScan(payload) {
    const resp = await fetch('/__detect-scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return resp.json();
  }

  function collectScanModelIds(mode) {
    const presetIds = PRESET_MODELS
      .filter((item) => (item.mode || 'openai') === mode)
      .map((item) => String(item.id || '').trim())
      .filter(Boolean);

    const customIds = loadConfig('customModels', [])
      .filter((item) => String(item?.mode || 'openai') === mode)
      .map((item) => String(item?.id || '').trim())
      .filter(Boolean);

    const manualId = document.getElementById('model-id')?.value?.trim() || '';

    return [...new Set([...presetIds, ...customIds, manualId].filter(Boolean))];
  }

  async function runDetectScan() {
    const apiUrl = document.getElementById('api-url').value.trim();
    const apiKey = document.getElementById('api-key').value.trim();
    const mode = getActiveMode();
    const requestType = document.getElementById('detect-request-type')?.value === 'stream' ? 'stream' : 'nonstream';
    const modelIds = collectScanModelIds(mode);

    if (!apiUrl) {
      alert(getUiLang() === 'en' ? 'Please enter the API endpoint' : '请输入 API 接口地址');
      return;
    }
    if (!apiKey) {
      alert(getUiLang() === 'en' ? 'Please enter the API key' : '请输入 API Key');
      return;
    }
    if (modelIds.length === 0) {
      alert(getUiLang() === 'en' ? 'No model is available for scanning' : '当前没有可用于扫描的模型');
      return;
    }

    const section = document.getElementById('scan-section');
    const summary = document.getElementById('scan-summary-copy');
    const tbody = document.getElementById('scan-results-tbody');

    isScanRunning = true;
    syncActionButtons();
    setScanButtonText(true);

    if (section) section.classList.remove('hidden');
    if (summary) {
      summary.textContent = getUiLang() === 'en'
        ? `Scanning ${modelIds.length} models to compare source fingerprints and ratelimit behavior...`
        : `正在扫描 ${modelIds.length} 个模型，用于比对来源指纹与 ratelimit 行为...`;
    }
    if (tbody) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6">${getUiLang() === 'en' ? 'Scanning in progress...' : '扫描进行中，请稍候...'}</td>
        </tr>
      `;
    }

    try {
      const data = await requestDetectScan({
        apiUrl,
        apiKey,
        mode,
        requestType,
        modelIds,
      });

      if (!data.ok) {
        throw new Error(data.error || 'scan_failed');
      }

      renderScanResults(data);
    } catch (error) {
      renderScanResults({
        ok: false,
        models: [],
        summaryText: `${getUiLang() === 'en' ? 'Scan failed:' : '扫描失败：'} ${error.message}`,
      });
    } finally {
      isScanRunning = false;
      syncActionButtons();
      setScanButtonText(false);
    }
  }

  function handleDetectionSuccess(data, context) {
    animateScore(data.score);
    renderChecklist(data.breakdown, context.mode, data.sourceAnalysis || null);
    renderMetrics(data);
    renderSourceAnalysis(data.sourceAnalysis || null);
    document.getElementById('response-content').textContent = data.responseText || '';
    const sourceLabel = data.sourceAnalysis?.verdictLabel
      ? `${getUiLang() === 'en' ? (context.mode === 'anthropic' ? 'Source' : 'Profile') : (context.mode === 'anthropic' ? '来源判定' : '接口画像')} ${data.sourceAnalysis.verdictLabel}`
      : '';
    updateResultMeta({
      statusText: scoreLabel(data.score),
      modelId: context.modelId,
      apiUrl: context.apiUrl,
      summaryCopy: `${getUiLang() === 'en' ? 'Overall score' : '综合得分'} ${data.score}% · ${context.mode === 'anthropic' ? 'Anthropic' : 'OpenAI'} ${getUiLang() === 'en' ? 'format' : '格式'} · ${context.requestType === 'stream' ? (getUiLang() === 'en' ? 'stream request' : '流式调用') : (getUiLang() === 'en' ? 'non-stream request' : '非流式调用')} · ${context.analysisDepth === 'quick' ? (getUiLang() === 'en' ? 'quick mode' : '快速模式') : (getUiLang() === 'en' ? 'deep mode' : '深度模式')}${sourceLabel ? ` · ${sourceLabel}` : ''} · ${getUiLang() === 'en' ? 'Review the checklist, source evidence, and metrics together.' : '建议结合检查项、来源证据与性能指标一起复核。'}`
    });
    latestDetectExport = {
      ok: true,
      exportedAt: new Date().toISOString(),
      context: {
        modelId: context.modelId,
        apiUrl: context.apiUrl,
        endpoint: extractHostname(context.apiUrl),
        mode: context.mode,
        requestType: context.requestType,
        analysisDepth: context.analysisDepth || 'deep',
      },
      data,
    };
    updateResultExportButtons();

    try {
      addHistory(buildHistoryEntryFromCurrentResult());
    } catch (e) {
      console.warn('History save error:', e);
    }

    dispatchAppEvent('apimaster:detect-status', {
      state: 'completed',
      statusText: `完成 · ${data.score}%`,
      score: data.score,
      modelId: context.modelId,
      endpoint: extractHostname(context.apiUrl)
    });
  }

  function showLivePreviewState() {
    setResponsePreviewVisible(true);
    const content = document.getElementById('response-content');
    if (content) {
      content.textContent = '';
    }
  }

  function setResponsePreviewVisible(visible) {
    const content = document.getElementById('response-content');
    const toggleText = document.getElementById('toggle-response-text');
    if (!content || !toggleText) return;

    content.classList.toggle('hidden', !visible);
    toggleText.textContent = visible ? '隐藏响应内容' : '显示响应内容';
  }

  function appendLivePreview(chunk) {
    if (!chunk) return;

    const content = document.getElementById('response-content');
    if (!content) return;

    content.textContent += chunk;
    content.scrollTop = content.scrollHeight;
  }

  function createSpinner() {
    const el = document.createElement('div');
    el.className = 'spinner';
    return el;
  }

  function restoreDetectButtonIcon() {
    const btn = document.getElementById('btn-detect');
    const spinner = btn?.querySelector('.spinner');
    if (!spinner) return;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '18');
    svg.setAttribute('height', '18');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.innerHTML = '<polygon points="5 3 19 12 5 21 5 3"/>';
    spinner.replaceWith(svg);
  }

  function resetResultMeta() {
    updateResultMeta({
      statusText: '等待检测',
      modelId: '--',
      apiUrl: '--',
      summaryCopy: '系统将根据响应结构、finish_reason、stream / usage、tools、Structured Outputs 与可用画像证据生成综合判断。快速模式下会跳过深度来源分析。'
    });
  }

  function updateResultMeta({ statusText, modelId, apiUrl, summaryCopy }) {
    const statusEl = document.getElementById('result-status-text');
    const modelEl = document.getElementById('result-model-text');
    const endpointEl = document.getElementById('result-endpoint-text');
    const summaryEl = document.getElementById('result-summary-copy');
    const inlineStatusEl = document.getElementById('result-status-inline');
    const inlineModelEl = document.getElementById('result-model-inline');
    const inlineEndpointEl = document.getElementById('result-endpoint-inline');
    const endpointValue = apiUrl === '--' ? '--' : extractHostname(apiUrl || '--');

    if (statusEl) statusEl.textContent = statusText || '--';
    if (modelEl) modelEl.textContent = modelId || '--';
    if (endpointEl) endpointEl.textContent = endpointValue;
    if (summaryEl) summaryEl.textContent = summaryCopy || '';
    if (inlineStatusEl) inlineStatusEl.textContent = statusText || '--';
    if (inlineModelEl) inlineModelEl.textContent = modelId || '--';
    if (inlineEndpointEl) inlineEndpointEl.textContent = endpointValue;
  }

  function updateResultExportButtons() {
    const disabled = !latestDetectExport || isDetectionRunning;
    const copyBtn = document.getElementById('btn-copy-detect-result');
    const saveBtn = document.getElementById('btn-save-detect-result');
    const copyShotBtn = document.getElementById('btn-copy-detect-shot');
    const saveShotBtn = document.getElementById('btn-save-detect-shot');
    if (copyBtn) copyBtn.disabled = disabled;
    if (saveBtn) saveBtn.disabled = disabled;
    if (copyShotBtn) copyShotBtn.disabled = disabled;
    if (saveShotBtn) saveShotBtn.disabled = disabled;
  }

  function updateResultExportButtonTexts() {
    const texts = getResultExportTexts();
    const copyBtn = document.getElementById('btn-copy-detect-result');
    const saveBtn = document.getElementById('btn-save-detect-result');
    const copyShotBtn = document.getElementById('btn-copy-detect-shot');
    const saveShotBtn = document.getElementById('btn-save-detect-shot');
    if (copyBtn && !copyBtn.dataset.flashActive) {
      copyBtn.textContent = texts.copy;
    }
    if (saveBtn && !saveBtn.dataset.flashActive) {
      saveBtn.textContent = texts.save;
    }
    if (copyShotBtn && !copyShotBtn.dataset.flashActive) {
      copyShotBtn.textContent = texts.copyShot;
    }
    if (saveShotBtn && !saveShotBtn.dataset.flashActive) {
      saveShotBtn.textContent = texts.saveShot;
    }
  }

  function flashResultExportButton(button, text) {
    if (!button) return;

    const exportTexts = getResultExportTexts();
    const restoreTextMap = {
      'btn-copy-detect-result': exportTexts.copy,
      'btn-save-detect-result': exportTexts.save,
      'btn-copy-detect-shot': exportTexts.copyShot,
      'btn-save-detect-shot': exportTexts.saveShot,
    };
    const restoreText = restoreTextMap[button.id] || exportTexts.copy;

    button.dataset.flashActive = 'true';
    button.textContent = text;
    window.setTimeout(() => {
      delete button.dataset.flashActive;
      button.textContent = restoreText;
    }, 1400);
  }

  function getDetectExportText(id, fallback = '--') {
    const value = document.getElementById(id)?.textContent?.trim() || '';
    return value || fallback;
  }

  function buildChecklistItemsFromBreakdown(breakdown) {
    const items = [];

    if (Array.isArray(breakdown?.items) && breakdown.items.length > 0) {
      breakdown.items.forEach((item) => {
        items.push({
          name: item.name || '--',
          status: item.status || 'warning',
          detail: item.detail || `${item.score ?? 0}/${item.max ?? 0}`,
          notes: Array.isArray(item.notes) ? item.notes : (item.notes ? [item.notes] : []),
        });
      });
      return items;
    }

    if (!breakdown || typeof breakdown !== 'object') {
      return items;
    }

    const k = breakdown.knowledge;
    if (k) {
      items.push({
        name: '知识截止时间',
        status: k.score >= 40 ? 'pass' : k.score >= 20 ? 'warning' : 'fail',
        detail: `${k.score}/${k.max}`,
        notes: Array.isArray(k.notes) ? k.notes : (k.notes ? [k.notes] : []),
      });
    }

    const s = breakdown.sse;
    if (s) {
      items.push({
        name: 'SSE 事件格式',
        status: s.score >= 16 ? 'pass' : s.score >= 8 ? 'warning' : 'fail',
        detail: `${s.score}/${s.max}`,
        notes: Array.isArray(s.notes) ? s.notes : (s.notes ? [s.notes] : []),
      });
    }

    const t = breakdown.thinking;
    if (t) {
      items.push({
        name: 'Thinking Block',
        status: t.score >= 15 ? 'pass' : t.score >= 5 ? 'warning' : 'fail',
        detail: `${t.score}/${t.max}`,
        notes: Array.isArray(t.notes) ? t.notes : (t.notes ? [t.notes] : []),
      });
    }

    const u = breakdown.usage;
    if (u) {
      items.push({
        name: 'Usage 字段',
        status: u.score >= 8 ? 'pass' : u.score >= 4 ? 'warning' : 'fail',
        detail: `${u.score}/${u.max}`,
        notes: Array.isArray(u.notes) ? u.notes : (u.notes ? [u.notes] : []),
      });
    }

    if (breakdown.penalty && breakdown.penalty.score > 0) {
      items.push({
        name: '惩罚项',
        status: 'fail',
        detail: `-${breakdown.penalty.score}`,
        notes: Array.isArray(breakdown.penalty.notes) ? breakdown.penalty.notes : (breakdown.penalty.notes ? [breakdown.penalty.notes] : []),
      });
    }

    return items;
  }

  function getChecklistSnapshot() {
    return [...document.querySelectorAll('#check-list .check-item')].map((item) => {
      const badge = item.querySelector('.check-badge');
      const status = badge?.classList.contains('pass')
        ? 'pass'
        : badge?.classList.contains('fail')
          ? 'fail'
          : 'warning';
      return {
        name: item.querySelector('.check-item-name')?.textContent?.trim() || '--',
        detail: badge?.textContent?.trim() || '--',
        status,
        notes: [],
      };
    });
  }

  function getMetricSnapshot() {
    return [...document.querySelectorAll('#metrics .metric-item')].map((item) => ({
      label: item.querySelector('.metric-label')?.textContent?.trim() || '--',
      value: item.querySelector('.metric-value')?.textContent?.trim() || '--',
    }));
  }

  function getEvidenceSnapshot() {
    const evidenceItems = [...document.querySelectorAll('#source-evidence-list .evidence-item')];
    if (evidenceItems.length > 0) {
      return evidenceItems
        .map((item) => item.textContent?.trim() || '')
        .filter(Boolean);
    }

    const placeholder = document.querySelector('#source-evidence-list .history-empty')?.textContent?.trim() || '';
    return placeholder ? [placeholder] : [];
  }

  function buildDetectExportSnapshot() {
    const sourceAnalysis = latestDetectExport?.data?.sourceAnalysis || null;
    const detailedChecklist = buildChecklistItemsFromBreakdown(latestDetectExport?.data?.breakdown);
    const sourceBadge = document.getElementById('source-verdict-badge');
    const numericScore = typeof latestDetectExport?.data?.score === 'number'
      ? Math.max(0, Math.min(100, latestDetectExport.data.score))
      : null;
    return {
      exportedAt: new Date().toISOString(),
      ok: latestDetectExport?.ok ?? false,
      status: getDetectExportText('result-status-text'),
      score: numericScore !== null ? `${numericScore}%` : getDetectExportText('score-text', '0%'),
      scoreLabel: numericScore !== null ? scoreLabel(numericScore) : getDetectExportText('score-label'),
      model: getDetectExportText('result-model-text'),
      endpoint: getDetectExportText('result-endpoint-text'),
      summary: getDetectExportText('result-summary-copy', ''),
      detectContext: latestDetectExport?.context || null,
      source: {
        verdict: getDetectExportText('source-verdict-badge'),
        verdictKey: sourceAnalysis?.verdict || [...(sourceBadge?.classList || [])].find((className) => className !== 'source-badge') || 'unknown',
        confidence: getDetectExportText('source-confidence-text'),
        platform: getDetectExportText('source-platform-text'),
        ratelimit: getDetectExportText('source-ratelimit-text'),
        toolFingerprint: getDetectExportText('source-tool-text'),
        messageFingerprint: getDetectExportText('source-msg-text'),
        thinkingFingerprint: getDetectExportText('source-thinking-text'),
        factLabels: sourceAnalysis?.factLabels || null,
      },
      checklist: detailedChecklist.length > 0 ? detailedChecklist : getChecklistSnapshot(),
      metrics: getMetricSnapshot(),
      evidence: getEvidenceSnapshot(),
      responseText: document.getElementById('response-content')?.textContent || '',
      responseVisible: !document.getElementById('response-content')?.classList.contains('hidden'),
      error: latestDetectExport?.error || '',
    };
  }

  function buildDetectExportPayload() {
    const snapshot = buildDetectExportSnapshot();
    return {
      app: 'ApiMaster',
      type: 'detect-result',
      ...snapshot,
      raw: latestDetectExport?.data || null,
    };
  }

  function buildDetectExportReport() {
    const snapshot = buildDetectExportSnapshot();
    const context = snapshot.detectContext || {};
    const lines = [
      'ApiMaster 检测结果 / Detection Result',
      `导出时间 / Exported At: ${snapshot.exportedAt}`,
      `状态 / Status: ${snapshot.status}`,
      `得分 / Score: ${snapshot.score} · ${snapshot.scoreLabel}`,
      `模型 / Model: ${snapshot.model}`,
      `接口 / Endpoint: ${snapshot.endpoint}`,
      `模式 / Mode: ${context.mode || '--'}`,
      `调用方式 / Request Type: ${context.requestType || '--'}`,
      `检测深度 / Analysis Depth: ${context.analysisDepth || '--'}`,
      `摘要 / Summary: ${snapshot.summary || '--'}`,
      '',
      '来源判定 / Source',
      `- Verdict: ${snapshot.source.verdict}`,
      `- Confidence: ${snapshot.source.confidence}`,
      `- Platform: ${snapshot.source.platform}`,
      `- Ratelimit: ${snapshot.source.ratelimit}`,
      `- Tool Fingerprint: ${snapshot.source.toolFingerprint}`,
      `- Message Fingerprint: ${snapshot.source.messageFingerprint}`,
      `- Thinking Fingerprint: ${snapshot.source.thinkingFingerprint}`,
      '',
      '检查项 / Checklist',
    ];

    if (snapshot.checklist.length > 0) {
      snapshot.checklist.forEach((item) => {
        lines.push(`- [${item.status}] ${item.name}: ${item.detail}`);
      });
    } else {
      lines.push('- --');
    }

    lines.push('', '性能指标 / Metrics');
    if (snapshot.metrics.length > 0) {
      snapshot.metrics.forEach((item) => {
        lines.push(`- ${item.label}: ${item.value}`);
      });
    } else {
      lines.push('- --');
    }

    lines.push('', '证据 / Evidence');
    if (snapshot.evidence.length > 0) {
      snapshot.evidence.forEach((item) => {
        lines.push(`- ${item}`);
      });
    } else {
      lines.push('- --');
    }

    if (snapshot.error) {
      lines.push('', `错误 / Error: ${snapshot.error}`);
    }

    lines.push('', '原始响应 / Raw Response', snapshot.responseText || '--');
    return lines.join('\n');
  }

  async function buildDetectScreenshotBlob() {
    const section = document.getElementById('result-section');
    if (!section) {
      throw new Error('result_section_not_found');
    }

    return await renderNodeToPngBlob(section, {
      scale: 2,
      backgroundColor: '#ffffff',
    });
  }

  function buildDetectExportFilename(suffix, extension) {
    const modelPart = slugifyFilename(latestDetectExport?.context?.modelId || 'detect');
    const timePart = formatExportTimestamp(new Date());
    return `apimaster-${modelPart}-${suffix}-${timePart}.${extension}`;
  }

  function getChecklistToggleTexts() {
    return getUiLang() === 'en'
      ? {
          expand: 'Expand issue details',
          collapse: 'Collapse issue details',
          noIssue: 'No issues',
          notes: 'Rule Notes',
          evidence: 'Evidence',
        }
      : {
          expand: '展开问题详情',
          collapse: '收起问题详情',
          noIssue: '无问题',
          notes: '判定说明',
          evidence: '证据面板',
        };
  }

  function uniqueStringList(values = []) {
    const seen = new Set();
    const result = [];
    values.forEach((value) => {
      const text = String(value || '').trim();
      if (!text) return;
      const key = text.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      result.push(text);
    });
    return result;
  }

  function normalizeChecklistName(name) {
    return String(name || '').trim().toLowerCase();
  }

  function getChecklistEvidenceKeywords(name) {
    const normalized = normalizeChecklistName(name);
    const keywordSet = new Set();

    const add = (...items) => items.forEach((item) => keywordSet.add(String(item).toLowerCase()));

    if (/知识|cutoff|knowledge|snapshot|日期|date/.test(normalized)) {
      add('knowledge', 'cutoff', 'snapshot', 'date', 'dated', 'knowledge cutoff', '知识', '截止');
    }
    if (/sse|stream|事件|delta|响应|response|shape|finish_reason/.test(normalized)) {
      add('sse', 'stream', 'delta', 'event', 'finish_reason', 'response shape', 'object', 'choices', 'message');
    }
    if (/thinking|reasoning|推理/.test(normalized)) {
      add('thinking', 'reasoning');
    }
    if (/usage|token|tokens/.test(normalized)) {
      add('usage', 'token', 'tokens', 'prompt_tokens', 'completion_tokens', 'input_tokens', 'output_tokens');
    }
    if (/tool|tools|工具/.test(normalized)) {
      add('tool', 'tools', 'tool_calls', 'tool_use');
    }
    if (/header|ratelimit/.test(normalized)) {
      add('header', 'headers', 'ratelimit');
    }
    if (/structured/.test(normalized)) {
      add('structured', 'json schema', 'response_format');
    }
    if (/penalty|惩罚/.test(normalized)) {
      add('negative', 'unsupported', 'mismatch', 'missing');
    }

    return [...keywordSet];
  }

  function matchEvidenceForChecklistItem(name, evidence = []) {
    const keywords = getChecklistEvidenceKeywords(name);
    if (!Array.isArray(evidence) || evidence.length === 0 || keywords.length === 0) {
      return [];
    }

    return uniqueStringList(
      evidence.filter((item) => {
        const text = String(item || '').toLowerCase();
        return keywords.some((keyword) => text.includes(keyword));
      })
    );
  }

  function buildChecklistIssueDetails(item, sourceAnalysis) {
    const detailTexts = getChecklistToggleTexts();
    const notes = uniqueStringList(Array.isArray(item?.notes) ? item.notes : (item?.notes ? [item.notes] : []));
    const evidence = matchEvidenceForChecklistItem(item?.name, sourceAnalysis?.evidence || []);
    const details = [];

    if (item?.status !== 'pass') {
      notes.forEach((text) => {
        details.push({ tag: detailTexts.notes, text });
      });
      evidence.forEach((text) => {
        details.push({ tag: detailTexts.evidence, text });
      });
    }

    return details;
  }

  function sourceBadgeClass(verdict) {
    if (
      verdict === 'anthropic'
      || verdict === 'bedrock'
      || verdict === 'vertex'
      || verdict === 'suspicious'
      || verdict === 'authentic'
      || verdict === 'likely'
      || verdict === 'mismatch'
      || verdict === 'unsupported'
    ) {
      return verdict;
    }
    if (verdict === 'dynamic' || verdict === 'static' || verdict === 'unavailable') {
      return verdict;
    }
    return 'unknown';
  }

  function truncateText(value, max = 36) {
    const text = String(value || '').trim();
    if (!text) return '';
    return text.length > max ? `${text.slice(0, max)}…` : text;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function validFingerprints(sourceAnalysis) {
    return Array.isArray(sourceAnalysis?.fingerprints)
      ? sourceAnalysis.fingerprints.filter((item) => item && !item.error)
      : [];
  }

  function pickFingerprint(fingerprints, predicate) {
    return fingerprints.find(predicate) || fingerprints[0] || null;
  }

  function fingerprintSourceLabel(source) {
    const map = {
      anthropic: 'anthropic',
      bedrock: 'bedrock',
      vertex: 'vertex',
      antigravity: 'vertex-like',
      kiro: 'kiro',
      rewritten: 'rewritten',
      unknown: 'unknown',
    };
    return map[source] || 'unknown';
  }

  function formatToolFingerprint(fingerprint) {
    if (!fingerprint) return '--';
    const format = fingerprint.toolIdFormat || truncateText(fingerprint.toolId, 18) || 'none';
    return `${format} · ${fingerprintSourceLabel(fingerprint.toolIdSource)}`;
  }

  function formatMessageFingerprint(fingerprint) {
    if (!fingerprint) return '--';
    const format = fingerprint.messageIdFormat || truncateText(fingerprint.messageId, 18) || 'none';
    return `${format} · ${fingerprintSourceLabel(fingerprint.messageIdSource)}`;
  }

  function formatThinkingFingerprint(fingerprint) {
    if (!fingerprint) return '--';
    const kind = fingerprint.thinkingSignatureClass || 'none';
    const length = Number.isFinite(fingerprint.thinkingSignatureLength) ? fingerprint.thinkingSignatureLength : 0;
    return `${kind} · len ${length}`;
  }

  function formatConfidence(value) {
    if (typeof value !== 'number' || Number.isNaN(value) || value <= 0) return '--';
    const normalized = value > 1 ? value : value * 100;
    return `${Math.round(normalized)}%`;
  }

  function averageLatencyFromFingerprints(fingerprints) {
    const values = (Array.isArray(fingerprints) ? fingerprints : [])
      .map((item) => item?.latencyMs)
      .filter((value) => typeof value === 'number' && Number.isFinite(value) && value > 0);

    if (values.length === 0) return '--';
    const avg = Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
    return `${avg}ms`;
  }

  function renderEvidenceList(evidence = []) {
    const list = document.getElementById('source-evidence-list');
    if (!list) return;

    if (!Array.isArray(evidence) || evidence.length === 0) {
      list.innerHTML = `<div class="history-empty">${getUiLang() === 'en' ? 'No source evidence yet' : '暂无来源证据'}</div>`;
      return;
    }

    list.innerHTML = evidence.map((item) => `
      <div class="evidence-item">${escapeHtml(item)}</div>
    `).join('');
  }

  function resetSourceAnalysisUI() {
    const mode = getActiveMode();
    const badge = document.getElementById('source-verdict-badge');
    const confidence = document.getElementById('source-confidence-text');
    const platform = document.getElementById('source-platform-text');
    const ratelimit = document.getElementById('source-ratelimit-text');
    const toolText = document.getElementById('source-tool-text');
    const msgText = document.getElementById('source-msg-text');
    const thinkingText = document.getElementById('source-thinking-text');
    applySourceFactLabels(getDefaultSourceFactLabels(mode));

    if (badge) {
      badge.className = 'source-badge unknown';
      badge.textContent = getUiLang() === 'en' ? 'Pending' : '待检测';
    }
    if (confidence) confidence.textContent = '--';
    if (platform) platform.textContent = '--';
    if (ratelimit) {
      ratelimit.textContent = '--';
      ratelimit.title = '';
    }
    if (toolText) toolText.textContent = '--';
    if (msgText) msgText.textContent = '--';
    if (thinkingText) thinkingText.textContent = '--';
    if (toolText) toolText.title = '';
    if (msgText) msgText.title = '';
    if (thinkingText) thinkingText.title = '';

    const placeholder = mode === 'anthropic'
      ? (getUiLang() === 'en' ? 'Source evidence will appear after detection' : '检测完成后展示来源证据')
      : (getUiLang() === 'en'
        ? 'OpenAI mode will first show protocol evidence (tools / headers / structured outputs). GPT-5.4 models also add alias / snapshot / reasoning probes.'
        : 'OpenAI 模式下会优先展示协议证据（tools / headers / Structured Outputs）；若模型为 GPT-5.4，还会追加 alias / snapshot / reasoning 探针。');
    renderEvidenceList([placeholder]);
  }

  function renderSourceAnalysis(sourceAnalysis) {
    if (!sourceAnalysis) {
      resetSourceAnalysisUI();
      return;
    }

    const badge = document.getElementById('source-verdict-badge');
    const confidence = document.getElementById('source-confidence-text');
    const platform = document.getElementById('source-platform-text');
    const ratelimit = document.getElementById('source-ratelimit-text');
    const toolText = document.getElementById('source-tool-text');
    const msgText = document.getElementById('source-msg-text');
    const thinkingText = document.getElementById('source-thinking-text');

    if (sourceAnalysis.skipped) {
      const isEn = getUiLang() === 'en';
      applySourceFactLabels(getDefaultSourceFactLabels());
      if (badge) {
        badge.className = 'source-badge unavailable';
        badge.textContent = sourceAnalysis.skipReason === 'quick_mode'
          ? (isEn ? 'Quick Mode' : '快速模式')
          : (isEn ? 'Skipped' : '已跳过');
      }
      if (confidence) confidence.textContent = '--';
      if (platform) {
        platform.textContent = isEn ? 'Skipped' : '已跳过';
        platform.title = '';
      }
      if (ratelimit) {
        ratelimit.textContent = isEn ? 'Skipped' : '已跳过';
        ratelimit.title = sourceAnalysis.summaryText || '';
      }
      if (toolText) {
        toolText.textContent = isEn ? 'Primary request only' : '仅主请求';
        toolText.title = '';
      }
      if (msgText) {
        msgText.textContent = isEn ? 'No extra probes' : '未执行额外探针';
        msgText.title = '';
      }
      if (thinkingText) {
        thinkingText.textContent = isEn ? 'Deep checks skipped' : '已跳过深度检查';
        thinkingText.title = '';
      }
      renderEvidenceList([
        sourceAnalysis.summaryText || (isEn
          ? 'Deep source analysis was skipped in quick mode.'
          : '快速模式下已跳过深度来源分析。'),
      ]);
      return;
    }

    const fingerprints = validFingerprints(sourceAnalysis);
    const toolFingerprint = pickFingerprint(fingerprints, (item) => item.toolIdFormat || item.toolId);
    const messageFingerprint = pickFingerprint(fingerprints, (item) => item.messageIdFormat || item.messageId);
    const thinkingFingerprint = pickFingerprint(fingerprints, (item) =>
      item.thinkingSignatureClass && item.thinkingSignatureClass !== 'none'
    );
    const platformFingerprint = pickFingerprint(fingerprints, (item) =>
      item.proxyPlatform || (Array.isArray(item.proxyClues) && item.proxyClues.length > 0)
    );
    const factLabels = sourceAnalysis.factLabels || getDefaultSourceFactLabels();
    applySourceFactLabels(factLabels);

    if (badge) {
      badge.className = `source-badge ${sourceBadgeClass(sourceAnalysis.verdict)}`;
      badge.textContent = sourceAnalysis.verdictLabel || (getUiLang() === 'en' ? 'Unknown' : '未知');
    }

    if (confidence) {
      confidence.textContent = formatConfidence(sourceAnalysis.confidence);
    }

    if (platform) {
      const platformText = sourceAnalysis.proxyPlatform
        || platformFingerprint?.proxyPlatform
        || platformFingerprint?.proxyClues?.[0]
        || (getUiLang() === 'en' ? 'Not found' : '未发现');
      platform.textContent = platformText;
      platform.title = Array.isArray(platformFingerprint?.proxyClues)
        ? platformFingerprint.proxyClues.join(' · ')
        : '';
    }

    if (ratelimit) {
      ratelimit.textContent = sourceAnalysis.ratelimitCheck?.label || '--';
      ratelimit.title = sourceAnalysis.ratelimitCheck?.detail || '';
    }

    if (toolText) {
      toolText.textContent = sourceAnalysis.factValues?.tool || formatToolFingerprint(toolFingerprint);
      toolText.title = sourceAnalysis.factTitles?.tool || '';
    }
    if (msgText) {
      msgText.textContent = sourceAnalysis.factValues?.message || formatMessageFingerprint(messageFingerprint);
      msgText.title = sourceAnalysis.factTitles?.message || '';
    }
    if (thinkingText) {
      thinkingText.textContent = sourceAnalysis.factValues?.thinking || formatThinkingFingerprint(thinkingFingerprint);
      thinkingText.title = sourceAnalysis.factTitles?.thinking || '';
    }

    renderEvidenceList(sourceAnalysis.evidence || []);
  }

  function renderScanResults(scanData) {
    const section = document.getElementById('scan-section');
    const summary = document.getElementById('scan-summary-copy');
    const tbody = document.getElementById('scan-results-tbody');

    if (section) section.classList.remove('hidden');
    if (summary) {
      summary.textContent = scanData?.summaryText
        || (getUiLang() === 'en' ? 'Scan completed' : '扫描完成');
    }
    if (!tbody) return;

    const models = Array.isArray(scanData?.models) ? scanData.models : [];
    if (models.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6">${escapeHtml(scanData?.summaryText || (getUiLang() === 'en' ? 'No scan results yet' : '暂无扫描结果'))}</td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = models.map((item) => {
      const analysis = item?.sourceAnalysis || {};
      const verdictLabel = analysis.verdictLabel || (getUiLang() === 'en' ? 'Unknown' : '未知');
      const confidenceText = formatConfidence(analysis.confidence);
      const latencyText = averageLatencyFromFingerprints(analysis.fingerprints);
      const ratelimitText = analysis.ratelimitCheck?.label || '--';
      const summaryText = analysis.summaryText || '--';

      return `
        <tr>
          <td>${escapeHtml(item?.modelId || '--')}</td>
          <td><span class="source-badge ${sourceBadgeClass(analysis.verdict)}">${escapeHtml(verdictLabel)}</span></td>
          <td>${escapeHtml(confidenceText)}</td>
          <td>${escapeHtml(latencyText)}</td>
          <td>${escapeHtml(ratelimitText)}</td>
          <td>${escapeHtml(summaryText)}</td>
        </tr>
      `;
    }).join('');
  }

  function resetResultUI() {
    document.getElementById('score-text').textContent = '0%';
    document.getElementById('score-label').textContent = '检测中...';
    document.getElementById('score-circle').style.strokeDashoffset = '502.65';
    document.getElementById('score-circle').style.stroke = 'var(--accent)';
    document.getElementById('check-list').innerHTML = '';
    document.getElementById('metrics').innerHTML = '';
    document.getElementById('response-content').textContent = '';
    document.getElementById('response-content').classList.add('hidden');
    resetSourceAnalysisUI();
  }

  function showError(msg, context = {}) {
    resetSourceAnalysisUI();
    const checkList = document.getElementById('check-list');
    checkList.innerHTML = `
      <div class="check-item">
        <div class="check-item-left">
          <span class="check-item-icon fail">${ICON_X}</span>
          <span class="check-item-name">检测失败</span>
        </div>
        <div class="check-item-right">
          <span class="check-badge fail">${String(msg || '未知错误').slice(0, 120)}</span>
        </div>
      </div>
    `;

    document.getElementById('metrics').innerHTML = `
      <div class="metric-item">
        <div class="metric-label">状态</div>
        <div class="metric-value">失败</div>
      </div>
    `;
    document.getElementById('score-label').textContent = '检测失败';
    document.getElementById('score-text').textContent = '0%';
    document.getElementById('score-circle').style.stroke = 'var(--error)';
    updateResultMeta({
      statusText: '检测失败',
      modelId: context.modelId || '--',
      apiUrl: context.apiUrl || '--',
      summaryCopy: `请求失败：${String(msg || '未知错误').slice(0, 140)}`
    });
    latestDetectExport = {
      ok: false,
      exportedAt: new Date().toISOString(),
      context: {
        modelId: context.modelId || '--',
        apiUrl: context.apiUrl || '',
        endpoint: extractHostname(context.apiUrl || ''),
        mode: context.mode || getActiveMode(),
        requestType: context.requestType || document.getElementById('detect-request-type')?.value || 'nonstream',
        analysisDepth: context.analysisDepth || getAnalysisDepth(),
      },
      error: String(msg || '未知错误'),
      data: null,
    };
    updateResultExportButtons();
    try {
      addHistory(buildHistoryEntryFromCurrentResult());
    } catch (e) {
      console.warn('History save error:', e);
    }
    dispatchAppEvent('apimaster:detect-status', {
      state: 'error',
      statusText: '失败',
      modelId: context.modelId,
      endpoint: extractHostname(context.apiUrl || ''),
      error: msg
    });
  }

  function animateScore(score) {
    const circle = document.getElementById('score-circle');
    const text = document.getElementById('score-text');
    const label = document.getElementById('score-label');
    const circumference = 2 * Math.PI * 80;

    circle.style.stroke = scoreColor(score);
    circle.style.transition = 'stroke-dashoffset 1.5s cubic-bezier(0.2,0,0,1)';

    setTimeout(() => {
      const offset = circumference - (score / 100) * circumference;
      circle.style.strokeDashoffset = offset;
    }, 50);

    let current = 0;
    const step = Math.max(1, Math.floor(score / 40));
    const timer = setInterval(() => {
      current = Math.min(current + step, score);
      text.textContent = `${current}%`;
      if (current >= score) {
        text.textContent = `${score}%`;
        clearInterval(timer);
      }
    }, 30);

    label.textContent = scoreLabel(score);
  }

  function renderChecklist(breakdown, mode, sourceAnalysis = null) {
    const list = document.getElementById('check-list');
    if (!list) return;
    const items = buildChecklistItemsFromBreakdown(breakdown);

    list.innerHTML = items.map((item, i) => {
      const icon = item.status === 'pass' ? ICON_CHECK : item.status === 'fail' ? ICON_X : ICON_WARN;
      const noteText = Array.isArray(item.notes) ? item.notes.join(' · ') : String(item.notes || '');
      const title = noteText ? ` title="${noteText.replace(/"/g, '&quot;')}"` : '';
      const details = buildChecklistIssueDetails(item, sourceAnalysis);
      const detailHtml = details.length > 0
        ? details.map((detail) => `
            <div class="check-detail-item">
              <div class="check-detail-tag">${escapeHtml(detail.tag)}</div>
              <div class="check-detail-text">${escapeHtml(detail.text)}</div>
            </div>
          `).join('')
        : `<div class="check-detail-empty">${escapeHtml(getChecklistToggleTexts().noIssue)}</div>`;
      return `
        <div class="check-entry" style="animation-delay:${i * 0.08}s">
          <div class="check-item">
            <div class="check-item-left">
              <span class="check-item-icon ${item.status}">${icon}</span>
              <span class="check-item-name"${title}>${item.name}</span>
            </div>
            <div class="check-item-right">
              <span class="check-badge ${item.status}">${item.detail}</span>
              <button class="check-toggle-btn" type="button" aria-expanded="false" title="${escapeHtml(getChecklistToggleTexts().expand)}">
                <svg class="check-toggle-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="9 6 15 12 9 18"></polyline>
                </svg>
              </button>
            </div>
          </div>
          <div class="check-detail hidden">
            ${detailHtml}
          </div>
        </div>
      `;
    }).join('');
  }

  function renderMetrics(data) {
    const metrics = document.getElementById('metrics');
    const items = [];

    if (data.latencyMs) items.push({ label: '延迟', value: `${data.latencyMs}ms` });
    if (data.firstChunkLatencyMs) items.push({ label: '首字', value: `${data.firstChunkLatencyMs}ms` });
    if (data.usage) {
      const inputTokens = data.usage.input_tokens ?? data.usage.prompt_tokens;
      const outputTokens = data.usage.output_tokens ?? data.usage.completion_tokens;
      const totalTokens = data.usage.total_tokens;
      if (typeof inputTokens === 'number') items.push({ label: '输入 Tokens', value: inputTokens });
      if (typeof outputTokens === 'number') items.push({ label: '输出 Tokens', value: outputTokens });
      if (typeof totalTokens === 'number') items.push({ label: '总 Tokens', value: totalTokens });
      if (typeof outputTokens === 'number' && data.latencyMs) {
        const tps = Math.round(outputTokens / (data.latencyMs / 1000));
        items.push({ label: 'TPS', value: tps });
      }
    }

    if (items.length === 0) {
      metrics.innerHTML = `
        <div class="metric-item">
          <div class="metric-label">指标</div>
          <div class="metric-value">暂无</div>
        </div>
      `;
      return;
    }

    metrics.innerHTML = items.map((m) => `
      <div class="metric-item">
        <div class="metric-label">${m.label}</div>
        <div class="metric-value">${m.value}</div>
      </div>
    `).join('');
  }

  function renderMetricSnapshot(items = []) {
    const metrics = document.getElementById('metrics');
    if (!metrics) return;

    if (!Array.isArray(items) || items.length === 0) {
      metrics.innerHTML = `
        <div class="metric-item">
          <div class="metric-label">指标</div>
          <div class="metric-value">暂无</div>
        </div>
      `;
      return;
    }

    metrics.innerHTML = items.map((item) => `
      <div class="metric-item">
        <div class="metric-label">${escapeHtml(item.label || '--')}</div>
        <div class="metric-value">${escapeHtml(item.value || '--')}</div>
      </div>
    `).join('');
  }

  function extractNumericScoreValue(value, fallback = 0) {
    const score = Number(String(value || '').replace(/[^\d.]/g, ''));
    if (Number.isFinite(score)) {
      return Math.max(0, Math.min(100, score));
    }
    return fallback;
  }

  function setStaticScoreDisplay(score, labelText, strokeColor = scoreColor(score)) {
    const normalizedScore = Math.max(0, Math.min(100, Number(score) || 0));
    const circle = document.getElementById('score-circle');
    const text = document.getElementById('score-text');
    const label = document.getElementById('score-label');
    const circumference = 2 * Math.PI * 80;
    const offset = circumference - (normalizedScore / 100) * circumference;

    if (circle) {
      circle.style.transition = 'none';
      circle.style.stroke = strokeColor;
      circle.style.strokeDashoffset = `${offset}`;
    }
    if (text) text.textContent = `${normalizedScore}%`;
    if (label) label.textContent = labelText || scoreLabel(normalizedScore);
  }

  function renderSourceAnalysisSnapshot(source = {}, options = {}) {
    const mode = options.mode || getActiveMode();
    const badge = document.getElementById('source-verdict-badge');
    const confidence = document.getElementById('source-confidence-text');
    const platform = document.getElementById('source-platform-text');
    const ratelimit = document.getElementById('source-ratelimit-text');
    const toolText = document.getElementById('source-tool-text');
    const msgText = document.getElementById('source-msg-text');
    const thinkingText = document.getElementById('source-thinking-text');

    applySourceFactLabels(source.factLabels || getDefaultSourceFactLabels(mode));

    if (badge) {
      badge.className = `source-badge ${sourceBadgeClass(source.verdictKey || 'unknown')}`;
      badge.textContent = source.verdict || (getUiLang() === 'en' ? 'Unknown' : '未知');
    }
    if (confidence) confidence.textContent = source.confidence || '--';
    if (platform) {
      platform.textContent = source.platform || '--';
      platform.title = '';
    }
    if (ratelimit) {
      ratelimit.textContent = source.ratelimit || '--';
      ratelimit.title = '';
    }
    if (toolText) {
      toolText.textContent = source.toolFingerprint || '--';
      toolText.title = '';
    }
    if (msgText) {
      msgText.textContent = source.messageFingerprint || '--';
      msgText.title = '';
    }
    if (thinkingText) {
      thinkingText.textContent = source.thinkingFingerprint || '--';
      thinkingText.title = '';
    }

    renderEvidenceList(Array.isArray(options.evidence) ? options.evidence : []);
  }

  function buildHistoryEntryId(entry, index = 0) {
    if (entry?.id) return String(entry.id);
    const timePart = entry?.time || Date.now();
    const modelPart = slugifyFilename(entry?.model || 'detect');
    const endpointPart = slugifyFilename(entry?.endpoint || 'endpoint');
    return `${timePart}-${modelPart}-${endpointPart}-${index}`;
  }

  function inferScoreFromChecklist(checklist = []) {
    if (!Array.isArray(checklist) || checklist.length === 0) {
      return NaN;
    }

    let earned = 0;
    let total = 0;

    checklist.forEach((item) => {
      const detail = String(item?.detail || '');
      const match = detail.match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
      if (!match) return;

      earned += Number(match[1]) || 0;
      total += Number(match[2]) || 0;
    });

    if (!(total > 0)) {
      return NaN;
    }

    return Math.max(0, Math.min(100, Math.round((earned / total) * 100)));
  }

  function resolveSnapshotScore(snapshot, fallback = 0) {
    const explicitScore = extractNumericScoreValue(snapshot?.score, Number.NaN);
    if (Number.isFinite(explicitScore) && explicitScore > 0) {
      return explicitScore;
    }

    const inferredScore = inferScoreFromChecklist(snapshot?.checklist);
    if (Number.isFinite(inferredScore)) {
      return inferredScore;
    }

    if (Number.isFinite(explicitScore)) {
      return explicitScore;
    }

    return fallback;
  }

  function normalizeHistoryEntry(entry, index = 0) {
    const snapshot = entry?.snapshot && typeof entry.snapshot === 'object' ? entry.snapshot : null;
    const explicitEntryScore = typeof entry?.score === 'number'
      ? Math.max(0, Math.min(100, entry.score))
      : Number.NaN;
    const snapshotScore = resolveSnapshotScore(snapshot, snapshot?.ok === false ? 0 : 0);
    const score = Number.isFinite(explicitEntryScore) && explicitEntryScore > 0
      ? explicitEntryScore
      : (snapshotScore > 0 ? snapshotScore : (Number.isFinite(explicitEntryScore) ? explicitEntryScore : snapshotScore));

    return {
      ...entry,
      id: buildHistoryEntryId(entry, index),
      time: entry?.time || Date.now(),
      model: entry?.model || snapshot?.model || '--',
      endpoint: entry?.endpoint || snapshot?.endpoint || '--',
      score,
      success: typeof entry?.success === 'boolean' ? entry.success : (snapshot?.ok ?? false),
      mode: entry?.mode || snapshot?.detectContext?.mode || 'anthropic',
      requestType: entry?.requestType || snapshot?.detectContext?.requestType || 'nonstream',
      snapshot,
    };
  }

  function getHistoryEntries() {
    const history = loadConfig('history', []);
    return Array.isArray(history)
      ? history.map((entry, index) => normalizeHistoryEntry(entry, index))
      : [];
  }

  function buildHistorySnapshotFromCurrentResult() {
    return buildDetectExportSnapshot();
  }

  function buildHistoryEntryFromCurrentResult() {
    const snapshot = buildHistorySnapshotFromCurrentResult();
    const context = snapshot.detectContext || latestDetectExport?.context || {};

    return normalizeHistoryEntry({
      id: generateId(),
      version: 2,
      time: Date.now(),
      model: context.modelId || snapshot.model || '--',
      endpoint: context.endpoint || snapshot.endpoint || '--',
      score: resolveSnapshotScore(snapshot, snapshot.ok ? 0 : 0),
      success: snapshot.ok ?? false,
      mode: context.mode || 'anthropic',
      requestType: context.requestType || 'nonstream',
      snapshot,
    });
  }

  function scrollResultSectionIntoView() {
    document.getElementById('result-section')?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  }

  function applyDetectContextToForm(context = {}) {
    const apiUrlInput = document.getElementById('api-url');
    const modelInput = document.getElementById('model-id');
    const requestTypeSelect = document.getElementById('detect-request-type');
    const analysisDepthSelect = document.getElementById('detect-analysis-depth');
    const mode = context.mode || 'anthropic';
    const requestType = context.requestType === 'stream' ? 'stream' : 'nonstream';
    const analysisDepth = context.analysisDepth === 'quick' ? 'quick' : 'deep';

    if (context.apiUrl && apiUrlInput) {
      apiUrlInput.value = context.apiUrl;
      saveConfig('apiUrl', context.apiUrl);
    }

    if (context.modelId && modelInput) {
      modelInput.value = context.modelId;
      saveConfig('customModelId', context.modelId);
    }

    setMode(mode);

    if (requestTypeSelect) {
      requestTypeSelect.value = requestType;
      const requestTypeMap = loadConfig('detectRequestTypeMap', {});
      requestTypeMap[mode] = requestType;
      saveConfig('detectRequestTypeMap', requestTypeMap);
      saveConfig('detectRequestType', requestType);
    }

    if (analysisDepthSelect) {
      analysisDepthSelect.value = analysisDepth;
      saveConfig('detectAnalysisDepth', analysisDepth);
    }
  }

  function restoreHistoryEntry(historyId) {
    if (isBusy()) {
      alert(getUiLang() === 'en'
        ? 'Please wait for the current detection or scan to finish before restoring a history entry.'
        : '请等待当前检测或扫描完成后，再恢复历史记录。');
      return;
    }

    const history = getHistoryEntries();
    const entry = history.find((item) => item.id === historyId);
    if (!entry) return;

    if (!entry.snapshot) {
      activeHistoryEntryId = entry.id;
      renderHistory();
      restoreLegacyHistoryEntry(entry);
      return;
    }

    activeHistoryEntryId = entry.id;
    renderHistory();
    applyDetectContextToForm(entry.snapshot.detectContext || {});
    restoreDetectResultFromHistory(entry);
  }

  function restoreLegacyHistoryEntry(entry) {
    const resultSection = document.getElementById('result-section');
    if (resultSection) resultSection.classList.remove('hidden');

    resetResultUI();
    refreshUiText();

    const score = typeof entry?.score === 'number' ? entry.score : 0;
    const statusText = entry?.success ? scoreLabel(score) : '检测失败';
    const summaryText = getUiLang() === 'en'
      ? 'This is a legacy cached record. Only the basic summary was preserved; detailed checklist, evidence, and response preview were not stored yet.'
      : '这是旧版缓存记录，只保留了基础摘要；详细检查项、证据面板和响应预览当时还没有被缓存。';

    if (entry?.success) {
      setStaticScoreDisplay(score, scoreLabel(score), scoreColor(score));
    } else {
      setStaticScoreDisplay(0, '检测失败', 'var(--error)');
    }

    renderChecklist({
      items: [{
        name: getUiLang() === 'en' ? 'History Restore' : '历史恢复',
        status: 'warning',
        detail: getUiLang() === 'en' ? 'Legacy cache' : '旧版缓存',
        notes: [summaryText],
      }],
    }, entry?.mode || 'anthropic', {
      evidence: [summaryText],
    });

    renderMetricSnapshot([
      {
        label: getUiLang() === 'en' ? 'Recorded At' : '记录时间',
        value: formatTime(entry?.time || Date.now()),
      },
      {
        label: getUiLang() === 'en' ? 'Request Type' : '调用方式',
        value: entry?.requestType || '--',
      },
    ]);

    renderSourceAnalysisSnapshot({
      verdict: getUiLang() === 'en' ? 'Legacy Cache' : '旧版缓存',
      verdictKey: 'unknown',
      confidence: '--',
      platform: getUiLang() === 'en' ? 'Not stored' : '未保存',
      ratelimit: '--',
      toolFingerprint: '--',
      messageFingerprint: '--',
      thinkingFingerprint: '--',
      factLabels: getDefaultSourceFactLabels(entry?.mode || 'anthropic'),
    }, {
      mode: entry?.mode || 'anthropic',
      evidence: [summaryText],
    });

    const responseContent = document.getElementById('response-content');
    if (responseContent) {
      responseContent.textContent = '';
    }
    setResponsePreviewVisible(false);

    updateResultMeta({
      statusText,
      modelId: entry?.model || '--',
      apiUrl: entry?.endpoint || '--',
      summaryCopy: summaryText,
    });

    latestDetectExport = {
      ok: entry?.success ?? false,
      exportedAt: new Date(entry?.time || Date.now()).toISOString(),
      context: {
        modelId: entry?.model || '--',
        apiUrl: entry?.endpoint || '',
        endpoint: entry?.endpoint || '--',
        mode: entry?.mode || 'anthropic',
        requestType: entry?.requestType || 'nonstream',
      },
      error: entry?.success ? '' : (getUiLang() === 'en' ? 'Legacy failure record' : '旧版失败记录'),
      data: {
        restoredFromHistory: true,
        legacy: true,
        entry,
      },
    };
    updateResultExportButtons();
    updateResultExportButtonTexts();

    dispatchAppEvent('apimaster:detect-status', {
      state: 'restored',
      statusText: getUiLang() === 'en'
        ? `Restored legacy record · ${entry?.score ?? 0}%`
        : `已恢复旧版记录 · ${entry?.score ?? 0}%`,
      score,
      modelId: entry?.model || '--',
      endpoint: entry?.endpoint || '--',
    });

    scrollResultSectionIntoView();
  }

  function restoreDetectResultFromHistory(entry) {
    const snapshot = entry?.snapshot;
    if (!snapshot) return;

    const resultSection = document.getElementById('result-section');
    if (resultSection) resultSection.classList.remove('hidden');

    resetResultUI();
    refreshUiText();

    const mode = snapshot.detectContext?.mode || entry?.mode || getActiveMode();
    const score = resolveSnapshotScore(snapshot, snapshot.ok ? 0 : 0);
    if (snapshot.ok === false) {
      setStaticScoreDisplay(score, snapshot.scoreLabel || '检测失败', 'var(--error)');
    } else {
      setStaticScoreDisplay(score, snapshot.scoreLabel || scoreLabel(score), scoreColor(score));
    }

    renderChecklist({ items: Array.isArray(snapshot.checklist) ? snapshot.checklist : [] }, mode, {
      evidence: Array.isArray(snapshot.evidence) ? snapshot.evidence : [],
    });
    renderMetricSnapshot(snapshot.metrics || []);
    renderSourceAnalysisSnapshot(snapshot.source || {}, {
      mode,
      evidence: snapshot.evidence || [],
    });

    const responseContent = document.getElementById('response-content');
    if (responseContent) {
      responseContent.textContent = snapshot.responseText || '';
    }
    setResponsePreviewVisible(Boolean(snapshot.responseVisible && snapshot.responseText));

    updateResultMeta({
      statusText: snapshot.status || '--',
      modelId: snapshot.model || entry?.model || '--',
      apiUrl: snapshot.detectContext?.apiUrl || '--',
      summaryCopy: snapshot.summary || '',
    });

    latestDetectExport = {
      ok: snapshot.ok ?? false,
      exportedAt: snapshot.exportedAt || new Date().toISOString(),
      context: snapshot.detectContext || null,
      error: snapshot.error || '',
      data: {
        restoredFromHistory: true,
        snapshot,
      },
    };
    updateResultExportButtons();
    updateResultExportButtonTexts();

    dispatchAppEvent('apimaster:detect-status', {
      state: 'restored',
      statusText: getUiLang() === 'en'
        ? `Restored · ${snapshot.score || snapshot.status || '--'}`
        : `已恢复 · ${snapshot.score || snapshot.status || '--'}`,
      score,
      modelId: snapshot.model || entry?.model || '--',
      endpoint: extractHostname(snapshot.detectContext?.apiUrl || entry?.endpoint || ''),
    });

    scrollResultSectionIntoView();
  }

  /* ── Result Toggle ── */
  function setupResultToggle() {
    const btn = document.getElementById('btn-toggle-response');
    const content = document.getElementById('response-content');
    btn.addEventListener('click', () => {
      content.classList.toggle('hidden');
      document.getElementById('toggle-response-text').textContent =
        content.classList.contains('hidden') ? '显示响应内容' : '隐藏响应内容';
    });
  }

  /* ── History ── */
  function addHistory(entry) {
    const history = getHistoryEntries();
    const normalizedEntry = normalizeHistoryEntry(entry, 0);
    history.unshift(normalizedEntry);
    if (history.length > 50) history.length = 50;
    saveConfig('history', history);
    activeHistoryEntryId = normalizedEntry.id;
    renderHistory();
  }

  function renderHistory() {
    const list = document.getElementById('history-list');
    const history = getHistoryEntries();

    if (history.length === 0) {
      list.innerHTML = '<div class="history-empty">暂无检测记录</div>';
      return;
    }

    list.innerHTML = history.map((h) => {
      const sc = scoreClass(h.score);
      const restorable = Boolean(h.snapshot);
      const isActive = activeHistoryEntryId && activeHistoryEntryId === h.id;
      const title = restorable
        ? (getUiLang() === 'en' ? 'Click to restore this result' : '点击恢复这次检测结果')
        : (getUiLang() === 'en' ? 'Legacy cache entry: click to restore a basic summary view' : '旧版缓存记录：点击恢复基础摘要视图');
      return `
        <div class="history-item ${restorable ? 'restorable' : 'legacy'} ${isActive ? 'active' : ''}" data-history-id="${escapeHtml(h.id)}" tabindex="0" role="button" title="${escapeHtml(title)}">
          <div class="history-time">${formatTime(h.time)}</div>
          <div class="history-model" title="${escapeHtml(h.model)}">${escapeHtml(h.model)}</div>
          <div class="history-endpoint" title="${escapeHtml(h.endpoint)}">${escapeHtml(h.endpoint)}</div>
          <div class="history-score ${sc}">${h.score}%</div>
          <div class="history-status">
            <span class="status-icon">${h.success ? '✅' : '❌'}</span>
            <span class="history-status-label">${restorable ? (getUiLang() === 'en' ? 'Restore' : '恢复') : (getUiLang() === 'en' ? 'Legacy' : '旧版')}</span>
          </div>
        </div>
      `;
    }).join('');
  }

  function setupHistoryInteractions() {
    const list = document.getElementById('history-list');
    if (!list || list.dataset.historyBound === 'true') return;

    list.dataset.historyBound = 'true';

    list.addEventListener('click', (event) => {
      const item = event.target.closest('.history-item[data-history-id]');
      if (!item) return;
      restoreHistoryEntry(item.dataset.historyId);
    });

    list.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const item = event.target.closest('.history-item[data-history-id]');
      if (!item) return;
      event.preventDefault();
      restoreHistoryEntry(item.dataset.historyId);
    });
  }

  function setupHistoryClear() {
    document.getElementById('btn-clear-history').addEventListener('click', () => {
      if (confirm('确定清除所有历史记录？')) {
        saveConfig('history', []);
        activeHistoryEntryId = '';
        renderHistory();
      }
    });
  }

  /* ── Config Persistence ── */
  function loadSavedConfig() {
    const url = loadConfig('apiUrl', '');
    const key = loadVolatileConfig('apiKey', '');
    const mode = loadConfig('mode', 'anthropic');
    const analysisDepth = loadConfig('detectAnalysisDepth', 'deep');
    removeConfig('apiKey');
    if (url) document.getElementById('api-url').value = url;
    if (key) document.getElementById('api-key').value = key;
    const analysisDepthSelect = document.getElementById('detect-analysis-depth');
    if (analysisDepthSelect) analysisDepthSelect.value = analysisDepth;
    setMode(mode);
  }

  return { init, refreshUiText };
})();
