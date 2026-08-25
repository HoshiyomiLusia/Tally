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
# 审计 #111/#117/#124: 装 tzdata, 时区跟随宿主挂载的 /etc/localtime(见 compose)。
# 不再设 ENV TZ —— glibc/Python 里 TZ 环境变量优先于 /etc/localtime, 设了默认值会把挂载压成摆设,
# 部署地与默认值不一致时(如宿主 JST)每天错一小时窗口。
RUN apt-get update && apt-get install -y --no-install-recommends tzdata && rm -rf /var/lib/apt/lists/*
WORKDIR /app

COPY backend/requirements.txt ./requirements.txt
RUN pip install -r requirements.txt

COPY backend/ ./
COPY --from=frontend /app/dist ./static

EXPOSE 8002
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8002"]
