import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { getTokenizer as getAnthropicTokenizer } from "@anthropic-ai/tokenizer";
import { encodingForModel, getEncoding } from "js-tiktoken";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const publicDir = path.join(rootDir, "public");

const port = Number(process.env.PORT || 6722);
const host = process.env.HOST || "0.0.0.0";
const defaultFetchTimeoutMs = Number(process.env.APIMASTER_FETCH_TIMEOUT_MS || 45000);
const probeFetchTimeoutMs = Number(process.env.APIMASTER_PROBE_TIMEOUT_MS || 15000);
const haystackCharsPerTokenEstimate = Math.max(1, Number(process.env.APIMASTER_CHARS_PER_TOKEN || 4) || 4);

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

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

/* ── helpers ─────────────────────────────────── */

function estimateTokensFromChars(charCount = 0) {
  if (!Number.isFinite(charCount) || charCount <= 0) return 0;
  return Math.max(0, Math.round(charCount / haystackCharsPerTokenEstimate));
}

function getProbeTimeoutMs({ useStream = false } = {}) {
  return useStream ? Math.max(probeFetchTimeoutMs, 30000) : probeFetchTimeoutMs;
}

function getDetectTimeoutMs({ isAnthropic = false, useStream = false, withThinking = false } = {}) {
  let timeoutMs = useStream ? Math.max(defaultFetchTimeoutMs, 75000) : defaultFetchTimeoutMs;
  if (isAnthropic && withThinking !== false) {
    timeoutMs += 30000;
  }
  return timeoutMs;
}

function getNeedleTimeoutMs({ requestType = "nonstream", contextLength = 0 } = {}) {
  const normalizedContextLength = Math.max(0, Number(contextLength) || 0);
  const baseTimeoutMs = requestType === "stream" ? 90000 : 60000;
  const scaledTimeoutMs = baseTimeoutMs + Math.min(90000, normalizedContextLength * 1.5);
  return Math.max(baseTimeoutMs, Math.round(scaledTimeoutMs));
}

async function fetchWithTimeout(url, options = {}, { timeoutMs = defaultFetchTimeoutMs, label = "upstream_request" } = {}) {
  const effectiveTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0
    ? timeoutMs
    : defaultFetchTimeoutMs;
  const controller = new AbortController();
  const { signal: upstreamSignal, ...fetchOptions } = options || {};
  let timeoutTriggered = false;

  const onUpstreamAbort = () => {
    try {
      controller.abort();
    } catch {}
  };

  if (upstreamSignal?.aborted) {
    onUpstreamAbort();
  } else if (upstreamSignal?.addEventListener) {
    upstreamSignal.addEventListener("abort", onUpstreamAbort, { once: true });
  }

  const timeoutId = setTimeout(() => {
    timeoutTriggered = true;
    try {
      controller.abort();
    } catch {}
  }, effectiveTimeoutMs);

  try {
    return await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });
  } catch (error) {
    if (timeoutTriggered || (error?.name === "AbortError" && controller.signal.aborted && !upstreamSignal?.aborted)) {
      const timeoutError = new Error(`${label}_timeout_${effectiveTimeoutMs}ms`);
      timeoutError.code = "upstream_timeout";
      timeoutError.cause = error;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    if (upstreamSignal?.removeEventListener) {
      upstreamSignal.removeEventListener("abort", onUpstreamAbort);
    }
  }
}

function loadHaystackCorpus() {
  if (haystackCorpusCache.loaded) {
    return haystackCorpusCache.text ? haystackCorpusCache : null;
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

function getHaystackTokenSequence(tokenizer, corpusText = "") {
  if (!tokenizer?.cacheKey) {
    return {
      tokens: tokenizer?.encode ? tokenizer.encode(corpusText) : [],
      tokenCount: tokenizer?.encode ? getTokenSequenceLength(tokenizer.encode(corpusText)) : estimateTokensFromChars(corpusText.length),
    };
  }

  if (haystackCorpusCache.tokensByTokenizer.has(tokenizer.cacheKey)) {
    return haystackCorpusCache.tokensByTokenizer.get(tokenizer.cacheKey);
  }

  const tokens = tokenizer.encode(corpusText);
  const tokenizedCorpus = {
    tokens,
    tokenCount: getTokenSequenceLength(tokens),
  };
  haystackCorpusCache.tokensByTokenizer.set(tokenizer.cacheKey, tokenizedCorpus);
  return tokenizedCorpus;
}

function buildNeedleContextBundle({
  mode = "openai",
  modelId = "",
  needle = "",
  question = "",
  requestedContextTokens = 2000,
  depthPercent = 50,
}) {
  const haystackCorpus = loadHaystackCorpus();
  if (!haystackCorpus?.text) {
    throw new Error("no_haystack_data");
  }

  const tokenizer = getTokenizerAdapter({ mode, modelId });
  const tokenizedCorpus = getHaystackTokenSequence(tokenizer, haystackCorpus.text);

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
    Math.floor(actualHaystackTokens * (safeDepthPercent / 100))
  ));

  const contextTokens = concatTokenSequences(tokenizer.kind, [
    sliceTokenSequence(baseHaystackTokens, 0, insertIndex),
    needleTokens,
    sliceTokenSequence(baseHaystackTokens, insertIndex),
  ]);
  const promptTokens = concatTokenSequences(tokenizer.kind, [contextTokens, questionTokens]);
  const haystackText = tokenizer.decode(baseHaystackTokens);
  const contextWithNeedle = tokenizer.decode(contextTokens);
  const promptContent = contextWithNeedle + questionBlock;

  return {
    haystackCorpus,
    tokenizer,
    promptContent,
    haystackText,
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

function scoreNeedleResponse({
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

function buildSkippedSourceAnalysis(mode = "anthropic", skipReason = "quick_mode") {
  return {
    supported: false,
    skipped: true,
    skipReason,
    verdict: "unavailable",
    verdictLabel: "",
    confidence: 0,
    proxyPlatform: "",
    summaryText: mode === "anthropic"
      ? "快速模式下已跳过来源判定、证据面板与 ratelimit 动态验证。"
      : "快速模式下已跳过额外 tools / Structured Outputs / GPT-5.4 画像探针。",
    evidence: [],
    fingerprints: [],
    ratelimitCheck: {
      verdict: "unavailable",
      label: "已跳过",
      detail: "快速模式未执行深度来源分析",
      samples: [],
    },
    factValues: {
      tool: "--",
      message: "--",
      thinking: "--",
    },
  };
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => (raw += c.toString()));
    req.on("end", () => resolve(raw));
    req.on("error", reject);
  });
}

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function mergeUsage(target, source) {
  if (!source || typeof source !== "object") return target;
  for (const key of [
    "input_tokens",
    "output_tokens",
    "cache_read_input_tokens",
    "cache_creation_input_tokens",
    "total_tokens",
    "prompt_tokens",
    "completion_tokens",
  ]) {
    if (typeof source[key] === "number") {
      target[key] = source[key];
    }
  }
  return target;
}

function extractOpenAIContentText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => {
    if (typeof part === "string") return part;
    if (part && typeof part.text === "string") return part.text;
    return "";
  }).join("");
}

function extractOpenAIToolCalls(message = {}) {
  if (!message || typeof message !== "object" || !Array.isArray(message.tool_calls)) {
    return [];
  }
  return message.tool_calls.filter((item) => item && typeof item === "object");
}

function extractOpenAIRefusal(message = {}) {
  if (!message || typeof message !== "object") return "";
  if (typeof message.refusal === "string") return message.refusal;
  if (Array.isArray(message.content)) {
    const refusalPart = message.content.find((part) =>
      part && typeof part === "object" && part.type === "refusal" && typeof part.refusal === "string"
    );
    if (refusalPart?.refusal) return refusalPart.refusal;
  }
  return "";
}

function detectUsageStyleFromKeys(keys = []) {
  if (!Array.isArray(keys) || keys.length === 0) return "unknown";
  if (keys.some((key) => /[A-Z]/.test(key))) return "camelCase";
  if (keys.some((key) => key.includes("_"))) return "snake_case";
  return "unknown";
}

async function parseSseDataStream(readable, onData) {
  if (!readable) {
    return { rawText: "", firstChunkLatencyMs: null, parsedEvents: 0 };
  }

  const reader = readable.getReader();
  const decoder = new TextDecoder();
  const startedAt = Date.now();
  let firstChunkLatencyMs = null;
  let rawText = "";
  let parsedEvents = 0;
  let buffer = "";

  const flushBuffer = (final = false) => {
    const lines = buffer.split(/\r?\n/);
    if (!final) {
      buffer = lines.pop() ?? "";
    } else {
      buffer = "";
    }

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      parsedEvents += 1;
      onData(data);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (firstChunkLatencyMs === null) {
      firstChunkLatencyMs = Date.now() - startedAt;
    }
    if (!value) continue;

    const chunkText = decoder.decode(value, { stream: true });
    rawText += chunkText;
    buffer += chunkText;
    flushBuffer(false);
  }

  const tail = decoder.decode();
  if (tail) {
    rawText += tail;
    buffer += tail;
  }
  flushBuffer(true);

  return { rawText, firstChunkLatencyMs, parsedEvents };
}

function parseAnthropicJsonResponse(text) {
  const parsed = tryParseJson(text);
  if (!parsed || typeof parsed !== "object") {
    return {
      responseText: text,
      thinkingText: "",
      usage: {},
      usageStyle: "unknown",
      usageRawKeys: [],
      contentTypes: [],
      messageId: "",
      model: "",
      toolUseIds: [],
      thinkingSignature: "",
      raw: parsed,
    };
  }

  const content = Array.isArray(parsed.content) ? parsed.content : [];
  const contentTypes = content
    .map((block) => typeof block?.type === "string" ? block.type : "")
    .filter(Boolean);
  const responseText = content
    .map((block) => block?.type === "text" && typeof block.text === "string" ? block.text : "")
    .join("");
  const thinkingText = content
    .map((block) => block?.type === "thinking"
      ? (typeof block.thinking === "string" ? block.thinking : typeof block.text === "string" ? block.text : "")
      : "")
    .join("");
  const toolUseIds = content
    .filter((block) => block?.type === "tool_use" && typeof block.id === "string")
    .map((block) => block.id);
  const thinkingSignature = content
    .map((block) => block?.type === "thinking" && typeof block.signature === "string" ? block.signature : "")
    .find(Boolean) || "";
  const usage = parsed.usage && typeof parsed.usage === "object" ? parsed.usage : {};
  const usageRawKeys = Object.keys(usage);

  return {
    responseText: responseText || text,
    thinkingText,
    usage,
    usageStyle: detectUsageStyleFromKeys(usageRawKeys),
    usageRawKeys,
    contentTypes,
    messageId: typeof parsed.id === "string" ? parsed.id : "",
    model: typeof parsed.model === "string" ? parsed.model : "",
    toolUseIds,
    thinkingSignature,
    raw: parsed,
  };
}

function parseOpenAIJsonResponse(text) {
  const parsed = tryParseJson(text);
  if (!parsed || typeof parsed !== "object") {
    return {
      responseText: text,
      usage: {},
      usageStyle: "unknown",
      finishReason: "",
      finishReasons: [],
      objectType: "",
      hasChoices: false,
      choicesCount: 0,
      hasMessageObject: false,
      toolCalls: [],
      refusal: "",
      created: 0,
      serviceTier: "",
      systemFingerprint: "",
      raw: parsed,
    };
  }

  const choices = Array.isArray(parsed.choices) ? parsed.choices : [];
  const firstChoice = choices[0] && typeof choices[0] === "object" ? choices[0] : {};
  const firstMessage = firstChoice?.message && typeof firstChoice.message === "object" ? firstChoice.message : {};
  const responseText = extractOpenAIContentText(firstMessage.content);
  const usage = parsed.usage && typeof parsed.usage === "object" ? parsed.usage : {};
  const finishReasons = choices
    .map((choice) => typeof choice?.finish_reason === "string" ? choice.finish_reason : "")
    .filter(Boolean);
  const toolCalls = choices.flatMap((choice) => extractOpenAIToolCalls(choice?.message));
  const refusal = extractOpenAIRefusal(firstMessage);
  return {
    responseText: responseText || text,
    usage,
    usageStyle: detectUsageStyleFromKeys(Object.keys(usage)),
    messageId: typeof parsed.id === "string" ? parsed.id : "",
    model: typeof parsed.model === "string" ? parsed.model : "",
    finishReason: finishReasons[0] || "",
    finishReasons,
    objectType: typeof parsed.object === "string" ? parsed.object : "",
    hasChoices: choices.length > 0,
    choicesCount: choices.length,
    hasMessageObject: !!firstChoice?.message && typeof firstChoice.message === "object",
    toolCalls,
    refusal,
    created: typeof parsed.created === "number" ? parsed.created : 0,
    serviceTier: typeof parsed.service_tier === "string" ? parsed.service_tier : "",
    systemFingerprint: typeof parsed.system_fingerprint === "string" ? parsed.system_fingerprint : "",
    raw: parsed,
  };
}

async function parseAnthropicStreamResponse(readable, handlers = {}) {
  let responseText = "";
  let thinkingText = "";
  let messageId = "";
  let model = "";
  let thinkingSignature = "";
  let signatureDeltaTotalLength = 0;
  let signatureDeltaCount = 0;
  const usage = {};
  const usageRawKeysSet = new Set();
  const eventTypes = [];
  const contentTypesSet = new Set();
  const toolUseIds = [];

  const streamParse = await parseSseDataStream(readable, (data) => {
    const event = tryParseJson(data);
    if (!event || typeof event !== "object") return;

    const eventType = typeof event.type === "string" ? event.type : "";
    if (eventType) eventTypes.push(eventType);

    if (eventType === "message_start") {
      if (typeof event.message?.id === "string") {
        messageId = event.message.id;
      }
      if (typeof event.message?.model === "string") {
        model = event.message.model;
      }
      Object.keys(event.message?.usage || {}).forEach((key) => usageRawKeysSet.add(key));
      mergeUsage(usage, event.message?.usage);
    } else if (eventType === "content_block_start") {
      const blockType = event.content_block?.type;
      if (typeof blockType === "string" && blockType) {
        contentTypesSet.add(blockType);
      }
      if (blockType === "tool_use" && typeof event.content_block?.id === "string") {
        toolUseIds.push(event.content_block.id);
      }
    } else if (eventType === "content_block_delta") {
      const delta = event.delta;
      const deltaType = typeof delta?.type === "string" ? delta.type : "";
      if (deltaType === "text_delta" && typeof delta?.text === "string") {
        responseText += delta.text;
        if (typeof handlers.onTextDelta === "function") {
          handlers.onTextDelta(delta.text, responseText);
        }
      } else if (deltaType === "thinking_delta") {
        contentTypesSet.add("thinking");
        if (typeof delta?.thinking === "string") {
          thinkingText += delta.thinking;
          if (typeof handlers.onThinkingDelta === "function") {
            handlers.onThinkingDelta(delta.thinking, thinkingText);
          }
        }
      } else if (deltaType === "signature_delta" && typeof delta?.signature === "string") {
        thinkingSignature += delta.signature;
        signatureDeltaTotalLength += delta.signature.length;
        signatureDeltaCount += 1;
      }
    } else if (eventType === "message_delta") {
      Object.keys(event.usage || {}).forEach((key) => usageRawKeysSet.add(key));
      mergeUsage(usage, event.usage);
    }
  });

  if (streamParse.parsedEvents === 0) {
    const fallback = parseAnthropicJsonResponse(streamParse.rawText);
    if (fallback.responseText && typeof handlers.onTextDelta === "function") {
      handlers.onTextDelta(fallback.responseText, fallback.responseText);
    }
    return {
      responseText: fallback.responseText,
      thinkingText: fallback.thinkingText,
      usage: fallback.usage,
      usageStyle: fallback.usageStyle,
      usageRawKeys: fallback.usageRawKeys,
      contentTypes: fallback.contentTypes,
      sseMeta: { eventTypes: [], contentTypes: fallback.contentTypes },
      signatureDeltaTotalLength: 0,
      signatureDeltaCount: 0,
      firstChunkLatencyMs: streamParse.firstChunkLatencyMs,
      messageId: fallback.messageId,
      model: fallback.model,
      toolUseIds: fallback.toolUseIds,
      thinkingSignature: fallback.thinkingSignature,
      rawText: streamParse.rawText,
      parsedAsJsonFallback: true,
    };
  }

  return {
    responseText,
    thinkingText,
    usage,
    usageStyle: detectUsageStyleFromKeys([...usageRawKeysSet]),
    usageRawKeys: [...usageRawKeysSet],
    contentTypes: [...contentTypesSet],
    sseMeta: { eventTypes, contentTypes: [...contentTypesSet] },
    signatureDeltaTotalLength,
    signatureDeltaCount,
    firstChunkLatencyMs: streamParse.firstChunkLatencyMs,
    messageId,
    model,
    toolUseIds,
    thinkingSignature,
    rawText: streamParse.rawText,
    parsedAsJsonFallback: false,
  };
}

async function parseOpenAIStreamResponse(readable, handlers = {}) {
  let responseText = "";
  let messageId = "";
  let model = "";
  let created = 0;
  const usage = {};
  const usageRawKeysSet = new Set();
  const objectTypes = [];
  const finishReasonsSet = new Set();
  let chunkCount = 0;
  let deltaCount = 0;
  let usageChunkCount = 0;
  let sawChoices = false;
  let sawMessageObject = false;
  let sawTextDelta = false;
  let sawRoleDelta = false;
  let sawToolCallDelta = false;
  let serviceTier = "";
  let systemFingerprint = "";

  const streamParse = await parseSseDataStream(readable, (data) => {
    const event = tryParseJson(data);
    if (!event || typeof event !== "object") return;
    chunkCount += 1;

    if (typeof event.id === "string") {
      messageId = event.id;
    }
    if (typeof event.model === "string") {
      model = event.model;
    }
    if (typeof event.created === "number" && event.created > 0) {
      created = event.created;
    }
    if (typeof event.object === "string") {
      objectTypes.push(event.object);
    }
    if (typeof event.service_tier === "string" && event.service_tier) {
      serviceTier = event.service_tier;
    }
    if (typeof event.system_fingerprint === "string" && event.system_fingerprint) {
      systemFingerprint = event.system_fingerprint;
    }
    Object.keys(event.usage || {}).forEach((key) => usageRawKeysSet.add(key));
    mergeUsage(usage, event.usage);
    if (event.usage && typeof event.usage === "object" && Object.keys(event.usage).length > 0) {
      usageChunkCount += 1;
    }

    if (!Array.isArray(event.choices)) return;
    sawChoices = true;
    for (const choice of event.choices) {
      if (typeof choice?.finish_reason === "string" && choice.finish_reason) {
        finishReasonsSet.add(choice.finish_reason);
      }
      const delta = choice?.delta;
      if (delta) {
        deltaCount += 1;
        if (typeof delta.role === "string" && delta.role) {
          sawRoleDelta = true;
        }
        if (typeof delta.content === "string") {
          responseText += delta.content;
          sawTextDelta = true;
          if (typeof handlers.onTextDelta === "function") {
            handlers.onTextDelta(delta.content, responseText);
          }
        } else if (Array.isArray(delta.content)) {
          const deltaText = extractOpenAIContentText(delta.content);
          responseText += deltaText;
          if (deltaText) sawTextDelta = true;
          if (deltaText && typeof handlers.onTextDelta === "function") {
            handlers.onTextDelta(deltaText, responseText);
          }
        }
        if (Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0) {
          sawToolCallDelta = true;
        }
      } else if (choice?.message?.content) {
        sawMessageObject = true;
        const messageText = extractOpenAIContentText(choice.message.content);
        responseText += messageText;
        if (messageText && typeof handlers.onTextDelta === "function") {
          handlers.onTextDelta(messageText, responseText);
        }
      } else if (choice?.message) {
        sawMessageObject = true;
      }
    }
  });

  if (streamParse.parsedEvents === 0) {
    const fallback = parseOpenAIJsonResponse(streamParse.rawText);
    if (fallback.responseText && typeof handlers.onTextDelta === "function") {
      handlers.onTextDelta(fallback.responseText, fallback.responseText);
    }
    return {
      responseText: fallback.responseText,
      usage: fallback.usage,
      usageStyle: fallback.usageStyle,
      firstChunkLatencyMs: streamParse.firstChunkLatencyMs,
      messageId: fallback.messageId,
      model: fallback.model,
      finishReason: fallback.finishReason,
      finishReasons: fallback.finishReasons,
      objectType: fallback.objectType,
      created: fallback.created,
      serviceTier: fallback.serviceTier,
      systemFingerprint: fallback.systemFingerprint,
      toolCalls: fallback.toolCalls,
      refusal: fallback.refusal,
      hasChoices: fallback.hasChoices,
      choicesCount: fallback.choicesCount,
      hasMessageObject: fallback.hasMessageObject,
      streamMeta: {
        chunkCount: 0,
        deltaCount: 0,
        objectTypes: fallback.objectType ? [fallback.objectType] : [],
        finishReasons: fallback.finishReasons,
        usageChunkCount: 0,
        sawChoices: fallback.hasChoices,
        sawMessageObject: fallback.hasMessageObject,
        sawTextDelta: !!fallback.responseText,
        sawRoleDelta: false,
        sawToolCallDelta: fallback.toolCalls.length > 0,
      },
      rawText: streamParse.rawText,
      parsedAsJsonFallback: true,
    };
  }

  return {
    responseText,
    usage,
    usageStyle: detectUsageStyleFromKeys([...usageRawKeysSet]),
    firstChunkLatencyMs: streamParse.firstChunkLatencyMs,
    messageId,
    model,
    finishReason: [...finishReasonsSet][0] || "",
    finishReasons: [...finishReasonsSet],
    objectType: objectTypes[objectTypes.length - 1] || "",
    created,
    serviceTier,
    systemFingerprint,
    toolCalls: [],
    refusal: "",
    hasChoices: sawChoices,
    choicesCount: sawChoices ? 1 : 0,
    hasMessageObject: sawMessageObject || sawTextDelta || sawToolCallDelta,
    streamMeta: {
      chunkCount,
      deltaCount,
      objectTypes,
      finishReasons: [...finishReasonsSet],
      usageChunkCount,
      sawChoices,
      sawMessageObject,
      sawTextDelta,
      sawRoleDelta,
      sawToolCallDelta,
    },
    rawText: streamParse.rawText,
    parsedAsJsonFallback: false,
  };
}

/* ── Knowledge cutoff patterns (from claude_detector.py) ── */

const MAY_2025 = [/2025\s*年?\s*5\s*月/i, /2025[-/.]\s*0?5/i, /May\s*2025/i];
const EARLY_2025 = [/2025\s*年?\s*初/i, /early\s*2025/i];
const JAN_FEB_2025 = [
  /2025\s*年?\s*1\s*月/i, /January\s*2025/i,
  /2025\s*年?\s*2\s*月/i, /February\s*2025/i,
];
const OLDER_CUTOFF = [
  /2024\s*年?\s*6\s*月/i, /June\s*2024/i,
  /2024\s*年?\s*10\s*月/i, /October\s*2024/i,
  /2024\s*年?\s*4\s*月/i, /April\s*2024/i,
  /2025\s*年?\s*4\s*月/i, /April\s*2025/i,
];

function scoreKnowledgeCutoff(text) {
  const notes = [];
  let score = 0;
  if (MAY_2025.some((p) => p.test(text))) {
    notes.push("知识截止匹配 May 2025");
    score = 50;
  } else if (EARLY_2025.some((p) => p.test(text))) {
    notes.push("知识截止约 early 2025（不确定）");
    score = 25;
  } else if (JAN_FEB_2025.some((p) => p.test(text))) {
    notes.push("知识截止看起来是 Jan/Feb 2025");
    score = 10;
  } else if (OLDER_CUTOFF.some((p) => p.test(text))) {
    notes.push("知识截止匹配旧版模型");
    score = 0;
  } else {
    notes.push("知识截止时间不明确");
    score = 0;
  }
  return { score, notes };
}

function scoreSseShape(meta) {
  const notes = [];
  let score = 0;
  const types = meta.eventTypes || [];
  const has = (t) => types.includes(t);
  if (has("message_start")) score += 4;
  if (has("content_block_start")) score += 4;
  if (has("content_block_delta")) score += 4;
  if (has("message_delta")) score += 4;
  if (has("message_stop")) score += 2;
  const contentTypes = meta.contentTypes || [];
  if (contentTypes.some((t) => t === "text")) score += 2;

  const known = new Set([
    "ping","message_start","content_block_start",
    "content_block_delta","content_block_stop",
    "message_delta","message_stop",
  ]);
  const unknown = types.filter((t) => !known.has(t));
  if (unknown.length) {
    const penalty = Math.min(6, 2 * unknown.length);
    score = Math.max(score - penalty, 0);
    notes.push(`未知事件: ${unknown.join(", ")}`);
  }
  notes.push(`SSE 得分: ${score}/20`);
  return { score, notes };
}

function scoreThinking(meta) {
  const notes = [];
  let score = 0;
  const contentTypes = meta.contentTypes || [];
  if (contentTypes.includes("thinking")) {
    score += 15;
    notes.push("检测到 thinking block");
  }
  const types = meta.eventTypes || [];
  if (types.includes("content_block_delta")) {
    score += 5;
  }
  if (score === 0) notes.push("未检测到 thinking 信号");
  return { score, notes };
}

function scoreUsage(usage) {
  const notes = [];
  let score = 0;
  if (typeof usage.input_tokens === "number") {
    score += 4;
  }
  if (typeof usage.output_tokens === "number") {
    score += 4;
  }
  if (typeof usage.cache_read_input_tokens === "number") {
    score += 2;
  }
  if (score === 0) notes.push("未找到 usage 字段");
  else notes.push(`Usage 得分: ${score}/10`);
  return { score, notes };
}

function classifyChecklistStatus(score, max, thresholds = {}) {
  const safeMax = Math.max(1, Number(max) || 1);
  const ratio = Math.max(0, Math.min(1, (Number(score) || 0) / safeMax));
  const passAt = typeof thresholds.passAt === "number" ? thresholds.passAt : 0.75;
  const warningAt = typeof thresholds.warningAt === "number" ? thresholds.warningAt : 0.35;
  if (ratio >= passAt) return "pass";
  if (ratio >= warningAt) return "warning";
  return "fail";
}

function createBreakdownItem({ name, score, max, notes = [], status, thresholds }) {
  const safeScore = Math.max(0, Math.min(Number(max) || 0, Number(score) || 0));
  const safeMax = Math.max(1, Number(max) || 1);
  const normalizedNotes = Array.isArray(notes)
    ? notes.filter(Boolean)
    : [String(notes || "")].filter(Boolean);

  return {
    name,
    score: safeScore,
    max: safeMax,
    detail: `${safeScore}/${safeMax}`,
    notes: normalizedNotes,
    status: status || classifyChecklistStatus(safeScore, safeMax, thresholds),
  };
}

const OPENAI_FINISH_REASON_SET = new Set([
  "stop",
  "length",
  "content_filter",
  "tool_calls",
  "function_call",
]);

function looksLikeCapabilityLimitedProbe(probe = null, capability = "") {
  const message = String(probe?.serverMessage || "").toLowerCase();
  if (!message) return false;
  const fragments = [
    "unsupported",
    "not supported",
    "does not support",
    "not available",
    "unknown parameter",
    "invalid parameter",
    "only supported",
    capability,
  ].filter(Boolean);
  return fragments.some((fragment) => message.includes(String(fragment).toLowerCase()));
}

function compactProbeOutcome(probe = null) {
  if (!probe) return "未执行";
  if (probe.validation?.pass) return "通过";
  if (probe.statusCode === 200) return "结构异常";
  if (looksLikeCapabilityLimitedProbe(probe)) return "能力受限";
  if (probe.statusCode > 0) return `HTTP ${probe.statusCode}`;
  return probe.error || "失败";
}

function scoreOpenAIResponseShape(openaiResponseMeta = {}) {
  const notes = [];
  let score = 0;
  const isStreamLike = !!openaiResponseMeta?.streamMeta;

  if (openaiResponseMeta.objectType === "chat.completion") {
    score += 8;
    notes.push("响应 object=chat.completion");
  } else if (isStreamLike && openaiResponseMeta.objectType === "chat.completion.chunk") {
    score += 8;
    notes.push("流式响应 object=chat.completion.chunk");
  } else if (openaiResponseMeta.objectType) {
    notes.push(`响应 object=${openaiResponseMeta.objectType}，不是标准 chat.completion`);
  } else {
    notes.push("响应缺少 object 字段");
  }

  if (openaiResponseMeta.messageId) {
    score += 4;
    notes.push("响应包含 id");
  } else {
    notes.push("响应缺少 id");
  }

  if (typeof openaiResponseMeta.created === "number" && openaiResponseMeta.created > 0) {
    score += 3;
  } else {
    notes.push("响应缺少 created 时间戳");
  }

  if (openaiResponseMeta.hasChoices) {
    score += 5;
    notes.push(`choices 数量=${openaiResponseMeta.choicesCount}`);
  } else {
    notes.push("响应缺少 choices 数组");
  }

  if (openaiResponseMeta.hasMessageObject) {
    score += 5;
    notes.push("choices[0].message 存在");
  } else {
    notes.push("choices[0].message 缺失或不是对象");
  }

  return {
    score: Math.max(0, Math.min(25, score)),
    notes,
  };
}

function scoreOpenAIFinishReasonDetail(openaiResponseMeta = {}) {
  const finishReasons = Array.isArray(openaiResponseMeta.finishReasons)
    ? openaiResponseMeta.finishReasons.filter(Boolean)
    : [];
  if (finishReasons.length === 0) {
    return {
      score: 0,
      notes: ["响应缺少 finish_reason"],
    };
  }

  const notes = [`finish_reason=${finishReasons.join(", ")}`];
  const allRecognized = finishReasons.every((reason) => OPENAI_FINISH_REASON_SET.has(reason));
  if (allRecognized) {
    return {
      score: 10,
      notes,
    };
  }

  const recognizedCount = finishReasons.filter((reason) => OPENAI_FINISH_REASON_SET.has(reason)).length;
  return {
    score: recognizedCount > 0 ? 6 : 2,
    notes: [
      ...notes,
      "存在非标准 finish_reason，建议检查网关是否改写了响应结构",
    ],
  };
}

function scoreOpenAIStreamProtocol({
  requestType,
  firstChunkLatencyMs,
  openaiResponseMeta = {},
}) {
  if (requestType !== "stream") {
    return {
      score: 15,
      notes: ["当前检测为非流式，请切到 stream 模式再校验 chunk / delta 协议"],
    };
  }

  const notes = [];
  let score = 0;
  const streamMeta = openaiResponseMeta.streamMeta || {};
  const objectTypes = Array.isArray(streamMeta.objectTypes) ? streamMeta.objectTypes : [];

  if (typeof firstChunkLatencyMs === "number" && firstChunkLatencyMs >= 0) {
    score += 2;
    notes.push(`已记录首包延迟 ${firstChunkLatencyMs}ms`);
  } else {
    notes.push("未记录到首包延迟");
  }

  if (streamMeta.chunkCount > 0) {
    score += 3;
    notes.push(`SSE chunk 数量=${streamMeta.chunkCount}`);
  } else {
    notes.push("未解析到任何 SSE chunk");
  }

  if (objectTypes.includes("chat.completion.chunk")) {
    score += 4;
    notes.push("检测到标准 chat.completion.chunk");
  } else if (objectTypes.length > 0) {
    notes.push(`stream object=${objectTypes.join(", ")}`);
  } else {
    notes.push("stream 响应缺少 object 字段");
  }

  if (streamMeta.sawChoices) {
    score += 2;
  } else {
    notes.push("stream chunk 中未观察到 choices");
  }

  if (streamMeta.deltaCount > 0) {
    score += 2;
    notes.push(`delta 数量=${streamMeta.deltaCount}`);
  } else {
    notes.push("未观察到 delta");
  }

  if (streamMeta.sawTextDelta || streamMeta.sawToolCallDelta || streamMeta.sawRoleDelta) {
    score += 2;
  } else {
    notes.push("未观察到文本 / role / tool_call delta");
  }

  return {
    score: Math.max(0, Math.min(15, score)),
    notes,
  };
}

function scoreOpenAIUsageProtocol({
  usage = {},
  requestType,
  openaiResponseMeta = {},
}) {
  const notes = [];
  let score = 0;
  const keys = Object.keys(usage || {});
  const hasInput = typeof usage.input_tokens === "number" || typeof usage.prompt_tokens === "number";
  const hasOutput = typeof usage.output_tokens === "number" || typeof usage.completion_tokens === "number";
  const hasTotal = typeof usage.total_tokens === "number";

  if (keys.length > 0) {
    score += 2;
    notes.push(`usage keys: ${keys.join(", ")}`);
  } else {
    notes.push("响应未返回 usage");
  }

  if (hasInput) score += 3;
  if (hasOutput) score += 3;
  if (hasTotal) score += 2;

  if (requestType === "stream") {
    const usageChunkCount = Number(openaiResponseMeta?.streamMeta?.usageChunkCount || 0);
    if (usageChunkCount > 0) {
      score += 0;
      notes.push(`stream 中检测到 ${usageChunkCount} 个 usage chunk`);
    } else {
      notes.push("stream 已请求 include_usage，但未观察到最终 usage chunk；若连接被提前中断，这种情况可接受");
    }
  }

  return {
    score: Math.max(0, Math.min(10, score)),
    notes,
  };
}

function scoreOpenAIModelConsistency({ requestedModelId, responseModel }) {
  const requested = String(requestedModelId || "").trim().toLowerCase();
  const echoed = String(responseModel || "").trim();
  const echoedLower = echoed.toLowerCase();

  if (!echoed) {
    return {
      score: 0,
      notes: ["响应未回显 model 字段"],
    };
  }

  const notes = [`响应回显 model=${echoed}`];
  if (requested && echoedLower === requested) {
    return { score: 15, notes: [...notes, "回显模型与请求模型完全一致"] };
  }
  if (requested && echoedLower.startsWith(requested)) {
    return { score: 13, notes: [...notes, "回显模型是请求模型的更具体快照或变体"] };
  }
  if (requested && requested.startsWith("gpt-5.4") && echoedLower.startsWith("gpt-5.4")) {
    return { score: 12, notes: [...notes, "回显模型仍位于 gpt-5.4 家族"] };
  }

  return {
    score: 6,
    notes: [
      ...notes,
      requested ? "回显模型与请求模型不完全一致，可能发生了 alias 映射或静默改写" : "请求模型为空，无法做一致性比较",
    ],
  };
}

function scoreOpenAIToolsCapability(sourceAnalysis = null) {
  const probe = sourceAnalysis?.protocolChecks?.tools || null;
  if (!probe) {
    return {
      score: 3,
      status: "warning",
      notes: ["未执行 tools / tool_calls 探针"],
    };
  }

  if (probe.validation?.pass) {
    return {
      score: 10,
      status: "pass",
      notes: [probe.validation.detail || "tool_calls 结构有效"],
    };
  }

  if (looksLikeCapabilityLimitedProbe(probe, "tool")) {
    return {
      score: 6,
      status: "warning",
      notes: [
        probe.serverMessage || "模型或网关明确声明当前不支持 tools / tool_calls",
        "本项记为能力受限，不按硬失败处理",
      ],
    };
  }

  if (probe.statusCode === 200) {
    return {
      score: 3,
      status: "warning",
      notes: [probe.validation?.detail || "tool_calls 返回结构异常"],
    };
  }

  return {
    score: 0,
    status: "fail",
    notes: [probe.serverMessage || `tools 探针失败：HTTP ${probe.statusCode || 0}`],
  };
}

function scoreOpenAIStructuredCapability(sourceAnalysis = null) {
  const probe = sourceAnalysis?.protocolChecks?.structuredOutputs || null;
  if (!probe) {
    return {
      score: 4,
      status: "warning",
      notes: ["未执行 Structured Outputs 探针"],
    };
  }

  if (probe.validation?.pass) {
    return {
      score: 15,
      status: "pass",
      notes: [probe.validation.detail || "strict json_schema 通过"],
    };
  }

  if (looksLikeCapabilityLimitedProbe(probe, "json_schema")
    || looksLikeCapabilityLimitedProbe(probe, "response_format")) {
    return {
      score: 9,
      status: "warning",
      notes: [
        probe.serverMessage || "模型或网关明确声明当前不支持 Structured Outputs",
        "本项记为能力受限，不按硬失败处理",
      ],
    };
  }

  if (probe.statusCode === 200) {
    return {
      score: 5,
      status: "warning",
      notes: [probe.validation?.detail || "Structured Outputs 返回结构异常"],
    };
  }

  return {
    score: 0,
    status: "fail",
    notes: [probe.serverMessage || `Structured Outputs 探针失败：HTTP ${probe.statusCode || 0}`],
  };
}

function buildAnthropicDetectBreakdown({
  useStream,
  responseText,
  sseMeta,
  usage,
  signatureDeltaTotalLength,
  signatureDeltaCount,
  withThinking,
}) {
  const knowledge = scoreKnowledgeCutoff(responseText);
  let sse;
  let thinking;

  if (useStream) {
    sse = scoreSseShape(sseMeta);
    thinking = scoreThinking(sseMeta);
  } else {
    sse = { score: 20, notes: ["非流式调用已跳过 SSE 检查"] };
    if ((sseMeta.contentTypes || []).includes("thinking")) {
      thinking = { score: 20, notes: ["非流式响应检测到 thinking block"] };
    } else if (withThinking === false) {
      thinking = { score: 0, notes: ["当前检测已关闭 Thinking"] };
    } else {
      thinking = { score: 0, notes: ["非流式响应中未检测到 thinking block"] };
    }
  }

  const usageScore = scoreUsage(usage);
  let penalty = 0;
  const penaltyNotes = [];
  if (useStream && signatureDeltaCount > 0 && signatureDeltaTotalLength === 0) {
    penalty += 5;
    penaltyNotes.push("空签名 delta 检测到");
  }

  const items = [
    createBreakdownItem({
      name: "知识截止时间",
      score: knowledge.score,
      max: 50,
      notes: knowledge.notes,
      thresholds: { passAt: 0.8, warningAt: 0.4 },
    }),
    createBreakdownItem({
      name: "SSE 事件格式",
      score: sse.score,
      max: 20,
      notes: sse.notes,
      thresholds: { passAt: 0.8, warningAt: 0.4 },
    }),
    createBreakdownItem({
      name: "Thinking Block",
      score: thinking.score,
      max: 20,
      notes: thinking.notes,
      thresholds: { passAt: 0.75, warningAt: 0.25 },
    }),
    createBreakdownItem({
      name: "Usage 字段",
      score: usageScore.score,
      max: 10,
      notes: usageScore.notes,
      thresholds: { passAt: 0.8, warningAt: 0.4 },
    }),
  ];

  if (penalty > 0) {
    items.push(createBreakdownItem({
      name: "惩罚项",
      score: 0,
      max: penalty,
      notes: penaltyNotes,
      status: "fail",
    }));
  }

  const total = Math.max(0, Math.min(100,
    knowledge.score + sse.score + thinking.score + usageScore.score - penalty
  ));

  return {
    total,
    breakdown: {
      kind: "anthropic",
      items,
      knowledge: { score: knowledge.score, max: 50, notes: knowledge.notes },
      sse: { score: sse.score, max: 20, notes: sse.notes },
      thinking: { score: thinking.score, max: 20, notes: thinking.notes },
      usage: { score: usageScore.score, max: 10, notes: usageScore.notes },
      penalty: { score: penalty, notes: penaltyNotes },
    },
  };
}

function buildOpenAIDetectBreakdown({
  usage,
  firstChunkLatencyMs,
  requestType,
  requestedModelId,
  responseModel,
  sourceAnalysis,
  openaiResponseMeta,
}) {
  const responseShape = scoreOpenAIResponseShape(openaiResponseMeta);
  const finishReason = scoreOpenAIFinishReasonDetail(openaiResponseMeta);
  const streamProtocol = scoreOpenAIStreamProtocol({
    requestType,
    firstChunkLatencyMs,
    openaiResponseMeta,
  });
  const usageScore = scoreOpenAIUsageProtocol({
    usage,
    requestType,
    openaiResponseMeta,
  });
  const modelEcho = scoreOpenAIModelConsistency({ requestedModelId, responseModel });
  const toolsScore = scoreOpenAIToolsCapability(sourceAnalysis);
  const structuredScore = scoreOpenAIStructuredCapability(sourceAnalysis);

  const items = [
    createBreakdownItem({
      name: "响应结构",
      score: responseShape.score,
      max: 25,
      notes: responseShape.notes,
      thresholds: { passAt: 0.8, warningAt: 0.4 },
    }),
    createBreakdownItem({
      name: "finish_reason",
      score: finishReason.score,
      max: 10,
      notes: finishReason.notes,
      thresholds: { passAt: 0.8, warningAt: 0.4 },
    }),
    createBreakdownItem({
      name: "流式协议",
      score: streamProtocol.score,
      max: 15,
      notes: streamProtocol.notes,
      thresholds: { passAt: 0.8, warningAt: 0.4 },
    }),
    createBreakdownItem({
      name: "Usage 返回",
      score: usageScore.score,
      max: 10,
      notes: usageScore.notes,
      thresholds: { passAt: 0.7, warningAt: 0.3 },
    }),
    createBreakdownItem({
      name: "模型回显",
      score: modelEcho.score,
      max: 15,
      notes: modelEcho.notes,
      thresholds: { passAt: 0.75, warningAt: 0.35 },
    }),
    createBreakdownItem({
      name: "Tools / tool_calls",
      score: toolsScore.score,
      max: 10,
      notes: toolsScore.notes,
      status: toolsScore.status,
    }),
    createBreakdownItem({
      name: "Structured Outputs",
      score: structuredScore.score,
      max: 15,
      notes: structuredScore.notes,
      status: structuredScore.status,
    }),
  ];

  const total = Math.max(0, Math.min(100,
    responseShape.score
      + finishReason.score
      + streamProtocol.score
      + usageScore.score
      + modelEcho.score
      + toolsScore.score
      + structuredScore.score
  ));

  return {
    total,
    breakdown: {
      kind: "openai",
      items,
      responseShape: { score: responseShape.score, max: 25, notes: responseShape.notes },
      finishReason: { score: finishReason.score, max: 10, notes: finishReason.notes },
      streamProtocol: { score: streamProtocol.score, max: 15, notes: streamProtocol.notes },
      usage: { score: usageScore.score, max: 10, notes: usageScore.notes },
      modelEcho: { score: modelEcho.score, max: 15, notes: modelEcho.notes },
      tools: { score: toolsScore.score, max: 10, notes: toolsScore.notes, status: toolsScore.status },
      structuredOutputs: {
        score: structuredScore.score,
        max: 15,
        notes: structuredScore.notes,
        status: structuredScore.status,
      },
      penalty: { score: 0, notes: [] },
    },
  };
}

function sendNdjsonChunk(res, payload) {
  res.write(`${JSON.stringify(payload)}\n`);
}

function buildDetectUpstreamRequest({ apiUrl, apiKey, modelId, mode, withThinking, requestType }) {
  const isAnthropic = mode === "anthropic";
  const useStream = requestType === "stream";
  let endpoint;
  let headers;
  let body;

  if (isAnthropic) {
    endpoint = apiUrl.replace(/\/+$/, "") + "/v1/messages";
    headers = {
      "accept": "application/json",
      "anthropic-beta": "claude-code-20250219,interleaved-thinking-2025-05-14",
      "anthropic-dangerous-direct-browser-access": "true",
      "anthropic-version": "2023-06-01",
      "authorization": `Bearer ${apiKey}`,
      "content-type": "application/json",
      "x-api-key": apiKey,
    };
    body = {
      model: modelId,
      messages: [{
        role: "user",
        content: [{ type: "text", text: "你是谁,你的知识库截止时间是什么时候? 请一定要诚实回答" }],
      }],
      max_tokens: withThinking !== false ? 32000 : 4096,
      stream: useStream,
    };
    if (withThinking !== false) {
      body.thinking = { type: "enabled", budget_tokens: 31999 };
    }
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
        content: "Return the single token ok exactly.",
      }],
      max_tokens: 32,
      stream: useStream,
    };
    if (useStream) {
      body.stream_options = { include_usage: true };
    }
  }

  return { isAnthropic, useStream, endpoint, headers, body };
}

function buildDetectResultPayload({
  isAnthropic,
  useStream,
  responseText,
  sseMeta,
  usage,
  signatureDeltaTotalLength,
  signatureDeltaCount,
  latencyMs,
  firstChunkLatencyMs,
  withThinking,
  requestType,
  requestedModelId,
  responseModel,
  sourceAnalysis,
  openaiResponseMeta,
  analysisDepth = "deep",
}) {
  const scoring = isAnthropic
    ? buildAnthropicDetectBreakdown({
        useStream,
        responseText,
        sseMeta,
        usage,
        signatureDeltaTotalLength,
        signatureDeltaCount,
        withThinking,
      })
    : buildOpenAIDetectBreakdown({
        responseText,
        usage,
        firstChunkLatencyMs,
        requestType,
        requestedModelId,
        responseModel,
        sourceAnalysis,
        openaiResponseMeta,
      });

  return {
    ok: true,
    score: scoring.total,
    breakdown: scoring.breakdown,
    responseText,
    usage,
    latencyMs,
    firstChunkLatencyMs,
    mode: isAnthropic ? "anthropic" : "openai",
    requestType,
    analysisDepth,
  };
}

const MSG_ID_UUID_PATTERN = /^msg_[0-9a-f]{8}-[0-9a-f]{4}-/i;
const PURE_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const THINKING_SIG_SHORT_THRESHOLD = 100;
const OPENAI_GPT54_ALIAS = "gpt-5.4";
const OPENAI_GPT54_SNAPSHOT = "gpt-5.4-2026-03-05";
const OPENAI_GPT54_PRIMARY_PATTERN = /^gpt-5\.4(?:-\d{4}-\d{2}-\d{2})?$/i;
const OPENAI_GPT54_FAMILY_PATTERN = /^gpt-5\.4(?:$|-)/i;

function headersToObject(headers) {
  try {
    return Object.fromEntries(headers.entries());
  } catch {
    return {};
  }
}

function detectProxyPlatform(headers = {}) {
  const lowered = {};
  for (const [key, value] of Object.entries(headers)) {
    lowered[key.toLowerCase()] = value;
  }

  const clues = [];
  let platform = "";

  if (Object.keys(lowered).some((key) => key.includes("aidistri"))) {
    platform = "Aidistri";
    clues.push("X-Aidistri-Request-Id");
  }

  const corsHeaders = String(lowered["access-control-allow-headers"] || "");
  if (corsHeaders.toLowerCase().includes("accounthub")) {
    platform = platform || "AccountHub";
    clues.push("AccountHub CORS headers");
  }

  if (Object.keys(lowered).some((key) => key.includes("openrouter"))
    || Object.values(lowered).some((value) => String(value).toLowerCase().includes("openrouter"))) {
    platform = platform || "OpenRouter";
    clues.push("OpenRouter headers");
  }

  if (Object.keys(lowered).some((key) => key.includes("one-api") || key.includes("new-api"))) {
    platform = platform || "OneAPI/NewAPI";
    clues.push("OneAPI/NewAPI headers");
  }

  if (!platform && lowered.server === "cloudflare" && lowered["cf-ray"]) {
    platform = "Cloudflare Proxy";
    clues.push(`CF-Ray ${lowered["cf-ray"]}`);
  }

  return { platform, clues };
}

function classifyToolId(toolId = "") {
  if (!toolId) return { source: "unknown", format: "" };
  if (toolId.startsWith("toolu_")) return { source: "anthropic", format: "toolu_" };
  if (toolId.startsWith("tooluse_")) return { source: "bedrock", format: "tooluse_" };
  if (/^tool_\d+$/i.test(toolId)) return { source: "vertex", format: "tool_N" };
  return { source: "rewritten", format: "other" };
}

function classifyMessageId(messageId = "") {
  if (!messageId) return { source: "unknown", format: "" };
  if (messageId.startsWith("req_vrtx_")) return { source: "vertex", format: "req_vrtx_" };
  if (messageId.startsWith("msg_") && MSG_ID_UUID_PATTERN.test(messageId)) {
    return { source: "antigravity", format: "msg_uuid" };
  }
  if (messageId.startsWith("msg_")) {
    return { source: "anthropic", format: "msg_base62" };
  }
  if (PURE_UUID_PATTERN.test(messageId)) {
    return { source: "rewritten", format: "uuid" };
  }
  return { source: "rewritten", format: "other" };
}

function classifyThinkingSignature(signature = "") {
  if (!signature) return "none";
  if (signature.startsWith("claude#")) return "vertex";
  if (signature.length < THINKING_SIG_SHORT_THRESHOLD) return "short";
  return "normal";
}

function classifyModelSource(model = "") {
  if (!model) return "unknown";
  if (model.startsWith("kiro-")) return "kiro";
  if (model.startsWith("anthropic.")) return "bedrock";
  if (model.startsWith("claude-")) return "anthropic";
  return "unknown";
}

function collectRatelimitHeaders(headers = {}) {
  const lowered = {};
  for (const [key, value] of Object.entries(headers)) {
    lowered[key.toLowerCase()] = value;
  }
  return {
    inputLimit: parseInt(lowered["anthropic-ratelimit-input-tokens-limit"], 10) || 0,
    inputRemaining: parseInt(lowered["anthropic-ratelimit-input-tokens-remaining"], 10) || 0,
    inputReset: String(lowered["anthropic-ratelimit-input-tokens-reset"] || ""),
    unifiedRemaining: parseInt(lowered["anthropic-ratelimit-unified-5h-remaining"], 10) || 0,
  };
}

function isOpenAIGpt54PrimaryModel(model = "") {
  return OPENAI_GPT54_PRIMARY_PATTERN.test(String(model || "").trim());
}

function isOpenAIGpt54FamilyModel(model = "") {
  return OPENAI_GPT54_FAMILY_PATTERN.test(String(model || "").trim());
}

function collectOpenAIRatelimitHeaders(headers = {}) {
  const lowered = {};
  for (const [key, value] of Object.entries(headers)) {
    lowered[key.toLowerCase()] = value;
  }

  return {
    requestId: String(lowered["x-request-id"] || ""),
    requestLimit: parseInt(lowered["x-ratelimit-limit-requests"], 10) || 0,
    requestRemaining: parseInt(lowered["x-ratelimit-remaining-requests"], 10) || 0,
    requestReset: String(lowered["x-ratelimit-reset-requests"] || ""),
    tokenLimit: parseInt(lowered["x-ratelimit-limit-tokens"], 10) || 0,
    tokenRemaining: parseInt(lowered["x-ratelimit-remaining-tokens"], 10) || 0,
    tokenReset: String(lowered["x-ratelimit-reset-tokens"] || ""),
  };
}

function extractApiErrorMessage(text = "") {
  const parsed = tryParseJson(text);
  if (parsed && typeof parsed === "object") {
    if (parsed.error && typeof parsed.error.message === "string") {
      return parsed.error.message;
    }
    if (typeof parsed.error === "string") {
      return parsed.error;
    }
    if (typeof parsed.message === "string") {
      return parsed.message;
    }
  }
  return String(text || "").trim().replace(/\s+/g, " ").slice(0, 240);
}

function validateOpenAIStructuredOutput({ responseText = "", parsedResponse = null } = {}) {
  if (parsedResponse?.refusal) {
    return {
      pass: false,
      category: "refusal",
      detail: `模型拒绝结构化输出请求：${parsedResponse.refusal.slice(0, 120)}`,
    };
  }

  const finishReasons = Array.isArray(parsedResponse?.finishReasons) ? parsedResponse.finishReasons : [];
  if (finishReasons.includes("length")) {
    return {
      pass: false,
      category: "length",
      detail: "结构化输出因 length 截断，建议降低 schema 复杂度或提高输出上限",
    };
  }
  if (finishReasons.includes("content_filter")) {
    return {
      pass: false,
      category: "content_filter",
      detail: "结构化输出命中了 content_filter",
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(responseText);
  } catch (error) {
    return {
      pass: false,
      category: "invalid_json",
      detail: `响应不是合法 JSON：${error?.message || "json_parse_failed"}`,
    };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { pass: false, category: "invalid_shape", detail: "响应 JSON 不是对象" };
  }

  const requiredKeys = ["item", "available", "quantity", "tags"];
  const keys = Object.keys(parsed);
  const missing = requiredKeys.filter((key) => !(key in parsed));
  const extras = keys.filter((key) => !requiredKeys.includes(key));

  if (missing.length > 0) {
    return { pass: false, category: "schema_mismatch", detail: `缺少字段：${missing.join(", ")}` };
  }
  if (extras.length > 0) {
    return { pass: false, category: "schema_mismatch", detail: `出现额外字段：${extras.join(", ")}` };
  }
  if (typeof parsed.item !== "string" || !parsed.item.trim()) {
    return { pass: false, category: "schema_mismatch", detail: "item 字段不是非空字符串" };
  }
  if (typeof parsed.available !== "boolean") {
    return { pass: false, category: "schema_mismatch", detail: "available 字段不是布尔值" };
  }
  if (!Number.isInteger(parsed.quantity)) {
    return { pass: false, category: "schema_mismatch", detail: "quantity 字段不是整数" };
  }
  if (!Array.isArray(parsed.tags) || parsed.tags.some((item) => typeof item !== "string")) {
    return { pass: false, category: "schema_mismatch", detail: "tags 字段不是字符串数组" };
  }

  return {
    pass: true,
    category: "pass",
    detail: `schema 有效：item=${parsed.item}, quantity=${parsed.quantity}, tags=${parsed.tags.length}`,
    parsed,
  };
}

function validateOpenAIToolCallResponse({ parsedResponse = null } = {}) {
  const finishReasons = Array.isArray(parsedResponse?.finishReasons) ? parsedResponse.finishReasons : [];
  const toolCalls = Array.isArray(parsedResponse?.toolCalls) ? parsedResponse.toolCalls : [];
  if (toolCalls.length === 0) {
    return {
      pass: false,
      detail: "响应未返回 tool_calls",
    };
  }

  const first = toolCalls[0];
  const toolName = String(first?.function?.name || "");
  if (toolName !== "probe_weather") {
    return {
      pass: false,
      detail: `首个工具名不是 probe_weather，而是 ${toolName || "(empty)"}`,
    };
  }

  let args;
  try {
    args = JSON.parse(first?.function?.arguments || "{}");
  } catch (error) {
    return {
      pass: false,
      detail: `tool arguments 不是合法 JSON：${error?.message || "json_parse_failed"}`,
    };
  }

  if (typeof args.city !== "string" || !args.city.trim()) {
    return {
      pass: false,
      detail: "tool arguments 缺少 city 字段",
    };
  }
  if (!["c", "f"].includes(String(args.unit || "").toLowerCase())) {
    return {
      pass: false,
      detail: "tool arguments 缺少合法的 unit 字段",
    };
  }

  if (!finishReasons.includes("tool_calls")) {
    return {
      pass: false,
      detail: `返回了 tool_calls，但 finish_reason=${finishReasons.join(", ") || "(empty)"}`,
    };
  }

  return {
    pass: true,
    detail: `tool_call 有效：name=${toolName}, city=${args.city}, unit=${args.unit}`,
    parsed: args,
  };
}

function buildOpenAIProbeRequest({ apiUrl, apiKey, probeType, targetModel }) {
  const endpoint = apiUrl.replace(/\/+$/, "") + "/v1/chat/completions";
  const headers = {
    "authorization": `Bearer ${apiKey}`,
    "content-type": "application/json",
  };

  let body = {
    model: targetModel,
    messages: [{ role: "user", content: "Reply with OK exactly." }],
    max_tokens: 16,
    stream: false,
  };
  let expectedFailure = false;
  let validator = null;

  if (probeType === "param_none_temperature") {
    body = {
      model: targetModel,
      messages: [{ role: "user", content: "Reply with the single token ok." }],
      reasoning_effort: "none",
      temperature: 0.2,
      max_tokens: 16,
      stream: false,
    };
  } else if (probeType === "param_high_temperature") {
    expectedFailure = true;
    body = {
      model: targetModel,
      messages: [{ role: "user", content: "Reply with the single token ok." }],
      reasoning_effort: "high",
      temperature: 0.2,
      max_tokens: 16,
      stream: false,
    };
  } else if (probeType === "structured_outputs") {
    validator = ({ responseText, parsedResponse }) => validateOpenAIStructuredOutput({ responseText, parsedResponse });
    body = {
      model: targetModel,
      messages: [{
        role: "user",
        content: "Return inventory data for item A only. available must be true, quantity must be 7, tags must be [\"alpha\",\"beta\"]. Output JSON only.",
      }],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "inventory_probe",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              item: { type: "string" },
              available: { type: "boolean" },
              quantity: { type: "integer" },
              tags: {
                type: "array",
                items: { type: "string" },
              },
            },
            required: ["item", "available", "quantity", "tags"],
          },
        },
      },
      max_tokens: 128,
      stream: false,
    };
  } else if (probeType === "tool_calls") {
    validator = ({ parsedResponse }) => validateOpenAIToolCallResponse({ parsedResponse });
    body = {
      model: targetModel,
      messages: [{
        role: "user",
        content: "Call the tool probe_weather once with city set to Paris and unit set to c. Do not answer in natural language.",
      }],
      tools: [{
        type: "function",
        function: {
          name: "probe_weather",
          description: "Return a weather probe payload.",
          parameters: {
            type: "object",
            additionalProperties: false,
            properties: {
              city: { type: "string" },
              unit: { type: "string", enum: ["c", "f"] },
            },
            required: ["city", "unit"],
          },
        },
      }],
      tool_choice: {
        type: "function",
        function: {
          name: "probe_weather",
        },
      },
      max_tokens: 128,
      stream: false,
    };
  }

  return { endpoint, headers, body, expectedFailure, validator };
}

async function performOpenAIAuthenticityProbe({ apiUrl, apiKey, probeType, targetModel }) {
  const { endpoint, headers, body, expectedFailure, validator } = buildOpenAIProbeRequest({
    apiUrl,
    apiKey,
    probeType,
    targetModel,
  });

  const started = Date.now();
  try {
    const upstream = await fetchWithTimeout(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }, {
      timeoutMs: getProbeTimeoutMs(),
      label: `openai_probe_${probeType}`,
    });

    const latencyMs = Date.now() - started;
    const responseHeaders = headersToObject(upstream.headers);
    const proxy = detectProxyPlatform(responseHeaders);
    const ratelimit = collectOpenAIRatelimitHeaders(responseHeaders);
    const rawText = await upstream.text();
    const errorMessage = extractApiErrorMessage(rawText);

    let parsedResponse = null;
    let validation = null;
    if (upstream.status === 200) {
      parsedResponse = parseOpenAIJsonResponse(rawText);
      if (typeof validator === "function") {
        validation = validator({
          responseText: parsedResponse.responseText || rawText,
          parsedResponse,
          rawText,
          headers: responseHeaders,
        });
      }
    }

    const matchedExpectation = expectedFailure
      ? upstream.status >= 400
      : upstream.status === 200 && (!validation || validation.pass !== false);

    return {
      probeType,
      targetModel,
      expectedFailure,
      matchedExpectation,
      statusCode: upstream.status,
      latencyMs,
      echoModel: parsedResponse?.model || "",
      responseText: parsedResponse?.responseText || "",
      usage: parsedResponse?.usage || {},
      usageStyle: parsedResponse?.usageStyle || "unknown",
      validation,
      serverMessage: upstream.status === 200
        ? (validation?.detail || "")
        : errorMessage,
      requestId: ratelimit.requestId,
      ratelimitRequestLimit: ratelimit.requestLimit,
      ratelimitRequestRemaining: ratelimit.requestRemaining,
      ratelimitRequestReset: ratelimit.requestReset,
      ratelimitTokenLimit: ratelimit.tokenLimit,
      ratelimitTokenRemaining: ratelimit.tokenRemaining,
      ratelimitTokenReset: ratelimit.tokenReset,
      proxyPlatform: proxy.platform,
      proxyClues: proxy.clues,
      error: "",
    };
  } catch (error) {
    return {
      probeType,
      targetModel,
      expectedFailure,
      matchedExpectation: false,
      statusCode: 0,
      latencyMs: Date.now() - started,
      echoModel: "",
      responseText: "",
      usage: {},
      usageStyle: "unknown",
      validation: null,
      serverMessage: error?.message || "probe_failed",
      requestId: "",
      ratelimitRequestLimit: 0,
      ratelimitRequestRemaining: 0,
      ratelimitRequestReset: "",
      ratelimitTokenLimit: 0,
      ratelimitTokenRemaining: 0,
      ratelimitTokenReset: "",
      proxyPlatform: "",
      proxyClues: [],
      error: error?.message || "probe_failed",
    };
  }
}

function verifyOpenAIRatelimitBehavior(fingerprints = []) {
  const requestSamples = fingerprints
    .filter((item) => item && typeof item.ratelimitRequestRemaining === "number"
      && (item.ratelimitRequestLimit > 0 || item.ratelimitRequestRemaining > 0))
    .map((item) => ({
      probeType: item.probeType,
      remaining: item.ratelimitRequestRemaining,
      limit: item.ratelimitRequestLimit,
      reset: item.ratelimitRequestReset,
    }));

  const tokenSamples = fingerprints
    .filter((item) => item && typeof item.ratelimitTokenRemaining === "number"
      && (item.ratelimitTokenLimit > 0 || item.ratelimitTokenRemaining > 0))
    .map((item) => ({
      probeType: item.probeType,
      remaining: item.ratelimitTokenRemaining,
      limit: item.ratelimitTokenLimit,
      reset: item.ratelimitTokenReset,
    }));

  const sampleType = requestSamples.length >= 2 ? "requests" : tokenSamples.length >= 2 ? "tokens" : "";
  const samples = sampleType === "requests" ? requestSamples : sampleType === "tokens" ? tokenSamples : [];

  if (samples.length < 2) {
    return {
      verdict: "unavailable",
      label: "未发现",
      detail: "未获取到可比较的 OpenAI ratelimit 头",
      samples,
    };
  }

  const remainings = samples.map((item) => item.remaining);
  const allSame = remainings.every((value) => value === remainings[0]);
  const monotone = remainings.every((value, index) => index === 0 || remainings[index - 1] >= value);
  const totalDrop = remainings[0] - remainings[remainings.length - 1];

  if (allSame) {
    return {
      verdict: "static",
      label: "静态 / 待复核",
      detail: `${sampleType} remaining 固定为 ${remainings[0]}，未随探针变化`,
      samples,
    };
  }

  if (monotone && totalDrop > 0) {
    return {
      verdict: "dynamic",
      label: "动态递减",
      detail: `${sampleType} remaining ${remainings.join(" → ")}`,
      samples,
    };
  }

  return {
    verdict: "dynamic",
    label: "动态变化",
    detail: `${sampleType} remaining 出现变化：${remainings.join(" → ")}`,
    samples,
  };
}

function compactProbeLabel(probe) {
  if (!probe) return "--";
  return probe.matchedExpectation ? "✓" : "✗";
}

function analyzeOpenAIGpt54Authenticity({ modelId, fingerprints }) {
  const validFingerprints = fingerprints.filter((item) => item && !item.error);
  const proxyPlatform = validFingerprints.find((item) => item.proxyPlatform)?.proxyPlatform || "";
  const aliasProbe = fingerprints.find((item) => item?.probeType === "alias");
  const snapshotProbe = fingerprints.find((item) => item?.probeType === "snapshot");
  const paramNoneProbe = fingerprints.find((item) => item?.probeType === "param_none_temperature");
  const paramHighProbe = fingerprints.find((item) => item?.probeType === "param_high_temperature");
  const schemaProbe = fingerprints.find((item) => item?.probeType === "structured_outputs");
  const ratelimitCheck = verifyOpenAIRatelimitBehavior(validFingerprints);
  const evidence = [];
  let score = 0;

  if (validFingerprints.length === 0) {
    return {
      supported: true,
      modelId,
      verdict: "unknown",
      verdictLabel: "未知",
      confidence: 0,
      proxyPlatform,
      summaryText: "所有 GPT-5.4 接口画像探针均失败，无法完成判定。",
      evidence: ["alias / snapshot / 参数 / schema 探针均未获得有效响应"],
      fingerprints,
      ratelimitCheck,
      factLabels: {
        tool: "别名 / 快照",
        message: "参数行为",
        thinking: "结构化输出",
      },
      factValues: {
        tool: "--",
        message: "--",
        thinking: "--",
      },
    };
  }

  if (aliasProbe?.statusCode === 200) {
    score += 12;
    evidence.push(`[alias] ${OPENAI_GPT54_ALIAS} 请求成功`);
    if (isOpenAIGpt54FamilyModel(aliasProbe.echoModel)) {
      score += 8;
      evidence.push(`[alias] 回显 model=${aliasProbe.echoModel || "(empty)"}`);
    } else if (aliasProbe.echoModel) {
      evidence.push(`[alias] 回显 model=${aliasProbe.echoModel}，不在 gpt-5.4 家族内`);
    } else {
      evidence.push("[alias] 响应未回显 model 字段");
    }
  } else {
    evidence.push(`[alias] 探针失败：${aliasProbe?.serverMessage || `HTTP ${aliasProbe?.statusCode || 0}`}`);
  }

  if (snapshotProbe?.statusCode === 200) {
    score += 15;
    evidence.push(`[snapshot] ${OPENAI_GPT54_SNAPSHOT} 请求成功`);
    if (snapshotProbe.echoModel === OPENAI_GPT54_SNAPSHOT) {
      score += 10;
      evidence.push(`[snapshot] 回显快照完全匹配 ${snapshotProbe.echoModel}`);
    } else if (isOpenAIGpt54FamilyModel(snapshotProbe.echoModel)) {
      score += 6;
      evidence.push(`[snapshot] 回显 model=${snapshotProbe.echoModel}，仍在 gpt-5.4 家族内`);
    } else if (snapshotProbe.echoModel) {
      evidence.push(`[snapshot] 回显 model=${snapshotProbe.echoModel}，与快照不一致`);
    } else {
      evidence.push("[snapshot] 响应未回显 model 字段");
    }
  } else {
    evidence.push(`[snapshot] 探针失败：${snapshotProbe?.serverMessage || `HTTP ${snapshotProbe?.statusCode || 0}`}`);
  }

  if (paramNoneProbe?.matchedExpectation) {
    score += 15;
    evidence.push("[param] reasoning_effort=none + temperature=0.2 成功");
  } else {
    evidence.push(`[param] none+temperature 未通过：${paramNoneProbe?.serverMessage || `HTTP ${paramNoneProbe?.statusCode || 0}`}`);
  }

  if (paramHighProbe?.matchedExpectation) {
    score += 10;
    evidence.push("[param] reasoning_effort=high + temperature=0.2 正确报错");
    if (/(temperature|top_p|logprobs|reasoning)/i.test(paramHighProbe.serverMessage || "")) {
      score += 5;
      evidence.push(`[param] 报错信息命中参数兼容性线索：${paramHighProbe.serverMessage}`);
    } else if (paramHighProbe.serverMessage) {
      evidence.push(`[param] 报错信息：${paramHighProbe.serverMessage}`);
    }
  } else {
    evidence.push(`[param] high+temperature 未触发预期错误：${paramHighProbe?.serverMessage || `HTTP ${paramHighProbe?.statusCode || 0}`}`);
  }

  if (schemaProbe?.statusCode === 200) {
    score += 8;
    if (schemaProbe.validation?.pass) {
      score += 12;
      evidence.push(`[schema] strict json_schema 通过：${schemaProbe.validation.detail}`);
    } else {
      evidence.push(`[schema] 结构化输出不符合 schema：${schemaProbe.validation?.detail || "validation_failed"}`);
    }
  } else {
    evidence.push(`[schema] 探针失败：${schemaProbe?.serverMessage || `HTTP ${schemaProbe?.statusCode || 0}`}`);
  }

  const requestIdCount = validFingerprints.filter((item) => item.requestId).length;
  if (requestIdCount >= 2) {
    score += 2;
    evidence.push(`[headers] 在 ${requestIdCount} 个探针中检测到 x-request-id`);
  } else {
    evidence.push("[headers] 未稳定检测到 x-request-id");
  }

  if (ratelimitCheck.verdict === "dynamic") {
    score += 3;
    evidence.push(`[ratelimit] ${ratelimitCheck.detail}`);
  } else if (ratelimitCheck.detail) {
    evidence.push(`[ratelimit] ${ratelimitCheck.detail}`);
  }

  validFingerprints.forEach((fingerprint) => {
    if (fingerprint.proxyPlatform) {
      evidence.push(`[platform] ${fingerprint.proxyPlatform}`);
    }
  });

  score = Math.max(0, Math.min(100, score));

  const majorPassCount = [
    aliasProbe?.statusCode === 200,
    snapshotProbe?.statusCode === 200,
    paramNoneProbe?.matchedExpectation,
    paramHighProbe?.matchedExpectation,
    !!schemaProbe?.validation?.pass,
  ].filter(Boolean).length;

  let verdict = "mismatch";
  if (score >= 85
    && snapshotProbe?.statusCode === 200
    && paramNoneProbe?.matchedExpectation
    && paramHighProbe?.matchedExpectation
    && schemaProbe?.validation?.pass) {
    verdict = "authentic";
  } else if (score >= 70 && majorPassCount >= 3) {
    verdict = "likely";
  } else if (score >= 40) {
    verdict = "suspicious";
  }

  const labelMap = {
    authentic: "原生直连",
    likely: "官方上游代理",
    suspicious: "兼容代理",
    mismatch: "高风险映射",
    unknown: "未知",
  };

  const summaryMap = {
    authentic: "GPT-5.4 alias / snapshot / 参数兼容 / 结构化输出表现都更像 OpenAI 原生直连。",
    likely: "多数 GPT-5.4 探针与官方行为一致，更像“官方上游 + 代理层转发”而非原生直连。",
    suspicious: "探针结果显示接口可用，但更像兼容代理或二次封装，建议结合返回内容与长上下文结果复核。",
    mismatch: "多个关键探针未通过，当前接口大概率不是原生 GPT-5.4 行为。",
    unknown: "探针信息不足，无法可靠判断是否为 GPT-5.4。",
  };

  return {
    supported: true,
    modelId,
    verdict,
    verdictLabel: labelMap[verdict] || "未知",
    confidence: score / 100,
    proxyPlatform,
    summaryText: summaryMap[verdict] || summaryMap.unknown,
    evidence,
    fingerprints,
    ratelimitCheck,
    factLabels: {
      tool: "别名 / 快照",
      message: "参数行为",
      thinking: "结构化输出",
    },
    factValues: {
      tool: `alias ${compactProbeLabel(aliasProbe)} · snapshot ${compactProbeLabel(snapshotProbe)}`,
      message: `none+temp ${compactProbeLabel(paramNoneProbe)} · high+temp ${compactProbeLabel(paramHighProbe)}`,
      thinking: `strict json_schema ${schemaProbe?.validation?.pass ? "✓" : "✗"}`,
    },
  };
}

function analyzeOpenAICompatibleProfile({ modelId, probes }) {
  const validFingerprints = probes.filter((item) => item && !item.error);
  const toolProbe = probes.find((item) => item?.probeType === "tool_calls");
  const schemaProbe = probes.find((item) => item?.probeType === "structured_outputs");
  const ratelimitCheck = verifyOpenAIRatelimitBehavior(validFingerprints);
  const proxyPlatform = validFingerprints.find((item) => item.proxyPlatform)?.proxyPlatform || "";
  const evidence = [];
  let score = 0;

  if (toolProbe?.validation?.pass) {
    score += 40;
    evidence.push(`[tools] ${toolProbe.validation.detail}`);
  } else if (looksLikeCapabilityLimitedProbe(toolProbe, "tool")) {
    score += 24;
    evidence.push(`[tools] ${toolProbe?.serverMessage || "当前模型或网关未启用 tool_calls"}`);
  } else if (toolProbe?.statusCode === 200) {
    score += 10;
    evidence.push(`[tools] ${toolProbe.validation?.detail || "tool_calls 返回结构异常"}`);
  } else {
    evidence.push(`[tools] ${toolProbe?.serverMessage || `HTTP ${toolProbe?.statusCode || 0}`}`);
  }

  if (schemaProbe?.validation?.pass) {
    score += 40;
    evidence.push(`[schema] ${schemaProbe.validation.detail}`);
  } else if (looksLikeCapabilityLimitedProbe(schemaProbe, "json_schema")
    || looksLikeCapabilityLimitedProbe(schemaProbe, "response_format")) {
    score += 24;
    evidence.push(`[schema] ${schemaProbe?.serverMessage || "当前模型或网关未启用 Structured Outputs"}`);
  } else if (schemaProbe?.statusCode === 200) {
    score += 10;
    evidence.push(`[schema] ${schemaProbe.validation?.detail || "Structured Outputs 返回结构异常"}`);
  } else {
    evidence.push(`[schema] ${schemaProbe?.serverMessage || `HTTP ${schemaProbe?.statusCode || 0}`}`);
  }

  const requestIdCount = validFingerprints.filter((item) => item.requestId).length;
  if (requestIdCount >= 1) {
    score += 10;
    evidence.push(`[headers] 在 ${requestIdCount} 个探针中检测到 x-request-id`);
  } else {
    evidence.push("[headers] 未观察到 x-request-id");
  }

  if (ratelimitCheck.verdict === "dynamic") {
    score += 10;
    evidence.push(`[ratelimit] ${ratelimitCheck.detail}`);
  } else if (ratelimitCheck.verdict === "static") {
    score += 5;
    evidence.push(`[ratelimit] ${ratelimitCheck.detail}`);
  } else if (ratelimitCheck.detail) {
    evidence.push(`[ratelimit] ${ratelimitCheck.detail}`);
  }

  score = Math.max(0, Math.min(100, score));

  let verdict = "mismatch";
  if (score >= 75) {
    verdict = "likely";
  } else if (score >= 40) {
    verdict = "suspicious";
  } else if (validFingerprints.length === 0) {
    verdict = "unknown";
  }

  const labelMap = {
    likely: "兼容接口",
    suspicious: "部分兼容",
    mismatch: "兼容性较弱",
    unknown: "未知",
  };
  const summaryMap = {
    likely: "基础 Chat Completions 协议探针整体通过，接口更像可用的 OpenAI-compatible 实现。",
    suspicious: "基础协议可用，但 tools / Structured Outputs / headers 行为不够完整，建议继续人工复核。",
    mismatch: "多个 OpenAI 协议探针未通过，当前接口的兼容性较弱。",
    unknown: "未获得足够的 OpenAI 协议探针信息。",
  };

  return {
    supported: true,
    modelId,
    verdict,
    verdictLabel: labelMap[verdict] || "未知",
    confidence: score / 100,
    proxyPlatform,
    summaryText: summaryMap[verdict] || summaryMap.unknown,
    evidence,
    fingerprints: probes,
    ratelimitCheck,
    protocolChecks: {
      tools: toolProbe || null,
      structuredOutputs: schemaProbe || null,
    },
    factLabels: {
      tool: "Tools",
      message: "Headers",
      thinking: "Structured",
    },
    factValues: {
      tool: `tool_calls ${compactProbeOutcome(toolProbe)}`,
      message: `x-request-id ${requestIdCount > 0 ? "✓" : "✗"} · ${ratelimitCheck.label || "未执行"}`,
      thinking: `json_schema ${compactProbeOutcome(schemaProbe)}`,
    },
  };
}

async function detectOpenAISourceAnalysis({ apiUrl, apiKey, modelId }) {
  const normalizedModel = String(modelId || "").trim();
  const protocolProbes = [
    await performOpenAIAuthenticityProbe({
      apiUrl,
      apiKey,
      probeType: "tool_calls",
      targetModel: normalizedModel,
    }),
    await performOpenAIAuthenticityProbe({
      apiUrl,
      apiKey,
      probeType: "structured_outputs",
      targetModel: normalizedModel,
    }),
  ];

  if (!isOpenAIGpt54PrimaryModel(normalizedModel)) {
    return analyzeOpenAICompatibleProfile({
      modelId: normalizedModel,
      probes: protocolProbes,
    });
  }

  const probes = [
    ...protocolProbes,
    await performOpenAIAuthenticityProbe({
      apiUrl,
      apiKey,
      probeType: "alias",
      targetModel: OPENAI_GPT54_ALIAS,
    }),
    await performOpenAIAuthenticityProbe({
      apiUrl,
      apiKey,
      probeType: "snapshot",
      targetModel: OPENAI_GPT54_SNAPSHOT,
    }),
    await performOpenAIAuthenticityProbe({
      apiUrl,
      apiKey,
      probeType: "param_none_temperature",
      targetModel: normalizedModel,
    }),
    await performOpenAIAuthenticityProbe({
      apiUrl,
      apiKey,
      probeType: "param_high_temperature",
      targetModel: normalizedModel,
    }),
  ];

  const profile = analyzeOpenAIGpt54Authenticity({
    modelId: normalizedModel,
    fingerprints: probes,
  });

  const toolProbe = protocolProbes.find((item) => item?.probeType === "tool_calls") || null;
  const structuredProbe = protocolProbes.find((item) => item?.probeType === "structured_outputs") || null;
  const protocolEvidence = [];
  if (toolProbe?.validation?.pass) {
    protocolEvidence.push(`[tools] ${toolProbe.validation.detail}`);
  } else if (toolProbe?.serverMessage) {
    protocolEvidence.push(`[tools] ${toolProbe.serverMessage}`);
  }

  return {
    ...profile,
    summaryText: `${profile.summaryText} 已额外完成 Chat Completions 协议探针（tools ${compactProbeOutcome(toolProbe)} / schema ${compactProbeOutcome(structuredProbe)}）。`,
    evidence: [...protocolEvidence, ...profile.evidence],
    protocolChecks: {
      tools: toolProbe,
      structuredOutputs: structuredProbe,
    },
  };
}

function extractSourceFingerprint({
  probeType,
  headers,
  latencyMs,
  parsedResponse,
}) {
  const proxy = detectProxyPlatform(headers);
  const toolId = Array.isArray(parsedResponse.toolUseIds) ? parsedResponse.toolUseIds[0] || "" : "";
  const toolClass = classifyToolId(toolId);
  const messageClass = classifyMessageId(parsedResponse.messageId || "");
  const thinkingSig = parsedResponse.thinkingSignature || "";
  const thinkingSigClass = classifyThinkingSignature(thinkingSig);
  const usage = parsedResponse.usage && typeof parsedResponse.usage === "object" ? parsedResponse.usage : {};
  const usageStyle = parsedResponse.usageStyle || detectUsageStyleFromKeys(Object.keys(usage));
  const ratelimit = collectRatelimitHeaders(headers);
  const anthropicHeaderMatches = Object.keys(headers).filter((key) =>
    key.toLowerCase().includes("anthropic-ratelimit")
    || key.toLowerCase().includes("retry-after")
    || key.toLowerCase().includes("x-ratelimit")
  );
  const awsHeaderMatches = Object.keys(headers).filter((key) =>
    key.toLowerCase().includes("x-amzn")
    || key.toLowerCase().includes("x-amz-")
    || key.toLowerCase().includes("bedrock")
  );

  return {
    probeType,
    latencyMs,
    toolId,
    toolIdSource: toolClass.source,
    toolIdFormat: toolClass.format,
    messageId: parsedResponse.messageId || "",
    messageIdSource: messageClass.source,
    messageIdFormat: messageClass.format,
    model: parsedResponse.model || "",
    modelSource: classifyModelSource(parsedResponse.model || ""),
    thinkingSignaturePrefix: thinkingSig ? thinkingSig.slice(0, 24) : "",
    thinkingSignatureLength: thinkingSig.length,
    thinkingSignatureClass: thinkingSigClass,
    usageStyle,
    hasServiceTier: typeof usage.service_tier === "string" || typeof usage.service_tier === "number",
    serviceTier: usage.service_tier ?? "",
    hasInferenceGeo: typeof usage.inference_geo === "string" && usage.inference_geo.length > 0,
    inferenceGeo: usage.inference_geo ?? "",
    hasCacheCreationObj: !!(usage.cache_creation && typeof usage.cache_creation === "object" && !Array.isArray(usage.cache_creation)),
    hasAnthropicHeaders: anthropicHeaderMatches.length > 0,
    anthropicHeaders: anthropicHeaderMatches.slice(0, 5),
    hasAwsHeaders: awsHeaderMatches.length > 0,
    awsHeaders: awsHeaderMatches.slice(0, 5),
    proxyPlatform: proxy.platform,
    proxyClues: proxy.clues,
    ratelimitInputLimit: ratelimit.inputLimit,
    ratelimitInputRemaining: ratelimit.inputRemaining || ratelimit.unifiedRemaining,
    ratelimitInputReset: ratelimit.inputReset,
    contentTypes: parsedResponse.contentTypes || [],
    error: "",
  };
}

function buildAnthropicProbeRequest({ apiUrl, apiKey, modelId, requestType, probeType }) {
  const useStream = requestType === "stream";
  const endpoint = apiUrl.replace(/\/+$/, "") + "/v1/messages";
  const headers = {
    "accept": "application/json",
    "anthropic-beta": "claude-code-20250219,interleaved-thinking-2025-05-14",
    "anthropic-dangerous-direct-browser-access": "true",
    "anthropic-version": "2023-06-01",
    "authorization": `Bearer ${apiKey}`,
    "content-type": "application/json",
    "x-api-key": apiKey,
  };

  let body;
  if (probeType === "tool") {
    body = {
      model: modelId,
      max_tokens: 64,
      stream: useStream,
      tools: [{
        name: "probe",
        description: "Probe function",
        input_schema: {
          type: "object",
          properties: { q: { type: "string" } },
          required: ["q"],
        },
      }],
      tool_choice: { type: "tool", name: "probe" },
      messages: [{
        role: "user",
        content: [{ type: "text", text: "call probe with q=test" }],
      }],
    };
  } else if (probeType === "thinking") {
    body = {
      model: modelId,
      max_tokens: 2048,
      stream: useStream,
      thinking: { type: "enabled", budget_tokens: 1024 },
      messages: [{
        role: "user",
        content: [{ type: "text", text: "What is 2 + 3? 只需要简短回答。" }],
      }],
    };
  } else {
    body = {
      model: modelId,
      max_tokens: 16,
      stream: useStream,
      messages: [{
        role: "user",
        content: [{ type: "text", text: "Say OK" }],
      }],
    };
  }

  return { endpoint, headers, body, useStream };
}

async function performAnthropicSourceProbe({ apiUrl, apiKey, modelId, requestType, probeType }) {
  const { endpoint, headers, body, useStream } = buildAnthropicProbeRequest({
    apiUrl,
    apiKey,
    modelId,
    requestType,
    probeType,
  });

  const started = Date.now();
  try {
    const upstream = await fetchWithTimeout(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }, {
      timeoutMs: getProbeTimeoutMs({ useStream }),
      label: `anthropic_probe_${probeType}`,
    });

    if (upstream.status !== 200) {
      const errorText = await upstream.text();
      return {
        probeType,
        error: `HTTP ${upstream.status}: ${errorText.slice(0, 240)}`,
        latencyMs: Date.now() - started,
      };
    }

    const responseHeaders = headersToObject(upstream.headers);
    let parsedResponse;
    if (useStream) {
      parsedResponse = await parseAnthropicStreamResponse(upstream.body);
    } else {
      const text = await upstream.text();
      parsedResponse = parseAnthropicJsonResponse(text);
    }

    return extractSourceFingerprint({
      probeType,
      headers: responseHeaders,
      latencyMs: Date.now() - started,
      parsedResponse,
    });
  } catch (error) {
    return {
      probeType,
      error: error?.message || "probe_failed",
      latencyMs: Date.now() - started,
    };
  }
}

async function verifyAnthropicRatelimitDynamic({ apiUrl, apiKey, modelId, requestType, shots = 3 }) {
  const samples = [];
  for (let index = 0; index < shots; index += 1) {
    const probe = await performAnthropicSourceProbe({
      apiUrl,
      apiKey,
      modelId,
      requestType,
      probeType: "simple",
    });

    if (!probe.error && (probe.ratelimitInputRemaining > 0 || probe.ratelimitInputLimit > 0)) {
      samples.push({
        remaining: probe.ratelimitInputRemaining,
        limit: probe.ratelimitInputLimit,
        reset: probe.ratelimitInputReset,
        latencyMs: probe.latencyMs,
      });
    }
  }

  if (samples.length < 2) {
    return {
      verdict: "unavailable",
      label: "不可用",
      detail: "未获取到可比较的 ratelimit 样本",
      samples,
    };
  }

  const remainings = samples.map((item) => item.remaining);
  const allSame = remainings.every((value) => value === remainings[0]);
  const totalDrop = remainings[0] - remainings[remainings.length - 1];
  const monotone = remainings.every((value, index) => index === 0 || remainings[index - 1] >= value);

  if (allSame) {
    return {
      verdict: "static",
      label: "静态 / 待复核",
      detail: `remaining 固定为 ${remainings[0]}，未随请求变化`,
      samples,
    };
  }

  if (monotone && totalDrop > 0) {
    return {
      verdict: "dynamic",
      label: "动态递减",
      detail: `remaining ${remainings[0]} → ${remainings[remainings.length - 1]}，看起来是真实额度变化`,
      samples,
    };
  }

  return {
    verdict: "dynamic",
    label: "动态变化",
    detail: `remaining 有变化 ${remainings.join(" → ")}，疑似真实配额系统`,
    samples,
  };
}

function analyzeAnthropicSource({ modelId, fingerprints, ratelimitCheck }) {
  const validFingerprints = fingerprints.filter((item) => item && !item.error);
  const evidence = [];
  const scores = { anthropic: 0, bedrock: 0, vertex: 0 };
  const proxyPlatform = validFingerprints.find((item) => item.proxyPlatform)?.proxyPlatform || "";

  if (validFingerprints.length === 0) {
    return {
      supported: true,
      verdict: "unknown",
      verdictLabel: "未知",
      confidence: 0,
      proxyPlatform,
      summaryText: "所有来源探测均失败，无法完成三源判定。",
      evidence: ["tool / thinking 探测均未获得有效响应"],
      fingerprints,
      ratelimitCheck: ratelimitCheck || {
        verdict: "unavailable",
        label: "不可用",
        detail: "未执行",
        samples: [],
      },
    };
  }

  validFingerprints.forEach((fingerprint) => {
    const prefix = `[${fingerprint.probeType}]`;

    if (fingerprint.toolIdSource === "anthropic") {
      scores.anthropic += 5;
      evidence.push(`${prefix} tool_use id 为 toolu_ 前缀，更像 Anthropic 原生`);
    } else if (fingerprint.toolIdSource === "bedrock") {
      scores.bedrock += 5;
      evidence.push(`${prefix} tool_use id 为 tooluse_ 前缀，更像 Bedrock / Kiro`);
    } else if (fingerprint.toolIdSource === "vertex") {
      scores.vertex += 6;
      evidence.push(`${prefix} tool_use id 为 tool_N，更像 Vertex / Antigravity`);
    }

    if (fingerprint.messageIdSource === "anthropic") {
      scores.anthropic += 2;
      evidence.push(`${prefix} message id 为 msg_<base62> 风格`);
    } else if (fingerprint.messageIdSource === "vertex") {
      scores.vertex += 6;
      evidence.push(`${prefix} message id 为 req_vrtx_ 前缀`);
    } else if (fingerprint.messageIdSource === "antigravity") {
      scores.vertex += 2;
      evidence.push(`${prefix} message id 为 msg_<UUID>，存在 Vertex / Antigravity 迹象`);
    }

    if (fingerprint.modelSource === "kiro") {
      scores.bedrock += 8;
      evidence.push(`${prefix} model 回显为 kiro-*，是 Kiro / Bedrock 强指纹`);
    } else if (fingerprint.modelSource === "bedrock") {
      scores.bedrock += 4;
      evidence.push(`${prefix} model 回显为 anthropic.* 风格，偏向 Bedrock`);
    }

    if (fingerprint.thinkingSignatureClass === "vertex") {
      scores.vertex += 5;
      evidence.push(`${prefix} thinking signature 出现 claude# 前缀`);
    } else if (fingerprint.thinkingSignatureClass === "short") {
      scores.vertex += 2;
      evidence.push(`${prefix} thinking signature 明显偏短，存在转发 / 截断迹象`);
    } else if (fingerprint.thinkingSignatureClass === "normal") {
      evidence.push(`${prefix} thinking signature 长度正常`);
    }

    if (fingerprint.hasServiceTier) {
      scores.anthropic += 3;
      evidence.push(`${prefix} usage 中出现 service_tier`);
    }
    if (fingerprint.hasInferenceGeo) {
      scores.anthropic += 4;
      evidence.push(`${prefix} usage 中出现 inference_geo`);
    }
    if (fingerprint.hasCacheCreationObj) {
      scores.anthropic += 2;
      evidence.push(`${prefix} usage 中出现 cache_creation 嵌套对象`);
    }
    if (fingerprint.hasAnthropicHeaders) {
      scores.anthropic += 2;
      evidence.push(`${prefix} 返回了 anthropic-ratelimit / retry-after 相关头`);
    }
    if (fingerprint.hasAwsHeaders) {
      scores.bedrock += 3;
      evidence.push(`${prefix} 返回头里出现 AWS / Bedrock 线索`);
    }
    if (fingerprint.usageStyle === "camelCase") {
      scores.bedrock += 2;
      evidence.push(`${prefix} usage 风格为 camelCase，更像 Bedrock 改写`);
    }
    if (fingerprint.proxyPlatform) {
      evidence.push(`${prefix} 平台线索：${fingerprint.proxyPlatform}`);
    }
  });

  const anthropicHints = validFingerprints.some((item) =>
    item.toolIdSource === "anthropic"
    || item.hasServiceTier
    || item.messageIdSource === "anthropic"
  );
  const missingInferenceGeo = !validFingerprints.some((item) => item.hasInferenceGeo);
  const missingAnthropicHeaders = !validFingerprints.some((item) => item.hasAnthropicHeaders);
  const missingCacheCreation = !validFingerprints.some((item) => item.hasCacheCreationObj);
  let negativeAnthropic = 0;

  if (anthropicHints && missingInferenceGeo) {
    negativeAnthropic += 3;
    evidence.push("[negative] 出现 Anthropic 风格线索，但 inference_geo 缺失");
  }
  if (anthropicHints && missingAnthropicHeaders) {
    negativeAnthropic += 2;
    evidence.push("[negative] 出现 Anthropic 风格线索，但 anthropic-ratelimit 头缺失");
  }
  if (anthropicHints && missingCacheCreation) {
    negativeAnthropic += 1;
    evidence.push("[negative] 出现 Anthropic 风格线索，但 cache_creation 对象缺失");
  }
  scores.anthropic = Math.max(0, scores.anthropic - negativeAnthropic);

  if (ratelimitCheck?.verdict === "dynamic") {
    scores.anthropic += 4;
    evidence.push(`[ratelimit] ${ratelimitCheck.detail}`);
  } else if (ratelimitCheck?.verdict === "static") {
    evidence.push(`[ratelimit] ${ratelimitCheck.detail}，更像代理层缓存、固定值或网关统一头，建议复核`);
  } else if (ratelimitCheck?.detail) {
    evidence.push(`[ratelimit] ${ratelimitCheck.detail}`);
  }

  const orderedScores = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [bestVerdict, bestScore] = orderedScores[0];
  const secondScore = orderedScores[1]?.[1] || 0;
  const scoreTotal = orderedScores.reduce((sum, [, value]) => sum + value, 0);

  let verdict = bestVerdict;
  if (bestScore < 4) {
    verdict = "unknown";
  }
  if (bestScore - secondScore < 2 && bestScore > 0) {
    verdict = "suspicious";
  }
  if (ratelimitCheck?.verdict === "static" && verdict === "anthropic") {
    verdict = "suspicious";
  }
  if (anthropicHints && missingInferenceGeo && missingAnthropicHeaders && verdict === "anthropic") {
    verdict = "suspicious";
  }

  const labelMap = {
    anthropic: "Anthropic 官方",
    bedrock: "Bedrock / Kiro",
    vertex: "Vertex / Antigravity",
    suspicious: "混合代理 / 待复核",
    unknown: "未知",
  };

  const confidence = bestScore > 0
    ? Math.min(0.98, Math.max(0.35, bestScore / Math.max(scoreTotal, bestScore + 2)))
    : 0;

  return {
    supported: true,
    modelId,
    verdict,
    verdictLabel: labelMap[verdict] || "未知",
    confidence,
    scores,
    proxyPlatform,
    summaryText:
      verdict === "anthropic" ? "更接近 Anthropic 官方通道。"
        : verdict === "bedrock" ? "更接近 AWS Bedrock / Kiro 通道。"
          : verdict === "vertex" ? "更接近 Google Vertex / Antigravity 通道。"
            : verdict === "suspicious" ? "存在混合指纹或代理改写迹象，建议人工复核。"
              : "有效来源指纹不足，无法可靠判定。",
    evidence,
    fingerprints,
    ratelimitCheck: ratelimitCheck || {
      verdict: "unavailable",
      label: "不可用",
      detail: "未执行",
      samples: [],
    },
  };
}

async function detectSourceAnalysis({ apiUrl, apiKey, modelId, mode, requestType }) {
  if (mode !== "anthropic") {
    return detectOpenAISourceAnalysis({ apiUrl, apiKey, modelId, requestType });
  }

  const toolProbe = await performAnthropicSourceProbe({
    apiUrl,
    apiKey,
    modelId,
    requestType,
    probeType: "tool",
  });
  const thinkingProbe = await performAnthropicSourceProbe({
    apiUrl,
    apiKey,
    modelId,
    requestType,
    probeType: "thinking",
  });

  const hasPossibleRatelimit = [toolProbe, thinkingProbe].some((probe) =>
    !probe.error && (probe.hasAnthropicHeaders || probe.ratelimitInputLimit > 0 || probe.ratelimitInputRemaining > 0)
  );
  const ratelimitCheck = hasPossibleRatelimit
    ? await verifyAnthropicRatelimitDynamic({ apiUrl, apiKey, modelId, requestType, shots: 3 })
    : {
        verdict: "unavailable",
        label: "未发现",
        detail: "未检测到可验证的 ratelimit 头",
        samples: [],
      };

  return analyzeAnthropicSource({
    modelId,
    fingerprints: [toolProbe, thinkingProbe],
    ratelimitCheck,
  });
}

async function runDetectScan({ apiUrl, apiKey, mode, requestType, modelIds }) {
  const normalizedIds = Array.isArray(modelIds)
    ? [...new Set(modelIds.map((item) => String(item || "").trim()).filter(Boolean))]
    : [];

  const results = [];
  for (const modelId of normalizedIds) {
    const analysis = await detectSourceAnalysis({
      apiUrl,
      apiKey,
      modelId,
      mode,
      requestType,
    });

    results.push({
      modelId,
      available: analysis.verdict !== "unknown" || analysis.evidence.length > 0,
      sourceAnalysis: analysis,
    });
  }

  const verdictSet = new Set(
    results
      .map((item) => item.sourceAnalysis?.verdict)
      .filter((value) => value === "anthropic" || value === "bedrock" || value === "vertex")
  );

  return {
    ok: true,
    mode,
    requestType,
    models: results,
    isMixed: verdictSet.size > 1,
    summaryText: mode !== "anthropic"
      ? (() => {
          const supportedCount = results.filter((item) => item.sourceAnalysis?.supported).length;
          const positiveCount = results.filter((item) =>
            item.sourceAnalysis?.verdict === "authentic" || item.sourceAnalysis?.verdict === "likely"
          ).length;
          if (supportedCount === 0) {
            return "OpenAI 模式下当前仅对 gpt-5.4 主模型 / 快照执行接口画像探针。";
          }
          if (positiveCount > 0) {
            return `已完成 ${supportedCount} 组 gpt-5.4 接口画像探针，请重点查看参数兼容、结构化输出与代理线索。`;
          }
          return `已完成 ${supportedCount} 组 gpt-5.4 接口画像探针，但暂无明显“原生直连 / 官方上游代理”结果。`;
        })()
      : verdictSet.size > 1
        ? "扫描结果显示同一站点的不同模型存在混合渠道。"
        : "扫描结果未发现明显的多后端混合渠道。",
  };
}

/* ── Probe handler (proxy API requests) ── */

async function handleProbe(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "method_not_allowed" });
    return;
  }
  try {
    const raw = await readBody(req);
    const parsed = JSON.parse(raw || "{}");
    const endpoint = typeof parsed.endpoint === "string" ? parsed.endpoint : "";
    const method = typeof parsed.method === "string" ? parsed.method : "POST";
    const headers = parsed.headers && typeof parsed.headers === "object" ? parsed.headers : {};
    const body = parsed.body ?? {};

    const mode = parsed.mode === "openai" || parsed.mode === "anthropic"
      ? parsed.mode
      : endpoint.toLowerCase().includes("/v1/chat/completions") ? "openai" : "anthropic";

    const anthropicStream = mode === "anthropic" && body && body.stream === true;

    const started = Date.now();
    const upstream = await fetchWithTimeout(endpoint, {
      method,
      headers,
      body: JSON.stringify(body),
    }, {
      timeoutMs: anthropicStream ? getProbeTimeoutMs({ useStream: true }) : getProbeTimeoutMs(),
      label: "probe_request",
    });
    const firstChunkStartedAt = Date.now();
    let firstChunkLatencyMs = null;
    let bodyText = "";
    let signatureDeltaTotalLength = 0;
    let signatureDeltaCount = 0;
    let sseEventTypes = [];
    let sseContentTypes = [];
    let parsedSseLines = 0;
    let upstreamUsage = {};

    if (anthropicStream && upstream.body) {
      const reader = upstream.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let rawSse = "";
      let aggregatedText = "";
      let thinkingText = "";
      let modelName = null;
      let stopReason = null;
      const contentTypesSet = new Set();
      const eventTypes = [];
      const usage = {};

      const mergeUsage = (source) => {
        if (!source || typeof source !== "object") return;
        for (const key of [
          "input_tokens","output_tokens","cache_read_input_tokens",
          "cache_creation_input_tokens","total_tokens","prompt_tokens","completion_tokens",
        ]) {
          const value = source[key];
          if (typeof value === "number") usage[key] = value;
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (firstChunkLatencyMs === null) firstChunkLatencyMs = Date.now() - firstChunkStartedAt;
        if (!value) continue;
        const chunkText = decoder.decode(value, { stream: true });
        rawSse += chunkText;
        buffer += chunkText;

        while (buffer.includes("\n")) {
          const idx = buffer.indexOf("\n");
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          parsedSseLines += 1;

          let event = null;
          try { event = JSON.parse(data); } catch { continue; }
          if (!event) continue;

          const eventType = typeof event.type === "string" ? event.type : "";
          if (eventType) eventTypes.push(eventType);

          if (eventType === "message_start") {
            const message = event.message;
            if (message && typeof message.model === "string") modelName = message.model;
            mergeUsage(message?.usage);
          } else if (eventType === "content_block_start") {
            const block = event.content_block;
            if (block && typeof block.type === "string") contentTypesSet.add(block.type);
          } else if (eventType === "content_block_delta") {
            const delta = event.delta;
            const deltaType = delta && typeof delta.type === "string" ? delta.type : "";
            if (deltaType === "text_delta") {
              if (typeof delta?.text === "string") aggregatedText += delta.text;
            } else if (deltaType === "signature_delta") {
              if (typeof delta?.signature === "string") {
                signatureDeltaTotalLength += delta.signature.length;
                signatureDeltaCount += 1;
              }
            } else if (deltaType === "thinking_delta") {
              contentTypesSet.add("thinking");
              if (typeof delta?.thinking === "string") thinkingText += delta.thinking;
            }
          } else if (eventType === "message_delta") {
            mergeUsage(event.usage);
            const delta = event.delta;
            if (delta && typeof delta.stop_reason === "string") stopReason = delta.stop_reason;
          }
        }
      }
      buffer += decoder.decode();

      if (parsedSseLines === 0) {
        bodyText = rawSse;
      } else {
        sseEventTypes = eventTypes;
        sseContentTypes = [...contentTypesSet];
        upstreamUsage = usage;
        bodyText = JSON.stringify({
          model: modelName || null,
          role: "assistant",
          content: [{ type: "text", text: aggregatedText }],
          thinking: thinkingText || undefined,
          stop_reason: stopReason,
          usage,
          _sse_meta: {
            event_types: eventTypes,
            content_types: [...contentTypesSet],
            signature_delta_total_length: signatureDeltaTotalLength,
            signature_delta_count: signatureDeltaCount,
          },
        });
      }
    } else if (upstream.body) {
      const reader = upstream.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (firstChunkLatencyMs === null) firstChunkLatencyMs = Date.now() - firstChunkStartedAt;
        if (value) bodyText += decoder.decode(value, { stream: true });
      }
      bodyText += decoder.decode();
    } else {
      bodyText = await upstream.text();
    }

    const latencyMs = Date.now() - started;
    if (Object.keys(upstreamUsage).length === 0) {
      try {
        const pb = JSON.parse(bodyText);
        if (pb?.usage && typeof pb.usage === "object") upstreamUsage = pb.usage;
      } catch {}
    }

    const payload = {
      ok: true,
      latencyMs,
      firstChunkLatencyMs,
      status: upstream.status,
      usage: upstreamUsage,
      signatureDeltaTotalLength,
      signatureDeltaCount,
      sseEventTypes,
      sseContentTypes,
      bodyText,
    };
    sendJson(res, 200, payload);
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error?.message || "probe_failed" });
  }
}

/* ── Detect handler (full scoring) ── */

async function handleDetect(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "method_not_allowed" });
    return;
  }
  try {
    const raw = await readBody(req);
    const parsed = JSON.parse(raw || "{}");
    const { apiUrl, apiKey, modelId, mode, withThinking } = parsed;
    const requestType = parsed.requestType === "stream" ? "stream" : "nonstream";
    const analysisDepth = parsed.analysisDepth === "quick" ? "quick" : "deep";

    if (!apiUrl || !apiKey || !modelId) {
      sendJson(res, 400, { ok: false, error: "missing_params" });
      return;
    }

    const { isAnthropic, useStream, endpoint, headers, body } = buildDetectUpstreamRequest({
      apiUrl,
      apiKey,
      modelId,
      mode,
      withThinking,
      requestType,
    });

    // Use probe logic
    const started = Date.now();
    const upstream = await fetchWithTimeout(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }, {
      timeoutMs: getDetectTimeoutMs({ isAnthropic, useStream, withThinking }),
      label: "detect_request",
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
    let sseMeta = { eventTypes: [], contentTypes: [] };
    let usage = {};
    let signatureDeltaTotalLength = 0;
    let signatureDeltaCount = 0;
    let firstChunkLatencyMs = null;
    let responseModel = "";
    let openaiResponseMeta = {};

    if (isAnthropic && useStream) {
      const parsedResponse = await parseAnthropicStreamResponse(upstream.body);
      responseText = parsedResponse.responseText;
      usage = parsedResponse.usage;
      sseMeta = parsedResponse.sseMeta;
      signatureDeltaTotalLength = parsedResponse.signatureDeltaTotalLength;
      signatureDeltaCount = parsedResponse.signatureDeltaCount;
      firstChunkLatencyMs = parsedResponse.firstChunkLatencyMs;
      responseModel = parsedResponse.model || "";
    } else if (isAnthropic) {
      const respBody = await upstream.text();
      const parsedResponse = parseAnthropicJsonResponse(respBody);
      responseText = parsedResponse.responseText;
      usage = parsedResponse.usage;
      sseMeta = { eventTypes: [], contentTypes: parsedResponse.contentTypes };
      responseModel = parsedResponse.model || "";
    } else if (useStream) {
      const parsedResponse = await parseOpenAIStreamResponse(upstream.body);
      responseText = parsedResponse.responseText;
      usage = parsedResponse.usage;
      firstChunkLatencyMs = parsedResponse.firstChunkLatencyMs;
      responseModel = parsedResponse.model || "";
      openaiResponseMeta = parsedResponse;
    } else {
      const respBody = await upstream.text();
      const parsedResponse = parseOpenAIJsonResponse(respBody);
      responseText = parsedResponse.responseText;
      usage = parsedResponse.usage;
      responseModel = parsedResponse.model || "";
      openaiResponseMeta = parsedResponse;
    }

    const latencyMs = Date.now() - started;
    let sourceAnalysis;

    if (analysisDepth === "deep") {
      try {
        sourceAnalysis = await detectSourceAnalysis({
          apiUrl,
          apiKey,
          modelId,
          mode,
          requestType,
        });
      } catch (sourceError) {
        sourceAnalysis = {
          supported: false,
          verdict: "unknown",
          verdictLabel: "分析失败",
          confidence: 0,
          proxyPlatform: "",
          summaryText: "来源分析执行失败，但不影响兼容性得分。",
          evidence: [`来源分析异常：${sourceError?.message || "source_analysis_failed"}`],
          fingerprints: [],
          ratelimitCheck: {
            verdict: "unavailable",
            label: "未执行",
            detail: "来源分析异常",
            samples: [],
          },
        };
      }
    } else {
      sourceAnalysis = buildSkippedSourceAnalysis(mode, "quick_mode");
    }

    const resultPayload = buildDetectResultPayload({
      isAnthropic,
      useStream,
      responseText,
      sseMeta,
      usage,
      signatureDeltaTotalLength,
      signatureDeltaCount,
      latencyMs,
      firstChunkLatencyMs,
      withThinking,
      requestType,
      requestedModelId: modelId,
      responseModel,
      sourceAnalysis,
      openaiResponseMeta,
      analysisDepth,
    });
    resultPayload.sourceAnalysis = sourceAnalysis;

    sendJson(res, 200, resultPayload);
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error?.message || "detect_failed" });
  }
}

async function handleDetectLive(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "method_not_allowed" });
    return;
  }

  res.statusCode = 200;
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  if (typeof res.flushHeaders === "function") {
    res.flushHeaders();
  }

  try {
    const raw = await readBody(req);
    const parsed = JSON.parse(raw || "{}");
    const { apiUrl, apiKey, modelId, mode, withThinking } = parsed;
    const requestType = parsed.requestType === "stream" ? "stream" : "nonstream";
    const analysisDepth = parsed.analysisDepth === "quick" ? "quick" : "deep";

    if (!apiUrl || !apiKey || !modelId) {
      sendNdjsonChunk(res, { type: "error", error: "missing_params" });
      res.end();
      return;
    }

    const { isAnthropic, useStream, endpoint, headers, body } = buildDetectUpstreamRequest({
      apiUrl,
      apiKey,
      modelId,
      mode,
      withThinking,
      requestType,
    });

    sendNdjsonChunk(res, {
      type: "status",
      summaryCopy: "已连接到本地检测代理，正在等待上游模型返回首个响应片段。",
    });

    const started = Date.now();
    const upstream = await fetchWithTimeout(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }, {
      timeoutMs: getDetectTimeoutMs({ isAnthropic, useStream, withThinking }),
      label: "detect_live_request",
    });

    if (upstream.status !== 200) {
      const errText = await upstream.text();
      sendNdjsonChunk(res, {
        type: "error",
        error: `HTTP ${upstream.status}: ${errText.slice(0, 500)}`,
      });
      res.end();
      return;
    }

    let responseText = "";
    let sseMeta = { eventTypes: [], contentTypes: [] };
    let usage = {};
    let signatureDeltaTotalLength = 0;
    let signatureDeltaCount = 0;
    let firstChunkLatencyMs = null;
    let responseModel = "";
    let openaiResponseMeta = {};

    if (isAnthropic && useStream) {
      const parsedResponse = await parseAnthropicStreamResponse(upstream.body, {
        onTextDelta: (deltaText) => {
          if (!deltaText) return;
          sendNdjsonChunk(res, { type: "preview", delta: deltaText });
        },
      });
      responseText = parsedResponse.responseText;
      usage = parsedResponse.usage;
      sseMeta = parsedResponse.sseMeta;
      signatureDeltaTotalLength = parsedResponse.signatureDeltaTotalLength;
      signatureDeltaCount = parsedResponse.signatureDeltaCount;
      firstChunkLatencyMs = parsedResponse.firstChunkLatencyMs;
      responseModel = parsedResponse.model || "";
    } else if (isAnthropic) {
      const respBody = await upstream.text();
      const parsedResponse = parseAnthropicJsonResponse(respBody);
      responseText = parsedResponse.responseText;
      usage = parsedResponse.usage;
      sseMeta = { eventTypes: [], contentTypes: parsedResponse.contentTypes };
      responseModel = parsedResponse.model || "";
      if (responseText) {
        sendNdjsonChunk(res, { type: "preview", text: responseText });
      }
    } else if (useStream) {
      const parsedResponse = await parseOpenAIStreamResponse(upstream.body, {
        onTextDelta: (deltaText) => {
          if (!deltaText) return;
          sendNdjsonChunk(res, { type: "preview", delta: deltaText });
        },
      });
      responseText = parsedResponse.responseText;
      usage = parsedResponse.usage;
      firstChunkLatencyMs = parsedResponse.firstChunkLatencyMs;
      responseModel = parsedResponse.model || "";
      openaiResponseMeta = parsedResponse;
    } else {
      const respBody = await upstream.text();
      const parsedResponse = parseOpenAIJsonResponse(respBody);
      responseText = parsedResponse.responseText;
      usage = parsedResponse.usage;
      responseModel = parsedResponse.model || "";
      openaiResponseMeta = parsedResponse;
      if (responseText) {
        sendNdjsonChunk(res, { type: "preview", text: responseText });
      }
    }

    const latencyMs = Date.now() - started;

    sendNdjsonChunk(res, {
      type: "status",
      summaryCopy: analysisDepth === "quick"
        ? "主响应已完成，快速模式将跳过深度来源分析，仅保留主请求兼容性评分。"
        : mode === "anthropic"
          ? "主响应已完成，正在执行来源指纹分析与 ratelimit 验证。"
          : "主响应已完成，正在执行 OpenAI 协议兼容性探针（tools / Structured Outputs）并整理画像摘要。",
    });

    let sourceAnalysis;
    if (analysisDepth === "deep") {
      try {
        sourceAnalysis = await detectSourceAnalysis({
          apiUrl,
          apiKey,
          modelId,
          mode,
          requestType,
        });
      } catch (sourceError) {
        sourceAnalysis = {
          supported: false,
          verdict: "unknown",
          verdictLabel: "分析失败",
          confidence: 0,
          proxyPlatform: "",
          summaryText: "来源分析执行失败，但不影响兼容性得分。",
          evidence: [`来源分析异常：${sourceError?.message || "source_analysis_failed"}`],
          fingerprints: [],
          ratelimitCheck: {
            verdict: "unavailable",
            label: "未执行",
            detail: "来源分析异常",
            samples: [],
          },
        };
      }
    } else {
      sourceAnalysis = buildSkippedSourceAnalysis(mode, "quick_mode");
    }

    const resultPayload = buildDetectResultPayload({
      isAnthropic,
      useStream,
      responseText,
      sseMeta,
      usage,
      signatureDeltaTotalLength,
      signatureDeltaCount,
      latencyMs,
      firstChunkLatencyMs,
      withThinking,
      requestType,
      requestedModelId: modelId,
      responseModel,
      sourceAnalysis,
      openaiResponseMeta,
      analysisDepth,
    });
    resultPayload.sourceAnalysis = sourceAnalysis;

    sendNdjsonChunk(res, { type: "final", data: resultPayload });
    res.end();
  } catch (error) {
    sendNdjsonChunk(res, { type: "error", error: error?.message || "detect_live_failed" });
    res.end();
  }
}

async function handleDetectScan(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "method_not_allowed" });
    return;
  }

  try {
    const raw = await readBody(req);
    const parsed = JSON.parse(raw || "{}");
    const apiUrl = typeof parsed.apiUrl === "string" ? parsed.apiUrl.trim() : "";
    const apiKey = typeof parsed.apiKey === "string" ? parsed.apiKey.trim() : "";
    const mode = parsed.mode === "openai" ? "openai" : "anthropic";
    const requestType = parsed.requestType === "stream" ? "stream" : "nonstream";
    const modelIds = Array.isArray(parsed.modelIds) ? parsed.modelIds : [];

    if (!apiUrl || !apiKey || modelIds.length === 0) {
      sendJson(res, 400, { ok: false, error: "missing_params" });
      return;
    }

    const scanResult = await runDetectScan({
      apiUrl,
      apiKey,
      mode,
      requestType,
      modelIds,
    });

    sendJson(res, 200, scanResult);
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error?.message || "detect_scan_failed" });
  }
}

/* ── Needle in haystack handler ── */

async function handleNeedle(req, res) {
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
    const contextBundle = buildNeedleContextBundle({
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

    // Build request
    const isAnthropic = mode === "anthropic";
    let endpoint, headers, body;

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
    const retrievalScore = scoring.score;

    sendJson(res, 200, {
      ok: true,
      responseText,
      retrievalScore,
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
        datasetActualMaxTokens: getHaystackTokenSequence(tokenizer, haystackCorpus.text).tokenCount,
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
}

/* ── Static file serving ── */

function serveFile(res, filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) {
      res.statusCode = 404;
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.statusCode = 200;
    res.setHeader("Content-Type", contentTypes[ext] || "application/octet-stream");
    fs.createReadStream(filePath).pipe(res);
  } catch {
    res.statusCode = 404;
    res.end("Not found");
  }
}

/* ── HTTP Server ── */

const server = http.createServer(async (req, res) => {
  setCors(res);
  const urlPath = req.url || "/";

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (urlPath.startsWith("/__probe")) {
    await handleProbe(req, res);
    return;
  }
  if (urlPath.startsWith("/__detect-live")) {
    await handleDetectLive(req, res);
    return;
  }
  if (urlPath.startsWith("/__detect-scan")) {
    await handleDetectScan(req, res);
    return;
  }
  if (urlPath.startsWith("/__detect")) {
    await handleDetect(req, res);
    return;
  }
  if (urlPath.startsWith("/__needle")) {
    await handleNeedle(req, res);
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.statusCode = 405;
    res.end("Method not allowed");
    return;
  }

  const pathname = decodeURIComponent(new URL(urlPath, "http://localhost").pathname);
  const normalized = path.normalize(pathname).replace(/^(\.\.[\\/])+/, "");
  const relativePath = normalized === "/" || normalized === "\\" ? "index.html" : normalized.replace(/^[\\/]+/, "");
  let filePath = path.join(publicDir, relativePath);

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    if (!path.extname(pathname)) {
      filePath = path.join(publicDir, "index.html");
    } else {
      res.statusCode = 404;
      res.end("Not found");
      return;
    }
  }

  serveFile(res, filePath);
});

server.listen(port, host, () => {
  const displayHost = host === "0.0.0.0" ? "127.0.0.1" : host;
  console.log(`ApiMaster 服务已启动: http://${displayHost}:${port}`);
});
