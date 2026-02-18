#!/bin/sh
# Inject runtime environment into a JS file the browser can read.
# - NEXT_PUBLIC_API_URL → API_BASE override (for reverse proxy setups)
# - COMMIT_HASH → git commit hash (for Coolify or other platforms that set it at runtime)
bun -e "
  const env = {};
  if (process.env.NEXT_PUBLIC_API_URL) env.API_BASE = process.env.NEXT_PUBLIC_API_URL;
  if (process.env.COMMIT_HASH) env.COMMIT_HASH = process.env.COMMIT_HASH;
  console.log('window.__ENV = ' + JSON.stringify(env) + ';');
" > /app/public/__env.js
exec "$@"
