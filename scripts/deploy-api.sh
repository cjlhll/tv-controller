#!/usr/bin/env bash
# 把本机 API 以 Docker 部署到 192.168.1.2（需已配置 SSH 免密）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST="${TVLOCK_HOST:-root@192.168.1.2}"
REMOTE_DIR="${TVLOCK_REMOTE_DIR:-/opt/tvlock}"

ssh -o BatchMode=yes -o ConnectTimeout=8 "$HOST" "mkdir -p '$REMOTE_DIR/cloud/local-server' '$REMOTE_DIR/cloudfunctions/api' '$REMOTE_DIR/data'"

rsync -az --delete \
  "$ROOT/cloudfunctions/api/logic.js" \
  "$HOST:$REMOTE_DIR/cloudfunctions/api/logic.js"

rsync -az \
  "$ROOT/cloud/local-server/server.js" \
  "$ROOT/cloud/local-server/wechat-notify.js" \
  "$ROOT/cloud/local-server/Dockerfile" \
  "$ROOT/cloud/local-server/docker-compose.yml" \
  "$HOST:$REMOTE_DIR/cloud/local-server/"

if [[ -f "$ROOT/cloud/local-server/.env" ]]; then
  rsync -az "$ROOT/cloud/local-server/.env" "$HOST:$REMOTE_DIR/cloud/local-server/.env"
  ssh -o BatchMode=yes "$HOST" "chmod 600 '$REMOTE_DIR/cloud/local-server/.env'"
fi

if [[ -f "$ROOT/cloud/local-server/data.json" ]]; then
  ssh -o BatchMode=yes "$HOST" "test -s '$REMOTE_DIR/data/data.json'" || \
    rsync -az "$ROOT/cloud/local-server/data.json" "$HOST:$REMOTE_DIR/data/data.json"
fi

ssh -o BatchMode=yes "$HOST" "bash -s" <<'EOF'
set -euo pipefail
cd /opt/tvlock
if ! command -v docker >/dev/null 2>&1; then
  echo "remote: installing docker..."
  curl -fsSL https://get.docker.com | sh
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "remote: docker compose plugin missing"
  exit 1
fi
chown -R 1000:1000 /opt/tvlock/data
cd /opt/tvlock/cloud/local-server
docker compose up -d --build
docker compose ps
EOF
