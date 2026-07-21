/**
 * 文件操作处理器 — read / write / delete。
 */

import { App, TFile } from 'obsidian';
import { AuthenticatedWebSocket, ProtocolMessage, buildResponse, stringifyMessage, sanitizePath } from '../ws/protocol';
import { sha256, parseFrontmatter } from '../utils';

/**
 * 处理 READ 请求。
 * 读取指定路径的笔记内容、hash、mtime、frontmatter。
 */
export async function handleRead(
    app: App,
    msg: ProtocolMessage,
    ws: AuthenticatedWebSocket
): Promise<void> {
    const rawPath: string = msg.payload?.path || '';
    const safePath = sanitizePath(rawPath);

    if (!safePath) {
        const response = buildResponse(msg.id, 'read', {}, 'Invalid path');
        ws.send(stringifyMessage(response));
        return;
    }

    const file = app.vault.getFileByPath(safePath);
    if (!file) {
        const response = buildResponse(msg.id, 'read', {}, `File not found: ${safePath}`);
        ws.send(stringifyMessage(response));
        return;
    }

    try {
        const content = await app.vault.read(file);
        const { data: frontmatter } = parseFrontmatter(content);
        const hash = await sha256(content);

        const response = buildResponse(msg.id, 'read', {
            path: safePath,
            content,
            hash,
            mtime: file.stat.mtime,
            frontmatter,
        });
        ws.send(stringifyMessage(response));
    } catch (e) {
        const response = buildResponse(msg.id, 'read', {}, `Read error: ${(e as Error).message}`);
        ws.send(stringifyMessage(response));
    }
}

/**
 * 处理 WRITE 请求。
 * 创建或更新笔记。父目录不存在时自动创建。
 */
export async function handleWrite(
    app: App,
    msg: ProtocolMessage,
    ws: AuthenticatedWebSocket
): Promise<void> {
    const rawPath: string = msg.payload?.path || '';
    const content: string = msg.payload?.content || '';
    const safePath = sanitizePath(rawPath);

    if (!safePath) {
        const response = buildResponse(msg.id, 'write', {}, 'Invalid path');
        ws.send(stringifyMessage(response));
        return;
    }

    // 确保路径以 .md 结尾
    const finalPath = safePath.endsWith('.md') ? safePath : safePath + '.md';

    try {
        // 确保父目录存在
        const lastSlash = finalPath.lastIndexOf('/');
        if (lastSlash > 0) {
            const parentDir = finalPath.substring(0, lastSlash);
            const folderExists = app.vault.getAbstractFileByPath(parentDir);
            if (!folderExists) {
                await app.vault.createFolder(parentDir);
            }
        }

        const existingFile = app.vault.getAbstractFileByPath(finalPath);

        if (existingFile instanceof TFile) {
            await app.vault.modify(existingFile, content);
        } else {
            await app.vault.create(finalPath, content);
        }

        const file = app.vault.getFileByPath(finalPath);
        const hash = await sha256(content);

        const response = buildResponse(msg.id, 'write', {
            ok: true,
            path: finalPath,
            hash,
            mtime: file?.stat.mtime || Date.now(),
        });
        ws.send(stringifyMessage(response));
    } catch (e) {
        const response = buildResponse(msg.id, 'write', {}, `Write error: ${(e as Error).message}`);
        ws.send(stringifyMessage(response));
    }
}

/**
 * 处理 DELETE 请求。
 * 将笔记移动到 Obsidian 系统垃圾桶（非永久删除）。
 */
export async function handleDelete(
    app: App,
    msg: ProtocolMessage,
    ws: AuthenticatedWebSocket
): Promise<void> {
    const rawPath: string = msg.payload?.path || '';
    const safePath = sanitizePath(rawPath);

    if (!safePath) {
        const response = buildResponse(msg.id, 'delete', {}, 'Invalid path');
        ws.send(stringifyMessage(response));
        return;
    }

    const file = app.vault.getFileByPath(safePath);
    if (!file) {
        const response = buildResponse(msg.id, 'delete', {}, `File not found: ${safePath}`);
        ws.send(stringifyMessage(response));
        return;
    }

    try {
        await app.vault.trash(file, true);
        const response = buildResponse(msg.id, 'delete', { ok: true, path: safePath });
        ws.send(stringifyMessage(response));
    } catch (e) {
        const response = buildResponse(msg.id, 'delete', {}, `Delete error: ${(e as Error).message}`);
        ws.send(stringifyMessage(response));
    }
}
