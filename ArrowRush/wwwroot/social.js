"use strict";

// Профили и друзья: экран профиля (свой можно редактировать), поиск игроков и заявки в друзья.
// Всё, что написал игрок (ник, «о себе»), выводится только через textContent.
const social = (() => {
  const $ = (id) => document.getElementById(id);
  const ABOUT_MAX = 160;

  let o = null;         // { api, show, me — текущий профиль, refresh — перечитать его, historyItem }
  let shown = null;     // открытый профиль: ответ сервера
  let backTo = "menu";  // куда ведёт «Назад» из профиля
  let pickedColor = null;
  let searchTimer = 0;

  /** Кружок с первой буквой ника. */
  function paintAvatar(el, name, color) {
    el.textContent = name.slice(0, 1).toUpperCase();
    el.style.background = color;
  }

  /** Запрос к API друзей; ошибку показывает в строке el. */
  async function call(path, userName, el) {
    el.textContent = "";
    try {
      const r = await o.api("POST", path, { userName });
      if (!r.ok) el.textContent = (r.data && r.data.error) || "Не получилось, попробуй ещё раз";
      return r.ok;
    } catch {
      el.textContent = "Сервер недоступен";
      return false;
    }
  }

  function button(text, cls, onClick) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `btn small ${cls}`;
    b.textContent = text;
    b.addEventListener("click", onClick);
    return b;
  }

  // ---------- Профиль ----------

  /** Открывает профиль игрока; from — экран, куда вернётся «Назад». */
  async function open(name, from) {
    backTo = from;
    $("pf-error").textContent = "";
    stopEdit(); // могли уйти отсюда кнопкой «Назад», не закончив правку
    try {
      const r = await o.api("GET", "players/" + encodeURIComponent(name));
      if (!r.ok) {
        if (from === "friends") $("friend-error").textContent = (r.data && r.data.error) || "Не получилось открыть профиль";
        return;
      }
      shown = r.data;
    } catch {
      return;
    }
    render();
    o.show("profile");
  }

  function render() {
    const p = shown;
    paintAvatar($("pf-avatar"), p.userName, p.color);
    $("pf-name").textContent = p.userName;
    $("pf-joined").textContent = "В игре с " + new Date(p.joined).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
    $("pf-about").textContent = p.about || (p.relation === "self" ? "Расскажи о себе: нажми «Редактировать»" : "");
    $("pf-about").classList.toggle("empty", !p.about);
    course.paintHero($("pf-hero"), p.hero);
    renderActions();

    const stats = $("pf-stats");
    stats.innerHTML = "";
    const rate = p.games ? Math.round((p.wins / p.games) * 100) : "—";
    for (const [value, label] of [[p.games, "матчей"], [p.wins, "побед"], [rate, "% побед"], [p.bestStreak, "лучшая серия"], [p.sliders, "ползунков"], [p.friends, "друзей"]]) {
      const tile = document.createElement("div");
      tile.className = "stat";
      const num = document.createElement("b");
      num.textContent = value;
      const name = document.createElement("span");
      name.textContent = label;
      tile.append(num, name);
      stats.appendChild(tile);
    }

    const list = $("pf-list");
    list.innerHTML = "";
    p.recent.forEach((m, i) => list.appendChild(o.historyItem(m, i)));
    $("pf-history").hidden = p.recent.length === 0;
  }

  /** Кнопки под ником зависят от того, кем игрок тебе приходится. */
  function renderActions() {
    const box = $("pf-actions");
    box.innerHTML = "";
    const act = (path) => async () => {
      if (await call(path, shown.userName, $("pf-error"))) await reload();
    };

    if (shown.relation === "self") {
      box.append(button("Редактировать", "primary", startEdit));
    } else if (shown.relation === "none") {
      box.append(button("Добавить в друзья", "primary", act("friends/request")));
    } else if (shown.relation === "outgoing") {
      const sent = button("Заявка отправлена", "ghost", () => {});
      sent.disabled = true;
      box.append(sent, button("Отменить", "ghost", act("friends/remove")));
    } else if (shown.relation === "incoming") {
      box.append(button("Принять заявку", "primary", act("friends/accept")), button("Отклонить", "ghost", act("friends/remove")));
    } else {
      // случайное нажатие не должно стоить дружбы: удаляем со второго раза
      const remove = button("Удалить из друзей", "ghost", () => {
        if (remove.dataset.sure) return act("friends/remove")();
        remove.dataset.sure = "1";
        remove.textContent = "Точно удалить?";
      });
      const label = button("В друзьях", "ghost", () => {});
      label.disabled = true;
      box.append(label, remove);
    }
  }

  /** Перечитывает открытый профиль: заявка могла измениться. */
  async function reload() {
    if (!shown) return;
    try {
      const r = await o.api("GET", "players/" + encodeURIComponent(shown.userName));
      if (r.ok) { shown = r.data; render(); }
    } catch { /* покажем то, что уже есть */ }
  }

  // ---------- Редактирование ----------

  function startEdit() {
    const me = o.me();
    $("pf-edit").hidden = false;
    $("pf-actions").hidden = true;
    $("pf-about").hidden = true;
    $("pf-edit-name").value = me.userName;
    $("pf-edit-about").value = me.about || "";
    pickedColor = me.color;
    renderCount();
    renderColors(me.avatarColors);
    $("pf-edit-name").focus();
  }

  function stopEdit() {
    $("pf-edit").hidden = true;
    $("pf-actions").hidden = false;
    $("pf-about").hidden = false;
    $("pf-edit-error").textContent = "";
  }

  function renderCount() {
    $("pf-edit-count").textContent = `${$("pf-edit-about").value.length} / ${ABOUT_MAX}`;
  }

  function renderColors(colors) {
    const box = $("pf-edit-colors");
    box.innerHTML = "";
    for (const color of colors) {
      const swatch = document.createElement("button");
      swatch.type = "button";
      swatch.className = "swatch" + (color === pickedColor ? " on" : "");
      swatch.style.background = color;
      swatch.setAttribute("aria-label", "Цвет " + color);
      swatch.setAttribute("aria-pressed", color === pickedColor);
      swatch.addEventListener("click", () => { pickedColor = color; renderColors(colors); });
      box.appendChild(swatch);
    }
  }

  async function saveEdit(e) {
    e.preventDefault();
    const err = $("pf-edit-error"), save = $("pf-edit-save");
    err.textContent = "";
    save.disabled = true;
    try {
      const r = await o.api("POST", "profile", {
        userName: $("pf-edit-name").value.trim(),
        about: $("pf-edit-about").value,
        color: pickedColor,
      });
      if (!r.ok) { err.textContent = (r.data && r.data.error) || "Не получилось сохранить"; return; }
      shown.userName = r.data.userName; // ник мог смениться — перечитываем уже по новому
      await Promise.all([o.refresh(), reload()]);
      stopEdit();
    } catch {
      err.textContent = "Сервер недоступен";
    } finally {
      save.disabled = false;
    }
  }

  // ---------- Друзья ----------

  async function openFriends() {
    $("friend-error").textContent = "";
    $("friend-search").value = "";
    $("search-list").innerHTML = "";
    o.show("friends");
    await loadFriends();
  }

  /** Строка с игроком: аватар, ник (открывает профиль) и кнопки. */
  function personRow(p, ...buttons) {
    const li = document.createElement("li");
    li.className = "person";
    const avatar = document.createElement("span");
    avatar.className = "avatar";
    paintAvatar(avatar, p.userName, p.color);
    const name = document.createElement("button");
    name.type = "button";
    name.className = "player-link";
    name.textContent = p.userName;
    name.addEventListener("click", () => open(p.userName, "friends"));
    li.append(avatar, name, ...buttons);
    return li;
  }

  function fillList(id, people, row) {
    $(id).replaceChildren(...people.map(row));
  }

  async function loadFriends() {
    let data;
    try {
      const r = await o.api("GET", "friends");
      if (!r.ok) return;
      data = r.data;
    } catch {
      return;
    }

    const act = (path, p) => async () => {
      if (await call(path, p.userName, $("friend-error"))) {
        await loadFriends();
        o.refresh();
      }
    };

    fillList("incoming-list", data.incoming, (p) => personRow(p,
      button("Принять", "primary", act("friends/accept", p)),
      button("Отклонить", "ghost", act("friends/remove", p))));
    fillList("outgoing-list", data.outgoing, (p) => personRow(p, button("Отменить", "ghost", act("friends/remove", p))));
    fillList("friends-list", data.friends, (p) => personRow(p));

    $("incoming-box").hidden = data.incoming.length === 0;
    $("outgoing-box").hidden = data.outgoing.length === 0;
    $("friends-empty").hidden = data.friends.length > 0;
    setIncoming(data.incoming.length);
  }

  /** Поиск по мере ввода: ждём паузу, устаревший ответ отбрасываем. */
  function onSearch() {
    clearTimeout(searchTimer);
    const q = $("friend-search").value.trim();
    if (q.length < 2) { $("search-list").innerHTML = ""; return; }
    searchTimer = setTimeout(async () => {
      try {
        const r = await o.api("GET", "players?q=" + encodeURIComponent(q));
        if (!r.ok || $("friend-search").value.trim() !== q) return;
        if (r.data.length === 0) {
          const none = document.createElement("li");
          none.className = "muted small";
          none.textContent = "Никого не нашли";
          $("search-list").replaceChildren(none);
        } else {
          fillList("search-list", r.data, (p) => personRow(p));
        }
      } catch { /* попробует при следующем вводе */ }
    }, 250);
  }

  /** Значок входящих заявок на кнопке «Друзья». */
  function setIncoming(n) {
    $("friends-badge").hidden = n === 0;
    $("friends-badge").textContent = n;
  }

  /** Сервер сообщил, что заявки изменились: обновляем то, что сейчас на экране. */
  function changed(screen) {
    if (screen === "friends") loadFriends();
    else if (screen === "profile" && $("pf-edit").hidden) reload();
    o.refresh();
  }

  function init(options) {
    o = options;
    $("btn-profile-back").addEventListener("click", () => {
      if (backTo === "friends") openFriends();
      else o.show(backTo);
    });
    $("btn-friends").addEventListener("click", openFriends);
    $("btn-friends-back").addEventListener("click", () => o.show("menu"));
    $("friend-search").addEventListener("input", onSearch);
    $("pf-edit").addEventListener("submit", saveEdit);
    $("pf-edit-cancel").addEventListener("click", stopEdit);
    $("pf-edit-about").addEventListener("input", renderCount);
  }

  return { init, open, setIncoming, changed, paintAvatar };
})();
