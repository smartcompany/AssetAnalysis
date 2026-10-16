"""Spot prices from Yahoo Finance, and Bitcoin 1-second bars from Binance."""

import calendar
import html
import ipaddress
import json
import re
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta, timezone
from email.utils import parsedate_to_datetime
from urllib.error import HTTPError
from urllib.parse import quote, urlencode, urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener, urlopen
from xml.etree import ElementTree

DAY_MS = 86_400_000
SCALP_SECONDS = 24 * 60 * 60
SCALP_CACHE = {"at": 0, "payload": None}
STABLE_CACHE = {"at": 0, "payload": None}
INSTRUMENTS = {
    "BTC-USD": {"name": "비트코인", "source": "crypto", "quote": "USD", "venue": "야후 파이낸스"},
    "ETH-USD": {"name": "이더리움", "source": "crypto", "quote": "USD", "venue": "야후 파이낸스"},
    "SOL-USD": {"name": "솔라나", "source": "crypto", "quote": "USD", "venue": "야후 파이낸스"},
    "XRP-USD": {"name": "리플", "source": "crypto", "quote": "USD", "venue": "야후 파이낸스"},
    "DOGE-USD": {"name": "도지코인", "source": "crypto", "quote": "USD", "venue": "야후 파이낸스"},
    "BNB-USD": {"name": "바이낸스코인", "source": "crypto", "quote": "USD", "venue": "야후 파이낸스"},
    "ZEC-USD": {"name": "지캐시", "source": "crypto", "quote": "USD", "venue": "야후 파이낸스"},
    "XMR-USD": {"name": "모네로", "source": "crypto", "quote": "USD", "venue": "야후 파이낸스"},
    "QQQX-USD": {"name": "QQQ", "source": "crypto", "quote": "USD", "venue": "xStock 토큰"},
    "SPYX-USD": {"name": "S&P 500", "source": "crypto", "quote": "USD", "venue": "xStock 토큰"},
    "AAPLX-USD": {"name": "애플", "source": "crypto", "quote": "USD", "venue": "xStock 토큰"},
    "MSFTX-USD": {"name": "마이크로소프트", "source": "crypto", "quote": "USD", "venue": "xStock 토큰"},
    "NVDAX-USD": {"name": "엔비디아", "source": "crypto", "quote": "USD", "venue": "xStock 토큰"},
    "AMZNX-USD": {"name": "아마존", "source": "crypto", "quote": "USD", "venue": "xStock 토큰"},
    "GOOGLX-USD": {"name": "알파벳", "source": "crypto", "quote": "USD", "venue": "xStock 토큰"},
    "METAX37055-USD": {"name": "메타", "source": "crypto", "quote": "USD", "venue": "xStock 토큰"},
    "TSLAX-USD": {"name": "테슬라", "source": "crypto", "quote": "USD", "venue": "xStock 토큰"},
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
    "KRW=X": {"name": "원달러", "source": "fx", "quote": "KRW", "venue": "야후 파이낸스 환율"},
}
CACHE = {}
NEWS_CACHE = {}
ARTICLE_CACHE = {}
KST = timezone(timedelta(hours=9))
NEWS_UNDERLYING = {
    "QQQX-USD": "QQQ",
    "SPYX-USD": "SPY",
    "AAPLX-USD": "AAPL",
    "MSFTX-USD": "MSFT",
    "NVDAX-USD": "NVDA",
    "AMZNX-USD": "AMZN",
    "GOOGLX-USD": "GOOGL",
    "METAX37055-USD": "META",
    "TSLAX-USD": "TSLA",
}


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


def fetch_news(symbol):
    spec = INSTRUMENTS.get(symbol)
    if spec is None:
        raise ValueError("unknown symbol")
    now = time.time()
    cached = NEWS_CACHE.get(symbol)
    if cached is not None and now - cached["at"] < 600:
        return cached["payload"]
    if symbol == "SEOUL-APT":
        items = read_rss(
            "https://news.google.com/rss/search?q=%s&hl=ko&gl=KR&ceid=KR:ko" % quote("서울 아파트 매매"),
            google=True,
        )
        source = "구글 뉴스"
    elif symbol == "KRW=X":
        items = read_rss(
            "https://news.google.com/rss/search?q=%s&hl=ko&gl=KR&ceid=KR:ko" % quote("원달러 환율"),
            google=True,
        )
        source = "구글 뉴스"
    else:
        query = NEWS_UNDERLYING.get(symbol, symbol)
        korean = query.endswith(".KS") or query.endswith(".KQ") or query in ("^KS11", "^KQ11")
        region = "KR" if korean else "US"
        lang = "ko-KR" if korean else "en-US"
        items = read_rss(
            "https://feeds.finance.yahoo.com/rss/2.0/headline?s=%s&region=%s&lang=%s"
            % (quote(query), region, lang)
        )
        source = "야후 파이낸스"
    result = {
        "symbol": symbol,
        "name": spec["name"],
        "source": source,
        "items": items[:12],
    }
    NEWS_CACHE[symbol] = {"at": now, "payload": result}
    return result


def fetch_article(url):
    if not isinstance(url, str) or not url:
        raise ValueError("기사 주소가 없습니다.")
    now = time.time()
    cached = ARTICLE_CACHE.get(url)
    if cached is not None and now - cached["at"] < 600:
        return cached["payload"]
    target = resolve_article_url(url)
    if not allowed_article_url(target):
        raise ValueError("기사 주소를 열 수 없습니다.")
    raw, final_url = read_html(target)
    title, paragraphs = extract_article(raw)
    if not paragraphs:
        raise RuntimeError("기사 본문을 찾지 못했습니다.")
    host = urlparse(final_url).netloc
    if host.startswith("www."):
        host = host[4:]
    result = {"url": final_url, "title": title, "source": host, "paragraphs": paragraphs[:30]}
    ARTICLE_CACHE[url] = {"at": now, "payload": result}
    return result


def allowed_article_url(url):
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower().rstrip(".")
    if parsed.scheme != "https" or not host or host == "localhost" or host.endswith(".local"):
        return False
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        address = None
    if address is not None and (
        address.is_private or address.is_loopback or address.is_link_local
        or address.is_reserved or address.is_multicast
    ):
        return False
    return True


class ArticleRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not allowed_article_url(newurl):
            raise HTTPError(req.full_url, code, "redirect blocked", headers, fp)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def read_html(url):
    request = Request(url, headers={
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36",
        "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
    })
    opener = build_opener(ArticleRedirect)
    with opener.open(request, timeout=20) as response:
        final_url = response.geturl()
        if not allowed_article_url(final_url):
            raise ValueError("기사 주소를 열 수 없습니다.")
        raw = response.read(2_000_000)
        charset = response.headers.get_content_charset() or "utf-8"
    return raw.decode(charset, "replace"), final_url


def resolve_article_url(url):
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    if host != "news.google.com" or "/articles/" not in parsed.path:
        return url
    article_id = parsed.path.rstrip("/").split("/")[-1]
    if not article_id:
        return url
    try:
        page, _final = read_html(url)
    except Exception:
        return url
    timestamp = re.search(r'data-n-a-ts="(\d+)"', page)
    signature = re.search(r'data-n-a-sg="([^"]+)"', page)
    if timestamp is None or signature is None:
        return url
    inner = json.dumps([
        "garturlreq",
        [["X", "X", ["X", "X"], None, None, 1, 1, "KR:ko", None, 1, None, None, None, None, None, 0, 1],
         "X", "X", 1, [1, 1, 1], 1, 1, None, 0, 0, None, 0],
        article_id,
        int(timestamp.group(1)),
        signature.group(1),
    ], separators=(",", ":"))
    payload = json.dumps([[["Fbv4je", inner, None, "generic"]]], separators=(",", ":"))
    request = Request(
        "https://news.google.com/_/DotsSplashUi/data/batchexecute?rpcids=Fbv4je",
        data=("f.req=" + quote(payload)).encode(),
        headers={
            "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
            "User-Agent": "Mozilla/5.0",
            "Referer": url,
        },
    )
    try:
        with urlopen(request, timeout=20) as response:
            text = response.read().decode("utf-8", "replace")
        rows = json.loads(text.split("\n\n", 1)[1])
        decoded = json.loads(rows[0][2])
    except (HTTPError, IndexError, json.JSONDecodeError, TypeError, ValueError, TimeoutError, OSError):
        return url
    if isinstance(decoded, list) and len(decoded) >= 2 and decoded[0] == "garturlres" and decoded[1].startswith("https://"):
        return decoded[1]
    return url


def extract_article(raw):
    cleaned = re.sub(r"<script\b[^>]*>.*?</script>", " ", raw, flags=re.I | re.S)
    cleaned = re.sub(r"<style\b[^>]*>.*?</style>", " ", cleaned, flags=re.I | re.S)
    title = meta_content(cleaned, "og:title") or tag_text(cleaned, "title")
    paragraphs = []
    yahoo = re.findall(
        r"<p\b[^>]*>\s*<!-- HTML_TAG_START -->(.*?)<!-- HTML_TAG_END -->",
        cleaned,
        flags=re.S,
    )
    for part in yahoo:
        text = plain_text(part)
        if prose(text):
            paragraphs.append(text)
    if len(paragraphs) < 2:
        for part in re.findall(r"<p\b[^>]*>(.*?)</p>", cleaned, flags=re.S):
            text = plain_text(part)
            if prose(text) and text not in paragraphs:
                paragraphs.append(text)
    return title, paragraphs


def meta_content(raw, prop):
    patterns = (
        r'<meta[^>]+property="%s"[^>]+content="([^"]*)"' % re.escape(prop),
        r'<meta[^>]+content="([^"]*)"[^>]+property="%s"' % re.escape(prop),
    )
    for pattern in patterns:
        match = re.search(pattern, raw, flags=re.I)
        if match:
            return plain_text(match.group(1))
    return ""


def tag_text(raw, tag):
    match = re.search(r"<%s[^>]*>(.*?)</%s>" % (tag, tag), raw, flags=re.I | re.S)
    return plain_text(match.group(1)) if match else ""


def plain_text(value):
    text = re.sub(r"<[^>]+>", " ", value or "")
    return re.sub(r"\s+", " ", html.unescape(text)).strip()


def prose(text):
    if len(text) < 40 or text[0] in "{[<":
        return False
    if text.startswith(("function", "(function", "if ", "var ", "window.", "const ", "let ")):
        return False
    letters = len(re.findall(r"[A-Za-z가-힣]", text))
    return letters >= 30


def read_rss(url, google=False):
    request = Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urlopen(request, timeout=20) as response:
        root = ElementTree.fromstring(response.read())
    channel = root.find("channel")
    if channel is None:
        return []
    items = []
    for item in channel.findall("item"):
        title = re.sub(r"\s+", " ", item.findtext("title") or "").strip()
        link = (item.findtext("link") or "").strip()
        summary = re.sub(r"<[^>]+>", "", item.findtext("description") or "")
        summary = re.sub(r"\s+", " ", html.unescape(summary)).strip()
        publisher = ""
        if google and " - " in title:
            title, publisher = title.rsplit(" - ", 1)
        elif link.startswith("http"):
            publisher = urlparse(link).netloc
            if publisher.startswith("www."):
                publisher = publisher[4:]
        published = ""
        raw_date = item.findtext("pubDate")
        if raw_date:
            try:
                published = parsedate_to_datetime(raw_date).astimezone(KST).strftime("%Y-%m-%d %H:%M")
            except (TypeError, ValueError, OverflowError):
                published = ""
        if not title or not link.startswith("http"):
            continue
        if summary == title:
            summary = ""
        items.append({
            "title": title,
            "link": link,
            "publisher": publisher,
            "published": published,
            "summary": summary,
        })
    return items


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


def fetch_stable():
    now = time.time()
    cached = STABLE_CACHE["payload"]
    if cached is not None and now - STABLE_CACHE["at"] < 300:
        return cached
    bars = fetch_bybit_daily("USDCUSDT", now)
    result = {
        "symbol": "USDCUSDT",
        "name": "USDC/USDT",
        "quote": "USDT",
        "venue": "바이비트 현물",
        "market": "spot",
        "interval": "D",
        "bars": bars,
    }
    STABLE_CACHE["at"] = now
    STABLE_CACHE["payload"] = result
    return result


def fetch_bybit_daily(symbol, now):
    by_ts = {}
    end = None
    for _ in range(10):
        query = {"category": "spot", "symbol": symbol, "interval": "D", "limit": "1000"}
        if end is not None:
            query["end"] = str(end)
        url = "https://api.bybit.com/v5/market/kline?" + urlencode(query)
        payload = get_json(url, "Mozilla/5.0")
        if payload.get("retCode") != 0:
            raise RuntimeError(payload.get("retMsg") or "바이비트 시세를 가져오지 못했습니다.")
        rows = (payload.get("result") or {}).get("list") or []
        if not rows:
            break
        for row in rows:
            ts = int(row[0])
            if not session_closed(ts / 1000, now, None):
                continue
            by_ts[ts] = bar(ts, row[1], row[2], row[3], row[4])
        if len(rows) < 1000:
            break
        end = int(rows[-1][0]) - 1
    if not by_ts:
        raise RuntimeError("바이비트 일봉이 없습니다.")
    return [by_ts[ts] for ts in sorted(by_ts)]


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
