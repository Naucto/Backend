#!/bin/sh
set -e

# Don't start if the image build fails.
docker compose -f docker-compose.yml -f docker-compose.dev.yml build && \
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --watch backend
