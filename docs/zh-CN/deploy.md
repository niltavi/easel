# 部署 Easel

[English](../en/deploy.md) · [仓库首页](../../README.md)

Easel 是一个 Node.js 进程，同时提供前端和接口，账号和已同步的画保存在一个 SQLite 文件里。

## Docker

在仓库根目录构建镜像：

```sh
docker build -t niltavi-easel:local .
```

运行时给数据库挂一个卷：

```sh
docker run -d --name easel -p 8787:8787 \
  -v easel-data:/app/data \
  niltavi-easel:local
```

打开 `http://localhost:8787`。容器以 `node` 用户运行，监听 8787 端口。数据库在 `/app/data/easel.db`，备份这个卷就备份了全部账号和已同步的画。

在 Apple Silicon 的 Mac 上构建出的镜像是 `arm64`。部署到 x86 服务器时，用 `docker buildx build --platform linux/amd64 -t niltavi-easel:local .` 构建。

## 不用 Docker

需要 Node.js 24 以上和 pnpm。

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm server
```

`pnpm server` 读取仓库根目录的 `.env`，可以从 `.env.example` 复制一份开始。

## 账号和登录

画图、管理画作、导入导出文件都不需要账号。云同步和 AI 需要登录。

服务器上创建的第一个账号就是管理员。首次启动后马上创建，可以打开 `/register`，也可以调用 `POST /api/auth/register`。管理员在 `/admin` 管理实例：

- **登录方式**：开关邮箱密码登录，接入 Niltavi Identity。在其他方式可用之前，邮箱密码登录会一直保持开启。
- **账号**：查看账号，授予或取消管理员。服务器至少保留一个管理员。
- **常规**：设置公开地址和每天的 AI 预览次数。

使用邮箱密码登录时：

- 密码长度为 8 到 128 个字符，以加盐的 scrypt 哈希保存。
- 能访问到服务器的人都可以创建账号。如果这不符合你的预期，请把它放在自己的网络或访问控制后面。
- 目前还没有找回密码的页面，请把管理员密码保存在密码管理器里。
- 同一个邮箱连续输错 5 次密码后，这个邮箱会被锁定 15 分钟。

## 配置项

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `PORT` | `8787` | 监听端口 |
| `EASEL_DB` | `data/easel.db`（镜像内为 `/app/data/easel.db`） | SQLite 数据库文件 |
| `EASEL_ORIGIN` | 未设置 | 服务器的公开地址，用于 Niltavi Identity 回调。可在管理台覆盖 |
| `IDENTITY_ISSUER`、`IDENTITY_APP_ID`、`IDENTITY_APP_SECRET` | 未设置 | Niltavi Identity 凭据。可在管理台覆盖 |
| `ANTHROPIC_API_KEY` | 未设置 | 启用 AI。不设置时 AI 不可用，其余功能照常 |
| `EASEL_AI_MODEL`、`EASEL_AI_EFFORT` | 见 `.env.example` | AI 改图使用的模型和强度 |
| `EASEL_AI_DAILY_QUOTA` | `5` | 每个账号每天的 AI 预览次数。可在管理台覆盖 |
| `EASEL_AI_MOCK` | 未设置 | 设为 `1` 时返回固定的示例改动，不调用模型，用于演示 |
