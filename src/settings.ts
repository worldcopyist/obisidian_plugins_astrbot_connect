/**
 * 插件设置 — SettingTab UI + 配置接口定义 + 数据持久化到 data.json。
 */

import { App, PluginSettingTab, Setting } from 'obsidian';
import type AstrbotConnectPlugin from '../main';

/** 插件配置接口 */
export interface AstrbotConnectSettings {
    /** 连接模式: 'server' = 本地 WebSocket Server, 'relay' = 中继客户端 */
    mode: 'server' | 'relay';
    /** 本地 Server 监听地址 */
    host: string;
    /** 本地 Server 监听端口 */
    port: number;
    /** 中继服务器 WebSocket 地址 */
    relayUrl: string;
    /** API Token — 与 AstrBot 插件中的一致 */
    apiToken: string;
    /** 是否启用 TLS */
    enableTls: boolean;
    /** TLS 证书文件路径 */
    tlsCertPath: string;
    /** TLS 私钥文件路径 */
    tlsKeyPath: string;
    /** 仅索引这些文件夹内的文件（空 = 全部） */
    includeFolders: string[];
    /** 排除这些文件夹 */
    excludeFolders: string[];
    /** 仅索引包含这些标签的文件（空 = 全部） */
    includeTags: string[];
}

/** 默认配置 */
export const DEFAULT_SETTINGS: AstrbotConnectSettings = {
    mode: 'server',
    host: '127.0.0.1',
    port: 27123,
    relayUrl: '',
    apiToken: '',
    enableTls: false,
    tlsCertPath: '',
    tlsKeyPath: '',
    includeFolders: [],
    excludeFolders: [],
    includeTags: [],
};

/**
 * 设置面板 — 使用 Obsidian PluginSettingTab 原生控件。
 * 配置通过 `plugin.settings` 读写，Obsidian 自动管理 data.json 持久化。
 */
export class AstrbotConnectSettingTab extends PluginSettingTab {
    plugin: any;

    constructor(app: App, plugin: AstrbotConnectPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        // ═══ 连接模式 ═══
        containerEl.createEl('h2', { text: '连接模式' });

        new Setting(containerEl)
            .setName('连接模式')
            .setDesc('本地 Server: 插件在本地监听 WebSocket 端口，AstrBot 直连。中继客户端: 连接到中继服务器，适合云端 AstrBot + 本地 Obsidian 场景。')
            .addDropdown((dropdown) =>
                dropdown
                    .addOption('server', '本地 Server')
                    .addOption('relay', '中继客户端')
                    .setValue(this.plugin.settings.mode)
                    .onChange(async (value) => {
                        this.plugin.settings.mode = value as 'server' | 'relay';
                        await this.plugin.saveSettings();
                        this.display(); // 刷新面板
                    })
            );

        // ═══ 本地 Server 设置 ═══
        if (this.plugin.settings.mode === 'server') {
            containerEl.createEl('h3', { text: '本地 Server 设置' });

            new Setting(containerEl)
                .setName('监听地址')
                .setDesc('通常 127.0.0.1（仅本机）或 0.0.0.0（允许局域网连接）')
                .addText((text) =>
                    text
                        .setPlaceholder('127.0.0.1')
                        .setValue(this.plugin.settings.host)
                        .onChange(async (value) => {
                            this.plugin.settings.host = value || '127.0.0.1';
                            await this.plugin.saveSettings();
                        })
                );

            new Setting(containerEl)
                .setName('监听端口')
                .setDesc('默认 27123')
                .addText((text) =>
                    text
                        .setPlaceholder('27123')
                        .setValue(String(this.plugin.settings.port))
                        .onChange(async (value) => {
                            const num = parseInt(value, 10);
                            this.plugin.settings.port = isNaN(num) ? 27123 : num;
                            await this.plugin.saveSettings();
                        })
                );

            new Setting(containerEl)
                .setName('启用 TLS')
                .setDesc('需要配置 SSL 证书和私钥路径')
                .addToggle((toggle) =>
                    toggle
                        .setValue(this.plugin.settings.enableTls)
                        .onChange(async (value) => {
                            this.plugin.settings.enableTls = value;
                            await this.plugin.saveSettings();
                            this.display();
                        })
                );

            if (this.plugin.settings.enableTls) {
                new Setting(containerEl)
                    .setName('TLS 证书路径 (.crt)')
                    .setDesc('文件系统中的绝对路径')
                    .addText((text) =>
                        text
                            .setPlaceholder('/path/to/cert.crt')
                            .setValue(this.plugin.settings.tlsCertPath)
                            .onChange(async (value) => {
                                this.plugin.settings.tlsCertPath = value;
                                await this.plugin.saveSettings();
                            })
                    );

                new Setting(containerEl)
                    .setName('TLS 私钥路径 (.key)')
                    .setDesc('文件系统中的绝对路径')
                    .addText((text) =>
                        text
                            .setPlaceholder('/path/to/key.key')
                            .setValue(this.plugin.settings.tlsKeyPath)
                            .onChange(async (value) => {
                                this.plugin.settings.tlsKeyPath = value;
                                await this.plugin.saveSettings();
                            })
                    );
            }
        }

        // ═══ 中继设置 ═══
        if (this.plugin.settings.mode === 'relay') {
            containerEl.createEl('h3', { text: '中继客户端设置' });

            new Setting(containerEl)
                .setName('中继服务器地址')
                .setDesc('WebSocket 地址，例如 wss://relay.example.com/ws')
                .addText((text) =>
                    text
                        .setPlaceholder('wss://relay.example.com/ws')
                        .setValue(this.plugin.settings.relayUrl)
                        .onChange(async (value) => {
                            this.plugin.settings.relayUrl = value;
                            await this.plugin.saveSettings();
                        })
                );
        }

        // ═══ 认证 ═══
        containerEl.createEl('h2', { text: '认证' });

        new Setting(containerEl)
            .setName('API Token')
            .setDesc('与 AstrBot 插件中的 Token 保持一致。留空则自动使用随机生成的 token。')
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
            .setDesc('点击生成一个随机的 UUID v4 作为 Token')
            .addButton((button) =>
                button.setButtonText('🎲 生成').onClick(async () => {
                    this.plugin.settings.apiToken = crypto.randomUUID();
                    await this.plugin.saveSettings();
                    this.display();
                })
            );

        // ═══ 知识库范围 ═══
        containerEl.createEl('h2', { text: '知识库范围' });

        new Setting(containerEl)
            .setName('包含文件夹')
            .setDesc('仅索引这些文件夹内的笔记。每行一个文件夹路径。留空 = 索引全部。')
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
            .setDesc('不索引这些文件夹内的笔记。每行一个。')
            .addTextArea((text) =>
                text
                    .setPlaceholder('templates/\narchive/\n.obsidian/')
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
            .setDesc('仅索引包含这些标签的笔记。每行一个标签（不含 #）。留空 = 不限标签。')
            .addTextArea((text) =>
                text
                    .setPlaceholder('ai\nml\nproject')
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
