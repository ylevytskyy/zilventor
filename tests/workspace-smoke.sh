#!/usr/bin/env bash
set -eu
pnpm --version >/dev/null
pnpm -r typecheck
echo "workspace ok"
