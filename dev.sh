#!/bin/sh

# Brings up the dev environment, with hot reload support. Do not use for live production.
docker compose -f docker-compose.yml -f docker-compose.dev.yml watch
