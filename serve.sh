#!/usr/bin/env bash
# Serves the room at http://localhost:8930. There is no build step: any static file server works.
# This one also tells the browser not to cache, so edits show up on reload.
# It listens on this machine only; set HOST=0.0.0.0 to let other devices on the network in.
cd "$(dirname "$0")" && exec python3 - "${PORT:-8930}" "${HOST:-127.0.0.1}" <<'PY'
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()
    def log_message(self, *args):
        pass

port, host = int(sys.argv[1]), sys.argv[2]
print(f'yumiko: http://localhost:{port}')
ThreadingHTTPServer((host, port), Handler).serve_forever()
PY
