# TMate 完整部署教程

本文中的 `tmate.example.com`、`192.168.50.20` 均为示例，请换成自己的域名和服务器地址。所有命令在解压后的 TMate 源码目录执行，除非特别说明。不要在已有 TeslaMate 的目录中解压覆盖文件。

## 1. 先选择部署方式

TMate 是查看层，TeslaMate 是采集层，两者都需要正常运行。可以组合使用：TeslaMate 用 Docker，TMate 用 Docker 或原生 Node.js；已有原生 TeslaMate 也可以接入。

| 项目 | Docker 部署 | 原生部署 |
| --- | --- | --- |
| TMate 运行环境 | Docker Engine / Desktop，Compose v2（建议 2.24+） | Node.js 22.13+、npm；Linux 长期运行可选 systemd |
| 构建资源建议 | 首次前端构建建议至少 2 GB 可用内存；运行时后端上限 384 MB | 构建建议至少 2 GB 可用内存；运行取决于访问量 |
| 只读账号工具 | Python 3.9+、Docker 容器里的 psql | Python 3.9+、PostgreSQL 客户端 psql |
| 数据 | 已正常初始化的 TeslaMate PostgreSQL | 同左，数据库须从 Node 主机可达 |
| MQTT | 可选，同一 Docker 网络可不发布宿主机端口 | 可选，须有可达的代理地址与认证 |
| 域名和 HTTPS | 公网 / App 推荐；可用内置代理或已有反代 | 公网 / App 推荐；使用已有 Nginx 等反代 |

先自行安装 [Docker](https://docs.docker.com/engine/install/) 或 [Node.js](https://nodejs.org/en/download)。脚本不会自动安装系统软件或更改防火墙。

TMate 已有 TeslaMate 4.2.0 / PostgreSQL 18 的真实数据兼容记录；这不是对所有历史/未来版本的兼容保证。不能把 PostgreSQL 18 镜像直接挂在 16/17 的数据目录上。

## 2. 全新安装 TeslaMate（可选）

**已有 TeslaMate：跳到第 3 节，不运行本节。** 一键脚本只负责全新 Docker 安装，不是更新器、迁移器或 Tesla 登录工具。它依据 [TeslaMate 官方 Docker 文档](https://docs.teslamate.org/docs/installation/docker/)配置官方服务。

### 2.1 填配置

```bash
cp deploy/teslamate/.env.example deploy/teslamate/.env
chmod 600 deploy/teslamate/.env
openssl rand -hex 32
```

用编辑器打开 `deploy/teslamate/.env`。运行三次随机值生成命令，分别填写：

- `ENCRYPTION_KEY`：加密 TeslaMate 保存的 Tesla Token。必须单独备份，丢失或更改后无法解密已有令牌。
- `DATABASE_PASS`：TeslaMate 数据库管理员密码，与 TMate 的只读账号密码不同。
- `GRAFANA_ADMIN_PASSWORD`：Grafana 初始 `admin` 密码；三个值都要求至少 32 位且互不相同。
- `TM_BIND_ADDRESS`：默认 `127.0.0.1` 仅本机可访问。NAS 用户填服务器实际 LAN IPv4，例如 `192.168.50.20`；脚本不允许直接绑定公网或 `0.0.0.0`。
- `TESLAMATE_HOSTNAME`：浏览器实际访问 TeslaMate 的主机名或 IP，例如 `192.168.50.20`，不要带协议或端口；用于来源检查。
- `TESLAMATE_PORT=4000`、`GRAFANA_PORT=3000`：可换成其他未占用端口。
- `TESLAMATE_PROJECT_NAME` 和 `TESLAMATE_NETWORK`：默认 `teslamate` / `teslamate_default`。不要填已有部署的名称。

镜像版本在同一文件中显式填写：TeslaMate/Grafana `4.2.0`、PostgreSQL `18-trixie`、Mosquitto `2`。镜像仓库固定为官方 `teslamate/teslamate`、`teslamate/grafana`、`postgres`、`eclipse-mosquitto`，不使用第三方镜像站。

中国大陆 Tesla 账号可按[官方环境变量说明](https://docs.teslamate.org/docs/configuration/environment_variables/)把 `TESLA_API_HOST` 改为 `owner-api.vn.cloud.tesla.cn`，`TESLA_WSS_HOST` 改为 `streaming.vn.cloud.tesla.cn`；按实际账户地区选择，不改动现有车辆的采集参数。

配置格式为 `KEY=value`，注释单独一行；可以用一对引号包住值。不支持多行值、`export`、变量展开或行尾注释。**脚本把文件当作数据读取，从不 source/eval 文件。** 推荐使用十六进制随机值，避免 `$` 和引号在手动 Compose 命令中的插值差异。

### 2.2 一键执行

```bash
bash scripts/install-teslamate.sh --check
bash scripts/install-teslamate.sh --dry-run
bash scripts/install-teslamate.sh
```

也可以指定配置：`bash scripts/install-teslamate.sh --env /你的私密目录/teslamate.env`。前两条只验证或说明范围，不连接 Docker、不安装服务。真正执行时需要 Docker 权限；加入 Docker 用户组意味着较高主机权限，应按系统管理策略处理。

脚本先检查 Docker、配置、已有 TeslaMate 容器、项目卷和网络，再拉取镜像并启动。数据库和 MQTT **不发布到宿主机端口**。MQTT 在新建 Docker 网络内部匿名使用，不能把 1883 映射公网；有更严格需求时按官方文档自行配置认证。

数据持久化在独立命名卷中。脚本不会执行 `down -v`、删除卷、自动更新已有服务或覆盖现有 `.env`。运行失败后如果已有部分容器/网络/卷，重跑会拒绝覆盖，按第 8 节排查后用原 Compose 配置恢复，不能靠删卷“重装”。

### 2.3 完成 Tesla 授权

打开 `http://服务器地址:4000`，按照 [TeslaMate 官方 Token 指南](https://docs.teslamate.org/docs/installation/tokens/)生成并填写自己的 access / refresh token。它们只交给 TeslaMate，**不要填入 TMate 的 API_KEY 或 AMAP_KEY**。脚本不会登录你的 Tesla 账号，也不保证安装完就已有车辆数据。

打开 `http://服务器地址:3000`，使用 `admin` 和你填写的 Grafana 密码登录。原始 TeslaMate/Grafana 仅在可信 LAN 使用；不要直接将这些管理端口映射公网。

TeslaMate 原生安装另见[官方 Debian 手动安装指南](https://docs.teslamate.org/docs/installation/unsupported/debian/)，上游将其标为不提供支持。TMate 的 Node.js 原生部署不等于自动安装 Elixir / PostgreSQL / Grafana。

## 3. 接入已有 TeslaMate

### 3.1 找到数据库与网络

Docker 环境只做检查：

```bash
docker ps --format 'table {{.Names}}\t{{.Image}}'
docker network ls
docker inspect 你的数据库容器名 --format '{{json .NetworkSettings.Networks}}'
```

记录 PostgreSQL 容器名、现有网络名、数据库名和管理员用户名。不要把完整 `docker inspect` 输出公开，因为环境变量中可能包含密码。新安装脚本的默认网络为 `teslamate_default`；现有飞牛/群晖可能不同，以实际结果为准。

### 3.2 填 TMate 配置

```bash
cp .env.example .env
chmod 600 .env
openssl rand -hex 32
```

编辑 `.env`，至少修改：

| 变量 | 如何填写 |
| --- | --- |
| `DATABASE_URL` | `postgresql://tmate_reader:你的只读密码@database:5432/teslamate`；Docker 使用数据库服务名或网络别名，原生用可达主机地址 |
| `API_KEY` | 另一个独立的随机访问密钥，至少 32 位，推荐 64 位十六进制 |
| `WEB_ORIGIN` | 浏览器最终访问的完整 origin，如 `https://tmate.example.com:8787`，无尾斜线、路径或 `/api` |
| `AMAP_KEY` | 可选，高德开放平台的 Web 服务 Key；留空禁用高德地址与底图 |
| `TESLAMATE_NETWORK` | Docker 的现有 TeslaMate 网络名 |
| `MQTT_URL` | 可选，如 `mqtt://mosquitto:1883`；不用 MQTT 就留空 |
| `MQTT_USERNAME` / `MQTT_PASSWORD` | 代理要求认证时才填，密码不放 URL 中 |
| `MQTT_PREFIX` | 通常 `teslamate`；上游配置 namespace 时填 `teslamate/你的namespace` |
| `ALLOWED_ORIGINS` | 保留 `capacitor://localhost,https://localhost`；独立网页跨域访问时追加它自己的 origin，不使用通配符 |

为只读数据库角色再单独生成一个密码，不复用 TeslaMate 管理员密码或 API_KEY。连接串中的 `@ : / # % ?` 等字符必须百分号编码；十六进制随机密码不用额外编码。

没有任何变量需要填你的 Tesla 账号密码。高德 Key 的权限/配额由你自己的账号决定；如果使用 IP 白名单，应填写服务器访问高德时的公网出口 IP，不是手机 IP。

### 3.3 创建只读账号

先让 TeslaMate 成功启动、完成数据库迁移，再执行。工具从 `.env` 中的 `DATABASE_URL` 读取新角色名和密码，不打印密码、不把 SQL 放到命令行参数。

Docker 数据库（把容器名及管理员用户名替换为实际值）：

```bash
python3 scripts/create-readonly-role.py --env .env --container teslamate-database-1 --admin-user teslamate --check
python3 scripts/create-readonly-role.py --env .env --container teslamate-database-1 --admin-user teslamate
```

利用容器内 psql 的本地管理员连接；如果原数据库禁止此连接方式，改用下一种管理员配置或由数据库管理员执行等价 SQL，不要放宽数据库认证。

原生 PostgreSQL：

```bash
cp .env.admin.example .env.admin
chmod 600 .env.admin
# 填写 PGHOST、PGPORT、PGDATABASE、PGUSER、PGPASSWORD
python3 scripts/create-readonly-role.py --env .env --admin-env .env.admin --check
python3 scripts/create-readonly-role.py --env .env --admin-env .env.admin
```

`.env.admin` 仅用于这次管理操作，不能挂载给 TMate 或纳入发布包。远程数据库使用可信 TLS 及 `PGSSLMODE=verify-full` / CA，或 SSH 隧道，不开放公网明文 PostgreSQL。

工具在事务中创建新角色并授予九张表 SELECT：`cars`、`drives`、`positions`、`charging_processes`、`charges`、`states`、`addresses`、`geofences`、`updates`。默认事务只读，无超级用户、建库、建角色和复制权限；不会授予所有表或未来表权限。遇到已有角色、缺表或不安全的 PUBLIC 权限时停止并回滚。

已有 `voltlog_reader` 等合格只读账号可直接复用，不要重置密码或改名。旧版八表权限需补上升级记录读取：在 `.env` 保留现有只读连接串，执行下面的显式升级操作（将容器名替换为自己的 PostgreSQL 容器名）：

```bash
python3 scripts/create-readonly-role.py --env .env --container YOUR_DATABASE_CONTAINER --grant-updates --check
python3 scripts/create-readonly-role.py --env .env --container YOUR_DATABASE_CONTAINER --grant-updates
```

原生部署改用 `--admin-env .env.admin --grant-updates`。此操作只给该账号增加 `updates` 表 SELECT，不创建账号、不改变密码、不改车辆数据。旧 `deploy/readonly-role.sql` 已改为安全提示，直接执行会拒绝，避免误用占位密码。

## 4. Docker 部署 TMate

### 4.1 初次启动

仓库根目录的 `compose.yaml` **只定义 TMate 和可选 HTTPS 代理**，不包含 TeslaMate 数据库，不重建已有采集服务。

```bash
docker compose config --quiet
docker compose build tmate
# 容器中的 Node 运行离线配置校验，不需要宿主机安装 Node
docker compose run --rm -T --no-deps -v "$PWD/.env:/run/tmate.env:ro" tmate node scripts/check-config.mjs /run/tmate.env
docker compose up -d --wait tmate
docker compose ps
curl -f http://127.0.0.1:8787/api/health
```

默认只发布回环 `127.0.0.1:8787`。要在家庭 LAN 浏览器测试，可将 `.env` 的 `TMATE_BIND_ADDRESS` 改为实际 LAN IP，`WEB_ORIGIN` 改为相同的 `http://LAN_IP:8787`，然后 `docker compose up -d tmate`。此时应从 LAN IP 检查健康接口。**不能把这个 HTTP 端口映射公网。**

`DATABASE_URL` 中的 `database` 依赖 Docker 网络 DNS；加入错误的网络会导致无法解析。数据库在外部服务器而不在 Docker 时，创建一个 TMate 专用网络并将 `TESLAMATE_NETWORK` 指向它，使用真实数据库地址；不要把容器内 `127.0.0.1` 当成宿主机。此类跨主机连接需要自行配置数据库最小来源放行与可信 TLS。

后端非 root、只读根文件系统，地图缓存使用独立 `map-cache` 命名卷，镜像中初始化为 UID 1000、0700。不要共享该卷，它含位置派生数据。更改 `.env` 后需要 `docker compose up -d` 重建应用容器，仅 `restart` 不会加载新的环境变量。

### 4.2 飞牛 / 群晖 / 低内存 NAS

新安装可以在 Docker 管理界面导入根目录 Compose，并设置项目路径、`.env` 和正确网络；NAS 的 Docker 能否拉取官方镜像需单独确认。

NAS 内存不足时，在开发电脑运行 `npm ci && npm run build:web`，上传源码包及生成的 `www/`。在 NAS 将构建 Dockerfile 切换为 `deploy/Dockerfile.prebuilt`，使用相同的 `.env` 与运行环境。该镜像只安装后端依赖。

`deploy/compose.fnos*.yaml` 是旧安装的兼容文件，不作为新用户的入口。已有在线服务须先备份其 Compose、私密配置、证书和缓存，保留项目名/服务名/卷挂载；不要在旧目录直接套用根目录全新 Compose，避免启动重复应用或改变端口。

## 5. 原生部署 TMate

### 5.1 前台运行

安装 Node.js 22.13+、npm 和可选的 PostgreSQL 客户端，先执行第 3 节的配置与只读账号步骤。`.env` 示例：

```dotenv
# 下列只有非密钥字段示例；DATABASE_URL 和 API_KEY 仍需自己填写
HOST=127.0.0.1
PORT=8787
PUBLIC_DIR=www
MAP_CACHE_DIR=./map-cache
WEB_ORIGIN=http://localhost:8787
```

将 `DATABASE_URL` / `MQTT_URL` 的 Docker 服务名改为实际可达的地址。若 TeslaMate 在 Docker 而 TMate 在宿主机，不能直接解析 `database`；优先将只读后端也放进 Docker，或按管理员策略将数据库只绑定到宿主机回环端口。不要为了接入 TMate 开放公网 5432/1883。

```bash
npm ci
npm run config:check
npm run build:web
mkdir -p map-cache
chmod 700 map-cache
npm run api
```

另开终端 `curl -f http://127.0.0.1:8787/api/health`，然后在浏览器打开对应地址。健康接口只表明 HTTP 服务运行，是否能读数据库还要在网页输入 API_KEY 验证。

生产环境可以只保留 `server/`、`www/`、配对工具和后端依赖：`npm ci --prefix server --omit=dev`。Web 服务的工作目录是项目目录，Node 从 `server/node_modules` 解析依赖，不需要启动前端开发服务器。

### 5.2 Linux systemd 开机启动

以下假设这是新安装目录，Node 位于 `/usr/bin/node`。已有部署请先备份，不要覆盖；其它 Node 路径用 `command -v node` 查询后修改服务文件。

```bash
npm ci --prefix server --omit=dev
sudo useradd --system --home /var/lib/tmate --shell /usr/sbin/nologin tmate
sudo install -d -m 755 /opt/tmate
sudo cp -a server www scripts deploy /opt/tmate/
sudo install -d -o root -g tmate -m 750 /etc/tmate
sudo install -o tmate -g tmate -m 600 .env /etc/tmate/tmate.env
```

用户 `tmate` 已存在时不要重复创建。编辑 `/etc/tmate/tmate.env`，设置 `PUBLIC_DIR=/opt/tmate/www`、`MAP_CACHE_DIR=/var/lib/tmate`，并填写正确的 `WEB_ORIGIN`、数据连接和密钥。确认程序文件对 `tmate` 可读、父目录可进入。

```bash
sudo install -m 644 deploy/tmate.service /etc/systemd/system/tmate.service
sudo systemctl daemon-reload
sudo systemctl enable --now tmate
sudo systemctl status tmate --no-pager
sudo journalctl -u tmate -n 50 --no-pager
```

服务以专用非 root 用户运行，仅 `/var/lib/tmate` 可写。修改配置后 `sudo systemctl restart tmate`。macOS/Windows 可以使用前台 Node 命令，但本项目没有提供 launchd / Windows 服务安装脚本；systemd 文件仅适用相应 Linux 系统。

## 6. HTTPS、域名与非 443 端口

证书与域名有关，不绑定端口。可以使用 `https://tmate.example.com:8787`，不必在公网开放 443。通过 DNS-01 申请证书不需要公网 80/443；本项目只提供导入证书的代理配置，**不包含自动签发/自动续期**。请根据证书提供方配置续期，并实际验证更新后的证书。

泛域名 `*.example.com` 不覆盖 `example.com` 或 `a.b.example.com`。证书要匹配浏览器/App 填写的域名；用 HTTPS IP 地址连接不会因为证书已导入而自动有效。

### 6.1 Docker 内置 HTTPS 代理

将叶证书在前的完整链保存为 `tls/cert.pem`，配套私钥为 `tls/key.pem`，不要放入 `www/` 或 `public/`。代理主进程需要读取私钥；Linux 可以设置目录 0700、文件 0600、root 所有。非 root Docker/Desktop 的挂载权限按实际环境验证，不要简单设为 777。

`.env` 示例（公网 8787，内部 HTTP 改为回环 8788，避免端口冲突）：

```dotenv
TMATE_BIND_ADDRESS=127.0.0.1
TMATE_HTTP_PORT=8788
TMATE_DOMAIN=tmate.example.com
TMATE_HTTPS_BIND_ADDRESS=192.168.50.20
TMATE_HTTPS_PORT=8787
WEB_ORIGIN=https://tmate.example.com:8787
ALLOWED_ORIGINS=capacitor://localhost,https://localhost
```

```bash
docker compose --profile https config --quiet
docker compose --profile https up -d --build --wait
docker compose exec -T https nginx -t
curl -f https://tmate.example.com:8787/api/health
```

模板由 Nginx 在启动时替换域名，代理通过专用网络连接 `tmate:8787`；只有后端加入 TeslaMate 数据网络。内置代理不接触数据库密码或高德 Key。修改域名/端口后重新创建代理与后端；仅更换证书时先 `nginx -t`，成功再 `docker compose exec -T https nginx -s reload`。

未准备证书时不要启用 `https` profile；没有 profile 时不启动代理。`docker compose` 不会读取证书到日志，但不要运行并分享未脱敏的 `docker compose config`，因为展开结果可能含密钥，校验用 `config --quiet`。

### 6.2 已有 Nginx / 原生服务

复制 `deploy/nginx.conf.example` 到你的 Nginx 站点配置，修改域名、证书路径和监听端口。代理目标填写本机 TMate 的回环 HTTP 端口。原生 TMate 通常 `127.0.0.1:8787`，若同一台主机 Nginx 要监听 `0.0.0.0:8787`，请先将后端 `PORT` 改为 8788，反代目标也相应修改，避免绑定冲突。

容器内 Nginx 的 `127.0.0.1` 是它自己，不是宿主机；优先使用上一种 Docker 网络方案。已有 fnOS 管理界面占用 443 时，不要改它的 Nginx，另开高端口代理即可。

### 6.3 DNS / 路由

1. A 记录指向自己的可入站公网 IPv4，或 CNAME 指向 DDNS；公网记录不要指向 `192.168.*`。
2. 公网 TCP 8787 转发到 NAS 的 TLS 8787，**不是未加密的后端端口**。运营商 CGNAT 下仅做转发不能解决，需要额外 VPN / 隧道方案。
3. Cloudflare 的普通橙云代理不支持 8787，请设为“仅 DNS”；可用端口见[官方列表](https://developers.cloudflare.com/fundamentals/reference/network-ports/)。不要删除证书校验来绕过错误。
4. 如果发布 AAAA，必须确保 IPv6 入口、防火墙和证书同样可达；此模板默认 IPv4，不会自动设置 IPv6。
5. 家庭路由不支持公网回流时，局域网 DNS 可将同一域名解析到 NAS 的 LAN IP。网址仍使用域名。

## 7. 打开网页和授权手机

打开 TMate 的地址，不是 TeslaMate 的 4000 或 Grafana 的 3000 端口。在设置输入自己的 `API_KEY`。浏览器与服务同源且 `WEB_ORIGIN` 匹配时，会建立 30 天设备会话。HTTPS 下 Cookie 使用 Secure / HttpOnly / SameSite=Strict。

管理员也能生成一次性配对链接：

```bash
# 新版 Docker Compose 服务名
docker compose exec -T tmate node deploy/pair-device.mjs
# 原生安装，在项目目录
node --env-file=.env deploy/pair-device.mjs
```

链接有效 15 分钟、仅能用一次，不要公开发送。服务重启后尚未使用的链接失效；已配对的签名会话保留。修改 API_KEY 或 WEB_ORIGIN 会使旧会话失效，需重新连接。旧 NAS 若仍使用 `voltlog` 服务名，把命令中的 `tmate` 换为 `voltlog`。

手机 App 输入相同的 HTTPS 服务地址与 API_KEY；密钥不编译进 App，只在进程内存中保留。完整打包步骤见 [mobile.md](mobile.md)。

## 8. 维护、备份与排错

### 更新 TMate

先备份 `.env`、Compose、证书、版本和缓存。新版源码放到独立版本目录，保留当前配置再构建；不要覆盖真实 `.env`，不要更换 API_KEY 或只读账号密码。Docker 使用 `docker compose up -d --build tmate`，启用内置 HTTPS 时保留 profile。失败时恢复上一版本源码/镜像与原配置；TMate 不做 TeslaMate 数据迁移。

原生服务先构建和校验新版本，再切换服务文件指向的新目录、`daemon-reload` / `restart`；保留旧目录用于回退。示例 systemd 默认 `/opt/tmate`，换目录时也要修改工作目录和 PUBLIC_DIR。

### 更新 TeslaMate / 一键安装部分失败

不要再次运行全新安装器来更新。先按照 [TeslaMate 升级指南](https://docs.teslamate.org/docs/maintenance/upgrading/)检查版本与数据库兼容，备份后使用原来的 Compose 文件与项目名：

```bash
docker compose --env-file deploy/teslamate/.env -f deploy/teslamate/compose.yaml config --quiet
docker compose --env-file deploy/teslamate/.env -f deploy/teslamate/compose.yaml ps
# 确认没有要覆盖的既有安装，且版本/卷配置正确后，恢复同一项目
docker compose --env-file deploy/teslamate/.env -f deploy/teslamate/compose.yaml up -d --wait
```

首次 `pull` 超时不等于程序损坏；检查官方仓库网络，不要自动换来历不明的镜像。若容器已启动而登录尚未完成，继续第 2.3 节，不要删除数据库。

### 备份与停止

TeslaMate 的数据库备份以[官方指南](https://docs.teslamate.org/docs/maintenance/backup/)为准，单独保留 `ENCRYPTION_KEY` 和原 Compose。对正在写入的数据库不要只复制卷目录当作一致性备份。所有数据库备份包含敏感车辆信息，应加密并限制访问。

停止 TMate：`docker compose stop tmate https`，原生用 `sudo systemctl stop tmate`。移除本应用容器可以在**确认正确项目目录后**使用 `docker compose down`，不加 `-v`，命名缓存卷保留；外部 TeslaMate 网络不会被删除。不要在 TeslaMate 项目中执行删除卷命令。彻底删数据不属于安装器功能，需要另行明确选择目标和备份。

### 常见问题

| 现象 | 检查 |
| --- | --- |
| `API_KEY` / 配置校验失败 | 模板值是否已替换、是否至少 32 位、`.env` 路径是否正确；不要粘贴 Tesla Token |
| 401 | 网页/App 使用的 API_KEY 是否与当前容器一致；变更后重新配对 |
| 403 / 配对失败 | WEB_ORIGIN 的协议、域名、端口完全匹配，无尾斜线；避免代理改写 Origin |
| `/api/health` 成功但车辆失败 | 健康接口不测试数据库；检查只读角色、网络 DNS、密码编码与 TeslaMate 表初始化 |
| 没有车辆或行程 | 先检查 TeslaMate 是否授权并已采集；休眠时不会持续更新，进行中记录不计入已完成行程 |
| 地址仍不够详细 / 地图不可用 | AMAP_KEY 必须为 Web 服务类型；检查静态地图/逆地理编码权限、配额和服务器网络；服务未返回门牌时不会编造 |
| MQTT 未更新 | 检查 namespace、代理认证、上游发布；页面会回退历史记录，不主动唤醒车辆 |
| 证书错误 | 检查域名覆盖、有效期、完整链、系统时间和私钥匹配；不能依赖 `curl -k` |
| HTTPS 端口无法访问 | 检查服务绑定、NAT/CGNAT、DNS橙云、AAAA、局域网回流；用手机蜂窝网络交叉验证 |
| 缓存权限错误 | Docker 命名卷初始化属主 UID 1000；原生目录须对运行用户可写，权限 0700；不要 chmod 777 |
| App 提示 HTTP 不允许 | 通用包默认只用 HTTPS。局域网例外需修改 mobile.config.json 并重新打包，不开放全局明文 |

不要公开粘贴 `.env`、带 Authorization 的请求、完整 Docker 环境、精确位置缓存或数据库备份。内置校验工具仅输出字段名或数量，不打印实际密钥。
