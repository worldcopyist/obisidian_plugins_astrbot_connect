/**
 * WebSocket 协议层 — 消息解析、校验、构建、Token 认证。
 *
 * 消息格式 (JSON):
 * {
 *   "id": "uuid-v4",
 *   "type": "request | response | event",
 *   "action": "auth | search | read | write | delete | sync_full | sync_since | check_consistency | file_changed | ping | pong",
 *   "payload": {},
 *   "error": null,
 *   "timestamp": 1711560000
 * }
 */

import { WebSocket } from 'ws';
import { timingSafeEqual, randomUUID } from 'crypto';
import type { AstrbotConnectSettings } from '../settings';

/** 协议消息接口 */
export interface ProtocolMessage {
    id: string;
    type: 'request' | 'response' | 'event';
    action: string;
    payload: Record<string, any>;
    error: string | null;
    timestamp: number;
}

/** 扩展 WebSocket，携带认证状态 */
export interface AuthenticatedWebSocket extends WebSocket {
    isAuthenticated: boolean;
}

/** 合法的 action 值 */
const VALID_ACTIONS = [
    'auth', 'search', 'read', 'write', 'delete',
    'sync_full', 'sync_since', 'check_consistency',
    'file_changed', 'ping', 'pong',
];

/**
 * 解析 JSON 字符串为 ProtocolMessage。
 * 校验必填字段和 action 合法性。
 *
 * @param raw - JSON 字符串
 * @returns ProtocolMessage 对象
 * @throws 格式无效或 action 不合法
 */
export function parseMessage(raw: string): ProtocolMessage {
    let data: any;
    try {
        data = JSON.parse(raw);
    } catch (e) {
        throw new Error('Invalid JSON: ' + (e as Error).message);
    }

    // 校验必填字段
    const requiredFields = ['id', 'type', 'action', 'payload'];
    for (const field of requiredFields) {
        if (!(field in data)) {
            throw new Error(`Missing required field: ${field}`);
        }
    }

    // 校验 type
    if (!['request', 'response', 'event'].includes(data.type)) {
        throw new Error(`Invalid message type: ${data.type}`);
    }

    // 校验 action
    if (!VALID_ACTIONS.includes(data.action)) {
        throw new Error(`Invalid action: ${data.action}`);
    }

    return {
        id: data.id ?? '',
        type: data.type as 'request' | 'response' | 'event',
        action: data.action,
        payload: data.payload ?? {},
        error: data.error ?? null,
        timestamp: data.timestamp ?? Math.floor(Date.now() / 1000),
    };
}

/**
 * 构建响应消息。
 *
 * @param id - 对应请求的 id
 * @param action - 操作类型
 * @param payload - 响应数据
 * @param error - 错误信息，非 null 表示失败
 */
export function buildResponse(
    id: string,
    action: string,
    payload: Record<string, any> = {},
    error: string | null = null
): ProtocolMessage {
    return {
        id,
        type: 'response',
        action,
        payload,
        error,
        timestamp: Math.floor(Date.now() / 1000),
    };
}

/**
 * 构建事件推送消息。
 *
 * @param action - 事件类型
 * @param payload - 事件数据
 */
export function buildEvent(
    action: string,
    payload: Record<string, any>
): ProtocolMessage {
    return {
        id: randomUUID(),
        type: 'event',
        action,
        payload,
        error: null,
        timestamp: Math.floor(Date.now() / 1000),
    };
}

/**
 * Timing-safe Token 比较。
 * 使用 crypto.timingSafeEqual 防止时序攻击。
 *
 * @param ws - WebSocket 连接（用于更新认证状态）
 * @param settings - 插件设置（含预期的 apiToken）
 * @param token - 客户端提供的 token
 * @returns true 表示认证成功
 */
export function verifyToken(
    ws: AuthenticatedWebSocket,
    settings: AstrbotConnectSettings,
    token: string
): boolean {
    const expected = settings.apiToken;
    if (!expected) {
        // 如果未配置 token，允许所有连接（不安全，但便于开发）
        ws.isAuthenticated = true;
        return true;
    }

    const tokenBuf = Buffer.from(token);
    const expectedBuf = Buffer.from(expected);

    if (tokenBuf.length !== expectedBuf.length) {
        return false;
    }

    try {
        const matches = timingSafeEqual(tokenBuf, expectedBuf);
        if (matches) {
            ws.isAuthenticated = true;
        }
        return matches;
    } catch {
        return false;
    }
}

/**
 * 将 ProtocolMessage 序列化为 JSON 字符串。
 */
export function stringifyMessage(msg: ProtocolMessage): string {
    return JSON.stringify(msg);
}

/**
 * 校验文件路径在 vault 内，防止目录穿越攻击。
 *
 * @param requestedPath - 客户端请求的文件路径
 * @returns 规范化后的安全路径，如果路径非法则返回 null
 */
export function sanitizePath(requestedPath: string): string | null {
    // 拒绝 Unix 绝对路径
    if (requestedPath.startsWith('/')) {
        return null;
    }

    // 规范化分隔符并去除开头的 /
    const clean = requestedPath.replace(/\\/g, '/').replace(/^\/+/, '');

    // 防目录穿越：拒绝包含 .. 的路径
    if (clean.includes('..')) {
        return null;
    }

    // 拒绝 Windows 绝对路径
    if (/^[A-Za-z]:/i.test(clean)) {
        return null;
    }

    // 拒绝空路径
    if (!clean || clean === '.') {
        return null;
    }

    return clean;
}
