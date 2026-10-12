"""ADB-сценарий РЕГИСТРАЦИЯ Telegram-аккаунтов на облачных телефонах GeeLark.

Перенесён из farm-adb (engine/registration.py, порт драйвера regdrv5) — экранные
эвристики не менялись. Поменялись стыки: номер, почту и профиль выдаёт API
сервиса (/internal/worker/reg/assign), исход попытки воркер сообщает сам
(/reg/:id/fail — бан, флуд, нет кода и т.д.), шаги и скрины пишутся в API.

Поток на телефон (_registration_one):
  прокси → power_on → ADBKeyboard → ждём Telegram → экран номера → комплект
  (номер+почта+имя) → номер → почта → код почты → код звонка (Asterisk + SpeechKit)
  → имя → главный экран → запись аккаунта → юзернейм → медиа и энергосбережение
  → подписки → power_off (ВСЕГДА, в finally — биллинг поминутный).
"""
import os
import re
import time
import random
import asyncio
import logging

from . import api
from .phone import (
    sh as _sh, power_on as _power_on, power_off as _power_off,
    grab_screenshot_b64, ADB_KB, ADB_IME, ensure_tg_present as _ensure_tg_present,
)

logger = logging.getLogger(__name__)

TG = "org.telegram.messenger"
# Клава ввода кода Telegram — АБСОЛЮТНЫЕ пиксели экрана 720x1440 (весь старый флот A15).
# На других разрешениях (A14 Redmi = 1220x2712) эти точки мимо → см. _keypad(W, H):
# координаты нормализованы к 720x1440 и масштабируются под реальный экран.
KEYPAD = {'1': (120, 1040), '2': (360, 1040), '3': (600, 1040), '4': (120, 1127), '5': (360, 1127),
          '6': (600, 1127), '7': (120, 1213), '8': (360, 1213), '9': (600, 1213), '0': (360, 1299)}
KEYPAD_BACKSPACE = (590, 1299)      # ⌫ той же клавы (правее «0»)
BASE_W, BASE_H = 720, 1440          # экран, под который снимались координаты KEYPAD

# APK ADBKeyboard: на A15-образах GeeLark пакет ПРЕДУСТАНОВЛЕН (скрыт) — хватает
# install-existing. На A14-образе его НЕТ вовсе → качаем APK и ставим. Ставить ТОЛЬКО
# из /data/local/tmp: с /sdcard (fuse) system_server не может прочитать файл —
# «avc: denied { read } … tcontext=u:object_r:fuse:s0» → Error: Can't open file.
# Качает САМ ТЕЛЕФОН через свой резидентский прокси, поэтому источник должен быть
# не один: на прогоне 29.07 GitHub с части exit-IP отдал 1 байт вместо APK, и телефон
# остался без клавиатуры на весь прогон (кириллица → латиница). Пробуем по очереди,
# jsDelivr — CDN-зеркало того же репозитория, идёт другим сетевым путём.
ADBKB_APK_URLS = [u.strip() for u in os.environ.get("ADBKB_APK_URL", "").split(",") if u.strip()] or [
    "https://raw.githubusercontent.com/senzhk/ADBKeyBoard/master/ADBKeyboard.apk",
    "https://cdn.jsdelivr.net/gh/senzhk/ADBKeyBoard@master/ADBKeyboard.apk",
    "https://github.com/senzhk/ADBKeyBoard/raw/master/ADBKeyboard.apk",
]
ADBKB_APK_PATH = "/data/local/tmp/adbkb.apk"
ADBKB_MIN_BYTES = 5000        # реальный APK ~17КБ; меньше = редирект/заглушка/обрыв

# Сколько ждать КОМПЛЕКТ реги (номер + свободный транк + почта). Телефон к этому
# моменту уже включён (≈минута биллинга): ждать свободную линию дешевле, чем гасить
# его и поднимать следующий.
SESS_WAIT_SEC = float(os.environ.get("REG_SESSION_WAIT_SEC", "180"))

# Разрешения, которые выдаём ПОСЛЕ создания аккаунта (юзер: «после реги можно на
# разрешения соглашаться все»). Через pm grant — без диалогов и языконезависимо.
POST_REG_PERMS = [
    "android.permission.READ_CONTACTS", "android.permission.WRITE_CONTACTS",
    "android.permission.POST_NOTIFICATIONS", "android.permission.READ_PHONE_STATE",
    "android.permission.CALL_PHONE", "android.permission.READ_CALL_LOG",
    "android.permission.ANSWER_PHONE_CALLS", "android.permission.RECORD_AUDIO",
    "android.permission.CAMERA", "android.permission.READ_MEDIA_IMAGES",
    "android.permission.READ_MEDIA_VIDEO", "android.permission.READ_MEDIA_AUDIO",
]

# ── Режимы телефона (заполняются пробой на старте, ключ = geelark_id) ─────────
# _SHELL_CAP  — телефон режет И команду, И вывод shell на 2000 символов
#               (замерено на A14 Redmi 2407FRK8EC: «... [truncated, total N KB]»).
#               На таком телефоне `uiautomator dump; cat` физически не доезжает →
#               дамп забираем gzip+base64 чанками (см. _dump).
# _DENY_MODE  — идёт регистрация: системные диалоги разрешений ОТКЛОНЯЕМ
#               (1 отказ до ввода номера + 2 после). После создания аккаунта режим
#               снимается и права выдаются пачкой через pm grant.
_SHELL_CAP: dict = {}
_DENY_MODE: dict = {}
# Счётчик сработавших интерстициалов на телефон: {gid: {"шторка": 2, "отказ": 3, ...}}.
# Нужен, чтобы ВИДЕТЬ в логе задачи, что именно всплывало и было ли обработано —
# ловить такие экраны скриншотами бесполезно, они живут секунды.
_POPUPS: dict = {}


def _popup_hit(gid, kind):
    _POPUPS.setdefault(gid, {})
    _POPUPS[gid][kind] = _POPUPS[gid].get(kind, 0) + 1


# ── парсинг узлов ───────────────────────────────────────────────────────────
def _parse(xml: str):
    out = []
    i = xml.find("<hierarchy")
    if i < 0:
        i = xml.find("<?xml")
    if i >= 0:
        xml = xml[i:]
    import xml.etree.ElementTree as ET
    try:
        root = ET.fromstring(xml)
    except Exception:
        return out
    for n in root.iter("node"):
        m = re.findall(r"-?\d+", n.get("bounds", ""))
        if len(m) < 4:
            continue
        x1, y1, x2, y2 = map(int, m[:4])
        out.append({
            "t": n.get("text", "") or "", "rid": (n.get("resource-id", "") or "").split("/")[-1],
            "ridfull": n.get("resource-id", "") or "", "d": n.get("content-desc", "") or "",
            "c": (n.get("class", "") or "").split(".")[-1],
            "cx": (x1 + x2) // 2, "cy": (y1 + y2) // 2, "x1": x1, "y1": y1, "x2": x2, "y2": y2,
            "w": x2 - x1, "h": y2 - y1, "clk": n.get("clickable", ""), "chk": n.get("checked", ""),
            "pw": n.get("password", "") or "",   # поле пароля (2FA «Your password») — язык-незав. признак
        })
    return out


async def _probe_shell_cap(gid) -> bool:
    """Режет ли ЭТОТ телефон вывод shell? Часть образов (A14 Redmi) отдаёт максимум
    2000 символов и дописывает «... [truncated, total N KB]» — тогда `uiautomator dump;
    cat` возвращает обрубок, ET.fromstring падает, _parse отдаёт [] и весь драйвер
    слепнет («экрана нет» на каждом шаге). Проверяем один раз на старте телефона."""
    # Проба должна ГАРАНТИРОВАННО перевалить за 2000 символов, иначе обрезка не видна:
    # seq 1 500 даёт всего ~1892 символа и «влезает» даже на урезанном телефоне.
    # seq 1 1000 = ~3.9КБ — если хвоста «1000 » нет, значит вывод обрубили.
    out = await _sh(gid, "seq 1 1000 | tr '\\n' ' '", timeout=40)
    capped = ("truncated" in out) or ("1000 " not in out)
    _SHELL_CAP[gid] = capped
    return capped


async def _dump(gid):
    if not _SHELL_CAP.get(gid):
        return _parse(await _sh(gid, "uiautomator dump /sdcard/u.xml; cat /sdcard/u.xml", timeout=40))
    # Телефон с обрезкой вывода: сжимаем дамп на самом телефоне (gzip даёт ~4x на XML).
    # Пишем в /data/local/tmp — на /sdcard (fuse) файл отдаётся обрезанным.
    import gzip as _gz

    def _unpack(s):
        s = "".join(s.split())
        i = s.find("H4sI")                      # заголовок gzip в base64
        if i > 0:
            s = s[i:]
        return _gz.decompress(__import__("base64").b64decode(s + "=" * (-len(s) % 4)))

    # БЫСТРЫЙ ПУТЬ — один вызов вместо двух. Сжатый обычный экран это ~700-1500
    # символов и в лимит 2000 влезает целиком; не влез — телефон сам допишет
    # «... [truncated», и тогда идём длинным путём через файл и чанки.
    # На флоте из 2250 A14-телефонов это ровно вдвое меньше round-trip'ов к GeeLark,
    # а дампы — главный скрытый расход времени во всём драйвере.
    one = await _sh(gid, "uiautomator dump --compressed /data/local/tmp/u.xml >/dev/null 2>&1; "
                         "gzip -c /data/local/tmp/u.xml | base64 -w0", timeout=60)
    if one and "truncated" not in one:
        try:
            return _parse(_unpack(one).decode("utf-8", "replace"))
        except Exception:  # noqa: BLE001
            pass                                 # битый/пустой — падаем на длинный путь
    make = ("gzip -c /data/local/tmp/u.xml > /data/local/tmp/u.gz; "
            "base64 -w0 /data/local/tmp/u.gz > /data/local/tmp/u.b64; wc -c < /data/local/tmp/u.b64")
    head = await _sh(gid, make, timeout=60)
    digits = "".join(ch for ch in (head.strip().splitlines() or [""])[-1] if ch.isdigit())
    total = int(digits or 0)
    if not total:
        return []
    CH = 1900
    b = ""
    for off in range(0, total, CH):
        part = await _sh(gid, f"dd if=/data/local/tmp/u.b64 bs=1 skip={off} count={CH} 2>/dev/null",
                         timeout=60)
        b += "".join(part.split())
        if len(b) >= total:
            break
    try:
        return _parse(_unpack(b).decode("utf-8", "replace"))
    except Exception as e:  # noqa: BLE001
        logger.debug("_dump gz failed on %s: %s", gid, e)
        return []


def _keypad(W, H, ns=None):
    """Координаты клавы кода Telegram под РЕАЛЬНЫЙ экран.

    Сначала ищем клавиши СТРУКТУРНО в дампе: на экране кода Telegram рисует свою
    цифровую клаву, её кнопки — узлы с текстом-цифрой в нижней трети экрана. Это
    надёжнее любых констант и не зависит от разрешения.

    Фолбэк — масштабирование зашитых KEYPAD (сняты на 720x1440) под реальный экран:
    на 1220x2712 (A14) фиксированные точки уходят мимо клавиш вообще. Проверено на
    A14: масштабирование попадает в клавиши (0 → 610x2446 при реальном 610x2432)."""
    kx, ky = W / BASE_W, H / BASE_H
    pad = {d: (int(x * kx), int(y * ky)) for d, (x, y) in KEYPAD.items()}
    bs = (int(KEYPAD_BACKSPACE[0] * kx), int(KEYPAD_BACKSPACE[1] * ky))
    found_pad = False
    if ns:
        found = {}
        for n in ns:
            t = (n.get("t") or "").strip()
            if len(t) == 1 and t.isdigit() and n["cy"] > 0.60 * H:
                found.setdefault(t, (n["cx"], n["cy"]))
        if len(found) >= 10:            # нашли всю клаву — берём её координаты
            pad, found_pad = found, True
            # ⌫ у клавы Telegram стоит в нижнем ряду справа: колонка та же, что у «3/6/9»,
            # ряд тот же, что у «0». Считаем пересечением — надёжнее, чем искать
            # «узел без текста правее нуля» (там легко поймать контейнер ряда).
            bs = (found["9"][0], found["0"][1])
    return pad, bs, found_pad


async def _ensure_adb_keyboard(gid, step=None) -> bool:
    """ADBKeyboard активна? (нужна для ввода КИРИЛЛИЦЫ — имя/фамилия через ADB_INPUT_B64).
    Три ветки: (1) пакет стоит → просто активируем; (2) есть в образе, но скрыт/удалён
    для юзера (A15 GeeLark) → install-existing; (3) пакета нет вовсе (A14-образ) →
    качаем APK телефоном и ставим ИЗ /data/local/tmp (см. ADBKB_APK_PATH).
    Возвращает True, если ADBKeyboard стала активной IME."""
    async def _log(st, detail):
        if step:
            try:
                await step("клавиатура", st, detail)
            except Exception:  # noqa: BLE001
                pass

    async def _active() -> bool:
        return ADB_KB in (await _sh(gid, "settings get secure default_input_method")).strip()

    have = "package:" in await _sh(gid, f"pm path {ADB_KB}")
    if not have:
        # ветка A15: пакет в образе, но «удалён для пользователя»
        await _sh(gid, f"cmd package install-existing {ADB_KB}; pm unhide {ADB_KB}; pm enable {ADB_KB}")
        have = "package:" in await _sh(gid, f"pm path {ADB_KB}")
    if not have:
        # ветка A14: пакета нет — качаем APK и ставим.
        # Одной попытки МАЛО (прогон 29.07: «APK не скачался (size=1)» и «pm install
        # не подтвердился» — по телефону на каждую беду, ~12% телефонов без клавиатуры).
        # Поэтому: несколько источников × 2 круга, проверка что это ZIP, и 2 попытки
        # установки. Тот же паттерн, что в _install_apk у задачи «Подготовка».
        sz = 0
        why = "не скачался"
        for attempt in range(2):
            for url in ADBKB_APK_URLS:
                await _sh(gid, f"rm -f {ADBKB_APK_PATH}; curl -sL -o {ADBKB_APK_PATH} "
                               f"--max-time 90 --retry 2 '{url}'; chmod 644 {ADBKB_APK_PATH}",
                          timeout=200)
                raw = (await _sh(gid, f"wc -c < {ADBKB_APK_PATH}")).strip()
                sz = int("".join(ch for ch in raw if ch.isdigit()) or 0)
                if sz < ADBKB_MIN_BYTES:
                    why = f"скачано {sz} б с {url.split('/')[2]}"
                    continue
                # это точно APK, а не HTML-заглушка? ZIP начинается с «PK»
                if "PK" not in await _sh(gid, f"head -c 2 {ADBKB_APK_PATH}"):
                    why = f"не ZIP с {url.split('/')[2]}"
                    continue
                for _ in range(2):
                    await _sh(gid, f"pm install -r {ADBKB_APK_PATH}", timeout=120)
                    if "package:" in await _sh(gid, f"pm path {ADB_KB}"):
                        have = True
                        break
                    await asyncio.sleep(2)
                if have:
                    break
                why = "pm install не подтвердился"
            if have:
                break
            await asyncio.sleep(3)
        if not have:
            await _log("failed", f"APK не поставился: {why}")
            return False
        await _log("ok", f"ADBKeyboard установлена из APK ({sz // 1000} КБ)")
    for _ in range(3):
        await _sh(gid, f"ime enable {ADB_IME}; ime set {ADB_IME}")
        if await _active():
            await _log("ok", "ADBKeyboard активна")
            return True
        await asyncio.sleep(1.0)
    await _log("failed", "ADBKeyboard не стала активной IME")
    return False


async def _grant_post_reg(gid, step=None):
    """ПОСЛЕ создания аккаунта выдать Telegram все нужные права БЕЗ диалогов.
    Во время реги мы их отклоняем (3 отказа), поэтому догоняем здесь одним махом.
    Бьём на пачки: телефон с обрезкой держит команду не длиннее ~2000 символов."""
    ok = 0
    step_n = 6 if _SHELL_CAP.get(gid) else len(POST_REG_PERMS)
    for i in range(0, len(POST_REG_PERMS), step_n):
        chunk = POST_REG_PERMS[i:i + step_n]
        await _sh(gid, "; ".join(f"pm grant {TG} {p}" for p in chunk), timeout=60)
        ok += len(chunk)
    if step:
        try:
            await step("разрешения_после_реги", "ok", f"выдано pm grant: {ok}")
        except Exception:  # noqa: BLE001
            pass


async def _ime(gid):
    """Активная клавиатура коротко: ADBKbd / Gboard / <raw>. Для лога — вскрывает дрейф IME."""
    try:
        r = (await _sh(gid, "settings get secure default_input_method")).strip()
    except Exception:  # noqa: BLE001
        return "?"
    if ADB_KB in r:
        return "ADBKbd"
    if any(w in r.lower() for w in ("gboard", "google", "latinime", "inputmethod.latin")):
        return "Gboard"
    return (r.split("/")[0][-18:] or "?")


async def _fg(gid):
    """Что на переднем плане: TG / HOME / <pkg>. Для лога — вскрывает краши/выход из TG."""
    try:
        f = (await _sh(gid, "dumpsys window 2>/dev/null | grep -m1 mCurrentFocus")).strip()
    except Exception:  # noqa: BLE001
        return "?"
    if TG in f:
        return "TG"
    if "launcher" in f.lower():
        return "HOME"
    m = re.search(r"\bu0\s+([\w.]+)/", f)
    return (m.group(1).split(".")[-1] if m else (f[-24:] or "?"))


def _edits(ns):
    return [x for x in ns if "EditText" in x["c"]]


def _pwd_screen(ns):
    """Экран 2FA «Your password» (номер УЖЕ зареган + двухэтапка): поле ввода с
    password=true. Язык-независимо. НЕ путать с экраном имени (там поля password=false) —
    иначе имя печаталось в поле пароля → фейл → нет_главного → номер мимо ЧС."""
    return any((x.get("pw") == "true") and "EditText" in x["c"] for x in ns)


def _frid(ns, *suf):
    for s in suf:
        for n in ns:
            if n["rid"] == s or n["rid"].endswith(s):
                return n
    return None


def _ftext(ns, *ss):
    for s in ss:
        s = s.lower()
        for n in ns:
            if s in n["t"].lower() or s in n["d"].lower():
                return n
    return None


async def _disable_media(gid, W, H, step):
    """Отключить авто-загрузку медиа — экономия трафика на резидентских прокси.
    Settings → Data and Storage → выключаем ВСЕ Switch со checked=true: это ровно
    3 тумблера авто-загрузки (mobile/wifi/roaming) + Stream (Save to Gallery по
    дефолту OFF, не трогаются). Тапаем по НАЙДЕННЫМ Switch'ам, не по фикс-координатам.
    При любом сбое НЕ роняем рег (это вспомогательный шаг)."""
    try:
        await _sh(gid, f'am force-stop {TG}; am start -a android.intent.action.VIEW -d "tg://settings" {TG}')
        await asyncio.sleep(4)
        ns = await _dump(gid)
        ds = _ftext(ns, "data and storage", "данные и память", "data e archivi",
                    "données et stockage", "datos y almacenamiento", "dados e armazenamento",
                    "daten und speicher", "veri ve depolama")
        if not ds:
            await step("медиа_off", "ok", "пункт Data and Storage не найден — пропуск")
            return
        await _sh(gid, f"input tap {ds['cx']} {ds['cy']}")
        await asyncio.sleep(3)
        off = 0
        for _ in range(3):
            ns = await _dump(gid)
            on = sorted([n for n in ns if "Switch" in n["c"] and n.get("chk") == "true"],
                        key=lambda z: z["cy"])
            if not on:
                break
            # У каждого тумблера TG — ДВА узла Switch (строка @x~360 + сам переключатель
            # @x~634, ОДИН y). Тапать оба = двойной тап = тумблер вернётся ВКЛ (так и было).
            # Группируем по строке (близкий y) и тапаем ПРАВЫЙ узел (переключатель) РОВНО раз.
            groups = []
            for n in on:
                if groups and abs(n["cy"] - groups[-1][-1]["cy"]) <= 25:
                    groups[-1].append(n)
                else:
                    groups.append([n])
            for grp in groups:
                tgt = max(grp, key=lambda z: z["cx"])
                await _sh(gid, f"input tap {tgt['cx']} {tgt['cy']}")
                await asyncio.sleep(0.6)
                off += 1
        ns = await _dump(gid)
        left = len([n for n in ns if "Switch" in n["c"] and n.get("chk") == "true"])
        await step("медиа_off", "ok", f"выключено: {off}, осталось ВКЛ: {left}")
    except Exception as e:  # noqa: BLE001
        await step("медиа_off", "ok", f"сбой (не критично): {str(e)[:60]}")


async def _fix_cyrillic_name(gid, W, H, fn, ln, step):
    """Дописать кириллическое имя на экране Account (мы уже на нём после юзернейма).

    Зачем отдельно: на ЭКРАНЕ ИМЕНИ при реге B64-инжект регулярно не долетает —
    поле остаётся пустым, и драйвер уходит в латинский фолбэк (прогон 29.07, RO-13:
    «в поле='Ulyana' (латиница) попыток=2» при активной ADBKbd; пауза после очистки
    не помогла). На settled-экране `Settings → Account` тот же бродкаст проходит —
    проверено руками на A14TEST-01 («Тамара»/«Архипова» встали с первого раза).
    Поэтому имя добиваем здесь: аккаунт уже создан, спешить некуда.

    Поля `Your name` — первые два EditText сверху (третий — Bio). Сохранение —
    кнопка Done в шапке. Сбой не критичен: латиница уже стоит."""
    if not any(ord(c) > 127 for c in (fn or "") + (ln or "")):
        return False
    try:
        ns = await _dump(gid)
        ev = sorted(_edits(ns), key=lambda n: n["cy"])
        if len(ev) < 2:
            await step("имя_кириллица", "ok", "поля не найдены — пропуск")
            return False
        for fld, val in ((ev[0], fn), (ev[1], ln)):
            if not val:
                continue
            await _tap(gid, fld["cx"], fld["cy"]); await asyncio.sleep(0.6)
            await _clear_strong(gid); await asyncio.sleep(0.8)
            await _type_text(gid, val); await asyncio.sleep(1.2)
        ns = await _dump(gid)
        ev2 = sorted(_edits(ns), key=lambda n: n["cy"])
        got = (ev2[0]["t"] if ev2 else "") or ""
        if got.strip() != (fn or "").strip():
            await step("имя_кириллица", "ok", f"не приняло (в поле '{got[:20]}') — остаётся латиница")
            return False
        done = next((n for n in ns if (n.get("d") or "").strip().lower() == "done"
                     and n["cy"] < 0.15 * H), None)
        if done:
            await _tap(gid, done["cx"], done["cy"])
            await asyncio.sleep(2.5)
        await step("имя_кириллица", "ok", f"{fn} {ln}")
        return True
    except Exception as e:  # noqa: BLE001
        await step("имя_кириллица", "ok", f"сбой (не критично): {str(e)[:60]}")
        return False


async def _set_username(gid, W, H, uname, step):
    """Проставить @username свежему аккаунту через UI.

    Путь (снят руками на A14TEST-01, 1220x2712):
      Settings (нижний таб) → строка «Account / Number, Username, Bio»
      → строка «Add Username» → поле t.me/<...> → кнопка Done в шапке.
    Экран Username сам пишет «<name> is available.» — но мы проверяем ФАКТ:
    вернувшись на экран Account, строка должна показать «@uname».

    Онбординг реги форсит АНГЛИЙСКИЙ (см. _goto_number), поэтому опираемся на
    английские подписи с запасными локализациями — как в _disable_media.
    Сбой НЕ роняет регу: аккаунт уже создан, username можно доставить при привязке."""
    uname = re.sub(r"[^A-Za-z0-9_]", "", str(uname or ""))
    if len(uname) < 5:
        await step("юзернейм", "ok", f"пропуск: некорректный '{uname}'")
        return False
    try:
        await _sh(gid, f'am force-stop {TG}; am start -a android.intent.action.VIEW -d "tg://settings" {TG}')
        await asyncio.sleep(4)
        # 1) Settings → Account
        acc = None
        for _ in range(4):
            ns = await _dump(gid)
            if await _handle_interstitial(gid, ns, W, H):
                continue
            acc = _ftext(ns, "number, username", "номер, имя пользователя", "account")
            if acc:
                break
            await asyncio.sleep(2)
        if not acc:
            await step("юзернейм", "ok", "не нашёл раздел Account — пропуск")
            return False
        await _tap(gid, acc["cx"], acc["cy"])
        await asyncio.sleep(3)
        # 2) Account → строка юзернейма (пустая «Add Username» или уже «@...»)
        ns = await _dump(gid)
        row = _ftext(ns, "add username", "добавить имя пользователя", "username", "имя пользователя")
        if not row:
            await step("юзернейм", "ok", "не нашёл строку Username — пропуск")
            return False
        await _tap(gid, row["cx"], row["cy"])
        await asyncio.sleep(3)
        # 3) поле → ввод латиницей (input text, IME не нужен) → Done в шапке
        ns = await _dump(gid)
        e = _edits(ns)
        if not e:
            await step("юзернейм", "ok", "нет поля ввода — пропуск")
            return False
        await _tap(gid, e[0]["cx"], e[0]["cy"]); await asyncio.sleep(0.5)
        await _clear_strong(gid); await asyncio.sleep(0.8)
        await _type_text(gid, uname); await asyncio.sleep(2)
        done = _frid(ns, "done") or next(
            (n for n in await _dump(gid)
             if (n.get("d") or "").strip().lower() == "done" and n["cy"] < 0.15 * H), None)
        if done:
            await _tap(gid, done["cx"], done["cy"])
        else:
            await _key(gid, 66)
        await asyncio.sleep(3)
        # 4) ФАКТ-проверка: на экране Account появилась строка «@uname»
        ns = await _dump(gid)
        got = any(("@" + uname).lower() in (n.get("t") or "").lower() for n in ns)
        await step("юзернейм", "ok" if got else "failed",
                   f"@{uname}" if got else f"@{uname} не подтвердился на экране")
        return got
    except Exception as e:  # noqa: BLE001
        await step("юзернейм", "ok", f"сбой (не критично): {str(e)[:60]}")
        return False


def _bottom_tabs(ns, W, H):
    t = [n for n in ns if n["clk"] == "true" and n["cy"] > 0.84 * H and n["w"] < 0.33 * W and n["h"] < 0.10 * H]
    u, seen = [], set()
    for n in sorted(t, key=lambda z: z["cx"]):
        if n["cx"] not in seen:
            seen.add(n["cx"])
            u.append(n)
    return u


def _native_tg(ns):
    return any((n.get("ridfull") or "").startswith("org.telegram") for n in ns)


def _in_webview(ns):
    return any("Web-Tabs" in (n.get("d") or "") for n in ns)


def _chatlist(ns, W, H):
    if len(_edits(ns)) > 1:
        return False
    if len(_bottom_tabs(ns, W, H)) < 3:
        return False
    lbls = {n["cx"] for n in ns if (n.get("t") or "").strip() and n["cy"] > 0.86 * H
            and n["h"] < 0.06 * H and len((n.get("t") or "").strip()) <= 16}
    return len(lbls) >= 3


def _real_chatlist(ns, W, H):
    return _chatlist(ns, W, H) or (_native_tg(ns) and len(_bottom_tabs(ns, W, H)) >= 3 and len(_edits(ns)) <= 1)


def _toolbar_back(ns, W, H):
    cands = [n for n in ns if n["clk"] == "true" and n["cx"] < 0.18 * W and n["cy"] < 0.12 * H]
    cands.sort(key=lambda n: (n["cx"], n["cy"]))
    return cands[0] if cands else None


def _classify(ns, W, H):
    if _frid(ns, "permission_allow_button", "permission_allow_all_button",
             "permission_allow_selected_button", "permission_deny_button", "grant_dialog"):
        return "sys_perm"
    e = _edits(ns)
    if _chatlist(ns, W, H):
        return "chatlist"
    if len(_bottom_tabs(ns, W, H)) >= 3 and len(e) <= 1 and _native_tg(ns):
        return "chatlist"
    if len(e) >= 4:
        return "code"
    if len(e) == 2:
        return "number"
    if len(e) == 1:
        return "pwd_or_code1"
    return "other"


def _allow_btn(ns):
    return _frid(ns, "permission_allow_all_button", "permission_allow_foreground_only_button",
                 "permission_allow_button", "permission_allow_one_time_button")


def _deny_btn(ns):
    """Кнопка ОТКАЗА системного диалога разрешений. По resource-id → язык не важен
    (на DE-телефоне это «NICHT ZULASSEN»). Нужна для 3 отказов в начале реги."""
    return _frid(ns, "permission_deny_button", "permission_deny_and_dont_ask_again_button")


def _find_done(ns, W, H):
    cands = []
    for n in ns:
        if n["clk"] != "true":
            continue
        if n["cx"] < 0.55 * W or not (0.35 * H < n["cy"] < 0.85 * H):
            continue
        ar = n["w"] / max(1, n["h"])
        if 0.6 <= ar <= 1.7 and 0.08 * W <= n["w"] <= 0.45 * W:
            cands.append(n)
    cands.sort(key=lambda n: -n["cy"])
    return cands[0] if cands else None


def _num_fields(ns):
    e = sorted(_edits(ns), key=lambda n: n["cx"])
    return (e[0], e[-1]) if len(e) >= 2 else (None, None)


def _two_btn_dialog(ns, W, H):
    """Бан/ошибка-диалог Telegram («This phone number is banned» Help+OK, флуд-стоп) —
    РОВНО 2 кнопки в ряд. ВАЖНО: ≥2 кнопок, иначе ложно ловит рационейл-попап с ОДНОЙ
    кнопкой (Continue/Fortsetzen) → годный номер зря уходил в ЧС. Возвращает правую (OK)."""
    if _edits(ns) or len(_bottom_tabs(ns, W, H)) >= 3:
        return None
    btns = [n for n in ns if n["clk"] == "true" and n["t"].strip() and 0.35 * H < n["cy"] < 0.72 * H and n["w"] < 0.5 * W]
    if len(btns) < 2:
        return None
    btns.sort(key=lambda n: n["cy"])
    row = [b for b in btns if abs(b["cy"] - btns[-1]["cy"]) < 25]
    if len(row) < 2:
        return None
    row.sort(key=lambda n: n["cx"])
    return row[-1]


# ── действия ────────────────────────────────────────────────────────────────
async def _tap(gid, x, y):
    await _sh(gid, "input tap %d %d" % (int(x), int(y)))


async def _longpress(gid, x, y, ms=1300):
    await _sh(gid, "input swipe %d %d %d %d %d" % (int(x), int(y), int(x), int(y), ms))


async def _key(gid, code):
    await _sh(gid, "input keyevent %d" % code)


async def _type_text(gid, s):
    import base64 as _b64
    if any(ord(c) > 127 for c in s):
        b = _b64.b64encode(s.encode()).decode()
        await _sh(gid, "am broadcast -a ADB_INPUT_B64 --es msg " + b)
    else:
        safe = s.replace("'", "'\\''")
        await _sh(gid, "input text '%s'" % safe)


async def _setkb(gid):
    """Жёстко включить ADBKeyboard и УБЕДИТЬСЯ, что он стал активным IME. Только
    `ime set` в живом флоу часто НЕ срабатывает (boot-enable прошёл до готовности
    IME-framework / set не долетел по shell-транспорту) → ADBKeyboard не активен,
    остаётся Gboard → B64-ввод имени уходит в пустоту = пустое поле = нет_главного.
    Полная цепочка enable + верификация default_input_method, до 3 попыток."""
    for _ in range(3):
        await _sh(gid, f"cmd package install-existing {ADB_KB}; pm enable {ADB_KB}; "
                       f"ime enable {ADB_IME}; ime set {ADB_IME}")
        await asyncio.sleep(0.8)
        if ADB_KB in (await _sh(gid, "settings get secure default_input_method")).strip():
            return True
    return False


_TRANSLIT = {"а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e", "ж": "zh",
             "з": "z", "и": "i", "й": "y", "к": "k", "л": "l", "м": "m", "н": "n", "о": "o",
             "п": "p", "р": "r", "с": "s", "т": "t", "у": "u", "ф": "f", "х": "kh", "ц": "ts",
             "ч": "ch", "ш": "sh", "щ": "sch", "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya"}


def _latin_name(uname, fn, ln):
    """Латинские имя/фамилия для ФОЛБЭКА ввода имени: из username tg-regs
    (aleksandra_matveeva_2749 → Aleksandra / Matveeva), иначе транслит кириллицы.
    Латиница вводится через `input text` (ASCII-ветка _type_text) — инжект прямо в
    сфокусированное поле, IME-независимо, бродкаст ADBKeyboard не нужен. Имя/ава всё
    равно переустанавливаются при привязке Telethon — латиница на старте не страшна."""
    tr = lambda s: "".join(_TRANSLIT.get(c, c) for c in (s or "").lower()).strip()  # noqa: E731
    parts = [p for p in re.split(r"[^a-zA-Z]+", str(uname or "")) if p]
    lf = (parts[0] if parts else tr(fn)) or "Anna"
    ll = (parts[1] if len(parts) > 1 else tr(ln)) or ""
    return lf.capitalize(), ll.capitalize()


async def _clear_field(gid):
    await _sh(gid, "input keyevent 123 " + " ".join(["67"] * 25))


async def _clear_strong(gid):
    await _sh(gid, "input keyevent 123 " + " ".join(["67"] * 22))
    await _sh(gid, "input keyevent 122 " + " ".join(["112"] * 22))


async def _enter_code(gid, code, W=BASE_W, H=BASE_H):
    """Ввод кода — И почта, И звонок.

    Исторически (A15, 720x1440) работали ТОЛЬКО тапы по in-app клаве Telegram: клетки
    кода кастомные (не EditText), type_text туда не попадал. Но координаты KEYPAD сняты
    на 720x1440 и на другом экране (A14 Redmi = 1220x2712) уходят мимо → масштабируем
    через _keypad(W, H).

    `input text` используется ТОЛЬКО как запасной путь — когда клавы Telegram на экране
    нет вовсе (тапать некуда). Почему не «сначала инжект, потом тапы» — см. ниже.

    Перед вводом ЧИСТИМ клетки backspace'ами: тапы слепые, и остаток прошлого ввода
    склеивался с новым (CZ-58 10.06: на экране «8742» = хвост email-кода 869742
    предыдущего номера). На пустых клетках backspace — no-op, чистить безопасно."""
    code = re.sub(r"\D", "", str(code))
    pad, bs, has_pad = _keypad(W, H, await _dump(gid))
    for _ in range(max(6, len(code))):
        await _tap(gid, bs[0], bs[1])       # ⌫ клавы TG (правее «0»)
        await asyncio.sleep(0.12)
    if not has_pad:
        # Клавы Telegram на экране нет (активна системная IME и т.п.) — инжектим
        # напрямую. ⛔ НЕ делать это ДО тапов «на всякий случай»: `input text` на A14
        # проходит, экран кода почты сам перелистывается на экран кода ЗВОНКА, а он
        # классифицируется так же («code», ≥4 клетки) → драйвер считал, что не приняли,
        # и вбивал тот же код повторно уже по следующему экрану (застрявшая «6»
        # в первой клетке, прогон 29.07).
        await _sh(gid, "input text %s" % code)
        await asyncio.sleep(3)
        return
    for ch in code:
        if ch in pad:
            x, y = pad[ch]
            await _tap(gid, x, y)
            await asyncio.sleep(0.3)
    await asyncio.sleep(3)


# ── интерстициалы (allow по rid / continue по позиции / отказ длинного диалога) ─
async def _handle_interstitial(gid, ns, W, H):
    # языковой попап «Выберите язык» (RadioButton'ы + OK) — всплывает в РАЗНЫХ точках
    # (после номера, в чатах, на детекте успеха). Гасим ГЛОБАЛЬНО, ТОЛЬКО структура/
    # позиция (флот на разных языках). ВАЖНО: OK тут clickable=FALSE (AlertDialog ловит
    # клик сам) → НЕ требуем clk, иначе хватаем кликабельную иконку камеры рядом. OK =
    # единственный ТЕКСТОВЫЙ узел под радио в правой части карточки, выше плавающей
    # кнопки (FAB ~0.83H отсечён порогом 0.80H); тапаем по позиции.
    radios = [n for n in ns if "RadioButton" in (n.get("c") or "")]
    if radios:
        _popup_hit(gid, "выбор_языка")
        rb_bottom = max(n["cy"] for n in radios)
        cand = [n for n in ns if (n.get("t") or "").strip() and n["cx"] > 0.55 * W
                and rb_bottom < n["cy"] < 0.80 * H]
        okbtn = min(cand, key=lambda n: n["cy"]) if cand else None
        # ВСЕГДА тапаем: okbtn если нашли, иначе фикс. позиция OK (правый-низ карточки).
        ox, oy = ((okbtn["cx"], okbtn["cy"]) if okbtn
                  else (int(0.80 * W), int(min(rb_bottom + 0.065 * H, 0.78 * H))))
        await _tap(gid, ox, oy)
        await asyncio.sleep(2)
        return True
    # Системный диалог разрешений. В режиме реги (_DENY_MODE) — ОТКЛОНЯЕМ: юзер требует
    # 3 отказа (1 до ввода номера + 2 после). Права догоняем pm grant'ом после создания
    # аккаунта (_grant_post_reg). Вне режима реги — как раньше, разрешаем.
    if _DENY_MODE.get(gid):
        dn = _deny_btn(ns)
        if dn:
            _popup_hit(gid, "отказ_разрешения")
            await _tap(gid, dn["cx"], dn["cy"])
            await asyncio.sleep(1.4)
            return True
    a = _allow_btn(ns)
    if a:
        _popup_hit(gid, "разрешил")
        await _tap(gid, a["cx"], a["cy"])
        await asyncio.sleep(1.4)
        return True
    # диалог «доступ к контактам» (Telegram needs access to your contacts… Not now/Continue):
    # жмём ЛЕВУЮ кнопку (Not now) — доступ НЕ даём. Текст содержит contacts/контакт.
    if any(("contact" in (n["t"] or "").lower() or "контакт" in (n["t"] or "").lower()) and len(n["t"]) > 40 for n in ns):
        btns = [n for n in ns if n["clk"] == "true" and n["t"].strip()
                and 0.45 * H < n["cy"] < 0.85 * H and n["w"] < 0.5 * W]
        if len(btns) >= 2:
            btns.sort(key=lambda n: n["cy"])
            row = [b for b in btns if abs(b["cy"] - btns[-1]["cy"]) < 30]
            if len(row) >= 2:
                row.sort(key=lambda n: n["cx"])
                await _tap(gid, row[0]["cx"], row[0]["cy"])   # левая = Not now
                await asyncio.sleep(1.5)
                return True
    # рационейл-попап Telegram («разреши приём звонков/чтение журнала», локализован, ~100-120 симв,
    # 1 кнопка Continue/Fortsetzen справа-внизу карточки) — гасим по позиции, язык-незав.
    # ОДНА текст-кнопка в полосе 0.52-0.72H справа + где-то длинный текст-обоснование (>40 симв).
    cont = [x for x in ns if x["clk"] == "true" and x["t"].strip() and 0.52 * H < x["cy"] < 0.72 * H
            and x["cx"] > 0.55 * W and x["w"] < 0.5 * W]
    if len(cont) == 1 and any(len(x["t"]) > 40 for x in ns) and not _chatlist(ns, W, H):
        await _tap(gid, cont[0]["cx"], cont[0]["cy"])
        await asyncio.sleep(2)
        return True
    # Нижняя шторка Telegram «Turn on notifications» (Android 13+ спрашивает уведомления
    # отдельным разрешением, и Telegram сначала показывает СВОЮ шторку с одной широкой
    # кнопкой Continue у самого низа). Всплывает УЖЕ ПОСЛЕ создания аккаунта, перекрывает
    # нижние табы → детект главного экрана без неё зависает на 90с и ак пишется «без
    # подписок». Правило: одна ШИРОКАЯ кнопка с текстом в самом низу + длинное пояснение.
    wide = [n for n in ns if n["clk"] == "true" and n["t"].strip() and n["w"] > 0.5 * W
            and 0.80 * H < n["cy"] < 0.97 * H]
    if len(wide) == 1 and any(len(x["t"]) > 60 for x in ns) and not _allow_btn(ns) and not _deny_btn(ns):
        _popup_hit(gid, "шторка_снизу")
        await _tap(gid, wide[0]["cx"], wide[0]["cy"])
        await asyncio.sleep(2)
        return True
    # длинный in-app диалог-обоснование (>120 симв) с 2 кнопками — НЕ для контактов (их разрешаем pm grant)
    if any(len(n["t"]) > 120 for n in ns):
        btns = [n for n in ns if n["clk"] == "true" and n["c"] in ("TextView", "Button", "AppCompatTextView")
                and 0.3 * H < n["cy"] < 0.92 * H and n["w"] < 0.5 * W]
        if len(btns) >= 2:
            btns.sort(key=lambda n: n["cy"])
            row = [b for b in btns if abs(b["cy"] - btns[-1]["cy"]) < 30]
            if len(row) >= 2:
                row.sort(key=lambda n: n["cx"])
                await _tap(gid, row[0]["cx"], row[0]["cy"])
                await asyncio.sleep(1.3)
                return True
    return False


async def _continue_pos(gid, ns, W, H):
    """Рационейл-попап (allow calls/read call log): кнопка локализована → жмём по позиции."""
    cont = next((x for x in ns if x["clk"] == "true" and 0.55 * H < x["cy"] < 0.68 * H
                 and x["cx"] > 0.55 * W and x["t"].strip()), None)
    if cont and not _chatlist(ns, W, H):
        await _tap(gid, cont["cx"], cont["cy"])
        await asyncio.sleep(2)
        return True
    return False


# ── номер ───────────────────────────────────────────────────────────────────
async def _fill_number(gid, W, H, phone_e164):
    deadline = time.monotonic() + 60
    nodes = None
    while time.monotonic() < deadline:
        nodes = await _dump(gid)
        if await _handle_interstitial(gid, nodes, W, H):
            continue
        if _classify(nodes, W, H) == "number":
            break
        await asyncio.sleep(2)
    if _classify(nodes or [], W, H) != "number":
        return False
    digits = phone_e164.lstrip("+")
    if digits.startswith("7") and len(digits) == 11:
        cc_code, nat = "7", digits[1:]
    else:
        cc_code, nat = digits[0], digits[1:]
    full_plus = "+" + digits
    ok = False
    for att in range(4):
        ns = await _dump(gid)
        cc, num = _num_fields(ns)
        if num:
            await _tap(gid, num["cx"], num["cy"]); await asyncio.sleep(0.3); await _clear_strong(gid)
        if cc:
            await _tap(gid, cc["cx"], cc["cy"]); await asyncio.sleep(0.3); await _clear_strong(gid)
        await asyncio.sleep(0.4)
        cc, num = _num_fields(await _dump(gid))
        if not cc:
            await asyncio.sleep(1); continue
        if att < 3:
            await _tap(gid, cc["cx"], cc["cy"]); await asyncio.sleep(0.4); await _type_text(gid, full_plus)
        else:
            await _tap(gid, cc["cx"], cc["cy"]); await asyncio.sleep(0.4); await _type_text(gid, "+" + cc_code); await asyncio.sleep(0.7)
            _, num2 = _num_fields(await _dump(gid))
            if num2:
                await _tap(gid, num2["cx"], num2["cy"]); await asyncio.sleep(0.4); await _type_text(gid, nat)
        await asyncio.sleep(0.9)
        e = sorted(_edits(await _dump(gid)), key=lambda n: n["cx"])
        cc_t = re.sub(r"\D", "", e[0]["t"]) if e else ""
        num_t = re.sub(r"\D", "", e[-1]["t"]) if len(e) > 1 else ""
        if cc_t == cc_code and num_t == nat:
            ok = True
            break
    if not ok:
        return False
    done = _find_done(await _dump(gid), W, H)
    if done:
        await _tap(gid, done["cx"], done["cy"])
    else:
        await _key(gid, 66)
    await asyncio.sleep(2.5)
    return True


async def _confirm_number(gid, W, H, nat):
    ns = await _dump(gid)
    tail = nat[-4:]
    if not any(tail in re.sub(r"\D", "", n["t"]) for n in ns if n["t"]):
        return False
    btns = [n for n in ns if n["clk"] == "true" and n["t"].strip() and 0.30 * H < n["cy"] < 0.78 * H and n["w"] < 0.45 * W]
    if len(btns) < 2:
        return False
    btns.sort(key=lambda n: n["cy"])
    row = [b for b in btns if abs(b["cy"] - btns[-1]["cy"]) < 25]
    if len(row) < 2:
        return False
    row.sort(key=lambda n: n["cx"])
    await _tap(gid, row[-1]["cx"], row[-1]["cy"])
    await asyncio.sleep(2.5)
    return True


# ── навигация ───────────────────────────────────────────────────────────────
async def _ensure_fg(gid):
    out = await _sh(gid, "dumpsys window 2>/dev/null | grep -m1 mCurrentFocus")
    if TG in out and ".web" not in out.split(TG)[-1][:6]:
        return True
    await _sh(gid, "monkey -p %s -c android.intent.category.LAUNCHER 1" % TG)
    await asyncio.sleep(3.5)
    return True


async def _normalize_chatlist(gid, W, H):
    for _ in range(10):
        ns = await _dump(gid)
        if await _handle_interstitial(gid, ns, W, H):
            await asyncio.sleep(1); continue
        if _chatlist(ns, W, H):
            return True
        foc = await _sh(gid, "dumpsys window 2>/dev/null | grep -m1 mCurrentFocus")
        if "launcher" in foc.lower():
            await _sh(gid, "monkey -p %s -c android.intent.category.LAUNCHER 1" % TG)
        else:
            await _key(gid, 4)
        await asyncio.sleep(1.8)
    return _chatlist(await _dump(gid), W, H)


async def _open_add_account(gid, W, H):
    await _sh(gid, "monkey -p %s -c android.intent.category.LAUNCHER 1" % TG)
    await asyncio.sleep(3)
    for _ in range(3):
        if not await _normalize_chatlist(gid, W, H):
            return False
        ns = await _dump(gid)
        tabs = _bottom_tabs(ns, W, H)
        if len(tabs) < 3:
            continue
        prof = tabs[-1]
        await _longpress(gid, prof["cx"], prof["cy"])
        await asyncio.sleep(3.5)
        ns = await _dump(gid)
        pop = [n for n in ns if n["clk"] == "true" and n["w"] > 0.3 * W and n["h"] < 0.13 * H and 0.55 * H < n["cy"] < 0.86 * H]
        pop.sort(key=lambda n: n["cy"])
        if not pop:
            continue
        await _tap(gid, pop[0]["cx"], pop[0]["cy"])  # верхний ряд = Add Account (по центру, не плюс)
        await asyncio.sleep(3)
        for _ in range(6):
            ns = await _dump(gid)
            if await _handle_interstitial(gid, ns, W, H):
                await asyncio.sleep(1); continue
            c = _classify(ns, W, H)
            if c == "number":
                return True
            back = _toolbar_back(ns, W, H)
            if back and c in ("code", "pwd_or_code1"):
                await _tap(gid, back["cx"], back["cy"]); await asyncio.sleep(1.6); continue
            await asyncio.sleep(1.5)
    return False


async def _back_to_number(gid, W, H):
    for _ in range(7):
        ns = await _dump(gid)
        if await _handle_interstitial(gid, ns, W, H):
            await asyncio.sleep(1); continue
        dlg = _two_btn_dialog(ns, W, H)
        if dlg:
            await _tap(gid, dlg["cx"], dlg["cy"]); await asyncio.sleep(1.5); continue
        c = _classify(ns, W, H)
        if c == "number":
            return True
        if c == "chatlist":
            return await _open_add_account(gid, W, H)
        await _key(gid, 4)
        await asyncio.sleep(1.6)
    return _classify(await _dump(gid), W, H) == "number"


async def _goto_number(gid, W, H, branch):
    if branch == "add":
        return await _open_add_account(gid, W, H)
    await _ensure_fg(gid)
    ns = await _dump(gid)
    if _real_chatlist(ns, W, H):
        return await _open_add_account(gid, W, H)
    await _sh(gid, "pm clear " + TG)
    await asyncio.sleep(1.5)
    await _ensure_fg(gid)
    deadline = time.monotonic() + 100
    while time.monotonic() < deadline:
        await _ensure_fg(gid)
        ns = await _dump(gid)
        if await _handle_interstitial(gid, ns, W, H):
            continue
        if _real_chatlist(ns, W, H):
            return await _open_add_account(gid, W, H)
        c = _classify(ns, W, H)
        if c in ("number", "sys_perm", "code", "pwd_or_code1"):
            return True
        if not _chatlist(ns, W, H) and not _edits(ns) and not _in_webview(ns):
            # ВЕЛКОМ → форсим АНГЛИЙСКИЙ онбординг (тогда весь флоу англ, минимум локализ. попапов):
            # 1) если есть ссылка «...English» (на не-англ телефоне = «Continue in English») — жмём её;
            # 2) иначе телефон уже англ → жмём ШИРОКУЮ нижнюю кнопку «Start Messaging» (НЕ верхнюю
            #    узкую ссылку «Continuer en français», она увела бы во французский).
            eng = next((n for n in ns if n["clk"] == "true" and "english" in (n["t"] + " " + n["d"]).lower()), None)
            if eng:
                await _tap(gid, eng["cx"], eng["cy"])
            else:
                wb = [n for n in ns if n["clk"] == "true" and n["w"] > 0.4 * W and 0.78 * H < n["cy"] < 0.93 * H]
                if wb:
                    wb.sort(key=lambda n: n["cy"])
                    await _tap(gid, wb[-1]["cx"], wb[-1]["cy"])
        await asyncio.sleep(3)
    return True


# ── подписки ────────────────────────────────────────────────────────────────
async def _subscribe(gid, W, H, channels, sub_n):
    """Подписки на каналы из Настроек: sub_n случайных из списка."""
    chans = random.sample(list(channels), min(int(sub_n), len(channels)))
    done = 0
    for grp in chans:
        try:
            await _sh(gid, f'am start -a android.intent.action.VIEW -d "tg://resolve?domain={grp}" {TG}')
            await asyncio.sleep(4)
            ns = await _dump(gid)
            cand = [n for n in ns if n["clk"] == "true" and 0.87 * H < n["cy"] < 0.96 * H]
            j = next((n for n in cand if (n["d"] or "").strip().lower() in ("join", "subscribe", "подписаться")), None)
            if not j and cand:
                j = max(cand, key=lambda n: n["w"])
            if j and j["w"] > 0.4 * W:
                await _tap(gid, j["cx"], j["cy"]); await asyncio.sleep(2); done += 1
        except Exception as e:
            logger.debug("subscribe %s err: %s", grp, e)
    await _sh(gid, f"am force-stop {TG}; monkey -p {TG} -c android.intent.category.LAUNCHER 1")
    await asyncio.sleep(4)
    return chans, done


# ── настройки Telegram после реги ───────────────────────────────────────────
async def _disable_power_saving(gid, W, H, step, shot):
    """Выключить энергосбережение Telegram: Settings → Power Saving.

    Ползунок «включать экономию при заряде ниже N%» — в крайнее левое положение
    (Off), выключенные пункты «ресурсоёмких процессов» — включаем (энергосбережение
    = их отключение). Экран снят по описанию Telegram Android, на живом телефоне ещё
    не проверялся — поэтому в конце снимаем скрин в историю телефона.
    Сбой НЕ роняет регу: аккаунт уже создан."""
    try:
        await _sh(gid, f'am force-stop {TG}; am start -a android.intent.action.VIEW -d "tg://settings" {TG}')
        await asyncio.sleep(4)
        row = None
        for _ in range(5):
            ns = await _dump(gid)
            if await _handle_interstitial(gid, ns, W, H):
                continue
            row = _ftext(ns, "power saving", "энергосбережение", "battery saving")
            if row:
                break
            # пункт ниже первого экрана настроек — листаем вниз
            await _sh(gid, f"input swipe {W // 2} {int(H * 0.75)} {W // 2} {int(H * 0.35)} 300")
            await asyncio.sleep(1.5)
        if not row:
            await step("энергосбережение", "ok", "пункт Power Saving не найден — пропуск")
            return False
        await _tap(gid, row["cx"], row["cy"])
        await asyncio.sleep(3)
        ns = await _dump(gid)
        seek = next((n for n in ns if "SeekBar" in (n.get("c") or "")), None)
        if seek:
            # крайняя левая точка ползунка = «никогда»
            await _tap(gid, seek["x1"] + max(4, seek["w"] // 50), seek["cy"])
            await asyncio.sleep(1.5)
        turned = 0
        for _ in range(2):
            ns = await _dump(gid)
            offs = sorted([n for n in ns if ("Switch" in n["c"] or "CheckBox" in n["c"])
                           and n.get("chk") == "false"], key=lambda z: z["cy"])
            if not offs:
                break
            # как в _disable_media: у строки бывает два узла переключателя на одном y —
            # тапаем ровно один раз правый
            groups = []
            for n in offs:
                if groups and abs(n["cy"] - groups[-1][-1]["cy"]) <= 25:
                    groups[-1].append(n)
                else:
                    groups.append([n])
            for grp in groups:
                tgt = max(grp, key=lambda z: z["cx"])
                await _tap(gid, tgt["cx"], tgt["cy"])
                await asyncio.sleep(0.6)
                turned += 1
        detail = f"ползунок: {'в ноль' if seek else 'не найден'}, включено пунктов: {turned}"
        await shot("энергосбережение", detail)
        return True
    except Exception as e:  # noqa: BLE001
        await step("энергосбережение", "ok", f"сбой (не критично): {str(e)[:60]}")
        return False


# ── исход диалога после номера ──────────────────────────────────────────────
_FLOOD_WORDS = ("too many", "flood", "try again later", "слишком много", "попробуйте позже",
                "подождите", "please wait")
_BAN_WORDS = ("banned", "заблокирован", "invalid phone", "неверный номер", "phone number is invalid")


def _dialog_kind(ns):
    """Что за двухкнопочный диалог после номера. Раньше любой такой диалог считался
    баном и номер сгорал навсегда — в том числе флуд, который проходит сам."""
    text = " ".join(((n.get("t") or "") + " " + (n.get("d") or "")) for n in ns).lower()
    if any(w in text for w in _FLOOD_WORDS):
        return "flood"
    if any(w in text for w in _BAN_WORDS):
        return "banned"
    return "dialog"


# ── один телефон ────────────────────────────────────────────────────────────
async def _registration_one(job, params, cfg, counter):
    rp = job["runPhoneId"]
    pid = job["phoneId"]
    gid = job.get("geelarkId")

    async def step(name, status, detail=""):
        await api.step(rp, name, status, detail)

    async def shot(tag, detail=""):
        """Скрин в историю телефона (не сбой) — для проверки экрана глазами."""
        await api.phone_event(pid, tag, str(detail)[:200], await grab_screenshot_b64(gid))
        await step(tag, "ok", detail)

    async def fail_shot(tag, detail="", ok=False):
        """Скрин + контекст (IME + передний план) в детали — зацепки сразу в истории.
        ok=True — снять скрин на НЕ-сбое (бан/уже_зареган), статус шага не «failed»."""
        ctx = ""
        try:
            ctx = f" [IME={await _ime(gid)} fg={await _fg(gid)}]"
        except Exception:  # noqa: BLE001
            ctx = ""
        full = (str(detail) + ctx)[:200]
        await api.phone_event(pid, tag, full, await grab_screenshot_b64(gid))
        await step(tag, "ok" if ok else "failed", full)

    if not gid:
        await api.run_phone(rp, status="failed", error="нет профиля GeeLark")
        return
    info = await api.phone(pid)
    if info.get("hasAccount"):
        await api.run_phone(rp, status="skipped", error="на телефоне уже есть аккаунт")
        return
    # Номера или почты кончились — телефон не включаем: подъём стоит денег
    pool = await api.config()
    if not pool.get("lines") or not pool.get("freeEmails"):
        await api.run_phone(rp, status="skipped",
                            error="нет свободных номеров в транках" if not pool.get("lines")
                            else "нет свободных почт")
        return
    await api.run_phone(rp, status="running")

    err_per_phone = max(1, int(params.get("errors_per_phone", 8)))
    done = 0
    err = None
    open_acc = None          # попытка, которую надо закрыть, если сценарий оборвётся

    async def release(outcome):
        nonlocal open_acc
        if open_acc:
            await api.fail(open_acc, outcome)
            open_acc = None

    try:
        px = await api.ensure_proxy(pid)   # мёртвый прокси → новая сессия Proxyma ДО старта
        if px:
            await step("прокси", "ok" if px.get("ok", True) else "failed", px.get("detail", ""))
        if not await _power_on(gid, step):
            err = "не включился"
            raise RuntimeError(err)
        # ПРОБА ТРАНСПОРТА — строго ДО первого _dump: часть образов (A14) режет вывод
        # shell на 2000 символов, и без gzip-режима дамп приходит обрубком (см. _dump).
        capped = await _probe_shell_cap(gid)
        _POPUPS.pop(gid, None)          # счётчик попапов — на каждое включение свой
        # 3 отказа в начале реги: системные диалоги разрешений отклоняем, пока аккаунт
        # не создан (см. _handle_interstitial + _grant_post_reg).
        _DENY_MODE[gid] = True
        # дождаться валидного UI
        for _ in range(30):
            if len(await _dump(gid)) > 3:
                break
            await asyncio.sleep(4)
        await _sh(gid, "svc power stayon true; settings put system screen_off_timeout 1800000")
        # ADBKeyboard обязательна для кириллического имени. На A14-образе пакета нет —
        # _ensure_adb_keyboard сам качает и ставит APK.
        kb_ok = await _ensure_adb_keyboard(gid, step)
        # Telegram ставит предустановщик GeeLark уже после включения — ждём его,
        # и ДО того, как взят номер: без приложения номер сгорел бы впустую.
        if not await _ensure_tg_present(gid, step):
            err = "Telegram не установлен"
            raise RuntimeError(err)
        wm = await _sh(gid, "wm size")
        mm = re.search(r"(\d+)x(\d+)", wm)
        W, H = (int(mm.group(1)), int(mm.group(2))) if mm else (BASE_W, BASE_H)
        await step("подготовка", "ok" if kb_ok else "failed",
                   f"экран {W}x{H}, обрезка вывода shell: {'ДА (gzip-дамп)' if capped else 'нет'}, "
                   f"ADBKeyboard: {'ок' if kb_ok else 'НЕТ'}")

        async def start_session():
            """Комплект реги: номер + почта + профиль. Все линии заняты — ждём
            (телефон уже включён, гасить и поднимать заново дороже). Нет номеров
            или почт вовсе — ждать бесполезно, сдаёмся сразу."""
            t0 = time.monotonic()
            dl = t0 + SESS_WAIT_SEC
            noted = False
            while time.monotonic() < dl:
                sess, why = await api.assign(pid)
                if sess:
                    counter["taken"] += 1
                    return sess, None
                if why in ("no_free_numbers", "no_resources_available"):
                    return None, why
                if not noted and time.monotonic() - t0 >= 20:
                    noted = True
                    await step("сессия_ждём", "ok", f"все линии заняты, ждём до {int(SESS_WAIT_SEC)}с")
                await asyncio.sleep(3)
            return None, "all_lines_busy"

        def remaining(started_iso):
            # Замок транка держится 9 минут — укладываемся в 8 с запасом
            import datetime as _dt
            try:
                st = _dt.datetime.fromisoformat(str(started_iso).replace("Z", "+00:00"))
            except Exception:  # noqa: BLE001
                return 300.0
            left = 9 * 60 - (_dt.datetime.now(_dt.timezone.utc) - st).total_seconds()
            return max(0.0, left - 60)

        phone_errors = 0   # ошибки на ЭТОМ телефоне → при err_per_phone стоп
        acc_idx = 1
        await step(f"ак#{acc_idx}", "ok", "ветка fresh")
        result = None
        info = None
        is_warmed = False
        ok_chat = False
        entered = ("", "")
        if not await _goto_number(gid, W, H, "fresh"):
            await fail_shot(f"нет_экрана_номера#{acc_idx}", "fresh")
            phone_errors += 1
            result = "нет экрана номера"
        # цикл по номерам: новый номер, пока есть бюджет ошибок телефона
        while result is None and phone_errors < err_per_phone:
            sess, why = await start_session()
            if not sess:
                result = {"no_free_numbers": "нет свободных номеров",
                          "no_resources_available": "нет свободных почт"}.get(why, "все линии заняты")
                break
            pn = re.sub(r"\D", "", str(sess.get("phone_number") or "")); email = sess.get("email") or ""
            fn = sess.get("first_name") or ""; ln = sess.get("last_name") or ""
            uname = sess.get("username") or ""; acc_id = sess.get("account_id")
            started = sess.get("started_at") or ""
            open_acc = acc_id
            nat = pn[1:] if pn.startswith("7") and len(pn) == 11 else pn
            info = (pn, email, fn, ln, uname, acc_id)
            await step(f"номер#{acc_idx}", "ok", f"{pn} {uname} (транк {sess.get('trunk_name') or '?'})")
            if not await _fill_number(gid, W, H, "+" + pn):
                await fail_shot(f"номер_не_введён#{acc_idx}", pn)
                # номер отпускаем (на паузу, чтобы не долбить один и тот же) + жёсткий
                # ресет экрана: _back_to_number может не вернуть → _goto_number
                await release("stuck"); await asyncio.sleep(1)
                phone_errors += 1
                if not await _back_to_number(gid, W, H):
                    await _goto_number(gid, W, H, "fresh")
                continue
            await _confirm_number(gid, W, H, nat)
            outcome = None; okbtn = None; email_nodes = None; dkind = None
            # Ответа Telegram ждём до 120 с: телефоны на резидентских прокси, и запрос
            # после «Готово» регулярно идёт дольше 40 с (спиннер на кнопке).
            dl = time.monotonic() + 120
            t_num = time.monotonic()
            while time.monotonic() < dl:
                ns = await _dump(gid)
                if await _handle_interstitial(gid, ns, W, H):
                    continue
                if await _confirm_number(gid, W, H, nat):
                    await asyncio.sleep(1); continue
                cc = _classify(ns, W, H)
                shown = [n["t"] for n in ns if "@" in n["t"] and "." in n["t"]]
                # Почту ещё не вводили, а уже экран кода → номер УЖЕ зарегистрирован:
                # Telegram отправил код в приложение на другом устройстве.
                if cc == "code" and email and not any(
                        email.lower() in (t or "").lower() for t in shown):
                    outcome = "уже_зареган"; break
                dlg = _two_btn_dialog(ns, W, H)
                if dlg:
                    dkind = _dialog_kind(ns)
                    outcome = {"flood": "флуд", "banned": "бан"}.get(dkind, "диалог")
                    okbtn = dlg; break
                if cc in ("pwd_or_code1", "code") or (cc == "other" and any("@" in n["t"] or "mail" in n["t"].lower() for n in ns)):
                    outcome = "email"; email_nodes = ns
                    _t = time.monotonic() - t_num
                    if _t > 35:
                        await step(f"почта_дождались#{acc_idx}", "ok", f"экран почты через {_t:.0f}с")
                    break
                await asyncio.sleep(2)
            if outcome in ("бан", "уже_зареган", "флуд", "диалог"):
                await fail_shot(f"номер#{acc_idx}", f"{pn} = {outcome} → новый", ok=outcome != "диалог")
                if okbtn:
                    await _tap(gid, okbtn["cx"], okbtn["cy"]); await asyncio.sleep(2)
                await release({"бан": "banned", "уже_зареган": "already_registered",
                               "флуд": "flood"}.get(outcome, "stuck"))
                await asyncio.sleep(2)
                phone_errors += 1; await _back_to_number(gid, W, H); continue
            if outcome != "email":
                await fail_shot(f"застрял_после_номера#{acc_idx}",
                                f"{outcome} после {time.monotonic()-t_num:.0f}с ожидания")
                await release("stuck"); await asyncio.sleep(2)
                phone_errors += 1
                if not await _back_to_number(gid, W, H):
                    await _goto_number(gid, W, H, "fresh")
                continue
            # ПОЧТА
            e = _edits(email_nodes)
            if not e:
                await fail_shot(f"почта_без_поля#{acc_idx}")
                await release("stuck")
                result = "почта без поля"; break
            await _tap(gid, e[0]["cx"], e[0]["cy"]); await asyncio.sleep(0.5); await _clear_field(gid); await _type_text(gid, email); await asyncio.sleep(1)
            d2 = _find_done(await _dump(gid), W, H)
            if d2:
                await _tap(gid, d2["cx"], d2["cy"])
            else:
                await _key(gid, 66)
            await asyncio.sleep(3)
            # КОД ПОЧТЫ (≤90 с). Сервис сам ходит в ящик через прокси почты
            code = None; imap_err = None
            dlc = time.monotonic() + min(90.0, remaining(started))
            while time.monotonic() < dlc:
                r = await api.email_code(acc_id)
                if r.get("failed"):
                    break
                if r.get("code"):
                    code = r["code"]; break
                if r.get("imapError"):
                    imap_err = r["imapError"]
                await _dump(gid); await asyncio.sleep(3)
            if not code:
                await fail_shot(f"нет_кода_почты#{acc_idx}", f"IMAP: {imap_err[:80]}" if imap_err else "")
                await release("no_email_code"); await asyncio.sleep(2)
                phone_errors += 1; await _back_to_number(gid, W, H); continue
            await step(f"код_почты#{acc_idx}", "ok", str(code))
            await _enter_code(gid, code, W, H)
            # ВЕРИФИКАЦИЯ ввода: тапы слепые — если экран кода ПОЧТЫ (с нашим email)
            # никуда не ушёл, клетки не приняли → один повторный ввод
            ns = await _dump(gid)
            if _classify(ns, W, H) == "code" and any(email.lower() in (n["t"] or "").lower() for n in ns):
                await step(f"код_почты#{acc_idx}", "ok", "клетки не приняли — повторный ввод")
                await _enter_code(gid, code, W, H)
            await asyncio.sleep(2)
            # КОД ЗВОНКА: Telegram звонит на номер → Asterisk → SpeechKit → цифры.
            # Звонок и код привязаны к этой попытке, чужой код сюда не попадёт.
            tcode = None; bad = False; bad_reason = ""
            dlt = time.monotonic() + min(200.0, remaining(started))
            _t_call = time.monotonic(); _hb = 0; _lastcur = None; _seen_call = False
            while time.monotonic() < dlt:
                r = await api.call_code(acc_id)
                if r.get("failed"):
                    bad = True; bad_reason = r.get("reason") or "failed"; break
                if r.get("hasCall") and not _seen_call:
                    _seen_call = True
                    await step(f"звонок#{acc_idx}", "ok",
                               f"пришёл через {int(time.monotonic() - _t_call)}с, расшифровка…")
                cur = r.get("code")
                if cur:
                    _seen_call = True
                    # код из одного чтения может быть обрезком потока — берём, когда
                    # он не изменился со следующего чтения
                    if cur == _lastcur:
                        tcode = cur
                        break
                    _lastcur = cur
                else:
                    _lastcur = None
                ns = await _dump(gid)
                if _two_btn_dialog(ns, W, H):
                    bad = True; bad_reason = "диалог на экране"; break
                _el = int(time.monotonic() - _t_call)
                if _el - _hb >= 40:
                    await step(f"звонок_ждём#{acc_idx}", "ok", f"+{_el}с (бюджет {int(dlt - _t_call)}с)")
                    _hb = _el
                await asyncio.sleep(3)
            if bad or not tcode:
                why_txt = bad_reason or ("звонок был, кода нет" if _seen_call else "звонка нет")
                await fail_shot(f"звонок_не_удался#{acc_idx}", why_txt)
                # нераспознанный код сервис уже закрыл сам; иначе — «нет звонка»
                await release("stuck" if _seen_call else "no_call"); await asyncio.sleep(2)
                phone_errors += 1; await _back_to_number(gid, W, H); continue
            await step(f"код_звонка#{acc_idx}", "ok", f"{tcode} (за +{int(time.monotonic() - _t_call)}с)")
            await _enter_code(gid, tcode, W, H); await asyncio.sleep(3)
            # ИМЯ / прогретый: после кода либо ЭКРАН ИМЕНИ (свежий ак), либо ЧАТЛИСТ
            # (попали на уже существующий аккаунт этого номера — доводим как свой)
            is_warmed = False
            twofa = False
            name_entered = False
            tcode_reentered = False
            ns = await _dump(gid)
            for _i in range(25):
                if _pwd_screen(ns):
                    twofa = True; break
                if _edits(ns) and not _chatlist(ns, W, H):
                    break
                if _real_chatlist(ns, W, H):
                    is_warmed = True; break
                if await _handle_interstitial(gid, ns, W, H):
                    ns = await _dump(gid); continue
                if not tcode_reentered and _i >= 4 and _classify(ns, W, H) == "code":
                    tcode_reentered = True
                    await step(f"код_звонка#{acc_idx}", "ok", "экран кода не ушёл — повторный ввод")
                    await _enter_code(gid, tcode, W, H)
                    ns = await _dump(gid); continue
                await asyncio.sleep(2); ns = await _dump(gid)
            if twofa:
                # номер УЖЕ зарегистрирован с облачным паролем — пройти нельзя
                await fail_shot(f"номер#{acc_idx}", f"{pn} = 2FA (уже зареган) → новый", ok=True)
                await release("twofa"); await asyncio.sleep(2)
                phone_errors += 1; await _back_to_number(gid, W, H); continue
            if is_warmed:
                await fail_shot(f"warmed#{acc_idx}",
                                "попали на существующий аккаунт номера — доводим как свой", ok=True)
            elif _edits(ns) and not _chatlist(ns, W, H):
                ev = sorted(_edits(ns), key=lambda n: n["cy"])
                await step(f"имя#{acc_idx}", "ok", f"экран имени, ввожу '{fn} {ln}', IME={await _ime(gid)}")
                # Ввод имени, 3 попытки С ПРОВЕРКОЙ: №1 кириллица B64 (ADBKeyboard),
                # №2-№3 латиницей из username через `input text` (IME-независимо).
                lat_fn, lat_ln = _latin_name(uname, fn, ln)
                use_fn, use_ln = fn, ln
                got = ""; tries = 0
                await _setkb(gid)
                for tries in range(1, 4):
                    if tries > 1:
                        use_fn, use_ln = lat_fn, lat_ln
                    await _tap(gid, ev[0]["cx"], ev[0]["cy"]); await asyncio.sleep(0.6)
                    # пауза между очисткой и вводом обязательна: keyevent'ы очистки
                    # обрабатываются асинхронно и стирали уже вставленный текст
                    await _clear_strong(gid); await asyncio.sleep(0.8)
                    await _type_text(gid, use_fn); await asyncio.sleep(1.2)
                    ev2 = sorted(_edits(await _dump(gid)), key=lambda n: n["cy"])
                    got = ((ev2[0]["t"] if ev2 else "") or "").strip()
                    if got:
                        break
                await step(f"имя_ввод#{acc_idx}", "ok" if got else "failed",
                           f"в поле='{got[:20]}' ({'латиница' if tries > 1 else 'кириллица'}) "
                           f"IME={await _ime(gid)} попыток={tries}")
                name_entered = bool(got)
                entered = (use_fn, use_ln)
                if len(ev) >= 2:
                    await _tap(gid, ev[1]["cx"], ev[1]["cy"]); await asyncio.sleep(0.4)
                    await _clear_strong(gid); await asyncio.sleep(0.8); await _type_text(gid, use_ln)
                d3 = _find_done(await _dump(gid), W, H)
                if d3:
                    await _tap(gid, d3["cx"], d3["cy"])
                else:
                    await _key(gid, 66)
                await asyncio.sleep(3)
            # Аккаунт создан на вводе имени. Ищем ГЛАВНЫЙ экран (нижние табы); после
            # создания на разрешения соглашаемся — снимаем режим отказов ЗДЕСЬ.
            _DENY_MODE[gid] = False
            ok_chat = False
            last_ns = None
            relaunched = False
            dl2 = time.monotonic() + 90
            while time.monotonic() < dl2:
                # выход из любой шторки: главный экран не опознан дольше половины
                # бюджета — перезапускаем Telegram (аккаунт уже создан, это безопасно)
                if not relaunched and time.monotonic() > dl2 - 45:
                    relaunched = True
                    await step(f"рестарт_TG#{acc_idx}", "ok",
                               "главный экран не опознан — перезапускаю Telegram")
                    await _sh(gid, f"am force-stop {TG}; "
                                   f"monkey -p {TG} -c android.intent.category.LAUNCHER 1")
                    await asyncio.sleep(6)
                    continue
                ns = await _dump(gid); last_ns = ns
                # языковой попап: RadioButton'ы + OK справа-снизу карточки (по позиции)
                radios = [n for n in ns if "RadioButton" in (n.get("c") or "")]
                if radios:
                    rb_bottom = max(n["cy"] for n in radios)
                    cand = [n for n in ns if (n.get("t") or "").strip() and n["cx"] > 0.55 * W
                            and rb_bottom < n["cy"] < 0.80 * H]
                    okb = min(cand, key=lambda n: n["cy"]) if cand else None
                    ox, oy = ((okb["cx"], okb["cy"]) if okb
                              else (int(0.80 * W), int(min(rb_bottom + 0.065 * H, 0.78 * H))))
                    await _tap(gid, ox, oy); await asyncio.sleep(2); continue
                if await _handle_interstitial(gid, ns, W, H):
                    continue
                if _real_chatlist(ns, W, H) or (_native_tg(ns) and len(_bottom_tabs(ns, W, H)) >= 3):
                    ok_chat = True; break
                await asyncio.sleep(2)
            if not ok_chat:
                ns = last_ns if last_ns is not None else await _dump(gid)
                if _native_tg(ns) and len(_bottom_tabs(ns, W, H)) >= 3:
                    ok_chat = True
            if not ok_chat and name_entered:
                # имя ввелось → аккаунт реально создан, просто застряли на попапе
                await fail_shot(f"нет_главного_записан#{acc_idx}",
                                "главный экран не опознан, но имя ввелось → аккаунт записан", ok=True)
                result = "ok"; break
            if not ok_chat and not is_warmed:
                await fail_shot(f"нет_главного_экрана#{acc_idx}")
                await release("stuck")
                phone_errors += 1; await _back_to_number(gid, W, H); continue
            result = "ok"; break

        if result == "ok" and info:
            pn, email, fn, ln, uname, acc_id = info
            _DENY_MODE[gid] = False
            pops = _POPUPS.get(gid) or {}
            await step("попапы", "ok", ", ".join(f"{k}×{v}" for k, v in sorted(pops.items())) or "не было")
            # Записываем аккаунт СРАЗУ, до доводки: что бы ни случилось дальше,
            # номер и телефон уже связаны
            if await api.complete(acc_id, pid):
                open_acc = None
            done += 1
            await step(f"ак#{acc_idx}", "ok",
                       ("попали на существующий, зареган " if is_warmed else
                        ("⚠ главный экран не опознан, зареган " if not ok_chat else "зареган ")) + f"{pn} {uname}")
            if not is_warmed and entered[0] and entered[0] != fn:
                # имя ушло латиницей — так и запишем, пока не поправим ниже
                await api.set_account(pid, firstName=entered[0], lastName=entered[1])
            await _grant_post_reg(gid, step)
            # Доводка — через диплинки tg://settings, главный экран ей не нужен
            u_ok = await _set_username(gid, W, H, uname, step)
            if u_ok:
                await api.set_account(pid, username=uname)
            n_ok = await _fix_cyrillic_name(gid, W, H, fn, ln, step) if u_ok else False
            if n_ok:
                await api.set_account(pid, firstName=fn, lastName=ln)
            if cfg.get("disableMedia", True):
                await _disable_media(gid, W, H, step)
            if cfg.get("disablePowerSaving", True):
                await _disable_power_saving(gid, W, H, step, shot)
            channels = [c for c in (cfg.get("channels") or []) if c]
            sub_n = int(cfg.get("subscribeCount") or 0)
            if channels and sub_n > 0:
                chans, sd = await _subscribe(gid, W, H, channels, sub_n)
                await step(f"подписки#{acc_idx}", "ok", f"{sd}/{len(chans)}: " + ",".join(chans))
            else:
                await step(f"подписки#{acc_idx}", "ok", "каналы не заданы — пропуск")
        else:
            if result is None:
                result = f"{phone_errors} ошибок — поток телефона завершён"
            err = result
            await step(f"ак#{acc_idx}", "failed", result)
    except asyncio.CancelledError:
        await step("cancel", "failed", "запуск остановлен")
        err = "запуск остановлен"
        raise
    except Exception as e:  # noqa: BLE001
        logger.exception("registration %s error: %s", pid, e)
        err = err or str(e)
    finally:
        # Попытка, оборванная на полпути, возвращает номер и почту в пул
        try:
            await release("canceled")
        except BaseException:  # noqa: BLE001
            pass
        _POPUPS.pop(gid, None)
        _DENY_MODE.pop(gid, None)
        _SHELL_CAP.pop(gid, None)
        off_ok = await _power_off(gid)
        if not off_ok:   # power_off сам ретраит 3×; не вышло → пауза и ещё заход (биллинг!)
            await asyncio.sleep(8)
            off_ok = await _power_off(gid)
        await step("power_off", "ok" if off_ok else "failed",
                   "выключен" if off_ok else "⚠ НЕ ВЫКЛЮЧИЛСЯ — проверь руками в GeeLark!")
        if done > 0:
            await api.run_phone(rp, status="ok", error=err)
        else:
            await api.run_phone(rp, status="failed", error=err or "аккаунт не создан")


# ── запуск ──────────────────────────────────────────────────────────────────
async def run_registration(run: dict, cfg: dict):
    """Запуск: телефоны параллельно, но не больше, чем линий (транков со свободными
    номерами) — звонок с кодом узнаём по транку, одна рега на транк за раз."""
    phones = run.get("phones") or []
    lines = max(1, int(cfg.get("lines") or 0))
    conc = max(1, min(int(run.get("concurrency") or 1), lines))
    sem = asyncio.Semaphore(conc)
    counter = {"taken": 0}
    params = {"errors_per_phone": run.get("errorsPerPhone") or 8}
    logger.info("run %s: %d телефонов, параллельно %d (линий %d)", run.get("id"), len(phones), conc, lines)

    async def worker(job):
        async with sem:
            try:
                await _registration_one(job, params, cfg, counter)
            except asyncio.CancelledError:
                raise
            except Exception as e:  # noqa: BLE001
                logger.exception("reg worker %s crashed: %s", job.get("phoneId"), e)
                await api.run_phone(job["runPhoneId"], status="failed", error=str(e)[:300])

    await asyncio.gather(*(worker(j) for j in phones))
