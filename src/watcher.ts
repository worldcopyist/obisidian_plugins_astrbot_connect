/**
 * Vault 文件变更监听器 — 200ms 防抖 + 广播 file_changed 事件。
 */

import { TFile, Plugin } from 'obsidian';
import type { AstrbotConnectSettings } from './settings';
import { isIndexable, sha256 } from './utils';
import { buildEvent, ProtocolMessage } from './ws/protocol';

export class VaultWatcher {
    private plugin: Plugin;
    private settings: AstrbotConnectSettings;
    private broadcastFn: ((msg: ProtocolMessage) => void) | null = null;

    /** 防抖定时器映射: `${path}:${changeType}` → Timer */
    private debounceTimers: Map<string, NodeJS.Timeout> = new Map();

    /** 防抖延迟 (ms) */
    private readonly DEBOUNCE_MS = 200;

    constructor(plugin: Plugin, settings: AstrbotConnectSettings) {
        this.plugin = plugin;
        this.settings = settings;
    }

    /**
     * 设置广播函数（由 main.ts 在连接建立后注入）。
     */
    setBroadcastFn(fn: (msg: ProtocolMessage) => void): void {
        this.broadcastFn = fn;
    }

    /**
     * 初始化文件变更监听。
     * 注册 create / modify / delete 事件。
     */
    init(): void {
        const handler = (file: TFile, changeType: string) => {
            this.onFileChange(file, changeType);
        };

        this.plugin.registerEvent(
            this.plugin.app.vault.on('create', (file) => {
                if (file instanceof TFile) handler(file, 'create');
            })
        );

        this.plugin.registerEvent(
            this.plugin.app.vault.on('modify', (file) => {
                if (file instanceof TFile) handler(file, 'modify');
            })
        );

        this.plugin.registerEvent(
            this.plugin.app.vault.on('delete', (file) => {
                if (file instanceof TFile) handler(file, 'delete');
            })
        );

        console.log('VaultWatcher: initialized');
    }

    /**
     * 清理所有防抖定时器。
     */
    destroy(): void {
        for (const [key, timer] of this.debounceTimers) {
            clearTimeout(timer);
        }
        this.debounceTimers.clear();
        console.log('VaultWatcher: destroyed');
    }

    // ── 内部方法 ──────────────────────────────

    /** 文件变更事件防抖处理 */
    private onFileChange(file: TFile, changeType: string): void {
        if (!isIndexable(file, this.settings)) {
            return;
        }

        const key = `${file.path}:${changeType}`;
        const existing = this.debounceTimers.get(key);
        if (existing) {
            clearTimeout(existing);
        }

        this.debounceTimers.set(
            key,
            setTimeout(async () => {
                this.debounceTimers.delete(key);
                await this.pushChangeEvent(file, changeType);
            }, this.DEBOUNCE_MS)
        );
    }

    /** 构建并推送 file_changed 事件 */
    private async pushChangeEvent(file: TFile, changeType: string): Promise<void> {
        if (!this.broadcastFn) {
            return;
        }

        const payload: Record<string, any> = {
            path: file.path,
            change_type: changeType,
            mtime: file.stat.mtime,
        };

        // 非删除事件时附带内容和 hash
        if (changeType !== 'delete') {
            try {
                const content = await this.plugin.app.vault.read(file);
                payload.content = content;
                payload.hash = sha256(content);
            } catch (e) {
                console.error(`VaultWatcher: failed to read ${file.path}:`, e);
                return;
            }
        }

        const event = buildEvent('file_changed', payload);
        this.broadcastFn(event);
        console.log(`VaultWatcher: pushed file_changed [${changeType}] ${file.path}`);
    }
}
