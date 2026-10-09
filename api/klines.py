import json
import sys
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import market


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        symbol = parse_qs(urlparse(self.path).query).get("symbol", ["BTC-USD"])[0]
        try:
            body = json.dumps(market.fetch_bars(symbol), separators=(",", ":")).encode()
            status = 200
        except ValueError:
            body = json.dumps({"error": "지원하지 않는 종목입니다."}, separators=(",", ":")).encode()
            status = 400
        except Exception as exc:
            body = json.dumps({"error": str(exc)}, separators=(",", ":")).encode()
            status = 502
        self._send(status, body)

    def _send(self, status, body):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)
