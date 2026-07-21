/**
 * 工具函数 — SHA-256 hash, 路径过滤, frontmatter 解析。
 */

import { TFile } from 'obsidian';
import { createHash } from 'crypto';
import { AstrbotConnectSettings } from './settings';

/**
 * 计算字符串的 SHA-256 hex 摘要。
 * 用于文件一致性校验。
 */
export function sha256(content: string): string {
    return createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * 判断文件是否应该被索引/同步。
 * 根据插件设置中的文件夹和标签过滤规则决定。
 *
 * @param file - Obsidian TFile 实例
 * @param settings - 插件设置
 * @returns true 表示该文件应被包含
 */
export function isIndexable(file: TFile, settings: AstrbotConnectSettings): boolean {
    // 仅处理 .md 文件
    if (file.extension !== 'md') {
        return false;
    }

    const path = file.path;

    // 白名单检查：如果配置了 includeFolders，路径必须以其中之一开头
    if (settings.includeFolders.length > 0) {
        const included = settings.includeFolders.some(
            (folder) => path.startsWith(folder.endsWith('/') ? folder : folder + '/')
        );
        if (!included) {
            return false;
        }
    }

    // 黑名单检查：如果配置了 excludeFolders，路径不能以其中之一开头
    if (settings.excludeFolders.length > 0) {
        const excluded = settings.excludeFolders.some(
            (folder) => path.startsWith(folder.endsWith('/') ? folder : folder + '/')
        );
        if (excluded) {
            return false;
        }
    }

    return true;
}

/**
 * 解析 Markdown 文本的 YAML frontmatter。
 *
 * 使用简单的行解析（不依赖 YAML 库），支持：
 * - 字符串、数字、布尔值
 * - 内联数组 [a, b, c]
 * - 缩进列表项 (- item)
 *
 * @param content - Markdown 全文
 * @returns { data: frontmatter 键值对, body: 去掉 frontmatter 后的正文 }
 */
export function parseFrontmatter(content: string): { data: Record<string, any>; body: string } {
    if (!content.startsWith('---')) {
        return { data: {}, body: content };
    }

    // 查找结束的 ---
    const endIdx = content.indexOf('---', 3);
    if (endIdx === -1) {
        return { data: {}, body: content };
    }

    const fmBlock = content.substring(3, endIdx).trim();
    const body = content.substring(endIdx + 3).trim();

    const data: Record<string, any> = {};
    let currentKey: string | null = null;

    const lines = fmBlock.split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
            continue;
        }

        // 简单 key: value 行
        const match = trimmed.match(/^(\w[\w_-]*)\s*:\s*(.+)$/);
        if (match) {
            const key = match[1];
            const value = match[2].trim();
            currentKey = key;
            data[key] = parseYamlValue(value);
        } else if (trimmed.startsWith('- ') && currentKey) {
            // 列表项续行
            if (!Array.isArray(data[currentKey])) {
                data[currentKey] = [];
            }
            const item = trimmed.substring(2).trim().replace(/^["']|["']$/g, '');
            data[currentKey].push(item);
        }
    }

    return { data, body };
}

/**
 * 解析简单 YAML 值（字符串、数字、布尔、内联数组）。
 */
function parseYamlValue(value: string): any {
    value = value.trim();

    // 布尔
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;

    // 内联数组 [a, b, c]
    if (value.startsWith('[') && value.endsWith(']')) {
        const inner = value.substring(1, value.length - 1);
        return inner
            .split(',')
            .map((item) => item.trim().replace(/^["']|["']$/g, ''))
            .filter((item) => item.length > 0);
    }

    // 数字
    if (/^-?\d+\.?\d*$/.test(value)) {
        return value.includes('.') ? parseFloat(value) : parseInt(value, 10);
    }

    // 去除引号
    if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
    ) {
        return value.substring(1, value.length - 1);
    }

    return value;
}
