import sys
from http.server import BaseHTTPRequestHandler
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
import xfeed


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        session = xfeed.unpack_cookie(xfeed.request_cookies(self.headers.get("Cookie")).get("x_session"))
        xfeed.send_json(self, 200, xfeed.describe(session))
