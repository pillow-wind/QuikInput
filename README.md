# 角色名快捷输入（QuikInput）

一个绑定 SillyTavern 角色卡的快捷输入扩展。切换角色卡时，当前角色的按钮会同步到同一个官方 Quick Reply Set。

## 功能

- 每张角色卡保存独立按钮列表
- 所有按钮通过“角色名快捷输入（QuikInput）”QR 包统一显示
- 切换角色卡时自动更新该 QR 包的按钮
- 点击按钮固定在输入框光标处插入内容
- 使用酒馆风格的拖拽手柄调整按钮顺序
- 配置写入角色卡 `data.extensions.quikinput`，可随角色卡导出

## 安装

1. 打开 SillyTavern 的“扩展”。
2. 选择“安装扩展”，粘贴本仓库链接。
3. 安装完成后刷新页面。

```text
https://github.com/pillow-wind/QuikInput.git
```

## 使用

1. 确保酒馆内置 Quick Reply 扩展已启用。
2. 打开扩展面板中的“角色名快捷输入”。
3. 选择角色并添加按钮。
4. 在 Quick Reply 管理器中启用“角色名快捷输入（QuikInput）”包。
5. 切换角色卡后，该 QR 包会自动显示对应角色的按钮。

当前版本仅处理单角色聊天，群聊中不显示角色按钮。
