@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Worldara

where node >nul 2>nul
if %ERRORLEVEL% neq 0 goto error_no_node

where pnpm >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [提示] 未检测到全局 pnpm，尝试通过 npm 全局安装 pnpm...
    call npm install -g pnpm
    where pnpm >nul 2>nul
    if %ERRORLEVEL% neq 0 (
        echo [警告] 未能自动安装 pnpm，将尝试使用 npx pnpm（注意：子进程 turbo 可能需要全局 pnpm）。
        echo 建议手动运行: npm install -g pnpm
        set "PNPM_CMD=npx --yes pnpm"
    ) else (
        set "PNPM_CMD=pnpm"
    )
) else (
    set "PNPM_CMD=pnpm"
)

set "ARG=%~1"
if /i "%ARG%"=="test" goto do_test
if /i "%ARG%"=="build" goto do_build
if /i "%ARG%"=="db" goto do_db
if /i "%ARG%"=="api" goto do_api
if /i "%ARG%"=="web" goto do_web
goto do_dev

:do_test
echo [INFO] 正在执行自动化测试...
call %PNPM_CMD% test
pause
exit /b 0

:do_build
echo [INFO] 正在执行全量构建...
call %PNPM_CMD% build
pause
exit /b 0

:do_db
echo [INFO] 正在启动 PostgreSQL 容器 (54329)...
docker compose -f infra/compose/docker-compose.yml up -d
set "DATABASE_URL=postgres://worldcodex:worldcodex@localhost:54329/worldcodex"
call %PNPM_CMD% --filter @world-codex/database migrate
echo [INFO] 启动服务...
call %PNPM_CMD% dev
pause
exit /b 0

:do_api
echo [INFO] 启动后端 API...
call %PNPM_CMD% --filter @world-codex/api dev
pause
exit /b 0

:do_web
echo [INFO] 启动前端 Web...
call %PNPM_CMD% --filter @worldara/web dev
pause
exit /b 0

:do_dev
echo ================================================================
echo                    Worldara 世界格开发服务启动中...             
echo ================================================================
echo  [服务地址]
echo    - 前端界面: http://localhost:3000
echo    - 后端接口: http://127.0.0.1:4000
echo    - 健康检查: http://127.0.0.1:4000/health
echo    - 本地库文件: %cd%\data\world-codex.sqlite
echo ================================================================
echo  [提示] 正在启动前后端服务，启动完成后按 Ctrl+C 可停止运行。
echo  [提示] 未设置 DATABASE_URL 时默认使用 SQLite 本地文件，重启后世界会保留。
echo.

set "WORLD_CODEX_SQLITE_PATH=%cd%\data\world-codex.sqlite"

for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3000" ^| findstr "LISTENING"') do taskkill /f /pid %%a >nul 2>nul
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":4000" ^| findstr "LISTENING"') do taskkill /f /pid %%a >nul 2>nul

call %PNPM_CMD% dev

if %ERRORLEVEL% neq 0 (
    echo.
    echo [提示] 服务已停止或异常退出 (退出码: %ERRORLEVEL%)
)
pause
exit /b %ERRORLEVEL%

:error_no_node
echo [错误] 未检测到 Node.js 环境，请先安装 Node.js 20 及以上版本。
echo 官网下载: https://nodejs.org/
echo.
pause
exit /b 1
