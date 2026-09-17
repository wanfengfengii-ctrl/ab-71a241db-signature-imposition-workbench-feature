#!/usr/bin/env bash
# 一次性验收：pytest（编排规则/API 契约）+ Vitest（前端镜像同一规则）
# + Playwright（对 compose 中真实运行的 web+api 做端到端联调）。
set -euo pipefail

API_URL="${API_URL:-http://api:8000}"
BASE_URL="${BASE_URL:-http://web}"

echo "==> 等待 API 就绪（${API_URL}/health）"
for _ in $(seq 1 60); do
  if curl -fsS "${API_URL}/health" >/dev/null 2>&1; then break; fi
  sleep 2
done
curl -fsS "${API_URL}/health"
echo

echo "==> 等待 Web 就绪（${BASE_URL}/）"
for _ in $(seq 1 60); do
  if curl -fsS "${BASE_URL}/" >/dev/null 2>&1; then break; fi
  sleep 2
done
echo "web is up"

echo "==> [1/3] pytest：编排算法与 API 字段错误"
cd /app/api
python3 -m pytest -q

echo "==> [2/3] Vitest：前端镜像实现的同一编排规则"
cd /app/web
npx vitest run

echo "==> [3/3] Playwright：经 nginx 访问真实 API 的端到端联调"
npx playwright test

echo
echo "✅ verify 通过：pytest / Vitest / Playwright 全部成功"
