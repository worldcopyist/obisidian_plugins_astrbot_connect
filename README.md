# Obsidian AstrBot Connect

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**连接 Obsidian vault 到 AstrBot 聊天机器人。** Obsidian 作为 WebSocket 客户端连接 AstrBot 服务端，提供笔记搜索、CRUD 操作、全量/增量同步和实时变更推送。

## 架构

```
Obsidian (本地) ──WebSocket 客户端──► AstrBot (云服务器)
                                     监听 0.0.0.0:27123
```

Obsidian 主动连接 AstrBot，无需本地开放端口。

## 功能

- 🔌 **WebSocket 客户端** — Obsidian 主动连接 AstrBot，支持自动重连
- 🔍 **本地搜索** — vault 全文关键词搜索，返回匹配笔记及评分
- 📝 **文件操作** — 远程读取、创建、更新、删除笔记
- 🔄 **同步协议** — 全量分批同步 + 增量同步 + 一致性校验
- 📡 **实时推送** — 文件变更自动推送 `file_changed` 事件
- 🔒 **Token 认证** — 预共享密钥，timing-safe 比较

## 快速开始

### 1. 安装

```bash
# 进入 vault 插件目录
cd 你的Vault/.obsidian/plugins/

# 克隆仓库
git clone https://github.com/worldcopyist/obisidian_plugins_astrbot_connect.git
cd obisidian_plugins_astrbot_connect

# 构建
npm install
npm run build
```

然后 Obsidian → 设置 → 第三方插件 → 关闭安全模式 → 启用 AstrBot Connect。

### 2. 配置

打开 Obsidian → 设置 → AstrBot Connect：

| 设置 | 值 | 说明 |
|------|-----|------|
| AstrBot 地址 | `ws://<云服务器IP>:27123` | AstrBot 服务器的公网 IP 或域名 |
| API Token | 与 AstrBot 一致 | 两边必须完全相同 |

### 3. 验证

打开开发者工具 (Ctrl+Shift+I) → Console，看到 `authenticated with AstrBot` 即成功。

## 完整连接教程

详细的双端配置教程（含端口开放、Token 配置、排查步骤）见 [AstrBot 插件仓库的 CONNECTION_GUIDE.md](https://github.com/worldcopyist/astrbot_plugin_obsidian_connect/blob/master/CONNECTION_GUIDE.md)。

## 配套插件

此插件需配合 [astrbot_plugin_obsidian_connect](https://github.com/worldcopyist/astrbot_plugin_obsidian_connect) 使用。

## 开发

```bash
npm install
npm run dev  # watch 模式
```

## 许可证

MIT © 2026 worldcopyist
