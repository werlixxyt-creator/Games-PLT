"use strict";

// Ежедневные и еженедельные награды: кнопки слева в меню, как в CS2, задания — в окне по кнопке «Награды».
// Прогресс и звёзды считает сервер (Data/Rewards.cs), здесь только показ и кнопка «Забрать».
const rewards = (() => {
  const $ = (id) => document.getElementById(id);

  let o = null;     // { api, me — текущий профиль, refresh — перечитать его, openHeroes — экран персонажей }
  let data = null;  // ответ /api/account/rewards

  function resetText(iso) {
    const hours = Math.max(1, Math.ceil((new Date(iso) - Date.now()) / 3600000));
    return hours > 24 ? `ещё ${Math.ceil(hours / 24)} дн.` : `ещё ${hours} ч`;
  }

  function taskRow(t) {
    const done = t.have >= t.need;
    const li = document.createElement("li");
    li.className = "reward" + (t.claimed ? " claimed" : done ? " ready" : "");

    const name = document.createElement("span");
    name.className = "reward-name";
    name.textContent = t.name;
    li.appendChild(name);

    if (t.claimed) {
      const got = document.createElement("span");
      got.className = "reward-stars";
      got.textContent = "✓";
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

  function renderPeriod(id, period) {
    $(id).replaceChildren(...period.tasks.map(taskRow));
    $(id + "-reset").textContent = resetText(period.resetsAt);
  }

  /** Кнопка «Награды»: сколько заданий закрыто и сколько наград ждёт. */
  function renderSummary() {
    const tasks = [...data.day.tasks, ...data.week.tasks];
    const ready = tasks.filter((t) => t.have >= t.need && !t.claimed).length;
    $("reward-summary").textContent = `${tasks.filter((t) => t.claimed).length} из ${tasks.length}`;
    $("reward-hint").textContent = ready ? "Можно забрать" : `Новые — ${resetText(data.day.resetsAt)}`;
    $("reward-badge").hidden = ready === 0;
    $("reward-badge").textContent = ready;
    $("btn-rewards").classList.toggle("ready", ready > 0);
  }

  /** Кнопка со следующим скином за звёзды; когда открыты все, показывает последний. */
  function renderNext() {
    const skins = o.me().skins.filter((s) => s.by === "stars");
    const next = skins.find((s) => !s.unlocked);
    const skin = next || skins[skins.length - 1];
    course.paintHero($("reward-next-hero"), skin.id);
    $("reward-next-name").textContent = skin.name;
    $("reward-next-need").textContent = next ? `Собери ${next.need} ★` : "Все награды открыты";
    $("reward-next-bar").style.width = `${Math.min(100, (data.stars / skin.need) * 100)}%`;
  }

  function render() {
    if (!data) return;
    fx.countUp($("reward-stars"), data.stars);
    renderPeriod("reward-day", data.day);
    renderPeriod("reward-week", data.week);
    renderSummary();
    renderNext();
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
        btn.disabled = false;
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

  function setWindow(open) {
    $("reward-window").hidden = !open;
    $("btn-rewards").setAttribute("aria-expanded", open);
    $("reward-error").textContent = "";
  }

  function init(options) {
    o = options;
    $("btn-rewards").addEventListener("click", () => setWindow($("reward-window").hidden));
    $("reward-close").addEventListener("click", () => setWindow(false));
    $("btn-reward-next").addEventListener("click", o.openHeroes);
    // клик мимо окна и Esc закрывают его
    addEventListener("pointerdown", (e) => {
      if (!$("reward-window").contains(e.target) && !$("btn-rewards").contains(e.target)) setWindow(false);
    });
    addEventListener("keydown", (e) => {
      if (e.code === "Escape") setWindow(false);
    });
    // пока открыто меню: обновляем обратный отсчёт и новый день, если он наступил
    setInterval(() => {
      if (!data || document.body.dataset.screen !== "menu") return;
      if (Date.now() >= new Date(data.day.resetsAt)) load();
      else render();
    }, 60000);
  }

  return { init, load };
})();
