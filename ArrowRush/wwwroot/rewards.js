"use strict";

// Ежедневные и еженедельные награды: кнопки слева внизу, как в CS2, задания — на своём экране по кнопке «Награды».
// Задания, прогресс и звёзды считает сервер (Data/Rewards.cs), здесь только показ и кнопка «Забрать».
const rewards = (() => {
  const $ = (id) => document.getElementById(id);
  const TICK_MS = 20000;

  // значок задания по цели; #id — символ из <svg> в index.html
  const GOAL_ICON = {
    visit: "#play", games: "#target", wins: "#chart", sliders: "#arrow", finishes: "#flame",
    fastgames: "#bolt", hardgames: "#heart", teamgames: "#team", mirrorgames: "#mirror", blindgames: "#eye",
  };

  let o = null;       // { api, show, me — текущий профиль, refresh — перечитать его, skinTile, openSkins(slot) }
  let data = null;    // ответ /api/account/rewards
  let nextSkin = null; // скин на кнопке «За звёзды»

  /** Редкость — цвет задания: чем больше звёзд, тем она выше. */
  function rarity(stars) {
    return stars <= 15 ? "common" : stars <= 30 ? "rare" : stars <= 90 ? "epic" : "legend";
  }

  function timeLeft(iso) {
    const minutes = Math.max(1, Math.ceil((new Date(iso) - Date.now()) / 60000));
    if (minutes < 60) return `${minutes} мин`;
    const hours = Math.floor(minutes / 60);
    return hours >= 24 ? `${Math.floor(hours / 24)} дн ${hours % 24} ч` : `${hours} ч ${minutes % 60} мин`;
  }

  function taskRow(t) {
    const done = t.have >= t.need;
    const li = document.createElement("li");
    li.className = `reward rarity-${rarity(t.stars)}` + (t.claimed ? " claimed" : done ? " ready" : "");

    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("class", "reward-icon");
    icon.setAttribute("aria-hidden", "true");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", GOAL_ICON[t.goal] || "#target");
    icon.appendChild(use);

    const name = document.createElement("span");
    name.className = "reward-name";
    name.textContent = t.name;
    li.append(icon, name);

    if (t.claimed) {
      const got = document.createElement("span");
      got.className = "reward-stars";
      got.textContent = "✓ получено";
      li.appendChild(got);
    } else if (done) {
      const claim = document.createElement("button");
      claim.type = "button";
      claim.className = "reward-claim";
      claim.textContent = `Забрать ${t.stars} ★`;
      claim.addEventListener("click", () => take(t, claim));
      li.appendChild(claim);
    } else {
      const stars = document.createElement("span");
      stars.className = "reward-stars";
      stars.textContent = `+${t.stars} ★`;
      const bar = document.createElement("span");
      bar.className = "reward-bar";
      const fill = document.createElement("i");
      fill.style.width = `${(t.have / t.need) * 100}%`;
      bar.appendChild(fill);
      const count = document.createElement("span");
      count.className = "reward-count";
      count.textContent = `${t.have} / ${t.need}`;
      li.append(stars, bar, count);
    }
    return li;
  }

  const allTasks = () => [...data.day.tasks, ...data.week.tasks];
  const readyCount = () => allTasks().filter((t) => t.have >= t.need && !t.claimed).length;

  /** Обратный отсчёт и подпись на кнопке «Награды». */
  function renderTimes() {
    $("reward-day-reset").textContent = `новые через ${timeLeft(data.day.resetsAt)}`;
    $("reward-week-reset").textContent = `новые через ${timeLeft(data.week.resetsAt)}`;
    $("reward-hint").textContent = readyCount() ? "Можно забрать" : `Новые через ${timeLeft(data.day.resetsAt)}`;
  }

  /** Кнопка «Награды»: сколько заданий закрыто и сколько наград ждёт. */
  function renderSummary() {
    const ready = readyCount();
    $("reward-summary").textContent = `${allTasks().filter((t) => t.claimed).length} из ${allTasks().length}`;
    $("reward-badge").hidden = ready === 0;
    $("reward-badge").textContent = ready;
    $("btn-rewards").classList.toggle("ready", ready > 0);
  }

  /** Кнопка со следующим скином за звёзды; когда открыты все, показывает последний. */
  function renderNext() {
    const skins = o.me().skins.filter((s) => s.by === "stars").sort((a, b) => a.need - b.need);
    const next = skins.find((s) => !s.unlocked);
    const skin = next || skins[skins.length - 1];
    if (!nextSkin || nextSkin.id !== skin.id || nextSkin.slot !== skin.slot) {
      $("reward-next-art").replaceChildren(o.skinTile(skin));
    }
    nextSkin = skin;
    $("reward-next-name").textContent = skin.name;
    $("reward-next-need").textContent = next ? `Собери ${next.need} ★` : "Все награды открыты";
    $("reward-next-bar").style.width = `${Math.min(100, (data.stars / skin.need) * 100)}%`;
  }

  /** Все скины за звёзды по порядку: что уже открыто и что впереди. */
  function renderLadder() {
    const skins = o.me().skins.filter((s) => s.by === "stars").sort((a, b) => a.need - b.need);
    $("reward-ladder").replaceChildren(...skins.map((s) => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "ladder-card" + (s.unlocked ? " open" : "");
      card.addEventListener("click", () => o.openSkins(s.slot));
      const name = document.createElement("span");
      name.className = "ladder-name";
      name.textContent = s.name;
      const need = document.createElement("span");
      need.className = "ladder-need";
      need.textContent = s.unlocked ? "✓ открыт" : `${s.need} ★`;
      card.append(o.skinTile(s), name, need);
      return card;
    }));
  }

  function render() {
    if (!data || !o.me()) return;
    fx.countUp($("reward-stars"), data.stars);
    fx.countUp($("reward-total"), data.stars);
    $("reward-day").replaceChildren(...data.day.tasks.map(taskRow));
    $("reward-week").replaceChildren(...data.week.tasks.map(taskRow));
    renderSummary();
    renderTimes();
    renderNext();
    renderLadder();
  }

  async function load() {
    try {
      const r = await o.api("GET", "rewards");
      if (r.ok) { data = r.data; render(); }
    } catch { /* покажем то, что уже есть */ }
  }

  async function take(task, btn) {
    const err = $("reward-error");
    err.textContent = "";
    btn.disabled = true;
    try {
      const r = await o.api("POST", "rewards/claim", { id: task.id });
      if (!r.ok) {
        err.textContent = (r.data && r.data.error) || "Не получилось забрать награду";
        await load(); // задания могли смениться, пока окно было открыто
        return;
      }
      const [x, y] = fx.anchor(btn);
      fx.burst(x, y, "#ffc93c", 26, 1.1);
      await o.refresh(); // заодно обновит этот блок
    } catch {
      err.textContent = "Сервер недоступен";
      btn.disabled = false;
    }
  }

  const onScreen = () => ["menu", "rewards"].includes(document.body.dataset.screen);

  /** Новый день или неделя наступили: задания надо перечитать. */
  function tick() {
    if (!data || !onScreen()) return;
    if (Date.now() >= new Date(data.day.resetsAt)) load();
    else renderTimes();
  }

  function init(options) {
    o = options;
    $("btn-rewards").addEventListener("click", () => o.show("rewards"));
    $("btn-rewards-back").addEventListener("click", () => o.show("menu"));
    $("btn-reward-next").addEventListener("click", () => { if (nextSkin) o.openSkins(nextSkin.slot); });
    addEventListener("keydown", (e) => {
      if (e.code === "Escape" && document.body.dataset.screen === "rewards") o.show("menu");
    });
    setInterval(tick, TICK_MS);
    // вкладка могла простоять в фоне всю ночь
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && data && onScreen()) load();
    });
  }

  return { init, load };
})();
