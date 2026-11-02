"use strict";

// Рамка с игрой на телефоне: внутри неё страница считает, что открыта на экране ПК,
// а снаружи вся рамка уменьшена под телефон. Поэтому раскладка та же, что на компьютере.
(() => {
  const PC_WIDTH = 1280;
  const PC_HEIGHT = 640;
  const frame = document.getElementById("app");

  // на ПК здесь нечего делать (index.html отправляет сюда только телефоны)
  if (!matchMedia("(hover: none) and (pointer: coarse)").matches) location.replace("/");

  function fit() {
    if (innerHeight > innerWidth) return; // вертикально игру закрывает .rotate-hint
    // клавиатура отнимает высоту: страница не должна скакать, пока игрок печатает
    if (frame.contentDocument?.activeElement?.matches("input, textarea")) return;

    const aspect = innerWidth / innerHeight;
    const width = Math.max(PC_WIDTH, Math.ceil(PC_HEIGHT * aspect));
    frame.style.width = width + "px";
    frame.style.height = Math.ceil(width / aspect) + "px";
    frame.style.transform = `scale(${innerWidth / width})`;
  }

  addEventListener("resize", fit);
  fit();
})();
