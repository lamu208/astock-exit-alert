const state = { data: null, selected: null, seen: new Set() };
const localWatchlistKey = 'a-share-exit-watchlist';
const localWatchlist = () => { try { const value = JSON.parse(localStorage.getItem(localWatchlistKey) || '[]'); return Array.isArray(value) ? value : []; } catch { return []; } };
const saveWatchlist = (items) => localStorage.setItem(localWatchlistKey, JSON.stringify(items));
const stockKey = (stock) => stock.watch_key || (String(stock.symbol || '').startsWith('NAME:') ? stock.symbol : (stock.name ? `NAME:${stock.name}` : stock.symbol));
const watchlistQuery = () => encodeURIComponent(JSON.stringify(localWatchlist()));
const accessToken = new URLSearchParams(location.search).get('token') || localStorage.getItem('exit-alert-token') || '';
if (accessToken) localStorage.setItem('exit-alert-token', accessToken);
function apiFetch(input, options = {}) { const headers = new Headers(options.headers || {}); if (accessToken) headers.set('X-Access-Token', accessToken); return fetch(input, { ...options, headers }); }
const $ = (selector) => document.querySelector(selector);
const levelOrder = { none: 0, blue: 1, orange: 2, red: 3 };
const levelText = { none: '持有', blue: '注意', orange: '减仓', red: '离场' };
const actionText = { add: '加仓', hold: '持有', warning: '警示信号', reduce_30_50: '减仓30%-50%', hold_no_sell: '不卖', stop_loss: '止损', d_add: 'D档加仓', reduce_50_60: '减仓50%-60%', exit_60_70: '出60%-70%', clear: '立即清仓', reduce: '减仓' };

function number(value, fallback = 0) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function formatNumber(value) { const valueNumber = number(value, NaN); if (!Number.isFinite(valueNumber)) return '—'; if (Math.abs(valueNumber) >= 100000000) return `${(valueNumber / 100000000).toFixed(2)}亿`; if (Math.abs(valueNumber) >= 10000) return `${(valueNumber / 10000).toFixed(1)}万`; return valueNumber.toLocaleString('zh-CN'); }
function formatMetric(value, digits = 2) { const parsed = Number(value); return Number.isFinite(parsed) && parsed > 0 ? parsed.toFixed(digits) : '暂无数据'; }
function stockCode(stock) { const candidate = stock.quote?.symbol || stock.symbol || ''; const match = String(candidate).match(/\d{6}/); return match ? match[0] : String(stock.symbol).replace('NAME:', ''); }
function highestLevel(rules = []) { return rules.reduce((best, rule) => levelOrder[rule.level] > levelOrder[best] ? rule.level : best, 'none'); }
function actionFor(stock) { const level = highestLevel(stock.rules); return stock.action || (level === 'red' ? 'clear' : level === 'orange' ? 'reduce_30_50' : (stock.rules || []).some((rule) => rule.title === '上涨放量') ? 'add' : 'hold'); }
function actionMessage(action) { if (action === 'clear') return '执行立即清仓纪律'; if (action === 'exit_60_70') return '执行出 60%～70% 纪律'; if (action === 'reduce_50_60') return '执行减仓 50%～60% 纪律'; if (['reduce_30_50', 'stop_loss'].includes(action)) return '执行减仓 30%～50% / 止损纪律'; if (action === 'warning') return '警示信号，按优先级观察'; if (action === 'hold_no_sell') return '不卖，继续观察'; if (['add', 'd_add'].includes(action)) return '符合计划加仓条件'; return '当前按纪律持有观察'; }
function changeOf(quote) { return quote.prev_close ? (number(quote.price) - number(quote.prev_close)) / number(quote.prev_close) : number(quote.change_pct) / 100; }
function trendClass(change) { return change > .0001 ? 'rise' : change < -.0001 ? 'fall' : 'flat'; }
function formatChange(change) { const sign = change > 0 ? '+' : ''; return `${sign}${(change * 100).toFixed(2)}%`; }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[character])); }

function sparkline(values, change) {
  const points = values.map(Number).filter(Number.isFinite); if (points.length < 2) return '<svg class="sparkline" viewBox="0 0 120 54" preserveAspectRatio="none"><line class="spark-baseline" x1="0" x2="120" y1="28" y2="28"></line></svg>';
  const min = Math.min(...points), max = Math.max(...points), span = Math.max(max - min, .0001);
  const coordinates = points.map((point, index) => `${(index / (points.length - 1)) * 120},${49 - ((point - min) / span) * 42}`).join(' ');
  const color = change >= 0 ? '#f5222d' : '#10a533';
  return `<svg class="sparkline" viewBox="0 0 120 54" preserveAspectRatio="none" aria-hidden="true"><line class="spark-baseline" x1="0" x2="120" y1="45" y2="45"></line><polyline points="${coordinates}" fill="none" stroke="${color}" stroke-width="1.7" vector-effect="non-scaling-stroke" stroke-linecap="round" stroke-linejoin="round"></polyline></svg>`;
}

function renderStatus() {
  const status = $('#data-status'); const stocks = state.data?.stocks || [];
  const live = stocks.filter((stock) => stock.quote.data_status === 'live').length;
  const demo = stocks.filter((stock) => stock.quote.data_status === 'demo').length;
  if (live) { status.className = 'connection-state ok'; status.innerHTML = `<i></i><span>${live} 只实时</span>`; }
  else if (demo) { status.className = 'connection-state demo'; status.innerHTML = '<i></i><span>演示数据</span>'; }
  else { status.className = 'connection-state error'; status.innerHTML = '<i></i><span>行情未连接</span>'; }
}

function renderWatchlist() {
  const stocks = state.data?.stocks || []; $('#stock-count').textContent = stocks.length; const host = $('#watchlist');
  if (!stocks.length) { host.className = 'stock-list empty-state'; host.innerHTML = '<strong>还没有自选股</strong><span>在下方输入股票代码或名称添加</span>'; return; }
  host.className = 'stock-list';
  host.innerHTML = stocks.map((stock) => {
    const quote = stock.quote; const unavailable = quote.data_status === 'unavailable'; const change = unavailable ? 0 : changeOf(quote); const action = unavailable ? 'hold' : actionFor(stock); const tone = trendClass(change);
    const displayDecision = unavailable ? '待连接' : actionText[action];
    return `<button class="stock-row" type="button" data-symbol="${escapeHtml(stockKey(stock))}"><div class="stock-title"><div class="stock-heading"><strong class="stock-name">${escapeHtml(stock.name || quote.name || stock.symbol)}</strong><span class="stock-price ${tone}">${unavailable ? '—' : number(quote.price).toFixed(2)}</span></div><span class="stock-meta"><b class="stock-code-badge">${escapeHtml(stockCode(stock))}</b><i class="live-mark">${unavailable ? '⚠' : '▣'}</i></span></div><div class="stock-middle"><div class="spark-wrap">${sparkline(quote.recent_closes || [], change)}</div><div class="stock-quote"><span class="stock-percent ${tone}">${unavailable ? '行情不可用' : formatChange(change)}</span></div></div><div class="stock-decision"><b class="decision-tag ${unavailable ? 'none' : action}">${displayDecision}</b></div></button>`;
  }).join('');
  host.querySelectorAll('.stock-row').forEach((row) => row.addEventListener('click', () => openDetail(row.dataset.symbol)));
}

function renderDetail(stock) {
  const quote = stock.quote; const unavailable = quote.data_status === 'unavailable'; const action = unavailable ? 'hold' : actionFor(stock); const change = unavailable ? 0 : changeOf(quote); const decision = unavailable ? '行情暂不可用' : `${actionText[action]} · ${actionMessage(action)}`;
  $('#detail-code').textContent = stockCode(stock); $('#detail-name').textContent = stock.name || quote.name || stock.symbol;
  const decisionCard = $('#detail-decision'); decisionCard.className = `decision-card ${unavailable ? 'none' : action}`; decisionCard.textContent = decision;
  $('#detail-price').textContent = unavailable ? '—' : number(quote.price).toFixed(2); const changeNode = $('#detail-change'); changeNode.textContent = unavailable ? '—' : formatChange(change); changeNode.className = trendClass(change); const actionNode = $('#detail-action'); actionNode.textContent = unavailable ? '待连接' : actionText[action]; actionNode.className = action; $('#detail-source').textContent = unavailable ? `行情未连接：${quote.error || '数据源暂不可用'}` : `数据来源：${quote.source || state.data.data_source || 'Vibe-Trading'} · 历史 K 线 ${quote.history_bars || 0} 根（${quote.history_status === 'complete' ? '完整' : quote.history_status === 'partial' ? '部分' : '不足'}）`;
  $('#detail-metrics').innerHTML = unavailable ? `<div class="metric-item"><span>连接提示</span><strong class="danger">${escapeHtml(quote.error || '数据源暂不可用')}</strong></div>` : `<div class="metric-item"><span>MA5（趋势线）</span><strong class="${number(quote.price) < number(quote.ma5 || quote.trend_line) ? 'danger' : ''}">${formatMetric(quote.ma5 || quote.trend_line)}</strong></div><div class="metric-item"><span>MA10</span><strong>${formatMetric(quote.ma10)}</strong></div><div class="metric-item"><span>MA20</span><strong>${formatMetric(quote.ma20)}</strong></div><div class="metric-item"><span>MA60</span><strong>${formatMetric(quote.ma60)}</strong></div><div class="metric-item"><span>量比（vs 5日均量）</span><strong class="${number(quote.volume_ratio) >= 1.3 ? 'warning' : ''}">${quote.avg_volume_5 ? `${number(quote.volume_ratio || quote.volume / quote.avg_volume_5).toFixed(2)}×` : '暂无数据'}</strong></div><div class="metric-item"><span>成交额</span><strong>${formatNumber(quote.amount)}</strong></div><div class="metric-item"><span>今开 / 昨收</span><strong>${formatMetric(quote.open)} / ${formatMetric(quote.prev_close)}</strong></div><div class="metric-item"><span>最高 / 最低</span><strong>${formatMetric(quote.high)} / ${formatMetric(quote.low)}</strong></div>`;
  const rules = stock.rules || []; $('#detail-reasons').innerHTML = rules.length ? rules.sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0)).map((rule) => `<div class="reason-row ${rule.level}"><i class="reason-dot"></i><div><strong>${escapeHtml(actionText[rule.action] || levelText[rule.level])} · ${escapeHtml(rule.title)}</strong><span>${escapeHtml(rule.reason)}</span></div></div>`).join('') : '<div class="reason-row"><i class="reason-dot"></i><div><strong>持有</strong><span>暂未触发图片中的加仓、警示、减仓或清仓条件，继续观察。</span></div></div>';
}

function openDetail(symbol) { const stock = (state.data?.stocks || []).find((item) => stockKey(item) === symbol); if (!stock) return; state.selected = symbol; renderDetail(stock); const sheet = $('#detail-sheet'); sheet.classList.add('open'); sheet.setAttribute('aria-hidden', 'false'); }
function closeDetail() { const sheet = $('#detail-sheet'); sheet.classList.remove('open'); sheet.setAttribute('aria-hidden', 'true'); }

function announce(alert) { const key = `${alert.symbol}-${alert.level}-${alert.title}`; if (state.seen.has(key)) return; state.seen.add(key); const banner = $('#alert-banner'); banner.className = `alert-banner ${alert.level}`; banner.innerHTML = `${escapeHtml(alert.name || stockCode({ symbol: alert.symbol }))} · ${escapeHtml(actionText[alert.action] || levelText[alert.level])}<span>${escapeHtml(alert.title)}：${escapeHtml(alert.reason)}</span>`; const toast = $('#toast'); toast.textContent = `${actionText[alert.action] || levelText[alert.level]}：${alert.name || alert.symbol} ${alert.title}`; toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 4200); }
function render() { renderStatus(); renderWatchlist(); }
async function refresh() { try { const response = await apiFetch(`/api/state?watchlist=${watchlistQuery()}`); state.data = await response.json(); render(); $('#last-refresh').textContent = `更新于 ${new Date().toLocaleTimeString('zh-CN', { hour:'2-digit', minute:'2-digit' })} · ${state.data.data_source || '云端数据服务'}`; [...(state.data.alerts || [])].sort((a, b) => levelOrder[b.level] - levelOrder[a.level]).forEach(announce); } catch { $('#toast').textContent = '刷新失败，请检查网络或云端服务'; $('#toast').classList.add('show'); setTimeout(() => $('#toast').classList.remove('show'), 3000); } }
async function removeSelected() { if (!state.selected) return; saveWatchlist(localWatchlist().filter((item) => item.symbol !== state.selected)); closeDetail(); state.selected = null; await refresh(); }
$('#add-form').addEventListener('submit', async (event) => { event.preventDefault(); const value = $('#stock-input').value.trim(); if (!value) return; const isCode = /^\d{6}$/.test(value); const item = isCode ? { symbol:value, name:'' } : { symbol:`NAME:${value}`, name:value }; const items = localWatchlist(); if (!items.some((saved) => saved.symbol === item.symbol)) { items.push(item); saveWatchlist(items); } $('#stock-input').value = ''; await refresh(); });
function setView(view) {
  const isWatch = view === 'watch';
  $('#watch-view').hidden = !isWatch;
  $('#discipline-view').hidden = isWatch;
  $('#bottom-watch').classList.toggle('active', isWatch);
  $('#bottom-discipline').classList.toggle('active', !isWatch);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
$('#bottom-watch').addEventListener('click', () => setView('watch'));
$('#bottom-discipline').addEventListener('click', () => setView('discipline'));
$('#refresh-button').addEventListener('click', refresh); $('#close-detail').addEventListener('click', closeDetail); $('#detail-sheet').addEventListener('click', (event) => { if (event.target === $('#detail-sheet')) closeDetail(); }); $('#remove-detail-stock').addEventListener('click', removeSelected); document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeDetail(); }); refresh(); setInterval(refresh, 60000);
