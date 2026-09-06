# TMate 1.1.0

- 名称统一为 TMate，更新深色银色 M 图标及 Android / iOS 启动资源；沿用原生包标识以兼容更新。
- 设置增加电费单价，只估算缺失费用；概览、充电列表与详情统一计算口径。
- 车辆软件版本增加已完成升级记录回退；哨兵状态缓存并标明收到时间，不将缺失误报成关闭。
- 提供 Docker / Node.js 原生部署、HTTPS 高端口、只读账号、移动端签名和备份教程。
- TeslaMate 新安装脚本使用官方镜像，拒绝覆盖已有实例；源码不包含个人配置。
- GitHub Actions 自动检查、生成 APK 和源码包；Docker 工作流支持两种 CPU 架构，配置 Docker Hub 后发布镜像。

发布验证：本地类型与代码检查通过；58 项 Node 测试、7 项 Python 部署工具测试通过；网页两种构建与 Android release/lint/signature 检查通过。已在现有 fnOS + TeslaMate 4.2.0 / PostgreSQL 18 上验证更新、只读接口、中文地址和地图。没有在所有 NAS/手机上实测，也没有对全新 TeslaMate 栈或 iOS 真机作实装验证；相关配置与脚本经静态和模拟测试。
