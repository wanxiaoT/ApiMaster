import fs from "node:fs";
import path from "node:path";
import { getTokenizer as getAnthropicTokenizer } from "@anthropic-ai/tokenizer";
import { encodingForModel, getEncoding } from "js-tiktoken";

import { readBody, sendJson } from "./http.mjs";
import { fetchWithTimeout, getNeedleTimeoutMs } from "./upstream.mjs";

export function scoreNeedleResponse({
  responseText = "",
  needle = "",
  expectedAnswer = "",
  scoringMode = "keyword",
}) {
  const mode = ["keyword", "exact", "contains", "regex"].includes(scoringMode)
    ? scoringMode
    : "keyword";
  const response = String(responseText || "");
  const referenceText = String(expectedAnswer || needle || "").trim();
  const normalizedResponse = normalizeComparisonText(response);
  const normalizedReference = normalizeComparisonText(referenceText);

  if (!referenceText) {
    return {
      mode,
      score: 0,
      pass: false,
      referenceText: "",
      detail: "缺少评分参考答案",
      matchedKeywords: [],
      totalKeywords: 0,
    };
  }

  if (mode === "exact") {
    const pass = normalizedReference.length > 0 && normalizedResponse === normalizedReference;
    return {
      mode,
      score: pass ? 100 : 0,
      pass,
      referenceText,
      detail: pass ? "完全匹配参考答案" : "响应未与参考答案完全匹配",
      matchedKeywords: [],
      totalKeywords: 0,
    };
  }

  if (mode === "contains") {
    const pass = normalizedReference.length > 0 && normalizedResponse.includes(normalizedReference);
    return {
      mode,
      score: pass ? 100 : 0,
      pass,
      referenceText,
      detail: pass ? "响应包含参考答案" : "响应未包含参考答案",
      matchedKeywords: [],
      totalKeywords: 0,
    };
  }

  if (mode === "regex") {
    try {
      const regexp = new RegExp(referenceText, "i");
      const pass = regexp.test(response);
      return {
        mode,
        score: pass ? 100 : 0,
        pass,
        referenceText,
        detail: pass ? "响应匹配正则规则" : "响应未匹配正则规则",
        matchedKeywords: [],
        totalKeywords: 0,
      };
    } catch (error) {
      return {
        mode,
        score: 0,
        pass: false,
        referenceText,
        detail: `正则表达式无效：${error?.message || "regex_invalid"}`,
        matchedKeywords: [],
        totalKeywords: 0,
      };
    }
  }

  const keywords = splitExpectedKeywords(referenceText);
  if (keywords.length === 0) {
    return {
      mode,
      score: 0,
      pass: false,
      referenceText,
      detail: "关键词模式下未提取到有效关键词",
      matchedKeywords: [],
      totalKeywords: 0,
    };
  }

  const matchedKeywords = keywords.filter((keyword) =>
    normalizedResponse.includes(normalizeComparisonText(keyword))
  );
  const score = Math.round((matchedKeywords.length / keywords.length) * 100);

  return {
    mode,
    score,
    pass: matchedKeywords.length === keywords.length,
    referenceText,
    detail: `命中 ${matchedKeywords.length}/${keywords.length} 个关键词`,
    matchedKeywords,
    totalKeywords: keywords.length,
  };
}

export function createNeedleToolkit({
  publicDir = "",
  charsPerTokenEstimate = Math.max(1, Number(process.env.APIMASTER_CHARS_PER_TOKEN || 4) || 4),
} = {}) {
  const utf8Decoder = new TextDecoder();
  const openAiTokenizerCache = new Map();
  let anthropicTokenizerAdapter = null;
  const haystackCorpusCache = {
    loaded: false,
    fileCount: 0,
    text: "",
    totalChars: 0,
    estimatedTokens: 0,
    tokensByTokenizer: new Map(),
  };

  function estimateTokensFromChars(charCount = 0) {
    if (!Number.isFinite(charCount) || charCount <= 0) return 0;
    return Math.max(0, Math.round(charCount / charsPerTokenEstimate));
  }

  function loadHaystackCorpus() {
    if (haystackCorpusCache.loaded) {
      return haystackCorpusCache.text ? haystackCorpusCache : null;
    }

    if (!publicDir) {
      haystackCorpusCache.loaded = true;
      return null;
    }

    const haystackDir = path.join(publicDir, "data", "haystack");
    if (!fs.existsSync(haystackDir)) {
      haystackCorpusCache.loaded = true;
      return null;
    }

    const files = fs.readdirSync(haystackDir)
      .filter((fileName) => fileName.endsWith(".txt"))
      .sort();
    let corpusText = "";

    for (const fileName of files) {
      corpusText += fs.readFileSync(path.join(haystackDir, fileName), "utf-8") + "\n";
    }

    haystackCorpusCache.loaded = true;
    haystackCorpusCache.fileCount = files.length;
    haystackCorpusCache.text = corpusText;
    haystackCorpusCache.totalChars = corpusText.length;
    haystackCorpusCache.estimatedTokens = estimateTokensFromChars(corpusText.length);
    haystackCorpusCache.tokensByTokenizer = new Map();

    return haystackCorpusCache.text ? haystackCorpusCache : null;
  }

  function resolveOpenAIEncodingName(modelId = "") {
    const normalizedModelId = String(modelId || "").trim().toLowerCase();
    if (!normalizedModelId) return "o200k_base";
    if (/^gpt-5(?:$|[.-])/.test(normalizedModelId)) return "o200k_base";
    if (/^gpt-4\.1(?:$|[.-])/.test(normalizedModelId)) return "o200k_base";
    if (/^gpt-4o(?:$|[.-])/.test(normalizedModelId)) return "o200k_base";
    if (/^(o1|o3|o4)(?:$|[.-])/.test(normalizedModelId)) return "o200k_base";
    if (/^gpt-4(?:$|[.-])/.test(normalizedModelId)) return "cl100k_base";
    if (/^gpt-3\.5-turbo(?:$|[.-])/.test(normalizedModelId)) return "cl100k_base";
    return "cl100k_base";
  }

  function getOpenAITokenizerAdapter(modelId = "") {
    const normalizedModelId = String(modelId || "").trim();
    const mappedEncodingName = resolveOpenAIEncodingName(normalizedModelId);
    const mappedEncodingCacheKey = `openai:${mappedEncodingName}`;

    if (openAiTokenizerCache.has(mappedEncodingCacheKey)) {
      return openAiTokenizerCache.get(mappedEncodingCacheKey);
    }

    let tokenizerLabel = `OpenAI / ${mappedEncodingName}`;
    try {
      if (normalizedModelId) {
        encodingForModel(normalizedModelId);
        tokenizerLabel = `OpenAI / ${normalizedModelId} (${mappedEncodingName})`;
      }
    } catch {}

    const encoder = getEncoding(mappedEncodingName);
    const adapter = {
      kind: "openai",
      cacheKey: mappedEncodingCacheKey,
      label: tokenizerLabel,
      encode(text = "") {
        return encoder.encode(String(text || ""));
      },
      decode(tokens = []) {
        return encoder.decode(Array.isArray(tokens) ? tokens : Array.from(tokens || []));
      },
    };

    openAiTokenizerCache.set(mappedEncodingCacheKey, adapter);
    return adapter;
  }

  function getAnthropicTokenizerAdapter() {
    if (anthropicTokenizerAdapter) {
      return anthropicTokenizerAdapter;
    }

    const tokenizer = getAnthropicTokenizer();
    anthropicTokenizerAdapter = {
      kind: "anthropic",
      cacheKey: "anthropic:official",
      label: "Anthropic / official tokenizer",
      encode(text = "") {
        return tokenizer.encode(String(text || ""));
      },
      decode(tokens = []) {
        const typed = tokens instanceof Uint32Array ? tokens : Uint32Array.from(tokens || []);
        return utf8Decoder.decode(tokenizer.decode(typed));
      },
    };
    return anthropicTokenizerAdapter;
  }

  function getTokenizerAdapter({ mode = "openai", modelId = "" } = {}) {
    if (mode === "anthropic") {
      return getAnthropicTokenizerAdapter();
    }
    return getOpenAITokenizerAdapter(modelId);
  }

  function getTokenSequenceLength(tokens = []) {
    return Number(tokens?.length) || 0;
  }

  function sliceTokenSequence(tokens = [], start = 0, end = undefined) {
    if (typeof tokens?.slice === "function") {
      return tokens.slice(start, end);
    }
    return Array.from(tokens || []).slice(start, end);
  }

  function concatTokenSequences(kind = "openai", sequences = []) {
    const validSequences = Array.isArray(sequences)
      ? sequences.filter((item) => item && getTokenSequenceLength(item) > 0)
      : [];

    if (kind === "anthropic") {
      const totalLength = validSequences.reduce((sum, item) => sum + getTokenSequenceLength(item), 0);
      const merged = new Uint32Array(totalLength);
      let offset = 0;
      for (const sequence of validSequences) {
        merged.set(sequence instanceof Uint32Array ? sequence : Uint32Array.from(sequence), offset);
        offset += getTokenSequenceLength(sequence);
      }
      return merged;
    }

    const merged = [];
    for (const sequence of validSequences) {
      merged.push(...sequence);
    }
    return merged;
  }

  function getHaystackTokenSequence(tokenizer, corpusText = "", cache = haystackCorpusCache) {
    if (!tokenizer?.cacheKey) {
      const encoded = tokenizer?.encode ? tokenizer.encode(corpusText) : [];
      return {
        tokens: encoded,
        tokenCount: getTokenSequenceLength(encoded),
      };
    }

    if (cache.tokensByTokenizer.has(tokenizer.cacheKey)) {
      return cache.tokensByTokenizer.get(tokenizer.cacheKey);
    }

    const tokens = tokenizer.encode(corpusText);
    const tokenizedCorpus = {
      tokens,
      tokenCount: getTokenSequenceLength(tokens),
    };
    cache.tokensByTokenizer.set(tokenizer.cacheKey, tokenizedCorpus);
    return tokenizedCorpus;
  }

  function buildNeedleContextBundle({
    mode = "openai",
    modelId = "",
    needle = "",
    question = "",
    requestedContextTokens = 2000,
    depthPercent = 50,
    haystackText = null,
    haystackMeta = null,
  }) {
    const haystackCorpus = haystackText !== null
      ? {
          text: String(haystackText),
          fileCount: haystackMeta?.fileCount ?? 1,
          totalChars: String(haystackText).length,
          estimatedTokens: estimateTokensFromChars(String(haystackText).length),
          tokensByTokenizer: new Map(),
        }
      : loadHaystackCorpus();

    if (!haystackCorpus?.text) {
      throw new Error("no_haystack_data");
    }

    const tokenizer = getTokenizerAdapter({ mode, modelId });
    const tokenizedCorpus = getHaystackTokenSequence(tokenizer, haystackCorpus.text, haystackCorpus);
    const safeRequestedTokens = Math.max(1, Number(requestedContextTokens) || 2000);
    const safeDepthPercent = Math.max(0, Math.min(100, Number(depthPercent) || 50));
    const availableHaystackTokens = tokenizedCorpus.tokenCount;
    const actualHaystackTokens = Math.min(safeRequestedTokens, availableHaystackTokens);
    const baseHaystackTokens = sliceTokenSequence(tokenizedCorpus.tokens, 0, actualHaystackTokens);

    const needleBlock = `\n${needle}\n`;
    const questionBlock = `\n\n${question}`;
    const needleTokens = tokenizer.encode(needleBlock);
    const questionTokens = tokenizer.encode(questionBlock);
    const insertIndex = Math.max(0, Math.min(
      actualHaystackTokens,
      Math.floor(actualHaystackTokens * (safeDepthPercent / 100)),
    ));

    const contextTokens = concatTokenSequences(tokenizer.kind, [
      sliceTokenSequence(baseHaystackTokens, 0, insertIndex),
      needleTokens,
      sliceTokenSequence(baseHaystackTokens, insertIndex),
    ]);
    const promptTokens = concatTokenSequences(tokenizer.kind, [contextTokens, questionTokens]);
    const haystackTextBuilt = tokenizer.decode(baseHaystackTokens);
    const contextWithNeedle = tokenizer.decode(contextTokens);
    const promptContent = contextWithNeedle + questionBlock;

    return {
      haystackCorpus,
      tokenizer,
      promptContent,
      haystackText: haystackTextBuilt,
      contextWithNeedle,
      requestedContextTokens: safeRequestedTokens,
      actualHaystackTokens,
      actualContextTokens: getTokenSequenceLength(contextTokens),
      actualPromptTokens: getTokenSequenceLength(promptTokens),
      needleTokenCount: getTokenSequenceLength(needleTokens),
      questionTokenCount: getTokenSequenceLength(questionTokens),
      hitCorpusCapacity: actualHaystackTokens < safeRequestedTokens,
    };
  }

  function resetHaystackCache() {
    haystackCorpusCache.loaded = false;
    haystackCorpusCache.fileCount = 0;
    haystackCorpusCache.text = "";
    haystackCorpusCache.totalChars = 0;
    haystackCorpusCache.estimatedTokens = 0;
    haystackCorpusCache.tokensByTokenizer = new Map();
  }

  return {
    estimateTokensFromChars,
    loadHaystackCorpus,
    buildNeedleContextBundle,
    getHaystackTokenSequence,
    resetHaystackCache,
  };
}

export function createNeedleHandler({
  publicDir,
  parseAnthropicStreamResponse,
  parseAnthropicJsonResponse,
  parseOpenAIStreamResponse,
  parseOpenAIJsonResponse,
} = {}) {
  const toolkit = createNeedleToolkit({ publicDir });

  return async function handleNeedle(req, res) {
    if (req.method !== "POST") {
      sendJson(res, 405, { ok: false, error: "method_not_allowed" });
      return;
    }

    try {
      const raw = await readBody(req);
      const parsed = JSON.parse(raw || "{}");
      const {
        apiUrl, apiKey, modelId, mode,
        needle, question, contextLength, depthPercent,
      } = parsed;
      const requestType = parsed.requestType === "stream" ? "stream" : "nonstream";
      const useStream = requestType === "stream";
      const scoringMode = ["keyword", "exact", "contains", "regex"].includes(parsed.scoringMode)
        ? parsed.scoringMode
        : "keyword";
      const expectedAnswer = typeof parsed.expectedAnswer === "string"
        ? parsed.expectedAnswer
        : "";

      if (!apiUrl || !apiKey || !modelId || !needle || !question) {
        sendJson(res, 400, { ok: false, error: "missing_params" });
        return;
      }

      const requestedContextTokens = Math.max(1, Number(contextLength) || 2000);
      const depth = Math.max(0, Math.min(100, Number(depthPercent) || 50));
      const contextBundle = toolkit.buildNeedleContextBundle({
        mode,
        modelId,
        needle,
        question,
        requestedContextTokens,
        depthPercent: depth,
      });
      const {
        haystackCorpus,
        tokenizer,
        promptContent,
        haystackText,
        contextWithNeedle,
        actualHaystackTokens,
        actualContextTokens,
        actualPromptTokens,
        needleTokenCount,
        questionTokenCount,
        hitCorpusCapacity,
      } = contextBundle;

      const isAnthropic = mode === "anthropic";
      let endpoint;
      let headers;
      let body;

      if (isAnthropic) {
        endpoint = apiUrl.replace(/\/+$/, "") + "/v1/messages";
        headers = {
          "anthropic-version": "2023-06-01",
          "authorization": `Bearer ${apiKey}`,
          "x-api-key": apiKey,
          "content-type": "application/json",
        };
        body = {
          model: modelId,
          messages: [{
            role: "user",
            content: promptContent,
          }],
          max_tokens: 1024,
          stream: useStream,
        };
      } else {
        endpoint = apiUrl.replace(/\/+$/, "") + "/v1/chat/completions";
        headers = {
          "authorization": `Bearer ${apiKey}`,
          "content-type": "application/json",
        };
        body = {
          model: modelId,
          messages: [{
            role: "user",
            content: promptContent,
          }],
          max_tokens: 1024,
          stream: useStream,
        };
        if (useStream) {
          body.stream_options = { include_usage: true };
        }
      }

      const started = Date.now();
      const upstream = await fetchWithTimeout(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      }, {
        timeoutMs: getNeedleTimeoutMs({ requestType, contextLength: requestedContextTokens }),
        label: "needle_request",
      });

      if (upstream.status !== 200) {
        const errText = await upstream.text();
        sendJson(res, 200, {
          ok: false,
          error: `HTTP ${upstream.status}: ${errText.slice(0, 500)}`,
        });
        return;
      }

      let responseText = "";
      let usage = {};

      if (isAnthropic && useStream) {
        const parsedResponse = await parseAnthropicStreamResponse(upstream.body);
        responseText = parsedResponse.responseText;
        usage = parsedResponse.usage;
      } else if (isAnthropic) {
        const respBody = await upstream.text();
        const parsedResponse = parseAnthropicJsonResponse(respBody);
        responseText = parsedResponse.responseText;
        usage = parsedResponse.usage;
      } else if (useStream) {
        const parsedResponse = await parseOpenAIStreamResponse(upstream.body);
        responseText = parsedResponse.responseText;
        usage = parsedResponse.usage;
      } else {
        const respBody = await upstream.text();
        const parsedResponse = parseOpenAIJsonResponse(respBody);
        responseText = parsedResponse.responseText;
        usage = parsedResponse.usage;
      }

      const latencyMs = Date.now() - started;
      const scoring = scoreNeedleResponse({
        responseText,
        needle,
        expectedAnswer,
        scoringMode,
      });

      sendJson(res, 200, {
        ok: true,
        responseText,
        retrievalScore: scoring.score,
        contextLength: requestedContextTokens,
        depthPercent: depth,
        latencyMs,
        usage,
        requestType,
        scoring,
        contextMetrics: {
          requestedTokens: requestedContextTokens,
          actualHaystackTokens,
          actualContextTokens,
          actualPromptTokens,
          needleTokenCount,
          questionTokenCount,
          actualHaystackChars: haystackText.length,
          actualContextChars: contextWithNeedle.length,
          actualPromptChars: promptContent.length,
          datasetEstimatedMaxTokens: haystackCorpus.estimatedTokens,
          datasetActualMaxTokens: toolkit.getHaystackTokenSequence(tokenizer, haystackCorpus.text, haystackCorpus).tokenCount,
          corpusFileCount: haystackCorpus.fileCount,
          hitCorpusCapacity,
          tokenizerLabel: tokenizer.label,
          tokenizerKind: tokenizer.kind,
        },
      });
    } catch (error) {
      if ((error?.message || "") === "no_haystack_data") {
        sendJson(res, 400, { ok: false, error: "no_haystack_data" });
        return;
      }
      sendJson(res, 500, { ok: false, error: error?.message || "needle_failed" });
    }
  };
}

function normalizeComparisonText(text = "") {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function splitExpectedKeywords(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return [];
  const phrases = raw
    .split(/[\r\n,;|]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (phrases.length > 1) return phrases;
  return raw
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 2);
}
