"""Воркер: забирает запуски из очереди API и крутит сценарии на телефонах —
регистрацию новых аккаунтов и восстановление входа в вылетевшие.

Входящих соединений нет — только исходящие к API сервиса и к GeeLark.
Одновременно идёт по одному запуску каждого вида (так раздаёт API).
Остановка запуска из кабинета: API ставит статус canceling, воркер видит его
в течение 5 секунд, отменяет задачу, и каждый телефон гасится в finally.
"""
import asyncio
import logging
import os

from reg import api
from reg import geelark as gl
from reg.phone import power_off
from reg.restore import run_restore
from reg.scenario import run_registration

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("worker")
# httpx пишет каждый запрос (опрос очереди — раз в 5 с), это шум
logging.getLogger("httpx").setLevel(logging.WARNING)

POLL_S = 5


async def _apply_config() -> dict:
    cfg = await api.config()
    gl.set_credentials(cfg.get("geelarkApiKey"), cfg.get("geelarkBaseUrl"))
    return cfg


async def _recover() -> None:
    """Прошлый процесс мог умереть посреди запуска: телефоны остались включены
    и капает оплата. API отдаёт их — гасим."""
    gids = await api.recover()
    if not gids:
        return
    await _apply_config()
    logger.warning("после перезапуска гашу телефоны прерванного запуска: %d", len(gids))
    for gid in gids:
        try:
            await power_off(gid)
        except Exception as e:  # noqa: BLE001
            logger.warning("не погасил %s: %s", gid, e)


async def _run_one(run: dict) -> None:
    run_id = run["id"]
    cfg = await _apply_config()
    if not cfg.get("geelarkApiKey"):
        for job in run.get("phones") or []:
            await api.run_phone(job["runPhoneId"], status="failed", error="не задан ключ GeeLark")
        await api.finish_run(run_id)
        return
    runner = run_restore if run.get("kind") == "restore" else run_registration
    task = asyncio.create_task(runner(run, cfg))
    while not task.done():
        await asyncio.wait({task}, timeout=POLL_S)
        if not task.done() and await api.run_status(run_id) in ("canceling", "canceled"):
            logger.info("run %s: остановлен из кабинета", run_id)
            task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
    except Exception as e:  # noqa: BLE001
        logger.exception("run %s упал: %s", run_id, e)
    await api.finish_run(run_id)


async def main() -> None:
    if not api.TOKEN:
        raise SystemExit("INTERNAL_TOKEN не задан")
    # API может подниматься дольше воркера — ждём его
    while not await api.config():
        logger.info("жду API %s", api.API_BASE)
        await asyncio.sleep(POLL_S)
    await _recover()
    logger.info("воркер готов, жду запуски")
    active: dict[str, asyncio.Task] = {}
    while True:
        for run_id, task in list(active.items()):
            if task.done():
                active.pop(run_id)
        try:
            run = await api.claim_run()
            if run:
                logger.info("run %s (%s): телефонов %d", run["id"], run.get("kind"),
                            len(run.get("phones") or []))
                active[run["id"]] = asyncio.create_task(_run_one(run))
                continue        # вдруг в очереди есть запуск другого вида
        except Exception as e:  # noqa: BLE001
            logger.exception("цикл воркера: %s", e)
        await asyncio.sleep(POLL_S)


if __name__ == "__main__":
    asyncio.run(main())
