"""ADB-сценарий ВОССТАНОВЛЕНИЕ ВХОДА в вылетевший Telegram-аккаунт телефона.

Тот же номер (его транк запирается — звонок с кодом узнаём по нему), та же почта
(её знаем с регистрации). Telegram при входе присылает код на почту входа или
звонит — ждём оба пути сразу. Почту вводить не нужно.

Поток на телефон (_restore_one):
  проверка «восстановление возможно» (без включения) → прокси → power_on → ждём
  Telegram → база Telegram пуста? (живой аккаунт не трогаем — не разлогинить)
  → экран номера → попытка (номер + почта, транк заперт) → номер → код с почты
  или звонком → главный экран → аккаунт снова «в строю» → медиа и энергосбережение
  (локальные настройки, при вылете слетают) → power_off (ВСЕГДА, в finally).
"""
import asyncio
import datetime as _dt
import logging
import re
import time

from . import api
from .phone import (
    sh as _sh, power_on as _power_on, power_off as _power_off,
    grab_screenshot_b64, ensure_tg_present as _ensure_tg_present,
)
from .scenario import (
    TG, BASE_W, BASE_H, SESS_WAIT_SEC, _POPUPS, _DENY_MODE, _SHELL_CAP,
    _probe_shell_cap, _dump, _ime, _fg, _ensure_fg, _goto_number, _fill_number,
    _confirm_number, _handle_interstitial, _classify, _two_btn_dialog, _dialog_kind,
    _pwd_screen, _real_chatlist, _native_tg, _bottom_tabs, _chatlist, _edits, _ftext,
    _tap, _key, _type_text, _clear_field, _find_done, _enter_code, _grant_post_reg,
    _disable_media, _disable_power_saving,
)

logger = logging.getLogger(__name__)

# База слота Telegram больше этого — в ней живой аккаунт (у вылетевшего остаётся
# только заголовок sqlite, ~4 КБ). Замер с фермы tg-walead, 07.10
SLOT_EMPTY_BYTES = 100_000

# Почему восстановление невозможно — человеческим языком для кабинета
_NOT_POSSIBLE = {
    "no_account": "на телефоне нет аккаунта",
    "number_not_in_trunks": "номера аккаунта нет в транках — звонок с кодом не принять",
    "trunk_disabled": "транк номера выключен",
    "no_registration_data": "аккаунт регистрировался не здесь: нет почты и профиля",
}


def _remaining(started_iso):
    """Сколько ещё держится замок транка (9 минут) — укладываемся с запасом."""
    try:
        st = _dt.datetime.fromisoformat(str(started_iso).replace("Z", "+00:00"))
    except Exception:  # noqa: BLE001
        return 300.0
    left = 9 * 60 - (_dt.datetime.now(_dt.timezone.utc) - st).total_seconds()
    return max(0.0, left - 60)


async def _tg_alive(gid) -> bool | None:
    """Есть ли в Telegram живой аккаунт — по размерам баз четырёх слотов.
    None — не удалось прочитать (тогда не рискуем)."""
    out = await _sh(gid, f"for p in /data/data/{TG}/files/cache4.db "
                         f"/data/data/{TG}/files/account1/cache4.db "
                         f"/data/data/{TG}/files/account2/cache4.db "
                         f"/data/data/{TG}/files/account3/cache4.db; do "
                         f"printf '%s ' $(wc -c < $p 2>/dev/null || echo 0); done")
    nums = [int(x) for x in re.findall(r"\d+", out or "")]
    if len(nums) < 4:
        return None
    return max(nums) > SLOT_EMPTY_BYTES


async def _wait_code(acc_id, gid, W, H, started, step):
    """Код входа: с почты аккаунта (API читает ящик) или звонком (Asterisk →
    SpeechKit). Что придёт раньше. Минута тишины — пробуем «не пришёл код?»."""
    t0 = time.monotonic()
    dl = t0 + min(240.0, _remaining(started))
    last_call = None
    seen_call = False
    tapped = False
    hb = 0
    while time.monotonic() < dl:
        r = await api.email_code(acc_id)
        if r.get("failed"):
            return None, r.get("reason") or "попытка закрыта"
        if r.get("code"):
            return r["code"], "почта"
        c = await api.call_code(acc_id)
        if c.get("failed"):
            return None, c.get("reason") or "попытка закрыта"
        if c.get("hasCall") and not seen_call:
            seen_call = True
            await step("звонок", "ok", f"пришёл через {int(time.monotonic() - t0)}с, расшифровка…")
        cur = c.get("code")
        if cur:
            seen_call = True
            # одно чтение может быть обрезком потока — берём, когда код повторился
            if cur == last_call:
                return cur, "звонок"
            last_call = cur
        ns = await _dump(gid)
        if not tapped and not seen_call and time.monotonic() - t0 > 60:
            link = _ftext(ns, "didn't get", "не получили", "get the code", "call me",
                          "позвонить", "send code via", "resend", "отправить код")
            if link:
                tapped = True
                await _tap(gid, link["cx"], link["cy"])
                await asyncio.sleep(3)
                ns = await _dump(gid)
                opt = _ftext(ns, "call", "звон", "email", "почт")
                if opt:
                    await _tap(gid, opt["cx"], opt["cy"])
                    await asyncio.sleep(2)
                await step("код", "ok", f"минута без кода — нажал «{(link.get('t') or link.get('d'))[:30]}»"
                                        + (f" → «{(opt.get('t') or opt.get('d'))[:30]}»" if opt else ""))
        el = int(time.monotonic() - t0)
        if el - hb >= 40:
            await step("код_ждём", "ok", f"+{el}с (бюджет {int(dl - t0)}с)")
            hb = el
        await asyncio.sleep(3)
    return None, "звонок был, кода нет" if seen_call else "код не пришёл ни на почту, ни звонком"


async def _restore_one(job, params, cfg):
    rp = job["runPhoneId"]
    pid = job["phoneId"]
    gid = job.get("geelarkId")

    async def step(name, status, detail=""):
        await api.step(rp, name, status, detail)

    async def shot(tag, detail=""):
        await api.phone_event(pid, tag, str(detail)[:200], await grab_screenshot_b64(gid))
        await step(tag, "ok", detail)

    async def fail_shot(tag, detail="", ok=False):
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
    # Возможно ли вообще — проверяем ДО включения: подъём стоит денег
    chk = await api.restore_check(pid)
    if not chk.get("ok"):
        await api.run_phone(rp, status="skipped",
                            error=_NOT_POSSIBLE.get(chk.get("error"), chk.get("error") or "нельзя восстановить"))
        return
    await api.run_phone(rp, status="running")

    done = False
    err = None
    open_acc = None
    powered = False

    async def release(outcome):
        nonlocal open_acc
        if open_acc:
            await api.fail(open_acc, outcome)
            open_acc = None

    async def give_up(reason, phone_status="logged_out", outcome="stuck"):
        """Закрыть попытку, пометить аккаунт телефона и выйти."""
        nonlocal err
        await release(outcome)
        await api.set_status(pid, phone_status, f"восстановление: {reason}")
        err = reason
        raise RuntimeError(reason)

    try:
        px = await api.ensure_proxy(pid)
        if px:
            await step("прокси", "ok" if px.get("ok", True) else "failed", px.get("detail", ""))
        if not await _power_on(gid, step):
            err = "не включился"
            raise RuntimeError(err)
        powered = True
        capped = await _probe_shell_cap(gid)
        _POPUPS.pop(gid, None)
        for _ in range(30):
            if len(await _dump(gid)) > 3:
                break
            await asyncio.sleep(4)
        await _sh(gid, "svc power stayon true; settings put system screen_off_timeout 1800000")
        if not await _ensure_tg_present(gid, step):
            err = "Telegram не установлен"
            raise RuntimeError(err)
        wm = await _sh(gid, "wm size")
        mm = re.search(r"(\d+)x(\d+)", wm)
        W, H = (int(mm.group(1)), int(mm.group(2))) if mm else (BASE_W, BASE_H)
        await step("подготовка", "ok", f"экран {W}x{H}, обрезка shell: {'да' if capped else 'нет'}")

        # Аккаунт правда вылетел? Живой не трогаем: _goto_number чистит Telegram
        alive = await _tg_alive(gid)
        if alive is None:
            err = "не прочитал базу Telegram — не рискую разлогинить живой аккаунт"
            raise RuntimeError(err)
        if alive:
            await _ensure_fg(gid)
            await asyncio.sleep(4)
            ns = await _dump(gid)
            if _real_chatlist(ns, W, H) or (_native_tg(ns) and len(_bottom_tabs(ns, W, H)) >= 3):
                await step("вход", "ok", "аккаунт на месте — восстанавливать нечего")
                await api.set_status(pid, "working", None)
                done = True
                return
            await fail_shot("база_есть", "аккаунт в базе Telegram есть, а главного экрана нет — не трогаю")
            err = "аккаунт в Telegram есть, но не открылся — проверьте телефон руками"
            raise RuntimeError(err)
        await step("вылет", "ok", "база Telegram пуста — аккаунт вылетел, входим заново")

        _DENY_MODE[gid] = True
        if not await _goto_number(gid, W, H, "fresh"):
            await fail_shot("нет_экрана_номера")
            err = "не открылся экран номера"
            raise RuntimeError(err)

        # Попытка: номер телефона + почта аккаунта, транк номера запирается.
        # Транк занят другой регой — ждём (телефон уже включён)
        sess = None
        why = None
        t0 = time.monotonic()
        noted = False
        while time.monotonic() < t0 + SESS_WAIT_SEC:
            sess, why = await api.restore_assign(pid)
            if sess or why != "trunk_busy":
                break
            if not noted:
                noted = True
                await step("транк_ждём", "ok", f"на транке номера идёт рега, ждём до {int(SESS_WAIT_SEC)}с")
            await asyncio.sleep(5)
        if not sess:
            err = _NOT_POSSIBLE.get(why, "транк номера занят" if why == "trunk_busy" else (why or "нет попытки"))
            raise RuntimeError(err)
        acc_id = sess["account_id"]
        open_acc = acc_id
        pn = re.sub(r"\D", "", str(sess.get("phone_number") or ""))
        email = sess.get("email") or ""
        started = sess.get("started_at") or ""
        nat = pn[1:] if pn.startswith("7") and len(pn) == 11 else pn
        await step("номер", "ok", f"{pn} (транк {sess.get('trunk_name') or '?'})")
        if not await _fill_number(gid, W, H, "+" + pn):
            await fail_shot("номер_не_введён", pn)
            await give_up("номер не ввёлся")
        await _confirm_number(gid, W, H, nat)

        # Что ответил Telegram на номер
        state = None
        okbtn = None
        dl = time.monotonic() + 120
        while time.monotonic() < dl:
            ns = await _dump(gid)
            if await _handle_interstitial(gid, ns, W, H):
                continue
            if await _confirm_number(gid, W, H, nat):
                await asyncio.sleep(1)
                continue
            if _pwd_screen(ns):
                state = "2fa"; break
            dlg = _two_btn_dialog(ns, W, H)
            if dlg:
                state = _dialog_kind(ns); okbtn = dlg; break
            if _real_chatlist(ns, W, H):
                state = "in"; break
            cc = _classify(ns, W, H)
            if cc == "code":
                state = "code"; break
            if cc == "pwd_or_code1":
                # одно поле: Telegram просит почту входа — или код одной строкой
                asks_email = any(("mail" in (n["t"] + n["d"]).lower() or "почт" in (n["t"] + n["d"]).lower())
                                 for n in ns) and not any("@" in n["t"] for n in ns)
                state = "email_entry" if asks_email else "code"
                break
            await asyncio.sleep(2)

        if state in ("banned", "flood", "dialog", "2fa"):
            await fail_shot("номер", {"banned": "номер заблокирован Telegram", "flood": "флуд — слишком много попыток",
                                      "dialog": "неизвестный диалог", "2fa": "на аккаунте облачный пароль"}[state])
            if okbtn:
                await _tap(gid, okbtn["cx"], okbtn["cy"])
            if state == "banned":
                await give_up("номер заблокирован Telegram", "spam", "banned")
            if state == "2fa":
                await give_up("на аккаунте облачный пароль (2FA)", "review", "twofa")
            if state == "flood":
                await give_up("флуд Telegram — повторить позже", "logged_out", "flood")
            await give_up("неизвестный диалог после номера")
        if state is None:
            await fail_shot("застрял_после_номера")
            await give_up("Telegram не ответил на номер")
        if state == "email_entry":
            e = _edits(await _dump(gid))
            if e:
                await _tap(gid, e[0]["cx"], e[0]["cy"]); await asyncio.sleep(0.5)
                await _clear_field(gid); await _type_text(gid, email); await asyncio.sleep(1)
                d2 = _find_done(await _dump(gid), W, H)
                if d2:
                    await _tap(gid, d2["cx"], d2["cy"])
                else:
                    await _key(gid, 66)
                await asyncio.sleep(3)
                await step("почта", "ok", "Telegram спросил почту входа — ввёл почту аккаунта")
            state = "code"

        logged_in = state == "in"
        deleted = False
        if state == "code":
            code, src = await _wait_code(acc_id, gid, W, H, started, step)
            if not code:
                await fail_shot("нет_кода", src)
                await give_up(src, "logged_out", "no_code")
            await step(f"код ({src})", "ok", str(code))
            await _enter_code(gid, code, W, H)
            await asyncio.sleep(3)
            reentered = False
            dl2 = time.monotonic() + 90
            relaunched = False
            i = 0
            while time.monotonic() < dl2:
                i += 1
                ns = await _dump(gid)
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
                if _pwd_screen(ns):
                    await fail_shot("2fa", "после кода просит облачный пароль")
                    await give_up("на аккаунте облачный пароль (2FA)", "review", "twofa")
                if _real_chatlist(ns, W, H) or (_native_tg(ns) and len(_bottom_tabs(ns, W, H)) >= 3):
                    logged_in = True
                    break
                # экран имени вместо чатов — аккаунта с этим номером больше нет
                if len(_edits(ns)) == 2 and not _chatlist(ns, W, H) and _classify(ns, W, H) == "number" \
                        and any(("name" in (n["t"] + n["d"]).lower() or "имя" in (n["t"] + n["d"]).lower()) for n in ns):
                    deleted = True
                    break
                if not reentered and i >= 4 and _classify(ns, W, H) == "code":
                    reentered = True
                    await step("код", "ok", "экран кода не ушёл — повторный ввод")
                    await _enter_code(gid, code, W, H)
                    continue
                if not relaunched and time.monotonic() > dl2 - 40 and _native_tg(ns):
                    relaunched = True
                    await _sh(gid, f"am force-stop {TG}; monkey -p {TG} -c android.intent.category.LAUNCHER 1")
                    await asyncio.sleep(6)
                    continue
                await asyncio.sleep(2)
        if deleted:
            await fail_shot("аккаунт_удалён", "после кода Telegram предлагает регистрацию")
            await give_up("аккаунт удалён в Telegram", "logged_out", "account_deleted")
        if not logged_in:
            await fail_shot("нет_главного_экрана")
            await give_up("после кода не открылся главный экран")

        # Вошли
        if await api.complete(acc_id, pid):
            open_acc = None
        done = True
        await step("вход", "ok", f"восстановлен {pn}")
        _DENY_MODE[gid] = False
        await _grant_post_reg(gid, step)
        # Настройки приложения локальные — после вылета и чистки их надо поставить заново
        if cfg.get("disableMedia", True):
            await _disable_media(gid, W, H, step)
        if cfg.get("disablePowerSaving", True):
            await _disable_power_saving(gid, W, H, step, shot)
    except asyncio.CancelledError:
        await step("cancel", "failed", "запуск остановлен")
        err = "запуск остановлен"
        raise
    except Exception as e:  # noqa: BLE001
        if not err:
            logger.exception("restore %s error: %s", pid, e)
        err = err or str(e)
    finally:
        try:
            await release("canceled")
        except BaseException:  # noqa: BLE001
            pass
        _POPUPS.pop(gid, None)
        _DENY_MODE.pop(gid, None)
        _SHELL_CAP.pop(gid, None)
        if powered or not done:
            off_ok = await _power_off(gid)
            if not off_ok:
                await asyncio.sleep(8)
                off_ok = await _power_off(gid)
            await step("power_off", "ok" if off_ok else "failed",
                       "выключен" if off_ok else "⚠ НЕ ВЫКЛЮЧИЛСЯ — проверь руками в GeeLark!")
        if done:
            await api.run_phone(rp, status="ok", error=None)
        else:
            await api.run_phone(rp, status="failed", error=err or "вход не восстановлен")


async def run_restore(run: dict, cfg: dict):
    """Восстановление по отмеченным телефонам. Параллельность — как у реги: звонок
    узнаём по транку, на одном транке одновременно одна попытка."""
    phones = run.get("phones") or []
    conc = max(1, int(run.get("concurrency") or 1))
    sem = asyncio.Semaphore(conc)
    params = {}
    logger.info("restore run %s: %d телефонов, параллельно %d", run.get("id"), len(phones), conc)

    async def worker(job):
        async with sem:
            try:
                await _restore_one(job, params, cfg)
            except asyncio.CancelledError:
                raise
            except Exception as e:  # noqa: BLE001
                logger.exception("restore worker %s crashed: %s", job.get("phoneId"), e)
                await api.run_phone(job["runPhoneId"], status="failed", error=str(e)[:300])

    await asyncio.gather(*(worker(j) for j in phones))
