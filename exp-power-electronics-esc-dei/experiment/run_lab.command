#!/bin/bash
# Double-click this file to run the ESC Power-Electronics Lab.
# It serves the simulation over HTTP (required — the lab cannot run from a file:// path)
# and opens it in your default browser. Close this Terminal window to stop the server.
cd "$(dirname "$0")/simulation" || exit 1
PORT=8731
echo "ESC Power-Electronics Lab"
echo "Serving $(pwd) on http://localhost:$PORT"
echo "Leave this window open while you use the lab. Close it to stop."
# open the browser a moment after the server starts
( sleep 1; (command -v open >/dev/null && open "http://localhost:$PORT/index.html") || true ) &
python3 -m http.server "$PORT"
