# Cubiq Studio – statische Website, ausgeliefert von nginx ohne Root-Rechte (offizielles Image von NGINX auf GHCR,
# kein Limit wie bei Docker Hub). Beim Bauen setzt deploy/render.sh Kopf- und Fußzeile ein und füllt Adresse,
# Version und Impressum aus den Build-Argumenten (docker-compose.yml → .env).
FROM ghcr.io/nginx/nginx-unprivileged:stable-alpine

ARG SITE_URL=https://cubiq.studio
ARG STUDIO_VERSION=dev
ARG OPERATOR_NAME=
ARG OPERATOR_ADDRESS=
ARG OPERATOR_EMAIL=
ARG OPERATOR_PHONE=
ARG OPERATOR_REPRESENTATIVE=
ARG OPERATOR_AUTHORITY=

USER root
RUN rm -rf /usr/share/nginx/html/* /etc/nginx/conf.d/*
COPY deploy/nginx.conf /etc/nginx/conf.d/studio.conf
COPY deploy/render.sh /tmp/render.sh
COPY site/ /usr/share/nginx/html/
# Build-Argumente stehen beim RUN als Umgebungsvariablen bereit.
RUN sh /tmp/render.sh /usr/share/nginx/html \
  && rm /tmp/render.sh \
  && chmod -R a+rX /usr/share/nginx/html \
  && mkdir -p /srv/data
USER 101

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
