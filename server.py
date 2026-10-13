#!/usr/bin/env python3
"""Local page for spot moving-average trades."""

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, urlparse

import market
import xfeed

ROOT = Path(__file__).resolve().parent / "public"
HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "8787"))


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/api/klines":
            self.serve_json()
            return
        if path == "/api/news":
            self.serve_news()
            return
        if path == "/api/article":
            self.serve_article()
            return
        if path == "/api/x/status":
            self.serve_x_status()
            return
        if path == "/api/x/login":
            self.serve_x_login()
            return
        if path == "/api/x/callback":
            self.serve_x_callback()
            return
        if path == "/api/x/posts":
            self.serve_x_posts()
            return
        if path == "/api/scalp":
            self.serve_scalp()
            return
        if path == "/api/stable":
            self.serve_stable()
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

    def serve_news(self):
        symbol = parse_qs(urlparse(self.path).query).get("symbol", ["BTC-USD"])[0]
        try:
            body = json.dumps(market.fetch_news(symbol)).encode()
        except ValueError:
            body = json.dumps({"error": "지원하지 않는 종목입니다."}).encode()
            self.respond(400, "application/json; charset=utf-8", body)
            return
        except Exception as exc:
            body = json.dumps({"error": str(exc)}).encode()
            self.respond(502, "application/json; charset=utf-8", body)
            return
        self.respond(200, "application/json; charset=utf-8", body)

    def serve_article(self):
        url = parse_qs(urlparse(self.path).query).get("url", [""])[0]
        try:
            body = json.dumps(market.fetch_article(url)).encode()
        except ValueError as exc:
            body = json.dumps({"error": str(exc) or "기사 주소를 열 수 없습니다."}).encode()
            self.respond(400, "application/json; charset=utf-8", body)
            return
        except Exception as exc:
            body = json.dumps({"error": str(exc)}).encode()
            self.respond(502, "application/json; charset=utf-8", body)
            return
        self.respond(200, "application/json; charset=utf-8", body)

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        if path == "/api/x/logout":
            xfeed.logout()
            self.respond(200, "application/json; charset=utf-8", b'{"ok":true}')
            return
        if path == "/api/x/config":
            self.serve_x_config()
            return
        self.send_error(404)

    def serve_x_config(self):
        length = int(self.headers.get("Content-Length") or "0")
        if length <= 0 or length > 8000:
            body = json.dumps({"error": "Client ID와 Client Secret을 모두 입력해 주세요."}).encode()
            self.respond(400, "application/json; charset=utf-8", body)
            return
        try:
            data = json.loads(self.rfile.read(length).decode())
            xfeed.save_credentials(data.get("clientId"), data.get("clientSecret"))
        except (json.JSONDecodeError, xfeed.ConfigError) as exc:
            message = str(exc) if isinstance(exc, xfeed.ConfigError) else "입력 형식이 잘못되었습니다."
            body = json.dumps({"error": message}).encode()
            self.respond(400, "application/json; charset=utf-8", body)
            return
        self.respond(200, "application/json; charset=utf-8", b'{"ok":true}')

    def serve_x_status(self):
        body = json.dumps(xfeed.status()).encode()
        self.respond(200, "application/json; charset=utf-8", body)

    def serve_x_login(self):
        try:
            target = xfeed.authorization_url()
        except xfeed.ConfigError:
            page = (
                "<!DOCTYPE html><meta charset=\"utf-8\"><title>X 로그인</title>"
                "<p>X 로그인을 쓰려면 프로젝트 폴더에 x-client.json 파일을 만들고 서버를 다시 시작하세요.</p>"
                "<p>clientId와 clientSecret을 넣고, X 앱의 콜백 주소는 "
                "http://127.0.0.1:8787/api/x/callback 입니다.</p>"
                "<p><a href=\"/#x\">돌아가기</a></p>"
            ).encode()
            self.respond(200, "text/html; charset=utf-8", page)
            return
        self.redirect(target)

    def serve_x_callback(self):
        query = parse_qs(urlparse(self.path).query)
        if query.get("error"):
            self.redirect("/?x_error=access_denied#x")
            return
        code = (query.get("code") or [""])[0]
        state = (query.get("state") or [""])[0]
        try:
            xfeed.exchange(code, state)
        except (xfeed.AuthError, xfeed.ConfigError) as exc:
            self.redirect("/?x_error=" + quote(str(exc)) + "#x")
            return
        except Exception:
            self.redirect("/?x_error=login_failed#x")
            return
        self.redirect("/#x")

    def serve_x_posts(self):
        symbol = parse_qs(urlparse(self.path).query).get("symbol", ["BTC-USD"])[0]
        try:
            body = json.dumps(xfeed.fetch_posts(symbol)).encode()
        except ValueError as exc:
            body = json.dumps({"error": str(exc)}).encode()
            self.respond(400, "application/json; charset=utf-8", body)
            return
        except xfeed.AuthError as exc:
            body = json.dumps({"error": str(exc), "login": True}).encode()
            self.respond(401, "application/json; charset=utf-8", body)
            return
        except Exception as exc:
            body = json.dumps({"error": str(exc)}).encode()
            self.respond(502, "application/json; charset=utf-8", body)
            return
        self.respond(200, "application/json; charset=utf-8", body)

    def redirect(self, location):
        self.send_response(302)
        self.send_header("Location", location)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def serve_stable(self):
        try:
            body = json.dumps(market.fetch_stable()).encode()
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
