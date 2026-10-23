#!/bin/sh
# Play Last Card: starts a local server and opens your browser.
# Needs Python 3 or Node.js. Press Ctrl+C to stop the server.
cd "$(dirname "$0")" || exit 1
PORT="${PORT:-8000}"
URL="http://localhost:$PORT/"

open_browser() {
  [ "$NO_BROWSER" = "1" ] && return
  (
    sleep 1
    if command -v open >/dev/null 2>&1; then open "$URL"
    elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL"
    fi
  ) >/dev/null 2>&1 &
}

echo "Last Card is running at $URL (Ctrl+C to stop)"
echo "In Chrome or Edge, use the install icon in the address bar to add it as an app."

if command -v python3 >/dev/null 2>&1; then
  open_browser
  exec python3 -m http.server "$PORT" --bind 127.0.0.1
elif command -v npx >/dev/null 2>&1; then
  open_browser
  exec npx --yes serve -l "$PORT" .
else
  echo "Last Card needs Python 3 (python.org) or Node.js (nodejs.org) to run locally." >&2
  echo "Or play the hosted version linked in README.md." >&2
  exit 1
fi
