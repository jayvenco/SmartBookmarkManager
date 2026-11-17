FROM python:3.12-slim

LABEL app=smartbm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 SBM_DATA_DIR=/app/data
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

RUN useradd --system --uid 10001 app && mkdir -p /app/data && chown app /app/data
USER app

VOLUME /app/data
EXPOSE 7774

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:7774/healthz', timeout=3).status == 200 else 1)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "7774", "--proxy-headers", "--forwarded-allow-ips", "*"]
