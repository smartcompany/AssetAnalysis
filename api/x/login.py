import sys
from http.server import BaseHTTPRequestHandler
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
import xfeed


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        host, proto = xfeed.request_target(self.headers)
        secure = proto != "http"
        try:
            target, pending = xfeed.oauth_start(xfeed.callback_uri(host, proto))
        except xfeed.ConfigError:
            xfeed.send_html(
                self,
                200,
                "<!DOCTYPE html><meta charset=\"utf-8\"><title>X 로그인</title>"
                "<p>X 로그인 설정이 없습니다. Vercel 환경 변수에 x_client_id와 x_client_sec이 있어야 합니다.</p>"
                "<p><a href=\"/#x\">돌아가기</a></p>",
            )
            return
        xfeed.send_redirect(self, target, [xfeed.cookie_header("x_oauth", pending, 600, secure)])
