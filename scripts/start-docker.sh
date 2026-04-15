#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
SERVICE_ENV_FILE="${ROOT_DIR}/vikunja-mcp.env"

if [[ ! -f "${ROOT_DIR}/.env" ]]; then
  echo "Missing ${ROOT_DIR}/.env"
  echo "Copy .env.example to .env and update values first."
  exit 1
fi

if [[ ! -f "${SERVICE_ENV_FILE}" ]]; then
  echo "Missing ${SERVICE_ENV_FILE} -> creating empty file."
  echo "Copy vikunja-mcp.env.example to vikunja-mcp.env and update values."
  touch "${SERVICE_ENV_FILE}"
fi

cd "${ROOT_DIR}"
docker compose up -d --build
docker compose ps
