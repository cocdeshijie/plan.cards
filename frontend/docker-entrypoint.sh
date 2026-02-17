#!/bin/sh
# Inject runtime API URL into a JS file the browser can read.
# Only written when NEXT_PUBLIC_API_URL is explicitly set; otherwise the
# frontend auto-detects the backend from the browser's hostname.
if [ -n "$NEXT_PUBLIC_API_URL" ]; then
  node -e "console.log('window.__ENV = ' + JSON.stringify({API_BASE: process.env.NEXT_PUBLIC_API_URL}) + ';')" > /app/public/__env.js
else
  echo "" > /app/public/__env.js
fi
exec "$@"
