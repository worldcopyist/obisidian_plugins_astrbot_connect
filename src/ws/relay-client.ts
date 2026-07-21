/**
 * 中继客户端 — 远程穿透模式下替代 WsServer。
 *
 * 连接到中继服务器，通过 channel 配对与 AstrBot 通信。
 * 复用同一套 handler 处理业务逻辑。
 *
 * 中继协议:
 *   注册:   { type: "register", client_id: "...", channel: "..." }
 *   转发:   { type: "relay", action: "forward", to: "obsidian"|"astrbot", channel: "...", message: <标准协议消息> }
 */

import { WebSocket } from 'ws';
import { App } from 'obsidian';
import type { AstrbotConnectSettings } from '../settings';
import {
    AuthenticatedWebSocket,
    ProtocolMessage,
    parseMessage,
    buildResponse,
    stringifyMessage,
    verifyToken,
} from './protocol';
import { handleAuth } from '../handlers/auth';
import { handleSearch } from '../handlers/search';
import { handleRead, handleWrite, handleDelete } from '../handlers/files';
import {
    handleSyncFull,
    handleSyncSince,
    handleCheckConsistency,
} from '../handlers/sync';

export class RelayClient {
    private relayUrl: string;
    private app: App;
    private settings: AstrbotConnectSettings;
    private ws: WebSocket | null = null;
    private connected = false;
    private authenticated = false;
    private reconnectTimer: NodeJS.Timeout | null = null;
    private channel: string;

    /** 广播回调 — main.ts 设置，用于 watcher 推送 */
    public onBroadcast: ((msg: ProtocolMessage) => void) | null = null;

    constructor(relayUrl: string, app: App, settings: AstrbotConnectSettings) {
        this.relayUrl = relayUrl;
        this.app = app;
        this.settings = settings;
        // channel 从 apiToken 派生前 8 位 hex
        this.channel = this.deriveChannel(settings.apiToken);
    }

    /**
     * 连接到中继服务器。
     */
    async connect(): Promise<boolean> {
        return new Promise((resolve) => {
            try {
                this.ws = new WebSocket(this.relayUrl);

                this.ws.on('open', () => {
                    console.log('RelayClient: connected to', this.relayUrl);
                    this.connected = true;

                    // 发送注册消息
                    const registerMsg = {
                        type: 'register',
                        client_id: 'obsidian-' + this.channel,
                        channel: this.channel,
                    };
                    this.ws!.send(JSON.stringify(registerMsg));
                    resolve(true);
                });

                this.ws.on('message', (data: Buffer) => {
                    this.handleRelayMessage(data.toString('utf8'));
                });

                this.ws.on('close', (code: number) => {
                    console.log('RelayClient: disconnected, code:', code);
                    this.connected = false;
                    this.authenticated = false;
                    this.scheduleReconnect();
                });

                this.ws.on('error', (error: Error) => {
                    console.error('RelayClient: error:', error.message);
                    if (!this.connected) {
                        resolve(false);
                    }
                });
            } catch (e) {
                console.error('RelayClient: failed to connect:', e);
                resolve(false);
            }
        });
    }

    /**
     * 断开中继连接。
     */
    async disconnect(): Promise<void> {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        this.connected = false;
        this.authenticated = false;

        if (this.ws) {
            this.ws.close(1000, 'Client disconnecting');
            this.ws = null;
        }

        console.log('RelayClient: disconnected');
    }

    /**
     * 是否已连接并认证。
     * 中继模式下认证是透明的（AstrBot 发来的 auth 消息通过 handler 处理），
     * 这里只要连接建立即可。
     */
    isReady(): boolean {
        return this.connected;
    }

    /**
     * 通过中继发送消息到 AstrBot。
     */
    send(msg: ProtocolMessage): void {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            return;
        }

        const relayMsg = {
            type: 'relay',
            action: 'forward',
            to: 'astrbot',
            channel: this.channel,
            message: msg,
        };

        try {
            this.ws.send(JSON.stringify(relayMsg));
        } catch (e) {
            console.error('RelayClient: send error:', e);
        }
    }

    // ── 内部方法 ──────────────────────────────

    /** 从 apiToken 派生 channel 标识 */
    private deriveChannel(token: string): string {
        if (!token) return 'default';
        // 简单取前 8 字符
        return token.replace(/[^a-zA-Z0-9]/g, '').substring(0, 8).toLowerCase() || 'default';
    }

    /** 处理来自中继的消息 */
    private async handleRelayMessage(raw: string): Promise<void> {
        let data: any;
        try {
            data = JSON.parse(raw);
        } catch {
            console.error('RelayClient: invalid JSON from relay');
            return;
        }

        // 检查是否为中继转发的消息
        if (data.type === 'relay' && data.message) {
            const msg = data.message as ProtocolMessage;

            // 路由到 handler（复用同一套逻辑）
            await this.routeMessage(msg);
        }
    }

    /** 路由消息（与 WsServer.handleMessage 相同逻辑） */
    private async routeMessage(msg: ProtocolMessage): Promise<void> {
        // 对 AUTH 特殊处理：标记为已认证
        if (msg.action === 'auth') {
            const token = msg.payload?.token || '';
            const expected = this.settings.apiToken;
            if (expected && token === expected) {
                this.authenticated = true;
            } else if (!expected) {
                this.authenticated = true;
            }
        }

        // 创建虚拟 WebSocket 用于 handler（中继模式下 handler 需要它来 send 响应）
        const virtualWs = {
            isAuthenticated: this.authenticated,
            send: (data: string) => {
                // 通过中继发回响应
                if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                    const relayMsg = {
                        type: 'relay',
                        action: 'forward',
                        to: 'astrbot',
                        channel: this.channel,
                        message: JSON.parse(data),
                    };
                    this.ws.send(JSON.stringify(relayMsg));
                }
            },
            close: () => {
                // no-op in relay mode
            },
        } as unknown as AuthenticatedWebSocket;

        try {
            switch (msg.action) {
                case 'auth':
                    handleAuth(virtualWs, msg, this.settings);
                    break;
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
                    await handleCheckConsistency(this.app, msg, virtualWs);
                    break;
                case 'ping':
                    virtualWs.send(
                        stringifyMessage(
                            buildResponse(msg.id, 'pong', {
                                server_time: Math.floor(Date.now() / 1000),
                            })
                        )
                    );
                    break;
                default:
                    virtualWs.send(
                        stringifyMessage(
                            buildResponse(msg.id, msg.action, {}, `Unknown action: ${msg.action}`)
                        )
                    );
            }
        } catch (e) {
            console.error('RelayClient: handler error:', e);
        }
    }

    /** 断线重连 */
    private scheduleReconnect(): void {
        if (this.reconnectTimer) return;

        this.reconnectTimer = setTimeout(async () => {
            this.reconnectTimer = null;
            console.log('RelayClient: attempting reconnect...');
            const success = await this.connect();
            if (!success) {
                this.scheduleReconnect();
            }
        }, 5000);
    }
}
