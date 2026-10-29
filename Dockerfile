FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=8081 \
    DATA_DIR=/data

# git: für «Aktualisieren» unter Mehr (Programmordner ist dann ein Git-Klon, siehe docker-compose.yml)
RUN apk add --no-cache su-exec git && git config --system --add safe.directory '*'
WORKDIR /app
COPY package.json CHANGELOG.md ./
COPY server ./server
COPY public ./public
COPY scripts ./scripts
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh && mkdir -p /data

EXPOSE 8081
VOLUME ["/data"]
HEALTHCHECK --interval=60s --timeout=5s CMD wget -qO- http://127.0.0.1:8081/api/status >/dev/null || exit 1
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server/index.js"]
