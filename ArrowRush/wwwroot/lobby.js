"use strict";

// Лобби: лидер настраивает матч, зовёт друзей и ставит ботов, игроки стоят в ряд своими персонажами.
// Всё состояние присылает сервер (MatchManager.Lobby.cs), здесь только показ и вызовы хаба.
// Приглашения — вывеска сверху на несколько секунд и список в панели друзей.
const lobby = (() => {
  const $ = (id) => document.getElementById(id);
  const BANNER_MS = 15000;

  // игроки стоят рядами друг за другом: сколько людей в ряду, по числу игроков
  const ROWS = [{ upTo: 7, perRow: 7 }, { upTo: 21, perRow: 7 }, { upTo: 40, perRow: 10 }];
  const FIG_WIDTH = 0.6;    // ширина бойца к его росту, как в .fig
  const FIG_TALL = 1.16;    // полная высота с головой и ником к росту тела
  const ROW_STEP = 0.61;    // следующий ряд стоит выше на такую долю роста: 1,16 минус наезд из .fig

  const THEMES = [
    ["auto", "Случайный", "conic-gradient(#ff4f9a, #ffb31f, #7ee03a, #22c7f0, #ff4f9a)"],
    ["violet", "Фиолетовый", "#5a3ae8"], ["ocean", "Океан", "#1064a8"], ["neon", "Неон", "#ff50dc"], ["night", "Ночь", "#14143c"],
    ["lighthouse", "Маяк", "#ff2e4a"], ["abyss", "Бездна", "#02028e"],
  ];
  const FORMATS = [[false, "Все против всех"], [true, "Команды"]];
  const MODS = [["classic", "Классика"], ["mirror", "Зеркало"], ["blind", "Вслепую"], ["hardcore", "Хардкор"]];
  const PACES = [[false, "Обычная"], [true, "Быстрая"]];
  const DIFFS = [["easy", "Лёгкая"], ["normal", "Нормальная"], ["hard", "Сложная"]];

  let o = null;       // { conn, show, screen — текущий экран, onChange — лидерство или участие изменились }
  let cur = null;     // состояние лобби от сервера, null — не в лобби
  let invites = [];   // [{ id, from, total, max }]
  let bannerFor = null;
  let bannerTimer = 0;

  /** Вызов хаба; текст HubException показывается в строке el. */
  async function call(el, method, ...args) {
    el.textContent = "";
    try {
      await o.conn.invoke(method, ...args);
      return true;
    } catch (e) {
      el.textContent = String((e && e.message) || "").split("HubException: ")[1] || "Не получилось, попробуй ещё раз";
      return false;
    }
  }

  const act = (method, ...args) => call($("lobby-error"), method, ...args);

  // ---------- Настройки ----------

  function push(change) {
    const s = { ...cur.settings, ...change };
    act("UpdateLobby", s.mode, s.teams, s.fast, s.difficulty, s.theme, s.maxPlayers);
  }

  /** Ряд кнопок-переключателей настройки. */
  function chips(id, items, value, set) {
    $(id).replaceChildren(...items.map(([key, label, swatch]) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "lobby-chip" + (key === value ? " on" : "");
      b.disabled = !cur.leader || cur.inMatch;
      if (swatch) {
        const dot = document.createElement("i");
        dot.style.background = swatch;
        b.appendChild(dot);
      }
      b.append(label);
      b.addEventListener("click", () => set(key));
      return b;
    }));
  }

  function renderSettings() {
    const s = cur.settings, locked = !cur.leader || cur.inMatch;
    chips("lobby-format", FORMATS, s.teams, (teams) => push({ teams }));
    chips("lobby-mod", MODS, s.mode, (mode) => push({ mode }));
    chips("lobby-pace", PACES, s.fast, (fast) => push({ fast }));
    chips("lobby-diff", DIFFS, s.difficulty, (difficulty) => push({ difficulty }));
    chips("lobby-theme", THEMES, s.theme, (theme) => push({ theme }));

    $("lobby-max").textContent = s.maxPlayers;
    $("lobby-bots").textContent = cur.bots;
    $("lobby-range").value = s.maxPlayers;
    for (const id of ["lobby-range", "lobby-max-minus", "lobby-max-plus", "lobby-bots-minus", "lobby-bots-plus"]) $(id).disabled = locked;
    $("lobby-hint").hidden = cur.leader;
  }

  // ---------- Игроки ----------

  function figure(p, height) {
    const fig = document.createElement("div");
    fig.className = "fig" + (p.you ? " you" : "");
    fig.style.setProperty("--h", `${height}px`);
    fig.style.setProperty("--c", p.color);

    const name = document.createElement("div");
    name.className = "fig-name";
    name.textContent = (p.leader ? "★ " : "") + p.name;

    const head = document.createElement("canvas");
    head.className = "fig-head";
    head.width = head.height = 168;
    course.paintHero(head, p.hero);

    fig.append(name, head);
    fig.insertAdjacentHTML("beforeend", `<svg class="fig-body" viewBox="0 0 120 220" aria-hidden="true"><use href="#fighter"/></svg>`);

    if (cur.leader && !p.you && !cur.inMatch) {
      const kick = document.createElement("button");
      kick.type = "button";
      kick.className = "fig-kick";
      kick.textContent = "×";
      kick.setAttribute("aria-label", `Убрать: ${p.name}`);
      kick.addEventListener("click", () => act("KickFromLobby", p.name));
      fig.appendChild(kick);
    }
    return fig;
  }

  function renderStage() {
    const { players } = cur;
    const stage = $("lobby-stage");
    const { perRow } = ROWS.find((r) => players.length <= r.upTo);
    const rows = [];
    for (let i = 0; i < players.length; i += perRow) rows.push(players.slice(i, i + perRow));
    // рост подбирается под экран; первые игроки впереди, задние ряды чуть мельче
    const widest = Math.max(...rows.map((r) => r.length));
    const height = Math.min(stage.clientHeight / (FIG_TALL + (rows.length - 1) * ROW_STEP) * 0.96, stage.clientWidth / widest / (FIG_WIDTH * 1.2));
    stage.replaceChildren(...rows.map((row, i) => {
      const el = document.createElement("div");
      el.className = "fig-row";
      el.style.zIndex = rows.length - i;
      const size = height * (1 - i * 0.05);
      el.append(...row.map((p) => figure(p, size)));
      return el;
    }).reverse());
  }

  function render() {
    renderSettings();
    renderStage();
    $("lobby-count").textContent = `Игроков: ${cur.total} из ${cur.settings.maxPlayers}`;
    $("lobby-log").replaceChildren(...cur.log.map((line) => {
      const el = document.createElement("div");
      el.textContent = line;
      return el;
    }));
    $("btn-lobby-start").hidden = !cur.leader;
    $("btn-lobby-start").disabled = cur.inMatch;
  }

  function onState(state) {
    const was = cur;
    cur = state;
    if (!was || !cur || was.leader !== cur.leader) o.onChange();
    if (cur) {
      if (!was && o.screen() !== "game") o.show("lobby"); // рост бойцов считается по видимой сцене
      render();
      if (was && o.screen() === "lobby" && !cur.inMatch) $("lobby-error").textContent = "";
    } else if (o.screen() === "lobby") {
      o.show("menu");
    }
  }

  // ---------- Приглашения ----------

  function hideBanner() {
    clearTimeout(bannerTimer);
    bannerFor = null;
    $("invite-banner").hidden = true;
  }

  function showBanner(invite) {
    bannerFor = invite.id;
    $("invite-text").textContent = `${invite.from} приглашает в лобби · ${invite.total} из ${invite.max}`;
    $("invite-error").textContent = "";
    $("invite-banner").hidden = false;
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(hideBanner, BANNER_MS); // в панели друзей приглашение останется
    music.ding(4);
  }

  function onInvites(list) {
    const known = new Set(invites.map((i) => i.id));
    invites = list;
    if (bannerFor && !list.some((i) => i.id === bannerFor)) hideBanner();
    const fresh = list.find((i) => !known.has(i.id));
    if (fresh) showBanner(fresh);
    social.setInvites(list);
  }

  const accept = (id, el) => call(el, "JoinLobby", id);
  const decline = (id) => o.conn.invoke("DeclineInvite", id).catch(() => {});

  function init(options) {
    o = options;
    o.conn.on("lobby", onState);
    o.conn.on("lobbyInvites", onInvites);
    addEventListener("resize", () => { if (cur && o.screen() === "lobby") renderStage(); });

    $("btn-lobby-create").addEventListener("click", () => call($("lobby-create-error"), "CreateLobby"));
    $("btn-lobby-exit").addEventListener("click", async () => {
      await act("LeaveLobby");
    });
    $("btn-lobby-start").addEventListener("click", () => act("StartLobby"));
    $("btn-lobby-invite").addEventListener("click", () => social.openList());

    const step = (id, delta) => $(id).addEventListener("click", () => push({ maxPlayers: cur.settings.maxPlayers + delta }));
    step("lobby-max-minus", -1);
    step("lobby-max-plus", 1);
    $("lobby-range").addEventListener("change", (e) => push({ maxPlayers: Number(e.target.value) }));
    $("lobby-range").addEventListener("input", (e) => { $("lobby-max").textContent = e.target.value; });
    $("lobby-bots-minus").addEventListener("click", () => act("SetLobbyBots", cur.bots - 1));
    $("lobby-bots-plus").addEventListener("click", () => act("SetLobbyBots", cur.bots + 1));

    $("invite-accept").addEventListener("click", async () => {
      const id = bannerFor;
      if (await accept(id, $("invite-error"))) hideBanner();
    });
    $("invite-decline").addEventListener("click", () => {
      decline(bannerFor);
      hideBanner();
    });
  }

  /** Связь пропала: сервер уже вывел игрока из лобби. */
  function reset() {
    onState(null);
    hideBanner();
  }

  /** Подключились: приглашения могли прийти раньше. */
  async function sync() {
    try {
      invites = await o.conn.invoke("LobbyInvites");
      social.setInvites(invites);
    } catch { /* придут событием */ }
  }

  return {
    init, reset, sync, accept, decline,
    active: () => !!cur,
    canInvite: () => !!cur && cur.leader,
    invite: (name, el) => call(el, "InviteToLobby", name),
  };
})();
