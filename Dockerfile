# B20: one image for the API and the site in Docker Compose (local development only; production runs on Vercel).
FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci
COPY . .
