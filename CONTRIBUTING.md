# 参与贡献

感谢帮助完善 Snapline。项目主要面向 Windows 10 / 11 x64，开发环境与启动方式见 [README](README.md)。

## 提交问题

请提供版本、Windows 版本、WebView2 版本、实际显示器分辨率与缩放、简短复现步骤、预期和实际结果。截图、拖放、快捷键问题要注明是在浏览器演示还是桌面版中发生。

优先使用生成的示例图片。提交截图、录屏或日志前，请移除个人内容、剪贴板信息、用户名路径、凭据与图库索引；不要上传整个用户数据目录。原生拖放问题注明来源和目标应用，无法实际复现的步骤请标为未验证。

## 修改范围

- 一次提交解决一个清楚的问题；行为变化同步更新相关使用说明。
- 保留用户已保存设置与图库数据。升级默认值不能无意覆盖已有个性化选择。
- 窗口代码要考虑异步回调、关闭后的旧会话、取消和错误恢复；不要为了界面效果扩大鼠标拦截范围。
- 只有状态、边界或行为契约发生变化时增加有意义的测试；纯视觉微调应配实际尺寸检查。
- 新增第三方代码或素材请记录来源、作者和许可证。项目的 MIT 代码许可不自动覆盖外部图片；现有素材边界见[角色素材说明](docs/OPTIONAL-ASSETS.md)。
- 不提交 `node_modules/`、构建产物、测试录屏、个人图库、密钥或机器专用配置。保留 `package-lock.json` 与 `src-tauri/Cargo.lock`。

## 提交前检查

在项目根目录运行：

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run build
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --manifest-path src-tauri/Cargo.toml --locked
cargo clippy --manifest-path src-tauri/Cargo.toml --locked -- -D warnings
```

窗口、截图、剪贴板、OLE 拖放及全局快捷键的变更还需按[原生测试清单](docs/TEST-PLAN.md)在 Windows 操作验证。浏览器预览和模拟测试不能代替原生结果；没有相应硬件时明确写出未覆盖项。

提交说明应包括问题、最终行为、检查结果和剩余限制。不要把同一批定向测试与全量测试累加成更大的测试数，也不要把历史版本的通过记录当作当前版本复测。维护者审核后再更新[验证记录](docs/VERIFICATION.md)。

## 图标和素材

原创标志由 `scripts/make-icons.py` 生成，需要 Python 与 Pillow。改动后检查 SVG、PNG、ICO 各尺寸和浅深背景，并保持界面与原生图标一致。

四套外部角色素材由维护者提供，原始作者和授权仍未核实；修改或再使用时需自行按适用许可处理。也支持移除对应文件后仅构建 8 款原创矢量角色，详见[素材规格与回退行为](docs/OPTIONAL-ASSETS.md)。

贡献应遵循项目 [LICENSE](LICENSE)，并保留[第三方声明](THIRD_PARTY_NOTICES.md)要求的通知。
