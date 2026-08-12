# A 股离场纪律预警

独立的本机网页应用，只复用 Vibe-Trading 的 A 股行情能力，不使用其原有界面。

## 运行

需要 Python 3.10+。默认连接本机 Vibe-Trading 服务 `http://127.0.0.1:8899`：

```powershell
python app.py
```

打开 <http://127.0.0.1:8771>。

手机访问：电脑和手机连接同一个 Wi‑Fi，运行 `start-alert-app.ps1` 后，使用脚本输出的局域网地址（例如 `http://192.168.1.20:8765/`）在手机浏览器打开。浏览器菜单中选择“添加到主屏幕”，即可像轻量 App 一样使用。Windows 防火墙若首次拦截，请允许 Python 在专用网络通信。

`start-alert-app.ps1` 默认会直接复用本机已有的 Vibe-Trading 副本：`C:\Users\lamu\Documents\Codex\2026-08-09\https-github-com-hkuds-vibe-trading`，优先使用其 `.venv` 和 `MonitoringAdapter`，不需要重新联网安装。若该目录不存在，再回退到 HTTP/命令适配方式。

安装真实行情运行时：

```powershell
& "C:\Users\lamu\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" -m pip install -r requirements.txt
```

如果系统没有 `python` 命令，可使用 Codex 桌面随附运行时：

```powershell
& "C:\Users\lamu\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" app.py
```

也可以双击/运行 `start-alert-app.ps1` 自动启动网页并打开浏览器：

```powershell
.\start-alert-app.ps1
```

如果 Windows 提示“禁止运行脚本”，使用：

```powershell
powershell -ExecutionPolicy Bypass -File .\start-alert-app.ps1
```

如果你的 Vibe-Trading 服务已经启动但接口路径不同，可配置：

```powershell
$env:VIBE_TRADING_API_URL = "http://127.0.0.1:8899"
$env:VIBE_TRADING_QUOTE_PATH = "/api/market-data"
python app.py
```

如果你希望直接调用自己的 Vibe-Trading 桥接命令，可让命令输出一条 JSON 行，并配置 `{symbol}`、`{name}` 占位符：

```powershell
$env:VIBE_TRADING_DATA_COMMAND = 'vibe-trading get_market_data --symbol {symbol} --json'
python app.py
```

HTTP 和命令二选一；HTTP 优先使用命令通道。命令必须输出单个行情对象或 `{ "quote": { ... } }`。

适配层请求 `GET {VIBE_TRADING_API_URL}{VIBE_TRADING_QUOTE_PATH}?symbol=600519&name=`，期望返回行情对象，或 `{ "quote": { ... } }`。至少提供 `price`、`prev_close`、`volume`、`avg_volume_5`、`trend_line`、`candle` 和 `timestamp`；`candle` 至少包含 `open`、`high`、`low`、`close`。名称输入会以 `symbol=NAME:<名称>&name=<名称>` 发送，由 Vibe-Trading 服务负责解析为股票代码。

仅检查界面、弹窗和声音时，可显式开启演示数据；演示数据不会默认启用：

```powershell
$env:ENABLE_DEMO_DATA = "1"
python app.py
```

演示模式中的行情不是实时行情，不应作为交易依据。
