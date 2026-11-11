/*
 * Хрон — движок: переводит текст в «то, что прочитает диктор»,
 * считает слоги, паузы и символы.
 * Работает и в браузере (window.Hron), и в Node (module.exports).
 */
(function (root) {
  "use strict";

  /* ---------- Числа: количественные ---------- */

  const U_NOM = ["ноль", "один", "два", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"];
  const U_GEN = ["нуля", "одного", "двух", "трёх", "четырёх", "пяти", "шести", "семи", "восьми", "девяти"];
  const T_NOM = ["десять", "одиннадцать", "двенадцать", "тринадцать", "четырнадцать", "пятнадцать", "шестнадцать", "семнадцать", "восемнадцать", "девятнадцать"];
  const T_GEN = T_NOM.map((w) => w.slice(0, -1) + "и");
  const D_NOM = ["", "", "двадцать", "тридцать", "сорок", "пятьдесят", "шестьдесят", "семьдесят", "восемьдесят", "девяносто"];
  const D_GEN = ["", "", "двадцати", "тридцати", "сорока", "пятидесяти", "шестидесяти", "семидесяти", "восьмидесяти", "девяноста"];
  const H_NOM = ["", "сто", "двести", "триста", "четыреста", "пятьсот", "шестьсот", "семьсот", "восемьсот", "девятьсот"];
  const H_GEN = ["", "ста", "двухсот", "трёхсот", "четырёхсот", "пятисот", "шестисот", "семисот", "восьмисот", "девятисот"];

  const SCALES = [
    null,
    { g: "f", nom: ["тысяча", "тысячи", "тысяч"], gen: ["тысячи", "тысяч"] },
    { g: "m", nom: ["миллион", "миллиона", "миллионов"], gen: ["миллиона", "миллионов"] },
    { g: "m", nom: ["миллиард", "миллиарда", "миллиардов"], gen: ["миллиарда", "миллиардов"] },
    { g: "m", nom: ["триллион", "триллиона", "триллионов"], gen: ["триллиона", "триллионов"] },
  ];

  // Форма существительного после числа: nom → [1, 2–4, 5+], gen → [ед., мн.]
  function pick(n, forms, gcase, frac) {
    if (typeof forms === "string") return forms;
    if (gcase === "gen") return frac || (n % 10 === 1 && n % 100 !== 11) ? forms.gen[0] : forms.gen[1];
    if (frac) return forms.nom[1];
    const a = n % 100, b = n % 10;
    if (a >= 11 && a <= 14) return forms.nom[2];
    if (b === 1) return forms.nom[0];
    if (b >= 2 && b <= 4) return forms.nom[1];
    return forms.nom[2];
  }

  function triplet(n, g, gcase) {
    const out = [];
    const h = Math.floor(n / 100), r = n % 100, d = Math.floor(r / 10), u = r % 10;
    if (h) out.push((gcase === "gen" ? H_GEN : H_NOM)[h]);
    if (r >= 10 && r < 20) out.push((gcase === "gen" ? T_GEN : T_NOM)[r - 10]);
    else {
      if (d) out.push((gcase === "gen" ? D_GEN : D_NOM)[d]);
      if (u) {
        if (gcase === "gen") out.push(u === 1 ? (g === "f" ? "одной" : "одного") : U_GEN[u]);
        else if (u === 1) out.push(g === "f" ? "одна" : g === "n" ? "одно" : "один");
        else if (u === 2) out.push(g === "f" ? "две" : "два");
        else out.push(U_NOM[u]);
      }
    }
    return out;
  }

  function cardinal(n, g, gcase) {
    g = g || "m";
    gcase = gcase || "nom";
    if (n === 0) return gcase === "gen" ? "нуля" : "ноль";
    const parts = [];
    let scale = 0;
    while (n > 0 && scale < SCALES.length) {
      const t = n % 1000;
      if (t) {
        const sc = SCALES[scale];
        const words = triplet(t, sc ? sc.g : g, gcase);
        if (sc) words.push(pick(t, sc, gcase));
        // «тысяча двести», «миллион» — без «одна/один» в старшем разряде
        if (sc && t === 1 && Math.floor(n / 1000) === 0) words.shift();
        parts.unshift(words.join(" "));
      }
      n = Math.floor(n / 1000);
      scale++;
    }
    return parts.join(" ");
  }

  function digitsAloud(s) {
    return s.split("").filter((c) => /\d/.test(c)).map((c) => U_NOM[+c]).join(" ");
  }

  const FRAC = [null, ["десятая", "десятых", "десятой"], ["сотая", "сотых", "сотой"], ["тысячная", "тысячных", "тысячной"]];

  // «2,5» → «две целых пять десятых»
  function decimal(intStr, fracStr, gcase) {
    const i = +intStr;
    const out = [];
    const gen = gcase === "gen";
    out.push(cardinal(i, "f", gcase));
    const oneish = i % 10 === 1 && i % 100 !== 11;
    out.push(gen ? (oneish ? "целой" : "целых") : oneish ? "целая" : "целых");
    if (fracStr.length <= 3) {
      const f = +fracStr;
      const fone = f % 10 === 1 && f % 100 !== 11;
      out.push(cardinal(f, "f", gcase));
      const den = FRAC[fracStr.length];
      out.push(gen ? (fone ? den[2] : den[1]) : fone ? den[0] : den[1]);
    } else out.push(digitsAloud(fracStr));
    return out.join(" ");
  }

  /* ---------- Числа: порядковые ---------- */

  const O_U = ["", "перв", "втор", "трет", "четвёрт", "пят", "шест", "седьм", "восьм", "девят"];
  const O_T = ["десят", "одиннадцат", "двенадцат", "тринадцат", "четырнадцат", "пятнадцат", "шестнадцат", "семнадцат", "восемнадцат", "девятнадцат"];
  const O_D = ["", "", "двадцат", "тридцат", "сороков", "пятидесят", "шестидесят", "семидесят", "восьмидесят", "девяност"];
  const O_H = ["", "сот", "двухсот", "трёхсот", "четырёхсот", "пятисот", "шестисот", "семисот", "восьмисот", "девятисот"];
  const STRESSED = new Set(["втор", "шест", "седьм", "восьм", "сороков", "нулев"]);

  // Окончания по «типу» (формы, которые встречаются в текстах)
  const END_HARD = { m: "ый", go: "ого", mu: "ому", ya: "ая", e: "ое", ye: "ые", yu: "ую", om: "ом", ym: "ым", h: "ых", mi: "ыми", oy: "ой" };
  const END_THIRD = { m: "ий", go: "ьего", mu: "ьему", ya: "ья", e: "ье", ye: "ьи", yu: "ью", om: "ьем", ym: "ьим", h: "ьих", mi: "ьими", oy: "ьей" };

  function compoundGen(k) {
    // для «двухтысячный», «стотысячный»
    return cardinal(k, "m", "gen").replace(/^ста$/, "сто").replace(/ /g, "");
  }

  function ordinal(n, form) {
    form = form || "m";
    let stem, rest;
    const r100 = n % 100;
    if (n === 0) { stem = "нулев"; rest = 0; }
    else if (r100 >= 10 && r100 < 20) { stem = O_T[r100 - 10]; rest = n - r100; }
    else if (n % 10) { stem = O_U[n % 10]; rest = n - (n % 10); }
    else if (r100) { stem = O_D[r100 / 10]; rest = n - r100; }
    else if (n % 1000) { stem = O_H[(n % 1000) / 100]; rest = n - (n % 1000); }
    else if (n % 1e6) { const k = (n % 1e6) / 1000; stem = (k === 1 ? "" : compoundGen(k)) + "тысячн"; rest = n - (n % 1e6); }
    else if (n % 1e9) { const k = (n % 1e9) / 1e6; stem = (k === 1 ? "" : compoundGen(k)) + "миллионн"; rest = n - (n % 1e9); }
    else return cardinal(n);
    let end;
    if (stem === "трет") end = END_THIRD[form];
    else {
      end = END_HARD[form];
      if (form === "m" && STRESSED.has(stem)) end = "ой";
    }
    return (rest ? cardinal(rest) + " " : "") + stem + end;
  }

  // «-й», «-го», «-я» … → форма порядкового
  function suffixForm(suf, n) {
    switch (suf) {
      case "й": case "ый": case "ой": case "ий": return "m";
      case "го": case "ого": case "его": return "go";
      case "му": case "ому": case "ему": return "mu";
      case "я": case "ая": case "ья": return "ya";
      case "ые": case "ие": return "ye";
      case "е": case "ое": case "ее": case "ье":
        // «90-е», «2000-е» — чаще про десятилетия
        return n >= 40 && n % 10 === 0 ? "ye" : "e";
      case "ю": case "ую": case "ью": return "yu";
      case "м": case "ом": case "ем": return "om";
      case "ым": case "им": return "ym";
      case "х": case "ых": case "их": return "h";
      case "ми": case "ыми": case "ими": return "mi";
      case "ей": return "oy";
    }
    return "m";
  }

  /* ---------- Справочники ---------- */

  const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

  const GEN_PREPS = new Set(["от", "до", "с", "со", "из", "около", "более", "менее", "свыше", "порядка", "без", "для", "после", "кроме", "у", "вместо", "больше", "меньше", "ниже", "выше", "среди", "против", "возле", "вокруг", "старше", "младше", "дороже", "дешевле"]);
  const NOM_RANGE_PREPS = new Set(["на", "в", "за", "по", "через", "к", "раз"]);

  const F = (one, few, many, g1, g2) => ({ nom: [one, few, many], gen: [g1, g2] });
  // Единицы и валюты после числа. g — род для «один/одна».
  const UNITS = [
    { k: ["%"], g: "m", w: F("процент", "процента", "процентов", "процента", "процентов") },
    { k: ["‰"], g: "n", w: "промилле" },
    { k: ["₽", "руб.", "руб", "р."], g: "m", w: F("рубль", "рубля", "рублей", "рубля", "рублей") },
    { k: ["коп.", "коп"], g: "f", w: F("копейка", "копейки", "копеек", "копейки", "копеек") },
    { k: ["$", "долл.", "USD"], g: "m", w: F("доллар", "доллара", "долларов", "доллара", "долларов") },
    { k: ["€", "EUR"], g: "m", w: "евро" },
    { k: ["£"], g: "m", w: F("фунт", "фунта", "фунтов", "фунта", "фунтов") },
    { k: ["¥"], g: "m", w: F("юань", "юаня", "юаней", "юаня", "юаней") },
    { k: ["₸"], g: "n", w: "тенге" },
    { k: ["₴"], g: "f", w: F("гривна", "гривны", "гривен", "гривны", "гривен") },
    { k: ["°C", "°С", "℃", "°"], g: "m", w: F("градус", "градуса", "градусов", "градуса", "градусов") },
    { k: ["км/ч"], g: "m", w: F("километр в час", "километра в час", "километров в час", "километра в час", "километров в час") },
    { k: ["м²", "кв. м", "кв.м", "м2"], g: "m", w: F("квадратный метр", "квадратных метра", "квадратных метров", "квадратного метра", "квадратных метров") },
    { k: ["км"], g: "m", w: F("километр", "километра", "километров", "километра", "километров") },
    { k: ["см"], g: "m", w: F("сантиметр", "сантиметра", "сантиметров", "сантиметра", "сантиметров") },
    { k: ["мм"], g: "m", w: F("миллиметр", "миллиметра", "миллиметров", "миллиметра", "миллиметров") },
    { k: ["м"], g: "m", w: F("метр", "метра", "метров", "метра", "метров") },
    { k: ["кг"], g: "m", w: F("килограмм", "килограмма", "килограммов", "килограмма", "килограммов") },
    { k: ["мг"], g: "m", w: F("миллиграмм", "миллиграмма", "миллиграммов", "миллиграмма", "миллиграммов") },
    { k: ["г", "гр.", "гр"], g: "m", w: F("грамм", "грамма", "граммов", "грамма", "граммов") },
    { k: ["т"], g: "f", w: F("тонна", "тонны", "тонн", "тонны", "тонн") },
    { k: ["мл"], g: "m", w: F("миллилитр", "миллилитра", "миллилитров", "миллилитра", "миллилитров") },
    { k: ["л.с."], g: "f", w: F("лошадиная сила", "лошадиные силы", "лошадиных сил", "лошадиной силы", "лошадиных сил") },
    { k: ["л"], g: "m", w: F("литр", "литра", "литров", "литра", "литров") },
    { k: ["ч"], g: "m", w: F("час", "часа", "часов", "часа", "часов") },
    { k: ["мин.", "мин"], g: "f", w: F("минута", "минуты", "минут", "минуты", "минут") },
    { k: ["сек.", "сек"], g: "f", w: F("секунда", "секунды", "секунд", "секунды", "секунд") },
    { k: ["мс"], g: "f", w: F("миллисекунда", "миллисекунды", "миллисекунд", "миллисекунды", "миллисекунд") },
    { k: ["ТБ", "Тб"], g: "m", w: F("терабайт", "терабайта", "терабайт", "терабайта", "терабайт") },
    { k: ["ГБ", "Гб"], g: "m", w: F("гигабайт", "гигабайта", "гигабайт", "гигабайта", "гигабайт") },
    { k: ["МБ", "Мб"], g: "m", w: F("мегабайт", "мегабайта", "мегабайт", "мегабайта", "мегабайт") },
    { k: ["КБ", "Кб"], g: "m", w: F("килобайт", "килобайта", "килобайт", "килобайта", "килобайт") },
    { k: ["ГГц"], g: "m", w: F("гигагерц", "гигагерца", "гигагерц", "гигагерца", "гигагерц") },
    { k: ["МГц"], g: "m", w: F("мегагерц", "мегагерца", "мегагерц", "мегагерца", "мегагерц") },
    { k: ["Гц"], g: "m", w: F("герц", "герца", "герц", "герца", "герц") },
    { k: ["кВт·ч", "кВт*ч", "кВтч"], g: "m", w: F("киловатт-час", "киловатт-часа", "киловатт-часов", "киловатт-часа", "киловатт-часов") },
    { k: ["кВт"], g: "m", w: F("киловатт", "киловатта", "киловатт", "киловатта", "киловатт") },
    { k: ["Вт"], g: "m", w: F("ватт", "ватта", "ватт", "ватта", "ватт") },
    { k: ["мАч", "мА·ч"], g: "m", w: F("миллиампер-час", "миллиампер-часа", "миллиампер-часов", "миллиампер-часа", "миллиампер-часов") },
    { k: ["Мп", "МП"], g: "m", w: F("мегапиксель", "мегапикселя", "мегапикселей", "мегапикселя", "мегапикселей") },
    { k: ["шт.", "шт"], g: "f", w: F("штука", "штуки", "штук", "штуки", "штук") },
    { k: ["чел.", "чел"], g: "m", w: F("человек", "человека", "человек", "человека", "человек") },
    { k: ["дн."], g: "m", w: F("день", "дня", "дней", "дня", "дней") },
    { k: ["мес."], g: "m", w: F("месяц", "месяца", "месяцев", "месяца", "месяцев") },
  ];
  const UNIT_BY_KEY = new Map();
  UNITS.forEach((u) => u.k.forEach((k) => UNIT_BY_KEY.set(k.toLowerCase(), u)));

  const MULTS = {
    "тыс": { g: "f", w: SCALES[1] },
    "млн": { g: "m", w: SCALES[2] },
    "млрд": { g: "m", w: SCALES[3] },
    "трлн": { g: "m", w: SCALES[4] },
  };

  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const UNIT_RE = UNITS.flatMap((u) => u.k)
    .sort((a, b) => b.length - a.length)
    .map((k) => esc(k) + (/[\p{L}]$/u.test(k) ? "(?![\\p{L}])" : ""))
    .join("|");
  const MULT_RE = "(тыс|млн|млрд|трлн)\\.?(?![\\p{L}])";
  const NUM = "(?:\\d{1,3}(?:[ \\u00A0\\u202F\\u2009]\\d{3})+(?!\\d)|\\d+)(?:[.,]\\d+)?";

  // Женский / средний род существительного после числа: «1 минута», «2 недели»
  const FEM_NEXT = /^(минут|секунд|недел|копе|штук|тысяч|сери|книг|бутыл|попыт|позици|ступен|строк|част|ноч|вещ|причин|функци|модел|верси|камер|стран|компани|игр|задач|ошиб|порци|чашк|карт|кнопк|скидк|покупк|подписк|услуг|лиг|звезд|минутк|секундочк|пар[аыу]?\b|личн)/i;
  const NEUT_NEXT = /^(мест|окн|сло|блюд|письм|предложени|издани|приложени|устройств|колес|яйц|яиц|очк|сообщени|видео|кафе|утр|сердц|поколени|направлени)/i;

  const CYR_NAMES = { А: "а", Б: "бэ", В: "вэ", Г: "гэ", Д: "дэ", Е: "е", Ё: "ё", Ж: "жэ", З: "зэ", И: "и", Й: "и краткое", К: "ка", Л: "эл", М: "эм", Н: "эн", О: "о", П: "пэ", Р: "эр", С: "эс", Т: "тэ", У: "у", Ф: "эф", Х: "ха", Ц: "цэ", Ч: "че", Ш: "ша", Щ: "ща", Ъ: "твёрдый знак", Ы: "ы", Ь: "мягкий знак", Э: "э", Ю: "ю", Я: "я" };
  const LAT_NAMES = { A: "эй", B: "би", C: "си", D: "ди", E: "и", F: "эф", G: "джи", H: "эйч", I: "ай", J: "джей", K: "кей", L: "эл", M: "эм", N: "эн", O: "оу", P: "пи", Q: "кью", R: "ар", S: "эс", T: "ти", U: "ю", V: "ви", W: "дабл-ю", X: "экс", Y: "уай", Z: "зед" };

  // Аббревиатуры, которые читаются словом, и короткие обычные слова капсом
  const CYR_AS_WORD = new Set(["ВУЗ", "ГУМ", "ЦУМ", "МИД", "МХАТ", "ЗАГС", "ГОСТ", "НАТО", "ОПЕК", "ТАСС", "ОМОН", "ГИБДД_", "БАД", "ДОТ", "РОНО", "ГЭС", "АЭС", "ТЭЦ", "НИИ", "МЧС_", "ТЮЗ", "ГОК", "РАН", "ВАК"]);
  const CYR_SPELL_ALWAYS = new Set(["ГИБДД", "МЧС", "СССР", "США", "ЦСКА", "ФНС", "ВДНХ"]);
  const CYR_COMMON = new Set(["А", "И", "В", "К", "С", "У", "О", "Я", "ДО", "НА", "ЗА", "ИЗ", "ОТ", "ПО", "НЕ", "НИ", "ДА", "НО", "ЖЕ", "ЛИ", "ВЫ", "МЫ", "ОН", "ТЫ", "ОНА", "ОНИ", "ОНО", "ВСЕ", "ВСЁ", "ЕЩЁ", "ЕЩЕ", "КАК", "ТАК", "ЧТО", "КТО", "ГДЕ", "ДЛЯ", "БЕЗ", "ПРО", "ВОТ", "ТУТ", "ТАМ", "УЖЕ", "ИЛИ", "ЕГО", "ЕЁ", "ИХ", "ВАС", "НАС", "ВАМ", "НАМ", "ДВА", "ТРИ", "ДНЯ", "ДНИ", "ГОД", "МИР", "ДОМ", "СОН", "ЧАС", "РАЗ", "ДАР", "ЕДА", "ЧАЙ", "СОК", "ВОТ", "КОД", "ЛЕС", "САД", "ДЕНЬ", "ОДИН", "ВСЕМ", "ЭТО", "ТОТ", "ТЕ", "ТА", "ТО", "МОЙ", "ТВОЙ", "НОВ", "СО", "ВО", "КО", "ОБ", "ОБО", "ПОД", "НАД", "ПРИ", "ЧЕМ", "ЧЁМ", "ЕСЛИ", "АХ", "ОХ", "ЭХ", "УХ", "ОЙ", "ЭЙ", "ДЖ", "ЕЙ", "ИМ", "НЁМ", "НЕЙ", "ЕМУ", "ТОЖЕ", "ВАШ", "НАШ", "ДЕЛ", "МОЖ", "ЖДИ", "ИДИ", "БЕГИ", "ДАЙ", "ПЕЙ", "ЕШЬ", "НЕТ", "ДАЖЕ", "ВЕСЬ", "ХИТ", "ТОП", "ВАУ", "ОГО", "АГА", "УГУ"]);
  const LAT_AS_WORD = new Set(["NASA", "LEGO", "IKEA", "FIFA", "UEFA", "NATO", "ZARA", "OPEC", "AIDS", "LASIK", "ASAP_", "UNESCO", "UNICEF", "SIM", "PIN", "WOW", "OK", "OMG_"]);
  const LAT_MAP = { IT: "ай-ти", AI: "эй-ай", PR: "пи-ар", HR: "эйч-ар", SMM: "эс-эм-эм", SEO: "сео", CEO: "си-и-оу", OK: "окей", TV: "ти-ви", VR: "ви-ар", AR: "эй-ар", USB: "ю-эс-би", QR: "кью-ар", NFC: "эн-эф-си", UX: "ю-экс", UI: "ю-ай", PC: "пи-си", DJ: "ди-джей", MVP: "эм-ви-пи", KPI: "кей-пи-ай", CRM: "си-ар-эм", B2B: "би-ту-би", B2C: "би-ту-си", FAQ: "эф-эй-кью", WI: "вай", SMS: "эс-эм-эс", GPS: "джи-пи-эс", PDF: "пи-ди-эф", VIP: "вип", WOW: "вау", SALE: "сейл", NEW: "нью", PRO: "про", MAX: "макс", LIVE: "лайв", FREE: "фри", TOP: "топ", HIT: "хит", BEST: "бест", ONLINE: "онлайн" };

  const ABBR = [
    [/т\.\s?е\./y, "то есть"],
    [/т\.\s?д\./y, "так далее"],
    [/т\.\s?п\./y, "тому подобное"],
    [/т\.\s?к\./y, "так как"],
    [/т\.\s?н\./y, "так называемый"],
    [/т\.\s?ч\./y, "том числе"],
    [/т\.\s?о\./y, "таким образом"],
    [/и\s?др\./y, "и другие"],
    [/и\s?пр\./y, "и прочее"],
    [/напр\./y, "например"],
    [/кол-во(?![\p{L}])/uy, "количество"],
    [/кол-ва(?![\p{L}])/uy, "количества"],
    [/руб\./y, "рублей"],
    [/коп\./y, "копеек"],
    [/тыс\./y, "тысяч"],
    [/млн(?![\p{L}])\.?/uy, "миллионов"],
    [/млрд(?![\p{L}])\.?/uy, "миллиардов"],
    [/трлн(?![\p{L}])\.?/uy, "триллионов"],
    [/ул\.(?=\s?[\p{Lu}\d])/uy, "улица"],
    [/пр-т(?![\p{L}])/uy, "проспект"],
    [/пр-д(?![\p{L}])/uy, "проезд"],
    [/д\.(?=\s?\d)/y, "дом"],
    [/кв\.(?=\s?\d)/y, "квартира"],
    [/стр\.(?=\s?\d)/y, "страница"],
    [/тел\.(?=\s?[\d+(])/y, "телефон"],
    [/им\.(?=\s?\p{Lu})/uy, "имени"],
    [/г\.(?=\s?\p{Lu})/uy, "город"],
    [/обл\./y, "область"],
    [/р-н(?![\p{L}])/uy, "район"],
    [/см\.(?=\s)/y, "смотрите"],
    [/макс\./y, "максимум"],
    [/мин\.(?=\s\p{Ll})/uy, "минимум"],
    [/ок\.(?=\s?\d)/y, "около"],
    [/гг\./y, "годы"],
    [/вв\./y, "века"],
    [/ед\./y, "единиц"],
    [/шт\./y, "штук"],
    [/чел\./y, "человек"],
    [/прим\./y, "примечание"],
    [/доп\./y, "дополнительно"],
    [/англ\./y, "английский"],
    [/рус\./y, "русский"],
  ];

  const TLD = { ru: "ру", com: "ком", net: "нет", org: "орг", io: "ай-оу", рф: "эр-эф", su: "эс-ю", me: "ми", app: "апп", ai: "эй-ай", pro: "про", info: "инфо", shop: "шоп", online: "онлайн", store: "стор", tv: "ти-ви", by: "бай", kz: "кей-зед" };

  /* ---------- Вспомогательные ---------- */

  const isWordChar = (c) => !!c && /[\p{L}\p{N}]/u.test(c);
  const isLetter = (c) => !!c && /\p{L}/u.test(c);

  function prevWord(text, i) {
    const m = /([\p{L}]+)[\s ]*$/u.exec(text.slice(Math.max(0, i - 40), i));
    return m ? m[1].toLowerCase() : "";
  }
  function nextWord(text, j) {
    const m = /^[\s ]*([\p{L}]+)/u.exec(text.slice(j, j + 40));
    return m ? m[1] : "";
  }

  function genderFor(next) {
    if (!next) return "m";
    if (FEM_NEXT.test(next)) return "f";
    if (NEUT_NEXT.test(next)) return "n";
    return "m";
  }

  // Читает «1 000 000», «2,5», «007»
  function readNumber(raw, g, gcase) {
    const s = raw.replace(/[    ]/g, "");
    const m = /^(\d+)(?:[.,](\d+))?$/.exec(s);
    if (!m) return { words: digitsAloud(s), n: 0, frac: false };
    if (m[2] !== undefined) {
      const i = +m[1];
      if (/^0+$/.test(m[2])) return { words: cardinal(i, g, gcase) + " " + m[2].split("").map(() => "ноль").join(" "), n: i, frac: false };
      // «1,5» → «полтора», «2,5» → «две с половиной»
      if (m[2] === "5" && m[1].length <= 6) {
        if (i === 1) return gcase === "gen" ? { words: "полутора", n: 5, frac: false } : { words: g === "f" ? "полторы" : "полтора", n: 2, frac: false };
        if (i > 1) return { words: cardinal(i, g, gcase) + " с половиной", n: i, frac: false };
      }
      return { words: decimal(m[1], m[2], gcase), n: i, frac: true };
    }
    if (m[1].length > 1 && m[1][0] === "0") return { words: digitsAloud(m[1]), n: +m[1], frac: false };
    if (m[1].length > 15) return { words: digitsAloud(m[1]), n: 0, frac: false };
    return { words: cardinal(+m[1], g, gcase), n: +m[1], frac: false };
  }

  function unitOf(key) {
    if (!key) return null;
    return UNIT_BY_KEY.get(key.toLowerCase()) || UNIT_BY_KEY.get(key.replace(/\s/g, "").toLowerCase()) || null;
  }

  // число + множитель + единица
  function numberPhrase(numRaw, multKey, unitKey, gcase, nextW) {
    const mult = multKey ? MULTS[multKey.replace(".", "").toLowerCase()] : null;
    const unit = unitOf(unitKey);
    const g = mult ? mult.g : unit ? unit.g : genderFor(nextW);
    const r = readNumber(numRaw, g, gcase);
    const out = [r.words];
    if (mult) out.push(pick(r.n, mult.w, gcase, r.frac));
    if (unit) {
      if (mult) out.push(typeof unit.w === "string" ? unit.w : gcase === "gen" ? unit.w.gen[1] : unit.w.nom[2]);
      else out.push(pick(r.n, unit.w, gcase, r.frac));
    }
    return out.join(" ");
  }

  function twoDigits(s) {
    if (s === "00") return "ноль-ноль";
    if (s[0] === "0") return "ноль " + U_NOM[+s[1]];
    return cardinal(+s);
  }

  function phoneGroup(s) {
    if (s === "00") return "ноль-ноль";
    if (s[0] === "0") return "ноль " + (s.length === 3 ? twoDigits(s.slice(1)) : U_NOM[+s[1]]);
    return cardinal(+s);
  }

  function spellCyr(w) {
    return w.split("").map((c) => CYR_NAMES[c] || c).join("-");
  }
  function spellLat(w) {
    return w.split("").map((c) => (/\d/.test(c) ? cardinal(+c) : LAT_NAMES[c] || c)).join("-");
  }

  // Строка набрана капсом как заголовок («СКИДКИ ДО 50% ТОЛЬКО СЕГОДНЯ») — читаем словами
  function lineIsHeadline(text, i) {
    const s = text.lastIndexOf("\n", i - 1) + 1;
    let e = text.indexOf("\n", i);
    if (e < 0) e = text.length;
    const words = text.slice(s, e).match(/[А-ЯЁа-яё]{2,}/g) || [];
    const caps = words.filter((w) => w === w.toUpperCase());
    const longCaps = caps.filter((w) => w.length >= 5 && /[АЕЁИОУЫЭЮЯ]/.test(w));
    return words.length >= 2 && caps.length / words.length >= 0.6 && longCaps.length >= 2;
  }

  /* ---------- Правила ---------- */
  // Каждое правило: re (sticky), b (нужна граница слова слева), fn → строка или null

  const R = [];
  const rule = (re, fn, b = true) => R.push({ re, fn, b });

  // e-mail
  rule(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-zА-Яа-я]{2,}/y, (m) => {
    const [user, host] = m[0].split("@");
    return readHandle(user) + " собака " + readDomain(host);
  });

  // URL
  rule(/(?:https?:\/\/)?(?:www\.)?(?:[A-Za-z0-9-]+\.)+(?:ru|com|net|org|io|рф|su|me|app|ai|pro|info|shop|online|store|tv|by|kz)(?![\p{L}\d])(?:\/[^\s,;)«»"]*[^\s,;.!?)«»"])?/uy, (m) => {
    let s = m[0].replace(/^https?:\/\//, "").replace(/^www\./, "");
    const slash = s.indexOf("/");
    const host = slash >= 0 ? s.slice(0, slash) : s;
    const path = slash >= 0 ? s.slice(slash + 1) : "";
    let out = readDomain(host);
    if (path) out += " слэш " + path.split("/").filter(Boolean).map(readHandle).join(" слэш ");
    return out;
  });

  function readHandle(s) {
    return s
      .split(/([._\-])/)
      .filter(Boolean)
      .map((p) => (p === "." ? "точка" : p === "_" ? "нижнее подчёркивание" : p === "-" ? "дефис" : /^\d+$/.test(p) ? readNumber(p, "m", "nom").words : p))
      .join(" ");
  }
  function readDomain(h) {
    const parts = h.split(".");
    return parts.map((p, i) => (i === parts.length - 1 && TLD[p.toLowerCase()] ? TLD[p.toLowerCase()] : readHandle(p))).join(" точка ");
  }

  // Телефон: +7 (999) 123-45-67, 8 800 555-35-35
  rule(/(\+7|8)[\s -]?\(?(\d{3})\)?[\s -]?(\d{3})[\s -]?(\d{2})[\s -]?(\d{2})(?!\d)/y, (m) => {
    return [m[1] === "+7" ? "плюс семь" : "восемь", phoneGroup(m[2]), phoneGroup(m[3]), phoneGroup(m[4]), phoneGroup(m[5])].join(", ");
  });
  rule(/(\d{3})-(\d{2})-(\d{2})(?!\d)/y, (m) => [phoneGroup(m[1]), phoneGroup(m[2]), phoneGroup(m[3])].join(", "));

  // Дата 11.11.2026
  rule(/(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})(?!\d)(?:\s?(г\.|года))?/y, (m, c) => {
    const d = +m[1], mo = +m[2];
    if (d < 1 || d > 31 || mo < 1 || mo > 12) return null;
    let y = +m[3];
    if (m[3].length === 2) y += 2000;
    const gen = GEN_PREPS.has(c.prev);
    return ordinal(d, gen ? "go" : "e") + " " + MONTHS[mo - 1] + " " + ordinal(y, "go") + " года";
  });

  // Время 14:30
  rule(/([01]?\d|2[0-3]):([0-5]\d)(?!\d)/y, (m, c) => {
    const gen = GEN_PREPS.has(c.prev);
    return cardinal(+m[1], "m", gen ? "gen" : "nom") + " " + twoDigits(m[2]);
  });

  // Римские века: XXI век
  rule(/([IVXLC]+)\s(век|века|веке|веку|веком|веков)(?![\p{L}])/uy, (m) => {
    const n = roman(m[1]);
    if (!n) return null;
    const f = { век: "m", века: "go", веке: "om", веку: "mu", веком: "ym", веков: "h" }[m[2]];
    return ordinal(n, f) + " " + m[2];
  });

  // Диапазон лет: 2025–2026 гг.
  rule(/(\d{4})\s?[-–—]\s?(\d{4})(?!\d)(?:\s?(гг\.|годы|годов|годах))?/y, (m) => {
    const a = +m[1], b = +m[2];
    if (a < 1000 || a > 2199 || b < 1000 || b > 2199) return null;
    let s = ordinal(a, "m") + " — " + ordinal(b, "m");
    if (m[3]) s += " " + (m[3] === "гг." ? "годы" : m[3]);
    return s;
  });

  // Год: 2026 г., в 2026 году
  rule(/(\d{4})\s?(г\.|года|году|годом|годах|год)(?![\p{L}])/uy, (m, c) => {
    const y = +m[1];
    if (y < 1000 || y > 2199) return null;
    let form, noun = m[2];
    if (noun === "г.") {
      if (c.prev === "в" || c.prev === "во") { form = "om"; noun = "году"; }
      else { form = "go"; noun = "года"; }
    } else form = { год: "m", года: "go", году: "om", годом: "ym", годах: "h" }[noun];
    return ordinal(y, form) + " " + noun;
  });

  // Порядковые: 1-й, 2-го, 90-е
  rule(/(\d+)-(ыми|ими|ого|его|ому|ему|ый|ой|ий|го|му|ая|ья|ое|ее|ье|ые|ие|ую|ью|ом|ем|ым|им|ых|их|ми|ей|й|я|е|ю|м|х)(?![\p{L}])/uy, (m) => {
    const n = +m[1];
    if (m[1].length > 12) return null;
    return ordinal(n, suffixForm(m[2], n));
  });

  // Дробь / «24/7» / «50/50»
  rule(/(\d+)\/(\d+)(?![\d/])/y, (m) => {
    const a = +m[1], b = +m[2];
    const simple = { "1/2": "одна вторая", "1/3": "одна третья", "2/3": "две третьих", "1/4": "одна четвёртая", "3/4": "три четвёртых" };
    if (simple[a + "/" + b]) return simple[a + "/" + b];
    return cardinal(a) + " на " + cardinal(b);
  });

  // Диапазон: 5–7 дней, 10–15%
  rule(new RegExp("(" + "\\d+(?:[.,]\\d+)?" + ")\\s?[-–—]\\s?(" + "\\d+(?:[.,]\\d+)?" + ")(?![\\d.,]?\\d)(?![-–—]\\d)(?:\\s?" + MULT_RE + ")?(?:\\s?(" + UNIT_RE + "))?", "uy"), (m, c) => {
    // «от … до …» — только когда единицу склоняем сами; иначе «пять-семь дней»
    const nomRange = NOM_RANGE_PREPS.has(c.prev) || (!m[3] && !m[4]);
    const gcase = nomRange ? "nom" : "gen";
    const nextW = nextWord(c.text, c.end);
    const mult = m[3] ? MULTS[m[3].toLowerCase()] : null;
    const unit = unitOf(m[4]);
    const g = mult ? mult.g : unit ? unit.g : genderFor(nextW);
    const A = readNumber(m[1], g, gcase), B = readNumber(m[2], g, gcase);
    let tail = [];
    if (mult) tail.push(pick(B.n, mult.w, gcase, B.frac));
    if (unit) {
      if (mult) tail.push(typeof unit.w === "string" ? unit.w : gcase === "gen" ? unit.w.gen[1] : unit.w.nom[2]);
      else tail.push(pick(B.n, unit.w, gcase, B.frac));
    }
    const core = nomRange ? A.words + "-" + B.words : "от " + A.words + " до " + B.words;
    return [core].concat(tail).join(" ");
  });

  // День + месяц: 11 ноября
  rule(new RegExp("(\\d{1,2})(?=[\\s\\u00A0]+(" + MONTHS.join("|") + ")(?![\\p{L}]))", "uy"), (m, c) => {
    const d = +m[1];
    if (d < 1 || d > 31) return null;
    return ordinal(d, GEN_PREPS.has(c.prev) ? "go" : "e");
  });

  // Валюта перед числом: $5, € 10 млн
  rule(new RegExp("([$€£¥₽])\\s?(" + NUM + ")(?:\\s?" + MULT_RE + ")?", "uy"), (m, c) => {
    const gcase = GEN_PREPS.has(c.prev) ? "gen" : "nom";
    return numberPhrase(m[2], m[3], m[1], gcase);
  });

  // ×2, x2
  rule(/[xхXХ×](\d+)(?![\d\p{L}])/uy, (m) => "икс " + cardinal(+m[1]));

  // Число (+ множитель, + единица)
  rule(new RegExp("([+\\-−]?)(" + NUM + ")(?:\\s?" + MULT_RE + ")?(?:\\s?(" + UNIT_RE + "))?", "uy"), (m, c) => {
    const sign = m[1];
    if (sign && c.text[c.i - 1] && !/[\s(«"]/.test(c.text[c.i - 1])) return null;
    const gcase = GEN_PREPS.has(c.prev) ? "gen" : "nom";
    const words = numberPhrase(m[2], m[3], m[4], gcase, nextWord(c.text, c.end));
    const pre = sign === "+" ? "плюс " : sign ? "минус " : "";
    return pre + words;
  });

  // Сокращения с точкой
  ABBR.forEach(([re, w]) => {
    rule(re, () => w);
  });

  // Аббревиатуры кириллицей
  rule(/[А-ЯЁ]{2,}(?![\p{Ll}])/uy, (m, c) => {
    const w = m[0];
    if (CYR_COMMON.has(w)) return null;
    if (CYR_SPELL_ALWAYS.has(w)) return spellCyr(w);
    if (CYR_AS_WORD.has(w)) return null;
    if (lineIsHeadline(c.text, c.i)) return null;
    const vowels = (w.match(/[АЕЁИОУЫЭЮЯ]/g) || []).length;
    const run = /[^АЕЁИОУЫЭЮЯ]{3,}/.test(w);
    if (w.length <= 3 || vowels === 0 || run) return spellCyr(w);
    return null;
  });

  // Одиночная буква перед номером: Т-34, А-1
  rule(/[А-ЯЁ](?=-\d)/uy, (m) => spellCyr(m[0]));

  // Латинские аббревиатуры: IT, AI, 5G
  rule(/[A-Z][A-Z0-9]{0,5}(?![\p{Ll}])/uy, (m, c) => {
    const w = m[0];
    if (LAT_MAP[w]) return LAT_MAP[w];
    if (LAT_AS_WORD.has(w)) return null;
    if (/\d/.test(w) && !/^[A-Z]+\d*$/.test(w)) return null;
    if (lineIsHeadline(c.text, c.i)) return null;
    if (w.length === 1 && w === "I" && /^\s[a-z]/.test(c.text.slice(c.end, c.end + 2))) return null;
    if (w.length > 4 && /[AEIOUY]/.test(w)) return null;
    return spellLat(w);
  }, false);

  // Символы
  const SYM = [
    [/&/y, "и"],
    [/№\s?/y, "номер "],
    [/§\s?/y, "параграф "],
    [/±\s?/y, "плюс-минус "],
    [/≈\s?/y, "примерно "],
    [/~(?=\s?\d)/y, "около "],
    [/≥\s?/y, "не меньше "],
    [/≤\s?/y, "не больше "],
    [/>(?=\s?\d)/y, "больше "],
    [/<(?=\s?\d)/y, "меньше "],
    [/=/y, "равно"],
    [/\+/y, "плюс"],
    [/%/y, "процентов"],
    [/‰/y, "промилле"],
    [/°/y, "градусов"],
    [/₽/y, "рублей"],
    [/\$/y, "долларов"],
    [/€/y, "евро"],
    [/#(?=[\p{L}\d])/uy, "хештег "],
    [/@(?=[\p{L}\d_])/uy, ""],
    [/@/y, "собака"],
    [/×/y, "на"],
    [/\//y, " "],
    [/\*+/y, ""],
    [/[→←↑↓•·|_^\\]+/y, ""],
    [/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}]+/uy, ""],
  ];
  SYM.forEach(([re, w]) => rule(re, () => w, false));

  function roman(s) {
    const v = { I: 1, V: 5, X: 10, L: 50, C: 100 };
    let n = 0;
    for (let i = 0; i < s.length; i++) {
      const a = v[s[i]], b = v[s[i + 1]] || 0;
      n += a < b ? -a : a;
    }
    return n > 0 && n < 40 ? n : 0;
  }

  /* ---------- Нормализация ---------- */

  function normalize(text) {
    const segs = [];
    let buf = "";
    let i = 0;
    const flush = () => {
      if (buf) segs.push({ t: buf });
      buf = "";
    };
    while (i < text.length) {
      const ch = text[i];
      const boundary = !isWordChar(text[i - 1]);
      let hit = false;
      // быстрый пропуск обычных строчных слов
      if (/[a-zа-яё]/.test(ch) && !boundary) {
        buf += ch;
        i++;
        continue;
      }
      for (const r of R) {
        if (r.b && !boundary) continue;
        r.re.lastIndex = i;
        const m = r.re.exec(text);
        if (!m || !m[0]) continue;
        const end = i + m[0].length;
        // правило не должно резать слово справа (кроме символов)
        if (r.b && isLetter(m[0][m[0].length - 1]) && isLetter(text[end])) continue;
        const ctx = { text, i, end, prev: prevWord(text, i) };
        const out = r.fn(m, ctx);
        if (out === null || out === undefined) continue;
        let t = out;
        // «… и т.д. Далее», «3 000 руб. Подробности» — точка была концом предложения
        if (/\.$/.test(m[0]) && !/\.$/.test(t) && /^\s+\p{Lu}/u.test(text.slice(end, end + 3))) t += ".";
        if (t) {
          // «5G» → «пять джи»: не склеиваем слова
          const before = buf ? buf[buf.length - 1] : segs.length ? segs[segs.length - 1].t.slice(-1) : "";
          if (isWordChar(before) && isWordChar(t[0])) t = " " + t;
          if (isWordChar(text[end]) && isWordChar(t[t.length - 1])) t += " ";
          // начало предложения — с заглавной
          if (/^\p{Ll}/u.test(t) && /(^|[.!?…]["»”)]*\s*|\n\s*)$/u.test(text.slice(Math.max(0, i - 6), i)) && /[.!?…\n]|^$/.test(text.slice(0, i).trimEnd().slice(-1)))
            t = t[0].toUpperCase() + t.slice(1);
        }
        flush();
        segs.push({ t, src: m[0] });
        i = end;
        hit = true;
        break;
      }
      if (!hit) {
        // целое слово из букв — одним куском
        const wm = /[\p{L}]+/uy;
        wm.lastIndex = i;
        const w = isLetter(ch) ? wm.exec(text) : null;
        if (w) {
          buf += w[0];
          i += w[0].length;
        } else {
          buf += ch;
          i++;
        }
      }
    }
    flush();
    // склеиваем пробелы вокруг пустых замен
    return segs;
  }

  /* ---------- Подсчёты ---------- */

  function syllables(s) {
    let n = (s.match(/[аеёиоуыэюяАЕЁИОУЫЭЮЯ]/g) || []).length;
    const lat = s.match(/[A-Za-z]+/g) || [];
    for (const w of lat) {
      const lw = w.toLowerCase();
      let k = (lw.match(/[aeiouy]+/g) || []).length;
      if (k > 1 && /[^aeiouy]e$/.test(lw) && !/le$/.test(lw)) k--;
      n += Math.max(1, k);
    }
    n += (s.match(/\d/g) || []).length * 2;
    return n;
  }

  function graphemes(s) {
    if (typeof Intl !== "undefined" && Intl.Segmenter) {
      let c = 0;
      for (const _ of new Intl.Segmenter("ru", { granularity: "grapheme" }).segment(s)) c++;
      return c;
    }
    return Array.from(s).length;
  }

  function pauses(spoken) {
    const blocks = spoken.split(/\n+/).map((b) => b.trim()).filter(Boolean);
    let sentence = 0, comma = 0;
    blocks.forEach((b) => {
      const inner = b.replace(/[.!?…]+["»”)]*$/, "");
      sentence += (inner.match(/[.!?…]+(?=[\s"»”)]|$)/g) || []).length;
      comma += (b.match(/[,;:]|\s[—–-]\s|\(/g) || []).length;
    });
    return { sentence, comma, paragraph: Math.max(0, blocks.length - 1) };
  }

  const PAUSE = { comma: 0.2, sentence: 0.4, paragraph: 0.7 };

  function analyze(text, rate, opts) {
    opts = opts || {};
    rate = rate || 5;
    const segs = normalize(text);
    const spoken = segs.map((s) => s.t).join("").replace(/[  ]{2,}/g, " ");
    const syl = syllables(spoken);
    const p = pauses(spoken);
    const k = 5 / rate; // паузы сжимаются при быстром темпе
    const pauseSec = opts.noPauses ? 0 : (p.comma * PAUSE.comma + p.sentence * PAUSE.sentence + p.paragraph * PAUSE.paragraph) * k;
    const speechSec = syl / rate;
    const noBreaks = text.replace(/\r?\n/g, "");
    return {
      segments: segs,
      spoken,
      syllables: syl,
      pauses: p,
      pauseSec,
      speechSec,
      seconds: syl ? speechSec + pauseSec : 0,
      chars: graphemes(noBreaks),
      charsNoSpaces: graphemes(text.replace(/\s/g, "")),
      words: (text.match(/[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu) || []).length,
      replacements: segs.filter((s) => s.src !== undefined).length,
    };
  }

  const api = { analyze, normalize, cardinal, ordinal, decimal, syllables };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Hron = api;
})(typeof window !== "undefined" ? window : globalThis);
