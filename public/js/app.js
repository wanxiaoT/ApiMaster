/* ── App Entry Point ─────────────────── */

const AppRuntime = {
  activeTab: 'detect',
  detectStatus: '待开始',
  needleStatus: '待开始',
  lang: loadConfig('lang', 'zh') === 'en' ? 'en' : 'zh',
  theme: 'classic',
};

const APP_TEXT = {
  zh: {
    documentTitle: 'ApiMaster - AI API 检测 & 大海捞针测试',
    documentDescription: 'AI API 中转站检测工具，支持自定义模型名，大海捞针上下文检索测试',
    toggleKeyTitle: '显示/隐藏',
    clearKeyTitle: '清除',
    notSet: '未设置',
    statusPending: '待开始',
    detectStatusWaiting: '等待检测',
    needleStatusWaiting: '尚未开始',
    detectMetricLastScore: '最近得分 / Last Score',
    detectMetricCurrentMode: '当前模式 / Current Mode',
    detectMetricHistory: '检测历史 / History',
    detectMetricSelectedModel: '所选模型 / Selected Model',
    noticeTitle: '使用提示',
    detectModeAnthropic: 'Anthropic 格式',
    detectModeOpenai: 'OpenAI 格式',
    detectRunTitle: '开始检测',
    detectRunStep1: '先选接口地址、认证方式与目标模型，再执行真实请求。',
    detectRunStep2: 'Anthropic 模式会检查知识截止、SSE、thinking 与 usage；OpenAI 模式会检查响应结构、finish_reason、stream、tools 与 Structured Outputs。',
    detectRunStep3: '检测完成后可直接在下方查看原始响应、历史记录、来源 / 画像判定与指标。',
    detectSnapshotTitle: '当前摘要',
    detectSnapshotPage: '当前页面',
    detectSnapshotStatus: '检测状态',
    detectSnapshotEndpoint: '最近接口',
    detectSnapshotModel: '最近模型',
    detectResultCompatibility: '兼容性等级',
    detectResultModel: '模型',
    detectResultEndpoint: '接口',
    detectResultSummaryDefault: '系统将根据响应结构、finish_reason、stream / usage、tools、Structured Outputs 与可用画像证据生成综合判断。快速模式下会跳过深度来源分析。',
    detectChecklistTitle: '检查项',
    detectMetricsTitle: '性能指标',
    detectSourceVerdictLabel: '判定结果',
    detectSourceConfidenceLabel: '置信度',
    detectSourcePlatformLabel: '平台线索',
    detectSourceRatelimitLabel: 'Ratelimit',
    detectSourceEvidenceEmpty: '检测完成后展示来源证据',
    detectScanModelHeader: '模型',
    detectScanVerdictHeader: '来源判定',
    detectScanConfidenceHeader: '置信度',
    detectScanLatencyHeader: '平均延迟',
    detectScanRatelimitHeader: 'Ratelimit',
    detectScanSummaryHeader: '摘要',
    detectScanSummaryDefault: '扫描常见模型后，可快速判断同一中转站是否存在混合渠道。',
    needleMetricTestModel: '测试模型 / Test Model',
    needleMetricMatrix: '测试矩阵 / Matrix',
    needleMetricContext: '上下文范围 / Context',
    needleMetricDepth: '插入深度 / Needle Depth',
    needleSectionConnectionTitle: '接口配置',
    needleApiUrl: 'API 接口地址',
    needleApiKey: 'API KEY',
    needleModelLabel: '模型名',
    needleFormatLabel: '格式',
    needleModeOpenai: 'OpenAI 格式',
    needleModeAnthropic: 'Anthropic 格式',
    needlePromptMatrixTitle: '测试参数',
    needleNeedleLabel: 'Needle（要隐藏的关键信息）',
    needleQuestionLabel: '检索问题',
    needleExpectedAnswerPlaceholder: '可留空，关键词模式下默认使用 Needle 本文',
    needleCtxMinLabel: '最小上下文长度 (tokens)',
    needleCtxMaxLabel: '最大上下文长度 (tokens)',
    needleCtxIntervalsLabel: '长度间隔数',
    needleDepthMinLabel: '最小深度 (%)',
    needleDepthMaxLabel: '最大深度 (%)',
    needleDepthIntervalsLabel: '深度间隔数',
    needleRunTitle: '开始测试',
    needleRunStep1: '系统会生成“上下文长度 × 插入深度”的测试矩阵。',
    needleRunStep2: '每一组都会向目标接口发送一次真实请求，并统计检索得分与延迟。',
    needleRunStep3: '热力图越靠近深色，代表该位置下的检索能力越强。',
    needlePresetNote: 'GPT-5.4 验真预设会自动填入 OpenAI / gpt-5.4 / 128k→256k / 深度 10%-90% 的复核矩阵。',
    needleProgressTitle: '测试进度',
    needleSummaryTitle: '测试说明',
    needleSummaryPage: '当前页面',
    needleSummaryHeatmap: '热力图说明',
    needleSummaryHeatmapValue: '0% → 100% 检索命中率',
    needleSummaryPurpose: '用途',
    needleSummaryPurposeValue: '观察长上下文检索衰减',
    needleResultTitle: '测试结果热力图',
    needleResultSummary: '灰度越深，代表该上下文长度与深度位置下的检索得分越高。',
    footerTitle: 'APIMASTER · AI API 检测与长上下文测试工作台',
    alertText: '为保障账户安全，建议优先使用测试专用 API Key。本工具不会把 API Key 持久化保存在浏览器；Key 仅在当前页面会话中使用，并会随你发起的请求发送到目标接口。',
    keyStorageNote: '默认不记住 API Key，刷新页面后需要重新输入。',
    configTitle: '接口配置',
    apiUrl: 'API 接口地址',
    apiKey: 'API KEY',
    modeTitle: '检测方式',
    modelTitle: '目标模型',
    modelId: '实际模型名（可自定义修改）',
    modelHint: '部分中转站可能需要修改模型名，例如添加前缀 <code>[特价]-</code> 或后缀 <code>-no-thinking</code>。上面的 Anthropic / OpenAI 检测方式与模型卡片独立，可自由切换组合。',
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
    hideResponse: '隐藏响应内容',
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
    detectCurrentCardPrefix: '当前卡片：',
    detectSelectModelHint: '选择预置模型或手动输入实际模型名',
    detectLatestPrefix: '最近一次：',
    detectAutoUpdateNote: '完成一次检测后自动更新',
    needleMatrixNote: ({ total }) => `预计执行 ${total} 组组合`,
    needleContextNote: ({ count }) => `${count} 档长度采样`,
    needleDepthNote: ({ count }) => `${count} 档深度采样`,
  },
  en: {
    documentTitle: 'ApiMaster - AI API Detection & Needle Testing',
    documentDescription: 'AI API relay inspection tool with custom model names and long-context needle-in-a-haystack retrieval testing',
    toggleKeyTitle: 'Show / hide',
    clearKeyTitle: 'Clear',
    notSet: 'Not set',
    statusPending: 'Pending',
    detectStatusWaiting: 'Waiting',
    needleStatusWaiting: 'Not started yet',
    detectMetricLastScore: 'Last Score',
    detectMetricCurrentMode: 'Current Mode',
    detectMetricHistory: 'History',
    detectMetricSelectedModel: 'Selected Model',
    noticeTitle: 'Usage Notes',
    detectModeAnthropic: 'Anthropic Format',
    detectModeOpenai: 'OpenAI Format',
    detectRunTitle: 'Start Detection',
    detectRunStep1: 'Pick the endpoint, auth method, and target model first, then send a real request.',
    detectRunStep2: 'Anthropic mode checks knowledge cutoff, SSE, thinking, and usage; OpenAI mode checks response shape, finish_reason, stream, tools, and structured outputs.',
    detectRunStep3: 'After the run, review the raw response, history, source or profile verdicts, and metrics below.',
    detectSnapshotTitle: 'Current Snapshot',
    detectSnapshotPage: 'Current Page',
    detectSnapshotStatus: 'Detection Status',
    detectSnapshotEndpoint: 'Latest Endpoint',
    detectSnapshotModel: 'Latest Model',
    detectResultCompatibility: 'Compatibility',
    detectResultModel: 'Model',
    detectResultEndpoint: 'Endpoint',
    detectResultSummaryDefault: 'The system will combine response structure, finish_reason, stream or usage, tools, structured outputs, and available upstream evidence into an overall verdict. Quick mode skips deep source analysis.',
    detectChecklistTitle: 'Checklist',
    detectMetricsTitle: 'Metrics',
    detectSourceVerdictLabel: 'Verdict',
    detectSourceConfidenceLabel: 'Confidence',
    detectSourcePlatformLabel: 'Platform Clues',
    detectSourceRatelimitLabel: 'Ratelimit',
    detectSourceEvidenceEmpty: 'Source evidence will appear after detection.',
    detectScanModelHeader: 'Model',
    detectScanVerdictHeader: 'Source Verdict',
    detectScanConfidenceHeader: 'Confidence',
    detectScanLatencyHeader: 'Avg Latency',
    detectScanRatelimitHeader: 'Ratelimit',
    detectScanSummaryHeader: 'Summary',
    detectScanSummaryDefault: 'Scanning common models helps reveal whether the same relay mixes upstream channels.',
    needleMetricTestModel: 'Test Model',
    needleMetricMatrix: 'Matrix',
    needleMetricContext: 'Context Range',
    needleMetricDepth: 'Needle Depth',
    needleSectionConnectionTitle: 'API Configuration',
    needleApiUrl: 'API Endpoint',
    needleApiKey: 'API Key',
    needleModelLabel: 'Model Name',
    needleFormatLabel: 'Format',
    needleModeOpenai: 'OpenAI Format',
    needleModeAnthropic: 'Anthropic Format',
    needlePromptMatrixTitle: 'Test Parameters',
    needleNeedleLabel: 'Needle (hidden key information)',
    needleQuestionLabel: 'Retrieval Question',
    needleExpectedAnswerPlaceholder: 'Optional. Keyword mode falls back to the needle text.',
    needleCtxMinLabel: 'Minimum Context Length (tokens)',
    needleCtxMaxLabel: 'Maximum Context Length (tokens)',
    needleCtxIntervalsLabel: 'Context Intervals',
    needleDepthMinLabel: 'Minimum Depth (%)',
    needleDepthMaxLabel: 'Maximum Depth (%)',
    needleDepthIntervalsLabel: 'Depth Intervals',
    needleRunTitle: 'Start Test',
    needleRunStep1: 'The system builds a matrix of context length × insertion depth.',
    needleRunStep2: 'Each cell sends one real request to the target endpoint and records retrieval score plus latency.',
    needleRunStep3: 'Darker heatmap cells indicate stronger retrieval performance at that position.',
    needlePresetNote: 'The GPT-5.4 authenticity preset auto-fills an OpenAI / gpt-5.4 / 128k→256k / depth 10%-90% verification matrix.',
    needleProgressTitle: 'Test Progress',
    needleSummaryTitle: 'Summary Notes',
    needleSummaryPage: 'Current Page',
    needleSummaryHeatmap: 'Heatmap Legend',
    needleSummaryHeatmapValue: '0% → 100% retrieval hit rate',
    needleSummaryPurpose: 'Purpose',
    needleSummaryPurposeValue: 'Observe long-context retrieval degradation',
    needleResultTitle: 'Needle Test Heatmap',
    needleResultSummary: 'Darker shades indicate higher retrieval scores at that context length and insertion depth.',
    footerTitle: 'APIMASTER · AI API Detection & Long-Context Testing Workbench',
    alertText: 'For security, use a test-only API key. This tool does not persist your API key in browser storage; it stays in the current page session only and is sent only to the endpoint you request.',
    keyStorageNote: 'API keys are not remembered by default. Refreshing the page will require entering the key again.',
    configTitle: 'API Configuration',
    apiUrl: 'API Endpoint',
    apiKey: 'API Key',
    modeTitle: 'Detection Mode',
    modelTitle: 'Target Model',
    modelId: 'Actual model name (editable)',
    modelHint: '💡 Relay APIs may need modified names, such as prefix <code>[promo]-</code> or suffix <code>-no-thinking</code>. The Anthropic/OpenAI detection mode above is independent from the model cards, so you can mix them freely.',
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
    hideResponse: 'Hide Response',
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
    detectCurrentCardPrefix: 'Current card: ',
    detectSelectModelHint: 'Choose a preset model or enter the actual model name manually.',
    detectLatestPrefix: 'Latest run: ',
    detectAutoUpdateNote: 'Updates automatically after one completed detection.',
    needleMatrixNote: ({ total }) => `Estimated ${total} combinations.`,
    needleContextNote: ({ count }) => `${count} context samples.`,
    needleDepthNote: ({ count }) => `${count} depth samples.`,
  },
};

document.addEventListener('DOMContentLoaded', () => {
  ApiDetect.init();
  NeedleTest.init();

  setupTabs();
  setupTheme();
  setupLang();
  setupOverviewBindings();
  syncConfig();
  updateAllOverview();
});

function isEnglishUi() {
  return AppRuntime.lang === 'en';
}

function getAppTextCatalog(lang = AppRuntime.lang) {
  return APP_TEXT[lang === 'en' ? 'en' : 'zh'];
}

function getAppText(key, vars) {
  const catalog = getAppTextCatalog();
  const fallback = APP_TEXT.zh;
  const value = catalog[key] ?? fallback[key];
  if (typeof value === 'function') {
    return value(vars || {});
  }
  return value;
}

function setHtml(id, value) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = value;
}

function setAttr(id, attr, value) {
  const el = document.getElementById(id);
  if (el) el.setAttribute(attr, value);
}

function applyDataI18n(catalog = getAppTextCatalog()) {
  document.querySelectorAll('[data-i18n-key]').forEach((el) => {
    const key = el.dataset.i18nKey;
    if (!key || catalog[key] === undefined) return;
    el.textContent = typeof catalog[key] === 'function' ? catalog[key]({}) : catalog[key];
  });

  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    const key = el.dataset.i18nPlaceholder;
    if (!key || catalog[key] === undefined || !('placeholder' in el)) return;
    el.placeholder = typeof catalog[key] === 'function' ? catalog[key]({}) : catalog[key];
  });

  document.querySelectorAll('[data-i18n-title]').forEach((el) => {
    const key = el.dataset.i18nTitle;
    if (!key || catalog[key] === undefined) return;
    el.setAttribute('title', typeof catalog[key] === 'function' ? catalog[key]({}) : catalog[key]);
  });
}

function isDefaultDetectStatus(value = '') {
  return ['待开始', 'Pending', '等待检测', 'Waiting'].includes(String(value || '').trim());
}

function isDefaultNeedleStatus(value = '') {
  return ['待开始', 'Pending', '尚未开始', 'Not started yet'].includes(String(value || '').trim());
}

function applyLanguage(lang) {
  const nextLang = lang === 'en' ? 'en' : 'zh';
  const isEn = nextLang === 'en';
  const t = getAppTextCatalog(nextLang);
  const langBtn = document.getElementById('lang-toggle');
  const needleTitleEl = document.getElementById('entry-needle-title');
  const html = document.documentElement;
  const descriptionMeta = document.querySelector('meta[name="description"]');

  AppRuntime.lang = nextLang;
  saveConfig('lang', nextLang);

  if (isDefaultDetectStatus(AppRuntime.detectStatus)) {
    AppRuntime.detectStatus = t.statusPending;
  }
  if (isDefaultNeedleStatus(AppRuntime.needleStatus)) {
    AppRuntime.needleStatus = t.needleStatusWaiting;
  }

  if (langBtn) {
    langBtn.textContent = isEn ? '中文' : 'EN';
  }
  if (html) {
    html.lang = isEn ? 'en' : 'zh-CN';
  }
  if (descriptionMeta) {
    descriptionMeta.setAttribute('content', t.documentDescription);
  }
  document.title = t.documentTitle;

  refreshThemeUiText();
  applyDataI18n(t);

  setText('entry-detect-kicker', isEn ? 'API Compatibility' : '接口兼容性检测');
  setText('entry-detect-title', isEn ? 'Open API Detection' : '进入 API 检测');
  setText('entry-detect-note', isEn ? 'Check model compatibility, knowledge cutoff, thinking, usage, and SSE response structure.' : '检查模型识别、知识截止、thinking、usage 与 SSE 返回结构。');
  setText('entry-detect-meta', isEn ? 'Built for relay authenticity and protocol review' : '适合排查中转站真实性与协议兼容性');
  setText('entry-needle-kicker', isEn ? 'Long-context Retrieval' : '长上下文检索测试');
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
  setHtml('model-hint', t.modelHint);
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
  setText('toggle-response-text', document.getElementById('response-content')?.classList.contains('hidden') ? t.showResponse : t.hideResponse);
  setText('history-title', t.historyTitle);
  setText('btn-clear-history', t.clearCache);
  setText('needle-context-header', t.needleContextHeader);
  setText('needle-depth-header', t.needleDepthHeader);
  setText('needle-score-header', t.needleScoreHeader);
  setText('needle-latency-header', t.needleLatencyHeader);
  setText('needle-status-header', t.needleStatusHeader);
  setAttr('btn-toggle-key', 'title', t.toggleKeyTitle);
  setAttr('btn-clear-key', 'title', t.clearKeyTitle);

  const resultStatusText = document.getElementById('result-status-text');
  const resultInlineStatus = document.getElementById('result-status-inline');
  const resultSummary = document.getElementById('result-summary-copy');
  if (resultStatusText && isDefaultDetectStatus(resultStatusText.textContent)) {
    resultStatusText.textContent = t.detectStatusWaiting;
  }
  if (resultInlineStatus && isDefaultDetectStatus(resultInlineStatus.textContent)) {
    resultInlineStatus.textContent = t.statusPending;
  }
  if (resultSummary && isDefaultDetectStatus(resultStatusText?.textContent || resultInlineStatus?.textContent || '')) {
    resultSummary.textContent = t.detectResultSummaryDefault;
  }

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
}

function setupTheme() {
  const body = document.body;
  const buttons = Array.from(document.querySelectorAll('.theme-btn'));
  if (!body || buttons.length === 0) return;

  function applyTheme(theme) {
    const nextTheme = theme === 'lite' ? 'lite' : 'classic';
    AppRuntime.theme = nextTheme;
    body.dataset.theme = nextTheme;
    buttons.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.theme === nextTheme);
      btn.setAttribute('aria-pressed', btn.dataset.theme === nextTheme ? 'true' : 'false');
    });
    saveConfig('theme', nextTheme);
  }

  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      applyTheme(btn.dataset.theme);
    });
  });

  refreshThemeUiText();
  applyTheme(loadConfig('theme', 'classic'));
}

function refreshThemeUiText() {
  const isEn = AppRuntime.lang === 'en';
  const switcher = document.querySelector('.theme-switch');
  const classicBtn = document.getElementById('theme-classic');
  const liteBtn = document.getElementById('theme-lite');

  if (switcher) {
    switcher.setAttribute('aria-label', isEn ? 'Theme switcher' : '主题切换');
  }
  if (classicBtn) {
    classicBtn.textContent = isEn ? 'Minimal' : '简约';
  }
  if (liteBtn) {
    liteBtn.textContent = isEn ? 'Fresh' : '清新';
  }
}

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
    AppRuntime.detectStatus = event.detail?.statusText || getAppText('statusPending');
    updateAllOverview();
  });

  document.addEventListener('apimaster:needle-status', (event) => {
    AppRuntime.needleStatus = event.detail?.statusText || getAppText('needleStatusWaiting');
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
  const t = getAppTextCatalog();
  const mode = document.querySelector('.mode-btn.active')?.dataset.mode || 'anthropic';
  const requestType = getValue('detect-request-type') === 'stream' ? 'stream' : 'nonstream';
  const analysisDepth = getValue('detect-analysis-depth') === 'quick' ? 'quick' : 'deep';
  const withThinking = document.getElementById('with-thinking')?.checked ?? true;
  const modelId = getValue('model-id') || t.notSet;
  const selectedCard = document.querySelector('.model-card.active .model-card-name')?.textContent?.trim();
  const history = loadConfig('history', []);
  const last = history[0];
  const requestTypeLabel = requestType === 'stream'
    ? (isEnglishUi() ? 'Stream' : '流式调用')
    : (isEnglishUi() ? 'Non-stream' : '非流式调用');
  const analysisDepthLabel = analysisDepth === 'quick'
    ? (isEnglishUi() ? 'Quick' : '快速')
    : (isEnglishUi() ? 'Deep' : '深度');

  setText('detect-stat-mode', mode === 'anthropic' ? 'Anthropic' : 'OpenAI');
  setText(
    'detect-note-mode',
    mode === 'anthropic'
      ? `/v1/messages · ${requestTypeLabel} · ${analysisDepthLabel} · ${withThinking ? 'Thinking On' : 'Thinking Off'}`
      : `/v1/chat/completions · ${requestTypeLabel} · ${analysisDepthLabel}`
  );

  setText('detect-stat-model', modelId);
  setText('detect-note-model', selectedCard ? `${t.detectCurrentCardPrefix}${selectedCard}` : t.detectSelectModelHint);

  setText('detect-stat-history', String(history.length));
  setText('detect-note-history', history.length > 0 ? `${t.detectLatestPrefix}${formatCompactTime(history[0].time)}` : t.historyEmpty);

  if (last) {
    setText('detect-stat-last-score', `${last.score}%`);
    setText('detect-note-last-score', `${scoreLabel(last.score)} · ${last.model}`);
  } else {
    setText('detect-stat-last-score', '--');
    setText('detect-note-last-score', t.detectAutoUpdateNote);
  }

  const inlineStatus = document.getElementById('result-status-inline');
  const inlineEndpoint = document.getElementById('result-endpoint-inline');
  const inlineModel = document.getElementById('result-model-inline');
  if (inlineStatus && isDefaultDetectStatus(inlineStatus.textContent)) {
    inlineStatus.textContent = AppRuntime.detectStatus || t.statusPending;
  }
  if (inlineEndpoint && inlineEndpoint.textContent === '--') {
    inlineEndpoint.textContent = extractHostname(getValue('api-url') || '--');
  }
  if (inlineModel && inlineModel.textContent === '--') {
    inlineModel.textContent = modelId || '--';
  }
}

function updateNeedleOverview() {
  const t = getAppTextCatalog();
  const model = getValue('needle-model') || t.notSet;
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
    `${mode === 'anthropic' ? 'Anthropic' : 'OpenAI'} ${isEnglishUi() ? 'format' : '请求格式'} · ${requestType === 'stream'
      ? (isEnglishUi() ? 'Stream' : '流式调用')
      : (isEnglishUi() ? 'Non-stream' : '非流式调用')} · ${getNeedleScoringModeLabel(scoringMode)}`
  );
  setText('needle-stat-matrix', `${ctxCount} × ${depthCount}`);
  setText('needle-note-matrix', getAppText('needleMatrixNote', { total }));
  setText('needle-stat-context', `${ctxMin} → ${ctxMax}`);
  setText('needle-note-context', getAppText('needleContextNote', { count: ctxCount }));
  setText('needle-stat-depth', `${depthMin}% → ${depthMax}%`);
  setText('needle-note-depth', getAppText('needleDepthNote', { count: depthCount }));
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
  if (!langBtn) return;

  langBtn.addEventListener('click', () => {
    applyLanguage(isEnglishUi() ? 'zh' : 'en');
  });

  applyLanguage(AppRuntime.lang);
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
