from __future__ import annotations

import json
import hmac
import os
import threading
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
WEB_ROOT = ROOT / "web"
DATA_ROOT = ROOT / "data"
STATE_FILE = Path(os.getenv("EXIT_ALERT_STATE_FILE", str(DATA_ROOT / "state.json")))
PORT = int(os.getenv("PORT", os.getenv("EXIT_ALERT_PORT", "8771")))
HOST = os.getenv("EXIT_ALERT_HOST", "127.0.0.1")
VIBE_TRADING_API_URL = os.getenv("VIBE_TRADING_API_URL", "http://127.0.0.1:8899")
VIBE_TRADING_QUOTE_PATH = os.getenv("VIBE_TRADING_QUOTE_PATH", "/api/market-data")
VIBE_TRADING_DATA_COMMAND = os.getenv("VIBE_TRADING_DATA_COMMAND", "")
DEFAULT_LOCAL_VIBE_ROOT = r"C:\Users\lamu\Documents\Codex\2026-08-09\https-github-com-hkuds-vibe-trading"
VIBE_TRADING_LOCAL_ROOT = os.getenv(
    "VIBE_TRADING_LOCAL_ROOT",
    DEFAULT_LOCAL_VIBE_ROOT if Path(DEFAULT_LOCAL_VIBE_ROOT).is_dir() else "",
)
ENABLE_DEMO_DATA = os.getenv("ENABLE_DEMO_DATA", "0") == "1"
ACCESS_TOKEN = os.getenv("EXIT_ALERT_ACCESS_TOKEN", "")

DEFAULT_SETTINGS = {"volume_ratio": 0.30, "cooldown_minutes": 30, "refresh_seconds": 60}
STATE_LOCK = threading.Lock()


def load_state() -> dict[str, Any]:
    DATA_ROOT.mkdir(exist_ok=True)
    if STATE_FILE.exists():
        try:
            state = json.loads(STATE_FILE.read_text(encoding="utf-8"))
            state.setdefault("watchlist", [])
            state.setdefault("settings", DEFAULT_SETTINGS.copy())
            state.setdefault("alerts", [])
            return state
        except (OSError, json.JSONDecodeError):
            pass
    return {"watchlist": [], "settings": DEFAULT_SETTINGS.copy(), "alerts": []}


STATE = load_state()


def save_state() -> None:
    DATA_ROOT.mkdir(exist_ok=True)
    STATE_FILE.write_text(json.dumps(STATE, ensure_ascii=False, indent=2), encoding="utf-8")


def json_response(handler: BaseHTTPRequestHandler, payload: Any, status: int = 200) -> None:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def demo_quote(item: dict[str, str]) -> dict[str, Any]:
    return {
        "symbol": item["symbol"], "name": item.get("name") or "演示股票", "price": 18.86, "prev_close": 20.10,
        "volume": 8600000, "avg_volume_5": 25000000, "trend_line": 19.25, "trend_line_source": "5日线（演示）",
        "candle": {"open": 19.10, "high": 20.42, "low": 18.70, "close": 18.86, "volume": 8600000},
        "recent_closes": [18.22, 18.45, 18.16, 18.38, 18.55, 18.42, 18.67, 18.50, 18.92, 19.10, 19.34, 19.68, 19.41, 19.82, 20.10, 20.42, 20.25, 20.08, 19.94, 19.68, 19.20, 19.06, 19.32, 19.14, 18.86],
        "timestamp": now(), "is_demo": True,
    }


def fetch_quote(item: dict[str, str]) -> dict[str, Any]:
    query = urllib.parse.urlencode({"symbol": item["symbol"], "name": item.get("name", "")})
    url = f"{VIBE_TRADING_API_URL.rstrip('/')}{VIBE_TRADING_QUOTE_PATH}?{query}"
    request = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=5) as response:
        payload = json.loads(response.read().decode("utf-8"))
    quote = payload.get("quote", payload) if isinstance(payload, dict) else payload
    if not isinstance(quote, dict):
        raise ValueError("Vibe-Trading 返回了无效行情")
    quote.setdefault("symbol", item["symbol"])
    quote.setdefault("name", item.get("name", ""))
    quote.setdefault("timestamp", now())
    return quote


def fetch_quote_from_command(item: dict[str, str]) -> dict[str, Any]:
    """Run a user-configured Vibe-Trading bridge and read one JSON quote."""
    import subprocess

    command = VIBE_TRADING_DATA_COMMAND.format(
        symbol=item["symbol"], name=item.get("name", "")
    )
    completed = subprocess.run(
        command,
        shell=True,
        capture_output=True,
        text=True,
        timeout=15,
        check=True,
    )
    payload = json.loads(completed.stdout)
    quote = payload.get("quote", payload) if isinstance(payload, dict) else payload
    if not isinstance(quote, dict):
        raise ValueError("Vibe-Trading 命令返回了无效行情")
    quote.setdefault("symbol", item["symbol"])
    quote.setdefault("name", item.get("name", ""))
    quote.setdefault("timestamp", now())
    return quote


def fetch_quote_from_local_adapter(item: dict[str, str]) -> dict[str, Any]:
    """Use a local Vibe-Trading checkout without downloading dependencies."""
    import sys

    backend = str(Path(VIBE_TRADING_LOCAL_ROOT) / "backend")
    site_packages = str(Path(VIBE_TRADING_LOCAL_ROOT) / ".venv" / "Lib" / "site-packages")
    for path in (backend, site_packages):
        if path not in sys.path:
            sys.path.insert(0, path)
    from app.adapters.monitoring_adapter import MonitoringAdapter

    adapter = MonitoringAdapter()
    symbol = item["symbol"]
    if symbol.startswith("NAME:"):
        matches = adapter.search(item.get("name") or symbol.removeprefix("NAME:"), limit=1)
        if not matches:
            raise ValueError(f"未找到 {item.get('name') or symbol} 的行情")
        symbol = matches[0].symbol
    elif "." not in symbol:
        code = symbol.replace("NAME:", "")
        symbol = f"{code}.SH" if code.startswith("6") else f"{code}.SZ"
    quotes = adapter.fetch_quotes([symbol])
    if not quotes:
        raise ValueError(f"未找到 {item.get('name') or item['symbol']} 的行情")
    quote = quotes[0].model_dump(mode="json")
    quote["name"] = item.get("name") or quote.get("name") or item["symbol"]
    quote["price"] = quote.pop("price")
    quote["prev_close"] = quote.pop("previous_close")
    quote["volume"] = quote.get("volume", 0)
    history = adapter.fetch_history(symbol, days=30)
    prior = history[-6:-1] if len(history) >= 6 else history[:-1]
    quote["avg_volume_5"] = sum(float(bar.volume) for bar in prior) / len(prior) if prior else 0
    quote["trend_line"] = sum(float(bar.close) for bar in history[-5:]) / min(5, len(history)) if history else quote["price"]
    quote["trend_line_source"] = "5日均线（本机 Vibe-Trading 日线）"
    quote["recent_closes"] = [float(bar.close) for bar in history[-30:]]
    quote["candle"] = {"open": quote["open"], "high": quote["high"], "low": quote["low"], "close": quote["price"], "volume": quote["volume"]}
    return quote


def get_quote(item: dict[str, str]) -> dict[str, Any]:
    try:
        if ENABLE_DEMO_DATA:
            quote = demo_quote(item)
        elif VIBE_TRADING_DATA_COMMAND:
            quote = fetch_quote_from_command(item)
        elif VIBE_TRADING_LOCAL_ROOT:
            quote = fetch_quote_from_local_adapter(item)
        else:
            quote = fetch_quote(item)
        quote["data_status"] = "demo" if quote.get("is_demo") else "live"
        return quote
    except Exception as exc:  # noqa: BLE001
        return {"symbol": item["symbol"], "name": item.get("name", ""), "data_status": "unavailable", "error": str(exc), "timestamp": now()}


def evaluate(quote: dict[str, Any], settings: dict[str, Any]) -> list[dict[str, str]]:
    if quote.get("data_status") == "unavailable":
        return []
    candle = quote.get("candle", {})
    open_price = float(candle.get("open", 0) or 0)
    high = float(candle.get("high", 0) or 0)
    low = float(candle.get("low", 0) or 0)
    close = float(candle.get("close", quote.get("price", 0)) or 0)
    volume = float(quote.get("volume", candle.get("volume", 0)) or 0)
    avg_volume = float(quote.get("avg_volume_5", 0) or 0)
    trend_line = float(quote.get("trend_line", 0) or 0)
    if not all((open_price, high, low, close)):
        return []
    body = abs(close - open_price)
    candle_range = max(0.0001, high - low)
    upper = max(0.0, high - max(open_price, close))
    lower = max(0.0, min(open_price, close) - low)
    volume_hit = avg_volume > 0 and volume >= avg_volume * float(settings.get("volume_ratio", 0.30))
    trend_hit = trend_line > 0 and close < trend_line
    shadow_hit = upper >= max(body * 2, candle_range * 0.35) or lower >= max(body * 2, candle_range * 0.35)
    alerts: list[dict[str, str]] = []
    if volume_hit:
        alerts.append({"level": "blue", "title": "成交量异常", "reason": f"当前成交量达到前五日均量的 {volume / avg_volume:.0%}"})
    if trend_hit:
        alerts.append({"level": "blue", "title": "趋势线承压", "reason": f"最新价 {close:.2f} 低于 {quote.get('trend_line_source', '趋势线')} {trend_line:.2f}"})
    if shadow_hit:
        alerts.append({"level": "blue", "title": "K线形态异常", "reason": "出现异常长影线，需按纪律检查仓位"})
    if volume_hit and trend_hit:
        alerts.append({"level": "orange", "title": "减仓条件", "reason": "成交量条件与趋势线条件同时满足"})
    if volume_hit and trend_hit and shadow_hit:
        alerts.append({"level": "red", "title": "离场条件", "reason": "放量跌破趋势线并叠加异常影线"})
    return alerts


def snapshot() -> dict[str, Any]:
    with STATE_LOCK:
        items = list(STATE["watchlist"])
        settings = {**DEFAULT_SETTINGS, **STATE.get("settings", {})}
        history = list(STATE.get("alerts", []))[-80:]
    stocks, alerts = [], []
    for item in items:
        quote = get_quote(item)
        rules = evaluate(quote, settings)
        stocks.append({**item, "quote": quote, "rules": rules})
        alerts.extend({**rule, "symbol": item["symbol"], "name": quote.get("name", item.get("name", "")), "timestamp": quote.get("timestamp", now())} for rule in rules)
    source = "Vibe-Trading 本机适配器" if VIBE_TRADING_LOCAL_ROOT else VIBE_TRADING_API_URL
    return {"stocks": stocks, "alerts": alerts, "history": history, "settings": settings, "data_source": source, "demo_enabled": ENABLE_DEMO_DATA}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_: Any) -> None:
        return

    def authorized(self) -> bool:
        if not ACCESS_TOKEN:
            return True
        supplied = self.headers.get("X-Access-Token", "")
        if not supplied:
            supplied = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query).get("token", [""])[0]
        return hmac.compare_digest(supplied, ACCESS_TOKEN)

    def do_GET(self) -> None:  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/state":
            if not self.authorized():
                json_response(self, {"error": "unauthorized"}, 401)
                return
            json_response(self, snapshot())
            return
        if parsed.path == "/api/health":
            source = "Vibe-Trading 本机适配器" if VIBE_TRADING_LOCAL_ROOT else VIBE_TRADING_API_URL
            json_response(self, {"ok": True, "demo_enabled": ENABLE_DEMO_DATA, "data_source": source})
            return
        name = "index.html" if parsed.path in ("", "/") else parsed.path.lstrip("/")
        target = (WEB_ROOT / name).resolve()
        if WEB_ROOT.resolve() not in target.parents or not target.is_file():
            json_response(self, {"error": "not found"}, 404)
            return
        content_type = {".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".webmanifest": "application/manifest+json"}.get(target.suffix, "application/octet-stream")
        body = target.read_bytes()
        self.send_response(200); self.send_header("Content-Type", content_type); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)

    def do_POST(self) -> None:  # noqa: N802
        if not self.authorized():
            json_response(self, {"error": "unauthorized"}, 401)
            return
        length = int(self.headers.get("Content-Length", 0))
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            json_response(self, {"error": "invalid json"}, 400); return
        with STATE_LOCK:
            if self.path == "/api/watchlist":
                symbol = str(payload.get("symbol", "")).strip().upper()
                name = str(payload.get("name", "")).strip()
                key = symbol or f"NAME:{name}"
                if not symbol and not name:
                    json_response(self, {"error": "请输入股票代码或名称"}, 400); return
                if not any(item["symbol"] == key for item in STATE["watchlist"]):
                    STATE["watchlist"].append({"symbol": key, "name": name or key}); save_state()
                json_response(self, {"ok": True}); return
            if self.path == "/api/settings":
                STATE["settings"] = {**DEFAULT_SETTINGS, **payload}; save_state(); json_response(self, {"ok": True}); return
        json_response(self, {"error": "not found"}, 404)

    def do_DELETE(self) -> None:  # noqa: N802
        if not self.authorized():
            json_response(self, {"error": "unauthorized"}, 401)
            return
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path != "/api/watchlist":
            json_response(self, {"error": "not found"}, 404); return
        symbol = urllib.parse.parse_qs(parsed.query).get("symbol", [""])[0]
        with STATE_LOCK:
            STATE["watchlist"] = [item for item in STATE["watchlist"] if item["symbol"] != symbol]; save_state()
        json_response(self, {"ok": True})


if __name__ == "__main__":
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"离场纪律预警网页：http://{HOST}:{PORT}")
    print(f"Vibe-Trading 数据服务：{VIBE_TRADING_API_URL}")
    if ENABLE_DEMO_DATA:
        print("演示数据已启用，仅用于界面检查")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.server_close()
