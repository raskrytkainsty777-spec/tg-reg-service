"""Клиент к API сервиса (ручки /api/internal/worker/*, токен INTERNAL_TOKEN).

Всё состояние — запуски, шаги, попытки реги, аккаунты — живёт в базе API.
Воркер своего хранилища не держит: перезапустился — продолжает с чистого листа.
"""
import asyncio
import logging
import os

import httpx

logger = logging.getLogger(__name__)

API_BASE = os.environ.get("API_URL", "http://app:3000/api").rstrip("/")
TOKEN = os.environ.get("INTERNAL_TOKEN", "").strip()

_client: httpx.AsyncClient | None = None


def _http() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(
            base_url=API_BASE + "/internal/worker",
            headers={"X-Internal-Token": TOKEN},
            timeout=httpx.Timeout(60.0),
        )
    return _client


async def _call(method: str, path: str, json: dict | None = None, retries: int = 3,
                ok_codes: tuple = ()) -> tuple[int, dict]:
    """Запрос к API. Сетевые сбои и 5xx повторяем — API могли перезапустить."""
    last_exc = None
    for attempt in range(retries):
        try:
            r = await _http().request(method, path, json=json)
            if r.status_code >= 500 and attempt < retries - 1:
                await asyncio.sleep(2 * (attempt + 1))
                continue
            try:
                body = r.json()
            except Exception:  # noqa: BLE001
                body = {}
            if r.status_code >= 400 and r.status_code not in ok_codes:
                logger.warning("API %s %s → %s %s", method, path, r.status_code, str(body)[:200])
            return r.status_code, body if isinstance(body, dict) else {}
        except (httpx.TransportError, httpx.TimeoutException) as e:
            last_exc = e
            await asyncio.sleep(2 * (attempt + 1))
    logger.warning("API %s %s недоступен: %s", method, path, last_exc)
    return 0, {}


# ── настройки и запуски ──────────────────────────────────────────────────────
async def config() -> dict:
    return (await _call("GET", "/config"))[1]


async def claim_run() -> dict | None:
    return (await _call("POST", "/runs/claim"))[1].get("run")


async def run_status(run_id: str) -> str:
    code, body = await _call("GET", f"/runs/{run_id}", retries=1)
    return body.get("status") or ("running" if code == 0 else "canceled")


async def finish_run(run_id: str) -> None:
    await _call("POST", f"/runs/{run_id}/finish")


async def recover() -> list[str]:
    return (await _call("POST", "/runs/recover"))[1].get("geelarkIds") or []


async def run_phone(run_phone_id: str, **fields) -> None:
    await _call("POST", f"/run-phones/{run_phone_id}", json=fields)


async def step(run_phone_id: str, name: str, status: str, detail: str = "") -> None:
    await _call("POST", f"/run-phones/{run_phone_id}/step",
                json={"name": name, "status": status, "detail": str(detail or "")[:300]}, retries=2)


# ── телефон ──────────────────────────────────────────────────────────────────
async def phone(phone_id: str) -> dict:
    return (await _call("GET", f"/phones/{phone_id}"))[1]


async def phone_event(phone_id: str, kind: str, detail: str = "", screenshot: str | None = None) -> None:
    await _call("POST", f"/phones/{phone_id}/event",
                json={"kind": kind, "detail": detail, "screenshot": screenshot}, retries=2)


async def ensure_proxy(phone_id: str) -> dict:
    return (await _call("POST", f"/phones/{phone_id}/proxy/ensure", retries=1))[1]


async def set_account(phone_id: str, **fields) -> None:
    await _call("POST", f"/phones/{phone_id}/account", json=fields)


# ── регистрация ──────────────────────────────────────────────────────────────
async def assign(phone_id: str) -> tuple[dict | None, str | None]:
    """Комплект для реги: номер + почта + профиль. (сессия, None) или (None, причина)."""
    code, body = await _call("POST", "/reg/assign", json={"phoneId": phone_id}, ok_codes=(409,))
    if code == 201:
        return body, None
    return None, body.get("error") or f"http_{code}"


async def email_code(account_id: str) -> dict:
    return (await _call("GET", f"/reg/{account_id}/email-code", retries=1))[1]


async def call_code(account_id: str) -> dict:
    return (await _call("GET", f"/reg/{account_id}/call-code", retries=1))[1]


async def fail(account_id: str, outcome: str) -> None:
    await _call("POST", f"/reg/{account_id}/fail", json={"outcome": outcome})


async def complete(account_id: str, phone_id: str) -> bool:
    code, _ = await _call("POST", f"/reg/{account_id}/complete", json={"phoneId": phone_id})
    return 200 <= code < 300
