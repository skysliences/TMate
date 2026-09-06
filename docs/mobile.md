# TMate Android / iOS 打包

前置：按 [部署教程](deployment.md)启动自己的 TMate 数据服务，推荐使用可信 HTTPS。App 本地加载共享网页资源，不需要 Tesla 账号密码，也不包含数据库密码、高德 Key 或 TMate API_KEY。

## 1. 可选的地址预配置

编辑仓库根目录 `mobile.config.json`：

```json
{
  "defaultServerUrl": "https://tmate.example.com:8787",
  "androidHttpOrigin": ""
}
```

默认两个值均为空，用户安装后自己填服务地址。这里只能配置**公开服务地址**，所有 Key 仍在服务端 `.env`，访问密钥由用户在 App 设置输入。构建校验会拒绝额外字段、含凭据 URL 和路径。原生 App 仍可在设置更改 HTTPS 服务地址，不需要重新编译。

仅在可信家庭 LAN 使用的安卓定制包，可以填一个私有 IPv4 例外：

```json
{
  "defaultServerUrl": "http://192.168.50.20:8787",
  "androidHttpOrigin": "http://192.168.50.20:8787"
}
```

构建工具生成只对该 IP 放行的 Android 网络配置，客户端再次限定准确端口和 `/api/` 路径，禁止重定向。不是对所有 HTTP 开放权限；iOS 和远程网页不能使用这项安卓例外。采用 HTTPS 后不需要填它。

## 2. 图标与共享资源

```bash
npm ci
npm run mobile:icons
npm run mobile:sync
```

图标源为 `public/icon.svg` 和 `public/tmate-mark.svg`，使用深色底、银色 M 与蓝色短线；脚本同步 Android 各密度、自适应图标、启动页以及 iOS 1024 图标。图标不使用 Tesla / TeslaMate 官方标记。

## 3. Android Studio

需要 Java 21、Android SDK 36、兼容的 Android Studio；具体依赖以本工程 Gradle 配置和 [Capacitor 环境要求](https://capacitorjs.com/docs/getting-started/environment-setup)为准。

```bash
npm run mobile:sync
npm run mobile:android
```

在 Android Studio 打开 `android/`，完成 Gradle 同步，先运行到设备测试。调试包：

```bash
cd android
./gradlew assembleDebug
```

输出 `android/app/build/outputs/apk/debug/app-debug.apk`。正式发布在 Android Studio 使用 Generate Signed App Bundle / APK，保存自己的签名文件和密码。调试签名不能覆盖已用另一把正式密钥签名的应用。

## 4. 本项目命令行签名包

如果已配置 JDK 21 和 SDK 36：

```bash
# 按自己的工具链路径填写，无需改系统默认 Java
export TMATE_JAVA_HOME=/你的路径/jdk-21
export ANDROID_HOME=/你的路径/Android/sdk
npm run android:apk
```

已有本项目专用工具链时可省略上面两项，脚本回退到忽略提交的 `work/android-toolchain/`。首次会在 `work/android-signing/` 生成本机私密签名配置；存在时复用，缺少配套密码文件时拒绝覆盖。输出 `outputs/TMate-1.1.0-android.apk` 及 SHA-256 文件；运行 release 构建、lint 和签名校验。

妥善离线备份 `work/android-signing/`，不要提交或分享。该目录不在源码发布包中，因此其他用户会用自己的签名；不能覆盖别人签名的旧版 App。签名密码不是服务端 Key，不需要填写在网页或服务器配置中。

本版本显示名 TMate、版本 1.1.0、versionCode 2，保留 `dev.bugo.voltlog` 包名和历史签名别名，便于原安装覆盖升级。发布自己的独立应用时统一修改 Capacitor appId、Android namespace/applicationId、iOS Bundle Identifier；更新已有 App 则必须保留原标识与签名。

## 5. iOS

需要 macOS、完整 Xcode 26+ 和 Apple 签名配置，当前最低 iOS 16.4，原生依赖使用 Swift Package Manager。

```bash
npm run mobile:sync
npm run mobile:ios
```

在 `ios/App/App.xcodeproj` 中设置自己的 Signing Team，检查 Bundle Identifier、版本与图标。连接 iPhone 调试；发布时 Product → Archive，再按账号权限导出或提交 TestFlight。不能在没有 Apple 签名资格或完整 Xcode 时凭空生成可安装 IPA。

## 6. 安装后检查

输入自己的 HTTPS 服务地址和服务器 `.env` 中的 API_KEY，确认车辆、行程、地图、胎压及后台切换恢复。API_KEY 只保留在本次进程内存中，完全退出后需重新填写。服务器地址可保存在设备偏好中；从旧版升级会保留该地址，需要时手动改为新的 HTTPS 域名。

源代码构建和自动化测试不等同于真机测试；正式发布前请在自己的 Android / iPhone 上检查触摸导航、不同字号、键盘、安全区和网络切换。
