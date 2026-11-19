# Easel

[English](../README.md)

Niltavi 产品线中的个人画板，离线优先。手写、文字、形状和连线在同一张无限画布上；作品默认保存在本机，可以按作品开启云同步，AI 画图或改图先预览再应用。可以安装为 PWA，断网时照常使用。

- 部署：`pnpm build` 输出 `dist/`，`pnpm server` 用一个进程提供接口和前端；数据在 `data/easel.db`（SQLite）
- 配置：复制 `.env.example` 为 `.env`。SMTP 用于发送登录验证码，未配置时验证码打印在服务端日志里；`ANTHROPIC_API_KEY` 用于 AI
- 开发：需要 Node.js 24 和 pnpm。`pnpm install` 后，`pnpm dev:server` 启动接口，`pnpm dev` 启动前端；`pnpm test` 和 `pnpm build` 是提交前的检查
- 没有模型密钥时，设 `EASEL_AI_MOCK=1` 可以试用 AI 改图

## 目录

```
src/components/   界面，基于 HeroUI v3 和 Niltavi 主题
src/editor/       画布；adapter.ts 是 Excalidraw 与 Easel 数据之间的适配层
src/lib/          本机数据层：IndexedDB、作品管理、.easel 文件、登录与同步
src/theme/        从 niltavi-ui 复制的主题，不在这里修改
shared/           浏览器和服务端共用的接口约定、结构图类型与操作校验
server/           Hono 接口：邮箱验证码登录、作品快照、AI 预览
tests/            结构图校验、文件格式、AI 额度，以及用真实服务端跑的同步流程
```

代码仓库：[GitHub](https://github.com/niltavi/easel)、[Gitea](https://git.yarinz.com/niltavi/easel)。
