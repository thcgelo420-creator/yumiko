#!/usr/bin/env bash
# Serves the room at http://localhost:8930. There is no build step: any static file server works.
# This one also tells the browser not to cache, so edits show up on reload.
cd "$(dirname "$0")" && exec python3 - "${PORT:-8930}" <<'PY'
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()
    def log_message(self, *args):
        pass

port = int(sys.argv[1])
print(f'yumiko: http://localhost:{port}')
ThreadingHTTPServer(('', port), Handler).serve_forever()
PY
