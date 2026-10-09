#!/usr/bin/env python3
"""Local page for spot moving-average trades."""

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import market

ROOT = Path(__file__).resolve().parent / "public"
HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "8787"))


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/api/klines":
            self.serve_json()
            return
        if path == "/api/scalp":
            self.serve_scalp()
            return
        if path in ("/", "/index.html"):
            self.serve_file("index.html", "text/html; charset=utf-8")
            return
        if path == "/strategy.js":
            self.serve_file("strategy.js", "text/javascript; charset=utf-8")
            return
        if path == "/app.js":
            self.serve_file("app.js", "text/javascript; charset=utf-8")
            return
        self.send_error(404)

    def serve_json(self):
        symbol = parse_qs(urlparse(self.path).query).get("symbol", ["BTC-USD"])[0]
        try:
            body = json.dumps(market.fetch_bars(symbol)).encode()
        except ValueError:
            body = json.dumps({"error": "지원하지 않는 종목입니다."}).encode()
            self.respond(400, "application/json; charset=utf-8", body)
            return
        except Exception as exc:
            body = json.dumps({"error": str(exc)}).encode()
            self.respond(502, "application/json; charset=utf-8", body)
            return
        self.respond(200, "application/json; charset=utf-8", body)

    def serve_scalp(self):
        try:
            body = json.dumps(market.fetch_scalp()).encode()
        except Exception as exc:
            body = json.dumps({"error": str(exc)}).encode()
            self.respond(502, "application/json; charset=utf-8", body)
            return
        self.respond(200, "application/json; charset=utf-8", body)

    def serve_file(self, name, content_type):
        file_path = ROOT / name
        if not file_path.is_file():
            self.send_error(404)
            return
        self.respond(200, content_type, file_path.read_bytes())

    def respond(self, status, content_type, body):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        print("%s - %s" % (self.address_string(), fmt % args))


def main():
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print("http://%s:%s" % (HOST, PORT))
    server.serve_forever()


if __name__ == "__main__":
    main()
