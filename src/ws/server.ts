/**
 * WebSocket Server — 创建 ws.Server 监听连接，路由消息到 handler。
 *
 * 管理连接池和认证状态，支持广播 file_changed 事件到所有已认证客户端。
 * 支持可选 TLS（通过传入 https server）。
 */

import { WebSocketServer, WebSocket } from 'ws';
import { App } from 'obsidian';
import * as http from 'http';
import * as https from 'https';
import * as fs from 'fs';
import type { AstrbotConnectSettings } from '../settings';
import {
    AuthenticatedWebSocket,
    ProtocolMessage,
    parseMessage,
    buildResponse,
    stringifyMessage,
} from './protocol';
import { handleAuth } from '../handlers/auth';
import { handleSearch } from '../handlers/search';
import { handleRead, handleWrite, handleDelete } from '../handlers/files';
import {
    handleSyncFull,
    handleSyncSince,
    handleCheckConsistency,
} from '../handlers/sync';

export class WsServer {
    private host: string;
    private port: number;
    private app: App;
    private settings: AstrbotConnectSettings;
    private wss: WebSocketServer | null = null;
    private httpServer: http.Server | https.Server | null = null;

    /** 已认证的客户端列表 */
    private clients: Set<AuthenticatedWebSocket> = new Set();


    constructor(
        host: string,
        port: number,
        app: App,
        settings: AstrbotConnectSettings
    ) {
        this.host = host;
        this.port = port;
        this.app = app;
        this.settings = settings;
    }

    /**
     * 启动 WebSocket Server。
     * 如果配置了 TLS，创建 HTTPS server；否则使用普通 HTTP server upgrade。
     */
    async start(): Promise<void> {
        return new Promise((resolve, reject) => {
            // 确定使用 HTTP 还是 HTTPS
            if (this.settings.enableTls && this.settings.tlsCertPath && this.settings.tlsKeyPath) {
                try {
                    const cert = fs.readFileSync(this.settings.tlsCertPath);
                    const key = fs.readFileSync(this.settings.tlsKeyPath);
                    this.httpServer = https.createServer({ cert, key });
                } catch (e) {
                    console.error('WsServer: failed to load TLS cert/key:', e);
                }
            }

            if (!this.httpServer) {
                this.httpServer = http.createServer();
            }

            this.wss = new WebSocketServer({ server: this.httpServer });

            this.wss.on('connection', (ws: WebSocket) => {
                this.handleConnection(ws as AuthenticatedWebSocket);
            });

            this.wss.on('error', (error: Error) => {
                console.error('WsServer error:', error);
            });

            this.httpServer.listen(this.port, this.host, () => {
                console.log(`WsServer listening on ${this.host}:${this.port}`);
                resolve();
            });

            this.httpServer.on('error', (error: Error) => {
                console.error('WsServer failed to start:', error);
                reject(error);
            });
        });
    }

    /**
     * 停止 WebSocket Server，关闭所有连接。
     */
    async stop(): Promise<void> {
        // 关闭所有客户端连接
        for (const client of this.clients) {
            try {
                client.close(1000, 'Server shutting down');
            } catch {
                // ignore
            }
        }
        this.clients.clear();

        // 关闭 WSS
        if (this.wss) {
            await new Promise<void>((resolve) => {
                this.wss!.close(() => resolve());
            });
            this.wss = null;
        }

        // 关闭 HTTP server
        if (this.httpServer) {
            await new Promise<void>((resolve) => {
                this.httpServer!.close(() => resolve());
            });
            this.httpServer = null;
        }

        console.log('WsServer stopped');
    }

    /**
     * 广播消息到所有已认证客户端。
     */
    broadcast(msg: ProtocolMessage): void {
        const data = stringifyMessage(msg);
        for (const client of this.clients) {
            if (client.readyState === WebSocket.OPEN && client.isAuthenticated) {
                try {
                    client.send(data);
                } catch (e) {
                    console.error('WsServer: broadcast error:', e);
                }
            }
        }
    }

    /**
     * 获取已认证客户端数量。
     */
    getAuthenticatedCount(): number {
        let count = 0;
        for (const client of this.clients) {
            if (client.isAuthenticated) count++;
        }
        return count;
    }

    // ── 内部方法 ──────────────────────────────

    /** 处理新连接 */
    private handleConnection(ws: AuthenticatedWebSocket): void {
        ws.isAuthenticated = false;
        this.clients.add(ws);
        console.log('WsServer: new connection');

        ws.on('message', (data: Buffer) => {
            this.handleMessage(ws, data.toString('utf8'));
        });

        ws.on('close', () => {
            this.clients.delete(ws);
            console.log('WsServer: connection closed');
        });

        ws.on('error', (error: Error) => {
            console.error('WsServer: client error:', error.message);
            this.clients.delete(ws);
        });
    }

    /** 路由消息到对应 handler */
    private async handleMessage(ws: AuthenticatedWebSocket, raw: string): Promise<void> {
        let msg: ProtocolMessage;
        try {
            msg = parseMessage(raw);
        } catch (e) {
            const errorResp = buildResponse('', '', {}, `Parse error: ${(e as Error).message}`);
            ws.send(stringifyMessage(errorResp));
            return;
        }

        // 非 auth 请求需要认证
        if (msg.type === 'request' && msg.action !== 'auth' && !ws.isAuthenticated) {
            const errorResp = buildResponse(msg.id, msg.action, {}, 'Unauthorized');
            ws.send(stringifyMessage(errorResp));
            return;
        }

        // 路由
        try {
            switch (msg.action) {
                case 'auth':
                    handleAuth(ws, msg, this.settings);
                    break;

                case 'search':
                    await handleSearch(this.app, msg, ws, this.settings);
                    break;

                case 'read':
                    await handleRead(this.app, msg, ws);
                    break;

                case 'write':
                    await handleWrite(this.app, msg, ws);
                    break;

                case 'delete':
                    await handleDelete(this.app, msg, ws);
                    break;

                case 'sync_full':
                    await handleSyncFull(this.app, msg, ws, this.settings);
                    break;

                case 'sync_since':
                    await handleSyncSince(this.app, msg, ws, this.settings);
                    break;

                case 'check_consistency':
                    await handleCheckConsistency(this.app, msg, ws, this.settings);
                    break;

                case 'ping':
                    this.handlePing(ws, msg);
                    break;

                default:
                    const unknownResp = buildResponse(
                        msg.id,
                        msg.action,
                        {},
                        `Unknown action: ${msg.action}`
                    );
                    ws.send(stringifyMessage(unknownResp));
            }
        } catch (e) {
            console.error('WsServer: handler error:', e);
            const errorResp = buildResponse(
                msg.id,
                msg.action,
                {},
                `Handler error: ${(e as Error).message}`
            );
            try {
                ws.send(stringifyMessage(errorResp));
            } catch {
                // connection might be closed
            }
        }
    }

    /** 响应 ping → pong */
    private handlePing(ws: AuthenticatedWebSocket, msg: ProtocolMessage): void {
        const response = buildResponse(msg.id, 'pong', {
            server_time: Math.floor(Date.now() / 1000),
        });
        ws.send(stringifyMessage(response));
    }
}
