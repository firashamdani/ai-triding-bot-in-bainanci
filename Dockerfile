# ===== Build stage =====
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

# ===== Runtime stage =====
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY --from=build /app/dist ./dist
COPY index.html ./

# The server reads PORT from the environment (defaults to 3000).
# Cloud Run / Render / Railway inject PORT automatically.
EXPOSE 3000

CMD ["node", "dist/server.cjs"]
