/**
 * 插件设置 — SettingTab UI + 配置接口定义 + 数据持久化到 data.json。
 */

import { App, PluginSettingTab, Setting } from 'obsidian';
import type AstrbotConnectPlugin from '../main';

/** 插件配置接口 */
export interface AstrbotConnectSettings {
    /** AstrBot WebSocket Server 地址 (ws://host:port) */
    astrbotUrl: string;
    /** API Token — 与 AstrBot 插件中的一致 */
    apiToken: string;
    /** 仅索引这些文件夹内的文件（空 = 全部） */
    includeFolders: string[];
    /** 排除这些文件夹 */
    excludeFolders: string[];
    /** 仅索引包含这些标签的文件（空 = 全部） */
    includeTags: string[];
}

/** 默认配置 */
export const DEFAULT_SETTINGS: AstrbotConnectSettings = {
    astrbotUrl: 'ws://127.0.0.1:27123',
    apiToken: '',
    includeFolders: [],
    excludeFolders: [],
    includeTags: [],
};

/**
 * 设置面板 — 使用 Obsidian PluginSettingTab 原生控件。
 */
export class AstrbotConnectSettingTab extends PluginSettingTab {
    plugin: AstrbotConnectPlugin;

    constructor(app: App, plugin: AstrbotConnectPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        // ═══ 连接设置 ═══
        containerEl.createEl('h2', { text: 'AstrBot 连接' });

        new Setting(containerEl)
            .setName('AstrBot 地址')
            .setDesc('AstrBot WS Server 地址。云服务器请使用公网 IP 或域名，如 ws://your-server.com:27123')
            .addText((text) =>
                text
                    .setPlaceholder('ws://127.0.0.1:27123')
                    .setValue(this.plugin.settings.astrbotUrl)
                    .onChange(async (value) => {
                        this.plugin.settings.astrbotUrl = value || 'ws://127.0.0.1:27123';
                        await this.plugin.saveSettings();
                    })
            );

        // ═══ 认证 ═══
        containerEl.createEl('h2', { text: '认证' });

        new Setting(containerEl)
            .setName('API Token')
            .setDesc('与 AstrBot 插件中的 Token 保持一致。')
            .addText((text) =>
                text
                    .setPlaceholder('点击下方按钮生成随机 Token')
                    .setValue(this.plugin.settings.apiToken)
                    .onChange(async (value) => {
                        this.plugin.settings.apiToken = value;
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName('生成随机 Token')
            .setDesc('点击生成一个随机的 Token')
            .addButton((button) =>
                button.setButtonText('生成').onClick(async () => {
                    this.plugin.settings.apiToken = crypto.randomUUID();
                    await this.plugin.saveSettings();
                    this.display();
                })
            );

        // ═══ 知识库范围 ═══
        containerEl.createEl('h2', { text: '知识库范围' });

        new Setting(containerEl)
            .setName('包含文件夹')
            .setDesc('仅索引这些文件夹内的笔记。每行一个。留空 = 全部。')
            .addTextArea((text) =>
                text
                    .setPlaceholder('notes/\ndaily/')
                    .setValue(this.plugin.settings.includeFolders.join('\n'))
                    .onChange(async (value) => {
                        this.plugin.settings.includeFolders = value
                            .split('\n')
                            .map((s) => s.trim())
                            .filter((s) => s.length > 0);
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName('排除文件夹')
            .setDesc('不索引这些文件夹。每行一个。')
            .addTextArea((text) =>
                text
                    .setPlaceholder('templates/\narchive/')
                    .setValue(this.plugin.settings.excludeFolders.join('\n'))
                    .onChange(async (value) => {
                        this.plugin.settings.excludeFolders = value
                            .split('\n')
                            .map((s) => s.trim())
                            .filter((s) => s.length > 0);
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName('包含标签')
            .setDesc('仅索引包含这些标签的笔记。每行一个（不含 #）。留空 = 全部。')
            .addTextArea((text) =>
                text
                    .setPlaceholder('ai\nproject')
                    .setValue(this.plugin.settings.includeTags.join('\n'))
                    .onChange(async (value) => {
                        this.plugin.settings.includeTags = value
                            .split('\n')
                            .map((s) => s.trim())
                            .filter((s) => s.length > 0);
                        await this.plugin.saveSettings();
                    })
            );
    }
}
