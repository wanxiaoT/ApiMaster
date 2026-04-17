/* ── Needle in Haystack Module ─────────────── */

const NeedleTest = (() => {
  let isRunning = false;
  let isPaused = false;
  let pauseRequested = false;
  let stopRequested = false;
  let currentAbortController = null;
  let buttonState = 'idle';
  let results = [];
  let latestMatrix = {
    contextLengths: [],
    depths: [],
    model: '',
    mode: 'openai',
    requestType: 'nonstream',
  };
  let runtime = {
    totalTests: 0,
    completed: 0,
    model: '',
    mode: 'openai',
    requestType: 'nonstream',
    currentContext: null,
    currentDepth: null,
  };

  const BUTTON_LABELS = {
    zh: {
      idle: '开始测试',
      running: '暂停测试',
      pausePending: '暂停中...',
      stopPending: '停止中...',
      paused: '继续测试',
      stop: '停止测试',
    },
    en: {
      idle: 'Start Test',
      running: 'Pause Test',
      pausePending: 'Pausing...',
      stopPending: 'Stopping...',
      paused: 'Resume Test',
      stop: 'Stop Test',
    },
  };

  const GPT54_AUTH_PRESET = {
    model: 'gpt-5.4',
    mode: 'openai',
    requestType: 'nonstream',
    needle: 'Verification phrase: cobalt chrysanthemum zephyr lighthouse peninsula marigold.',
    question: 'What is the verification phrase? Reply with the exact phrase only.',
    expectedAnswer: 'cobalt chrysanthemum zephyr lighthouse peninsula marigold',
    scoringMode: 'exact',
    ctxMin: 128000,
    ctxMax: 256000,
    ctxIntervals: 1,
    depthMin: 10,
    depthMax: 90,
    depthIntervals: 2,
  };

  function getSharedApiUrl() {
    const detectInputValue = document.getElementById('api-url')?.value?.trim();
    return detectInputValue || loadConfig('apiUrl', '');
  }

  function getSharedApiKey() {
    const detectInputValue = document.getElementById('api-key')?.value?.trim();
    return detectInputValue || loadVolatileConfig('apiKey', '');
  }

  function init() {
    setupStartButton();
    setupStopButton();
    setupPresetButton();
    setupExportButtons();
    bindNeedleInputs();
    loadSavedNeedleConfig();
    updateStartButton('idle');
    updateStopButton();
    updateExportButtons();
    updatePresetIndicators();
    updateAuthenticityIndicator(resolveStoredAuthenticitySummary());
  }

  function setupStartButton() {
    const button = document.getElementById('btn-needle-start');
    if (!button) return;

    button.addEventListener('click', () => {
      if (!isRunning) {
        runNeedleTest();
        return;
      }

      if (isPaused) {
        resumeNeedleTest();
        return;
      }

      requestPause();
    });
  }

  function setupStopButton() {
    const button = document.getElementById('btn-needle-stop');
    if (!button) return;

    button.addEventListener('click', () => {
      requestStop();
    });
  }

  function setupPresetButton() {
    const button = document.getElementById('btn-needle-gpt54-preset');
    if (!button) return;

    button.addEventListener('click', () => {
      applyGpt54AuthenticityPreset();
    });
  }

  function setupExportButtons() {
    document.getElementById('btn-export-heatmap')?.addEventListener('click', exportHeatmapImage);
    document.getElementById('btn-export-needle-csv')?.addEventListener('click', exportNeedleCsv);
  }

  function bindNeedleInputs() {
    const ids = [
      'needle-api-url',
      'needle-api-key',
      'needle-model',
      'needle-mode',
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
    ];

    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;

      const eventName = el.tagName === 'SELECT' ? 'change' : 'input';
      el.addEventListener(eventName, () => {
        if (id === 'needle-mode') {
          el.dataset.userSet = 'true';
        } else if (id === 'needle-api-url' || id === 'needle-api-key') {
          if (typeof el.value === 'string' && el.value.trim()) {
            el.dataset.userSet = 'true';
          } else {
            delete el.dataset.userSet;
          }
        }
        saveNeedleSettings();
        updatePresetIndicators();
        updateAuthenticityIndicator(null);
      });
    });
  }

  function loadSavedNeedleConfig() {
    const url = getSharedApiUrl();
    const key = getSharedApiKey();
    if (url) document.getElementById('needle-api-url').value = url;
    if (key) document.getElementById('needle-api-key').value = key;

    const settings = loadConfig('needleSettings', null);
    const modeSelect = document.getElementById('needle-mode');
    const requestTypeSelect = document.getElementById('needle-request-type');

    if (settings) {
      document.getElementById('needle-model').value = settings.model || '';
      if (modeSelect) {
        modeSelect.value = settings.mode || 'openai';
        if (settings.mode) {
          modeSelect.dataset.userSet = 'true';
        }
      }
      if (requestTypeSelect) {
        requestTypeSelect.value = settings.requestType === 'stream' ? 'stream' : 'nonstream';
      }
      document.getElementById('needle-text').value = settings.needle || '';
      document.getElementById('needle-question').value = settings.question || '';
      document.getElementById('needle-expected-answer').value = settings.expectedAnswer || '';
      document.getElementById('needle-scoring-mode').value = settings.scoringMode || 'keyword';
      document.getElementById('needle-ctx-min').value = settings.ctxMin ?? 1000;
      document.getElementById('needle-ctx-max').value = settings.ctxMax ?? 8000;
      document.getElementById('needle-ctx-intervals').value = settings.ctxIntervals ?? 5;
      document.getElementById('needle-depth-min').value = settings.depthMin ?? 0;
      document.getElementById('needle-depth-max').value = settings.depthMax ?? 100;
      document.getElementById('needle-depth-intervals').value = settings.depthIntervals ?? 5;
    } else if (requestTypeSelect) {
      requestTypeSelect.value = 'nonstream';
    }

    const defaultNeedle = 'The best thing to do in San Francisco is eat a sandwich and sit in Dolores Park on a sunny day.';
    const defaultQuestion = 'What is the best thing to do in San Francisco?';
    if (!document.getElementById('needle-text').value) {
      document.getElementById('needle-text').value = defaultNeedle;
    }
    if (!document.getElementById('needle-question').value) {
      document.getElementById('needle-question').value = defaultQuestion;
    }
    if (!document.getElementById('needle-scoring-mode').value) {
      document.getElementById('needle-scoring-mode').value = 'keyword';
    }

    saveNeedleSettings();
    updatePresetIndicators();
    updateAuthenticityIndicator(resolveStoredAuthenticitySummary());
  }

  function saveNeedleSettings() {
    saveConfig('needleSettings', {
      model: document.getElementById('needle-model').value.trim(),
      mode: document.getElementById('needle-mode').value,
      requestType: document.getElementById('needle-request-type').value === 'stream' ? 'stream' : 'nonstream',
      needle: document.getElementById('needle-text').value,
      question: document.getElementById('needle-question').value,
      expectedAnswer: document.getElementById('needle-expected-answer').value,
      scoringMode: document.getElementById('needle-scoring-mode').value || 'keyword',
      ctxMin: parseInt(document.getElementById('needle-ctx-min').value, 10) || 1000,
      ctxMax: parseInt(document.getElementById('needle-ctx-max').value, 10) || 8000,
      ctxIntervals: Math.max(0, parseInt(document.getElementById('needle-ctx-intervals').value, 10) || 5),
      depthMin: parseInt(document.getElementById('needle-depth-min').value, 10) || 0,
      depthMax: parseInt(document.getElementById('needle-depth-max').value, 10) || 100,
      depthIntervals: Math.max(0, parseInt(document.getElementById('needle-depth-intervals').value, 10) || 5),
    });
  }

  function getCurrentSettings() {
    return {
      model: document.getElementById('needle-model')?.value?.trim() || '',
      mode: document.getElementById('needle-mode')?.value || 'openai',
      requestType: document.getElementById('needle-request-type')?.value === 'stream' ? 'stream' : 'nonstream',
      needle: document.getElementById('needle-text')?.value || '',
      question: document.getElementById('needle-question')?.value || '',
      expectedAnswer: document.getElementById('needle-expected-answer')?.value || '',
      scoringMode: document.getElementById('needle-scoring-mode')?.value || 'keyword',
      ctxMin: parseInt(document.getElementById('needle-ctx-min')?.value, 10) || 1000,
      ctxMax: parseInt(document.getElementById('needle-ctx-max')?.value, 10) || 8000,
      ctxIntervals: Math.max(0, parseInt(document.getElementById('needle-ctx-intervals')?.value, 10) || 5),
      depthMin: parseInt(document.getElementById('needle-depth-min')?.value, 10) || 0,
      depthMax: parseInt(document.getElementById('needle-depth-max')?.value, 10) || 100,
      depthIntervals: Math.max(0, parseInt(document.getElementById('needle-depth-intervals')?.value, 10) || 5),
    };
  }

  function applyGpt54AuthenticityPreset() {
    const preset = GPT54_AUTH_PRESET;
    const apiUrl = getSharedApiUrl();
    const apiKey = getSharedApiKey();
    const apiUrlInput = document.getElementById('needle-api-url');
    const apiKeyInput = document.getElementById('needle-api-key');
    const modelInput = document.getElementById('needle-model');
    const modeSelect = document.getElementById('needle-mode');
    const requestTypeSelect = document.getElementById('needle-request-type');
    const needleInput = document.getElementById('needle-text');
    const questionInput = document.getElementById('needle-question');
    const expectedAnswerInput = document.getElementById('needle-expected-answer');
    const scoringModeSelect = document.getElementById('needle-scoring-mode');

    if (apiUrlInput && !apiUrlInput.value && apiUrl) apiUrlInput.value = apiUrl;
    if (apiKeyInput && !apiKeyInput.value && apiKey) apiKeyInput.value = apiKey;
    if (modelInput) modelInput.value = preset.model;
    if (modeSelect) {
      modeSelect.value = preset.mode;
      modeSelect.dataset.userSet = 'true';
    }
    if (requestTypeSelect) requestTypeSelect.value = preset.requestType;
    if (needleInput) needleInput.value = preset.needle;
    if (questionInput) questionInput.value = preset.question;
    if (expectedAnswerInput) expectedAnswerInput.value = preset.expectedAnswer;
    if (scoringModeSelect) scoringModeSelect.value = preset.scoringMode;

    document.getElementById('needle-ctx-min').value = preset.ctxMin;
    document.getElementById('needle-ctx-max').value = preset.ctxMax;
    document.getElementById('needle-ctx-intervals').value = preset.ctxIntervals;
    document.getElementById('needle-depth-min').value = preset.depthMin;
    document.getElementById('needle-depth-max').value = preset.depthMax;
    document.getElementById('needle-depth-intervals').value = preset.depthIntervals;

    saveNeedleSettings();
    updatePresetIndicators();
    updateAuthenticityIndicator(null);

    const statusEl = document.getElementById('needle-status');
    const resultSummary = document.getElementById('needle-result-summary');
    const { contextLengths, depths } = getMatrixValues(getCurrentSettings());
    const total = contextLengths.length * depths.length;
    if (statusEl && !isRunning) {
      statusEl.textContent = getCurrentLang() === 'en'
        ? `GPT-5.4 authenticity preset loaded. Matrix: ${contextLengths.join(' / ')} tokens × depths ${depths.join(' / ')}%.`
        : `已载入 GPT-5.4 长上下文验真预设：上下文 ${contextLengths.join(' / ')} tokens × 深度 ${depths.join(' / ')}%。`;
    }
    if (resultSummary && results.length === 0) {
      resultSummary.textContent = getCurrentLang() === 'en'
        ? `Preset ready: ${total} live requests covering 128k→256k long context, designed as a GPT-5.4 authenticity cross-check.`
        : `预设已就绪：共 ${total} 个真实请求，覆盖 128k→256k 长上下文，用于 GPT-5.4 验真复核。`;
    }
  }

  function buildRange(min, max, intervals) {
    const safeIntervals = Math.max(0, intervals);
    if (safeIntervals === 0) return [Math.round(min)];

    const values = [];
    for (let i = 0; i <= safeIntervals; i++) {
      values.push(Math.round(min + (max - min) * (i / safeIntervals)));
    }
    return values;
  }

  function getMatrixValues(settings) {
    return {
      contextLengths: buildRange(settings.ctxMin, settings.ctxMax, settings.ctxIntervals),
      depths: buildRange(settings.depthMin, settings.depthMax, settings.depthIntervals),
    };
  }

  function isGpt54FamilyModel(model) {
    return /^gpt-5\.4(?:$|-)/i.test(String(model || '').trim());
  }

  function isGpt54LongContextConfig(settings = getCurrentSettings()) {
    const { contextLengths } = getMatrixValues(settings);
    return settings.mode === 'openai'
      && isGpt54FamilyModel(settings.model)
      && contextLengths.some((value) => value >= 128000);
  }

  function isExactGpt54Preset(settings = getCurrentSettings()) {
    const { contextLengths, depths } = getMatrixValues(settings);
    return settings.mode === 'openai'
      && isGpt54FamilyModel(settings.model)
      && settings.requestType === 'nonstream'
      && settings.scoringMode === 'exact'
      && normalizeTextForPreset(settings.expectedAnswer) === normalizeTextForPreset(GPT54_AUTH_PRESET.expectedAnswer)
      && contextLengths.length === 2
      && contextLengths[0] === 128000
      && contextLengths[1] === 256000
      && depths.length === 3
      && depths[0] === 10
      && depths[1] === 50
      && depths[2] === 90;
  }

  function updatePresetIndicators() {
    const settings = getCurrentSettings();
    const { contextLengths, depths } = getMatrixValues(settings);
    const presetText = document.getElementById('needle-preset-text');
    const presetNote = document.getElementById('needle-preset-note');

    if (presetText) {
      if (isExactGpt54Preset(settings)) {
        presetText.textContent = getCurrentLang() === 'en'
          ? 'GPT-5.4 preset · 128k/256k × 10/50/90'
          : 'GPT-5.4 预设 · 128k/256k × 10/50/90';
      } else if (isGpt54LongContextConfig(settings)) {
        presetText.textContent = getCurrentLang() === 'en'
          ? `GPT-5.4 custom matrix · ${contextLengths.length}×${depths.length}`
          : `GPT-5.4 自定义矩阵 · ${contextLengths.length}×${depths.length}`;
      } else {
        presetText.textContent = getCurrentLang() === 'en'
          ? `Manual matrix · ${contextLengths.length}×${depths.length}`
          : `手动矩阵 · ${contextLengths.length}×${depths.length}`;
      }
    }

    if (presetNote) {
      if (isExactGpt54Preset(settings)) {
        presetNote.textContent = getCurrentLang() === 'en'
          ? 'Loaded GPT-5.4 authenticity preset: OpenAI / gpt-5.4 / 128k→256k / depths 10%-90% with exact-match scoring, for 6 live retrieval checks.'
          : '当前已载入 GPT-5.4 验真预设：OpenAI / gpt-5.4 / 128k→256k / 深度 10%-90%，并启用完全匹配评分，共 6 组真实检索请求。';
      } else {
        presetNote.textContent = getCurrentLang() === 'en'
          ? 'The GPT-5.4 authenticity preset auto-fills OpenAI / gpt-5.4 / 128k→256k / depths 10%-90% with exact-match scoring for a low-cost long-context cross-check.'
          : 'GPT-5.4 验真预设会自动填入 OpenAI / gpt-5.4 / 128k→256k / 深度 10%-90%，并启用完全匹配评分，形成低成本长上下文复核矩阵。';
      }
    }
  }

  function updateAuthenticityIndicator(summary) {
    const authText = document.getElementById('needle-auth-text');
    if (!authText) return;

    if (summary && summary.type === 'gpt54_long_context') {
      authText.textContent = `${getGpt54VerdictLabel(summary.verdict)} · ${summary.averageScore}%`;
      authText.title = formatStoredGpt54SummaryText(summary);
      return;
    }

    const settings = getCurrentSettings();
    authText.title = '';
    authText.textContent = isGpt54LongContextConfig(settings)
      ? (getCurrentLang() === 'en' ? 'Ready for GPT-5.4 cross-check' : '可用于 GPT-5.4 复核')
      : (getCurrentLang() === 'en' ? 'Not run yet' : '尚未运行');
  }

  function sameNumberArray(a = [], b = []) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((value, index) => Number(value) === Number(b[index]));
  }

  function resolveStoredAuthenticitySummary() {
    const summary = loadConfig('needleAuthenticitySummary', null);
    if (!summary || summary.type !== 'gpt54_long_context') return null;

    const settings = getCurrentSettings();
    const { contextLengths, depths } = getMatrixValues(settings);
    if (settings.mode !== 'openai' || !isGpt54FamilyModel(settings.model)) return null;
    if (!sameNumberArray(summary.contextLengths, contextLengths)) return null;
    if (!sameNumberArray(summary.depths, depths)) return null;
    return summary;
  }

  function getGpt54VerdictLabel(verdict) {
    const labelMap = getCurrentLang() === 'en'
      ? {
          strong: 'Strong pass',
          pass: 'Pass',
          warning: 'Review needed',
          weak: 'Weak',
        }
      : {
          strong: '强通过',
          pass: '基本通过',
          warning: '待复核',
          weak: '偏弱',
        };
    return labelMap[verdict] || labelMap.weak;
  }

  function formatStoredGpt54SummaryText(summary) {
    if (!summary || summary.type !== 'gpt54_long_context') return '';
    const contextSummary = Array.isArray(summary.perContext)
      ? summary.perContext.map((item) => `${Math.round(item.contextLength / 1000)}k=${item.averageScore}%`).join(' · ')
      : '';
    return getCurrentLang() === 'en'
      ? `GPT-5.4 long-context cross-check: overall ${summary.averageScore}%, ${contextSummary}, deep-depth average ${summary.deepAverage}%, success ${summary.successCount}/${summary.totalTests}.`
      : `GPT-5.4 长上下文复核：整体 ${summary.averageScore}%，${contextSummary}，深层平均 ${summary.deepAverage}%，成功 ${summary.successCount}/${summary.totalTests}。`;
  }

  function averageScoreFor(items) {
    return items.length > 0
      ? Math.round(items.reduce((sum, item) => sum + item.retrievalScore, 0) / items.length)
      : 0;
  }

  function buildGpt54NeedleSummary(testResults = results, matrix = latestMatrix) {
    const contextLengths = Array.isArray(matrix?.contextLengths) ? matrix.contextLengths : [];
    const depths = Array.isArray(matrix?.depths) ? matrix.depths : [];
    if (!isGpt54FamilyModel(matrix?.model) || matrix?.mode !== 'openai' || contextLengths.length === 0 || testResults.length === 0) {
      return null;
    }
    if (!contextLengths.some((value) => value >= 128000)) {
      return null;
    }

    const successCount = testResults.filter((item) => item.ok).length;
    const totalTests = testResults.length;
    const averageScore = averageScoreFor(testResults);
    const perContext = contextLengths.map((contextLength) => {
      const bucket = testResults.filter((item) => item.contextLength === contextLength);
      return { contextLength, averageScore: averageScoreFor(bucket) };
    });
    const highContextBuckets = perContext.filter((item) => item.contextLength >= 128000);
    const worstHighContext = highContextBuckets.length > 0
      ? Math.min(...highContextBuckets.map((item) => item.averageScore))
      : averageScore;
    const maxContext = Math.max(...contextLengths);
    const maxContextAverage = perContext.find((item) => item.contextLength === maxContext)?.averageScore || 0;
    const deepThreshold = depths.some((value) => value >= 80) ? 80 : Math.max(...depths);
    const deepAverage = averageScoreFor(testResults.filter((item) => item.depthPercent >= deepThreshold));

    let verdict = 'weak';
    if (successCount === totalTests && averageScore >= 85 && worstHighContext >= 75 && deepAverage >= 70) {
      verdict = 'strong';
    } else if (successCount >= Math.max(1, totalTests - 1) && averageScore >= 70 && maxContextAverage >= 60 && deepAverage >= 55) {
      verdict = 'pass';
    } else if (averageScore >= 50 && maxContextAverage >= 40) {
      verdict = 'warning';
    }

    const contextSummary = perContext
      .map((item) => `${Math.round(item.contextLength / 1000)}k=${item.averageScore}%`)
      .join(' · ');

    const summaryText = getCurrentLang() === 'en'
      ? `GPT-5.4 long-context cross-check: overall ${averageScore}%, ${contextSummary}, deep-depth average ${deepAverage}%, success ${successCount}/${totalTests}.`
      : `GPT-5.4 长上下文复核：整体 ${averageScore}%，${contextSummary}，深层平均 ${deepAverage}%，成功 ${successCount}/${totalTests}。`;

    return {
      type: 'gpt54_long_context',
      model: matrix.model,
      mode: matrix.mode,
      contextLengths: [...contextLengths],
      depths: [...depths],
      verdict,
      verdictLabel: getGpt54VerdictLabel(verdict),
      averageScore,
      successCount,
      totalTests,
      perContext,
      deepAverage,
      maxContextAverage,
      summaryText,
    };
  }

  function buildRunIntroSummary({ totalTests, model, requestType, contextLengths, depths, mode }) {
    const isGpt54Check = mode === 'openai' && isGpt54FamilyModel(model) && contextLengths.some((value) => value >= 128000);
    const scoringText = getScoringModeLabel(getCurrentSettings().scoringMode || 'keyword');
    if (isGpt54Check) {
      return getCurrentLang() === 'en'
        ? `GPT-5.4 long-context cross-check: ${totalTests} live requests, contexts ${contextLengths.join(' / ')} tokens, depths ${depths.join(' / ')}%, ${requestType === 'stream' ? 'stream' : 'non-stream'} mode, scoring ${scoringText}.`
        : `GPT-5.4 长上下文复核：共 ${totalTests} 个真实请求，上下文 ${contextLengths.join(' / ')} tokens，深度 ${depths.join(' / ')}%，调用方式为 ${requestType === 'stream' ? '流式' : '非流式'}，评分方式为 ${scoringText}。`;
    }

    return getCurrentLang() === 'en'
      ? `This run will execute ${totalTests} cases using model ${model} in ${requestType === 'stream' ? 'stream' : 'non-stream'} mode with ${scoringText} scoring.`
      : `本次测试将执行 ${totalTests} 组组合，模型为 ${model}，调用方式为 ${requestType === 'stream' ? '流式调用' : '非流式调用'}，评分方式为 ${scoringText}。`;
  }

  function buildRunCompletionSummary({ avgScore, successCount, totalTests, model, mode }) {
    const gpt54Summary = buildGpt54NeedleSummary(results, latestMatrix);
    const corpusCapNote = buildCorpusCapNote(results);
    if (gpt54Summary && mode === 'openai' && isGpt54FamilyModel(model)) {
      return getCurrentLang() === 'en'
        ? `${gpt54Summary.verdictLabel} · ${gpt54Summary.summaryText}${corpusCapNote} Export the heatmap/CSV if you need to compare this relay against the official GPT-5.4 endpoint.`
        : `${gpt54Summary.verdictLabel} · ${gpt54Summary.summaryText}${corpusCapNote} 如需和 OpenAI 官方 GPT-5.4 对照，可继续导出热力图与 CSV。`;
    }

    return getCurrentLang() === 'en'
      ? `Test completed: ${successCount}/${totalTests} cases succeeded, average retrieval score ${avgScore}%.${corpusCapNote} Heatmap PNG and CSV remain available for export.`
      : `测试完成：成功 ${successCount}/${totalTests} 组，平均检索得分 ${avgScore}% 。${corpusCapNote}热力图可导出为 PNG，结果表可导出为 CSV。`;
  }

  function buildStoppedSummary({ completed, totalTests, avgScore }) {
    const gpt54Summary = buildGpt54NeedleSummary(results, latestMatrix);
    const corpusCapNote = buildCorpusCapNote(results);
    if (gpt54Summary) {
      return getCurrentLang() === 'en'
        ? `Run stopped manually at ${completed}/${totalTests}. Current GPT-5.4 long-context cross-check snapshot: ${gpt54Summary.verdictLabel}, average ${avgScore}%.${corpusCapNote}`
        : `测试已手动停止：已完成 ${completed}/${totalTests} 组。当前 GPT-5.4 长上下文复核快照为 ${gpt54Summary.verdictLabel}，平均得分 ${avgScore}%。${corpusCapNote}`;
    }

    return getCurrentLang() === 'en'
      ? `Run stopped manually. Completed ${completed}/${totalTests} cases, average score ${avgScore}%.${corpusCapNote} Existing heatmap and CSV exports remain available.`
      : `测试已手动停止：已完成 ${completed}/${totalTests} 组，当前平均检索得分 ${avgScore}% 。${corpusCapNote}已生成的热力图和 CSV 仍可导出。`;
  }

  function buildCorpusCapNote(testResults = results) {
    const cappedItems = Array.isArray(testResults)
      ? testResults.filter((item) => item?.contextLimited)
      : [];
    if (cappedItems.length === 0) return '';

    const maxEstimatedTokens = cappedItems.reduce((max, item) =>
      Math.max(max, Number(item?.actualHaystackTokens) || Number(item?.contextLength) || 0), 0);

    return getCurrentLang() === 'en'
      ? ` ${cappedItems.length} case(s) hit the local haystack capacity cap; actual haystack length peaked around ${maxEstimatedTokens} tokens.`
      : ` 其中 ${cappedItems.length} 组触发了本地语料容量上限，实际可构造的 haystack 长度最高约 ${maxEstimatedTokens} tokens。`;
  }

  async function runNeedleTest() {
    const apiUrl = document.getElementById('needle-api-url').value.trim();
    const apiKey = document.getElementById('needle-api-key').value.trim();
    const model = document.getElementById('needle-model').value.trim();
    const mode = document.getElementById('needle-mode').value;
    const requestType = document.getElementById('needle-request-type').value === 'stream' ? 'stream' : 'nonstream';
    const needle = document.getElementById('needle-text').value.trim();
    const question = document.getElementById('needle-question').value.trim();
    const expectedAnswer = document.getElementById('needle-expected-answer').value.trim();
    const scoringMode = document.getElementById('needle-scoring-mode').value || 'keyword';
    const ctxMin = parseInt(document.getElementById('needle-ctx-min').value, 10) || 1000;
    const ctxMax = parseInt(document.getElementById('needle-ctx-max').value, 10) || 8000;
    const ctxIntervals = Math.max(0, parseInt(document.getElementById('needle-ctx-intervals').value, 10) || 5);
    const depthMin = parseInt(document.getElementById('needle-depth-min').value, 10) || 0;
    const depthMax = parseInt(document.getElementById('needle-depth-max').value, 10) || 100;
    const depthIntervals = Math.max(0, parseInt(document.getElementById('needle-depth-intervals').value, 10) || 5);

    if (!apiUrl || !apiKey || !model) {
      alert(getCurrentLang() === 'en' ? 'Please fill in the API URL, API key, and model name.' : '请填写 API 地址、Key 和模型名');
      return;
    }
    if (!needle || !question) {
      alert(getCurrentLang() === 'en' ? 'Please fill in the needle and the retrieval question.' : '请填写 Needle 和检索问题');
      return;
    }
    if (['exact', 'contains', 'regex'].includes(scoringMode) && !expectedAnswer) {
      alert(getCurrentLang() === 'en' ? 'This scoring mode requires an expected answer or regex pattern.' : '当前评分方式需要填写参考答案或正则表达式。');
      return;
    }

    saveNeedleSettings();

    const contextLengths = buildRange(ctxMin, ctxMax, ctxIntervals);
    const depths = buildRange(depthMin, depthMax, depthIntervals);
    const totalTests = contextLengths.length * depths.length;

    results = [];
    latestMatrix = { contextLengths, depths, model, mode, requestType };
    runtime = {
      totalTests,
      completed: 0,
      model,
      mode,
      requestType,
      currentContext: null,
      currentDepth: null,
    };

    isRunning = true;
    isPaused = false;
    pauseRequested = false;
    stopRequested = false;
    currentAbortController = null;

    const progressSection = document.getElementById('needle-progress-section');
    const resultSection = document.getElementById('needle-result-section');
    const progressFill = document.querySelector('#needle-progress-bar .progress-fill');
    const progressText = document.getElementById('needle-progress-text');
    const statusEl = document.getElementById('needle-status');
    const resultSummary = document.getElementById('needle-result-summary');

    progressSection?.classList.remove('hidden');
    resultSection?.classList.remove('hidden');
    updateStartButton('running');
    updateStopButton();
    updateExportButtons();

    if (progressFill) progressFill.style.width = '0%';
    if (progressText) progressText.textContent = `0 / ${totalTests}`;
    if (statusEl) {
      statusEl.textContent = getCurrentLang() === 'en'
        ? `Starting soon: ${totalTests} cases in total. Current request mode: ${requestType === 'stream' ? 'stream' : 'non-stream'}.`
        : `即将开始，共 ${totalTests} 组测试。当前调用方式：${requestType === 'stream' ? '流式调用' : '非流式调用'}。`;
    }
    if (resultSummary) {
      resultSummary.textContent = buildRunIntroSummary({ totalTests, model, requestType, contextLengths, depths, mode });
    }

    updateAuthenticityIndicator(null);

    renderHeatmap(contextLengths, depths);
    renderResultsTable();

    dispatchAppEvent('apimaster:needle-status', {
      state: 'running',
      statusText: getCurrentLang() === 'en' ? `Running 0/${totalTests}` : `运行中 0/${totalTests}`,
      totalTests,
      completed: 0,
      model,
    });

    for (const ctx of contextLengths) {
      for (const depth of depths) {
        if (await maybePauseOrStop(statusEl, resultSummary)) {
          return;
        }

        runtime.currentContext = ctx;
        runtime.currentDepth = depth;

        if (statusEl) {
          statusEl.textContent = getCurrentLang() === 'en'
            ? `Running case: context ${ctx} tokens, depth ${depth}% · ${requestType === 'stream' ? 'stream' : 'non-stream'} request`
            : `正在测试：上下文 ${ctx} tokens，深度 ${depth}% · ${requestType === 'stream' ? '流式' : '非流式'}调用`;
        }
        if (progressText) progressText.textContent = `${runtime.completed} / ${totalTests}`;
        if (progressFill) progressFill.style.width = `${(runtime.completed / totalTests) * 100}%`;

        try {
          currentAbortController = new AbortController();
          const resp = await fetch('/__needle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: currentAbortController.signal,
            body: JSON.stringify({
              apiUrl,
              apiKey,
              modelId: model,
              mode,
              requestType,
              needle,
              question,
              expectedAnswer,
              scoringMode,
              contextLength: ctx,
              depthPercent: depth,
            }),
          });
          const data = await resp.json();
          const contextMetrics = data.contextMetrics || {};
          const scoring = data.scoring || {};

          results.push({
            contextLength: ctx,
            requestedContextTokens: contextMetrics.requestedTokens || ctx,
            actualHaystackTokens: contextMetrics.actualHaystackTokens || contextMetrics.estimatedContextTokens || ctx,
            actualContextTokens: contextMetrics.actualContextTokens || contextMetrics.estimatedContextTokens || ctx,
            actualPromptTokens: contextMetrics.actualPromptTokens || contextMetrics.estimatedPromptTokens || 0,
            tokenizerLabel: contextMetrics.tokenizerLabel || '',
            datasetActualMaxTokens: contextMetrics.datasetActualMaxTokens || contextMetrics.datasetEstimatedMaxTokens || 0,
            datasetEstimatedMaxTokens: contextMetrics.datasetEstimatedMaxTokens || 0,
            contextLimited: Boolean(contextMetrics.hitCorpusCapacity),
            depthPercent: depth,
            retrievalScore: data.ok ? data.retrievalScore : 0,
            latencyMs: data.latencyMs || 0,
            ok: data.ok,
            error: data.error || '',
            scoringMode: scoring.mode || scoringMode,
            scoringPass: Boolean(scoring.pass),
            scoringDetail: scoring.detail || '',
            expectedAnswer,
            mode,
            requestType: data.requestType || requestType,
            model,
          });
        } catch (err) {
          if (stopRequested || err?.name === 'AbortError') {
            currentAbortController = null;
            finalizeStopped(resultSummary, statusEl);
            return;
          }

          results.push({
            contextLength: ctx,
            requestedContextTokens: ctx,
            actualHaystackTokens: ctx,
            actualContextTokens: ctx,
            actualPromptTokens: 0,
            tokenizerLabel: '',
            datasetActualMaxTokens: 0,
            datasetEstimatedMaxTokens: 0,
            contextLimited: false,
            depthPercent: depth,
            retrievalScore: 0,
            latencyMs: 0,
            ok: false,
            error: err.message,
            scoringMode,
            scoringPass: false,
            scoringDetail: err.message,
            expectedAnswer,
            mode,
            requestType,
            model,
          });
        } finally {
          currentAbortController = null;
        }

        if (stopRequested) {
          finalizeStopped(resultSummary, statusEl);
          return;
        }

        runtime.completed += 1;
        if (progressText) progressText.textContent = `${runtime.completed} / ${totalTests}`;
        if (progressFill) progressFill.style.width = `${(runtime.completed / totalTests) * 100}%`;

        renderHeatmap(contextLengths, depths);
        renderResultsTable();
        updateExportButtons();

        dispatchAppEvent('apimaster:needle-status', {
          state: 'running',
          statusText: getCurrentLang() === 'en' ? `Running ${runtime.completed}/${totalTests}` : `运行中 ${runtime.completed}/${totalTests}`,
          totalTests,
          completed: runtime.completed,
          model,
        });
      }
    }

    const avgScore = results.length
      ? Math.round(results.reduce((sum, item) => sum + item.retrievalScore, 0) / results.length)
      : 0;
    const successCount = results.filter((item) => item.ok).length;

    if (statusEl) {
      statusEl.textContent = getCurrentLang() === 'en'
        ? `Test completed. ${totalTests} cases finished, average retrieval score ${avgScore}%.`
        : `测试完成！共 ${totalTests} 组，平均检索得分 ${avgScore}%。`;
    }
    if (resultSummary) {
      resultSummary.textContent = buildRunCompletionSummary({ avgScore, successCount, totalTests, model, mode });
    }

    const authenticitySummary = buildGpt54NeedleSummary(results, latestMatrix);
    saveConfig('needleAuthenticitySummary', authenticitySummary);
    updateAuthenticityIndicator(authenticitySummary);

    dispatchAppEvent('apimaster:needle-status', {
      state: 'completed',
      statusText: getCurrentLang() === 'en' ? `Completed · ${avgScore}%` : `完成 · ${avgScore}%`,
      totalTests,
      completed: totalTests,
      averageScore: avgScore,
      model,
    });

    isRunning = false;
    isPaused = false;
    pauseRequested = false;
    stopRequested = false;
    currentAbortController = null;
    updateStartButton('idle');
    updateStopButton();
    updateExportButtons();
  }

  function requestPause() {
    if (!isRunning || isPaused || pauseRequested || stopRequested) return;
    pauseRequested = true;
    updateStartButton('pausePending');

    const statusEl = document.getElementById('needle-status');
    if (statusEl) {
      statusEl.textContent = getCurrentLang() === 'en'
        ? 'Pause requested. Waiting for the current request to finish.'
        : '已请求暂停，等待当前请求完成后暂停。';
    }
  }

  function requestStop() {
    if (!isRunning || stopRequested) return;

    stopRequested = true;
    pauseRequested = false;
    isPaused = false;
    updateStartButton('stopPending');
    updateStopButton();

    const statusEl = document.getElementById('needle-status');
    if (statusEl) {
      statusEl.textContent = getCurrentLang() === 'en'
        ? 'Stop requested. Ending the current run...'
        : '已请求停止，正在结束当前测试...';
    }

    if (currentAbortController) {
      try {
        currentAbortController.abort();
      } catch {
        // noop
      }
    } else {
      finalizeStopped(document.getElementById('needle-result-summary'), statusEl);
    }
  }

  function resumeNeedleTest() {
    if (!isRunning || !isPaused || stopRequested) return;
    isPaused = false;
    updateStartButton('running');
    updateStopButton();

    const statusEl = document.getElementById('needle-status');
    if (statusEl) {
      statusEl.textContent = getCurrentLang() === 'en'
        ? 'Resuming. The next matrix case will start shortly.'
        : '继续测试：下一组矩阵任务即将开始。';
    }

    dispatchAppEvent('apimaster:needle-status', {
      state: 'running',
      statusText: getCurrentLang() === 'en' ? `Running ${runtime.completed}/${runtime.totalTests}` : `运行中 ${runtime.completed}/${runtime.totalTests}`,
      totalTests: runtime.totalTests,
      completed: runtime.completed,
      model: runtime.model,
    });
  }

  async function maybePauseOrStop(statusEl, resultSummary) {
    if (stopRequested) {
      finalizeStopped(resultSummary, statusEl);
      return true;
    }

    if (pauseRequested) {
      pauseRequested = false;
      isPaused = true;
      updateStartButton('paused');
      updateStopButton();

      if (statusEl) {
        statusEl.textContent = getCurrentLang() === 'en'
          ? `Paused at ${runtime.completed}/${runtime.totalTests}. Click resume to continue.`
          : `已暂停：已完成 ${runtime.completed}/${runtime.totalTests} 组，点击继续测试。`;
      }

      dispatchAppEvent('apimaster:needle-status', {
        state: 'paused',
        statusText: getCurrentLang() === 'en' ? `Paused ${runtime.completed}/${runtime.totalTests}` : `已暂停 ${runtime.completed}/${runtime.totalTests}`,
        totalTests: runtime.totalTests,
        completed: runtime.completed,
        model: runtime.model,
      });
    }

    while (isRunning && isPaused) {
      if (stopRequested) {
        finalizeStopped(resultSummary, statusEl);
        return true;
      }
      await sleep(150);
    }

    if (stopRequested) {
      finalizeStopped(resultSummary, statusEl);
      return true;
    }

    return false;
  }

  function finalizeStopped(resultSummary, statusEl) {
    if (!isRunning && !stopRequested) return;

    isRunning = false;
    isPaused = false;
    pauseRequested = false;
    currentAbortController = null;

    const totalTests = runtime.totalTests || 0;
    const completed = runtime.completed || 0;
    const avgScore = results.length
      ? Math.round(results.reduce((sum, item) => sum + item.retrievalScore, 0) / results.length)
      : 0;

    if (statusEl) {
      statusEl.textContent = getCurrentLang() === 'en'
        ? `Test stopped. Completed ${completed}/${totalTests} cases.`
        : `测试已停止：已完成 ${completed}/${totalTests} 组。`;
    }
    if (resultSummary) {
      resultSummary.textContent = buildStoppedSummary({ completed, totalTests, avgScore });
    }

    const authenticitySummary = buildGpt54NeedleSummary(results, latestMatrix);
    saveConfig('needleAuthenticitySummary', authenticitySummary);
    updateAuthenticityIndicator(authenticitySummary);

    dispatchAppEvent('apimaster:needle-status', {
      state: 'stopped',
      statusText: getCurrentLang() === 'en' ? `Stopped ${completed}/${totalTests}` : `已停止 ${completed}/${totalTests}`,
      totalTests,
      completed,
      averageScore: avgScore,
      model: runtime.model,
    });

    stopRequested = false;
    updateStartButton('idle');
    updateStopButton();
    updateExportButtons();
  }

  function renderHeatmap(contextLengths, depths) {
    const canvas = document.getElementById('heatmap-canvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const marginLeft = 80;
    const marginBottom = 60;
    const marginTop = 30;
    const marginRight = 30;

    const plotWidth = canvas.width - marginLeft - marginRight;
    const plotHeight = canvas.height - marginTop - marginBottom;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const uniqueCtx = [...new Set(contextLengths)].sort((a, b) => a - b);
    const uniqueDepths = [...new Set(depths)].sort((a, b) => a - b);

    const cellW = uniqueCtx.length > 0 ? plotWidth / uniqueCtx.length : plotWidth;
    const cellH = uniqueDepths.length > 0 ? plotHeight / uniqueDepths.length : plotHeight;

    for (const r of results) {
      const xi = uniqueCtx.indexOf(r.contextLength);
      const yi = uniqueDepths.indexOf(r.depthPercent);
      if (xi < 0 || yi < 0) continue;

      const x = marginLeft + xi * cellW;
      const y = marginTop + yi * cellH;

      ctx.fillStyle = heatColor(r.retrievalScore);
      ctx.fillRect(x, y, cellW - 1, cellH - 1);

      ctx.fillStyle = r.retrievalScore > 60 ? '#ffffff' : '#0f172a';
      ctx.font = '11px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${r.retrievalScore}%`, x + cellW / 2, y + cellH / 2);
    }

    ctx.fillStyle = '#9aa8bf';
    ctx.font = '11px Inter, sans-serif';
    ctx.textAlign = 'center';

    uniqueCtx.forEach((value, index) => {
      const x = marginLeft + index * cellW + cellW / 2;
      ctx.fillText(value, x, canvas.height - marginBottom + 20);
    });
    ctx.fillText(getCurrentLang() === 'en' ? 'Context Length (tokens)' : '上下文长度 (tokens)', marginLeft + plotWidth / 2, canvas.height - 10);

    ctx.textAlign = 'right';
    uniqueDepths.forEach((value, index) => {
      const y = marginTop + index * cellH + cellH / 2;
      ctx.fillText(`${value}%`, marginLeft - 10, y);
    });

    ctx.save();
    ctx.translate(16, marginTop + plotHeight / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillText(getCurrentLang() === 'en' ? 'Insertion Depth (%)' : '插入深度 (%)', 0, 0);
    ctx.restore();
  }

  function heatColor(score) {
    const clamped = Math.max(0, Math.min(100, score));
    const shade = Math.round(242 - ((242 - 17) * clamped) / 100);
    return `rgb(${shade},${shade},${shade})`;
  }

  function renderResultsTable() {
    const tbody = document.getElementById('needle-results-tbody');
    if (!tbody) return;

    tbody.innerHTML = results.map((r) => {
      const scoreClassName = r.retrievalScore >= 80 ? 'high' : r.retrievalScore >= 50 ? 'mid' : 'low';
      const requestedTokens = r.requestedContextTokens || r.contextLength;
      const actualTokens = r.actualHaystackTokens || r.actualContextTokens || r.contextLength;
      const contextNote = r.contextLimited ? ' ⚠' : '';
      const contextTitle = [r.tokenizerLabel, r.scoringDetail].filter(Boolean).join(' · ');
      const statusIcon = !r.ok
        ? '❌'
        : r.scoringMode === 'keyword'
          ? (r.retrievalScore >= 100 ? '✅' : '⚠️')
          : (r.scoringPass ? '✅' : '⚠️');
      return `
        <tr>
          <td title="${escapeHtmlAttr(contextTitle)}">${requestedTokens} / ${actualTokens}${contextNote}</td>
          <td>${r.depthPercent}%</td>
          <td class="history-score ${scoreClassName}">${r.retrievalScore}%</td>
          <td>${r.latencyMs}</td>
          <td title="${escapeHtmlAttr(r.scoringDetail || '')}">${statusIcon}</td>
        </tr>
      `;
    }).join('');
  }

  function updateExportButtons() {
    const disabled = results.length === 0;
    const pngButton = document.getElementById('btn-export-heatmap');
    const csvButton = document.getElementById('btn-export-needle-csv');
    if (pngButton) pngButton.disabled = disabled;
    if (csvButton) csvButton.disabled = disabled;
  }

  function exportHeatmapImage() {
    if (results.length === 0) {
      alert(getCurrentLang() === 'en' ? 'Run at least one test case before exporting the heatmap.' : '请先执行至少一组测试，再导出热力图。');
      return;
    }

    const canvas = document.getElementById('heatmap-canvas');
    if (!canvas) return;

    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = buildExportFilename('heatmap', 'png');
    link.click();
  }

  function exportNeedleCsv() {
    if (results.length === 0) {
      alert(getCurrentLang() === 'en' ? 'Run at least one test case before exporting the results.' : '请先执行至少一组测试，再导出结果。');
      return;
    }

    const header = [
      'model',
      'mode',
      'requestType',
      'scoringMode',
      'scoringPass',
      'scoringDetail',
      'expectedAnswer',
      'requestedContextTokens',
      'actualHaystackTokens',
      'actualContextTokens',
      'actualPromptTokens',
      'tokenizerLabel',
      'datasetActualMaxTokens',
      'datasetEstimatedMaxTokens',
      'contextLimited',
      'depthPercent',
      'retrievalScore',
      'latencyMs',
      'ok',
      'error',
    ];
    const rows = results.map((item) => [
      item.model,
      item.mode,
      item.requestType,
      item.scoringMode || 'keyword',
      item.scoringPass ? 'true' : 'false',
      item.scoringDetail || '',
      item.expectedAnswer || '',
      item.requestedContextTokens || item.contextLength,
      item.actualHaystackTokens || item.contextLength,
      item.actualContextTokens || item.contextLength,
      item.actualPromptTokens || '',
      item.tokenizerLabel || '',
      item.datasetActualMaxTokens || '',
      item.datasetEstimatedMaxTokens || '',
      item.contextLimited ? 'true' : 'false',
      item.depthPercent,
      item.retrievalScore,
      item.latencyMs,
      item.ok,
      item.error || '',
    ]);

    const csv = [header, ...rows]
      .map((row) => row.map(escapeCsvCell).join(','))
      .join('\r\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = buildExportFilename('results', 'csv');
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 0);
  }

  function buildExportFilename(suffix, extension) {
    const modelPart = slugifyFilenamePart(latestMatrix.model || 'needle-test');
    const timePart = formatExportTime(new Date());
    return `apimaster-${modelPart}-${suffix}-${timePart}.${extension}`;
  }

  function getScoringModeLabel(mode = 'keyword') {
    const isEn = getCurrentLang() === 'en';
    if (mode === 'exact') return isEn ? 'exact match' : '完全匹配';
    if (mode === 'contains') return isEn ? 'contains answer' : '包含参考答案';
    if (mode === 'regex') return isEn ? 'regex' : '正则匹配';
    return isEn ? 'keyword coverage' : '关键词覆盖';
  }

  function normalizeTextForPreset(value) {
    return String(value || '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function slugifyFilenamePart(value) {
    return String(value || 'item')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      || 'item';
  }

  function formatExportTime(date) {
    const pad = (value) => String(value).padStart(2, '0');
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  }

  function escapeHtmlAttr(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function escapeCsvCell(value) {
    const text = String(value ?? '');
    return `"${text.replace(/"/g, '""')}"`;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function getCurrentLang() {
    return typeof AppRuntime !== 'undefined' && AppRuntime.lang === 'en' ? 'en' : 'zh';
  }

  function updateStartButton(nextState) {
    buttonState = nextState;

    const button = document.getElementById('btn-needle-start');
    const text = document.getElementById('btn-needle-start-text');
    if (!button || !text) return;

    button.disabled = nextState === 'stopPending';
    button.classList.remove('running', 'running-state', 'pause-pending', 'paused-state');

    let iconType = 'play';
    if (nextState === 'running') {
      button.classList.add('running-state');
      iconType = 'pause';
    } else if (nextState === 'pausePending') {
      button.classList.add('pause-pending');
      iconType = 'spinner';
    } else if (nextState === 'stopPending') {
      button.classList.add('pause-pending');
      iconType = 'spinner';
    } else if (nextState === 'paused') {
      button.classList.add('paused-state');
      iconType = 'play';
    }

    const labels = BUTTON_LABELS[getCurrentLang()] || BUTTON_LABELS.zh;
    text.textContent = labels[nextState] || labels.idle;
    replaceNeedleButtonIcon(iconType);
  }

  function updateStopButton() {
    const button = document.getElementById('btn-needle-stop');
    if (!button) return;

    const labels = BUTTON_LABELS[getCurrentLang()] || BUTTON_LABELS.zh;
    button.textContent = labels.stop;
    button.disabled = !isRunning || stopRequested;
  }

  function replaceNeedleButtonIcon(type) {
    const button = document.getElementById('btn-needle-start');
    if (!button) return;

    const currentIcon = button.querySelector('svg, .spinner');
    const nextIcon = createNeedleButtonIcon(type);
    if (currentIcon) currentIcon.replaceWith(nextIcon);
  }

  function createNeedleButtonIcon(type) {
    if (type === 'spinner') {
      const el = document.createElement('div');
      el.className = 'spinner';
      return el;
    }

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '18');
    svg.setAttribute('height', '18');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');

    if (type === 'pause') {
      svg.innerHTML = '<line x1="10" y1="4" x2="10" y2="20"></line><line x1="16" y1="4" x2="16" y2="20"></line>';
      return svg;
    }

    svg.innerHTML = '<polygon points="5 3 19 12 5 21 5 3"></polygon>';
    return svg;
  }

  function refreshUiText() {
    updateStartButton(buttonState);
    updateStopButton();
    const presetBtn = document.getElementById('btn-needle-gpt54-preset');
    const presetLabel = document.getElementById('needle-preset-label');
    const authLabel = document.getElementById('needle-auth-label');
    if (presetBtn) {
      presetBtn.textContent = getCurrentLang() === 'en'
        ? 'Apply GPT-5.4 Preset'
        : '应用 GPT-5.4 验真预设';
    }
    if (presetLabel) {
      presetLabel.textContent = getCurrentLang() === 'en' ? 'Recommended preset' : '推荐预设';
    }
    if (authLabel) {
      authLabel.textContent = getCurrentLang() === 'en' ? 'Cross-check result' : '验真复核';
    }
    updatePresetIndicators();
    updateAuthenticityIndicator(resolveStoredAuthenticitySummary());
  }

  return { init, refreshUiText };
})();
