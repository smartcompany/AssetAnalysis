"""X login and recent posts for the selected symbol."""

import base64
import hashlib
import json
import os
import secrets
import threading
import time
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import market

ROOT = Path(__file__).resolve().parent
SESSION_PATH = ROOT / ".x-session.json"
CLIENT_PATH = ROOT / "x-client.json"
REDIRECT_URI = os.environ.get("X_REDIRECT_URI", "http://127.0.0.1:8787/api/x/callback")
AUTH_URL = "https://twitter.com/i/oauth2/authorize"
TOKEN_URL = "https://api.x.com/2/oauth2/token"
ME_URL = "https://api.x.com/2/users/me"
SEARCH_URL = "https://api.x.com/2/tweets/search/recent"
SCOPES = "tweet.read users.read offline.access"
ALLOWED_USERNAME = "gunnylove1"

LOCK = threading.Lock()
PENDING = {}
POST_CACHE = {}
INDEX_QUERIES = {
    "^NDX": '"나스닥 100" OR "Nasdaq 100" OR $NDX OR $QQQ',
    "^GSPC": '"S&P 500" OR "S&P500" OR $SPX OR $SPY',
    "^DJI": '"다우존스" OR "Dow Jones" OR $DJI',
    "^SOX": '"필라델피아 반도체" OR "반도체 지수" OR $SOX',
    "^RUT": '"러셀 2000" OR "Russell 2000" OR $RUT',
    "^KS11": '"코스피" OR KOSPI',
    "^KQ11": '"코스닥" OR KOSDAQ',
    "SEOUL-APT": '"서울 아파트" OR "서울아파트"',
}


class ConfigError(Exception):
    pass


class AuthError(Exception):
    pass


def load_env_file():
    path = ROOT / ".env.local"
    try:
        lines = path.read_text().splitlines()
    except OSError:
        return
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def credentials():
    load_env_file()
    client_id = (
        os.environ.get("X_CLIENT_ID")
        or os.environ.get("x_client_id")
        or ""
    ).strip()
    client_secret = (
        os.environ.get("X_CLIENT_SECRET")
        or os.environ.get("x_client_sec")
        or os.environ.get("x_client_secret")
        or ""
    ).strip()
    if CLIENT_PATH.is_file():
        try:
            saved = json.loads(CLIENT_PATH.read_text())
        except (OSError, json.JSONDecodeError):
            saved = {}
        client_id = client_id or str(saved.get("clientId") or "").strip()
        client_secret = client_secret or str(saved.get("clientSecret") or "").strip()
    return client_id, client_secret


def configured():
    client_id, client_secret = credentials()
    return bool(client_id and client_secret)


def save_credentials(client_id, client_secret):
    client_id = str(client_id or "").strip()
    client_secret = str(client_secret or "").strip()
    if not client_id or not client_secret:
        raise ConfigError("Client ID와 Client Secret을 모두 입력해 주세요.")
    with LOCK:
        CLIENT_PATH.write_text(json.dumps({"clientId": client_id, "clientSecret": client_secret}))
        try:
            os.chmod(CLIENT_PATH, 0o600)
        except OSError:
            pass


def allowed_user(username):
    return (username or "").casefold() == ALLOWED_USERNAME.casefold()


def status():
    session = read_session()
    if session is not None and not allowed_user(session.get("username") or ""):
        logout()
        session = None
    if session is None:
        return {"configured": configured(), "loggedIn": False, "username": "", "name": "", "allowedUser": ALLOWED_USERNAME}
    return {
        "configured": configured(),
        "loggedIn": True,
        "username": session.get("username") or "",
        "name": session.get("name") or "",
        "allowedUser": ALLOWED_USERNAME,
    }


def authorization_url():
    client_id, _secret = credentials()
    if not client_id:
        raise ConfigError("X 로그인 설정이 없습니다.")
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    state = secrets.token_urlsafe(24)
    with LOCK:
        PENDING[state] = {"verifier": verifier, "at": time.time()}
        for key, item in list(PENDING.items()):
            if time.time() - item["at"] > 600:
                PENDING.pop(key, None)
    query = urlencode({
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": REDIRECT_URI,
        "scope": SCOPES,
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    })
    return AUTH_URL + "?" + query


def exchange(code, state):
    with LOCK:
        pending = PENDING.pop(state, None)
    if pending is None or time.time() - pending["at"] > 600:
        raise AuthError("로그인이 만료되었습니다. 다시 로그인해 주세요.")
    token = token_request({
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": REDIRECT_URI,
        "code_verifier": pending["verifier"],
    })
    profile = api_json(ME_URL + "?user.fields=name,username", token["access_token"])
    user = profile.get("data") or {}
    username = user.get("username") or ""
    if not allowed_user(username):
        raise AuthError(ALLOWED_USERNAME + " 계정만 사용할 수 있습니다.")
    save_token(token, username, user.get("name") or "")


def logout():
    with LOCK:
        POST_CACHE.clear()
    try:
        SESSION_PATH.unlink()
    except OSError:
        pass


def fetch_posts(symbol):
    spec = market.INSTRUMENTS.get(symbol)
    if spec is None:
        raise ValueError("지원하지 않는 종목입니다.")
    now = time.time()
    cached = POST_CACHE.get(symbol)
    if cached is not None and now - cached["at"] < 600:
        return cached["payload"]
    token = valid_access_token()
    query = search_query(symbol, spec["name"])
    params = urlencode({
        "query": query,
        "max_results": 10,
        "tweet.fields": "created_at,public_metrics,lang,author_id,note_tweet",
        "expansions": "author_id",
        "user.fields": "name,username",
    })
    try:
        payload = api_json(SEARCH_URL + "?" + params, token)
    except RuntimeError as exc:
        if "note_tweet" not in str(exc):
            raise
        params = urlencode({
            "query": query,
            "max_results": 10,
            "tweet.fields": "created_at,public_metrics,lang,author_id",
            "expansions": "author_id",
            "user.fields": "name,username",
        })
        payload = api_json(SEARCH_URL + "?" + params, token)
    users = {row["id"]: row for row in ((payload.get("includes") or {}).get("users") or [])}
    posts = []
    for row in payload.get("data") or []:
        author = users.get(row.get("author_id")) or {}
        note = row.get("note_tweet") or {}
        metrics = row.get("public_metrics") or {}
        posts.append({
            "id": row.get("id") or "",
            "text": note.get("text") or row.get("text") or "",
            "createdAt": row.get("created_at") or "",
            "lang": row.get("lang") or "",
            "username": author.get("username") or "",
            "name": author.get("name") or "",
            "likes": metrics.get("like_count") or 0,
            "reposts": metrics.get("retweet_count") or 0,
            "replies": metrics.get("reply_count") or 0,
        })
    result = {"symbol": symbol, "name": spec["name"], "query": query, "posts": posts}
    POST_CACHE[symbol] = {"at": now, "payload": result}
    return result


def search_query(symbol, name):
    if symbol in INDEX_QUERIES:
        inner = INDEX_QUERIES[symbol]
    elif symbol in market.NEWS_UNDERLYING:
        ticker = market.NEWS_UNDERLYING[symbol]
        inner = "$" + ticker if name == ticker else '($%s OR "%s")' % (ticker, name)
    elif symbol.endswith(".KS") or symbol.endswith(".KQ"):
        inner = '"%s"' % name
    elif symbol.endswith("-USD"):
        tag = symbol.split("-", 1)[0]
        inner = '($%s OR "%s")' % (tag, name)
    elif name == symbol:
        inner = "$" + symbol
    else:
        inner = '($%s OR "%s")' % (symbol, name)
    return "(" + inner + ") -is:retweet"


def valid_access_token():
    session = read_session()
    if session is None:
        raise AuthError("X에 로그인해야 글을 가져올 수 있습니다.")
    if not allowed_user(session.get("username") or ""):
        logout()
        raise AuthError(ALLOWED_USERNAME + " 계정만 사용할 수 있습니다.")
    if session.get("expires_at", 0) > time.time() + 60:
        return session["access_token"]
    if not session.get("refresh_token"):
        logout()
        raise AuthError("X 로그인이 만료되었습니다. 다시 로그인해 주세요.")
    try:
        token = token_request({
            "grant_type": "refresh_token",
            "refresh_token": session["refresh_token"],
        })
    except AuthError:
        logout()
        raise
    save_token(token, session.get("username") or "", session.get("name") or "")
    return token["access_token"]


def token_request(fields):
    client_id, client_secret = credentials()
    if not client_id:
        raise ConfigError("X 로그인 설정이 없습니다.")
    body = dict(fields)
    body["client_id"] = client_id
    headers = {"Content-Type": "application/x-www-form-urlencoded"}
    if client_secret:
        basic = base64.b64encode(("%s:%s" % (client_id, client_secret)).encode()).decode()
        headers["Authorization"] = "Basic " + basic
    request = Request(TOKEN_URL, data=urlencode(body).encode(), headers=headers)
    try:
        with urlopen(request, timeout=20) as response:
            payload = json.load(response)
    except HTTPError as exc:
        raise AuthError(error_message(exc) or "X 로그인에 실패했습니다.")
    if not payload.get("access_token"):
        raise AuthError("X 로그인에 실패했습니다.")
    return payload


def api_json(url, token):
    request = Request(url, headers={"Authorization": "Bearer " + token})
    try:
        with urlopen(request, timeout=20) as response:
            return json.load(response)
    except HTTPError as exc:
        message = error_message(exc) or "X 글을 가져오지 못했습니다."
        if exc.code == 401:
            raise AuthError(message)
        if exc.code == 402 or "credit" in message.lower():
            raise RuntimeError("X 크레딧이 부족합니다.")
        raise RuntimeError(message)


def error_message(exc):
    try:
        payload = json.loads(exc.read().decode("utf-8", "replace"))
    except (OSError, json.JSONDecodeError):
        return ""
    if isinstance(payload.get("errors"), list) and payload["errors"]:
        item = payload["errors"][0]
        return item.get("message") or item.get("detail") or ""
    detail = payload.get("detail") or ""
    title = payload.get("title") or ""
    if title and detail:
        return title + ": " + detail
    return title or detail


def save_token(token, username, name):
    session = {
        "access_token": token["access_token"],
        "refresh_token": token.get("refresh_token") or "",
        "expires_at": time.time() + int(token.get("expires_in") or 7200),
        "username": username,
        "name": name,
    }
    with LOCK:
        SESSION_PATH.write_text(json.dumps(session))
        try:
            os.chmod(SESSION_PATH, 0o600)
        except OSError:
            pass


def read_session():
    try:
        session = json.loads(SESSION_PATH.read_text())
    except (OSError, json.JSONDecodeError):
        return None
    if not session.get("access_token"):
        return None
    return session
