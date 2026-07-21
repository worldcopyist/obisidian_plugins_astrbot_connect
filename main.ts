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
        const saved = await this.loadData();
        console.log('[obsidian-astrbot] loadData raw:', JSON.stringify(saved));
        this.settings = Object.assign({}, DEFAULT_SETTINGS, saved || {});
        console.log('[obsidian-astrbot] merged settings — url:', this.settings.astrbotUrl, 'token:', this.settings.apiToken ? '***' : 'EMPTY');
    }

    async saveSettings(): Promise<void> {
        console.log('[obsidian-astrbot] saveSettings called — saving:', JSON.stringify(this.settings));
        try {
            await this.saveData(this.settings);
            console.log('[obsidian-astrbot] saveData SUCCESS');
            // verify immediately
            const verify = await this.loadData();
            console.log('[obsidian-astrbot] verify after save:', JSON.stringify(verify));
        } catch (e) {
            console.error('[obsidian-astrbot] saveData FAILED:', e);
        }
    }

    /** 手动重连（供设置面板调用）。 */
    async reconnect(): Promise<void> {
        if (this.wsClient) await this.stopConnection();
        await this.startConnection();
    }

    // ── 内部方法 ──────────────────────────────

    private async startConnection(): Promise<void> {
        const url = this.settings.astrbotUrl || 'ws://127.0.0.1:27123';
        const token = this.settings.apiToken || '';

        console.log('[obsidian-astrbot] startConnection — url:', url, 'token:', token ? '***' : 'EMPTY');
        this.wsClient = new WsClient(url, token, this.app, this.settings);

        if (this.watcher) {
            this.watcher.setBroadcastFn((msg) => {
                if (this.wsClient) this.wsClient.send(msg);
            });
        }

        const connected = await this.wsClient.connect();
        if (connected) {
            console.log('[obsidian-astrbot] TCP connected, waiting for auth...');
        } else {
            console.warn('[obsidian-astrbot] connection failed, retrying in 10s...');
            setTimeout(() => this.startConnection(), 10000);
        }
    }

    private async stopConnection(): Promise<void> {
        if (this.wsClient) {
            await this.wsClient.disconnect();
            this.wsClient = null;
        }
    }
}
