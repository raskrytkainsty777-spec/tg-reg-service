#!/bin/sh
set -eu

mkdir -p /etc/asterisk

# Диапазон RTP «10000-10100» → начало и конец для rtp.conf. Он же
# пробрасывается наружу 1:1 (docker-compose.yml)
ASTERISK_RTP_PORTS="${ASTERISK_RTP_PORTS:-10000-10100}"
ASTERISK_RTP_START="${ASTERISK_RTP_PORTS%%-*}"
ASTERISK_RTP_END="${ASTERISK_RTP_PORTS##*-}"

for template in /opt/asterisk/templates/*.conf.template; do
  target="/etc/asterisk/$(basename "$template" .template)"
  : > "$target"

  while IFS= read -r line || [ -n "$line" ]; do
    eval "printf '%s\n' \"$line\"" >> "$target"
  done < "$template"
done

# Транки (логины и пароли SIP) заводятся в кабинете: раздел «Транки».
# API отдаёт готовый кусок pjsip.conf, он подключается через #include.
# Раз в TRUNKS_SYNC_INTERVAL секунд забираем его снова и перечитываем pjsip,
# если что-то поменялось
TRUNKS_FILE=/etc/asterisk/pjsip_trunks.conf
TRUNKS_MARKER="; tg-reg-service trunks"
TRUNKS_SYNC_INTERVAL="${TRUNKS_SYNC_INTERVAL:-30}"
TRUNKS_URL="${BACKEND_INTERNAL_URL:-}/internal/asterisk/pjsip?token=${INTERNAL_TOKEN:-}"

fetch_trunks() {
  target="$1"
  tmp="${target}.tmp"

  if [ -z "${BACKEND_INTERNAL_URL:-}" ] || [ -z "${INTERNAL_TOKEN:-}" ]; then
    return 1
  fi

  if curl -fsS --max-time 10 "$TRUNKS_URL" -o "$tmp" 2>/dev/null     && head -n 1 "$tmp" | grep -qF "$TRUNKS_MARKER"; then
    mv "$tmp" "$target"
    return 0
  fi

  rm -f "$tmp"
  return 1
}

if fetch_trunks "$TRUNKS_FILE"; then
  echo "[trunks] loaded from api"
else
  echo "[trunks] api unavailable, starting without trunks (will retry)"
  echo "; no trunks yet" > "$TRUNKS_FILE"
fi

sync_trunks_loop() {
  while true; do
    sleep "$TRUNKS_SYNC_INTERVAL"

    if fetch_trunks "${TRUNKS_FILE}.new"; then
      if cmp -s "${TRUNKS_FILE}.new" "$TRUNKS_FILE"; then
        rm -f "${TRUNKS_FILE}.new"
      else
        mv "${TRUNKS_FILE}.new" "$TRUNKS_FILE"
        echo "[trunks] config changed, reloading pjsip"
        /usr/sbin/asterisk -rx "module reload res_pjsip.so" || true
        /usr/sbin/asterisk -rx "module reload res_pjsip_outbound_registration.so" || true
      fi
    fi
  done
}

if [ "${1:-}" = "/usr/sbin/asterisk" ] || [ "${1:-}" = "asterisk" ]; then
  "$@" &
  pid=$!

  sleep 2
  /usr/sbin/asterisk -rx "core set verbose 10" || true
  /usr/sbin/asterisk -rx "core set debug 10" || true
  /usr/sbin/asterisk -rx "pjsip set logger on" || true

  sync_trunks_loop &

  wait "$pid"
  exit $?
fi

exec "$@"
