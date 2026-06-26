#!/bin/sh
set -e

docker compose -f docker-compose.yml -f docker-compose.dev.yml build && \
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --watch backend
