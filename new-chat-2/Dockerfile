FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    EXIT_ALERT_HOST=0.0.0.0 \
    EXIT_ALERT_PORT=10000 \
    VIBE_TRADING_LOCAL_ROOT=/app/vendor/vibe-trading

WORKDIR /app

COPY requirements-cloud.txt ./
RUN pip install --no-cache-dir -r requirements-cloud.txt

COPY app.py README.md ./
COPY web ./web
COPY data ./data
ARG VIBE_TRADING_REPO=https://github.com/HKUDS/Vibe-Trading.git
RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && git clone --depth 1 "$VIBE_TRADING_REPO" /app/vendor/vibe-trading \
    && rm -rf /var/lib/apt/lists/*

EXPOSE 10000

CMD ["python", "app.py"]
