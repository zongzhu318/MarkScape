# 打包资源

`entitlements.mac.plist` 用于 Electron 的 hardened runtime。正式 macOS 分发须提供 Developer ID 证书及公证凭据。

全库搜索优先使用 `process.resourcesPath/bin/rg`（Windows 为 `rg.exe`）。分发时可将对应平台、架构的 ripgrep 放在 `resources/bin/`；缺失时自动使用 Node 遍历，搜索结果区明确显示 `Node fallback`。不从用户文档目录或不可信 PATH 查找可执行文件。

品牌矢量源文件为 `icon.svg`；安装包使用 `icon.png` 和 `icon.ico`。可运行 `python3 scripts/generate-icons.py` 重新生成位图（需要 Pillow）；macOS 的 ICNS 由 electron-builder 根据 PNG 生成。
