/**
 * 搜索处理器 — vault 本地全文搜索。
 *
 * 遍历 vault 中所有 .md 文件，进行关键词匹配，
 * 简单的 TF-IDF 风格评分，返回 Top-K 结果。
 */

import { App, TFile } from 'obsidian';
import { AuthenticatedWebSocket, ProtocolMessage, buildResponse, stringifyMessage, sanitizePath } from '../ws/protocol';
import { AstrbotConnectSettings } from '../settings';
import { isIndexable, parseFrontmatter } from '../utils';

/**
 * 处理 SEARCH 请求。
 * 在 vault 中搜索匹配关键词的笔记。
 */
export async function handleSearch(
    app: App,
    msg: ProtocolMessage,
    ws: AuthenticatedWebSocket,
    settings: AstrbotConnectSettings
): Promise<void> {
    const query: string = msg.payload?.query || '';
    const topK: number = msg.payload?.top_k || 10;
    const mode: string = msg.payload?.mode || 'keyword';

    if (!query.trim()) {
        const response = buildResponse(msg.id, 'search', { results: [] });
        ws.send(stringifyMessage(response));
        return;
    }

    const files = app.vault.getFiles();
    const results: SearchResult[] = [];

    for (const file of files) {
        if (!isIndexable(file, settings)) {
            continue;
        }

        const content = await app.vault.read(file);
        const score = computeScore(query, file, content, mode);

        if (score > 0) {
            const { data: frontmatter } = parseFrontmatter(content);
            const title = frontmatter.title || file.basename;
            const snippet = extractSnippet(content, query, 200);

            results.push({
                path: file.path,
                title,
                snippet,
                score: Math.round(score * 1000) / 1000,
                mtime: file.stat.mtime,
            });
        }
    }

    // 按分数降序排列，取 topK
    results.sort((a, b) => b.score - a.score);
    const topResults = results.slice(0, topK);

    const response = buildResponse(msg.id, 'search', { results: topResults });
    ws.send(stringifyMessage(response));
}

interface SearchResult {
    path: string;
    title: string;
    snippet: string;
    score: number;
    mtime: number;
}

/**
 * 计算文件对查询的相关性分数。
 * 简单实现：文件名匹配 + 内容关键词匹配，TF 加权。
 */
function computeScore(query: string, file: TFile, content: string, mode: string): number {
    const queryLower = query.toLowerCase();
    const pathLower = file.path.toLowerCase();
    const contentLower = content.toLowerCase();

    let score = 0;

    if (mode === 'keyword' || mode === 'fulltext') {
        // 分词（简单按空格和常见分隔符拆分）
        const tokens = queryLower.split(/[\s,，。、；;]+/).filter((t) => t.length > 0);

        for (const token of tokens) {
            // 文件名完全匹配 — 高分
            if (pathLower.includes(token)) {
                score += 3;
            }

            // 内容中出现次数（TF 简单版）
            const count = (contentLower.match(new RegExp(escapeRegExp(token), 'g')) || []).length;
            score += Math.min(count, 10) * 0.5;
        }

        // 完整查询短语匹配 — 额外加分
        if (contentLower.includes(queryLower)) {
            score += 5;
        }
    }

    return score;
}

/** 转义正则特殊字符 */
function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 从内容中提取围绕查询关键词的摘要片段。
 */
function extractSnippet(content: string, query: string, maxLen: number): string {
    const queryLower = query.toLowerCase();
    const contentLower = content.toLowerCase();

    // 去 frontmatter
    const bodyIdx = content.startsWith('---')
        ? content.indexOf('---', 3)
        : -1;
    const body = bodyIdx !== -1 ? content.substring(bodyIdx + 3).trim() : content;

    const idx = contentLower.indexOf(queryLower);
    if (idx === -1) {
        // 取开头
        return body.substring(0, maxLen).replace(/\n/g, ' ') + (body.length > maxLen ? '...' : '');
    }

    const start = Math.max(0, idx - Math.floor(maxLen / 2));
    const end = Math.min(content.length, start + maxLen);
    let snippet = content.substring(start, end).replace(/\n/g, ' ').trim();
    if (start > 0) snippet = '...' + snippet;
    if (end < content.length) snippet = snippet + '...';
    return snippet;
}
