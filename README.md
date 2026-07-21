# Obsidian AstrBot Connect

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**连接 Obsidian vault 到 AstrBot 聊天机器人。** 提供 WebSocket 服务端，支持笔记搜索、CRUD 操作、全量/增量同步和实时变更推送。

## 功能

- 🔌 **WebSocket Server** — 在 Obsidian 中启动 WS 服务，AstrBot 直连通信
- 🔍 **本地搜索** — vault 全文关键词搜索，返回匹配笔记及相关性评分
- 📝 **文件操作** — 支持远程读取、创建、更新、删除笔记
- 🔄 **同步协议** — 全量分批同步 + 增量同步 + 一致性校验
- 📡 **实时推送** — 文件变更自动推送到已连接的 AstrBot
- 🔗 **双模连接** — 本地 Server 模式 + 中继穿透模式
- 🔒 **Token 认证** — 预共享密钥，timing-safe 比较

## 安装

### 方式一：Obsidian 社区插件市场（推荐）

1. 打开 Obsidian → 设置 → 第三方插件 → 浏览
2. 搜索 "AstrBot Connect"
3. 安装并启用

### 方式二：手动安装

```bash
# 进入你的 vault 插件目录
cd /path/to/your/vault/.obsidian/plugins/

# 克隆仓库
git clone https://github.com/worldcopyist/obsidian-astrbot-connect.git

# 安装依赖 & 构建
cd obsidian-astrbot-connect
npm install
npm run build

# 返回 Obsidian → 设置 → 第三方插件 → 刷新 → 启用 AstrBot Connect
```

### 方式三：从 Release 下载

1. 前往 [Releases](https://github.com/worldcopyist/obsidian-astrbot-connect/releases)
2. 下载 `main.js`、`manifest.json`、`styles.css`
3. 放入 vault 的 `.obsidian/plugins/obsidian-astrbot-connect/` 目录

## 配置

### 1. 本地直连模式（默认）

```
AstrBot (云/本地) ──WebSocket──► Obsidian (本地, ws://127.0.0.1:27123)
```

1. 打开 Obsidian 设置 → AstrBot Connect
2. 连接模式：选择「本地 Server」
3. 监听地址：`127.0.0.1`（本机）或 `0.0.0.0`（局域网）
4. 端口：默认 `27123`
5. API Token：点击「生成随机」创建 Token，复制
6. 在 AstrBot 插件中填入相同的 Token

### 2. 中继穿透模式

```
AstrBot (云端) ──► 中继服务器 ◄── Obsidian (本地)
```

1. 部署中继服务器（参考下方中继协议说明）
2. 在 Obsidian 插件设置中切换到「中继客户端」模式
3. 填入中继服务器地址（如 `wss://relay.example.com/ws`）
4. AstrBot 端同样配置中继模式 + 相同的 channel Token

### 3. 知识库范围过滤

在设置面板中可配置：
- **包含文件夹**：仅索引指定文件夹的笔记
- **排除文件夹**：不索引某些文件夹（如 templates/、archive/）
- **包含标签**：仅索引包含特定标签的笔记

## 通信协议

完整的 WebSocket 协议规范见 [OBSIDIAN_PLUGIN_SPEC.md](https://github.com/worldcopyist/astrbot_plugin_obsidian_connect/blob/master/OBSIDIAN_PLUGIN_SPEC.md)（AstrBot 插件仓库）。

### 支持的操作

| Action | 说明 |
|--------|------|
| `auth` | Token 认证 |
| `search` | vault 全文搜索 |
| `read` | 读取笔记 |
| `write` | 创建/更新笔记 |
| `delete` | 删除笔记到垃圾桶 |
| `sync_full` | 全量分批同步 |
| `sync_since` | 增量同步 |
| `check_consistency` | 一致性校验 |
| `file_changed` | 实时变更推送 |

### 中继协议

客户端注册：
```json
{ "type": "register", "client_id": "obsidian-xxx", "channel": "xxx" }
```

消息转发：
```json
{ "type": "relay", "action": "forward", "to": "astrbot", "channel": "xxx", "message": { ... } }
```

## 开发

```bash
git clone https://github.com/worldcopyist/obsidian-astrbot-connect.git
cd obsidian-astrbot-connect
npm install
npm run dev  # watch 模式，自动重新构建
```

推荐使用 [Hot-Reload](https://github.com/pjeby/hot-reload) 插件加速开发迭代。

## 配套插件

此插件需配合 AstrBot 插件 [astrbot_plugin_obsidian_connect](https://github.com/worldcopyist/astrbot_plugin_obsidian_connect) 使用。

## 许可

MIT © 2026 worldcopyist
