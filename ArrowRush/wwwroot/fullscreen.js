"use strict";

// Чёрный экран при входе: просит включить полноэкранный режим.
// Телефон: кнопка, она же поворачивает экран горизонтально. ПК: клавиша F11.
// Браузер не сообщает о своём F11 надёжно, поэтому экран убирает само нажатие.
// На телефоне работает в phone.html: #app там — рамка с игрой, а внутри рамки чёрного экрана нет.
(() => {
  const $ = (id) => document.getElementById(id);
  if (top !== self) {
    $("fs-gate").hidden = true;
    return;
  }
  const touch = matchMedia("(hover: none) and (pointer: coarse)").matches; // как у экранных стрелок в style.css

  // телефону нужен настоящий полный экран: без него не будет поворота, даже если окно во весь экран.
  // window.screen, а не screen: в app.js так названа переменная с текущим экраном
  const isFullscreen = () => !!document.fullscreenElement || (!touch
    && (matchMedia("(display-mode: fullscreen)").matches
      || (innerWidth >= window.screen.width && innerHeight >= window.screen.height)));

  function setOpen(on) {
    $("fs-gate").hidden = !on;
    $("app").inert = on;
  }

  $("fs-button").addEventListener("click", async () => {
    setOpen(false);
    try {
      await document.documentElement.requestFullscreen({ navigationUI: "hide" });
      await window.screen.orientation.lock("landscape");
    } catch { /* на iPhone этого нет: игра идёт дальше, о повороте просит .rotate-hint */ }
  });

  addEventListener("keydown", (e) => {
    if (e.code === "F11") setOpen(false);
  });

  // полный экран включили иначе, например из меню браузера
  addEventListener("resize", () => {
    if (isFullscreen()) setOpen(false);
  });

  // на телефоне с выходом из полного экрана пропадает и поворот, поэтому спрашиваем снова
  document.addEventListener("fullscreenchange", () => {
    if (touch && !document.fullscreenElement) setOpen(true);
  });

  setOpen(!isFullscreen());
})();
