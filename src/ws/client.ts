/**
 * WebSocket 客户端 — 连接 AstrBot 服务端，发送认证和事件。
 *
 * Obsidian 作为客户端主动连接 AstrBot 的 WS Server，
 * 认证后处理 AstrBot 发来的请求（search/read/write/delete/sync）
 * 并推送 file_changed 事件。
 */

import { WebSocket } from 'ws';
import { App } from 'obsidian';
import type { AstrbotConnectSettings } from '../settings';
import {
    ProtocolMessage,
    parseMessage,
    buildResponse,
    buildEvent,
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
    private reconnectTimer: NodeJS.Timeout | null = null;
    private reconnectDelay = 5000;

    /** 广播回调 — main.ts 设置，用于 watcher 推送 file_changed */
    public onBroadcast: ((msg: ProtocolMessage) => void) | null = null;

    constructor(url: string, token: string, app: App, settings: AstrbotConnectSettings) {
        this.url = url;
        this.token = token;
        this.app = app;
        this.settings = settings;
    }

    /** 连接到 AstrBot WS Server 并认证。 */
    async connect(): Promise<boolean> {
        return new Promise((resolve) => {
            try {
                this.ws = new WebSocket(this.url);

                this.ws.on('open', () => {
                    this.connected = true;
                    // 发送认证
                    const vaultName = this.app.vault.getName();
                    const authMsg = {
                        id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2),
                        type: 'request',
                        action: 'auth',
                        payload: {
                            token: this.token,
                            vault_name: vaultName,
                        },
                        error: null,
                        timestamp: Math.floor(Date.now() / 1000),
                    };
                    this.ws!.send(JSON.stringify(authMsg));
                });

                this.ws.on('message', (data: Buffer) => {
                    this.handleMessage(data.toString('utf8'));
                });

                this.ws.on('close', (code: number) => {
                    console.log('WsClient: disconnected, code:', code);
                    this.connected = false;
                    this.authenticated = false;
                    this.scheduleReconnect();
                });

                this.ws.on('error', (error: Error) => {
                    console.error('WsClient: error:', error.message);
                    if (!this.connected) {
                        resolve(false);
                    }
                });
            } catch (e) {
                console.error('WsClient: failed to connect:', e);
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

    /** 发送 file_changed 事件到 AstrBot。 */
    sendEvent(msg: ProtocolMessage): void {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.authenticated) {
            return;
        }
        try {
            this.ws.send(stringifyMessage(msg));
        } catch (e) {
            console.error('WsClient: send error:', e);
        }
    }

    // ── 内部方法 ──────────────────────────────

    private handleMessage(raw: string): void {
        let msg: ProtocolMessage;
        try {
            msg = parseMessage(raw);
        } catch (e) {
            console.error('WsClient: parse error:', e);
            return;
        }

        // 处理认证响应
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

        // 处理 ping
        if (msg.type === 'request' && msg.action === 'ping') {
            const pong = buildResponse(msg.id, 'pong', {
                server_time: Math.floor(Date.now() / 1000),
            });
            this.ws?.send(stringifyMessage(pong));
            return;
        }

        // 仅处理来自 AstrBot 的 request（已认证后）
        if (msg.type !== 'request') return;

        this.routeRequest(msg);
    }

    private async routeRequest(msg: ProtocolMessage): Promise<void> {
        const send = (data: string) => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(data);
            }
        };

        // 虚拟 AuthenticatedWebSocket（客户端模式不需要 isAuthenticated 字段）
        const virtualWs: any = {
            isAuthenticated: true,
            send,
            close: () => {},
        };

        try {
            switch (msg.action) {
                case 'search':
                    await handleSearch(this.app, msg, virtualWs, this.settings);
                    break;
                case 'read':
                    await handleRead(this.app, msg, virtualWs);
                    break;
                case 'write':
                    await handleWrite(this.app, msg, virtualWs);
                    break;
                case 'delete':
                    await handleDelete(this.app, msg, virtualWs);
                    break;
                case 'sync_full':
                    await handleSyncFull(this.app, msg, virtualWs, this.settings);
                    break;
                case 'sync_since':
                    await handleSyncSince(this.app, msg, virtualWs, this.settings);
                    break;
                case 'check_consistency':
                    await handleCheckConsistency(this.app, msg, virtualWs, this.settings);
                    break;
                default:
                    send(stringifyMessage(buildResponse(msg.id, msg.action, {}, `Unknown action: ${msg.action}`)));
            }
        } catch (e) {
            console.error('WsClient: handler error:', e);
        }
    }

    private scheduleReconnect(): void {
        if (this.reconnectTimer) return;
        this.reconnectTimer = setTimeout(async () => {
            this.reconnectTimer = null;
            console.log('WsClient: reconnecting...');
            const ok = await this.connect();
            if (ok) {
                console.log('WsClient: reconnected');
            } else if (!this.connected) {
                this.scheduleReconnect();
            }
        }, this.reconnectDelay);
    }
}
