#!/usr/bin/env python3
"""Собирает trends/data.js из data/trends.json (извлечённые тренды) и data/evidence_ru.json.

Кластеры и их формулировки — редакторская работа, живут здесь же, в META.
Запуск: python3 build_data.py
"""
import json, collections, pathlib

HERE = pathlib.Path(__file__).parent
rows = json.load(open(HERE / "data/trends.json"))
ev_path = HERE / "data/evidence_ru.json"
ev = json.load(open(ev_path)) if ev_path.exists() else {}

GROUPS = [
    {"id": "machine", "name": "Машина", "color": "#ff5b24", "ink": "#fff"},
    {"id": "human", "name": "Человек", "color": "#3b5bff", "ink": "#fff"},
    {"id": "place", "name": "Тело и место", "color": "#14a76c", "ink": "#fff"},
    {"id": "culture", "name": "Культура", "color": "#ff6fae", "ink": "#1a1a23"},
    {"id": "price", "name": "Цена бренда", "color": "#f2c400", "ink": "#1a1a23"},
]

# glyph — 3x3 сетка: . пусто, o круг, O большой круг, s квадрат, t треугольник, h полукруг, x крест
META = {
 "studio":  dict(n=1, g="machine", name="Студия в промпте", glyph="sos.s.sos",
   line="ИИ снимает барьер производства — дефицитом становятся вкус и режиссура.",
   act="Выделить в команде роль AI-режиссёра и мерить вкус, а не только скорость."),
 "agents":  dict(n=2, g="machine", name="Бренд для ботов", glyph="o.ot.tO.o",
   line="Выбирать и покупать начинают агенты: бренд должен быть понятен и людям, и машинам.",
   act="Проверить, как ассистенты описывают бренд сегодня, и сделать факты машиночитаемыми."),
 "human":   dict(n=3, g="human", name="Премия за человечность", glyph=".O.OsO.O.",
   line="Чем дешевле ИИ-контент, тем заметнее и дороже человеческая работа и честная позиция по ИИ.",
   act="Определить публичную позицию по ИИ и открыто показывать, где он использован."),
 "imperfect": dict(n=4, g="human", name="Право на несовершенство", glyph="s.ts.hot.",
   line="Глянец стал нормой генерации — поэтому ценится шероховатость.",
   act="Оставлять следы процесса в коммуникации: lo-fi, неидеальные кадры, живой голос."),
 "proof":   dict(n=5, g="human", name="Доказательства вместо историй", glyph="xxxx.xxxx",
   line="Доверие строят данные, независимые тесты и открытая кухня, а не красивые рассказы.",
   act="Заменить обещания проверяемыми фактами и показывать источник."),
 "voice":   dict(n=6, g="human", name="Позиция и смелость", glyph="t.tOt.t.t",
   line="Серединой быть рискованно: бренды выигрывают, выбирая сторону и голос.",
   act="Сформулировать, с чем бренд спорит, и держать этот голос последовательно."),
 "irl":     dict(n=7, g="place", name="Возвращение в тело и город", glyph="ho.o.ohoh",
   line="Усталость от экрана: офлайн, ритуалы, события и «третьи места» снова работают как медиа.",
   act="Закладывать в план микро-события и форматы «рядом», а не только охват."),
 "local":   dict(n=8, g="place", name="Свои места и наследие", glyph="..sOs.s..",
   line="Гиперлокальность и память места становятся различием в глобальном шуме.",
   act="Искать локальный код вместо универсального образа."),
 "escape":  dict(n=9, g="place", name="Эскапизм, ностальгия, нежность", glyph="o.oOo.o.o",
   line="В тревожной экономике люди покупают мягкость, милоту, прошлое и ощущение дома.",
   act="Давать небольшие радости и узнаваемые символы эпохи без пафоса."),
 "body":    dict(n=10, g="place", name="Тело, ум, данные", glyph="ss.sO.ss.",
   line="Забота о себе уходит в метрики и ритуалы — вместе с ней растут и нездоровые стандарты.",
   act="Осторожно с wellness-обещаниями: проверять, не усиливает ли бренд тревогу."),
 "fandom":  dict(n=11, g="culture", name="Фандомы вместо монокультуры", glyph="ooooOoooo",
   line="Культура распалась на микросообщества; бренды растут через участие, а не через охват.",
   act="Выбрать один-два фандома и работать как инфраструктура, а не рекламодатель."),
 "creators": dict(n=12, g="culture", name="Креаторы и усталость от инфлюенса", glyph="t.tOht.t.",
   line="Креаторы становятся партнёрами полного цикла, но выгорают и уходят от зависимости от брендов.",
   act="Строить долгие партнёрства с креаторами и платить за процесс, а не за пост."),
 "games":   dict(n=13, g="culture", name="Игры и миры", glyph="s.so.os.s.",
   line="Игры давно мейнстрим, а реклама внутри них всё ещё недоинвестирована.",
   act="Тестировать присутствие в играх как в культурной среде, а не как медиаплан."),
 "measure": dict(n=14, g="price", name="Новая математика бренда", glyph="o.o.O.o.o",
   line="Культурная заметность, качество внимания и вкус вытесняют охват и скорость.",
   act="Добавить в дашборд метрики памяти и культурной заметности."),
 "craft":   dict(n=15, g="price", name="Бренд-практика и дизайн как бизнес", glyph="sss.s.sss",
   line="Дизайн доказуем деньгами; стратегия слабее там, где не хватает голоса и ясности.",
   act="Привязать дизайн к бизнес-метрике и проверить ясность голоса."),
 "visual":  dict(n=16, g="price", name="Визуальный язык 2026", glyph="hOh.s.hOh",
   line="Синий, цветы, «тихо и громко», звук и motion — так выглядят нежность и доверие.",
   act="Обновить палитру и motion-систему под спокойствие и доверие."),
}

TENSIONS = [
 dict(a="studio", b="human", title="Скорость ↔ человечность",
      text="ИИ делает производство мгновенным, а человеческая работа становится премиальной. Выигрывает тот, кто умеет делать и то и другое — и честно говорит, что именно."),
 dict(a="agents", b="proof", title="Боты-покупатели ↔ доверие",
      text="Агенты выбирают по машиночитаемым фактам, люди — по доказательствам и прозрачности. Один и тот же набор подтверждённых фактов работает для обоих."),
 dict(a="studio", b="imperfect", title="Глянец ↔ шероховатость",
      text="Эстетика выравнивается, потому что все используют одни и те же инструменты; отличиться помогают следы живого процесса."),
 dict(a="measure", b="fandom", title="Охват ↔ заметность",
      text="Широкий охват перестаёт давать рост; сильнее работает присутствие в нишах, где бренд становится частью памяти сообщества."),
 dict(a="agents", b="irl", title="Экран ↔ место",
      text="Чем больше выбора делегировано алгоритмам, тем ценнее то, что нельзя делегировать: событие, ритуал, физический опыт."),
]

SRC = [
 ("D&AD Trend Report 2025", "D&AD"),
 ("DENTSU CREATIVE", "Dentsu Creative"),
 ("Hopeful Monsters", "Hopeful Monsters"),
 ("Artlist", "Artlist"),
 ("Interbrand", "Interbrand"),
 ("RED ANTLER", "Red Antler"),
 ("Fratzke", "Fratzke"),
 ("DepositPhotos", "Deposit Photos"),
 ("HAVAS RED", "Havas Red"),
]
def short(s):
    for k, v in SRC:
        if s.startswith(k): return v
    raise SystemExit("unknown source: " + s)

def tagset(tags):
    out = set()
    for t in tags:
        t = t.lower().replace("-", " ")
        if t.startswith("ai") or "generative" in t: out.add("ИИ")
        if t == "gen z": out.add("Gen Z")
        if t in ("authenticity",): out.add("Подлинность")
        if t in ("community", "micro communities"): out.add("Сообщества")
        if t in ("creators", "creator economy", "influencers"): out.add("Креаторы")
        if t in ("experiential", "irl", "pop up", "events"): out.add("Живой опыт")
        if t in ("trust", "transparency", "disclosure"): out.add("Доверие")
        if t in ("fandom", "subcultures"): out.add("Фандомы")
        if t in ("craft", "handmade"): out.add("Ремесло")
        if t == "packaging": out.add("Упаковка")
        if t == "gaming": out.add("Игры")
        if t in ("retail",): out.add("Ритейл")
        if t in ("sport", "womens football"): out.add("Спорт")
        if t == "nostalgia": out.add("Ностальгия")
        if t in ("music",): out.add("Музыка")
        if t in ("fashion", "streetwear"): out.add("Мода")
        if t in ("food", "food and beverage"): out.add("Еда")
        if t == "cost of living": out.add("Цена жизни")
        if t in ("brand strategy", "brand identity", "brand voice", "brand guidelines"): out.add("Бренд-стратегия")
    return sorted(out)

trends = []
for r in rows:
    trends.append(dict(
        id=r["id"], c=r["cluster"], t=r["trend_ru"], d=r["thesis_ru"],
        e=ev.get(str(r["id"]), r["evidence"] if not any(ord(ch) < 128 and ch.isalpha() for ch in r["evidence"][:40]) else ""),
        s=short(r["source"]), p=r["page"], h=r["horizon"], st=r["stance"], tg=tagset(r["tags"])))

clusters = []
for cid, m in sorted(META.items(), key=lambda x: x[1]["n"]):
    ts = [t for t in trends if t["c"] == cid]
    clusters.append(dict(id=cid, n=m["n"], g=m["g"], name=m["name"], glyph=m["glyph"], line=m["line"], act=m["act"],
                         count=len(ts), sources=sorted({t["s"] for t in ts})))

data = dict(
    updated="4 октября 2026",
    groups=GROUPS, clusters=clusters, tensions=TENSIONS, trends=trends,
    sources=[v for _, v in SRC],
    stats=dict(trends=len(trends), sources=len(SRC), clusters=len(clusters)),
)
(HERE / "data.js").write_text("window.TRENDS_DATA = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n")
print("ok", data["stats"], "evidence_ru" if ev else "no evidence_ru yet")
