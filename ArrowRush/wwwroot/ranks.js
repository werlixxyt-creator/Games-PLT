"use strict";

// Ранги по рейтингу, как Game/Ranks.cs на сервере (там же — сколько рейтинга дают за матч).
const ranks = (() => {
  const ALL = [
    { from: 0, id: "bronze", name: "Бронза", color: "#e0884a", dark: "#8a4a1f" },
    { from: 1100, id: "silver", name: "Серебро", color: "#c9d2e6", dark: "#6b7591" },
    { from: 1300, id: "gold", name: "Золото", color: "#ffd84d", dark: "#a8780a" },
    { from: 1500, id: "platinum", name: "Платина", color: "#5fe3d0", dark: "#16806f" },
    { from: 1700, id: "diamond", name: "Алмаз", color: "#7fb4ff", dark: "#2f5fc4" },
    { from: 1900, id: "master", name: "Мастер", color: "#c58bff", dark: "#6a2fb8" },
    { from: 2200, id: "legend", name: "Легенда", color: "#ff5f7e", dark: "#a3123a" },
  ];

  const of = (rating) => ALL.filter((r) => rating >= r.from).pop();
  const next = (rating) => ALL.find((r) => r.from > rating) || null;

  /** Щит ранга: SVG в цветах ранга, у высоких рангов — звёзды. */
  function shield(rank, size = 22) {
    const k = ALL.indexOf(rank);
    const stars = k >= 4 ? k - 3 : 0;
    const starPath = (x) => `<path d="M${x} 6.2l1.1 2.2 2.4.3-1.8 1.7.5 2.4-2.2-1.2-2.2 1.2.5-2.4-1.8-1.7 2.4-.3z" fill="#fff"/>`;
    const xs = stars === 1 ? [12] : stars === 2 ? [9, 15] : [7, 12, 17];
    return `<svg class="rank-shield" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">
      <path d="M12 1.5 21 5v6.5c0 5.4-3.8 9.6-9 11-5.2-1.4-9-5.6-9-11V5z" fill="${rank.dark}"/>
      <path d="M12 3.4 19.2 6.2v5.3c0 4.4-3 7.9-7.2 9.2-4.2-1.3-7.2-4.8-7.2-9.2V6.2z" fill="${rank.color}"/>
      <path d="M12 3.4 19.2 6.2v5.3c0 1-.2 2-.5 2.9L12 7.5 5.3 14.4c-.3-.9-.5-1.9-.5-2.9V6.2z" fill="#fff" opacity=".28"/>
      ${stars ? xs.map(starPath).join("") : `<path d="M8.5 12.5l2.5 2.5 4.5-5" fill="none" stroke="${rank.dark}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`}
    </svg>`;
  }

  /** Значок: щит, название ранга и рейтинг. */
  function badge(rating, { compact = false } = {}) {
    const r = of(rating);
    const el = document.createElement("span");
    el.className = `rank-badge rank-${r.id}` + (compact ? " compact" : "");
    el.style.setProperty("--rank", r.color);
    el.style.setProperty("--rank-dark", r.dark);
    el.innerHTML = `${shield(r)}<b>${r.name}</b><span class="rank-num">${rating}</span>`;
    el.title = `${r.name} · рейтинг ${rating}`;
    return el;
  }

  /** Калибровка: звания ещё нет — щит со знаком вопроса и деления сыгранных матчей. */
  function calibration(games, need, { compact = false } = {}) {
    const el = document.createElement("span");
    el.className = "rank-badge rank-calib" + (compact ? " compact" : "");
    el.style.setProperty("--rank", "#b9b3d6");
    el.style.setProperty("--rank-dark", "#5d5585");
    const pips = Array.from({ length: need }, (_, i) => `<i class="${i < games ? "on" : ""}"></i>`).join("");
    el.innerHTML = `<svg class="rank-shield" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path d="M12 1.5 21 5v6.5c0 5.4-3.8 9.6-9 11-5.2-1.4-9-5.6-9-11V5z" fill="#5d5585"/>
      <path d="M12 3.4 19.2 6.2v5.3c0 4.4-3 7.9-7.2 9.2-4.2-1.3-7.2-4.8-7.2-9.2V6.2z" fill="#b9b3d6"/>
      <text x="12" y="16" text-anchor="middle" font-size="11" font-weight="900" fill="#2b2450">?</text>
    </svg><b>Калибровка</b><span class="rank-num">${games}/${need}</span><span class="calib-pips">${pips}</span>`;
    el.title = `Калибровка: сыграно ${games} из ${need} рейтинговых матчей. После ${need}-го — звание по их итогам`;
    return el;
  }

  /** Значок для профиля: звание или калибровка (calibration — { games, need } от сервера). */
  const of2 = (rating, calib, opt) => (calib ? calibration(calib.games, calib.need, opt) : badge(rating, opt));

  return { all: ALL, of, next, shield, badge, calibration, any: of2 };
})();
