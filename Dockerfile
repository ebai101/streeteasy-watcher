FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json watcher.ts ./
RUN npm run build

FROM node:22-alpine

ENV NODE_ENV=production

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

RUN addgroup -S watcher \
    && adduser -S watcher -G watcher \
    && mkdir -p /data \
    && chown -R watcher:watcher /app /data

USER watcher

CMD ["node", "dist/watcher.js"]
