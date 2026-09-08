# 使用 Docker 部署房账

Docker 版本可以部署到自己的 Linux 服务器，不依赖 ChatGPT 登录、Sites、Cloudflare 或外部数据库。只有一个固定账号，没有注册、多用户或权限角色。

## 1. 配置固定账号

将整个项目上传到服务器，在项目目录执行：

```bash
cp .env.example .env
openssl rand -hex 32
```

编辑 `.env`：

```dotenv
ADMIN_USERNAME=admin
ADMIN_PASSWORD=替换为自己的至少12位密码
SESSION_SECRET=填入刚才生成的64位随机字符串
PUBLIC_ORIGIN=https://rent.example.com
PORT=3000
BIND_ADDRESS=127.0.0.1
```

账号由环境变量固定配置，没有默认密码。`PUBLIC_ORIGIN` 必须与手机和电脑浏览器的实际访问地址完全一致，包含协议和非默认端口；不要填写路径。修改密码或账号时，请同时更换 `SESSION_SECRET`，再重建容器，以使旧登录会话失效。

本机体验可设 `PUBLIC_ORIGIN=http://localhost:3000`。局域网直连可设 `BIND_ADDRESS=0.0.0.0` 和 `PUBLIC_ORIGIN=http://服务器局域网IP:3000`。公网使用 HTTPS 反向代理。

## 2. 启动

服务器需安装 Docker Engine 与 Docker Compose 插件。

```bash
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 rental-ledger
```

应用在容器内监听 3000 端口，健康检查为 `/healthz`。首次构建会安装锁定的开发依赖、编译前端；运行镜像仅包含 Node、前端产物、服务端和金额计算代码。业务数据存放在命名卷 `rental-ledger-data` 中的 `/data/ledger.sqlite`，不随容器更新丢失。

若已配置 Nginx、Caddy 或其他反向代理，将域名转发至 `127.0.0.1:3000` 即可。同一台服务器上 Caddy 的最简配置示例：

```caddyfile
rent.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

服务只使用固定账号、HttpOnly 登录 Cookie、12 小时会话，不提供注册或权限管理。会话密钥和密码只通过运行环境传入，不打进镜像；数据库使用本地持久化文件。

## 3. 从当前在线版迁移

1. 在在线版点击“备份账本”，下载完整 JSON，保留原文件作为备份。
2. 将文件命名为 `ledger-backup.json`，放入项目目录。
3. 停止应用，向**空白账本**导入：

```bash
docker compose stop rental-ledger
docker compose run --rm --no-deps \
  -v "$(pwd)/ledger-backup.json:/backup.json:ro" \
  rental-ledger node server/import-ledger.mjs /backup.json
docker compose up -d
```

导入会检查格式、金额和关联记录，并拒绝覆盖已有房源或流水的目标账本。源站数据保持原样；在线版和自己的服务器之间不会继续自动同步。开始正式使用后，请选定一个站点作为主账本。

## 4. 备份和升级

日常备份：在页面导出完整 JSON。CSV 用于查询对账，不用于完整恢复。

升级代码后执行：

```bash
docker compose up -d --build
```

命名卷会保留。不要使用 `docker compose down -v`，该参数会删除业务数据卷。若要完整复制数据库文件，请先停止应用，并一起保存 SQLite 文件及可能存在的 `-wal`、`-shm` 文件；更推荐通过页面导出的完整 JSON 迁移。

## 5. 不使用 Docker 的运行方式

本机安装 Node 24 或更新的兼容版本后：

```bash
npm ci
npm run build:selfhost
cp .env.example .env
# 编辑 .env 后
npm run start:selfhost
```

默认数据库位置为 `data/ledger.sqlite`，可通过 `DATABASE_PATH` 指定。无 Docker 运行的自托管服务器与 Docker 容器使用完全相同的服务端入口和前端产物。

## HTTP 访问与保存故障修复

本版本修复公网 HTTP 下点击保存后一直“保存中”的问题：浏览器缺少 `crypto.randomUUID()` 时，使用 `crypto.getRandomValues()` 生成请求编号；生成编号、序列化或网络请求失败都会恢复按钮，重试仍保留幂等保护。

通过公网 IP 直连时，在 `.env` 设置 `BIND_ADDRESS=0.0.0.0`、`PORT=3000` 和 `PUBLIC_ORIGIN=http://你的服务器公网IP:3000`，并在服务器安全组与防火墙放行 TCP 3000。正式使用推荐 HTTPS，避免密码和账本明文传输。

已部署旧版本的服务器：用新版源码覆盖项目代码，保留原 `.env` 和数据卷，然后运行 `docker compose up -d --build`，完成后刷新浏览器（必要时强制刷新）。修复不改变数据库格式，也不修改已有账务数据。

## 验证情况

已验证：独立前端构建；固定账号登录、伪造 Cookie 拒绝、跨站提交拒绝；SQLite 写入及重启持久化；重复请求幂等；两台设备并发修改；金额、押金、退款、成本、尾期折算及提醒筛选。

当前开发环境没有 Docker 引擎，未实际执行 `docker build` / `docker compose up`。部署文件已提供，独立 Node 服务已运行测试通过。
