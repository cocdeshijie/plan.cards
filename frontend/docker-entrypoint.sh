#!/bin/sh
# Inject runtime API URL into a JS file the browser can read
# Use node for safe JSON escaping to prevent XSS via env var
node -e "console.log('window.__ENV = ' + JSON.stringify({API_BASE: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'}) + ';')" > /app/public/__env.js
exec "$@"
