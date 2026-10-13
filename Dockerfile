# --- build: client (Vite) + server bundle (esbuild) -------------------------------------
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# --- runtime: one Node process serves the game and the WebSocket rooms -----------------
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080 STATIC_DIR=/app/dist
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
EXPOSE 8080
USER node
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:8080/healthz || exit 1
CMD ["node", "dist-server/index.mjs"]
