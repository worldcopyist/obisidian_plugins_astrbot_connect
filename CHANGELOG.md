## 更新日志

### v2.0.1 (2026-07-22)
- 修复: 移除 Node.js ws 库，改用浏览器原生 WebSocket API（解决 Obsidian Electron 沙箱兼容性）
- 修复: sha256 改用 Web Crypto API（async），移除 crypto Node.js 模块依赖
- 修复: protocol.ts 移除 ws/crypto 依赖，使用 TextEncoder/Uint8Array 实现 timing-safe 比较
- 修复: 更新 README 反映 v2.0 WS 客户端架构

### v2.0.0 (2026-07-22)
- 重大变更: WS Client 模式 — Obsidian 主动连接 AstrBot
- 删除: ws/server.ts, ws/relay-client.ts
- 新增: ws/client.ts
