/* ── App Entry Point ─────────────────── */

const AppRuntime = {
  activeTab: 'detect',
  detectStatus: '待开始',
  needleStatus: '待开始',
  lang: 'zh',
};

document.addEventListener('DOMContentLoaded', () => {
  ApiDetect.init();
  NeedleTest.init();

  setupTabs();
  setupLang();
  setupOverviewBindings();
  syncConfig();
  updateAllOverview();
});

function setupTabs() {
  const tabs = document.querySelectorAll('.nav-tab');
  const pages = {
    detect: document.getElementById('page-detect'),
    needle: document.getElementById('page-needle'),
  };

  function switchTab(target) {
    tabs.forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === target));
    Object.entries(pages).forEach(([key, page]) => {
      if (!page) return;
      page.classList.toggle('hidden', key !== target);
    });

    AppRuntime.activeTab = target;
    if (target === 'needle') {
      syncConfig();
    }

    saveConfig('activeTab', target);
    updateAllOverview();
  }

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      switchTab(tab.dataset.tab);
    });
  });

  const lastTab = loadConfig('activeTab', 'detect');
  switchTab(lastTab in pages ? lastTab : 'detect');
}

function syncConfig() {
  const detectUrl = getValue('api-url');
  const detectKey = getValue('api-key');
  const detectModel = getValue('model-id');
  const detectMode = document.querySelector('.mode-btn.active')?.dataset.mode || 'anthropic';

  const needleUrl = document.getElementById('needle-api-url');
  const needleKey = document.getElementById('needle-api-key');
  const needleModel = document.getElementById('needle-model');
  const needleMode = document.getElementById('needle-mode');

  if (needleUrl && !needleUrl.dataset.userSet) needleUrl.value = detectUrl;
  if (needleKey && !needleKey.dataset.userSet) needleKey.value = detectKey;
  if (needleModel && detectModel && !needleModel.value) needleModel.value = detectModel;
  if (needleMode && detectMode && !needleMode.dataset.userSet) needleMode.value = detectMode;
}

function setupOverviewBindings() {
  document.addEventListener('apimaster:config-changed', () => {
    updateAllOverview();
  });

  document.addEventListener('apimaster:detect-status', (event) => {
    AppRuntime.detectStatus = event.detail?.statusText || '待开始';
    updateAllOverview();
  });

  document.addEventListener('apimaster:needle-status', (event) => {
    AppRuntime.needleStatus = event.detail?.statusText || '待开始';
    updateAllOverview();
  });

  ['api-url', 'api-key', 'model-id', 'with-thinking', 'detect-request-type', 'detect-analysis-depth'].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    const eventName = el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input';
    el.addEventListener(eventName, () => {
      syncConfig();
      updateAllOverview();
    });
  });

  document.querySelectorAll('.mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      syncConfig();
      updateAllOverview();
    });
  });

  const needleMode = document.getElementById('needle-mode');
  if (needleMode) {
    needleMode.addEventListener('change', () => {
      needleMode.dataset.userSet = 'true';
      updateAllOverview();
    });
  }

  [
    'needle-model',
    'needle-request-type',
    'needle-text',
    'needle-question',
    'needle-expected-answer',
    'needle-scoring-mode',
    'needle-ctx-min',
    'needle-ctx-max',
    'needle-ctx-intervals',
    'needle-depth-min',
    'needle-depth-max',
    'needle-depth-intervals',
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', updateAllOverview);
  });
}

function updateAllOverview() {
  updateDetectOverview();
  updateNeedleOverview();
  updateHeaderMeta();
  updatePageCopy();
}

function updateDetectOverview() {
  const mode = document.querySelector('.mode-btn.active')?.dataset.mode || 'anthropic';
  const requestType = getValue('detect-request-type') === 'stream' ? 'stream' : 'nonstream';
  const analysisDepth = getValue('detect-analysis-depth') === 'quick' ? 'quick' : 'deep';
  const withThinking = document.getElementById('with-thinking')?.checked ?? true;
  const modelId = getValue('model-id') || '未设置';
  const selectedCard = document.querySelector('.model-card.active .model-card-name')?.textContent?.trim();
  const history = loadConfig('history', []);
  const last = history[0];
  const requestTypeLabel = requestType === 'stream'
    ? (AppRuntime.lang === 'en' ? 'Stream' : '流式调用')
    : (AppRuntime.lang === 'en' ? 'Non-stream' : '非流式调用');
  const analysisDepthLabel = analysisDepth === 'quick'
    ? (AppRuntime.lang === 'en' ? 'Quick' : '快速')
    : (AppRuntime.lang === 'en' ? 'Deep' : '深度');

  setText('detect-stat-mode', mode === 'anthropic' ? 'Anthropic' : 'OpenAI');
  setText(
    'detect-note-mode',
    mode === 'anthropic'
      ? `/v1/messages · ${requestTypeLabel} · ${analysisDepthLabel} · ${withThinking ? 'Thinking On' : 'Thinking Off'}`
      : `/v1/chat/completions · ${requestTypeLabel} · ${analysisDepthLabel}`
  );

  setText('detect-stat-model', modelId);
  setText('detect-note-model', selectedCard ? `当前卡片：${selectedCard}` : '选择预置模型或手动输入实际模型名');

  setText('detect-stat-history', String(history.length));
  setText('detect-note-history', history.length > 0 ? `最近一次：${formatCompactTime(history[0].time)}` : '尚无检测记录');

  if (last) {
    setText('detect-stat-last-score', `${last.score}%`);
    setText('detect-note-last-score', `${scoreLabel(last.score)} · ${last.model}`);
  } else {
    setText('detect-stat-last-score', '--');
    setText('detect-note-last-score', '完成一次检测后自动更新');
  }

  const inlineStatus = document.getElementById('result-status-inline');
  const inlineEndpoint = document.getElementById('result-endpoint-inline');
  const inlineModel = document.getElementById('result-model-inline');
  if (inlineStatus && inlineStatus.textContent === '待开始') {
    inlineStatus.textContent = AppRuntime.detectStatus || '待开始';
  }
  if (inlineEndpoint && inlineEndpoint.textContent === '--') {
    inlineEndpoint.textContent = extractHostname(getValue('api-url') || '--');
  }
  if (inlineModel && inlineModel.textContent === '--') {
    inlineModel.textContent = modelId || '--';
  }
}

function updateNeedleOverview() {
  const model = getValue('needle-model') || '未设置';
  const mode = getValue('needle-mode') || 'openai';
  const requestType = getValue('needle-request-type') === 'stream' ? 'stream' : 'nonstream';
  const scoringMode = getValue('needle-scoring-mode') || 'keyword';
  const ctxMin = getInt('needle-ctx-min', 1000);
  const ctxMax = getInt('needle-ctx-max', 8000);
  const ctxIntervals = Math.max(0, getInt('needle-ctx-intervals', 5));
  const depthMin = getInt('needle-depth-min', 0);
  const depthMax = getInt('needle-depth-max', 100);
  const depthIntervals = Math.max(0, getInt('needle-depth-intervals', 5));

  const ctxCount = ctxIntervals + 1;
  const depthCount = depthIntervals + 1;
  const total = ctxCount * depthCount;

  setText('needle-stat-model', model);
  setText(
    'needle-note-model',
    `${mode === 'anthropic' ? 'Anthropic' : 'OpenAI'} ${AppRuntime.lang === 'en' ? 'format' : '请求格式'} · ${requestType === 'stream'
      ? (AppRuntime.lang === 'en' ? 'Stream' : '流式调用')
      : (AppRuntime.lang === 'en' ? 'Non-stream' : '非流式调用')} · ${getNeedleScoringModeLabel(scoringMode)}`
  );
  setText('needle-stat-matrix', `${ctxCount} × ${depthCount}`);
  setText('needle-note-matrix', `预计执行 ${total} 组组合`);
  setText('needle-stat-context', `${ctxMin} → ${ctxMax}`);
  setText('needle-note-context', `${ctxCount} 档长度采样`);
  setText('needle-stat-depth', `${depthMin}% → ${depthMax}%`);
  setText('needle-note-depth', `${depthCount} 档深度采样`);
}

function updateHeaderMeta() {
  const currentTabLabel = AppRuntime.lang === 'en'
    ? (AppRuntime.activeTab === 'needle' ? 'Current Task · Needle Test' : 'Current Task · API Detect')
    : (AppRuntime.activeTab === 'needle' ? '当前任务 · Needle 测试' : '当前任务 · API 检测');

  setText('head-chip-tab', currentTabLabel);
}

function updatePageCopy() {
  const isEn = AppRuntime.lang === 'en';

  if (AppRuntime.activeTab === 'needle') {
    setText(
      'page-copy',
      isEn
        ? 'Evaluate real retrieval performance under long-context conditions. Use a context-length by insertion-depth matrix to observe recall quality, heatmap trends, and degradation points.'
        : '用于评估模型在长上下文中的真实检索能力。通过上下文长度 × 插入深度矩阵，快速观察召回效果、热力图趋势与衰减拐点。'
    );
    setText(
      'hero-note',
      isEn
        ? 'This workspace is for validating information recall in long-context scenarios. After entering a needle and a query, ApiMaster will run the matrix and show progress, averages, and the heatmap inside the test area.'
        : '适合验证长上下文场景下的信息找回表现。输入 Needle 和问题后，系统会逐组请求目标接口，并在测试区内展示进度、平均表现和热力图。'
    );
    setText(
      'hero-rail-note',
      isEn
        ? 'These entry cards only switch workspaces; the matrix, progress, and result review remain inside the Needle page.'
        : '这里的入口只负责切换工作区；测试矩阵、运行进度与结果判断都在 Needle 页面内部完成。'
    );
    return;
  }

  setText(
    'page-copy',
    isEn
      ? 'Quickly verify whether an AI API is genuinely compatible with the target model and response protocol, especially for cutoff knowledge, thinking blocks, usage fields, and SSE structure.'
      : '用于快速验证 AI API 是否真实兼容目标模型与返回协议，适合排查知识截止、thinking、usage 与 SSE 结构问题。'
  );
  setText(
    'hero-note',
    isEn
      ? 'Frontend plus local-proxy workflow. Start from a workspace, then run compatibility checks or long-context tests; history and live progress stay inside the corresponding feature areas.'
      : '纯前端 + 本地代理工作流。先进入一个工作区，再完成接口检测或长上下文测试；历史记录与进度状态都在各自功能区内展示。'
  );
  setText(
    'hero-rail-note',
    isEn
      ? 'The entry cards only switch tasks; runtime state, history, and progress remain in each workspace so the homepage stays focused on the product workflow.'
      : '入口卡只负责切换任务；运行状态、历史记录和进度信息都保留在对应工作区里，避免首页被中控信息占满。'
  );
}

function setupLang() {
  const langBtn = document.getElementById('lang-toggle');
  let isEn = false;

  const translations = {
    zh: {
      alertText: '为保障账户安全，建议优先使用测试专用 API Key。本工具不会把 API Key 持久化保存在浏览器；Key 仅在当前页面会话中使用，并会随你发起的请求发送到目标接口。',
      keyStorageNote: '默认不记住 API Key，刷新页面后需要重新输入。',
      configTitle: '接口配置',
      apiUrl: 'API 接口地址',
      apiKey: 'API KEY',
      modeTitle: '检测方式',
      modelTitle: '目标模型',
      modelId: '实际模型名（可自定义修改）',
      modelHint: '💡 中转站可能需要修改模型名，例如添加前缀 <code>[特价]-</code> 或后缀 <code>-no-thinking</code>',
      thinking: '启用 Thinking (Extended Thinking)',
      detectRequestType: '调用方式',
      detectAnalysisDepth: '检测深度',
      detectAnalysisDeep: '深度检测（含来源/画像探针）',
      detectAnalysisQuick: '快速检测（仅主请求评分）',
      detectNonstream: '非流式调用',
      detectStream: '流式调用',
      startDetect: '开始检测',
      startNeedle: '开始测试',
      exportHeatmap: '导出热力图 PNG',
      exportNeedleCsv: '导出结果 CSV',
      resultTitle: '检测结果',
      showResponse: '显示响应内容',
      historyTitle: '最近历史',
      clearCache: '清除缓存',
      historyEmpty: '暂无检测记录',
      needleContextHeader: '上下文（请求 / 实际）',
      needleDepthHeader: '深度 (%)',
      needleScoreHeader: '检索得分',
      needleLatencyHeader: '延迟 (ms)',
      needleStatusHeader: '状态',
      needleExpectedAnswer: '参考答案 / 正则',
      needleScoringMode: '评分方式',
      needleScoringNote: '关键词模式会默认从参考答案中提取关键词；若参考答案留空，则回退使用 Needle 文本。',
      needleScoreKeyword: '关键词覆盖',
      needleScoreExact: '完全匹配',
      needleScoreContains: '包含参考答案',
      needleScoreRegex: '正则匹配',
    },
    en: {
      alertText: 'For security, use a test-only API key. This tool does not persist your API key in browser storage; it stays in the current page session only and is sent only to the endpoint you request.',
      keyStorageNote: 'API keys are not remembered by default. Refreshing the page will require entering the key again.',
      configTitle: 'API Configuration',
      apiUrl: 'API Endpoint',
      apiKey: 'API Key',
      modeTitle: 'Detection Mode',
      modelTitle: 'Target Model',
      modelId: 'Actual model name (editable)',
      modelHint: '💡 Relay APIs may need modified names, such as prefix <code>[promo]-</code> or suffix <code>-no-thinking</code>.',
      thinking: 'Enable Thinking (Extended Thinking)',
      detectRequestType: 'Request Mode',
      detectAnalysisDepth: 'Analysis Depth',
      detectAnalysisDeep: 'Deep Detection (with probes)',
      detectAnalysisQuick: 'Quick Detection (main request only)',
      detectNonstream: 'Non-stream',
      detectStream: 'Stream',
      startDetect: 'Start Detection',
      startNeedle: 'Start Test',
      exportHeatmap: 'Export Heatmap PNG',
      exportNeedleCsv: 'Export Results CSV',
      resultTitle: 'Detection Result',
      showResponse: 'Show Response',
      historyTitle: 'Recent History',
      clearCache: 'Clear Cache',
      historyEmpty: 'No detection records yet',
      needleContextHeader: 'Context (Requested / Actual)',
      needleDepthHeader: 'Depth (%)',
      needleScoreHeader: 'Retrieval Score',
      needleLatencyHeader: 'Latency (ms)',
      needleStatusHeader: 'Status',
      needleExpectedAnswer: 'Expected Answer / Regex',
      needleScoringMode: 'Scoring Mode',
      needleScoringNote: 'Keyword mode extracts keywords from the expected answer by default; if left blank, it falls back to the needle text.',
      needleScoreKeyword: 'Keyword Coverage',
      needleScoreExact: 'Exact Match',
      needleScoreContains: 'Contains Answer',
      needleScoreRegex: 'Regex Match',
    },
  };

  langBtn.addEventListener('click', () => {
    isEn = !isEn;
    AppRuntime.lang = isEn ? 'en' : 'zh';
    langBtn.textContent = isEn ? '中文' : 'EN';
    const t = isEn ? translations.en : translations.zh;

    setText('entry-detect-kicker', isEn ? 'API Compatibility' : '接口兼容性检测');
    setText('entry-detect-title', isEn ? 'Open API Detection' : '进入 API 检测');
    setText('entry-detect-note', isEn ? 'Check model compatibility, knowledge cutoff, thinking, usage, and SSE response structure.' : '检查模型识别、知识截止、thinking、usage 与 SSE 返回结构。');
    setText('entry-detect-meta', isEn ? 'Built for relay authenticity and protocol review' : '适合排查中转站真实性与协议兼容性');
    setText('entry-needle-kicker', isEn ? 'Long-context Retrieval' : '长上下文检索测试');
    const needleTitleEl = document.getElementById('entry-needle-title');
    if (needleTitleEl) {
      needleTitleEl.innerHTML = isEn ? 'Open Needle Testing' : '进入 大海捞针 测试<br>（Needle 测试）';
    }
    setText('entry-needle-note', isEn ? 'Use a context-length by insertion-depth matrix to observe retrieval behavior and heatmap trends.' : '基于上下文长度和插入深度矩阵，观察真实检索能力与衰减表现。');
    setText('entry-needle-meta', isEn ? 'Built for long-context recall and heatmap analysis' : '适合验证长上下文召回和热力图趋势');
    setText('alert-text', t.alertText);
    setText('api-key-storage-note', t.keyStorageNote);
    setText('section-config-title', t.configTitle);
    setText('label-api-url', t.apiUrl);
    setText('label-api-key', t.apiKey);
    setText('section-mode-title', t.modeTitle);
    setText('section-model-title', t.modelTitle);
    setText('label-model-id', t.modelId);
    document.getElementById('model-hint').innerHTML = t.modelHint;
    setText('label-thinking', t.thinking);
    setText('label-detect-request-type', t.detectRequestType);
    setText('label-detect-analysis-depth', t.detectAnalysisDepth);
    setText('option-detect-analysis-deep', t.detectAnalysisDeep);
    setText('option-detect-analysis-quick', t.detectAnalysisQuick);
    setText('option-detect-nonstream', t.detectNonstream);
    setText('option-detect-stream', t.detectStream);
    setText('label-needle-request-type', t.detectRequestType);
    setText('option-needle-nonstream', t.detectNonstream);
    setText('option-needle-stream', t.detectStream);
    setText('label-needle-expected-answer', t.needleExpectedAnswer);
    setText('label-needle-scoring-mode', t.needleScoringMode);
    setText('needle-scoring-note', t.needleScoringNote);
    setText('option-needle-score-keyword', t.needleScoreKeyword);
    setText('option-needle-score-exact', t.needleScoreExact);
    setText('option-needle-score-contains', t.needleScoreContains);
    setText('option-needle-score-regex', t.needleScoreRegex);
    setText('btn-detect-text', t.startDetect);
    setText('btn-export-heatmap', t.exportHeatmap);
    setText('btn-export-needle-csv', t.exportNeedleCsv);
    setText('result-title', t.resultTitle);
    setText('toggle-response-text', t.showResponse);
    setText('history-title', t.historyTitle);
    setText('btn-clear-history', t.clearCache);
    setText('needle-context-header', t.needleContextHeader);
    setText('needle-depth-header', t.needleDepthHeader);
    setText('needle-score-header', t.needleScoreHeader);
    setText('needle-latency-header', t.needleLatencyHeader);
    setText('needle-status-header', t.needleStatusHeader);
    const empty = document.getElementById('history-empty');
    if (empty) empty.textContent = t.historyEmpty;
    if (typeof NeedleTest !== 'undefined' && typeof NeedleTest.refreshUiText === 'function') {
      NeedleTest.refreshUiText();
    } else {
      setText('btn-needle-start-text', t.startNeedle);
    }
    if (typeof ApiDetect !== 'undefined' && typeof ApiDetect.refreshUiText === 'function') {
      ApiDetect.refreshUiText();
    }
    updateAllOverview();
  });
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function getNeedleScoringModeLabel(mode) {
  if (mode === 'exact') return AppRuntime.lang === 'en' ? 'Exact Match' : '完全匹配';
  if (mode === 'contains') return AppRuntime.lang === 'en' ? 'Contains Answer' : '包含参考答案';
  if (mode === 'regex') return AppRuntime.lang === 'en' ? 'Regex Match' : '正则匹配';
  return AppRuntime.lang === 'en' ? 'Keyword Coverage' : '关键词覆盖';
}

function getValue(id) {
  const el = document.getElementById(id);
  return el && typeof el.value === 'string' ? el.value.trim() : '';
}

function getInt(id, fallback) {
  const el = document.getElementById(id);
  const value = parseInt(el?.value, 10);
  return Number.isFinite(value) ? value : fallback;
}

function formatCompactTime(date) {
  return formatTime(date).slice(5, 16);
}
