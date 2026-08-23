FROM node:22-alpine AS frontend
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install
COPY frontend/ ./
# 子路径部署: 传入 VITE_BASE (如 /tally/) 让 Vite 生成对应 base; 默认 / 不影响根部署
ARG VITE_BASE=/
ENV VITE_BASE=$VITE_BASE
RUN npm run build


FROM python:3.12-slim AS backend
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
# 审计 #111/#117: 装 tzdata 并默认时区 Asia/Shanghai, 否则 date.today() 走 UTC,
# 在 UTC+8 的 0~8 点期间"今天"落后一天 -> 日均支出分母、周期账单窗口、首页默认月份全部差一天。
# 实际时区由 compose 的 TZ 覆盖(默认跟随部署地)。
ENV TZ=Asia/Shanghai
RUN apt-get update && apt-get install -y --no-install-recommends tzdata && rm -rf /var/lib/apt/lists/*
WORKDIR /app

COPY backend/requirements.txt ./requirements.txt
RUN pip install -r requirements.txt

COPY backend/ ./
COPY --from=frontend /app/dist ./static

EXPOSE 8002
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8002"]
