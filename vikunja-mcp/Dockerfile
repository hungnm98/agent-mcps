FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY src ./src

RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV PORT=8765

EXPOSE 8765

CMD ["node", "src/server.js"]
