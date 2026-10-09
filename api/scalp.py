import json
import sys
from http.server import BaseHTTPRequestHandler
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import market


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            body = json.dumps(market.pack_scalp(market.fetch_scalp()), separators=(",", ":")).encode()
            status = 200
        except Exception as exc:
            body = json.dumps({"error": str(exc)}, separators=(",", ":")).encode()
            status = 502
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)
