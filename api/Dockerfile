# Cubiq Studio – kleiner Server für Team-Seite und Team-Bereich (api/server.mjs, keine Pakete).
# Dasselbe Node-Image wie die Launcher-Website – auf dem Server liegt es schon vor.
ARG NODE_IMAGE=node:24-alpine
FROM ${NODE_IMAGE}

WORKDIR /app
COPY api/server.mjs ./
ENV NODE_ENV=production DATA_DIR=/data PORT=3000
USER node

EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "server.mjs"]
