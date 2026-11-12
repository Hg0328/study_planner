FROM node:24-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev
COPY . .
ENV NODE_ENV=production PORT=3000 DB_PATH=/app/data/planner.db
VOLUME ["/app/data"]
EXPOSE 3000
CMD ["node", "server.js"]
