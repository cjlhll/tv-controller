#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node cloudfunctions/api/logic.test.js
exec node cloud/local-server/server.js
