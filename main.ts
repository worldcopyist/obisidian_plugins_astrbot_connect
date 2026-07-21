/**
 * Obsidian AstrBot Connect — 插件主入口。
 *
 * 提供 WebSocket Server（本地模式）或中继客户端（远程模式），
 * 暴露 vault 数据给 AstrBot 插件进行混合检索和实时同步。
 */

import { Plugin } from 'obsidian';
import {
    AstrbotConnectSettings,
    DEFAULT_SETTINGS,
    AstrbotConnectSettingTab,
} from './src/settings';
import { WsServer } from './src/ws/server';
import { RelayClient } from './src/ws/relay-client';
import { VaultWatcher } from './src/watcher';

export default class AstrbotConnectPlugin extends Plugin {
    settings!: AstrbotConnectSettings;
    private wsServer: WsServer | null = null;
    private relayClient: RelayClient | null = null;
    private watcher: VaultWatcher | null = null;

    async onload(): Promise<void> {
        console.log('AstrBot Connect: loading...');

        // 加载配置
        await this.loadSettings();
        this.addSettingTab(new AstrbotConnectSettingTab(this.app, this));

        // 初始化文件监听
        this.watcher = new VaultWatcher(this, this.settings);
        this.watcher.init();

        // 根据模式启动连接
        await this.startConnection();

        console.log('AstrBot Connect: loaded');
    }

    async onunload(): Promise<void> {
        console.log('AstrBot Connect: unloading...');

        // 清理 watcher
        if (this.watcher) {
            this.watcher.destroy();
            this.watcher = null;
        }

        // 断开连接
        await this.stopConnection();

        console.log('AstrBot Connect: unloaded');
    }

    /**
     * 加载配置（从 data.json），合并默认值。
     */
    async loadSettings(): Promise<void> {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    /**
     * 保存配置到 data.json。
     */
    async saveSettings(): Promise<void> {
        await this.saveData(this.settings);

        // 如果服务器正在运行且模式改变，需要重启连接
        const isRunning =
            (this.wsServer !== null) || (this.relayClient !== null);

        if (isRunning) {
            await this.stopConnection();
            await this.startConnection();
        }
    }

    // ── 内部方法 ──────────────────────────────

    /**
     * 根据 settings.mode 启动 Server 或 Relay 连接。
     */
    private async startConnection(): Promise<void> {
        if (this.settings.mode === 'relay' && this.settings.relayUrl) {
            // ── 中继模式 ──
            this.relayClient = new RelayClient(
                this.settings.relayUrl,
                this.app,
                this.settings
            );

            // 设置广播回调
            if (this.watcher) {
                this.watcher.setBroadcastFn((msg) => {
                    if (this.relayClient) {
                        this.relayClient.send(msg);
                    }
                });
            }

            const connected = await this.relayClient.connect();
            if (connected) {
                console.log('AstrBot Connect: relay mode active');
            } else {
                console.warn('AstrBot Connect: relay connection failed');
            }
        } else {
            // ── 本地 Server 模式 ──
            this.wsServer = new WsServer(
                this.settings.host || '127.0.0.1',
                this.settings.port || 27123,
                this.app,
                this.settings
            );

            // 设置广播回调
            if (this.watcher) {
                this.watcher.setBroadcastFn((msg) => {
                    if (this.wsServer) {
                        this.wsServer.broadcast(msg);
                    }
                });
            }

            try {
                await this.wsServer.start();
                console.log('AstrBot Connect: server mode active');
            } catch (e) {
                console.error('AstrBot Connect: failed to start server:', e);
            }
        }
    }

    /**
     * 停止当前连接（Server 或 Relay）。
     */
    private async stopConnection(): Promise<void> {
        if (this.wsServer) {
            await this.wsServer.stop();
            this.wsServer = null;
        }

        if (this.relayClient) {
            await this.relayClient.disconnect();
            this.relayClient = null;
        }
    }
}
