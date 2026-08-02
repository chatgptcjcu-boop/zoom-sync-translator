# 備援：若 Nixpacks 異常可用 Docker 部署
FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY public ./public
ENV NODE_ENV=production
ENV TRUST_PROXY=1
EXPOSE 3100
CMD ["npm", "start"]
