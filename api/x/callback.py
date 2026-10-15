import sys
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import parse_qs, quote, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
import xfeed


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        host, proto = xfeed.request_target(self.headers)
        secure = proto != "http"
        query = parse_qs(urlparse(self.path).query)
        if query.get("error"):
            xfeed.send_redirect(self, "/?x_error=access_denied#x", [xfeed.clear_cookie("x_oauth", secure)])
            return
        code = (query.get("code") or [""])[0]
        state = (query.get("state") or [""])[0]
        pending = xfeed.unpack_cookie(xfeed.request_cookies(self.headers.get("Cookie")).get("x_oauth"))
        try:
            session = xfeed.oauth_finish(code, state, pending, xfeed.callback_uri(host, proto))
        except (xfeed.AuthError, xfeed.ConfigError) as exc:
            xfeed.send_redirect(
                self,
                "/?x_error=" + quote(str(exc)) + "#x",
                [xfeed.clear_cookie("x_oauth", secure)],
            )
            return
        except Exception:
            xfeed.send_redirect(self, "/?x_error=login_failed#x", [xfeed.clear_cookie("x_oauth", secure)])
            return
        xfeed.send_redirect(self, "/#x", [
            xfeed.cookie_header("x_session", session, 60 * 60 * 24 * 60, secure),
            xfeed.clear_cookie("x_oauth", secure),
        ])
