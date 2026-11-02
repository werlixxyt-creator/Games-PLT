"use strict";

// Друзья и профиль: кнопки в правом верхнем углу открывают панель под ними.
// В ней поиск игроков, заявки и друзья, там же открывается профиль (свой можно редактировать).
// Всё, что написал игрок (ник, «о себе»), выводится только через textContent.
const social = (() => {
  const $ = (id) => document.getElementById(id);
  const ABOUT_MAX = 160;
  const STACK_SIZE = 4;  // сколько аватаров друзей видно на кнопке

  let o = null;         // { api, me — текущий профиль, refresh — перечитать его, historyItem }
  let shown = null;     // открытый профиль: ответ сервера, null — виден список друзей
  let pickedColor = null;
  let searchTimer = 0;
  let incoming = 0;     // заявок в друзья
  let invites = [];     // приглашений в лобби

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

  // ---------- Панель ----------

  const isOpen = () => $("panel").classList.contains("open");

  function setOpen(on) {
    $("panel").classList.toggle("open", on);
  }

  /** Показывает список друзей вместо профиля. */
  function showList() {
    stopEdit();
    shown = null;
    $("panel-profile").hidden = true;
    $("panel-list").hidden = false;
  }

  /** Закрывает панель. */
  function close() {
    clearTimeout(searchTimer);
    setOpen(false);
    showList();
    $("friend-search").value = "";
    $("search-list").innerHTML = "";
    $("friend-error").textContent = "";
  }

  // ---------- Профиль ----------

  /** Открывает профиль игрока прямо в панели. */
  async function open(name) {
    $("pf-error").textContent = "";
    $("friend-error").textContent = "";
    stopEdit();
    setOpen(true);
    try {
      const r = await o.api("GET", "players/" + encodeURIComponent(name));
      if (!r.ok) {
        showList();
        $("friend-error").textContent = (r.data && r.data.error) || "Не получилось открыть профиль";
        return;
      }
      shown = r.data;
    } catch {
      $("friend-error").textContent = "Сервер недоступен";
      return;
    }
    render();
    $("panel-list").hidden = true;
    $("panel-profile").hidden = false;
    $("panel").scrollTop = 0;
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
      if (await call(path, shown.userName, $("pf-error"))) await Promise.all([reload(), loadFriends()]);
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
      if (r.ok && shown) { shown = r.data; render(); }
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

  /** Строка с игроком: аватар и ник открывают профиль, справа кнопки. */
  function personRow(p, ...buttons) {
    const li = document.createElement("li");
    li.className = "person";
    const avatar = document.createElement("button");
    avatar.type = "button";
    avatar.className = "avatar";
    avatar.title = p.userName;
    paintAvatar(avatar, p.userName, p.color);
    avatar.addEventListener("click", () => open(p.userName));
    const name = document.createElement("button");
    name.type = "button";
    name.className = "player-link";
    name.textContent = p.userName;
    name.addEventListener("click", () => open(p.userName));
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
      if (await call(path, p.userName, $("friend-error"))) await loadFriends();
    };

    fillList("incoming-list", data.incoming, (p) => personRow(p,
      button("Принять", "primary", act("friends/accept", p)),
      button("Нет", "ghost", act("friends/remove", p))));
    fillList("outgoing-list", data.outgoing, (p) => personRow(p, button("Отменить", "ghost", act("friends/remove", p))));
    fillList("friends-list", data.friends, (p) => personRow(p, ...inviteButton(p)));

    $("incoming-box").hidden = data.incoming.length === 0;
    $("outgoing-box").hidden = data.outgoing.length === 0;
    $("friends-empty").hidden = data.friends.length > 0;
    $("friend-stack").replaceChildren(...data.friends.slice(0, STACK_SIZE).map((p) => {
      const avatar = document.createElement("span");
      avatar.className = "avatar";
      paintAvatar(avatar, p.userName, p.color);
      return avatar;
    }));
    incoming = data.incoming.length;
    renderBadge();
  }

  function renderBadge() {
    for (const badge of document.querySelectorAll(".friends-badge")) {
      badge.hidden = incoming + invites.length === 0;
      badge.textContent = incoming + invites.length;
    }
  }

  /** Лидер лобби зовёт друга кнопкой в списке. */
  function inviteButton(p) {
    if (!lobby.canInvite()) return [];
    const b = button("Пригласить", "primary", async () => {
      b.disabled = true;
      if (await lobby.invite(p.userName, $("friend-error"))) b.textContent = "Отправлено";
      else b.disabled = false;
    });
    return [b];
  }

  /** Приглашения в лобби: список в панели остаётся и после того, как вывеска скрылась. */
  function setInvites(list) {
    invites = list;
    $("invite-box").hidden = list.length === 0;
    $("invite-list").replaceChildren(...list.map((invite) => {
      const li = document.createElement("li");
      li.className = "person";
      const text = document.createElement("span");
      text.className = "invite-from";
      text.textContent = `${invite.from} · ${invite.total} из ${invite.max}`;
      li.append(text,
        button("Войти", "primary", async () => { if (await lobby.accept(invite.id, $("friend-error"))) close(); }),
        button("Нет", "ghost", () => lobby.decline(invite.id)));
      return li;
    }));
    renderBadge();
  }

  /** Открывает список друзей: кнопка «Пригласить» в лобби. */
  function openList() {
    showList();
    setOpen(true);
  }

  /** Строка списка игроков: кнопка зависит от того, кем игрок тебе приходится. */
  function searchRow(p) {
    const act = (path) => async () => {
      if (await call(path, p.userName, $("friend-error"))) await Promise.all([loadFriends(), loadPlayers()]);
    };
    const label = (text) => {
      const b = button(text, "ghost", () => {});
      b.disabled = true;
      return b;
    };
    if (p.relation === "none") return personRow(p, button("Добавить", "primary", act("friends/request")));
    if (p.relation === "incoming") return personRow(p, button("Принять", "primary", act("friends/accept")));
    return personRow(p, label(p.relation === "friends" ? "В друзьях" : "Заявка отправлена"));
  }

  function note(text) {
    const li = document.createElement("li");
    li.className = "muted small";
    li.textContent = text;
    return li;
  }

  /** Список игроков: все зарегистрированные или те, чей ник начинается с введённого. Устаревший ответ отбрасываем. */
  async function loadPlayers() {
    const q = $("friend-search").value.trim();
    try {
      const r = await o.api("GET", "players?q=" + encodeURIComponent(q));
      if (!r.ok || !isOpen() || $("friend-search").value.trim() !== q) return;
      const rows = r.data.players.map(searchRow);
      if (rows.length === 0) rows.push(note("Никого не нашли"));
      if (r.data.more) rows.push(note("Показаны не все: продолжи вводить ник"));
      $("search-list").replaceChildren(...rows);
    } catch { /* попробует при следующем вводе */ }
  }

  /** Ждём паузу в наборе. */
  function onSearch() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(loadPlayers, 250);
  }

  /** Сервер сообщил, что заявки изменились. */
  function changed() {
    loadFriends();
    if ($("search-list").childElementCount > 0) loadPlayers();
    if ($("pf-edit").hidden) reload();
  }

  function init(options) {
    o = options;
    // клик мимо панели и Esc закрывают её
    addEventListener("pointerdown", (e) => {
      if (isOpen() && !$("panel").contains(e.target) && !$("top-right").contains(e.target)) close();
    });
    addEventListener("keydown", (e) => {
      if (e.code === "Escape" && isOpen()) close();
    });

    $("panel-toggle").addEventListener("click", () => {
      if (isOpen() && !shown) return close();
      openList();
    });
    $("panel-close").addEventListener("click", close);
    $("btn-my-profile").addEventListener("click", () => open(o.me().userName));
    $("btn-profile-back").addEventListener("click", showList);
    $("friend-search").addEventListener("input", onSearch);
    $("friend-search").addEventListener("focus", loadPlayers);
    $("pf-edit").addEventListener("submit", saveEdit);
    $("pf-edit-cancel").addEventListener("click", stopEdit);
    $("pf-edit-about").addEventListener("input", renderCount);
  }

  return { init, open, openList, close, loadFriends, setInvites, changed, paintAvatar };
})();
