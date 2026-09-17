# 一次性验收服务镜像：含 Node + Playwright Chromium + Python pytest，
# 在 compose 网络内对真实运行的 web/api 做联调验收。
#
# 基础镜像为多架构（amd64/arm64），已内置 Node 22 与 /ms-playwright 下的
# Chromium（与 package.json 中 @playwright/test 1.49.0 对应），默认 root。
FROM mcr.microsoft.com/playwright:v1.49.0-jammy

USER root

# curl 基础镜像已自带，python3 为 jammy 的 3.10；这里只需补 pip。
# 注意：jammy 的 python3-pip 是 pip 22.0.x，不支持 --break-system-packages
# （该选项 pip 23 才有），且 jammy 无 PEP 668 限制，直接安装即可。
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3-pip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python 侧（pytest + FastAPI TestClient）
COPY api/requirements.txt /app/api/requirements.txt
RUN python3 -m pip install --no-cache-dir -r /app/api/requirements.txt

# Node 侧（Vitest + Playwright；浏览器二进制已由基础镜像提供，无需再 install）
COPY web/package.json web/package-lock.json /app/web/
RUN cd /app/web && npm ci

COPY api /app/api
COPY web /app/web
COPY verify /app/verify

ENV BASE_URL=http://web
ENV API_URL=http://api:8000

CMD ["/app/verify/run.sh"]
