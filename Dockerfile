FROM node:22-alpine

RUN npm install -g pnpm@11.5.2

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY nodes/goat/package.json ./nodes/goat/
COPY nodes/blaze/package.json ./nodes/blaze/
COPY nodes/dexscreener/package.json ./nodes/dexscreener/
COPY nodes/goplus/package.json ./nodes/goplus/
COPY nodes/honeypot/package.json ./nodes/honeypot/
COPY nodes/ai-decision/package.json ./nodes/ai-decision/
COPY nodes/telegram/package.json ./nodes/telegram/

RUN pnpm install --frozen-lockfile

COPY src/ ./src/
COPY nodes/ ./nodes/
COPY tsconfig.json ./

EXPOSE 3100

CMD ["pnpm", "exec", "tsx", "src/server.ts"]
