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
WORKDIR /app

COPY backend/requirements.txt ./requirements.txt
RUN pip install -r requirements.txt

COPY backend/ ./
COPY --from=frontend /app/dist ./static

EXPOSE 8002
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8002"]
