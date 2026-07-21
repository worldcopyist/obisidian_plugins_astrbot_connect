/**
 * Obsidian AstrBot Connect — 插件主入口。
 *
 * 作为 WebSocket 客户端连接 AstrBot 服务端，
 * 暴露 vault 数据用于混合检索和实时同步。
 */

import { Plugin } from 'obsidian';
import {
    AstrbotConnectSettings,
    DEFAULT_SETTINGS,
    AstrbotConnectSettingTab,
} from './src/settings';
import { WsClient } from './src/ws/client';
import { VaultWatcher } from './src/watcher';

export default class AstrbotConnectPlugin extends Plugin {
    settings!: AstrbotConnectSettings;
    private wsClient: WsClient | null = null;
    private watcher: VaultWatcher | null = null;

    async onload(): Promise<void> {
        console.log('AstrBot Connect: loading...');

        await this.loadSettings();
        this.addSettingTab(new AstrbotConnectSettingTab(this.app, this));

        // 初始化文件监听
        this.watcher = new VaultWatcher(this, this.settings);
        this.watcher.init();

        // 连接 AstrBot
        await this.startConnection();

        console.log('AstrBot Connect: loaded');
    }

    async onunload(): Promise<void> {
        console.log('AstrBot Connect: unloading...');

        if (this.watcher) {
            this.watcher.destroy();
            this.watcher = null;
        }

        await this.stopConnection();

        console.log('AstrBot Connect: unloaded');
    }

    async loadSettings(): Promise<void> {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings(): Promise<void> {
        await this.saveData(this.settings);

        if (this.wsClient) {
            await this.stopConnection();
            await this.startConnection();
        }
    }

    // ── 内部方法 ──────────────────────────────

    private async startConnection(): Promise<void> {
        const url = this.settings.astrbotUrl || 'ws://127.0.0.1:27123';
        const token = this.settings.apiToken || '';

        this.wsClient = new WsClient(url, token, this.app, this.settings);

        // 设置广播回调：文件变更推送到 AstrBot
        if (this.watcher) {
            this.watcher.setBroadcastFn((msg) => {
                if (this.wsClient) {
                    this.wsClient.sendEvent(msg);
                }
            });
        }

        const connected = await this.wsClient.connect();
        if (connected) {
            console.log('AstrBot Connect: client mode active, connecting to', url);
        } else {
            console.warn('AstrBot Connect: initial connection failed');
        }
    }

    private async stopConnection(): Promise<void> {
        if (this.wsClient) {
            await this.wsClient.disconnect();
            this.wsClient = null;
        }
    }
}
