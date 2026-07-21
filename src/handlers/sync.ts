/**
 * 同步处理器 — sync_full / sync_since / check_consistency。
 */

import { App } from 'obsidian';
import { AuthenticatedWebSocket, ProtocolMessage, buildResponse, stringifyMessage, sanitizePath } from '../ws/protocol';
import { AstrbotConnectSettings } from '../settings';
import { sha256, isIndexable, parseFrontmatter } from '../utils';

/** 游标编码：base64(JSON index)。使用 btoa 而非 Buffer 以兼容 Obsidian 沙箱环境。 */
function encodeCursor(index: number): string {
    return btoa(JSON.stringify({ idx: index }));
}

/** 游标解码 */
function decodeCursor(cursor: string | null): number {
    if (!cursor) return 0;
    try {
        const data = JSON.parse(atob(cursor));
        return data.idx || 0;
    } catch {
        return 0;
    }
}

/**
 * 处理 SYNC_FULL 请求。
 * 分批返回 vault 中所有符合过滤条件的 .md 文件内容。
 *
 * 请求: { batch_size, cursor }
 * 响应: { files: [{ path, content, hash, mtime, frontmatter }], cursor, has_more, total_files }
 */
export async function handleSyncFull(
    app: App,
    msg: ProtocolMessage,
    ws: AuthenticatedWebSocket,
    settings: AstrbotConnectSettings
): Promise<void> {
    const batchSize: number = msg.payload?.batch_size || 20;
    const cursor: string | null = msg.payload?.cursor || null;

    // 获取所有可索引文件
    const allFiles = app.vault.getFiles().filter((f) => isIndexable(f, settings));
    const startIdx = decodeCursor(cursor);
    const endIdx = Math.min(startIdx + batchSize, allFiles.length);
    const batch = allFiles.slice(startIdx, endIdx);

    const files: SyncFileEntry[] = [];
    for (const file of batch) {
        try {
            const content = await app.vault.read(file);
            const hash = await sha256(content);
            const { data: frontmatter } = parseFrontmatter(content);

            files.push({
                path: file.path,
                content,
                hash,
                mtime: file.stat.mtime,
                frontmatter,
            });
        } catch (e) {
            // 跳过读取失败的文件
            console.error(`Sync: failed to read ${file.path}:`, e);
        }
    }

    const hasMore = endIdx < allFiles.length;
    const nextCursor = hasMore ? encodeCursor(endIdx) : null;

    const response = buildResponse(msg.id, 'sync_full', {
        files,
        cursor: nextCursor,
        has_more: hasMore,
        total_files: allFiles.length,
    });
    ws.send(stringifyMessage(response));
}

/**
 * 处理 SYNC_SINCE 请求。
 * 返回自指定时间戳以来发生变更的文件。
 *
 * 请求: { since_timestamp }
 * 响应: { changes: [{ path, change_type, content?, hash?, mtime? }], snapshot_ts }
 */
export async function handleSyncSince(
    app: App,
    msg: ProtocolMessage,
    ws: AuthenticatedWebSocket,
    settings: AstrbotConnectSettings
): Promise<void> {
    const sinceTimestamp: number = msg.payload?.since_timestamp || 0;
    const allFiles = app.vault.getFiles();
    const snapshotTs = Math.floor(Date.now() / 1000);

    const changes: SyncChange[] = [];

    for (const file of allFiles) {
        if (!isIndexable(file, settings)) {
            continue;
        }

        if (file.stat.mtime > sinceTimestamp || file.stat.ctime > sinceTimestamp) {
            // 精确分类：ctime > since 且 mtime 接近 ctime 为 create，否则为 modify
            const isNew = file.stat.ctime > sinceTimestamp
                && Math.abs(file.stat.mtime - file.stat.ctime) <= 2;
            const changeType: string = isNew ? 'create' : 'modify';

            try {
                const content = await app.vault.read(file);
                const hash = await sha256(content);

                changes.push({
                    path: file.path,
                    change_type: changeType,
                    content,
                    hash,
                    mtime: file.stat.mtime,
                });
            } catch (e) {
                console.error(`Sync: failed to read ${file.path}:`, e);
            }
        }
    }

    const response = buildResponse(msg.id, 'sync_since', {
        changes,
        snapshot_ts: snapshotTs,
    });
    ws.send(stringifyMessage(response));
}

/**
 * 处理 CHECK_CONSISTENCY 请求。
 * 对比客户端提供的 manifest 与当前 vault 状态，返回不一致的文件。
 *
 * 请求: { manifest: [{ path, hash, mtime }] }
 * 响应: { mismatches: [{ path, current_hash, current_mtime }] }
 */
export async function handleCheckConsistency(
    app: App,
    msg: ProtocolMessage,
    ws: AuthenticatedWebSocket,
    settings: AstrbotConnectSettings
): Promise<void> {
    const manifest: Array<{ path: string; hash: string; mtime: number }> = msg.payload?.manifest || [];
    const mismatches: Array<{ path: string; current_hash: string; current_mtime: number }> = [];

    for (const entry of manifest) {
        // 安全校验：清理路径防目录穿越
        const safePath = sanitizePath(entry.path);
        if (!safePath) {
            mismatches.push({
                path: entry.path,
                current_hash: '',
                current_mtime: 0,
            });
            continue;
        }

        const file = app.vault.getFileByPath(safePath);

        if (!file) {
            // 文件已删除
            mismatches.push({
                path: safePath,
                current_hash: '',
                current_mtime: 0,
            });
            continue;
        }

        // 跳过不在索引范围内的文件
        if (!isIndexable(file, settings)) {
            continue;
        }

        // 总是校验 hash（不依赖 mtime 匹配，因为外部工具可能保留 mtime 但修改内容）
        try {
            const content = await app.vault.read(file);
            const currentHash = await sha256(content);
            if (currentHash !== entry.hash || file.stat.mtime !== entry.mtime) {
                mismatches.push({
                    path: safePath,
                    current_hash: currentHash,
                    current_mtime: file.stat.mtime,
                });
            }
        } catch (e) {
            mismatches.push({
                path: safePath,
                current_hash: '',
                current_mtime: file.stat.mtime,
            });
        }
    }

    const response = buildResponse(msg.id, 'check_consistency', { mismatches });
    ws.send(stringifyMessage(response));
}

/** 全量同步文件条目 */
interface SyncFileEntry {
    path: string;
    content: string;
    hash: string;
    mtime: number;
    frontmatter: Record<string, any>;
}

/** 增量同步变更条目 */
interface SyncChange {
    path: string;
    change_type: string;
    content?: string;
    hash?: string;
    mtime?: number;
}
