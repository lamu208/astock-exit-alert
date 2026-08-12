# 手机公网访问

这个版本不要求手机和电脑在同一个网络。部署完成后，手机直接打开云平台生成的 `https://...` 地址即可。

## 推荐：Render

1. 将整个项目上传到自己的 GitHub 仓库。
2. 在 Render 创建 `New -> Web Service`，选择这个仓库。
3. Runtime 选择 `Docker`，Render 会自动读取项目根目录的 `Dockerfile`。
4. Health Check Path 填 `/api/health`。
5. 添加环境变量 `EXIT_ALERT_ACCESS_TOKEN`，设置一串自己保存的访问口令。
6. 部署完成后，使用 `https://你的服务名.onrender.com/?token=你的访问口令` 打开。

## Netlify

如果使用 Netlify，导入 GitHub 仓库后使用项目根目录的 `netlify.toml`：发布目录是 `web`，云函数目录是 `netlify/functions`。部署完成后，Netlify 会提供一个类似 `https://你的站点.netlify.app` 的网址，手机直接打开即可。

首次打开带 `token` 的地址后，网页会保存口令，后续可以直接打开服务地址。

## 注意事项

- `Vibe-Trading` 会在 Docker 构建时从 GitHub 拉取，云端不再依赖你的 Windows 本机路径。
- 行情来自公开行情源，云平台休眠、行情源限流或网络异常时，页面会显示“行情暂不可用”，不会伪造离场信号。
- Render 免费实例可能休眠，首次访问需要等待几十秒；盘中实时预警不建议依赖免费休眠实例。
- 免费实例本地文件不是永久存储，服务重启后自选股可能恢复为仓库里的初始状态。需要长期保存自选股时，应接入 Supabase/Postgres 或使用带持久磁盘的服务器。
- 这是预警工具，不自动下单，也不构成投资建议。

## 自建服务器

在有公网 IP 的 Linux 服务器上执行：

```bash
docker build -t astock-exit-alert .
docker run -d --restart unless-stopped \
  -p 80:10000 \
  -e EXIT_ALERT_ACCESS_TOKEN='请替换为你的口令' \
  -v astock-alert-data:/app/data \
  astock-exit-alert
```

然后建议用域名和 HTTPS 反向代理访问。
