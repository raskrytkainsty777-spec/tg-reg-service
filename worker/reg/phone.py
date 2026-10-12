"""Телефон GeeLark: shell, включение, выключение, скриншот, наличие Telegram.

Перенесено из farm-adb (engine/tasks.py) — только то, что нужно регистрации.
"""
import asyncio
import base64
import logging
import time
from datetime import datetime, timezone

import httpx

from . import geelark as gl

logger = logging.getLogger(__name__)

TG_PKG = "org.telegram.messenger"
ADB_KB = "com.android.adbkeyboard"             # на A15-образах GeeLark предустановлена (hidden)
ADB_IME = "com.android.adbkeyboard/.AdbIME"

# GeeLark отдаёт это ВМЕСТО вывода, когда споткнулся транспорт
SHELL_FALSE_ERR = "执行出错"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _phone_status_code(data: dict, gid: str):
    for d in (data.get("successDetails") or []):
        if d.get("id") == gid:
            return d.get("status")
    return None


async def _wait_running(gid: str, timeout: float = 150.0):
    """Поллить phone_status до status==0 (running). Вернёт последний статус."""
    deadline = time.monotonic() + timeout
    code = None
    while time.monotonic() < deadline:
        try:
            code = _phone_status_code(await gl.phone_status([gid]), gid)
        except gl.GeelarkError:
            code = None
        if code == 0:
            return 0
        await asyncio.sleep(5)
    return code


async def sh(gid: str, cmd: str, timeout: float = 90.0, retries: int = 2) -> str:
    """shell_execute → строка output ('' при ошибке).

    ⚠️ Транспорт GeeLark периодически возвращает ЛОЖНОЕ «执行出错» вместо реального
    вывода — команда при этом отрабатывает. Поэтому ложную ошибку ретраим.
    """
    out = ""
    for attempt in range(retries + 1):
        try:
            r = await gl.shell_execute(gid, cmd, timeout=timeout)
            out = str(r.get("output") or "")
        except Exception as e:  # noqa: BLE001
            logger.debug("shell %s failed on %s: %s", cmd[:40], gid, e)
            out = ""
        if SHELL_FALSE_ERR not in out:
            return out
        if attempt < retries:
            await asyncio.sleep(1.5 * (attempt + 1))
    return out


async def power_on(gid: str, log, attempts: int = 3) -> bool:
    """Включить телефон и дождаться running. До 3 попыток.

    Одной попытки МАЛО: GeeLark иногда молча не применяет старт (status=2 после
    150 с ожидания). status=1 — телефон уже грузится, повторный старт не шлём.
    """
    try:
        code = _phone_status_code(await gl.phone_status([gid]), gid)
    except gl.GeelarkError:
        code = None
    if code == 0:
        await log("power_on", "ok", "уже включён")
        return True
    last = None
    for att in range(1, attempts + 1):
        if last != 1:
            try:
                await gl.phone_start([gid])
            except gl.GeelarkError as e:
                last = None
                if att >= attempts:
                    await log("power_on", "failed", e.msg)
                    return False
                await asyncio.sleep(5)
                continue
        final = await _wait_running(gid)
        if final == 0:
            await log("power_on", "ok", "включён" if att == 1 else f"включён с {att}-й попытки")
            return True
        last = final
        if att < attempts:
            await asyncio.sleep(5)
    await log("power_on", "failed", f"не вышел в running за {attempts} попытки (status={last})")
    return False


async def power_off(gid: str) -> bool:
    """Выключить телефон и ПРОВЕРИТЬ, что реально off (биллинг поминутный!).
    2 = выключен, 3 = просрочен — не биллятся."""
    for attempt in range(3):
        try:
            await gl.phone_stop([gid])
        except Exception:  # noqa: BLE001
            pass
        await asyncio.sleep(3 if attempt == 0 else 5)
        try:
            code = _phone_status_code(await gl.phone_status([gid]), gid)
        except Exception:  # noqa: BLE001
            code = None
        if code in (2, 3):
            return True
    try:
        code = _phone_status_code(await gl.phone_status([gid]), gid)
    except Exception:  # noqa: BLE001
        code = None
    if code not in (2, 3):
        logger.warning("power_off: телефон %s НЕ выключился (status=%s)", gid, code)
        return False
    return True


async def grab_screenshot_b64(gid: str) -> str | None:
    """Скрин телефона → PNG base64. GeeLark отдаёт ссылку, которая живёт ~100 минут,
    поэтому скачиваем байты сразу."""
    try:
        tid = await gl.screenshot_start(gid)
        link = ""
        for _ in range(15):
            r = await gl.screenshot_result(tid)
            if r.get("status") == 2:
                link = r.get("downloadLink") or r.get("url") or ""
                break
            await asyncio.sleep(2)
        if not link:
            return None
        async with httpx.AsyncClient(timeout=30) as h:
            resp = await h.get(link)
            resp.raise_for_status()
            return base64.b64encode(resp.content).decode()
    except Exception as e:  # noqa: BLE001
        logger.warning("grab_screenshot_b64 failed for %s: %s", gid, e)
        return None


async def ensure_tg_present(gid: str, log, wait_s: float = 90.0) -> bool:
    """Telegram на телефонах GeeLark ставит предустановщик — уже ПОСЛЕ включения,
    секунд за 10–60. Поэтому не проверяем один раз, а ждём появления пакета.

    Проверяем двумя способами: одиночный `pm path` неотличим от ложной ошибки
    транспорта, `pm list packages` — второй источник правды."""
    t0 = time.monotonic()
    noted = False
    while True:
        if "package:" in await sh(gid, f"pm path {TG_PKG}"):
            took = int(time.monotonic() - t0)
            await log("telegram", "ok", "установлен" if took < 3 else f"установился за {took} с")
            return True
        if TG_PKG in await sh(gid, f"pm list packages | grep -m1 -x package:{TG_PKG}"):
            # пакет есть, но мог быть «удалён для пользователя»
            await sh(gid, f"cmd package install-existing {TG_PKG}")
            if "package:" in await sh(gid, f"pm path {TG_PKG}"):
                await log("telegram", "ok", "поднят через install-existing")
                return True
        if time.monotonic() - t0 > wait_s:
            break
        if not noted:
            noted = True
            await log("telegram", "ok", "ещё не установлен — ждём предустановщик GeeLark")
        await asyncio.sleep(3)
    await log("telegram", "failed", f"{TG_PKG} не появился за {int(wait_s)} с")
    return False
