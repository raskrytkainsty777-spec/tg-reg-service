# Кабинет (web) + API в одном образе: API отдаёт собранный кабинет сам

FROM node:20-bookworm-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

FROM node:20-bookworm-slim AS api
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY api/package.json api/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY api/prisma ./prisma
COPY api/tsconfig.json ./
COPY api/src ./src
RUN npx prisma generate && npx tsc && npm prune --omit=dev

FROM node:20-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
COPY --from=api /app/node_modules ./node_modules
COPY --from=api /app/dist ./dist
COPY api/package.json ./
COPY api/prisma ./prisma
COPY api/assets ./assets
COPY --from=web /web/dist ./public
EXPOSE 3000 9092
# Схема базы применяется при старте: только добавление полей и таблиц,
# удаляющие изменения db push без флага не пропустит
CMD ["sh", "-c", "npx prisma db push --skip-generate && node dist/index.js"]
