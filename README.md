# Worldara 世界格

> 把世界设定、时间线、关系和正文放在同一张工作台上。

[English README](./README.en.md) · 当前版本 `1.0.0`

Worldara 是一个面向长期创作的世界观管理工具。人物、地点、势力、事实、事件和章节不再散落在文档与聊天记录里；它们有自己的结构，也能互相核对。

## 截图

以下截图来自仓库内实际运行的 `The Amber Coast` 示例世界。示例数据只用于展示界面，不会随仓库提交。

| 世界概览 | 实体档案 |
| --- | --- |
| ![世界概览](docs/screenshots/01-overview.png) | ![实体档案](docs/screenshots/02-entities.png) |

| 关系图谱 | 编年史 |
| --- | --- |
| ![关系图谱](docs/screenshots/03-graph.png) | ![编年史](docs/screenshots/04-timeline.png) |

| 世界地图 | 正典校验 |
| --- | --- |
| ![世界地图](docs/screenshots/05-map.png) | ![正典校验](docs/screenshots/06-canon.png) |

| 主张与分支 | 作品与场景 |
| --- | --- |
| ![主张与分支](docs/screenshots/07-knowledge.png) | ![作品与场景](docs/screenshots/08-manuscript.png) |

| 构思提案 | 类型与规则 |
| --- | --- |
| ![构思提案](docs/screenshots/09-proposals.png) | ![类型与规则](docs/screenshots/10-schema.png) |

| 偏好设置 |
| --- |
| ![偏好设置](docs/screenshots/11-settings.png) |

## 它解决什么问题

写世界观的人通常不是缺少想法，而是缺少一个能在写作时随手核对设定的地方。Worldara 把创作拆成几块清楚的工作区：先整理实体和规则，再记录历史与关系，最后回到作品和场景。

它适合个人作者、小型创作团队，以及需要维护复杂设定的桌面或内网项目。它是本地运行的 monorepo，不提供托管账号，也不会替你把内容上传到外部服务。

## 主要功能

- 实体档案：人物、地点、城市、势力等设定可以使用结构化字段和标签管理。
- 关系图谱：把实体之间的关系单独记录，避免只靠正文中的一句话维持设定。
- 编年史：用 `world tick` 记录事件、参与者、地点和因果链接，并按时间查看状态快照。
- 地图：创建多图层地图，绑定实体并保存 Marker、Polygon 等 GeoJSON 要素。
- 正典校验：确定性规则负责检查引用、类型、时间线和结构约束；草稿不能直接变成正典。
- 作品与场景：作品、章节、场景可以绑定 POV、地点、参与者和世界时间，并进行连续性复查。
- 导入导出：提供 JSON、ZIP、Markdown、GeoJSON 和 Obsidian 导出边界，便于备份和迁移。
- 构思提案：外部模型只能生成待审核的结构化草案；不配置服务时不会发起模型请求。

## 快速开始

需要 Node.js 20+、pnpm 11 和 PowerShell。先安装依赖：

```powershell
pnpm install
```

直接启动本地开发环境（默认使用 SQLite 文件，数据写入 `data/`）：

```powershell
.\start.ps1 -Mode dev
```

打开 `http://localhost:3000`，API 健康检查地址是 `http://127.0.0.1:4000/health`。

如果只想启动单个服务：

```powershell
.\start.ps1 -Mode api
.\start.ps1 -Mode web
```

使用 PostgreSQL 时，需要先启动 Docker Desktop，再运行：

```powershell
.\start.ps1 -Mode db
```

`.env.example` 记录了 PostgreSQL、API、MCP 和可选内容服务的配置项。密钥只放在本机环境变量中，不要提交 `.env`。

## 仓库结构

```text
apps/web       Next.js 前端
apps/api       Fastify HTTP API
apps/worker    PostgreSQL outbox / 异步任务入口
apps/mcp       MCP stdio 入口
packages/*     Domain、Application、Contracts、数据库、校验、快照、导入导出等核心包
docs           架构、数据模型、API 与质量文档
infra          Docker Compose 配置
```

浏览器只通过 API 访问数据；Canon 规则、revision gate 和跨世界引用检查在服务端与共享核心中执行。AI 和 MCP 没有绕过这些边界的写入口。

## 检查与构建

```powershell
pnpm -r --workspace-concurrency=1 --if-present check
pnpm -r --workspace-concurrency=1 --if-present test
pnpm -r --workspace-concurrency=1 --if-present build
```

当前 `1.0.0` 发布前已完成 TypeScript 检查、全量测试和全量构建；本机测试结果为 160 个通过断言，PostgreSQL contract 因 Docker 引擎不可用而跳过。真实 PostgreSQL 迁移、目标规模性能、浏览器 E2E 和实际外部模型调用需要在对应环境单独验收。

## 文档与许可

- [开发文档](./docs/README.md)
- [API 轮廓](./docs/openapi-outline.yaml)

仓库当前没有附带许可证文件。除非另行添加许可证，代码按保留所有权利处理。
