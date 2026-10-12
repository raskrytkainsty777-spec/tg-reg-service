import { AudioSocket, type AudioStream } from "@fonoster/streams";
import { Session } from "@yandex-cloud/nodejs-sdk";
import { stt, sttService } from "@yandex-cloud/nodejs-sdk/ai-stt-v3";
import fs from "node:fs";
import path from "node:path";
import { PassThrough } from "node:stream";

import { dbClient } from "../core/db.js";
import { getRegSettings } from "./reg-settings.js";
import { findActiveAccountByPhone, findActiveAccountByTrunk } from "./registration.service.js";
import { isTrunkLocked, releaseTrunkLock } from "./trunk-lock.js";
import { markAsteriskSeen } from "./asterisk-config.js";

// Звонок с кодом Telegram: Asterisk спрашивает check-call, при «ok» поднимает
// трубку и отдаёт аудио сюда по AudioSocket. Мы проигрываем в трубку запись
// (робот Telegram ждёт живой линии) и параллельно шлём поток в SpeechKit.
// Перенесено из tg-regs (services/sip-transcription.ts)

type RecognizerClientLike = {
  recognizeStreaming(requests: AsyncIterable<unknown>): AsyncIterable<{
    final?: { alternatives?: Array<{ text?: string }> };
  }>;
};

const TEXT_NORMALIZATION_ENABLED = process.env.TEXT_NORMALIZATION_ENABLED === "true";
const SLIN_SAMPLE_RATE_HZ = 8000;
const SLIN_BYTES_PER_SAMPLE = 2;
const OUTBOUND_FRAME_MS = 20;
const OUTBOUND_FRAME_BYTES = (SLIN_SAMPLE_RATE_HZ / 1000) * OUTBOUND_FRAME_MS * SLIN_BYTES_PER_SAMPLE;

const OUTBOUND_AUDIO_DIR =
  process.env.REG_OUTBOUND_AUDIO_DIR ?? path.resolve(process.cwd(), "assets/reg-sln");

export const getAudioSocketPort = () => Number(process.env.REG_AUDIO_SOCKET_PORT ?? 9092);

const normalizePhone = (value: string) => {
  const digits = value.replace(/\D/g, "");

  if (digits.length === 11 && digits.startsWith("8")) return `7${digits.slice(1)}`;

  return digits;
};

const acceptCall = async (input: {
  uuid: string;
  caller: string;
  did: string;
  trunkId: string | null;
  accountId: string;
  matchedBy: "number" | "trunk";
}) => {
  const { uuid, caller, did, trunkId, accountId, matchedBy } = input;

  await dbClient.regSipCall.upsert({
    where: { uuid },
    create: { uuid, caller, did, trunkId, accountId, status: "waiting" },
    update: {
      caller,
      did,
      trunkId,
      accountId,
      status: "waiting",
      rejectReason: null,
      startedAt: null,
      endedAt: null,
    },
  });

  await dbClient.regAuditLog
    .create({
      data: {
        accountId,
        entityType: "account",
        entityId: accountId,
        action: "call_accepted",
        payload: { caller, did, uuid, matchedBy },
      },
    })
    .catch(() => null);

  return "ok" as const;
};

/**
 * Брать ли звонок. В DID (заголовок To) провайдер кладёт либо SIP-ID транка,
 * либо сам набранный номер. Номер — точное попадание: аккаунт ищем прямо по
 * нему. SIP-ID — по замку транка находим аккаунт, который сейчас ждёт код
 */
export const checkSipCall = async (input: {
  caller?: string | null;
  did?: string | null;
  uuid?: string | null;
}) => {
  const caller = normalizePhone(input.caller ?? "");
  const did = input.did?.trim() ?? "";
  const uuid = input.uuid?.trim() ?? "";

  await markAsteriskSeen("call");

  if (!caller || !did || !uuid) return "reject" as const;

  const didPhone = normalizePhone(did);
  const trunkPhone =
    didPhone.length >= 10
      ? await dbClient.regTrunkPhone.findFirst({
          where: { phone: { in: [didPhone, `7${didPhone.slice(-10)}`] } },
        })
      : null;

  if (trunkPhone) {
    const account = await findActiveAccountByPhone(trunkPhone.phone);

    if (account) {
      return acceptCall({
        uuid,
        caller,
        did,
        trunkId: trunkPhone.trunkId,
        accountId: account.id,
        matchedBy: "number",
      });
    }

    await dbClient.regSipCall
      .create({
        data: {
          uuid,
          caller,
          did,
          trunkId: trunkPhone.trunkId,
          status: "rejected",
          rejectReason: "number_not_in_registration",
          endedAt: new Date(),
        },
      })
      .catch(() => null);

    return "reject" as const;
  }

  const trunk = await dbClient.regTrunk.findUnique({ where: { name: did } });

  if (!trunk) {
    await dbClient.regSipCall
      .create({
        data: { uuid, caller, did, status: "rejected", rejectReason: "trunk_not_found", endedAt: new Date() },
      })
      .catch(() => null);

    return "reject" as const;
  }

  const locked = await isTrunkLocked(trunk.id);
  const account = locked ? await findActiveAccountByTrunk(trunk.id) : null;

  if (!locked || !account) {
    await dbClient.regSipCall
      .create({
        data: {
          uuid,
          caller,
          did,
          trunkId: trunk.id,
          accountId: account?.id ?? null,
          status: "rejected",
          rejectReason: !locked ? "trunk_lock_expired" : "active_account_not_found",
          endedAt: new Date(),
        },
      })
      .catch(() => null);

    return "reject" as const;
  }

  return acceptCall({
    uuid,
    caller,
    did,
    trunkId: trunk.id,
    accountId: account.id,
    matchedBy: "trunk",
  });
};

class SipTranscriptionService {
  private readonly audioSocket = new AudioSocket();
  private readonly transcriptSequences = new Map<string, number>();
  private readonly streamStats = new Map<string, { chunks: number; bytes: number; startedAt: number }>();
  private isStarted = false;
  // Один общий gRPC-клиент SpeechKit: новый канал на каждый звонок даёт
  // случайные ECONNRESET под нагрузкой. Пересоздаём, только если сменили ключ
  private recognizer: { key: string; client: RecognizerClientLike } | null = null;

  constructor() {
    this.audioSocket.onConnection((req, audioStream) => {
      void this.processAudioStream(req.ref, audioStream).catch((error) => {
        console.error("[reg] AudioSocket stream failed", { uuid: req.ref, error });
        audioStream.hangup();
      });
    });
  }

  start(port = getAudioSocketPort()) {
    if (this.isStarted) return;

    this.isStarted = true;
    this.audioSocket.listen(port, () => {
      console.log(`[reg] AudioSocket listening on port ${port}`);
    });
  }

  private async processAudioStream(uuid: string, audioStream: AudioStream) {
    // Все обработчики вешаем синхронно, до первого await: иначе обрыв TCP
    // (ECONNRESET) до подписки роняет процесс вместе с остальными звонками
    const sttStream = new PassThrough();
    sttStream.on("error", () => {
      // Реальные ошибки распознавания всплывают в processRecognition
    });

    let stopPlayback: (() => void) | null = null;
    let accepted = false;
    let finished = false;

    const finalize = (outcome: "ended" | "failed", error?: unknown) => {
      if (finished) return;

      finished = true;
      stopPlayback?.();

      if (error === undefined) sttStream.end();
      else sttStream.destroy(error instanceof Error ? error : new Error(String(error)));

      if (!accepted) return;

      this.streamStats.delete(uuid);
      void this.persistFinalCallStatus(uuid, outcome);
    };

    audioStream.onData((chunk) => {
      if (finished) return;

      const stats = this.streamStats.get(uuid);

      if (stats) {
        stats.chunks += 1;
        stats.bytes += chunk.length;
      }

      sttStream.write(chunk);
    });

    audioStream.onClose(() => {
      const stats = this.streamStats.get(uuid);

      console.log("[reg] call audio closed", {
        uuid,
        bytes: stats?.bytes ?? 0,
        durationMs: stats ? Date.now() - stats.startedAt : null,
      });
      finalize("ended");
    });

    audioStream.onError((error) => {
      console.error("[reg] call audio error", { uuid, error });
      finalize("failed", error ?? new Error("AudioSocket stream error"));
    });

    const call = await dbClient.regSipCall.findUnique({ where: { uuid } });

    if (finished) return;

    if (!call || call.status !== "waiting") {
      console.warn("[reg] call audio rejected", { uuid, callStatus: call?.status ?? null });
      audioStream.hangup();
      return;
    }

    accepted = true;
    this.streamStats.set(uuid, { chunks: 0, bytes: 0, startedAt: Date.now() });

    await dbClient.regSipCall.update({
      where: { uuid },
      data: { status: "streaming", startedAt: new Date() },
    });

    if (finished) return;

    stopPlayback = this.startOutboundPlayback(uuid, audioStream);

    try {
      await this.processRecognition(uuid, call.id, sttStream);
    } finally {
      this.transcriptSequences.delete(call.id);
    }
  }

  // Финальный статус пишем с повтором: разовый сбой базы оставлял звонок
  // «в процессе» навсегда
  private async persistFinalCallStatus(uuid: string, outcome: "ended" | "failed") {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await dbClient.regSipCall.updateMany({
          where: outcome === "ended" ? { uuid, status: { in: ["waiting", "streaming"] } } : { uuid },
          data: { status: outcome, endedAt: new Date() },
        });
        return;
      } catch (error) {
        console.error("[reg] call status write failed", { uuid, outcome, attempt, error });

        if (attempt === 3) return;

        await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
      }
    }
  }

  private startOutboundPlayback(uuid: string, audioStream: AudioStream) {
    let fileBuffer: Buffer = Buffer.alloc(0);
    const silenceFrame = Buffer.alloc(OUTBOUND_FRAME_BYTES);
    let offset = 0;
    let stopped = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const stop = () => {
      if (stopped) return;

      stopped = true;

      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };

    const writeFrame = () => {
      if (stopped) return;

      let frame: Buffer = silenceFrame;

      if (offset < fileBuffer.length) {
        const slice = fileBuffer.subarray(offset, offset + OUTBOUND_FRAME_BYTES);
        offset += OUTBOUND_FRAME_BYTES;

        if (slice.length === OUTBOUND_FRAME_BYTES) {
          frame = slice;
        } else {
          frame = Buffer.alloc(OUTBOUND_FRAME_BYTES);
          slice.copy(frame);
        }
      }

      try {
        audioStream.write(frame);
      } catch (error) {
        stop();
        console.warn(`[reg] outbound audio write failed: ${uuid}`, error);
      }
    };

    void (async () => {
      const filePath = await this.pickRandomOutboundFile();

      if (filePath) {
        try {
          fileBuffer = await fs.promises.readFile(filePath);
        } catch (error) {
          console.warn(`[reg] outbound audio read failed: ${uuid}`, error);
        }
      }

      if (stopped) return;

      timer = setInterval(writeFrame, OUTBOUND_FRAME_MS);
      writeFrame();
    })();

    return stop;
  }

  private async pickRandomOutboundFile() {
    try {
      const files = (await fs.promises.readdir(OUTBOUND_AUDIO_DIR)).filter((name) =>
        name.toLowerCase().endsWith(".sln"),
      );

      if (files.length === 0) return null;

      return path.join(OUTBOUND_AUDIO_DIR, files[Math.floor(Math.random() * files.length)]);
    } catch (error) {
      console.warn("[reg] outbound audio dir read failed", { dir: OUTBOUND_AUDIO_DIR, error });
      return null;
    }
  }

  private async getRecognizerClient() {
    const { speechkitApiKey } = await getRegSettings();

    if (!speechkitApiKey) {
      console.error("[reg] SpeechKit key is not set (Настройки)");
      return null;
    }

    if (this.recognizer?.key === speechkitApiKey) return this.recognizer.client;

    // API-ключ сервисного аккаунта (AQVN…) SpeechKit принимает как Bearer —
    // так работало в tg-regs, не меняем
    const session = new Session({ iamToken: speechkitApiKey });
    const client = session.client(sttService.RecognizerClient) as unknown as RecognizerClientLike;

    this.recognizer = { key: speechkitApiKey, client };

    return client;
  }

  private async processRecognition(uuid: string, callId: string, sttStream: PassThrough) {
    const client = await this.getRecognizerClient();

    if (!client) return;

    try {
      for await (const response of client.recognizeStreaming(this.createRecognitionRequests(sttStream))) {
        const text = response.final?.alternatives?.[0]?.text?.trim();

        if (!text) continue;

        const sequence = (this.transcriptSequences.get(callId) ?? 0) + 1;
        this.transcriptSequences.set(callId, sequence);

        await dbClient.regSipTranscript.create({
          data: { callId, sequence, text, final: true },
        });
      }

      const call = await dbClient.regSipCall.findUnique({
        where: { id: callId },
        include: { transcripts: { where: { final: true }, take: 1 } },
      });

      // Код получен — транк свободен для следующей реги
      if (call?.trunkId && call.transcripts.length > 0) {
        await releaseTrunkLock(call.trunkId);
      }
    } catch (error) {
      console.error(`[reg] SpeechKit stream failed: ${uuid}`, error);
      await dbClient.regSipCall.updateMany({
        where: { uuid },
        data: { status: "failed", endedAt: new Date() },
      });
    }
  }

  private async *createRecognitionRequests(sttStream: PassThrough) {
    yield stt.StreamingRequest.fromPartial({
      sessionOptions: {
        recognitionModel: {
          model: "general",
          audioFormat: {
            rawAudio: {
              audioEncoding: stt.RawAudio_AudioEncoding.LINEAR16_PCM,
              sampleRateHertz: SLIN_SAMPLE_RATE_HZ,
              audioChannelCount: 1,
            },
          },
          textNormalization: {
            textNormalization: TEXT_NORMALIZATION_ENABLED ? 1 : 0,
            profanityFilter: false,
            literatureText: false,
            phoneFormattingMode: 0,
          },
          languageRestriction: {
            restrictionType: 1,
            languageCode: ["ru-RU"],
          },
          audioProcessingType: 1,
        },
        eouClassifier: {
          defaultClassifier: {
            type: stt.DefaultEouClassifier_EouSensitivity.HIGH,
            maxPauseBetweenWordsHintMs: 500,
          },
        },
      },
    });

    for await (const audioChunk of sttStream) {
      yield stt.StreamingRequest.fromPartial({ chunk: { data: audioChunk as Buffer } });
    }
  }
}

export const sipTranscriptionService = new SipTranscriptionService();

/**
 * Проверка ключа SpeechKit для онбординга: открываем короткий поток с
 * полсекундой тишины. Неверный ключ падает сразу ошибкой авторизации
 */
export const testSpeechkitKey = async (key: string) => {
  const session = new Session({ iamToken: key });
  const client = session.client(sttService.RecognizerClient) as unknown as RecognizerClientLike;

  async function* requests() {
    yield stt.StreamingRequest.fromPartial({
      sessionOptions: {
        recognitionModel: {
          model: "general",
          audioFormat: {
            rawAudio: {
              audioEncoding: stt.RawAudio_AudioEncoding.LINEAR16_PCM,
              sampleRateHertz: SLIN_SAMPLE_RATE_HZ,
              audioChannelCount: 1,
            },
          },
          languageRestriction: { restrictionType: 1, languageCode: ["ru-RU"] },
        },
      },
    });
    yield stt.StreamingRequest.fromPartial({
      chunk: { data: Buffer.alloc(SLIN_SAMPLE_RATE_HZ * SLIN_BYTES_PER_SAMPLE / 2) },
    });
  }

  const run = (async () => {
    for await (const _ of client.recognizeStreaming(requests())) {
      void _;
    }
  })();

  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("SpeechKit не ответил за 15 секунд")), 15_000).unref(),
  );

  try {
    await Promise.race([run, timeout]);
    return { ok: true as const };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false as const, error: message };
  }
};
