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
  if (score >= 85) return '兼容性高';
  if (score >= 65) return '兼容性良好';
  if (score >= 45) return '需要复核';
  return '兼容性较弱';
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

async function renderNodeToPngBlobWithHtml2Canvas(node, options = {}) {
  if (!(node instanceof Element)) {
    throw new Error('invalid_capture_target');
  }

  const rect = node.getBoundingClientRect();
  const width = Math.max(1, Math.ceil(rect.width));
  const height = Math.max(1, Math.ceil(rect.height));
  const scale = Math.max(1, Number(options.scale) || 2);
  const backgroundColor = options.backgroundColor || '#ffffff';
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

        options.onClone(clonedNode, clonedDocument);
      },
    });

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
  const scale = Math.max(1, Number(options.scale) || 2);
  const backgroundColor = options.backgroundColor || '#ffffff';

  const clone = node.cloneNode(true);
  copyComputedStylesRecursive(node, clone);

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
  wrapper.style.background = backgroundColor;
  wrapper.style.boxSizing = 'border-box';
  wrapper.appendChild(clone);

  const serialized = new XMLSerializer().serializeToString(wrapper);
  const svgMarkup = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width * scale}" height="${height * scale}" viewBox="0 0 ${width} ${height}">
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

    context.fillStyle = backgroundColor;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
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

  if (typeof window.html2canvas === 'function') {
    try {
      return await renderNodeToPngBlobWithHtml2Canvas(node, options);
    } catch (error) {
      errors.push(error);
      console.warn('html2canvas capture failed, falling back to foreignObject capture:', error);
    }
  }

  try {
    return await renderNodeToPngBlobWithForeignObject(node, options);
  } catch (error) {
    errors.push(error);
    const finalError = new Error(errors.map((item) => item?.message || String(item)).join(' | ') || 'capture_failed');
    finalError.causes = errors;
    throw finalError;
  }
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
