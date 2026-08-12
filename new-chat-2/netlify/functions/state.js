const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "access-control-allow-origin": "*",
};

const DEFAULT_SETTINGS = { volume_ratio: 0.3 };
const LEVEL_ORDER = { none: 0, blue: 1, orange: 2, red: 3 };

function json(statusCode, body) {
  return { statusCode, headers: jsonHeaders, body: JSON.stringify(body) };
}

function digits(value) {
  const match = String(value || "").match(/\d{6}/);
  return match ? match[0] : "";
}

function exchangeSymbol(value) {
  const code = digits(value);
  if (!code) return "";
  if (code.startsWith("6")) return `${code}.SH`;
  if (code.startsWith("4") || code.startsWith("8") || code.startsWith("9")) return `${code}.BJ`;
  return `${code}.SZ`;
}

function vendorKey(symbol) {
  const code = digits(symbol);
  if (code.startsWith("6")) return `sh${code}`;
  if (code.startsWith("4") || code.startsWith("8") || code.startsWith("9")) return `bj${code}`;
  return `sz${code}`;
}

async function readText(url) {
  const response = await fetch(url, { headers: { "user-agent": "A-share-exit-alert/1.0" } });
  if (!response.ok) throw new Error(`行情接口 HTTP ${response.status}`);
  return response.text();
}

function parseQuote(raw) {
  const result = {};
  for (const line of raw.split(/\r?\n/)) {
    const separator = line.indexOf("=");
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const values = line.slice(separator + 1).trim().replace(/^"|";?$/g, "").split("~");
    if (values.length < 39) continue;
    const code = digits(values[2]);
    const price = Number(values[3]);
    if (!code || !Number.isFinite(price) || price <= 0) continue;
    result[code] = {
      symbol: exchangeSymbol(code),
      name: values[1] || code,
      price,
      prev_close: Number(values[4]) || price,
      volume: Number(values[36]) || 0,
      amount: Number(values[37]) || 0,
      open: Number(values[5]) || price,
      high: Number(values[33]) || price,
      low: Number(values[34]) || price,
      change_pct: Number(values[32]) || 0,
      source: "腾讯公开行情",
      timestamp: new Date().toISOString(),
      vendor_key: key,
    };
  }
  return result;
}

async function fetchQuotes(symbols) {
  const keys = [...new Set(symbols.map(vendorKey).filter(Boolean))];
  if (!keys.length) return {};
  const raw = await readText(`https://qt.gtimg.cn/q=${keys.join(",")}`);
  return parseQuote(raw);
}

function parseSearchHints(raw) {
  const encoded = raw.split("=").slice(1).join("=").trim().replace(/;$/, "");
  let payload;
  try { payload = JSON.parse(encoded); } catch { return []; }
  if (typeof payload !== "string") return [];
  return payload.split("^").map((item) => item.split("~")).filter((fields) => fields.length >= 3 && ["sh", "sz", "bj"].includes(fields[0].toLowerCase())).map((fields) => ({ symbol: exchangeSymbol(fields[1]), name: fields[2] || fields[1] })).filter((item) => item.symbol);
}

async function resolveItem(item) {
  const code = digits(item.symbol);
  if (code) return { ...item, symbol: exchangeSymbol(code) };
  const name = String(item.name || item.symbol || "").replace(/^NAME:/, "").trim();
  if (!name) return item;
  try {
    const raw = await readText(`https://smartbox.gtimg.cn/s3/?q=${encodeURIComponent(name)}&t=all`);
    return { ...item, ...(parseSearchHints(raw)[0] || {}), name };
  } catch {
    return { ...item, symbol: `NAME:${name}`, name };
  }
}

async function fetchHistory(symbol) {
  const key = vendorKey(symbol);
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?_var=kline_dayqfq&param=${key},day,,,30,qfqa`;
  try {
    const response = await fetch(url, { headers: { "user-agent": "A-share-exit-alert/1.0" } });
    if (!response.ok) return [];
    const payload = await response.json();
    const entry = payload?.data?.[key] || {};
    const rows = entry.qfqday || entry.day || entry.qfqweek || [];
    return rows.map((row) => ({ open: Number(row[1]), close: Number(row[2]), high: Number(row[3]), low: Number(row[4]), volume: Number(row[5]) })).filter((row) => Number.isFinite(row.close));
  } catch {
    return [];
  }
}

function evaluate(quote, settings) {
  const open = Number(quote.open) || 0;
  const high = Number(quote.high) || 0;
  const low = Number(quote.low) || 0;
  const close = Number(quote.price) || 0;
  const volume = Number(quote.volume) || 0;
  const average = Number(quote.avg_volume_5) || 0;
  const trend = Number(quote.trend_line) || 0;
  if (![open, high, low, close].every(Boolean)) return [];
  const body = Math.abs(close - open);
  const range = Math.max(0.0001, high - low);
  const upper = Math.max(0, high - Math.max(open, close));
  const lower = Math.max(0, Math.min(open, close) - low);
  const volumeHit = average > 0 && volume >= average * Number(settings.volume_ratio || 0.3);
  const trendHit = trend > 0 && close < trend;
  const shadowHit = upper >= Math.max(body * 2, range * 0.35) || lower >= Math.max(body * 2, range * 0.35);
  const rules = [];
  if (volumeHit) rules.push({ level: "blue", title: "成交量异常", reason: `当前成交量达到前五日均量的 ${(volume / average * 100).toFixed(0)}%` });
  if (trendHit) rules.push({ level: "blue", title: "趋势线承压", reason: `最新价 ${close.toFixed(2)} 低于 5日趋势线 ${trend.toFixed(2)}` });
  if (shadowHit) rules.push({ level: "blue", title: "K线形态异常", reason: "出现异常长影线，需要检查仓位" });
  if (volumeHit && trendHit) rules.push({ level: "orange", title: "减仓条件", reason: "成交量与趋势线条件同时满足" });
  if (volumeHit && trendHit && shadowHit) rules.push({ level: "red", title: "离场条件", reason: "放量跌破趋势线并叠加异常影线" });
  return rules;
}

async function buildStock(item, quotes) {
  const watchKey = item.symbol;
  const resolved = await resolveItem(item);
  const code = digits(resolved.symbol);
  const quote = quotes[code];
  if (!quote) return { ...resolved, watch_key: watchKey, quote: { symbol: resolved.symbol, name: resolved.name || resolved.symbol, data_status: "unavailable", error: "暂时没有获取到行情", timestamp: new Date().toISOString() }, rules: [] };
  const history = await fetchHistory(resolved.symbol);
  const previous = history.length > 5 ? history.slice(-6, -1) : history.slice(0, -1);
  quote.avg_volume_5 = previous.length ? previous.reduce((sum, row) => sum + row.volume, 0) / previous.length : 0;
  quote.trend_line = history.length ? history.slice(-5).reduce((sum, row) => sum + row.close, 0) / Math.min(5, history.length) : quote.price;
  quote.trend_line_source = "5日均线（云端行情）";
  quote.recent_closes = history.slice(-30).map((row) => row.close);
  quote.candle = { open: quote.open, high: quote.high, low: quote.low, close: quote.price, volume: quote.volume };
  quote.data_status = "live";
  return { ...resolved, watch_key: watchKey, symbol: resolved.symbol, name: resolved.name || quote.name, quote, rules: evaluate(quote, DEFAULT_SETTINGS) };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: { ...jsonHeaders, "access-control-allow-methods": "GET,OPTIONS" }, body: "" };
  const raw = event.queryStringParameters?.watchlist || "[]";
  let watchlist;
  try { watchlist = JSON.parse(raw); } catch { return json(400, { error: "watchlist 参数无效" }); }
  if (!Array.isArray(watchlist)) return json(400, { error: "watchlist 参数无效" });
  const resolved = await Promise.all(watchlist.slice(0, 30).map(resolveItem));
  const quotes = await fetchQuotes(resolved.map((item) => item.symbol));
  const stocks = await Promise.all(resolved.map((item) => buildStock(item, quotes)));
  const alerts = stocks.flatMap((stock) => stock.rules.map((rule) => ({ ...rule, symbol: stock.symbol, name: stock.name, timestamp: stock.quote.timestamp })));
  return json(200, { stocks, alerts, history: [], settings: DEFAULT_SETTINGS, data_source: "云端公开行情", demo_enabled: false });
};
