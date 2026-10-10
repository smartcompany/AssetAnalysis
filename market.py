"""Spot prices from Yahoo Finance, and Bitcoin 1-second bars from Binance."""

import calendar
import json
import time
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

DAY_MS = 86_400_000
SCALP_SECONDS = 24 * 60 * 60
SCALP_CACHE = {"at": 0, "payload": None}
INSTRUMENTS = {
    "BTC-USD": {"name": "비트코인", "source": "crypto", "quote": "USD", "venue": "야후 파이낸스"},
    "ETH-USD": {"name": "이더리움", "source": "crypto", "quote": "USD", "venue": "야후 파이낸스"},
    "SOL-USD": {"name": "솔라나", "source": "crypto", "quote": "USD", "venue": "야후 파이낸스"},
    "XRP-USD": {"name": "리플", "source": "crypto", "quote": "USD", "venue": "야후 파이낸스"},
    "DOGE-USD": {"name": "도지코인", "source": "crypto", "quote": "USD", "venue": "야후 파이낸스"},
    "BNB-USD": {"name": "바이낸스코인", "source": "crypto", "quote": "USD", "venue": "야후 파이낸스"},
    "^NDX": {"name": "나스닥 100", "source": "nasdaq", "quote": "USD", "venue": "나스닥 100 지수"},
    "QQQ": {"name": "QQQ", "source": "nasdaq", "quote": "USD", "venue": "나스닥 100 ETF"},
    "^GSPC": {"name": "S&P 500", "source": "nasdaq", "quote": "USD", "venue": "S&P 500 지수"},
    "^DJI": {"name": "다우존스", "source": "nasdaq", "quote": "USD", "venue": "다우존스 산업지수"},
    "^SOX": {"name": "필라델피아 반도체", "source": "nasdaq", "quote": "USD", "venue": "필라델피아 반도체 지수"},
    "^RUT": {"name": "러셀 2000", "source": "nasdaq", "quote": "USD", "venue": "러셀 2000 지수"},
    "AAPL": {"name": "애플", "source": "nasdaq", "quote": "USD", "venue": "나스닥 현물 주식"},
    "MSFT": {"name": "마이크로소프트", "source": "nasdaq", "quote": "USD", "venue": "나스닥 현물 주식"},
    "NVDA": {"name": "엔비디아", "source": "nasdaq", "quote": "USD", "venue": "나스닥 현물 주식"},
    "AMZN": {"name": "아마존", "source": "nasdaq", "quote": "USD", "venue": "나스닥 현물 주식"},
    "GOOGL": {"name": "알파벳", "source": "nasdaq", "quote": "USD", "venue": "나스닥 현물 주식"},
    "META": {"name": "메타", "source": "nasdaq", "quote": "USD", "venue": "나스닥 현물 주식"},
    "TSLA": {"name": "테슬라", "source": "nasdaq", "quote": "USD", "venue": "나스닥 현물 주식"},
    "^KS11": {"name": "코스피", "source": "krx", "quote": "KRW", "venue": "코스피 종합지수"},
    "069500.KS": {"name": "KODEX 200", "source": "krx", "quote": "KRW", "venue": "코스피 상장 ETF"},
    "005930.KS": {"name": "삼성전자", "source": "krx", "quote": "KRW", "venue": "코스피 현물 주식"},
    "000660.KS": {"name": "SK하이닉스", "source": "krx", "quote": "KRW", "venue": "코스피 현물 주식"},
    "373220.KS": {"name": "LG에너지솔루션", "source": "krx", "quote": "KRW", "venue": "코스피 현물 주식"},
    "207940.KS": {"name": "삼성바이오로직스", "source": "krx", "quote": "KRW", "venue": "코스피 현물 주식"},
    "005380.KS": {"name": "현대차", "source": "krx", "quote": "KRW", "venue": "코스피 현물 주식"},
    "000270.KS": {"name": "기아", "source": "krx", "quote": "KRW", "venue": "코스피 현물 주식"},
    "035420.KS": {"name": "NAVER", "source": "krx", "quote": "KRW", "venue": "코스피 현물 주식"},
    "035720.KS": {"name": "카카오", "source": "krx", "quote": "KRW", "venue": "코스피 현물 주식"},
    "^KQ11": {"name": "코스닥", "source": "krx", "quote": "KRW", "venue": "코스닥 종합지수"},
    "229200.KS": {"name": "KODEX 코스닥150", "source": "krx", "quote": "KRW", "venue": "코스피 상장 ETF"},
    "247540.KQ": {"name": "에코프로비엠", "source": "krx", "quote": "KRW", "venue": "코스닥 현물 주식"},
    "086520.KQ": {"name": "에코프로", "source": "krx", "quote": "KRW", "venue": "코스닥 현물 주식"},
    "196170.KQ": {"name": "알테오젠", "source": "krx", "quote": "KRW", "venue": "코스닥 현물 주식"},
    "028300.KQ": {"name": "HLB", "source": "krx", "quote": "KRW", "venue": "코스닥 현물 주식"},
    "041510.KQ": {"name": "에스엠", "source": "krx", "quote": "KRW", "venue": "코스닥 현물 주식"},
    "035900.KQ": {"name": "JYP Ent.", "source": "krx", "quote": "KRW", "venue": "코스닥 현물 주식"},
    "263750.KQ": {"name": "펄어비스", "source": "krx", "quote": "KRW", "venue": "코스닥 현물 주식"},
    "277810.KQ": {"name": "레인보우로보틱스", "source": "krx", "quote": "KRW", "venue": "코스닥 현물 주식"},
    "SEOUL-APT": {"name": "서울 아파트", "source": "housing", "quote": "지수", "venue": "KB부동산 월간 아파트 매매가격지수"},
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

    if spec["source"] == "housing":
        bars = fetch_seoul_housing(now)
    else:
        close_hour = {"krx": 7, "nasdaq": 21}.get(spec["source"])
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


def fetch_seoul_housing(now):
    url = (
        "https://data-api.kbland.kr/bfmstat/weekMnthlyHuseTrnd/priceIndex?"
        + urlencode({
            "월간주간구분코드": "01",
            "매물종별구분": "01",
            "매매전세코드": "01",
            "지역코드": "11",
            "기간": "100",
        })
    )
    payload = get_json(url, "Mozilla/5.0")
    header = payload.get("dataHeader") or {}
    if str(header.get("resultCode")) != "10000":
        raise RuntimeError(header.get("message") or "서울 부동산 시세를 가져오지 못했습니다.")
    data = (payload.get("dataBody") or {}).get("data") or {}
    dates = data.get("날짜리스트") or []
    rows = data.get("데이터리스트") or []
    seoul = next((row for row in rows if row.get("지역명") == "서울"), None)
    if seoul is None or not dates:
        raise RuntimeError("서울 아파트 매매가격지수를 찾지 못했습니다.")
    bars = []
    for stamp, value in zip(dates, seoul["dataList"]):
        if value is None:
            continue
        year = int(stamp[:4])
        month = int(stamp[4:6])
        _, count = calendar.monthrange(year, month)
        for day in range(1, count + 1):
            ts = calendar.timegm((year, month, day, 0, 0, 0))
            if ts + DAY_MS // 1000 > now:
                return bars
            bars.append(bar(ts * 1000, value, value, value, value))
    return bars


def fetch_yahoo(symbol, now, close_hour):
    url = (
        "https://query1.finance.yahoo.com/v8/finance/chart/%s"
        "?interval=1d&period1=0&period2=%s" % (quote(symbol), int(now) + DAY_MS // 1000)
    )
    payload = get_json(url, "Mozilla/5.0")
    result = (payload.get("chart") or {}).get("result") or []
    if not result:
        error = (payload.get("chart") or {}).get("error") or {}
        raise RuntimeError(error.get("description") or "시세를 가져오지 못했습니다.")
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
    if close_hour is None:
        return ts + DAY_MS // 1000 <= now
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


def pack_scalp(payload):
    """Fit a day of 1-second bars under Vercel's 4.5 MB response limit."""
    bars = payload["bars"]
    if not bars:
        packed = dict(payload)
        packed["t0"] = 0
        return packed
    t0 = bars[0]["ts"]
    packed_bars = []
    for item in bars:
        packed_bars.append([
            (item["ts"] - t0) // 1000,
            int(round(item["open"] * 100)),
            int(round(item["high"] * 100)),
            int(round(item["low"] * 100)),
            int(round(item["close"] * 100)),
        ])
    packed = dict(payload)
    packed["t0"] = t0
    packed["bars"] = packed_bars
    return packed


def get_json(url, user_agent):
    request = Request(url, headers={"User-Agent": user_agent})
    with urlopen(request, timeout=30) as response:
        return json.load(response)
