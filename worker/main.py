"""Воркер регистрации: забирает запуски из очереди API и крутит сценарий на телефонах.

Входящих соединений нет — только исходящие к API сервиса и к GeeLark.
Остановка запуска из кабинета: API ставит статус canceling, воркер видит его
в течение 5 секунд, отменяет задачу, и каждый телефон гасится в finally.
"""
import asyncio
import logging
import os

from reg import api
from reg import geelark as gl
from reg.phone import power_off
from reg.scenario import run_registration

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("worker")

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
    task = asyncio.create_task(run_registration(run, cfg))
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
    while True:
        try:
            run = await api.claim_run()
            if run:
                logger.info("run %s: телефонов %d", run["id"], len(run.get("phones") or []))
                await _run_one(run)
                continue
        except Exception as e:  # noqa: BLE001
            logger.exception("цикл воркера: %s", e)
        await asyncio.sleep(POLL_S)


if __name__ == "__main__":
    asyncio.run(main())
