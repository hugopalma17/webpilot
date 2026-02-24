// Element Handle Registry

const handles = new Map(); // handleId -> { ref: WeakRef<Element>, lastAccessed }
let handleCounter = 0;
const frameworkRuntime = {
  handles: {
    ttlMs: 15 * 60 * 1000,
    cleanupIntervalMs: 60 * 1000,
  },
  debug: {
    cursor: true,
  },
};
let handleCleanupTimer = null;
let lastFrameworkConfigJson = "";

function storeHandle(el) {
  const id = `el_${++handleCounter}`;
  handles.set(id, { ref: new WeakRef(el), lastAccessed: Date.now() });
  return id;
}

function getHandle(id) {
  const entry = handles.get(id);
  if (!entry) throw new Error(`Handle ${id} not found`);
  const el = entry.ref.deref();
  if (!el) {
    handles.delete(id);
    throw new Error(`Handle ${id} was garbage collected`);
  }
  entry.lastAccessed = Date.now();
  return el;
}

function resolveElement(params) {
  if (params.handleId) return getHandle(params.handleId);
  if (params.selector) {
    const el = document.querySelector(params.selector);
    if (!el) throw new Error(`Element not found: ${params.selector}`);
    return el;
  }
  throw new Error("No handleId or selector provided");
}

function cleanupStaleHandles() {
  const cutoff = Date.now() - frameworkRuntime.handles.ttlMs;
  for (const [id, entry] of handles) {
    if (!entry.ref.deref() || entry.lastAccessed < cutoff) {
      handles.delete(id);
    }
  }
}

function restartHandleCleanupTimer() {
  if (handleCleanupTimer) clearInterval(handleCleanupTimer);
  handleCleanupTimer = setInterval(
    cleanupStaleHandles,
    frameworkRuntime.handles.cleanupIntervalMs,
  );
}

// Cursor State & Bezier Math

let cursorX = 0;
let cursorY = 0;

// Restore cursor position from service worker (survives page reloads)
chrome.runtime.sendMessage(
  { action: "cursor.getPosition", params: {} },
  (response) => {
    if (response && response.result) {
      cursorX = response.result.x || 0;
      cursorY = response.result.y || 0;
    }
  },
);

// Save cursor position to service worker after moves
function saveCursorPosition() {
  chrome.runtime.sendMessage(
    { action: "cursor.reportPosition", params: { x: cursorX, y: cursorY } },
    () => {},
  );
}

// Debug mode — defaults are configurable from framework config.
let debugMode = frameworkRuntime.debug.cursor;

function applyFrameworkConfig(rawConfig) {
  if (!rawConfig || typeof rawConfig !== "object") return;

  const nextJson = JSON.stringify(rawConfig);
  if (nextJson === lastFrameworkConfigJson) return;
  lastFrameworkConfigJson = nextJson;

  if (rawConfig.handles && typeof rawConfig.handles === "object") {
    const ttlMs = Number(rawConfig.handles.ttlMs);
    const cleanupIntervalMs = Number(rawConfig.handles.cleanupIntervalMs);

    if (Number.isFinite(ttlMs) && ttlMs >= 1000) {
      frameworkRuntime.handles.ttlMs = ttlMs;
    }
    if (Number.isFinite(cleanupIntervalMs) && cleanupIntervalMs >= 1000) {
      frameworkRuntime.handles.cleanupIntervalMs = cleanupIntervalMs;
    }
    restartHandleCleanupTimer();
  }

  if (
    rawConfig.debug &&
    typeof rawConfig.debug === "object" &&
    typeof rawConfig.debug.cursor === "boolean"
  ) {
    debugMode = rawConfig.debug.cursor;
    if (!debugMode) clearTrail();
  }
}

restartHandleCleanupTimer();

// Cubic bezier point at t (0-1)
function bezierPoint(t, p0, p1, p2, p3) {
  const u = 1 - t;
  return (
    u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3
  );
}

// Ease-in-out curve: slow start, fast middle, slow end (like a real hand)
function easeInOut(t) {
  if (t < 0.5) return 2 * t * t;
  return -1 + (4 - 2 * t) * t;
}

// Generate bezier path from (x0,y0) to (x1,y1) with human-like control points
function generateBezierPath(x0, y0, x1, y1, steps) {
  const dist = Math.hypot(x1 - x0, y1 - y0);
  if (dist < 2) return [{ x: x1, y: y1 }];

  // Control points offset perpendicular to the line
  // More spread = more arc curvature
  const spread = Math.min(dist * 0.35, 120);
  const angle = Math.atan2(y1 - y0, x1 - x0);
  const perpAngle = angle + Math.PI / 2;

  // Asymmetric control points — real hands don't make symmetric arcs
  const bias1 = (Math.random() - 0.5) * 2; // -1 to 1
  const bias2 = (Math.random() - 0.5) * 2;
  const cp1x =
    x0 +
    (x1 - x0) * (0.2 + Math.random() * 0.15) +
    Math.cos(perpAngle) * bias1 * spread;
  const cp1y =
    y0 +
    (y1 - y0) * (0.2 + Math.random() * 0.15) +
    Math.sin(perpAngle) * bias1 * spread;
  const cp2x =
    x0 +
    (x1 - x0) * (0.65 + Math.random() * 0.15) +
    Math.cos(perpAngle) * bias2 * spread * 0.6;
  const cp2y =
    y0 +
    (y1 - y0) * (0.65 + Math.random() * 0.15) +
    Math.sin(perpAngle) * bias2 * spread * 0.6;

  const numSteps = steps || Math.max(15, Math.min(Math.floor(dist / 4), 100));
  const points = [];

  for (let i = 1; i <= numSteps; i++) {
    // Apply ease-in-out to t — cursor accelerates then decelerates
    const linearT = i / numSteps;
    const t = easeInOut(linearT);

    let px = bezierPoint(t, x0, cp1x, cp2x, x1);
    let py = bezierPoint(t, y0, cp1y, cp2y, y1);

    // Micro-jitter (hand tremor) — strongest in the middle of the movement
    // Fades near start and end where hand is steadier
    const jitterStrength =
      Math.sin(linearT * Math.PI) * Math.min(dist * 0.003, 1.5);
    px += (Math.random() - 0.5) * jitterStrength * 2;
    py += (Math.random() - 0.5) * jitterStrength * 2;

    points.push({ x: px, y: py });
  }

  // Ensure final point is exactly on target
  points[points.length - 1] = { x: x1, y: y1 };

  return points;
}

// Visual Cursor Dot + Debug Trail

let cursorDot = null;
let cursorFadeTimer = null;
let trailContainer = null;

function ensureCursorDot() {
  if (cursorDot && document.body?.contains(cursorDot)) return cursorDot;
  cursorDot = document.createElement("div");
  cursorDot.id = "__bridge_cursor";
  cursorDot.style.cssText = [
    "position:fixed",
    "z-index:2147483647",
    "width:12px",
    "height:12px",
    "border-radius:50%",
    "background:rgba(66,133,244,0.8)",
    "box-shadow:0 0 8px rgba(66,133,244,0.5)",
    "pointer-events:none",
    "transform:translate(-50%,-50%)",
    "transition:opacity 0.5s",
    "opacity:0",
  ].join(";");
  (document.body || document.documentElement).appendChild(cursorDot);
  return cursorDot;
}

function ensureTrailContainer() {
  if (trailContainer && document.body?.contains(trailContainer))
    return trailContainer;
  trailContainer = document.createElement("div");
  trailContainer.id = "__bridge_trail";
  trailContainer.style.cssText =
    "position:fixed;top:0;left:0;width:100%;height:100%;z-index:2147483646;pointer-events:none;";
  (document.body || document.documentElement).appendChild(trailContainer);
  return trailContainer;
}

function clearTrail() {
  if (trailContainer) trailContainer.innerHTML = "";
}

function drawTrailDot(x, y, progress) {
  const container = ensureTrailContainer();
  const dot = document.createElement("div");
  // Color shifts from green (start) → yellow (mid) → red (end)
  const r = Math.floor(progress * 255);
  const g = Math.floor((1 - progress) * 200);
  const size = 3 + (1 - Math.abs(progress - 0.5) * 2) * 3; // larger in the middle
  dot.style.cssText = [
    "position:fixed",
    "border-radius:50%",
    "pointer-events:none",
    `width:${size}px`,
    `height:${size}px`,
    `left:${x - size / 2}px`,
    `top:${y - size / 2}px`,
    `background:rgba(${r},${g},80,0.7)`,
    "transition:opacity 2s",
  ].join(";");
  container.appendChild(dot);
  // Fade trail dots after 3s
  setTimeout(() => {
    dot.style.opacity = "0";
  }, 3000);
  setTimeout(() => {
    dot.remove();
  }, 5000);
}

function moveCursorDot(x, y) {
  const dot = ensureCursorDot();
  dot.style.left = x + "px";
  dot.style.top = y + "px";
  dot.style.opacity = "1";
  clearTimeout(cursorFadeTimer);
  cursorFadeTimer = setTimeout(() => {
    dot.style.opacity = "0";
  }, 2000);
}

// Dispatch mouse move along path with variable timing (ease-in-out speed)
function dispatchMousePath(points) {
  clearTrail();

  return new Promise((resolve) => {
    let i = 0;
    const total = points.length;

    function step() {
      if (i >= total) {
        resolve();
        return;
      }

      const p = points[i];
      const progress = i / total;
      cursorX = p.x;
      cursorY = p.y;
      moveCursorDot(p.x, p.y);
      drawTrailDot(p.x, p.y, progress);

      const target = document.elementFromPoint(p.x, p.y) || document.body;
      target.dispatchEvent(
        new MouseEvent("mousemove", {
          clientX: p.x,
          clientY: p.y,
          bubbles: true,
          cancelable: true,
          view: window,
        }),
      );

      i++;

      // Variable frame timing — occasionally skip a frame for micro-stutter
      // Real hands don't move at perfectly uniform frame rate
      if (Math.random() < 0.08 && i < total - 2) {
        // Double-frame pause (~32ms instead of ~16ms) — simulates hand hesitation
        requestAnimationFrame(() => requestAnimationFrame(step));
      } else {
        requestAnimationFrame(step);
      }
    }
    requestAnimationFrame(step);
  });
}

// Overshoot: move past target then correct back
function generateOvershootPath(x0, y0, x1, y1) {
  const dist = Math.hypot(x1 - x0, y1 - y0);
  if (dist < 100) return generateBezierPath(x0, y0, x1, y1);

  // Overshoot proportional to distance, with randomization
  const overshoot = Math.min(20, dist * 0.06) * (0.4 + Math.random() * 0.6);
  const angle = Math.atan2(y1 - y0, x1 - x0);
  // Slight perpendicular offset on the overshoot too
  const perpOffset = (Math.random() - 0.5) * overshoot * 0.5;
  const perpAngle = angle + Math.PI / 2;
  const overX =
    x1 + Math.cos(angle) * overshoot + Math.cos(perpAngle) * perpOffset;
  const overY =
    y1 + Math.sin(angle) * overshoot + Math.sin(perpAngle) * perpOffset;

  const pathToOver = generateBezierPath(x0, y0, overX, overY);
  const pathBack = generateBezierPath(overX, overY, x1, y1, 10);

  return [...pathToOver, ...pathBack];
}

// Action: dom.markElement / dom.unmarkElement (for service-worker eval)

function actionMarkElement(params) {
  const el = getHandle(params.handleId);
  el.setAttribute("data-bridge-eval", params.markerId);
  return { marked: true };
}

function actionUnmarkElement(params) {
  const el = document.querySelector(`[data-bridge-eval="${params.markerId}"]`);
  if (el) el.removeAttribute("data-bridge-eval");
  return { unmarked: true };
}

// Register an element marked by evaluateHandle in MAIN world
function actionRegisterMarkedElement(params) {
  const el = document.querySelector(`[data-bridge-handle="${params.marker}"]`);
  if (!el) return null;
  el.removeAttribute("data-bridge-handle");
  return storeHandle(el);
}

// NOTE: dom.evaluate and dom.elementEvaluate are handled by the service worker
// using chrome.scripting.executeScript (MAIN world) to bypass MV3 CSP.
// They never reach the content script.

// Action: dom.querySelector / querySelectorAll / querySelectorWithin

function actionQuerySelector(params) {
  const el = document.querySelector(params.selector);
  return el ? storeHandle(el) : null;
}

function actionQuerySelectorAll(params) {
  const els = document.querySelectorAll(params.selector);
  return Array.from(els).map(storeHandle);
}

function actionQuerySelectorWithin(params) {
  const parent = getHandle(params.parentHandleId);
  const el = parent.querySelector(params.selector);
  return el ? storeHandle(el) : null;
}

function actionQuerySelectorAllWithin(params) {
  const parent = getHandle(params.parentHandleId);
  return Array.from(parent.querySelectorAll(params.selector)).map(storeHandle);
}

// Action: dom.queryAllInfo — single-call querySelectorAll + handles + element info
function actionQueryAllInfo(params) {
  const els = document.querySelectorAll(params.selector);
  return Array.from(els).map(el => {
    const handleId = storeHandle(el);
    return {
      handleId,
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      cls: [...el.classList].slice(0, 3).join(' ') || null,
      text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60) || null,
      label: el.getAttribute('aria-label') || el.getAttribute('name') || el.getAttribute('placeholder') || (el.labels && el.labels[0] ? el.labels[0].textContent.trim() : null),
    };
  });
}

// Action: dom.boundingBox

function actionBoundingBox(params) {
  const el = resolveElement(params);
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

// Action: dom.mouseMoveTo

async function actionMouseMoveTo(params) {
  const el = resolveElement(params);
  const rect = el.getBoundingClientRect();
  // Target: random point within center 60% of element
  const padX = rect.width * 0.2;
  const padY = rect.height * 0.2;
  const targetX = rect.x + padX + Math.random() * (rect.width - padX * 2);
  const targetY = rect.y + padY + Math.random() * (rect.height - padY * 2);

  let startX = cursorX;
  let startY = cursorY;

  // If cursor is already on or very near the target, drift away first so
  // the movement path is always visible (avoids teleport-click appearance).
  const dist = Math.hypot(targetX - startX, targetY - startY);
  if (dist < 80) {
    const driftAngle = Math.random() * Math.PI * 2;
    const driftDist = 80 + Math.random() * 120;
    const driftX = Math.max(0, Math.min(window.innerWidth,  startX + Math.cos(driftAngle) * driftDist));
    const driftY = Math.max(0, Math.min(window.innerHeight, startY + Math.sin(driftAngle) * driftDist));
    await dispatchMousePath(generateBezierPath(startX, startY, driftX, driftY));
    startX = cursorX;
    startY = cursorY;
  }

  const dist2 = Math.hypot(targetX - startX, targetY - startY);
  const points =
    dist2 > 200
      ? generateOvershootPath(startX, startY, targetX, targetY)
      : generateBezierPath(startX, startY, targetX, targetY);

  await dispatchMousePath(points);
  saveCursorPosition();
  return { x: cursorX, y: cursorY };
}

// Action: dom.click (with mousedown/mouseup/click dispatch)

function actionClick(params) {
  const el = resolveElement(params);
  const rect = el.getBoundingClientRect();
  const x = cursorX || rect.x + rect.width / 2;
  const y = cursorY || rect.y + rect.height / 2;
  const clickCount = params.clickCount || 1;

  for (let i = 1; i <= clickCount; i++) {
    const opts = {
      clientX: x,
      clientY: y,
      bubbles: true,
      cancelable: true,
      view: window,
      button: 0,
      detail: i,
    };
    // Dispatch on the element physically under the cursor.
    // If nothing is at the cursor coordinates, abort — element is not truly visible.
    const atPoint = document.elementFromPoint(x, y);
    if (!atPoint) return;
    atPoint.dispatchEvent(new MouseEvent("mousedown", opts));
    if (i === 1) el.focus();
    atPoint.dispatchEvent(new MouseEvent("mouseup", opts));
    atPoint.dispatchEvent(new MouseEvent("click", opts));

    // detail:2 = double-click (select word), detail:3 = triple-click (select all)
    if (i === 2) atPoint.dispatchEvent(new MouseEvent("dblclick", opts));
  }

  // Triple-click: select all text in input/textarea
  if (
    clickCount >= 3 &&
    (el.tagName === "INPUT" || el.tagName === "TEXTAREA")
  ) {
    el.setSelectionRange(0, el.value.length);
  }

  return { clicked: true };
}

// Action: dom.type

function actionType(params) {
  const { text, handleId, selector } = params;
  let target;
  if (handleId) target = getHandle(handleId);
  else if (selector) target = document.querySelector(selector);
  else target = document.activeElement;

  if (!target) throw new Error("No target for typing");
  if (target !== document.activeElement) target.focus();

  for (const char of text) {
    const charCode = char.charCodeAt(0);
    const shared = {
      key: char,
      code: `Key${char.toUpperCase()}`,
      keyCode: charCode,
      charCode,
      which: charCode,
      bubbles: true,
      cancelable: true,
      view: window,
    };
    target.dispatchEvent(new KeyboardEvent("keydown", shared));
    target.dispatchEvent(new KeyboardEvent("keypress", shared));

    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
      const start = target.selectionStart || 0;
      const end = target.selectionEnd || 0;
      const newValue =
        target.value.slice(0, start) + char + target.value.slice(end);
      // Use native setter to trigger React's change detection
      const proto =
        target.tagName === "TEXTAREA"
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
      const nativeSetter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (nativeSetter) {
        nativeSetter.call(target, newValue);
      } else {
        target.value = newValue;
      }
      target.selectionStart = target.selectionEnd = start + 1;
    } else if (target.isContentEditable) {
      document.execCommand("insertText", false, char);
    }

    target.dispatchEvent(
      new InputEvent("input", {
        data: char,
        inputType: "insertText",
        bubbles: true,
        cancelable: true,
      }),
    );
    target.dispatchEvent(new KeyboardEvent("keyup", shared));
  }

  return { typed: true };
}

// Keyboard: key mapping, modifier tracking, functional keys

// Map Puppeteer key names → { key, code, keyCode }
const KEY_MAP = {
  // Modifiers
  Meta: { key: "Meta", code: "MetaLeft", keyCode: 91 },
  Control: { key: "Control", code: "ControlLeft", keyCode: 17 },
  Shift: { key: "Shift", code: "ShiftLeft", keyCode: 16 },
  Alt: { key: "Alt", code: "AltLeft", keyCode: 18 },
  // Action keys
  Enter: { key: "Enter", code: "Enter", keyCode: 13 },
  Tab: { key: "Tab", code: "Tab", keyCode: 9 },
  Escape: { key: "Escape", code: "Escape", keyCode: 27 },
  Backspace: { key: "Backspace", code: "Backspace", keyCode: 8 },
  Delete: { key: "Delete", code: "Delete", keyCode: 46 },
  Space: { key: " ", code: "Space", keyCode: 32 },
  " ": { key: " ", code: "Space", keyCode: 32 },
  // Arrow keys
  ArrowUp: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  ArrowDown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  ArrowRight: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  // Navigation
  Home: { key: "Home", code: "Home", keyCode: 36 },
  End: { key: "End", code: "End", keyCode: 35 },
  PageUp: { key: "PageUp", code: "PageUp", keyCode: 33 },
  PageDown: { key: "PageDown", code: "PageDown", keyCode: 34 },
};

// Resolve Puppeteer key name (e.g. "KeyA", "Backspace", "Meta") to event properties
function resolveKey(rawKey) {
  if (KEY_MAP[rawKey]) return KEY_MAP[rawKey];

  // "KeyA" → key: "a", code: "KeyA"
  const keyMatch = rawKey.match(/^Key([A-Z])$/);
  if (keyMatch) {
    const letter = keyMatch[1].toLowerCase();
    return {
      key: letter,
      code: rawKey,
      keyCode: letter.toUpperCase().charCodeAt(0),
    };
  }

  // "Digit5" → key: "5", code: "Digit5"
  const digitMatch = rawKey.match(/^Digit(\d)$/);
  if (digitMatch) {
    return {
      key: digitMatch[1],
      code: rawKey,
      keyCode: digitMatch[1].charCodeAt(0),
    };
  }

  // Single character
  if (rawKey.length === 1) {
    const upper = rawKey.toUpperCase();
    return { key: rawKey, code: `Key${upper}`, keyCode: upper.charCodeAt(0) };
  }

  // Fallback
  return { key: rawKey, code: rawKey, keyCode: 0 };
}

// Track active modifiers for combo detection (Ctrl+A, etc.)
const activeModifiers = {
  meta: false,
  control: false,
  shift: false,
  alt: false,
};

function isModifier(key) {
  return (
    key === "Meta" || key === "Control" || key === "Shift" || key === "Alt"
  );
}

function buildEventProps(resolved) {
  return {
    key: resolved.key,
    code: resolved.code,
    keyCode: resolved.keyCode,
    charCode: resolved.keyCode,
    which: resolved.keyCode,
    metaKey: activeModifiers.meta,
    ctrlKey: activeModifiers.control,
    shiftKey: activeModifiers.shift,
    altKey: activeModifiers.alt,
    bubbles: true,
    cancelable: true,
    view: window,
  };
}

// Handle functional side-effects of key presses (select-all, backspace, delete, enter)
function applyKeyEffect(target, resolved) {
  const key = resolved.key;
  const isInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA";
  const isSelect = target.tagName === "SELECT";
  const selectAll = activeModifiers.meta || activeModifiers.control;

  if (selectAll && (key === "a" || key === "A")) {
    // Ctrl+A / Cmd+A → select all
    if (isInput) {
      target.setSelectionRange(0, target.value.length);
    } else if (target.isContentEditable) {
      const range = document.createRange();
      range.selectNodeContents(target);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
    return;
  }

  if (isSelect && (key === "ArrowDown" || key === "ArrowUp")) {
    const dir = key === "ArrowDown" ? 1 : -1;
    const current = target.selectedIndex >= 0 ? target.selectedIndex : 0;
    const next = Math.max(
      0,
      Math.min(target.options.length - 1, current + dir),
    );
    if (next !== target.selectedIndex) {
      target.selectedIndex = next;
      target.dispatchEvent(new Event("input", { bubbles: true }));
      target.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return;
  }

  if (isSelect && key === "Enter") {
    target.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }

  if (key === "Backspace" && isInput) {
    const start = target.selectionStart ?? 0;
    const end = target.selectionEnd ?? 0;
    const val = target.value;
    let newValue, newCursor;
    if (start !== end) {
      // Delete selection
      newValue = val.slice(0, start) + val.slice(end);
      newCursor = start;
    } else if (start > 0) {
      // Delete char before cursor
      newValue = val.slice(0, start - 1) + val.slice(end);
      newCursor = start - 1;
    } else {
      return; // nothing to delete
    }
    const proto =
      target.tagName === "TEXTAREA"
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (nativeSetter) nativeSetter.call(target, newValue);
    else target.value = newValue;
    target.selectionStart = target.selectionEnd = newCursor;
    target.dispatchEvent(
      new InputEvent("input", {
        inputType: "deleteContentBackward",
        bubbles: true,
      }),
    );
    return;
  }

  if (key === "Delete" && isInput) {
    const start = target.selectionStart ?? 0;
    const end = target.selectionEnd ?? 0;
    const val = target.value;
    let newValue;
    if (start !== end) {
      newValue = val.slice(0, start) + val.slice(end);
    } else if (end < val.length) {
      newValue = val.slice(0, start) + val.slice(end + 1);
    } else {
      return;
    }
    const proto =
      target.tagName === "TEXTAREA"
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (nativeSetter) nativeSetter.call(target, newValue);
    else target.value = newValue;
    target.selectionStart = target.selectionEnd = start;
    target.dispatchEvent(
      new InputEvent("input", {
        inputType: "deleteContentForward",
        bubbles: true,
      }),
    );
    return;
  }
}

function actionKeyPress(params) {
  const target = document.activeElement || document.body;
  const resolved = resolveKey(params.key);
  const props = buildEventProps(resolved);
  target.dispatchEvent(new KeyboardEvent("keydown", props));
  applyKeyEffect(target, resolved);
  target.dispatchEvent(new KeyboardEvent("keyup", props));
  return { pressed: true };
}

function actionKeyDown(params) {
  const target = document.activeElement || document.body;
  const resolved = resolveKey(params.key);
  // Track modifier state
  if (params.key === "Meta") activeModifiers.meta = true;
  if (params.key === "Control") activeModifiers.control = true;
  if (params.key === "Shift") activeModifiers.shift = true;
  if (params.key === "Alt") activeModifiers.alt = true;
  const props = buildEventProps(resolved);
  target.dispatchEvent(new KeyboardEvent("keydown", props));
  return { down: true };
}

function actionKeyUp(params) {
  const target = document.activeElement || document.body;
  const resolved = resolveKey(params.key);
  const props = buildEventProps(resolved);
  target.dispatchEvent(new KeyboardEvent("keyup", props));
  // Clear modifier state
  if (params.key === "Meta") activeModifiers.meta = false;
  if (params.key === "Control") activeModifiers.control = false;
  if (params.key === "Shift") activeModifiers.shift = false;
  if (params.key === "Alt") activeModifiers.alt = false;
  return { up: true };
}

// Action: dom.scroll

function actionScroll(params) {
  const {
    selector,
    amount = 400,
    direction = "down",
    behavior = "smooth",
  } = params;
  const top = direction === "down" ? amount : direction === "up" ? -amount : 0;
  const left =
    direction === "right" ? amount : direction === "left" ? -amount : 0;

  // Support handleId, selector, or fallback to window
  let el = null;
  if (params.handleId) {
    el = resolveElement(params);
  } else if (selector) {
    el = document.querySelector(selector);
  }
  const target = (el && el.scrollHeight > el.clientHeight + 10) ? el : window;
  const before = target === window ? window.scrollY : target.scrollTop;
  target.scrollBy({ top, left, behavior });
  // Check actual scroll after a tick (smooth may not be instant)
  const after = target === window ? window.scrollY : target.scrollTop;
  return { scrolled: true, before, after, target: target === window ? "window" : "element" };
}

// Action: dom.focus

function actionFocus(params) {
  const el = resolveElement(params);
  el.focus();
  return { focused: true };
}

// Action: dom.setValue

function actionSetValue(params) {
  const el = resolveElement(params);

  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const nativeSetter = Object.getOwnPropertyDescriptor(
      el instanceof HTMLInputElement
        ? window.HTMLInputElement.prototype
        : window.HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    if (nativeSetter) nativeSetter.call(el, params.value);
    else el.value = params.value;
  } else if (el instanceof HTMLSelectElement) {
    // For select elements, assigning .value selects the matching option by value.
    el.value = String(params.value);
    if (el.value !== String(params.value)) {
      const idx = Array.from(el.options).findIndex(
        (opt) =>
          opt.value === String(params.value) ||
          opt.textContent?.trim() === String(params.value),
      );
      if (idx >= 0) el.selectedIndex = idx;
    }
  } else if (el.isContentEditable) {
    el.textContent = String(params.value);
  } else {
    el.value = params.value;
  }

  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return { set: true };
}

// Action: dom.getAttribute / dom.getProperty

function actionGetAttribute(params) {
  const el = resolveElement(params);
  return el.getAttribute(params.name);
}

function actionGetProperty(params) {
  const el = resolveElement(params);
  return el[params.name];
}

// Action: dom.waitForSelector (async)

function actionWaitForSelector(params, sendResponse) {
  const { selector, timeout = 5000 } = params;
  const start = Date.now();

  // Check immediately
  const existing = document.querySelector(selector);
  if (existing) {
    sendResponse({ result: storeHandle(existing) });
    return;
  }

  // Observe mutations
  const observer = new MutationObserver(() => {
    const el = document.querySelector(selector);
    if (el) {
      observer.disconnect();
      clearTimeout(timer);
      sendResponse({ result: storeHandle(el) });
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
  });

  const timer = setTimeout(() => {
    observer.disconnect();
    sendResponse({ result: null });
  }, timeout);
}

// Avoid Check — custom element filtering for human.* commands

function checkAvoid(el, avoid) {
  if (!avoid) return { avoided: false };

  // Check CSS selectors (el.matches or el.closest)
  for (const sel of avoid.selectors || []) {
    try {
      if (el.matches(sel) || el.closest(sel)) {
        return { avoided: true, rule: `selector:${sel}` };
      }
    } catch {}
  }

  // Check class names
  for (const cls of avoid.classes || []) {
    if (el.classList.contains(cls)) {
      return { avoided: true, rule: `class:${cls}` };
    }
    // Also check ancestors
    if (el.closest(`.${CSS.escape(cls)}`)) {
      return { avoided: true, rule: `class:${cls}` };
    }
  }

  // Check IDs
  for (const id of avoid.ids || []) {
    if (el.id === id) {
      return { avoided: true, rule: `id:${id}` };
    }
    if (el.closest(`#${CSS.escape(id)}`)) {
      return { avoided: true, rule: `id:${id}` };
    }
  }

  // Check attributes
  for (const [attr, val] of Object.entries(avoid.attributes || {})) {
    if (val === "*") {
      if (el.hasAttribute(attr)) return { avoided: true, rule: `attr:${attr}` };
    } else {
      if (el.getAttribute(attr) === val)
        return { avoided: true, rule: `attr:${attr}=${val}` };
    }
  }

  return { avoided: false };
}

// Honeypot / Ghost Element Detection (built-in, always runs)

function checkHoneypot(el) {
  // SVG elements — not clickable targets
  const isSvg =
    el.tagName === "svg" || el.tagName === "SVG" || el.closest("svg");
  if (isSvg) return { safe: false, reason: "svg-element" };

  const hasDisplayContents =
    el.getAttribute("data-display-contents") === "true" ||
    getComputedStyle(el).display === "contents";

  // Aria-hidden
  if (el.getAttribute("aria-hidden") === "true")
    return { safe: false, reason: "aria-hidden" };

  // No offsetParent (hidden), unless display:contents
  if (!hasDisplayContents && el.offsetParent === null)
    return { safe: false, reason: "no-offsetParent" };

  // Honeypot class patterns
  const classStr = Array.from(el.classList).join(" ");
  if (
    /\b(ghost|sr-only|visually-hidden|trap|honey|offscreen|off-screen)\b/i.test(
      classStr,
    )
  )
    return { safe: false, reason: "honeypot-class", detail: classStr };

  // CSS checks
  const computed = getComputedStyle(el);
  if (parseFloat(computed.opacity) === 0)
    return { safe: false, reason: "opacity-zero" };
  if (computed.visibility === "hidden")
    return { safe: false, reason: "visibility-hidden" };

  // Sub-pixel elements (tracking pixels, invisible traps)
  const rect = el.getBoundingClientRect();
  if (rect.width < 5 || rect.height < 5)
    return {
      safe: false,
      reason: "sub-pixel",
      detail: `${rect.width.toFixed(1)}x${rect.height.toFixed(1)}`,
    };

  return { safe: true };
}

// Shared helper: scroll element into comfortable view before interacting
async function ensureElementVisible(el, params) {
  let rect = el.getBoundingClientRect();
  const vh = window.innerHeight;
  const vw = window.innerWidth;
  const fullyOffScreen =
    rect.bottom < 0 || rect.top > vh || rect.right < 0 || rect.left > vw;
  const partiallyVisible =
    !fullyOffScreen &&
    (rect.top < 0 ||
      rect.bottom > vh ||
      rect.top > vh * 0.85 ||
      rect.bottom < vh * 0.15);

  if (fullyOffScreen || partiallyVisible) {
    // Smooth scroll into comfortable view first
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    await new Promise((r) =>
      setTimeout(r, 400 + Math.floor(Math.random() * 300)),
    );
    rect = el.getBoundingClientRect();

    // If still fully off-screen after scrollIntoView, use multi-step humanScroll
    if (rect.bottom < 0 || rect.top > vh || rect.right < 0 || rect.left > vw) {
      const maxSteps = 20;
      for (let step = 0; step < maxSteps; step++) {
        rect = el.getBoundingClientRect();
        if (rect.top > vh * 0.15 && rect.bottom < vh * 0.85) break;

        const direction = rect.top > vh ? "down" : "up";
        await actionHumanScroll({ ...params, direction });
        await new Promise((r) =>
          setTimeout(r, 600 + Math.floor(Math.random() * 800)),
        );
      }
    }
    rect = el.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > vh || rect.right < 0 || rect.left > vw) {
      return { visible: false, rect };
    }
  }
  return { visible: true, rect };
}

// Action: human.click — safe click with honeypot detection + bezier movement

async function actionHumanClick(params) {
  const el = resolveElement(params);
  const config = params.config || {};
  const minDelay =
    config.thinkDelayMin !== undefined ? config.thinkDelayMin : 150;
  const maxDelay =
    config.thinkDelayMax !== undefined ? config.thinkDelayMax : 400;
  const maxShift = config.maxShiftPx !== undefined ? config.maxShiftPx : 50;

  // Check custom avoid rules
  const avoidResult = checkAvoid(el, params.avoid);
  if (avoidResult.avoided)
    return { clicked: false, reason: "avoided", rule: avoidResult.rule };

  // Built-in honeypot detection
  const honeypot = checkHoneypot(el);
  if (!honeypot.safe)
    return { clicked: false, reason: honeypot.reason, detail: honeypot.detail };

  // Bounding box validation
  let rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0)
    return { clicked: false, reason: "no-bounding-box" };

  // Scroll element into comfortable view
  const scrollResult = await ensureElementVisible(el, params);
  if (!scrollResult.visible)
    return {
      clicked: false,
      reason: "off-screen",
      detail: "could not scroll into view",
    };
  rect = scrollResult.rect;

  // Bezier mouse move to element
  await actionMouseMoveTo(params);

  // Human think-time delay
  const thinkTime =
    minDelay + Math.floor(Math.random() * (maxDelay - minDelay + 1));
  await new Promise((r) => setTimeout(r, thinkTime));

  // Element shift detection — did it move during think time?
  const rectAfter = el.getBoundingClientRect();
  if (rectAfter.width === 0 && rectAfter.height === 0)
    return { clicked: false, reason: "element-disappeared" };

  const shiftX = Math.abs(rectAfter.x - rect.x);
  const shiftY = Math.abs(rectAfter.y - rect.y);
  if (shiftX > maxShift || shiftY > maxShift)
    return {
      clicked: false,
      reason: "element-shifted",
      detail: `${shiftX.toFixed(0)}x${shiftY.toFixed(0)}px`,
    };

  // Click dispatch (mousedown → mouseup → click)
  actionClick(params);
  return { clicked: true };
}

// Action: human.type — per-character typing with human-like timing

async function actionHumanType(params) {
  const { text, handleId, selector } = params;
  const config = params.config || {};
  const baseMin = config.baseDelayMin !== undefined ? config.baseDelayMin : 80;
  const baseMax = config.baseDelayMax !== undefined ? config.baseDelayMax : 180;
  const variance = config.variance !== undefined ? config.variance : 25;
  const pauseChance =
    config.pauseChance !== undefined ? config.pauseChance : 0.12;
  const pauseMin = config.pauseMin !== undefined ? config.pauseMin : 150;
  const pauseMax = config.pauseMax !== undefined ? config.pauseMax : 400;

  // Resolve target
  let target;
  if (handleId) target = getHandle(handleId);
  else if (selector) target = document.querySelector(selector);
  else target = document.activeElement;
  if (!target) throw new Error("No target for typing");

  // Check avoid rules on target element
  const avoidResult = checkAvoid(target, params.avoid);
  if (avoidResult.avoided)
    return { typed: false, reason: "avoided", rule: avoidResult.rule };

  // If targeting a specific element, use human.click to move cursor + focus
  if ((handleId || selector) && target !== document.activeElement) {
    const clickResult = await actionHumanClick(params);
    if (!clickResult.clicked)
      return { typed: false, reason: clickResult.reason, detail: clickResult.detail };
  }

  // Tokenize: split text into regular chars and {SpecialKey} tokens
  const tokens = [];
  let pos = 0;
  while (pos < text.length) {
    if (text[pos] === "{") {
      const end = text.indexOf("}", pos);
      if (end > pos + 1) {
        tokens.push({ type: "key", value: text.slice(pos + 1, end) });
        pos = end + 1;
        continue;
      }
    }
    tokens.push({ type: "char", value: text[pos] });
    pos++;
  }

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (token.type === "key") {
      // Special key — dispatch via resolveKey/buildEventProps like actionKeyPress
      const resolved = resolveKey(token.value);
      const props = buildEventProps(resolved);
      target.dispatchEvent(new KeyboardEvent("keydown", props));
      applyKeyEffect(target, resolved);
      target.dispatchEvent(new KeyboardEvent("keyup", props));
    } else {
      // Regular character
      const char = token.value;
      const charCode = char.charCodeAt(0);
      const shared = {
        key: char,
        code: `Key${char.toUpperCase()}`,
        keyCode: charCode,
        charCode,
        which: charCode,
        bubbles: true,
        cancelable: true,
        view: window,
      };

      target.dispatchEvent(new KeyboardEvent("keydown", shared));
      target.dispatchEvent(new KeyboardEvent("keypress", shared));

      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
        const start = target.selectionStart || 0;
        const end = target.selectionEnd || 0;
        const newValue =
          target.value.slice(0, start) + char + target.value.slice(end);
        const proto =
          target.tagName === "TEXTAREA"
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;
        const nativeSetter = Object.getOwnPropertyDescriptor(
          proto,
          "value",
        )?.set;
        if (nativeSetter) nativeSetter.call(target, newValue);
        else target.value = newValue;
        target.selectionStart = target.selectionEnd = start + 1;
      } else if (target.isContentEditable) {
        document.execCommand("insertText", false, char);
      }

      target.dispatchEvent(
        new InputEvent("input", {
          data: char,
          inputType: "insertText",
          bubbles: true,
          cancelable: true,
        }),
      );
      target.dispatchEvent(new KeyboardEvent("keyup", shared));
    }

    // Human delay between tokens
    const baseDelay =
      baseMin + Math.floor(Math.random() * (baseMax - baseMin + 1));
    const micro = Math.floor(Math.random() * (variance * 2 + 1)) - variance;
    const charDelay = Math.max(50, baseDelay + micro);
    await new Promise((r) => setTimeout(r, charDelay));

    // Thinking pause (random chance, not on last token)
    if (Math.random() < pauseChance && i < tokens.length - 1) {
      const pause =
        pauseMin + Math.floor(Math.random() * (pauseMax - pauseMin + 1));
      await new Promise((r) => setTimeout(r, pause));
    }
  }

  return { typed: true };
}

// Action: human.scroll — natural scrolling with optional back-scroll

async function actionHumanScroll(params) {
  const config = params.config || {};
  const flickMin = config.flickMin !== undefined ? config.flickMin : 150;
  const flickMax = config.flickMax !== undefined ? config.flickMax : 350;
  const backScrollChance =
    config.backScrollChance !== undefined ? config.backScrollChance : 0.1;
  const backScrollMin =
    config.backScrollMin !== undefined ? config.backScrollMin : 15;
  const backScrollMax =
    config.backScrollMax !== undefined ? config.backScrollMax : 60;

  const { selector, direction = "down", amount } = params;

  // Determine total amount: use param if provided, else randomized default from config
  const defaultMin = config.amountMin !== undefined ? config.amountMin : 250;
  const defaultMax = config.amountMax !== undefined ? config.amountMax : 550;

  const totalAmount =
    amount !== undefined
      ? amount
      : defaultMin + Math.floor(Math.random() * (defaultMax - defaultMin + 1));
  let remaining = totalAmount;

  let el = null;
  if (params.handleId) {
    try { el = resolveElement(params); } catch {}
  } else if (selector) {
    el = document.querySelector(selector);
  }
  const isTargetScrollable = el && el.scrollHeight > el.clientHeight + 10;
  const target = isTargetScrollable ? el : window;

  while (remaining > 0) {
    // Determine this flick's amount
    const flickAmount = Math.min(
      remaining,
      flickMin + Math.floor(Math.random() * (flickMax - flickMin + 1)),
    );

    const top =
      direction === "down"
        ? flickAmount
        : direction === "up"
          ? -flickAmount
          : 0;
    const left =
      direction === "right"
        ? flickAmount
        : direction === "left"
          ? -flickAmount
          : 0;

    target.scrollBy({ top, left, behavior: "smooth" });
    remaining -= flickAmount;

    // Back-scroll for realism (per-flick chance)
    if (Math.random() < backScrollChance) {
      await new Promise((r) =>
        setTimeout(r, 200 + Math.floor(Math.random() * 100)),
      );
      const backAmount =
        backScrollMin +
        Math.floor(Math.random() * (backScrollMax - backScrollMin + 1));
      const backTop =
        direction === "down"
          ? -backAmount
          : direction === "up"
            ? backAmount
            : 0;
      const backLeft =
        direction === "right"
          ? -backAmount
          : direction === "left"
            ? backAmount
            : 0;
      target.scrollBy({ top: backTop, left: backLeft, behavior: "smooth" });
    }

    // Pause between flicks (unless it was the last one)
    if (remaining > 0) {
      const flickPause = 150 + Math.floor(Math.random() * 250);
      await new Promise((r) => setTimeout(r, flickPause));
    }
  }

  // Final settling pause for smooth scrolling to finish
  await new Promise((r) => setTimeout(r, 500));

  return { scrolled: true, amount: totalAmount };
}

// Action: dom.batchQuery — perform multiple selector checks in one go
function actionBatchQuery(params) {
  const { selectors = [] } = params;
  const results = {};
  for (const selector of selectors) {
    const el = document.querySelector(selector);
    results[selector] = !!el;
  }
  return results;
}

// Action: human.clearInput — focus + select-all + delete with human timing

async function actionHumanClearInput(params) {
  // Use human.click to focus (gets honeypot + avoid checks)
  const clickResult = await actionHumanClick(params);
  if (!clickResult.clicked) return clickResult;

  const el = resolveElement(params);

  // Triple-click with human timing to select all
  await new Promise((r) => setTimeout(r, 40 + Math.floor(Math.random() * 50)));
  actionClick({ ...params, clickCount: 1 });
  await new Promise((r) => setTimeout(r, 50 + Math.floor(Math.random() * 60)));
  actionClick({ ...params, clickCount: 2 });
  await new Promise((r) => setTimeout(r, 45 + Math.floor(Math.random() * 55)));
  actionClick({ ...params, clickCount: 3 });

  // Pause, then delete
  await new Promise((r) =>
    setTimeout(r, 120 + Math.floor(Math.random() * 120)),
  );
  actionKeyPress({ key: "Backspace" });
  await new Promise((r) =>
    setTimeout(r, 180 + Math.floor(Math.random() * 140)),
  );

  return { cleared: true };
}

// Message Handler

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const action = message?.action;
  const incomingParams = message?.params || {};
  applyFrameworkConfig(incomingParams.__frameworkConfig);
  const { __frameworkConfig, ...params } = incomingParams;

  try {
    switch (action) {
      case "dom.markElement":
        sendResponse({ result: actionMarkElement(params) });
        return;
      case "dom.unmarkElement":
        sendResponse({ result: actionUnmarkElement(params) });
        return;
      case "dom.registerMarkedElement":
        sendResponse({ result: actionRegisterMarkedElement(params) });
        return;
      case "dom.querySelector":
        sendResponse({ result: actionQuerySelector(params) });
        return;
      case "dom.querySelectorAll":
        sendResponse({ result: actionQuerySelectorAll(params) });
        return;
      case "dom.querySelectorWithin":
        sendResponse({ result: actionQuerySelectorWithin(params) });
        return;
      case "dom.querySelectorAllWithin":
        sendResponse({ result: actionQuerySelectorAllWithin(params) });
        return;
      case "dom.queryAllInfo":
        sendResponse({ result: actionQueryAllInfo(params) });
        return;
      case "dom.batchQuery":
        sendResponse({ result: actionBatchQuery(params) });
        return;
      case "dom.boundingBox":
        sendResponse({ result: actionBoundingBox(params) });
        return;
      case "dom.mouseMoveTo":
        actionMouseMoveTo(params)
          .then((r) => sendResponse({ result: r }))
          .catch((e) => sendResponse({ error: e.message }));
        return true; // async
      case "dom.click":
        actionHumanClick(params)
          .then((r) => sendResponse({ result: r }))
          .catch((e) => sendResponse({ error: e.message }));
        return true; // async
      case "dom.type":
        sendResponse({ result: actionType(params) });
        return;
      case "dom.keyPress":
        sendResponse({ result: actionKeyPress(params) });
        return;
      case "dom.keyDown":
        sendResponse({ result: actionKeyDown(params) });
        return;
      case "dom.keyUp":
        sendResponse({ result: actionKeyUp(params) });
        return;
      case "dom.scroll":
        sendResponse({ result: actionScroll(params) });
        return;
      case "dom.focus":
        sendResponse({ result: actionFocus(params) });
        return;
      case "dom.setValue":
        sendResponse({ result: actionSetValue(params) });
        return;
      case "dom.getAttribute":
        sendResponse({ result: actionGetAttribute(params) });
        return;
      case "dom.getProperty":
        sendResponse({ result: actionGetProperty(params) });
        return;
      case "dom.getHTML":
        // CSP-safe HTML retrieval from ISOLATED world
        sendResponse({
          result: {
            html: document.documentElement?.outerHTML || "",
            title: document.title || "",
            url: location?.href || ""
          }
        });
        return;
      case "dom.elementHTML": {
        // CSP-safe: get outerHTML/innerHTML of a specific handle
        const ehEl = resolveElement(params);
        sendResponse({
          result: {
            outer: ehEl.outerHTML.slice(0, params.limit || 5000),
            inner: ehEl.innerHTML.slice(0, params.limit || 5000),
            tag: ehEl.tagName.toLowerCase(),
          }
        });
        return;
      }
      case "dom.findScrollable": {
        // Find all scrollable containers on the page
        const scrollables = [];
        const all = document.querySelectorAll('*');
        for (const el of all) {
          if (el.scrollHeight > el.clientHeight + 20 && el !== document.documentElement && el !== document.body) {
            const style = getComputedStyle(el);
            const oy = style.overflowY;
            const ox = style.overflow;
            if (oy === 'visible' && ox === 'visible') continue; // skip non-scrollable
            const hid = storeHandle(el);
            scrollables.push({
              handleId: hid,
              tag: el.tagName.toLowerCase(),
              id: el.id || null,
              cls: [...el.classList].slice(0, 3).join(' ') || null,
              overflowY: oy,
              overflow: ox,
              scrollHeight: el.scrollHeight,
              clientHeight: el.clientHeight,
              children: el.children.length,
              text: (el.textContent || '').trim().slice(0, 80),
            });
          }
        }
        sendResponse({ result: scrollables });
        return;
      }
      case "dom.waitForSelector":
        actionWaitForSelector(params, sendResponse);
        return true; // async
      case "dom.evaluate":
      case "dom.evaluateViaScript": {
        // Inject inline <script> to run in MAIN world (works with 'unsafe-inline' CSP)
        const callId =
          "_hb_" + Date.now() + "_" + Math.floor(Math.random() * 1e6);
        const resultEl = document.createElement("div");
        resultEl.id = callId;
        resultEl.style.display = "none";
        document.documentElement.appendChild(resultEl);

        const argsJson = JSON.stringify(params.args || []);
        let markerSetup = "";
        if (params.markerId) {
          markerSetup = `var __el = document.querySelector('[data-bridge-eval="${params.markerId}"]');
            if (__el) __el.removeAttribute('data-bridge-eval');`;
        }

        const script = document.createElement("script");
        script.textContent = `(function(){
          try {
            ${markerSetup}
            var __fn = (${params.fn});
            var __args = ${argsJson};
            ${params.markerId ? "if (__el) __args.unshift(__el);" : ""}
            var __r = __fn.apply(null, __args);
            if (__r && typeof __r.then === 'function') {
              __r.then(function(v) {
                document.getElementById('${callId}').setAttribute('data-result', JSON.stringify({v:v}));
              }).catch(function(e) {
                document.getElementById('${callId}').setAttribute('data-error', e.message || String(e));
              });
            } else {
              document.getElementById('${callId}').setAttribute('data-result', JSON.stringify({v:__r}));
            }
          } catch(e) {
            document.getElementById('${callId}').setAttribute('data-error', e.message || String(e));
          }
        })();`;
        document.documentElement.appendChild(script);
        script.remove();

        // Check result — sync scripts already set data-result before we get here.
        // Async scripts: use MutationObserver for instant notification (no 50ms polling).
        const pollForResult = (resolve) => {
          const el = document.getElementById(callId);
          if (!el) {
            resolve({ error: "Result element removed" });
            return;
          }

          const harvest = () => {
            const resultAttr = el.getAttribute("data-result");
            if (resultAttr !== null) {
              el.remove();
              try {
                resolve({ result: JSON.parse(resultAttr).v });
              } catch {
                resolve({ result: resultAttr });
              }
              return true;
            }
            const errorAttr = el.getAttribute("data-error");
            if (errorAttr !== null) {
              el.remove();
              resolve({ error: errorAttr });
              return true;
            }
            return false;
          };

          // Instant path: synchronous scripts already wrote the result
          if (harvest()) return;

          // Async path: observe attribute changes on the result element
          const observer = new MutationObserver(() => {
            if (harvest()) {
              observer.disconnect();
              clearTimeout(timer);
            }
          });
          observer.observe(el, {
            attributes: true,
            attributeFilter: ["data-result", "data-error"],
          });

          const timer = setTimeout(() => {
            observer.disconnect();
            el.remove();
            resolve({ error: "Evaluate timed out" });
          }, 5000);
        };

        new Promise(pollForResult).then((res) => {
          if (res.error) sendResponse({ error: res.error });
          else sendResponse({ result: res.result });
        });
        return true; // async
      }
      case "dom.elementEvaluate": {
        // Route through dom.evaluateViaScript with markerId
        // First mark the element, then run evaluate
        const el = getHandle(params.handleId);
        const markerId =
          "_hbm_" + Date.now() + "_" + Math.floor(Math.random() * 1e6);
        el.setAttribute("data-bridge-eval", markerId);

        const callId =
          "_hb_" + Date.now() + "_" + Math.floor(Math.random() * 1e6);
        const resultEl = document.createElement("div");
        resultEl.id = callId;
        resultEl.style.display = "none";
        document.documentElement.appendChild(resultEl);

        const argsJson = JSON.stringify(params.args || []);
        const script = document.createElement("script");
        script.textContent = `(function(){
          try {
            var __el = document.querySelector('[data-bridge-eval="${markerId}"]');
            if (__el) __el.removeAttribute('data-bridge-eval');
            var __fn = (${params.fn});
            var __args = ${argsJson};
            var __r = __fn.apply(null, [__el].concat(__args));
            if (__r && typeof __r.then === 'function') {
              __r.then(function(v) {
                document.getElementById('${callId}').setAttribute('data-result', JSON.stringify({v:v}));
              }).catch(function(e) {
                document.getElementById('${callId}').setAttribute('data-error', e.message || String(e));
              });
            } else {
              document.getElementById('${callId}').setAttribute('data-result', JSON.stringify({v:__r}));
            }
          } catch(e) {
            document.getElementById('${callId}').setAttribute('data-error', e.message || String(e));
          }
        })();`;
        document.documentElement.appendChild(script);
        script.remove();

        const pollForResult2 = (resolve) => {
          const el = document.getElementById(callId);
          if (!el) {
            resolve({ error: "Result element removed" });
            return;
          }

          const harvest = () => {
            const resultAttr = el.getAttribute("data-result");
            if (resultAttr !== null) {
              el.remove();
              try {
                resolve({ result: JSON.parse(resultAttr).v });
              } catch {
                resolve({ result: resultAttr });
              }
              return true;
            }
            const errorAttr = el.getAttribute("data-error");
            if (errorAttr !== null) {
              el.remove();
              resolve({ error: errorAttr });
              return true;
            }
            return false;
          };

          if (harvest()) return;

          const observer = new MutationObserver(() => {
            if (harvest()) {
              observer.disconnect();
              clearTimeout(timer);
            }
          });
          observer.observe(el, {
            attributes: true,
            attributeFilter: ["data-result", "data-error"],
          });

          const timer = setTimeout(() => {
            observer.disconnect();
            el.remove();
            resolve({ error: "Evaluate timed out" });
          }, 5000);
        };

        new Promise(pollForResult2).then((res) => {
          if (res.error) sendResponse({ error: res.error });
          else sendResponse({ result: res.result });
        });
        return true; // async
      }
      case "dom.evaluateIsolated": {
        // CSP-safe evaluation in ISOLATED world (content script context)
        // Limited to DOM access, cannot access page JS globals
        try {
          const fn = new Function("return (" + params.fn + ")")();
          const result = fn.apply(null, params.args || []);
          sendResponse({ result });
        } catch (e) {
          sendResponse({ error: e.message });
        }
        return;
      }
      case "dom.discoverElements": {
        // CSP-safe element discovery — no eval needed
        const results = [];
        const seen = new Set();
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        // Helper: find a safe CSS class (no special chars like : [ ] ( ) )
        function safeClass(el) {
          for (const cls of el.classList) {
            if (/^[a-zA-Z_-][a-zA-Z0-9_-]*$/.test(cls)) return cls;
          }
          return null;
        }

        // Links
        for (const el of document.querySelectorAll("a[href]")) {
          const href = el.href || "";
          const text = (el.textContent || "").trim().slice(0, 80);
          if (!text || seen.has(href + text)) continue;
          seen.add(href + text);
          const rect = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          if (
            rect.width <= 0 ||
            rect.height <= 0 ||
            cs.display === "none" ||
            cs.visibility === "hidden"
          )
            continue;
          const sc = safeClass(el);
          const rawHref = el.getAttribute("href") || "";
          const selector = el.id
            ? `a#${el.id}`
            : sc
              ? `a.${sc}`
              : rawHref
                ? `a[href="${rawHref.replace(/"/g, '\\"')}"]`
                : "a";
          results.push({
            type: "link",
            tag: "a",
            text,
            href,
            selector,
            handleId: storeHandle(el),
            rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
          });
        }

        // Buttons
        for (const el of document.querySelectorAll('button, [role="button"]')) {
          const text = (el.textContent || "").trim().slice(0, 80);
          const rect = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          if (rect.width <= 0 || rect.height <= 0 || cs.display === "none")
            continue;
          const tag = el.tagName.toLowerCase();
          const sc = safeClass(el);
          const selector = el.id ? `#${el.id}` : sc ? `${tag}.${sc}` : tag;
          results.push({
            type: "button",
            tag,
            text,
            selector,
            handleId: storeHandle(el),
            rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
          });
        }

        // Inputs / textareas
        for (const el of document.querySelectorAll(
          'input, textarea, [contenteditable="true"]',
        )) {
          const rect = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          if (rect.width <= 0 || rect.height <= 0 || cs.display === "none")
            continue;
          const inputType = el.type || el.tagName.toLowerCase();
          if (
            ["hidden", "submit", "button", "image", "reset"].includes(inputType)
          )
            continue;
          const tag = el.tagName.toLowerCase();
          const selector = el.id
            ? `#${el.id}`
            : el.name
              ? `${tag}[name="${el.name}"]`
              : el.placeholder
                ? `${tag}[placeholder="${el.placeholder}"]`
                : tag;
          results.push({
            type: "input",
            tag,
            inputType,
            name: el.name || "",
            placeholder: el.placeholder || "",
            selector,
            handleId: storeHandle(el),
            rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
          });
        }

        sendResponse({
          result: {
            elements: results,
            cursor: { x: cursorX, y: cursorY },
            viewport: { width: vw, height: vh },
            scrollY: window.scrollY,
          },
        });
        return;
      }
      case "dom.setDebug":
        debugMode = !!params.enabled;
        frameworkRuntime.debug.cursor = debugMode;
        if (!debugMode) clearTrail();
        sendResponse({ result: { debug: debugMode } });
        return;

      // Human commands — safe, human-like actions with timing + detection
      case "human.click":
        actionHumanClick(params)
          .then((r) => sendResponse({ result: r }))
          .catch((e) => sendResponse({ error: e.message }));
        return true; // async
      case "human.type":
        actionHumanType(params)
          .then((r) => sendResponse({ result: r }))
          .catch((e) => sendResponse({ error: e.message }));
        return true; // async
      case "human.scroll":
        actionHumanScroll(params)
          .then((r) => sendResponse({ result: r }))
          .catch((e) => sendResponse({ error: e.message }));
        return true; // async
      case "human.clearInput":
        actionHumanClearInput(params)
          .then((r) => sendResponse({ result: r }))
          .catch((e) => sendResponse({ error: e.message }));
        return true; // async

      default:
        sendResponse({ error: `Unknown action: ${action}` });
    }
  } catch (err) {
    sendResponse({ error: err.message });
  }
});
