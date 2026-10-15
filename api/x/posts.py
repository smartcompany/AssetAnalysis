import sys
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
import xfeed


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        host, proto = xfeed.request_target(self.headers)
        secure = proto != "http"
        symbol = parse_qs(urlparse(self.path).query).get("symbol", ["BTC-USD"])[0]
        session = xfeed.unpack_cookie(xfeed.request_cookies(self.headers.get("Cookie")).get("x_session"))
        try:
            payload, updated = xfeed.fetch_posts_for(symbol, session)
        except ValueError as exc:
            xfeed.send_json(self, 400, {"error": str(exc)})
            return
        except xfeed.AuthError as exc:
            xfeed.send_json(self, 401, {"error": str(exc), "login": True}, [xfeed.clear_cookie("x_session", secure)])
            return
        except Exception as exc:
            xfeed.send_json(self, 502, {"error": str(exc)})
            return
        cookies = [xfeed.cookie_header("x_session", updated, 60 * 60 * 24 * 60, secure)] if updated else None
        xfeed.send_json(self, 200, payload, cookies)
