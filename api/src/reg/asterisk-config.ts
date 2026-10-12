import { createHash } from "node:crypto";

import { dbClient } from "../core/db.js";
import { getRegSettings } from "./reg-settings.js";

// Транки заводятся в кабинете вместе с паролем, а Asterisk раз в полминуты
// забирает отсюда готовый кусок pjsip.conf и перечитывает его при изменении

export const TRUNK_NAME_RE = /^[A-Za-z0-9_.-]+$/;

// По этой строке entrypoint Asterisk отличает конфиг от страницы ошибки
export const TRUNKS_MARKER = "; tg-reg-service trunks";

// В pjsip.conf «;» — начало комментария, в значениях его экранируют
const escapeValue = (value: string) => value.replace(/[\r\n]/g, "").replace(/;/g, "\\;");

const sectionName = (trunkName: string) => `reg-${trunkName.toLowerCase()}`;

const proxyUri = (host: string) => `sip:${host}\\;transport=tcp`;

export const renderPjsipTrunks = async () => {
  const [settings, trunks] = await Promise.all([
    getRegSettings(),
    dbClient.regTrunk.findMany({
      where: { enabled: true },
      orderBy: { createdAt: "asc" },
      select: { name: true, sipPassword: true, outboundProxy: true },
    }),
  ]);

  const blocks: string[] = [`${TRUNKS_MARKER} (generated, do not edit)`];
  const valid = trunks.filter((trunk) => TRUNK_NAME_RE.test(trunk.name));

  for (const trunk of valid) {
    const name = sectionName(trunk.name);
    const authUsername = `${trunk.name}@${settings.sipAuthDomain}`;
    // Свой прокси у транка — старые транки Билайна принимаются только через
    // nsk.ip.beeline.ru, новые — только через ip.beeline.ru
    const outboundProxy = proxyUri(trunk.outboundProxy?.trim() || settings.sipOutboundProxy);

    blocks.push(`
[${name}-registration]
type = registration
transport = transport-tcp
outbound_auth = ${name}-auth
outbound_proxy = ${outboundProxy}
server_uri = sip:${settings.sipDomain}
client_uri = sip:${authUsername}
retry_interval = 60
forbidden_retry_interval = 600
expiration = 300
line = yes
endpoint = ${name}-endpoint

[${name}-auth]
type = auth
auth_type = userpass
username = ${authUsername}
password = ${escapeValue(trunk.sipPassword)}

[${name}-aor]
type = aor
contact = sip:${settings.sipDomain}

[${name}-endpoint]
type = endpoint
transport = transport-tcp
context = incoming-sip
disallow = all
allow = alaw,ulaw
outbound_auth = ${name}-auth
outbound_proxy = ${outboundProxy}
aors = ${name}-aor
direct_media = no
from_domain = ${settings.sipDomain}
from_user = ${trunk.name}`);
  }

  // Входящие от провайдера узнаём по хосту. Транк звонка определяем не по
  // endpoint, а по DID в dialplan, поэтому хватает одного identify на всё
  const first = valid[0];

  if (first) {
    const hosts = new Set([settings.sipIdentifyHost]);

    for (const trunk of valid) {
      if (trunk.outboundProxy?.trim()) hosts.add(trunk.outboundProxy.trim());
    }

    blocks.push(`
[reg-identify]
type = identify
endpoint = ${sectionName(first.name)}-endpoint
match = ${[...hosts].join(",")}`);
  }

  const text = `${blocks.join("\n")}\n`;

  return {
    text,
    trunks: valid.length,
    hash: createHash("sha1").update(text).digest("hex"),
  };
};

// Когда Asterisk последний раз забирал конфиг и присылал звонок — для кабинета
export const markAsteriskSeen = async (kind: "config" | "call", hash?: string) => {
  await dbClient.settings
    .update({
      where: { id: 1 },
      data:
        kind === "config"
          ? { asteriskConfigAt: new Date(), asteriskConfigHash: hash ?? null }
          : { asteriskCallAt: new Date() },
    })
    .catch(() => null);
};

export const getAsteriskStatus = async () => {
  const [row, current] = await Promise.all([
    dbClient.settings.findUnique({
      where: { id: 1 },
      select: { asteriskConfigAt: true, asteriskConfigHash: true, asteriskCallAt: true },
    }),
    renderPjsipTrunks(),
  ]);

  return {
    configFetchedAt: row?.asteriskConfigAt?.toISOString() ?? null,
    // Asterisk забрал текущую версию транков — изменения применены
    configInSync: row?.asteriskConfigHash === current.hash,
    lastCallAt: row?.asteriskCallAt?.toISOString() ?? null,
    enabledTrunks: current.trunks,
  };
};
