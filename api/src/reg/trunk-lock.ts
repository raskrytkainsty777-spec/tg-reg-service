import { dbClient } from "../core/db.js";

// На одном транке одновременно идёт одна рега: звонок с кодом приходит на
// транк, и по нему мы понимаем, какому аккаунту он предназначен.
// Замок живёт 9 минут — с запасом на почту, звонок и ввод кода.
// Хранится в самом транке (lockOwner/lockUntil) и пишется сырым SQL:
// так не сдвигается updatedAt, по которому транки выдают номера по кругу

const TRUNK_LOCK_TTL_SECONDS = 9 * 60;

export const acquireTrunkLock = async (trunkId: string, owner: string) =>
  (await dbClient.$executeRaw`
    UPDATE "RegTrunk"
    SET "lockOwner" = ${owner}, "lockUntil" = now() + make_interval(secs => ${TRUNK_LOCK_TTL_SECONDS})
    WHERE id = ${trunkId} AND ("lockUntil" IS NULL OR "lockUntil" < now())`) === 1;

export const replaceTrunkLock = async (trunkId: string, owner: string) =>
  (await dbClient.$executeRaw`
    UPDATE "RegTrunk"
    SET "lockOwner" = ${owner}, "lockUntil" = now() + make_interval(secs => ${TRUNK_LOCK_TTL_SECONDS})
    WHERE id = ${trunkId} AND "lockUntil" > now()`) === 1;

export const isTrunkLocked = async (trunkId: string) =>
  (await dbClient.regTrunk.count({ where: { id: trunkId, lockUntil: { gt: new Date() } } })) > 0;

export const getTrunkLockInfo = async (trunkId: string) => {
  const trunk = await dbClient.regTrunk.findUnique({
    where: { id: trunkId },
    select: { lockOwner: true, lockUntil: true },
  });

  const ttlSeconds = trunk?.lockUntil
    ? Math.round((trunk.lockUntil.getTime() - Date.now()) / 1000)
    : -1;

  if (!trunk?.lockOwner || ttlSeconds <= 0) {
    return { locked: false, accountId: null, ttlSeconds: null };
  }

  return {
    locked: true,
    // "pending" — замок взят, аккаунт ещё создаётся
    accountId: trunk.lockOwner === "pending" ? null : trunk.lockOwner,
    ttlSeconds,
  };
};

export const releaseTrunkLock = async (trunkId: string | null | undefined) => {
  if (!trunkId) return;

  await dbClient.$executeRaw`
    UPDATE "RegTrunk" SET "lockOwner" = NULL, "lockUntil" = NULL WHERE id = ${trunkId}`;
};
