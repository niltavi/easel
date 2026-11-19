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
  -e EASEL_SELF_HOSTED=1 \
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

## 登录模式

画图、管理画作、导入导出文件都不需要账号。云同步和 AI 需要登录。

| | 默认 | 自托管 |
| --- | --- | --- |
| 配置 | 不设置 `EASEL_SELF_HOSTED` | `EASEL_SELF_HOSTED=1` |
| 登录方式 | 发到邮箱的 6 位验证码 | 邮箱和密码 |
| 创建账号 | 第一次通过验证码验证 | 登录弹窗里的「创建账号」 |
| 是否需要邮件服务 | 需要，配置 `EASEL_SMTP_URL` | 无需邮件服务，服务器不发任何邮件 |
| 邮箱地址 | 已验证 | 记录为未验证 |

本地或私有部署、手头没有邮件服务时，用自托管模式。对外公开的服务保持默认模式。

自托管模式下：

- 密码长度为 8 到 128 个字符，以加盐的 scrypt 哈希保存。
- 能访问到服务器的人都可以创建账号。如果这不符合你的预期，请把它放在自己的网络或访问控制后面。
- 服务器不发邮件，所以没有找回密码的功能。需要重置时，从 `users` 表里删掉这个用户的记录，让对方重新注册；之前同步的画挂在旧账号下。
- 邮箱验证码相关的接口处于关闭状态。
- 同一个邮箱连续输错 5 次密码后，这个邮箱会被锁定 15 分钟。

默认模式下如果没有配置 `EASEL_SMTP_URL`，验证码会打印在服务端日志里，这只适合开发时使用。

把已有部署从自托管切回默认模式时，账号会保留。这些账号的邮箱仍是未验证状态，直到本人用邮箱验证码登录一次；原来的密码在默认模式下失效。

## 配置项

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `PORT` | `8787` | 监听端口 |
| `EASEL_DB` | `data/easel.db`（镜像内为 `/app/data/easel.db`） | SQLite 数据库文件 |
| `EASEL_SELF_HOSTED` | 未设置 | 设为 `1` 时启用邮箱加密码登录，全程不发邮件 |
| `EASEL_SMTP_URL` | 未设置 | 默认模式下发送验证码的 SMTP 服务，例如 `smtps://user:pass@smtp.example.com:465` |
| `EASEL_MAIL_FROM` | `Easel <no-reply@localhost>` | 登录邮件的发件人 |
| `ANTHROPIC_API_KEY` | 未设置 | 启用 AI。不设置时 AI 不可用，其余功能照常 |
| `EASEL_AI_MODEL`、`EASEL_AI_EFFORT` | 见 `.env.example` | AI 改图使用的模型和强度 |
| `EASEL_AI_DAILY_QUOTA` | `5` | 每个账号每天的 AI 预览次数 |
| `EASEL_AI_MOCK` | 未设置 | 设为 `1` 时返回固定的示例改动，不调用模型，用于演示 |
