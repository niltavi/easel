# Easel

[English](../README.md)

可离线使用的个人画板。手写、文字、形状和连线在同一张无限画布上；作品默认保存在本机，可以按作品开启云同步，也可以让 AI 画流程图或修改已有的图。

## 本地运行

需要 Node.js 24 以上和 pnpm。

```sh
pnpm install
pnpm dev:server   # 接口服务，默认 http://localhost:8787
pnpm dev          # 前端，/api 代理到上面的服务
```

只跑 `pnpm dev` 也能用：画图、作品管理、导入导出都不依赖服务端，登录、云同步和 AI 需要它。服务端不在默认地址时，用 `EASEL_API` 指定开发代理的目标。

服务端配置见 `.env.example`。没有配置 SMTP 时，登录验证码打印在服务端日志里；没有 `ANTHROPIC_API_KEY` 时 AI 不可用，本地演示可以设 `EASEL_AI_MOCK=1`。

## 构建与部署

```sh
pnpm build        # 类型检查并输出 dist/，包含 Service Worker
pnpm server       # 同一个进程提供接口和 dist/ 里的前端
```

数据在 `data/easel.db`（SQLite）。

## 测试

```sh
pnpm test
```

覆盖结构图操作校验、`.easel` 文件格式、线宽档位、AI 接口的额度与失败处理，以及用真实服务端跑的同步流程：双设备冲突、响应丢失后重试、云端删除、登录过期、退出与换号。

## 代码结构

| 目录 | 内容 |
|---|---|
| `shared/` | 浏览器和服务端共用的接口约定、结构图类型与操作校验 |
| `src/lib/` | 本机数据层：IndexedDB、作品管理、`.easel` 文件、登录与同步。不依赖界面库 |
| `src/editor/` | 画布。`adapter.ts` 是 Excalidraw 与 Easel 自有数据之间的适配层 |
| `src/components/` | 界面，基于 HeroUI v3 和 Niltavi 主题（`src/theme/` 从 niltavi-ui 复制，不要直接改） |
| `server/` | Hono 接口：邮箱验证码登录、作品快照、AI 预览 |

## 同步模型

云端按作品保存带版本号的完整快照。提交时带上本机内容所基于的版本，只有基于最新版本的提交会被接受；迟到的一方收到冲突，把自己的改动存成一件「冲突副本」，再取回云端版本。每次提交带一个 `设备:修订号` 形式的 mutationId，同一份内容重试不会产生新版本。删除云端副本会留下一条不含内容的记录，离线设备之后的提交因此得到明确的「已移除」，未上传的改动转成本机副本。
