"use strict";

// «Код уровня» — маленький язык редактора: текст собирается в ячейки { a, f, s }, как будто их расставили руками.
// В нём только то, из чего состоит уровень: стрелки, время заполнения, особые ячейки, препятствия, повторы,
// превращения стрелок и шаблоны. Шаблон можно позвать только после того, как он описан, поэтому зациклиться нельзя.
const levelcode = (() => {
  const ARROWS = { "←": 0, "↑": 1, "→": 2, "↓": 3, l: 0, u: 1, r: 2, d: 3 }; // буквы — в любом регистре
  const SPECIALS = { чарт: "chart", свам: "swam", овердрайв: "over", шторм: "storm", переворот: "flip", радуга: "rainbow", раст: "rast", кловд: "cloud" };
  const OBSTACLES = { стена: "wall", шипы: "spike", обман: "fake" };
  const WORDS = new Set(["время", "повтор", "зеркало", "поворот", "разгон", "шаблон", ...Object.keys(SPECIALS), ...Object.keys(OBSTACLES)]);
  const MIRROR = [2, 3, 0, 1]; // стрелка наоборот, как в режиме «Зеркало»
  const TURN = [1, 2, 3, 0];   // поворот по часовой: ← ↑ → ↓ → ↑ → ↓ ←

  /** Справка в редакторе: как пишется и что делает. */
  const HELP = [
    ["← ↑ → ↓  или  L U R D", "ячейка с этой стрелкой (буквы можно маленькими)"],
    ["?", "ячейка со случайной стрелкой, не больше двух одинаковых подряд"],
    ["время 0.8", "время заполнения следующих ячеек в секундах (до конца блока)"],
    ["повтор 4 { … }", "повторить блок 4 раза"],
    ["зеркало { … }", "стрелки блока наоборот: ↑ ↔ ↓, ← ↔ →"],
    ["поворот { … }", "стрелки блока повёрнуты по часовой: ↑ → ↓ ←"],
    ["разгон 1.5 0.5 { … }", "время ячеек блока плавно меняется от первого числа ко второму"],
    ["чарт ↑", "особая ячейка со стрелкой, так же свам, овердрайв, шторм, переворот, радуга, раст, кловд"],
    ["стена  шипы  обман ↑", "препятствие: стену ломают нажатиями, на шипах ничего не жми, обман показывает не ту стрелку"],
    ["шаблон имя { … }", "запомнить блок под именем; дальше просто пиши имя"],
    ["# текст", "комментарий до конца строки"],
  ];

  const EXAMPLE = `# Лесенка, разгон и овердрайв
время 1
шаблон лесенка { ↑ → ↑ → }

лесенка
повтор 2 { → ↓ }
овердрайв ↑
разгон 1.2 0.5 { повтор 3 { ← ↑ } }
поворот { лесенка }
зеркало { лесенка }
`;

  class CodeError extends Error {
    constructor(line, message) {
      super(message);
      this.line = line;
    }
  }

  function tokenize(src) {
    const out = [];
    src.split("\n").forEach((text, i) => {
      const code = text.split("#")[0];
      for (const m of code.matchAll(/[←↑→↓?{}]|\d+(?:[.,]\d+)?|[\p{L}_][\p{L}\p{N}_]*|\S/gu)) {
        const t = m[0];
        out.push({ t: /^\p{L}/u.test(t) ? t.toLowerCase() : t, line: i + 1, num: /^\d/.test(t) ? +t.replace(",", ".") : null });
      }
    });
    return out;
  }

  /** Разбор в дерево: блок — список команд. */
  function parse(tokens) {
    let pos = 0;
    const templates = new Map();
    const lastLine = tokens.length ? tokens[tokens.length - 1].line : 1;
    const peek = () => tokens[pos];
    const take = () => tokens[pos++];

    function number(what, int) {
      const tok = take();
      if (!tok || tok.num === null) throw new CodeError(tok ? tok.line : lastLine, `После «${what}» нужно число`);
      if (int && !Number.isInteger(tok.num)) throw new CodeError(tok.line, `«${what}»: нужно целое число`);
      return tok.num;
    }

    function braces(what) {
      const open = take();
      if (!open || open.t !== "{") throw new CodeError(open ? open.line : lastLine, `После «${what}» нужен блок в скобках { … }`);
      return block(true);
    }

    function block(inner) {
      const list = [];
      while (pos < tokens.length) {
        if (peek().t === "}") {
          if (!inner) throw new CodeError(peek().line, "Лишняя «}»");
          take();
          return list;
        }
        list.push(statement());
      }
      if (inner) throw new CodeError(lastLine, "Не хватает «}»");
      return list;
    }

    function statement() {
      const tok = take();
      const { t, line } = tok;
      if (t in ARROWS || t === "?") return { kind: "cell", a: t === "?" ? null : ARROWS[t], line };
      if (t in SPECIALS || t in OBSTACLES) {
        // стрелка после слова необязательна: без неё — случайная
        const next = peek();
        const hasArrow = next && (next.t in ARROWS || next.t === "?");
        if (hasArrow) take();
        const a = hasArrow && next.t !== "?" ? ARROWS[next.t] : null;
        return t in SPECIALS ? { kind: "cell", a, s: SPECIALS[t], line } : { kind: "cell", a, o: OBSTACLES[t], line };
      }
      if (t === "время") return { kind: "time", v: number(t), line };
      if (t === "повтор") {
        const n = number(t, true);
        if (n < 1) throw new CodeError(line, "«повтор»: хотя бы 1 раз");
        return { kind: "repeat", n, body: braces(t), line };
      }
      if (t === "зеркало") return { kind: "map", table: MIRROR, body: braces(t), line };
      if (t === "поворот") return { kind: "map", table: TURN, body: braces(t), line };
      if (t === "разгон") return { kind: "ramp", from: number(t), to: number(t), body: braces(t), line };
      if (t === "шаблон") {
        const name = take();
        if (!name || !/^[\p{L}_]/u.test(name.t)) throw new CodeError(name ? name.line : line, "После «шаблон» нужно имя");
        if (name.t in ARROWS) throw new CodeError(name.line, `«${name.t}» — это стрелка, назови шаблон иначе`);
        if (WORDS.has(name.t)) throw new CodeError(name.line, `«${name.t}» — команда языка, назови шаблон иначе`);
        if (templates.has(name.t)) throw new CodeError(name.line, `Шаблон «${name.t}» уже есть`);
        const body = braces("шаблон " + name.t);
        templates.set(name.t, body);
        return { kind: "block", body: [], line };
      }
      if (templates.has(t)) return { kind: "block", body: templates.get(t), line };
      throw new CodeError(line, /^\p{L}/u.test(t) ? `Не знаю слова «${t}»: это не команда и не шаблон` : `Непонятный знак «${t}»`);
    }

    return block(false);
  }

  /**
   * Текст → ячейки. limits: { maxCells, minFill, maxFill }.
   * @returns {{ cells: {a,f,s}[] } | { error: string, line: number }}
   */
  function compile(src, limits) {
    try {
      const tree = parse(tokenize(src));
      const out = [];
      const fill = (v, line) => {
        if (v < limits.minFill || v > limits.maxFill) throw new CodeError(line, `Время от ${limits.minFill} до ${limits.maxFill} с`);
        return Math.round(v * 20) / 20;
      };
      const randomArrow = () => {
        let a;
        do a = Math.floor(Math.random() * 4);
        while (out.length >= 2 && a === out[out.length - 1].a && a === out[out.length - 2].a);
        return a;
      };

      // f — время по умолчанию в блоке, map — как превращаются стрелки
      function run(list, f, map) {
        for (const st of list) {
          if (st.kind === "time") f = fill(st.v, st.line);
          else if (st.kind === "cell") {
            if (out.length >= limits.maxCells) throw new CodeError(st.line, `Больше ${limits.maxCells} ячеек не поместится`);
            out.push({ a: st.a === null ? randomArrow() : map(st.a), f, s: st.s || null, o: st.o || null });
          } else if (st.kind === "repeat") {
            for (let k = 0; k < st.n; k++) run(st.body, f, map);
          } else if (st.kind === "map") {
            run(st.body, f, (a) => st.table[map(a)]);
          } else if (st.kind === "ramp") {
            const from = fill(st.from, st.line), to = fill(st.to, st.line);
            const start = out.length;
            run(st.body, f, map);
            const n = out.length - start;
            for (let k = 0; k < n; k++) out[start + k].f = fill(n > 1 ? from + ((to - from) * k) / (n - 1) : from, st.line);
          } else {
            run(st.body, f, map);
          }
        }
      }
      run(tree, 1, (a) => a);
      if (!out.length) return { error: "Код не ставит ни одной ячейки", line: 1 };
      return { cells: out };
    } catch (e) {
      if (e instanceof CodeError) return { error: e.message, line: e.line };
      throw e;
    }
  }

  return { compile, HELP, EXAMPLE };
})();
