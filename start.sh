#!/usr/bin/env bash
set -e

cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
    echo "[错误] 未检测到 Node.js 环境，请先安装 Node.js (v20+)。"
    exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
    echo "[提示] 未检测到全局 pnpm，尝试通过 npm 自动安装 pnpm..."
    npm install -g pnpm 2>/dev/null || true
    if command -v pnpm >/dev/null 2>&1; then
        PNPM_CMD="pnpm"
    else
        echo "[警告] 未能自动安装全局 pnpm，将尝试使用 npx pnpm（注意：子进程 turbo 可能需要全局 pnpm）。建议手动执行: npm install -g pnpm"
        PNPM_CMD="npx --yes pnpm"
    fi
else
    PNPM_CMD="pnpm"
fi

MODE="${1:-dev}"

case "$MODE" in
    dev)
        echo "================================================================"
        echo "                    Worldara 世界格开发服务启动中...             "
        echo "================================================================"
        echo " [服务地址]"
        echo "   - 前端界面: http://localhost:3000"
        echo "   - 后端接口: http://127.0.0.1:4000"
        echo "   - 健康检查: http://127.0.0.1:4000/health"
        echo "   - 本地库文件: $(pwd)/data/world-codex.sqlite"
        echo "================================================================"
        echo " [提示] 正在启动服务... 按 Ctrl+C 可停止运行。"
        echo " [提示] 未设置 DATABASE_URL 时默认使用 SQLite 本地文件，重启后世界会保留。"
        echo ""
        export WORLD_CODEX_SQLITE_PATH="$(pwd)/data/world-codex.sqlite"
        $PNPM_CMD dev
        ;;
    db)
        echo "[INFO] 正在启动 PostgreSQL 容器 (54329)..."
        docker compose -f infra/compose/docker-compose.yml up -d
        export DATABASE_URL="postgres://worldcodex:worldcodex@localhost:54329/worldcodex"
        $PNPM_CMD --filter @world-codex/database migrate
        $PNPM_CMD dev
        ;;
    api)
        export WORLD_CODEX_SQLITE_PATH="${WORLD_CODEX_SQLITE_PATH:-$(pwd)/data/world-codex.sqlite}"
        $PNPM_CMD --filter @world-codex/api dev
        ;;
    web)
        $PNPM_CMD --filter @worldara/web dev
        ;;
    test)
        $PNPM_CMD test
        ;;
    build)
        $PNPM_CMD build
        ;;
    *)
        echo "[ERROR] 未知模式: $MODE (可选: dev, db, api, web, test, build)"
        exit 1
        ;;
esac
