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

import type { AstrbotConnectSettings } from '../settings';

/** 生成 UUID v4（兼容 Node.js 和浏览器） */
function randomUUID(): string {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    // fallback
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
}

/** Timing-safe 字符串比较（兼容 Node.js 和浏览器，使用 Uint8Array） */
function timingSafeEqualStr(a: string, b: string): boolean {
    const ab = new TextEncoder().encode(a);
    const bb = new TextEncoder().encode(b);
    if (ab.length !== bb.length) return false;
    let result = 0;
    for (let i = 0; i < ab.length; i++) {
        result |= ab[i] ^ bb[i];
    }
    return result === 0;
}

/** 协议消息接口 */
export interface ProtocolMessage {
    id: string;
    type: 'request' | 'response' | 'event';
    action: string;
    payload: Record<string, any>;
    error: string | null;
    timestamp: number;
}

/** 虚拟 WebSocket 接口 — 兼容浏览器 WebSocket 和 ws 包 */
export interface AuthenticatedWebSocket {
    isAuthenticated: boolean;
    send(data: string): void;
    close(code?: number, reason?: string): void;
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
        ws.isAuthenticated = true;
        return true;
    }

    if (!timingSafeEqualStr(token, expected)) {
        return false;
    }
    ws.isAuthenticated = true;
    return true;
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
    if (/(?:^|\/)\.\.(?:$|\/)/.test(clean)) {
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
