/* ── Utility Functions ─────────────────── */

const volatileConfigStore = new Map();

function dispatchAppEvent(name, detail = {}) {
  try {
    document.dispatchEvent(new CustomEvent(name, { detail }));
  } catch {
    // noop
  }
}

function saveConfig(key, value) {
  try {
    localStorage.setItem('apimaster_' + key, JSON.stringify(value));
    dispatchAppEvent('apimaster:config-changed', { key, value });
  } catch {}
}

function removeConfig(key) {
  try {
    localStorage.removeItem('apimaster_' + key);
    dispatchAppEvent('apimaster:config-changed', { key, removed: true });
  } catch {}
}

function loadConfig(key, defaultValue) {
  try {
    const v = localStorage.getItem('apimaster_' + key);
    return v !== null ? JSON.parse(v) : defaultValue;
  } catch {
    return defaultValue;
  }
}

function saveVolatileConfig(key, value) {
  if (!key) return;
  if (value === undefined || value === null || value === '') {
    volatileConfigStore.delete(key);
  } else {
    volatileConfigStore.set(key, value);
  }
  dispatchAppEvent('apimaster:config-changed', { key, value, volatile: true });
}

function loadVolatileConfig(key, defaultValue) {
  return volatileConfigStore.has(key) ? volatileConfigStore.get(key) : defaultValue;
}

function formatTime(date) {
  const d = new Date(date);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function scoreColor(score) {
  if (score >= 80) return 'var(--success)';
  if (score >= 50) return 'var(--warning)';
  return 'var(--error)';
}

function scoreClass(score) {
  if (score >= 80) return 'high';
  if (score >= 50) return 'mid';
  return 'low';
}

function scoreLabel(score) {
  const isEn = typeof AppRuntime !== 'undefined' && AppRuntime.lang === 'en';
  if (score >= 85) return isEn ? 'Highly Compatible' : '兼容性高';
  if (score >= 65) return isEn ? 'Good Compatibility' : '兼容性良好';
  if (score >= 45) return isEn ? 'Needs Review' : '需要复核';
  return isEn ? 'Weak Compatibility' : '兼容性较弱';
}

function extractHostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function generateId() {
  return Math.random().toString(36).slice(2, 10);
}

async function copyTextToClipboard(text) {
  const value = String(text ?? '');

  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(value);
    return true;
  }

  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', 'readonly');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  let copied = false;
  try {
    copied = document.execCommand('copy');
  } finally {
    textarea.remove();
  }

  if (!copied) {
    throw new Error('clipboard_unavailable');
  }

  return true;
}

function downloadBlobFile(blob, filename) {
  if (!(blob instanceof Blob)) {
    throw new Error('download_blob_missing');
  }

  const link = document.createElement('a');
  const objectUrl = URL.createObjectURL(blob);
  link.href = objectUrl;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    link.remove();
    URL.revokeObjectURL(objectUrl);
  }, 1000);
}

function slugifyFilename(value) {
  return String(value || 'item')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'item';
}

function formatExportTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function copyComputedStylesRecursive(sourceNode, targetNode) {
  if (!(sourceNode instanceof Element) || !(targetNode instanceof Element)) {
    return;
  }

  const computedStyle = window.getComputedStyle(sourceNode);
  for (const prop of computedStyle) {
    targetNode.style.setProperty(
      prop,
      computedStyle.getPropertyValue(prop),
      computedStyle.getPropertyPriority(prop)
    );
  }

  if (sourceNode instanceof HTMLCanvasElement && targetNode instanceof HTMLCanvasElement) {
    const ctx = targetNode.getContext('2d');
    if (ctx) {
      try {
        ctx.drawImage(sourceNode, 0, 0);
      } catch {
        // noop
      }
    }
  }

  if (sourceNode instanceof HTMLInputElement || sourceNode instanceof HTMLTextAreaElement || sourceNode instanceof HTMLSelectElement) {
    targetNode.setAttribute('value', sourceNode.value);
    if ('value' in targetNode) {
      targetNode.value = sourceNode.value;
    }
  }

  const sourceChildren = [...sourceNode.childNodes];
  const targetChildren = [...targetNode.childNodes];
  for (let i = 0; i < sourceChildren.length; i++) {
    copyComputedStylesRecursive(sourceChildren[i], targetChildren[i]);
  }
}

function canvasToBlob(canvas, type = 'image/png') {
  return new Promise((resolve, reject) => {
    if (!(canvas instanceof HTMLCanvasElement)) {
      reject(new Error('capture_canvas_missing'));
      return;
    }

    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('capture_blob_failed'));
    }, type);
  });
}

function isTransparentColor(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return !normalized
    || normalized === 'transparent'
    || normalized === 'rgba(0, 0, 0, 0)'
    || normalized === 'rgba(0,0,0,0)';
}

function resolveCaptureBackgroundColor(node, explicitBackgroundColor) {
  if (explicitBackgroundColor === null) {
    return null;
  }

  if (typeof explicitBackgroundColor === 'string' && explicitBackgroundColor.trim()) {
    return explicitBackgroundColor;
  }

  let current = node;
  while (current instanceof Element) {
    const color = window.getComputedStyle(current).backgroundColor;
    if (!isTransparentColor(color)) {
      return color;
    }
    current = current.parentElement;
  }

  const bodyColor = document.body ? window.getComputedStyle(document.body).backgroundColor : '';
  if (!isTransparentColor(bodyColor)) {
    return bodyColor;
  }

  return '#ffffff';
}

function resolveCaptureScale(options = {}) {
  const requested = Number(options.scale);
  if (Number.isFinite(requested) && requested > 0) {
    return requested;
  }

  const deviceScale = Number(window.devicePixelRatio) || 1;
  return Math.min(3, Math.max(2, deviceScale));
}

function stabilizeCaptureCloneTree(root) {
  if (!(root instanceof Element)) {
    return;
  }

  [root, ...root.querySelectorAll('*')].forEach((node) => {
    if (!(node instanceof HTMLElement) && !(node instanceof SVGElement)) {
      return;
    }

    node.style.setProperty('animation', 'none', 'important');
    node.style.setProperty('transition', 'none', 'important');
    node.style.setProperty('caret-color', 'transparent', 'important');
  });
}

function isCanvasLikelyBlank(canvas) {
  if (!(canvas instanceof HTMLCanvasElement) || canvas.width < 1 || canvas.height < 1) {
    return true;
  }

  const sampleCanvas = document.createElement('canvas');
  sampleCanvas.width = Math.max(16, Math.min(64, canvas.width));
  sampleCanvas.height = Math.max(16, Math.min(64, canvas.height));

  const sampleContext = sampleCanvas.getContext('2d', { willReadFrequently: true });
  if (!sampleContext) {
    return false;
  }

  sampleContext.imageSmoothingEnabled = true;
  if ('imageSmoothingQuality' in sampleContext) {
    sampleContext.imageSmoothingQuality = 'high';
  }
  sampleContext.drawImage(canvas, 0, 0, sampleCanvas.width, sampleCanvas.height);

  const imageData = sampleContext.getImageData(0, 0, sampleCanvas.width, sampleCanvas.height).data;
  const totalPixels = sampleCanvas.width * sampleCanvas.height;

  let visiblePixels = 0;
  let darkishPixels = 0;
  let coloredPixels = 0;
  let minLuma = 255;
  let maxLuma = 0;
  let sumLuma = 0;
  let sumLumaSquared = 0;

  for (let i = 0; i < imageData.length; i += 4) {
    const r = imageData[i];
    const g = imageData[i + 1];
    const b = imageData[i + 2];
    const a = imageData[i + 3];

    if (a < 8) {
      continue;
    }

    visiblePixels += 1;
    const luma = (r * 299 + g * 587 + b * 114) / 1000;
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);

    minLuma = Math.min(minLuma, luma);
    maxLuma = Math.max(maxLuma, luma);
    sumLuma += luma;
    sumLumaSquared += luma * luma;

    if (luma < 245) {
      darkishPixels += 1;
    }
    if (chroma > 10) {
      coloredPixels += 1;
    }
  }

  if (visiblePixels === 0) {
    return true;
  }

  const meanLuma = sumLuma / visiblePixels;
  const variance = Math.max(0, (sumLumaSquared / visiblePixels) - (meanLuma * meanLuma));
  const visibleRatio = visiblePixels / totalPixels;
  const darkishRatio = darkishPixels / totalPixels;
  const coloredRatio = coloredPixels / totalPixels;

  return visibleRatio > 0.98
    && darkishRatio < 0.003
    && coloredRatio < 0.003
    && (maxLuma - minLuma) < 8
    && variance < 12;
}

function assertCanvasHasVisibleContent(canvas, options = {}) {
  if (!options.validateNotBlank) {
    return;
  }

  if (isCanvasLikelyBlank(canvas)) {
    throw new Error('capture_blank_output');
  }
}

function normalizeWashedCanvasIfNeeded(canvas) {
  if (!(canvas instanceof HTMLCanvasElement) || canvas.width < 1 || canvas.height < 1) {
    return false;
  }

  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    return false;
  }

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  let visiblePixels = 0;
  let minLuma = 255;
  let maxLuma = 0;
  let sumLuma = 0;

  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    if (alpha < 8) {
      continue;
    }

    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const luma = (r * 299 + g * 587 + b * 114) / 1000;

    visiblePixels += 1;
    minLuma = Math.min(minLuma, luma);
    maxLuma = Math.max(maxLuma, luma);
    sumLuma += luma;
  }

  if (visiblePixels < 64) {
    return false;
  }

  const meanLuma = sumLuma / visiblePixels;
  const shouldNormalize = meanLuma > 238 && minLuma > 52 && maxLuma > 180;
  if (!shouldNormalize) {
    return false;
  }

  const blackPoint = Math.round(Math.min(104, Math.max(72, minLuma - 12)));
  const scale = 255 / Math.max(1, 255 - blackPoint);

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 8) {
      continue;
    }

    data[i] = Math.max(0, Math.min(255, Math.round((data[i] - blackPoint) * scale)));
    data[i + 1] = Math.max(0, Math.min(255, Math.round((data[i + 1] - blackPoint) * scale)));
    data[i + 2] = Math.max(0, Math.min(255, Math.round((data[i + 2] - blackPoint) * scale)));
  }

  context.putImageData(imageData, 0, 0);
  return true;
}

async function renderNodeToPngBlobWithHtml2Canvas(node, options = {}) {
  if (!(node instanceof Element)) {
    throw new Error('invalid_capture_target');
  }

  const rect = node.getBoundingClientRect();
  const width = Math.max(1, Math.ceil(rect.width));
  const height = Math.max(1, Math.ceil(rect.height));
  const scale = resolveCaptureScale(options);
  const backgroundColor = resolveCaptureBackgroundColor(node, options.backgroundColor);
  const captureAttr = 'data-apimaster-capture-id';
  const captureId = `capture-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const previousCaptureId = node.getAttribute(captureAttr);

  node.setAttribute(captureAttr, captureId);

  try {
    if (typeof window.html2canvas !== 'function') {
      throw new Error('capture_renderer_unavailable');
    }

    const canvas = await window.html2canvas(node, {
      backgroundColor,
      foreignObjectRendering: options.html2canvasForeignObjectRendering === true,
      scale,
      useCORS: true,
      logging: false,
      removeContainer: true,
      width,
      height,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      onclone: (clonedDocument) => {
        if (typeof options.onClone !== 'function') {
          return;
        }

        const clonedNode = clonedDocument.querySelector(`[${captureAttr}="${captureId}"]`);
        if (!clonedNode) {
          throw new Error('capture_clone_target_missing');
        }

        stabilizeCaptureCloneTree(clonedNode);
        options.onClone(clonedNode, clonedDocument);
      },
    });

    normalizeWashedCanvasIfNeeded(canvas);
    assertCanvasHasVisibleContent(canvas, options);
    return await canvasToBlob(canvas);
  } finally {
    if (previousCaptureId === null) {
      node.removeAttribute(captureAttr);
    } else {
      node.setAttribute(captureAttr, previousCaptureId);
    }
  }
}

async function renderNodeToPngBlobWithForeignObject(node, options = {}) {
  if (!(node instanceof Element)) {
    throw new Error('invalid_capture_target');
  }

  const rect = node.getBoundingClientRect();
  const width = Math.max(1, Math.ceil(rect.width));
  const height = Math.max(1, Math.ceil(rect.height));
  const scale = resolveCaptureScale(options);
  const backgroundColor = resolveCaptureBackgroundColor(node, options.backgroundColor);

  const clone = node.cloneNode(true);
  copyComputedStylesRecursive(node, clone);
  stabilizeCaptureCloneTree(clone);

  if (typeof options.onClone === 'function') {
    options.onClone(clone);
  }

  clone.style.margin = '0';
  clone.style.width = `${width}px`;
  clone.style.height = `${height}px`;
  clone.style.boxSizing = 'border-box';

  const wrapper = document.createElement('div');
  wrapper.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  wrapper.style.width = `${width}px`;
  wrapper.style.height = `${height}px`;
  wrapper.style.background = backgroundColor || 'transparent';
  wrapper.style.boxSizing = 'border-box';
  wrapper.style.display = 'block';
  wrapper.appendChild(clone);

  const serialized = new XMLSerializer().serializeToString(wrapper);
  const svgMarkup = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width * scale}" height="${height * scale}" viewBox="0 0 ${width} ${height}" shape-rendering="geometricPrecision" text-rendering="geometricPrecision">
      <foreignObject x="0" y="0" width="100%" height="100%">${serialized}</foreignObject>
    </svg>
  `;

  const svgBlob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
  const svgUrl = URL.createObjectURL(svgBlob);

  try {
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('capture_load_failed'));
      img.src = svgUrl;
    });

    const canvas = document.createElement('canvas');
    canvas.width = width * scale;
    canvas.height = height * scale;

    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('canvas_context_unavailable');
    }

    context.imageSmoothingEnabled = true;
    if ('imageSmoothingQuality' in context) {
      context.imageSmoothingQuality = 'high';
    }

    if (backgroundColor) {
      context.fillStyle = backgroundColor;
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    normalizeWashedCanvasIfNeeded(canvas);
    assertCanvasHasVisibleContent(canvas, options);
    return await canvasToBlob(canvas);
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

async function renderNodeToPngBlob(node, options = {}) {
  if (!(node instanceof Element)) {
    throw new Error('invalid_capture_target');
  }

  const errors = [];
  const rendererOrder = options.preferForeignObject
    ? ['foreignObject', 'html2canvas']
    : ['html2canvas', 'foreignObject'];

  for (const renderer of rendererOrder) {
    try {
      if (renderer === 'html2canvas') {
        if (typeof window.html2canvas !== 'function') {
          throw new Error('capture_renderer_unavailable');
        }
        return await renderNodeToPngBlobWithHtml2Canvas(node, options);
      }

      return await renderNodeToPngBlobWithForeignObject(node, options);
    } catch (error) {
      errors.push(error);
      console.warn(`${renderer} capture failed${renderer === rendererOrder[rendererOrder.length - 1] ? '' : ', trying next renderer'}:`, error);
    }
  }

  const finalError = new Error(errors.map((item) => item?.message || String(item)).join(' | ') || 'capture_failed');
  finalError.causes = errors;
  throw finalError;
}

async function copyImageBlobToClipboard(blob) {
  if (!blob) {
    throw new Error('clipboard_blob_missing');
  }
  if (!window.isSecureContext) {
    throw new Error('clipboard_secure_context_required');
  }
  if (!navigator.clipboard?.write) {
    throw new Error('clipboard_image_write_unavailable');
  }
  if (typeof ClipboardItem === 'undefined') {
    throw new Error('clipboard_item_unavailable');
  }

  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        [blob.type || 'image/png']: blob,
      }),
    ]);
  } catch (error) {
    const errorName = String(error?.name || '');
    if (errorName === 'NotAllowedError') {
      throw new Error('clipboard_write_permission_denied');
    }
    if (errorName === 'AbortError') {
      throw new Error('clipboard_write_aborted');
    }
    if (errorName === 'SecurityError') {
      throw new Error('clipboard_secure_context_required');
    }
    throw new Error('clipboard_write_failed');
  }
}

/* ── SVG Icons ── */
const ICON_CHECK = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';
const ICON_X = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6m0-6l6 6"/></svg>';
const ICON_WARN = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><path d="M12 9v4m0 4h.01"/></svg>';
