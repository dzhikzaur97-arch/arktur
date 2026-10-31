# Онлайн-сервер Arktur: общий мир для всех игроков (WebSocket), сохранение в /data/db.json
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY public ./public
ENV NODE_ENV=production PORT=8080 DB_FILE=/data/db.json
VOLUME /data
EXPOSE 8080
CMD ["node", "server/index.js"]
