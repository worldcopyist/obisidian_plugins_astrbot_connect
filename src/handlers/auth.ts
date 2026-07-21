/**
 * 认证处理器 — timing-safe Token 验证。
 */

import { AuthenticatedWebSocket, ProtocolMessage, buildResponse, verifyToken, stringifyMessage } from '../ws/protocol';
import { AstrbotConnectSettings } from '../settings';

declare const __VERSION__: string;

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
        ws.send(stringifyMessage(response));
    } else {
        const response = buildResponse(msg.id, 'auth', {}, 'Invalid token');
        ws.send(stringifyMessage(response));
        // 认证失败，延迟关闭连接
        setTimeout(() => {
            ws.close(4001, 'Auth Failed');
        }, 100);
    }
}
