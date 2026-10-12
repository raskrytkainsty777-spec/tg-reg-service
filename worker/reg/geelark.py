"""Тонкий асинхронный клиент к OpenAPI GeeLark (облачные телефоны).

Авторизация — обычный bearer. Ключ вводится в кабинете (Настройки → GeeLark),
воркер забирает его из API перед каждым запуском (set_credentials).
Перенесено из farm-adb (engine/client.py).
"""
import os
import time
import asyncio
import logging

import httpx

logger = logging.getLogger(__name__)

BASE_URL = os.environ.get("GEELARK_BASE_URL", "https://openapi.geelark.com")
_TOKEN = os.environ.get("GEELARK_BEARER", "").strip()


def set_credentials(token: str | None, base_url: str | None = None) -> None:
    """Ключ и адрес GeeLark из настроек кабинета (в настройках адрес бывает с /open/v1)."""
    global _TOKEN, BASE_URL
    _TOKEN = (token or "").strip()
    if base_url:
        b = base_url.strip().rstrip("/")
        if b.endswith("/open/v1"):
            b = b[: -len("/open/v1")]
        BASE_URL = b or BASE_URL

# ── Метрики нагрузки на GeeLark API (для подбора числа воркеров) ────────────────
# Снимок: client.metrics_snapshot(reset=True). Считаем вызовы/латентность/ошибки/ретраи,
# в т.ч. поэндпоинтно — чтобы видеть, упираемся ли в API при росте параллелизма.
_METRICS = {"calls": 0, "errors": 0, "retries": 0, "lat_sum": 0.0, "lat_max": 0.0, "by_path": {}}


def metrics_snapshot(reset: bool = False) -> dict:
    snap = {k: (dict(v) if isinstance(v, dict) else v) for k, v in _METRICS.items()}
    snap["lat_avg"] = (_METRICS["lat_sum"] / _METRICS["calls"]) if _METRICS["calls"] else 0.0
    if reset:
        _METRICS.update({"calls": 0, "errors": 0, "retries": 0, "lat_sum": 0.0, "lat_max": 0.0})
        _METRICS["by_path"] = {}
    return snap


def _rec(path: str, lat: float, err: bool):
    _METRICS["calls"] += 1
    _METRICS["lat_sum"] += lat
    if lat > _METRICS["lat_max"]:
        _METRICS["lat_max"] = lat
    if err:
        _METRICS["errors"] += 1
    bp = _METRICS["by_path"].setdefault(path, {"n": 0, "err": 0, "lat": 0.0})
    bp["n"] += 1
    bp["lat"] += lat
    if err:
        bp["err"] += 1


class GeelarkError(Exception):
    """Raised when GeeLark returns a non-zero top-level code."""

    def __init__(self, code, msg, trace_id=None):
        self.code = code
        self.msg = msg
        self.trace_id = trace_id
        super().__init__(f"GeeLark error {code}: {msg}")


def _token() -> str:
    if not _TOKEN:
        raise GeelarkError(-1, "Ключ GeeLark не задан (Настройки → GeeLark)")
    return _TOKEN


# ── Общий HTTP-клиент (keep-alive пул) ────────────────────────────────────────
# Раньше каждый _post создавал НОВЫЙ httpx.AsyncClient → новый TCP+TLS handshake
# на КАЖДУЮ shell-команду. При десятках параллельных потоков (рега/рассылка) это
# лишний CPU и латентность. Один общий клиент с пулом переиспользует соединения.
# Per-request timeout всё равно передаётся в .post() (он перекрывает дефолт клиента).
# Потолок одновременных коннектов к API GeeLark. Реальный спрос = число параллельных
# телефонов × ~1 in-flight вызов на телефон (воркер шлёт ADB-команды последовательно).
# 60 телефонов (2×30) ≈ 60-120 пик. Дефолт 256 = 4× запас над реалистичным максимумом.
# Выше смысла мало: коннектов больше спроса не бывает (лишние только жрут файл-дескрипторы),
# а GeeLark на той стороне режет частоту (429) — узкое место станет их rate-limit, не пул.
# Тюнится без правки кода через GEELARK_MAX_CONNECTIONS в Dokploy.
_MAX_CONN = int(os.environ.get("GEELARK_MAX_CONNECTIONS", "256") or "256")
_MAX_KEEPALIVE = int(os.environ.get("GEELARK_MAX_KEEPALIVE", "64") or "64")

_client: "httpx.AsyncClient | None" = None
_client_lock: "asyncio.Lock | None" = None


async def _get_client() -> httpx.AsyncClient:
    global _client, _client_lock
    if _client_lock is None:
        _client_lock = asyncio.Lock()
    if _client is None or _client.is_closed:
        async with _client_lock:
            if _client is None or _client.is_closed:
                _client = httpx.AsyncClient(
                    limits=httpx.Limits(max_connections=_MAX_CONN,
                                        max_keepalive_connections=_MAX_KEEPALIVE,
                                        keepalive_expiry=30.0),
                    timeout=httpx.Timeout(60.0),
                )
    return _client


async def aclose() -> None:
    """Закрыть общий клиент (опц., при остановке процесса)."""
    global _client
    if _client is not None and not _client.is_closed:
        await _client.aclose()
    _client = None


async def _post(path: str, payload: dict, timeout: float = 60.0) -> dict:
    """POST to GeeLark, unwrap the {code,msg,data} envelope, return `data`.

    Ретрай ТОЛЬКО на 429/503 и ошибках соединения (запрос отклонён/не дошёл до сервера —
    повтор безопасен и не дублирует side-effect). ReadTimeout (ответ потерян, но команда
    могла выполниться) и бизнес-ошибки (code!=0) НЕ ретраим — иначе риск двойного tap/insert.
    Все вызовы попадают в метрики (client.metrics_snapshot) — для подбора числа воркеров."""
    url = f"{BASE_URL}{path}"
    headers = {"Authorization": f"Bearer {_token()}", "Content-Type": "application/json"}
    attempts = 3
    for i in range(attempts):
        t0 = time.monotonic()
        try:
            h = await _get_client()
            r = await h.post(url, json=payload, headers=headers, timeout=timeout)
            _rec(path, time.monotonic() - t0, err=(r.status_code >= 400))
            if r.status_code in (429, 503) and i < attempts - 1:
                _METRICS["retries"] += 1
                logger.warning("GeeLark %s %s → ретрай %d/%d", path, r.status_code, i + 1, attempts - 1)
                await asyncio.sleep(0.5 * (2 ** i))
                continue
            r.raise_for_status()
            body = r.json()
            code = body.get("code")
            if code != 0:
                raise GeelarkError(code, body.get("msg", "unknown"), body.get("traceId"))
            return body.get("data") or {}
        # RemoteProtocolError НЕ ретраим: httpx кидает его и при «сервер закрыл ответ
        # уже ПОСЛЕ записи запроса» — команда (tap/ввод/addNew) могла выполниться, повтор
        # дал бы двойной side-effect (та же причина, по которой не ретраим ReadTimeout).
        # Протухшее keep-alive, закрытое ДО записи, httpcore гасит сам пере-открытием.
        # PoolTimeout безопасен (соединения не было — запрос не ушёл) → ретраим.
        except (httpx.ConnectError, httpx.ConnectTimeout, httpx.ReadError,
                httpx.PoolTimeout) as e:
            _rec(path, time.monotonic() - t0, err=True)
            if i < attempts - 1:
                _METRICS["retries"] += 1
                logger.warning("GeeLark %s conn-err (%s) → ретрай %d/%d", path, type(e).__name__, i + 1, attempts - 1)
                await asyncio.sleep(0.5 * (2 ** i))
                continue
            raise
    return {}


# ── Proxy detection ───────────────────────────────────────────────────────────
async def proxy_check(server: str, port: int, proxy_type: str = "socks5",
                      username: str | None = None, password: str | None = None,
                      detect_type: str = "IP2Location") -> dict:
    """Detect a proxy's outbound IP/country via GeeLark.

    Returns data: {detectStatus, outboundIP, countryCode, countryName,
    subdivision, city, timezone, isp, message}.
    """
    payload = {
        "detect_type": detect_type,
        "proxy_type": proxy_type,
        "server": server,
        "port": int(port),
    }
    if username:
        payload["username"] = username
    if password:
        payload["password"] = password
    return await _post("/open/v1/proxy/check", payload, timeout=30.0)


async def proxy_list(page: int = 1, page_size: int = 100) -> dict:
    """Список прокси-ЗАПИСЕЙ GeeLark: {list:[{id, scheme, server, port, username, password}], total}."""
    return await _post("/open/v1/proxy/list", {"page": int(page), "pageSize": int(page_size)})


async def find_proxy_entry(server: str, port, username: str | None = None) -> dict | None:
    """Найти прокси-запись GeeLark (id нужен для update). Листаем страницы.

    ⚠️ На ОДНОМ server:port GeeLark держит МНОГО независимых записей — они различаются
    ЛОГИНОМ. У нас это sticky-сессии Proxyma (`<GW>_c_<CC>_s_<id>`), и каждая = свой
    exit-IP: замер 28.07 — 686 записей на 449 пар host:port, на порту 10477 их девять
    (CZ/FR/BR/TR/DE вперемешку). Поиск ТОЛЬКО по host:port возвращал первую попавшуюся,
    и proxy_update_entry переписывал прокси ЧУЖОГО телефона.

    Поэтому: если username известен — ищем строгое совпадение и при промахе возвращаем
    None (лучше не сделать ничего, чем сломать соседа). Без username остаётся старое
    поведение — только для мест, где логин реально неизвестен.
    """
    page = 1
    while page <= 40:
        r = await proxy_list(page=page, page_size=100)
        lst = (r or {}).get("list") or []
        for it in lst:
            if it.get("server") != server or int(it.get("port") or 0) != int(port):
                continue
            if username and (it.get("username") or "") != username:
                continue
            return it
        if len(lst) < 100:
            break
        page += 1
    return None


async def proxy_update_entry(proxy_id: str, scheme: str, server: str, port,
                             username: str = "", password: str = "") -> dict:
    """Обновить прокси-запись по id → телефон, что её использует, берёт новый прокси (после рестарта).

    ⚠️ GeeLark отвечает 200 даже когда правка НЕ применилась: {totalAmount, successAmount,
    failAmount, failDetails:[{id, code, msg}]}. Раньше результат никто не смотрел, и отказ
    выглядел как успех — флап-своп «менял» прокси, а на деле не менял ничего (замер 28.07:
    21 отказ из 86 правок). Реальные коды: 45004 «check proxy failed» — либо прокси не
    отвечает, либо такой (server, port, username) УЖЕ есть в реестре (дубли запрещены).
    Поэтому на failAmount>0 поднимаем GeelarkError — молчаливых промахов быть не должно.
    """
    item = {"id": proxy_id, "scheme": scheme or "socks5", "server": server, "port": int(port),
            "username": username or "", "password": password or ""}
    data = await _post("/open/v1/proxy/update", {"list": [item]})
    if int((data or {}).get("failAmount") or 0) > 0:
        det = ((data or {}).get("failDetails") or [{}])[0]
        raise GeelarkError(det.get("code", -1),
                           f"proxy/update не применён: {det.get('msg') or 'без причины'}")
    return data


# ── Brand / model list ────────────────────────────────────────────────────────
async def brand_list(android_ver: int) -> list[dict]:
    """List supported {surfaceBrandName, surfaceModelName} for an Android version."""
    data = await _post("/open/v1/phone/brand/list", {"androidVer": int(android_ver)})
    # data is the array itself for this endpoint
    if isinstance(data, list):
        return data
    return data.get("items") or []


# ── Create cloud phones (batch) ───────────────────────────────────────────────
async def phone_add_new(mobile_type: str, data: list[dict], charge_mode: int = 0,
                        region: str | None = None) -> dict:
    """Create one or more cloud phones.

    `data` is a list of env rows (see build_env_row). Returns
    {totalAmount, successAmount, failAmount, details:[...]}.
    """
    payload = {"mobileType": mobile_type, "chargeMode": charge_mode, "data": data}
    if region:
        payload["region"] = region
    return await _post("/open/v1/phone/addNew", payload, timeout=180.0)


# ── Status / delete ───────────────────────────────────────────────────────────
async def phone_status(ids: list[str]) -> dict:
    """Query power status for up to 100 phone ids.

    Returns {successDetails:[{id,serialName,status}], failDetails:[...]}.
    status: 0 started, 1 starting, 2 shut down, 3 expired.
    """
    return await _post("/open/v1/phone/status", {"ids": list(ids)})


async def phone_list(page: int = 1, page_size: int = 100) -> dict:
    """List cloud phones in the account (paginated).

    Returns {total, page, pageSize, items:[{id, serialName, status, ...}]}.
    Used by the «sync» recovery flow: a phone can get created in GeeLark while
    our addNew call times out before the DB insert, leaving it orphaned in
    GeeLark only — listing lets us re-import it.
    """
    data = await _post("/open/v1/phone/list", {"page": int(page), "pageSize": int(page_size)})
    if isinstance(data, list):
        return {"items": data, "total": len(data)}
    return data


async def phone_delete(ids: list[str]) -> dict:
    """Delete up to 100 cloud phones. Fails per-id if a phone is running."""
    return await _post("/open/v1/phone/delete", {"ids": list(ids)})


# ── Power on/off (поминутный биллинг!) ────────────────────────────────────────
async def phone_start(ids: list[str]) -> dict:
    """Включить телефоны. После — поллить phone_status до status==0 (~1 мин)."""
    return await _post("/open/v1/phone/start", {"ids": list(ids)})


async def phone_stop(ids: list[str]) -> dict:
    """Выключить телефоны. ВСЕГДА звать по завершении работы — биллинг поминутный."""
    return await _post("/open/v1/phone/stop", {"ids": list(ids)})


# ── Shell на телефоне — основной транспорт автоматизации ──────────────────────
async def shell_execute(phone_id: str, cmd: str, timeout: float = 90.0) -> dict:
    """Выполнить шелл-команду на телефоне → {status, output, ...}.

    Готчи (проверено на DE-01): UTF-8 в аргументах коррозит (кириллицу слать
    base64 + ADBKeyboard); пайпы/сложное экранирование ненадёжны; `;`-цепочки
    ок; вывод обрезается ~60с; символ `[` в строке → JSON-escape error 40004.
    """
    return await _post("/open/v1/shell/execute", {"id": phone_id, "cmd": cmd}, timeout=timeout)


# ── Прямой ADB на телефон (для демо-стены scrcpy и локальных скриптов) ────────
async def adb_set_status(ids: list[str], open_: bool = True) -> dict:
    """Открыть/закрыть ADB-доступ на телефонах (до 100 id). Телефон должен быть включён."""
    return await _post("/open/v1/adb/setStatus", {"ids": list(ids), "open": bool(open_)})


async def adb_get_data(ids: list[str]) -> dict:
    """Реквизиты ADB → {items:[{id, ip, port, pwd}]}. После `adb connect ip:port` любая
    команда отвечает «you should run glogin to login first», пока не сделан
    `adb shell glogin <pwd>` (повторный вход отвечает «already logged» — тоже успех)."""
    return await _post("/open/v1/adb/getData", {"ids": list(ids)})


# ── Скриншот: async-запрос + поллинг результата ───────────────────────────────
async def screenshot_start(phone_id: str) -> str:
    """Запросить скриншот, вернуть taskId для screenshot_result."""
    data = await _post("/open/v1/phone/screenShot", {"id": phone_id})
    return data.get("taskId") or data.get("taskID") or data.get("task_id") or ""


async def screenshot_result(task_id: str) -> dict:
    """Статус скриншота: status==2 + downloadLink, когда готов."""
    return await _post("/open/v1/phone/screenShot/result", {"taskId": task_id})


def build_proxy_information(server: str, port, proxy_type: str = "socks5",
                            username: str | None = None,
                            password: str | None = None) -> str:
    """Build the single-string proxy form GeeLark addNew expects:
    `socks5://user:pass@host:port` (auth part omitted when no credentials)."""
    scheme = (proxy_type or "socks5").lower()
    auth = ""
    if username:
        auth = username
        if password:
            auth += f":{password}"
        auth += "@"
    return f"{scheme}://{auth}{server}:{int(port)}"
