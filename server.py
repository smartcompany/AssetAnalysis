#!/usr/bin/env python3
"""Local page for spot moving-average trades."""

import calendar
import json
import os
import time
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, urlparse
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "8787"))
DAY_MS = 86_400_000
SCALP_SECONDS = 24 * 60 * 60
SCALP_CACHE = {"at": 0, "payload": None}
INSTRUMENTS = {
    "BTCUSDT": {"name": "비트코인", "source": "bybit", "quote": "USDT", "venue": "바이비트 현물"},
    "ETHUSDT": {"name": "이더리움", "source": "bybit", "quote": "USDT", "venue": "바이비트 현물"},
    "SOLUSDT": {"name": "솔라나", "source": "bybit", "quote": "USDT", "venue": "바이비트 현물"},
    "XRPUSDT": {"name": "리플", "source": "bybit", "quote": "USDT", "venue": "바이비트 현물"},
    "DOGEUSDT": {"name": "도지코인", "source": "bybit", "quote": "USDT", "venue": "바이비트 현물"},
    "BNBUSDT": {"name": "바이낸스코인", "source": "bybit", "quote": "USDT", "venue": "바이비트 현물"},
    "AAPL": {"name": "애플", "source": "nasdaq", "quote": "USD", "venue": "나스닥 현물 주식"},
    "MSFT": {"name": "마이크로소프트", "source": "nasdaq", "quote": "USD", "venue": "나스닥 현물 주식"},
    "NVDA": {"name": "엔비디아", "source": "nasdaq", "quote": "USD", "venue": "나스닥 현물 주식"},
    "AMZN": {"name": "아마존", "source": "nasdaq", "quote": "USD", "venue": "나스닥 현물 주식"},
    "GOOGL": {"name": "알파벳", "source": "nasdaq", "quote": "USD", "venue": "나스닥 현물 주식"},
    "META": {"name": "메타", "source": "nasdaq", "quote": "USD", "venue": "나스닥 현물 주식"},
    "TSLA": {"name": "테슬라", "source": "nasdaq", "quote": "USD", "venue": "나스닥 현물 주식"},
    "005930.KS": {"name": "삼성전자", "source": "krx", "quote": "KRW", "venue": "코스피 현물 주식"},
    "000660.KS": {"name": "SK하이닉스", "source": "krx", "quote": "KRW", "venue": "코스피 현물 주식"},
    "373220.KS": {"name": "LG에너지솔루션", "source": "krx", "quote": "KRW", "venue": "코스피 현물 주식"},
    "207940.KS": {"name": "삼성바이오로직스", "source": "krx", "quote": "KRW", "venue": "코스피 현물 주식"},
    "005380.KS": {"name": "현대차", "source": "krx", "quote": "KRW", "venue": "코스피 현물 주식"},
    "000270.KS": {"name": "기아", "source": "krx", "quote": "KRW", "venue": "코스피 현물 주식"},
    "035420.KS": {"name": "NAVER", "source": "krx", "quote": "KRW", "venue": "코스피 현물 주식"},
    "035720.KS": {"name": "카카오", "source": "krx", "quote": "KRW", "venue": "코스피 현물 주식"},
}
CACHE = {}


def fetch_bars(symbol):
    spec = INSTRUMENTS.get(symbol)
    if spec is None:
        raise ValueError("unknown symbol")
    now = time.time()
    cached = CACHE.get(symbol)
    if cached is not None and now - cached["at"] < 300:
        return cached["payload"]

    if spec["source"] == "bybit":
        bars = fetch_bybit(symbol, now)
    else:
        close_hour = 7 if spec["source"] == "krx" else 21
        bars = fetch_yahoo(symbol, now, close_hour)
    result = {
        "symbol": symbol,
        "name": spec["name"],
        "quote": spec["quote"],
        "venue": spec["venue"],
        "market": "spot",
        "interval": "D",
        "bars": bars,
    }
    CACHE[symbol] = {"at": now, "payload": result}
    return result


def fetch_bybit(symbol, now):
    now_ms = int(now * 1000)
    by_ts = {}
    end = None
    for _ in range(20):
        url = (
            "https://api.bybit.com/v5/market/kline"
            "?category=spot&symbol=%s&interval=D&limit=1000" % symbol
        )
        if end is not None:
            url += "&end=%s" % end
        payload = get_json(url, "CoinTradingPrototype/1.0")
        if payload.get("retCode") != 0:
            raise RuntimeError(payload.get("retMsg") or "Bybit error")
        rows = payload["result"]["list"]
        if not rows:
            break
        for row in rows:
            ts = int(row[0])
            if ts + DAY_MS > now_ms:
                continue
            by_ts[ts] = bar(ts, row[1], row[2], row[3], row[4])
        if len(rows) < 1000:
            break
        end = int(rows[-1][0]) - 1
    return [by_ts[ts] for ts in sorted(by_ts)]


def fetch_yahoo(symbol, now, close_hour):
    url = (
        "https://query1.finance.yahoo.com/v8/finance/chart/%s"
        "?interval=1d&period1=0&period2=%s" % (quote(symbol), int(now) + DAY_MS // 1000)
    )
    payload = get_json(url, "Mozilla/5.0")
    result = (payload.get("chart") or {}).get("result") or []
    if not result:
        error = (payload.get("chart") or {}).get("error") or {}
        raise RuntimeError(error.get("description") or "주식 시세를 가져오지 못했습니다.")
    series = result[0]
    timestamps = series.get("timestamp") or []
    prices = series["indicators"]["quote"][0]
    bars = []
    for index, ts in enumerate(timestamps):
        if not session_closed(ts, now, close_hour):
            continue
        values = [prices[name][index] for name in ("open", "high", "low", "close")]
        if any(value is None for value in values):
            continue
        bars.append(bar(ts * 1000, *values))
    return bars


def session_closed(ts, now, close_hour):
    day = time.gmtime(ts)
    close_at = calendar.timegm((day.tm_year, day.tm_mon, day.tm_mday, close_hour, 0, 0))
    return now >= close_at


def bar(ts, open_, high, low, close, clock="utc-date"):
    if clock == "kst":
        stamp = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(ts / 1000 + 9 * 3600))
    else:
        stamp = time.strftime("%Y-%m-%d", time.gmtime(ts / 1000))
    return {
        "time": stamp,
        "ts": int(ts),
        "open": float(open_),
        "high": float(high),
        "low": float(low),
        "close": float(close),
    }


def fetch_scalp(now=None):
    now = time.time() if now is None else now
    cached = SCALP_CACHE["payload"]
    if cached is not None and now - SCALP_CACHE["at"] < 120:
        return cached

    end_ms = int(now * 1000) // 1000 * 1000
    start_ms = end_ms - SCALP_SECONDS * 1000
    starts = list(range(start_ms, end_ms, 1000 * 1000))

    def load(start):
        url = (
            "https://api.binance.com/api/v3/klines"
            "?symbol=BTCUSDT&interval=1s&limit=1000&startTime=%s" % start
        )
        payload = get_json(url, "Mozilla/5.0")
        if not isinstance(payload, list):
            message = payload.get("msg") if isinstance(payload, dict) else "초봉을 가져오지 못했습니다."
            raise RuntimeError(message)
        return payload

    with ThreadPoolExecutor(max_workers=6) as pool:
        groups = list(pool.map(load, starts))

    by_ts = {}
    for rows in groups:
        for row in rows:
            ts = int(row[0])
            if ts < start_ms or ts >= end_ms:
                continue
            by_ts[ts] = bar(ts, row[1], row[2], row[3], row[4], "kst")
    bars = [by_ts[ts] for ts in sorted(by_ts)]
    result = {
        "symbol": "BTCUSDT",
        "name": "비트코인",
        "quote": "USDT",
        "venue": "바이낸스 현물",
        "market": "spot",
        "interval": "1s",
        "bars": bars,
    }
    SCALP_CACHE["at"] = now
    SCALP_CACHE["payload"] = result
    return result


def get_json(url, user_agent):
    request = Request(url, headers={"User-Agent": user_agent})
    with urlopen(request, timeout=30) as response:
        return json.load(response)


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
        symbol = parse_qs(urlparse(self.path).query).get("symbol", ["BTCUSDT"])[0]
        try:
            body = json.dumps(fetch_bars(symbol)).encode()
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
            body = json.dumps(fetch_scalp()).encode()
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
