"use strict";

// Ежедневные и еженедельные награды: блок слева в меню, как новости в CS2.
// Прогресс и звёзды считает сервер (Data/Rewards.cs), здесь только показ и кнопка «Забрать».
const rewards = (() => {
  const $ = (id) => document.getElementById(id);

  let o = null;     // { api, refresh — перечитать профиль: звёзды открывают скины }
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
    const stars = document.createElement("span");
    stars.className = "reward-stars";
    stars.textContent = `+${t.stars} ★`;
    li.append(name, stars);

    if (t.claimed) {
      const got = document.createElement("span");
      got.className = "reward-got";
      got.textContent = "✓ получено";
      li.appendChild(got);
    } else if (done) {
      const claim = document.createElement("button");
      claim.type = "button";
      claim.className = "btn primary small";
      claim.textContent = "Забрать";
      claim.addEventListener("click", () => take(t, claim));
      li.appendChild(claim);
    } else {
      const bar = document.createElement("span");
      bar.className = "reward-bar";
      const fill = document.createElement("i");
      fill.style.width = `${(t.have / t.need) * 100}%`;
      const count = document.createElement("b");
      count.textContent = `${t.have} / ${t.need}`;
      bar.append(fill, count);
      li.appendChild(bar);
    }
    return li;
  }

  function render() {
    if (!data) return;
    fx.countUp($("reward-stars"), data.stars);
    $("reward-day").replaceChildren(...data.day.tasks.map(taskRow));
    $("reward-week").replaceChildren(...data.week.tasks.map(taskRow));
    $("reward-day-reset").textContent = resetText(data.day.resetsAt);
    $("reward-week-reset").textContent = resetText(data.week.resetsAt);
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

  function init(options) {
    o = options;
    // пока открыто меню: обновляем обратный отсчёт и новый день, если он наступил
    setInterval(() => {
      if (!data || document.body.dataset.screen !== "menu") return;
      if (Date.now() >= new Date(data.day.resetsAt)) load();
      else render();
    }, 60000);
  }

  return { init, load };
})();
