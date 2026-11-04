"use strict";

// Цветовая палитра для редактора: поле насыщенности и яркости, полоса оттенка, HEX-код, готовые и недавние цвета.
// colorpick.create({ value, none, onInput }) → { el, set(value) }.
//   value — "#rrggbb" или null; none — подпись кнопки «без цвета» (null), если такой выбор нужен;
//   onInput(value) зовётся на каждое изменение, в том числе во время перетаскивания.
const colorpick = (() => {
  const PRESETS = [
    "#ffffff", "#c9c3dc", "#8a8399", "#4a4360", "#1d1340", "#000000",
    "#ff3b5c", "#ff4f9a", "#ff8a3d", "#ffb31f", "#ffe14a", "#7ee03a",
    "#2fd39a", "#22c7f0", "#3d7bff", "#8b5cff", "#c86bff", "#c98a4b",
  ];
  const RECENT_KEY = "arrowrush.colors";
  const RECENT_MAX = 12;
  const HEX = /^#[0-9a-f]{6}$/i;

  function hexToHsv(hex) {
    const n = parseInt(hex.slice(1), 16);
    const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h = (h * 60 + 360) % 360;
    }
    return { h, s: max ? d / max : 0, v: max };
  }

  function hsvToHex({ h, s, v }) {
    const f = (n) => {
      const k = (n + h / 60) % 6;
      return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
    };
    return "#" + [f(5), f(3), f(1)].map((x) => Math.round(x * 255).toString(16).padStart(2, "0")).join("");
  }

  function loadRecent() {
    try {
      const list = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
      return Array.isArray(list) ? list.filter((c) => HEX.test(c)).slice(0, RECENT_MAX) : [];
    } catch {
      return [];
    }
  }

  function remember(hex) {
    if (!HEX.test(hex || "")) return;
    const list = [hex.toLowerCase(), ...loadRecent().filter((c) => c !== hex.toLowerCase())].slice(0, RECENT_MAX);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(list));
    } catch { /* хранилище недоступно — недавние живут до перезагрузки */ }
    // палитры, которых уже нет на странице (панель пересобрали), просто забываем
    for (const p of [...listeners]) {
      if (p.root.isConnected) p.fn(list);
      else listeners.delete(p);
    }
  }
  const listeners = new Set(); // { root, fn } — открытые палитры, им обновляют «Недавние»

  function el(tag, cls) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  }

  /** Перетаскивание по элементу: fn(доля x 0..1, доля y 0..1) на нажатие и каждое движение, done — на отпускание. */
  function dragOn(target, fn, done) {
    target.addEventListener("pointerdown", (e) => {
      if (e.button > 0) return;
      e.preventDefault();
      try { target.setPointerCapture(e.pointerId); } catch { /* синтетическое событие */ }
      const at = (ev) => {
        const r = target.getBoundingClientRect();
        fn(Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height)));
      };
      at(e);
      const move = (ev) => at(ev);
      const up = () => {
        target.removeEventListener("pointermove", move);
        target.removeEventListener("pointerup", up);
        target.removeEventListener("pointercancel", up);
        done();
      };
      target.addEventListener("pointermove", move);
      target.addEventListener("pointerup", up);
      target.addEventListener("pointercancel", up);
    });
  }

  function create({ value, none, onInput }) {
    let hsv = hexToHsv(HEX.test(value || "") ? value : "#ffffff");
    let current = HEX.test(value || "") ? value.toLowerCase() : null;

    const root = el("div", "cp");
    const sv = el("div", "cp-sv");
    const svDot = el("i", "cp-sv-dot");
    sv.append(svDot);
    const hue = el("div", "cp-hue");
    const hueDot = el("i", "cp-hue-dot");
    hue.append(hueDot);

    const row = el("div", "cp-row");
    const preview = el("span", "cp-preview");
    const hex = el("input", "cp-hex");
    hex.maxLength = 7;
    hex.spellcheck = false;
    hex.autocomplete = "off";
    hex.setAttribute("aria-label", "Цвет в HEX");
    row.append(preview, hex);
    let noneBtn = null;
    if (none) {
      noneBtn = el("button", "cp-none");
      noneBtn.type = "button";
      noneBtn.textContent = none;
      noneBtn.addEventListener("click", () => {
        current = null;
        paint();
        onInput(null);
      });
      row.append(noneBtn);
    }

    const swatches = (list, cls) => {
      const box = el("div", "cp-swatches " + cls);
      box.replaceChildren(...list.map((c) => {
        const b = el("button", "cp-swatch");
        b.type = "button";
        b.style.background = c;
        b.title = c;
        b.dataset.c = c;
        b.addEventListener("click", () => pick(c, true));
        return b;
      }));
      return box;
    };
    const presets = swatches(PRESETS, "cp-presets");
    const recentLabel = el("span", "cp-label");
    recentLabel.textContent = "Недавние";
    let recent = swatches(loadRecent(), "cp-recent");
    const onRecent = (list) => {
      const fresh = swatches(list, "cp-recent");
      recent.replaceWith(fresh);
      recent = fresh;
      recentLabel.hidden = !list.length;
      mark();
    };
    recentLabel.hidden = !loadRecent().length;

    root.append(sv, hue, row, presets, recentLabel, recent);
    listeners.add({ root, fn: onRecent });

    function mark() {
      for (const b of root.querySelectorAll(".cp-swatch")) b.classList.toggle("on", b.dataset.c === current);
    }

    /** Показать текущий цвет: фон поля по оттенку, точки, превью, код. */
    function paint() {
      sv.style.setProperty("--hue", hsvToHex({ h: hsv.h, s: 1, v: 1 }));
      svDot.style.left = hsv.s * 100 + "%";
      svDot.style.top = (1 - hsv.v) * 100 + "%";
      hueDot.style.left = (hsv.h / 360) * 100 + "%";
      preview.style.background = current || "transparent";
      preview.classList.toggle("empty", !current);
      if (document.activeElement !== hex) hex.value = current || "";
      if (noneBtn) noneBtn.classList.toggle("on", !current);
      mark();
    }

    function pick(c, commit) {
      current = c.toLowerCase();
      hsv = hexToHsv(current);
      paint();
      onInput(current);
      if (commit) remember(current);
    }

    function fromHsv() {
      current = hsvToHex(hsv);
      paint();
      onInput(current);
    }

    dragOn(sv, (x, y) => { hsv = { ...hsv, s: x, v: 1 - y }; fromHsv(); }, () => remember(current));
    dragOn(hue, (x) => { hsv = { ...hsv, h: Math.min(359.9, x * 360) }; fromHsv(); }, () => remember(current));
    hex.addEventListener("input", () => {
      let v = hex.value.trim();
      if (v && v[0] !== "#") v = "#" + v;
      if (HEX.test(v)) pick(v, false);
    });
    hex.addEventListener("change", () => {
      if (current) remember(current);
      hex.value = current || "";
    });

    paint();

    return {
      el: root,
      set(v) {
        current = HEX.test(v || "") ? v.toLowerCase() : null;
        if (current) hsv = hexToHsv(current);
        paint();
      },
    };
  }

  return { create, hexToHsv, hsvToHex };
})();
