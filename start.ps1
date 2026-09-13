<#
.SYNOPSIS
    Worldara 世界格快速启动脚本 (PowerShell)
.DESCRIPTION
    双击或直接运行默认直接启动极速开发服务；支持 -Mode 参数指定其他模式。
#>
[CmdletBinding()]
param (
    [ValidateSet("dev", "db", "api", "web", "test", "build")]
    [string]$Mode = "dev"
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
$Host.UI.RawUI.WindowTitle = "Worldara 世界格"

# 检查 Node.js
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error "未检测到 Node.js 环境，请先安装 Node.js (v20+)。官网: https://nodejs.org/"
    pause
    exit 1
}

# 检查 pnpm 或提示安装
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Write-Host "[提示] 未检测到全局 pnpm，尝试通过 npm 自动安装 pnpm..." -ForegroundColor Yellow
    try {
        npm install -g pnpm
    } catch {
        # ignore error and check command
    }
    if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
        Write-Warning "未能自动安装全局 pnpm，将尝试使用 npx pnpm（注意：子进程 turbo 可能需要全局 pnpm）。建议手动执行: npm install -g pnpm"
        $pnpmCmd = "npx"
        $pnpmArgs = @("--yes", "pnpm")
    } else {
        $pnpmCmd = "pnpm"
        $pnpmArgs = @()
    }
} else {
    $pnpmCmd = "pnpm"
    $pnpmArgs = @()
}

function Invoke-Pnpm {
    param([string[]]$ArgsList)
    & $pnpmCmd @pnpmArgs @ArgsList
}

switch ($Mode) {
    "dev" {
        Write-Host "================================================================" -ForegroundColor Cyan
        Write-Host "                    Worldara 世界格开发服务启动中...             " -ForegroundColor Cyan
        Write-Host "================================================================" -ForegroundColor Cyan
        Write-Host " [服务地址]" -ForegroundColor Yellow
        Write-Host "   - 前端界面: http://localhost:3000" -ForegroundColor Green
        Write-Host "   - 后端接口: http://127.0.0.1:4000" -ForegroundColor Green
        Write-Host "   - 健康检查: http://127.0.0.1:4000/health" -ForegroundColor Gray
        Write-Host "   - 本地库文件: $PSScriptRoot\data\world-codex.sqlite" -ForegroundColor Gray
        Write-Host "================================================================" -ForegroundColor Cyan
        Write-Host "[提示] 正在启动服务，4 秒后自动打开浏览器..."
        Write-Host "[提示] 未设置 DATABASE_URL 时默认使用 SQLite 本地文件，重启后世界会保留。"
        Write-Host "[提示] 按 Ctrl+C 可停止运行。`n"
        $env:WORLD_CODEX_SQLITE_PATH = Join-Path $PSScriptRoot "data\world-codex.sqlite"

        # 释放 3000 和 4000 端口
        Get-NetTCPConnection -LocalPort 3000, 4000 -ErrorAction SilentlyContinue | ForEach-Object {
            Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
        }

        # 延时 4 秒后台打开浏览器
        Start-Job -ScriptBlock { Start-Sleep -Seconds 4; Start-Process "http://localhost:3000" } | Out-Null

        Invoke-Pnpm @("dev")
    }
    "db" {
        Write-Host "[INFO] 正在启动 PostgreSQL 容器 (54329)..." -ForegroundColor Yellow
        docker compose -f infra/compose/docker-compose.yml up -d
        $env:DATABASE_URL = "postgres://worldcodex:worldcodex@localhost:54329/worldcodex"
        Invoke-Pnpm @("--filter", "@world-codex/database", "migrate")
        Invoke-Pnpm @("dev")
    }
    "api" {
        if (-not $env:WORLD_CODEX_SQLITE_PATH) {
            $env:WORLD_CODEX_SQLITE_PATH = Join-Path $PSScriptRoot "data\world-codex.sqlite"
        }
        Invoke-Pnpm @("--filter", "@world-codex/api", "dev")
    }
    "web" {
        Invoke-Pnpm @("--filter", "@worldara/web", "dev")
    }
    "test" {
        Invoke-Pnpm @("test")
    }
    "build" {
        Invoke-Pnpm @("build")
    }
}
