import sys
from http.server import BaseHTTPRequestHandler
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
import xfeed


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        host, proto = xfeed.request_target(self.headers)
        xfeed.send_json(self, 200, {"ok": True}, [xfeed.clear_cookie("x_session", proto != "http")])
