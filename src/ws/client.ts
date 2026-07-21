/**
 * WebSocket 客户端 — 连接 AstrBot 服务端，发送认证和事件。
 *
 * 使用浏览器原生 WebSocket API（非 Node.js ws 包），兼容 Obsidian Electron 环境。
 * Obsidian 作为客户端主动连接 AstrBot 的 WS Server。
 */

import { App } from 'obsidian';
import type { AstrbotConnectSettings } from '../settings';
import {
    parseMessage,
    buildResponse,
    stringifyMessage,
} from './protocol';
import { handleSearch } from '../handlers/search';
import { handleRead, handleWrite, handleDelete } from '../handlers/files';
import {
    handleSyncFull,
    handleSyncSince,
    handleCheckConsistency,
} from '../handlers/sync';

export class WsClient {
    private url: string;
    private token: string;
    private app: App;
    private settings: AstrbotConnectSettings;
    private ws: WebSocket | null = null;
    private connected = false;
    private authenticated = false;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private reconnectDelay = 5000;

    constructor(url: string, token: string, app: App, settings: AstrbotConnectSettings) {
        this.url = url;
        this.token = token;
        this.app = app;
        this.settings = settings;
    }

    /** 连接并认证。返回 true 表示 TCP 连接已建立（认证异步完成）。 */
    async connect(): Promise<boolean> {
        return new Promise((resolve) => {
            try {
                console.log('[obsidian-astrbot] connecting to', this.url, 'token:', this.token ? 'set' : 'empty');
                this.ws = new WebSocket(this.url);

                this.ws.onopen = () => {
                    console.log('[obsidian-astrbot] TCP connected, sending auth...');
                    this.connected = true;
                    const vaultName = this.app.vault.getName();
                    const authMsg = {
                        id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2),
                        type: 'request',
                        action: 'auth',
                        payload: { token: this.token, vault_name: vaultName },
                        error: null,
                        timestamp: Math.floor(Date.now() / 1000),
                    };
                    console.log('[obsidian-astrbot] auth payload:', JSON.stringify(authMsg));
                    this.ws!.send(JSON.stringify(authMsg));
                    resolve(true);
                };

                this.ws.onmessage = (event: MessageEvent) => {
                    const raw = typeof event.data === 'string' ? event.data : '';
                    console.log('[obsidian-astrbot] received:', raw.substring(0, 200));
                    if (raw) this.handleMessage(raw);
                };

                this.ws.onclose = (event: CloseEvent) => {
                    console.log('[obsidian-astrbot] CLOSE code:', event.code, 'reason:', event.reason, 'wasClean:', event.wasClean);
                    this.connected = false;
                    this.authenticated = false;
                    this.ws = null;
                };

                this.ws.onerror = (ev: Event) => {
                    console.error('[obsidian-astrbot] ERROR — readyState:', this.ws?.readyState, 'url:', this.url);
                    if (!this.connected) resolve(false);
                };
            } catch (e) {
                console.error('[obsidian-astrbot] failed to create WebSocket:', e);
                resolve(false);
            }
        });
    }

    /** 断开连接。 */
    async disconnect(): Promise<void> {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        this.connected = false;
        this.authenticated = false;
        if (this.ws) {
            this.ws.close(1000, 'Plugin unloading');
            this.ws = null;
        }
    }

    /** 是否已连接并认证。 */
    get isReady(): boolean {
        return this.connected && this.authenticated;
    }

    /** 发送消息到 AstrBot（接受对象或字符串）。 */
    send(data: any): void {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.authenticated) return;
        try {
            const payload = typeof data === 'string' ? data : stringifyMessage(data);
            this.ws.send(payload);
        } catch (e) { console.error('WsClient: send error:', e); }
    }

    // ── 内部 ────────────────────────────────────────

    private handleMessage(raw: string): void {
        let msg: any;
        try { msg = parseMessage(raw); } catch (e) { return; }

        // 认证响应
        if (msg.type === 'response' && msg.action === 'auth') {
            if (msg.payload?.ok) {
                this.authenticated = true;
                console.log('WsClient: authenticated with AstrBot');
            } else {
                console.error('WsClient: auth failed:', msg.error);
                this.ws?.close(4001, 'Auth failed');
            }
            return;
        }

        // ping
        if (msg.type === 'request' && msg.action === 'ping') {
            this.ws?.send(stringifyMessage(buildResponse(msg.id, 'pong', { server_time: Math.floor(Date.now() / 1000) })));
            return;
        }

        if (msg.type !== 'request') return;
        this.routeRequest(msg);
    }

    private async routeRequest(msg: any): Promise<void> {
        const send = (data: string) => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(data);
        };
        const virtualWs: any = { isAuthenticated: true, send, close: () => {} };

        try {
            switch (msg.action) {
                case 'search': await handleSearch(this.app, msg, virtualWs, this.settings); break;
                case 'read': await handleRead(this.app, msg, virtualWs); break;
                case 'write': await handleWrite(this.app, msg, virtualWs); break;
                case 'delete': await handleDelete(this.app, msg, virtualWs); break;
                case 'sync_full': await handleSyncFull(this.app, msg, virtualWs, this.settings); break;
                case 'sync_since': await handleSyncSince(this.app, msg, virtualWs, this.settings); break;
                case 'check_consistency': await handleCheckConsistency(this.app, msg, virtualWs, this.settings); break;
                default: send(stringifyMessage(buildResponse(msg.id, msg.action, {}, 'Unknown action')));
            }
        } catch (e) { console.error('WsClient: handler error:', e); }
    }

    private scheduleReconnect(): void {
        if (this.reconnectTimer) return;
        this.reconnectTimer = setTimeout(async () => {
            this.reconnectTimer = null;
            console.log('WsClient: reconnecting...');
            const ok = await this.connect();
            if (!ok && !this.connected) this.scheduleReconnect();
        }, this.reconnectDelay);
    }
}
