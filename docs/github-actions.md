# GitHub 自动打包与 Docker Hub 发布

工作流使用固定提交版本的官方 GitHub / Docker Actions。公开仓库中的提交到 `main`、`v*` 标签、Pull Request 或手动 Run workflow 会启动构建。PR 不使用发布签名或推送镜像。

## 安卓 APK 与源码

`Test and package TMate` 先运行类型、代码、接口和部署脚本测试，再构建网页。Actions 页面提供 `TMate-source` 和 `TMate-Android` 下载；默认保留 30 天。

未配置签名时生成文件名明确包含 `DEBUG` 的测试 APK。测试签名不能覆盖已安装的正式 App，不要将其当作正式版发布。

正式签名在 GitHub 仓库 **Settings → Secrets and variables → Actions → Secrets** 配置：

| Secret | 内容 |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | 自己的签名 keystore 文件转 Base64 |
| `ANDROID_STORE_PASSWORD` | keystore 密码 |
| `ANDROID_KEY_PASSWORD` | 该签名条目密码 |
| `ANDROID_KEY_ALIAS` | 签名条目名称；旧本地构建默认为 `voltlog` |

四项必须同时填写；不完整会停止构建，避免悄悄生成其他签名。签名只在临时目录解密，用后清理，不进入 APK 资源、Git、源码包或构建附件。不要在公开 Issue 或日志中粘贴密钥。保留离线备份；丢失签名将不能覆盖更新旧 App。

每次正式版本同时增加 `package.json` / 锁文件、`server/package.json` / 锁文件、Android `versionCode` / `versionName` 与 iOS 的版本号。版本标签必须等于 `v` + `package.json` 版本，例如 `v1.1.0`。

```bash
git tag v1.1.0
git push origin v1.1.0
```

工作流自动生成附件，但不自动创建 GitHub Release。可在构建通过后建立 Release 并上传对应正式 APK。iOS 工程在源码中提供；可安装的 IPA 仍需 Apple 开发者签名及 Xcode，不提供无法安装的“通用 IPA”。

## Docker Hub

先在自己的 Docker Hub 账号创建公开仓库 `tmate`，创建只用于镜像推送的访问令牌（Read & Write；不需要 Delete），再在 GitHub 配置：

- Actions **Variables**：`DOCKERHUB_USERNAME`，自己的 Docker ID。
- Actions **Secrets**：`DOCKERHUB_TOKEN`，自己的 Docker Hub 访问令牌。

`Docker image` 会验证代码，构建 `linux/amd64` 和 `linux/arm64` 两种架构，生成 SBOM。`main` 发布 `edge` 与提交标签；版本标签发布对应版本、主次版本及稳定版 `latest`。未配置账号/令牌时只验证构建，明确标记“未发布”，不尝试登录或伪造镜像地址。

在 Docker Hub 发布成功后可以使用 `你的用户名/tmate:1.1.0`。部署时保留原 Compose 环境、网络、卷和端口，只将镜像名改成自己的已发布镜像，并移除 `build` 或使用 `docker compose up -d --no-build`。业务数据库、API_KEY、高德 Key、Tesla Token、NAS 配置及 TLS 私钥均不需要也不能作为构建参数上传。

参考：[Docker 官方 GitHub Actions](https://docs.docker.com/build/ci/github-actions/)、[GitHub 镜像发布指南](https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images)。
