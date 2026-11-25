#!/bin/sh
cd -- "$(dirname -- "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  PATH=/opt/homebrew/bin:/usr/local/bin:$PATH
fi
if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' 'Levelmaxing requires Node.js 22 or later. See README.md.'
  exit 1
fi
exec node server.mjs --open
