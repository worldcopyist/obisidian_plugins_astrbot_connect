/**
 * 认证处理器 — timing-safe Token 验证。
 */

import { AuthenticatedWebSocket, ProtocolMessage, buildResponse, verifyToken, stringifyMessage } from '../ws/protocol';
import { AstrbotConnectSettings } from '../settings';

/**
 * 处理 AUTH 请求。
 * 验证客户端提供的 Token，成功返回 server_info，失败返回 error 并关闭连接。
 *
 * @param ws - WebSocket 连接
 * @param msg - 请求消息
 * @param settings - 插件设置
 */
export function handleAuth(
    ws: AuthenticatedWebSocket,
    msg: ProtocolMessage,
    settings: AstrbotConnectSettings
): void {
    const token = msg.payload?.token || '';

    if (verifyToken(ws, settings, token)) {
        const response = buildResponse(msg.id, 'auth', {
            ok: true,
            server_info: {
                version: '1.0.0',
                vault_name: '', // 由调用方在 main.ts 中设置，此处用空值
            },
        });
        safeSend(ws, stringifyMessage(response));
    } else {
        const response = buildResponse(msg.id, 'auth', {}, 'Invalid token');
        safeSend(ws, stringifyMessage(response));
        // 认证失败，延迟关闭连接
        setTimeout(() => {
            try {
                ws.close(4001, 'Auth Failed');
            } catch {
                // 连接可能已关闭
            }
        }, 100);
    }
}

/** 安全发送：捕获连接关闭时可能的异常 */
function safeSend(ws: AuthenticatedWebSocket, data: string): void {
    try {
        ws.send(data);
    } catch (e) {
        console.error('Auth: failed to send response:', e);
    }
}
