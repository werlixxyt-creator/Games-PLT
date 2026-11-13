"use strict";

// Настройки игрока: хранятся только в этом браузере (localStorage). Остальные модули читают их на лету
// и подписываются на изменения (settings.on) — менять можно прямо в матче.
const settings = (() => {
  const KEY = "arrowrush.settings";
  const DEFAULTS = {
    volume: 1,      // общая громкость 0..1
    shake: 1,       // тряска и удары камеры 0..1
    flash: 1,       // вспышки на весь экран 0..1
    lite: false,    // упрощённые эффекты: без частиц, тряски и вспышек (как «уменьшить движение» в системе)
    fps: false,     // счётчик кадров в углу
    hitboxes: false, // показать хитбоксы своего персонажа и препятствий
  };
  const systemReduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let values = { ...DEFAULTS };
  try { values = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch { /* приватный режим */ }
  const listeners = [];

  function set(key, value) {
    if (!(key in DEFAULTS) || values[key] === value) return;
    values[key] = value;
    try { localStorage.setItem(KEY, JSON.stringify(values)); } catch { /* ничего */ }
    for (const fn of listeners) fn(key, value);
  }

  return {
    get: (key) => values[key],
    set,
    reset() {
      for (const k of Object.keys(DEFAULTS)) set(k, DEFAULTS[k]);
    },
    on: (fn) => listeners.push(fn),
    /** Без лишнего движения: так просит система или игрок. */
    get reduce() { return systemReduce || values.lite; },
    systemReduce,
  };
})();
