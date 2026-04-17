export const defaultFetchTimeoutMs = Number(process.env.APIMASTER_FETCH_TIMEOUT_MS || 45000);
export const probeFetchTimeoutMs = Number(process.env.APIMASTER_PROBE_TIMEOUT_MS || 15000);

export function getProbeTimeoutMs({ useStream = false } = {}) {
  return useStream ? Math.max(probeFetchTimeoutMs, 30000) : probeFetchTimeoutMs;
}

export function getDetectTimeoutMs({ isAnthropic = false, useStream = false, withThinking = false } = {}) {
  let timeoutMs = useStream ? Math.max(defaultFetchTimeoutMs, 75000) : defaultFetchTimeoutMs;
  if (isAnthropic && withThinking !== false) {
    timeoutMs += 30000;
  }
  return timeoutMs;
}

export function getNeedleTimeoutMs({ requestType = "nonstream", contextLength = 0 } = {}) {
  const normalizedContextLength = Math.max(0, Number(contextLength) || 0);
  const baseTimeoutMs = requestType === "stream" ? 90000 : 60000;
  const scaledTimeoutMs = baseTimeoutMs + Math.min(90000, normalizedContextLength * 1.5);
  return Math.max(baseTimeoutMs, Math.round(scaledTimeoutMs));
}

export async function fetchWithTimeout(
  url,
  options = {},
  { timeoutMs = defaultFetchTimeoutMs, label = "upstream_request", fetchImpl = globalThis.fetch } = {},
) {
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
    return await fetchImpl(url, {
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
