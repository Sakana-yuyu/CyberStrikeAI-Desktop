/**
 * 统一的 Markdown → 安全 HTML 渲染（DOMPurify + marked）。
 * 时间线/过程详情使用 stricter profile，整页 HTML 回退为转义 <pre>。
 */
(function (global) {
    'use strict';

    const CHAT_SANITIZE_CONFIG = {
        ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 's', 'del', 'code', 'pre', 'blockquote',
            'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'a', 'img',
            'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr', 'input'],
        ALLOWED_ATTR: ['href', 'title', 'alt', 'src', 'class', 'type', 'checked', 'disabled', 'start', 'align'],
        ALLOW_DATA_ATTR: false,
    };

    /** 过程详情时间线：禁止 img，减少外连与恶意资源 */
    const TIMELINE_SANITIZE_CONFIG = {
        ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 's', 'del', 'code', 'pre', 'blockquote',
            'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'a',
            'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr', 'input'],
        ALLOWED_ATTR: ['href', 'title', 'alt', 'class', 'type', 'checked', 'disabled', 'start', 'align'],
        ALLOW_DATA_ATTR: false,
    };

    const DANGEROUS_URL_PREFIXES = [
        'javascript:',
        'vbscript:',
        'data:text/html',
        'data:text/javascript',
        'data:application/javascript',
    ];

    let domPurifyHooksInstalled = false;

    function escapeHtmlLocal(text) {
        if (text == null || text === '') return '';
        const div = document.createElement('div');
        div.textContent = String(text);
        return div.innerHTML;
    }

    function installDomPurifyHooks() {
        if (domPurifyHooksInstalled || typeof DOMPurify === 'undefined' || !DOMPurify.addHook) {
            return;
        }
        DOMPurify.addHook('uponSanitizeElement', function (node, data) {
            if (!data || data.tagName !== 'input') return;
            const type = (node.getAttribute && node.getAttribute('type') || '').toLowerCase();
            if (type !== 'checkbox' && node.parentNode) {
                node.parentNode.removeChild(node);
            }
        });
        DOMPurify.addHook('uponSanitizeAttribute', function (node, data) {
            const attrName = (data.attrName || '').toLowerCase();
            if ((attrName !== 'src' && attrName !== 'href') || !data.attrValue) {
                return;
            }
            const value = String(data.attrValue).trim().toLowerCase();
            for (let i = 0; i < DANGEROUS_URL_PREFIXES.length; i++) {
                if (value.indexOf(DANGEROUS_URL_PREFIXES[i]) === 0) {
                    data.keepAttr = false;
                    return;
                }
            }
            if (value.indexOf('blob:') === 0) {
                data.keepAttr = false;
                return;
            }
            if (attrName === 'src' && node.tagName && node.tagName.toLowerCase() === 'img') {
                if (value.length <= 2 || /^[a-z]$/i.test(value)) {
                    data.keepAttr = false;
                }
            }
        });
        domPurifyHooksInstalled = true;
    }

    /** 明显 Markdown 结构时，不应因零散 HTML 标签误判为整页 HTML */
    function looksLikeMarkdown(src) {
        const s = String(src);
        return /^#{1,6}\s/m.test(s)
            || /^\s*[-*+]\s/m.test(s)
            || /^\s*\d+\.\s/m.test(s)
            || /\*\*[^*\n]+\*\*/.test(s)
            || /`[^`\n]+`/.test(s)
            || /^```/m.test(s)
            || /^\|.+\|/m.test(s)
            || /^\s*>\s/m.test(s);
    }

    /** 探测工具返回的整页 HTML，不宜当作富文本渲染 */
    function isHeavyRawHtml(src) {
        const s = String(src);
        if (looksLikeMarkdown(s)) {
            return false;
        }
        if (/<!DOCTYPE\s+html/i.test(s) || /<\s*html\b/i.test(s)) {
            return true;
        }
        if (/<\s*(head|body|iframe|object|embed|form|script|style|meta|link|base)\b/i.test(s)) {
            return true;
        }
        const tags = s.match(/<[a-z][^>]*>/gi);
        return tags != null && tags.length >= 8;
    }

    function escapePlainTextAsHtml(text) {
        return escapeHtmlLocal(text).replace(/\n/g, '<br>');
    }

    function formatHtmlAsEscapedPre(text) {
        return '<pre class="tool-result sanitized-raw-html-fallback">' + escapeHtmlLocal(text) + '</pre>';
    }

    function normalizeSource(text) {
        const raw = text == null ? '' : String(text);
        if (typeof global.normalizeAssistantMarkdownSource === 'function') {
            return global.normalizeAssistantMarkdownSource(raw);
        }
        return raw;
    }

    /** CodeWork 只对「★ Insight」类助手正文保留单行硬换行，其余按标准 Markdown 段落。 */
    function shouldPreserveAssistantLineBreaks(text) {
        return /^★ Insight(?:\s|─)/mu.test(String(text || ''));
    }

    /**
     * layout:'agent' 默认关闭硬换行；显式 breaks 优先。
     * 其它调用方保持原来的单行换行，避免改到 webshell 等旧表面。
     */
    function resolveMarkdownBreaks(src, options) {
        if (options && typeof options.breaks === 'boolean') {
            return options.breaks;
        }
        if (options && options.layout === 'agent') {
            return shouldPreserveAssistantLineBreaks(src);
        }
        return true;
    }

    function parseMarkdownSrc(src, breaks) {
        if (typeof marked === 'undefined' || typeof marked.parse !== 'function') {
            return null;
        }
        try {
            return marked.parse(src, { async: false, gfm: true, breaks: !!breaks });
        } catch (e) {
            console.error('Markdown 解析失败:', e);
            return null;
        }
    }

    function sanitizeConfigForProfile(profile) {
        return profile === 'timeline' ? TIMELINE_SANITIZE_CONFIG : CHAT_SANITIZE_CONFIG;
    }

    /**
     * @param {string|null|undefined} text
     * @param {{ profile?: 'chat'|'timeline' }} [options]
     * @returns {string} 安全 HTML
     */
    function buildRichHtmlFromSource(src, breaks) {
        const hasHtmlTags = /<[a-z][\s\S]*>/i.test(src);
        const preferMarkdown = typeof marked !== 'undefined'
            && (looksLikeMarkdown(src) || !hasHtmlTags);

        if (preferMarkdown) {
            const parsed = parseMarkdownSrc(src, breaks);
            if (parsed != null) {
                return parsed;
            }
        }
        if (hasHtmlTags) {
            return src;
        }
        return escapePlainTextAsHtml(src);
    }

    function formatMarkdownToHtml(text, options) {
        const profile = (options && options.profile === 'timeline') ? 'timeline' : 'chat';
        const src = normalizeSource(text);

        if (isHeavyRawHtml(src)) {
            return formatHtmlAsEscapedPre(src);
        }

        if (typeof DOMPurify === 'undefined') {
            console.warn('DOMPurify 未加载，Markdown 已降级为纯文本渲染（已转义，防 XSS）');
            return escapePlainTextAsHtml(src);
        }

        installDomPurifyHooks();
        const config = sanitizeConfigForProfile(profile);
        return DOMPurify.sanitize(buildRichHtmlFromSource(src, resolveMarkdownBreaks(src, options)), config);
    }

    function chatMarkdownLabel(key, fallback) {
        if (typeof global.t === 'function') {
            const value = global.t(key);
            if (value && value !== key) return value;
        }
        return fallback;
    }

    function codeBlockLanguage(pre) {
        const code = pre.querySelector && pre.querySelector('code');
        const className = code && code.className ? String(code.className) : '';
        const match = /(?:^|\s)language-([^\s]+)/.exec(className);
        return match ? match[1] : '';
    }

    let chatMarkdownActionsBound = false;

    function bindChatMarkdownActions() {
        if (chatMarkdownActionsBound || !global.document || !global.document.addEventListener) return;
        chatMarkdownActionsBound = true;
        global.document.addEventListener('click', function (event) {
            const button = event.target && event.target.closest
                ? event.target.closest('[data-chat-code-action]')
                : null;
            if (!button) return;
            const block = button.closest('.chat-markdown-codeblock');
            if (!block) return;
            event.preventDefault();
            event.stopPropagation();
            const action = button.getAttribute('data-chat-code-action');
            if (action === 'wrap') {
                const wrapped = block.getAttribute('data-wrap') === 'true';
                block.setAttribute('data-wrap', wrapped ? 'false' : 'true');
                button.setAttribute('aria-pressed', wrapped ? 'false' : 'true');
                button.title = wrapped
                    ? chatMarkdownLabel('chat.wrapLines', '自动换行')
                    : chatMarkdownLabel('chat.unwrapLines', '取消换行');
                return;
            }
            if (action !== 'copy') return;
            const code = block.querySelector('pre');
            const text = code ? code.textContent : '';
            const done = function () {
                button.classList.add('is-copied');
                button.title = chatMarkdownLabel('chat.copied', '已复制');
                global.setTimeout(function () {
                    button.classList.remove('is-copied');
                    button.title = chatMarkdownLabel('chat.copyCode', '复制代码');
                }, 1200);
            };
            if (global.navigator && global.navigator.clipboard && global.navigator.clipboard.writeText) {
                global.navigator.clipboard.writeText(text).then(done).catch(function () {});
            }
        });
    }

    function enhanceChatMarkdown(root) {
        if (!root || !root.querySelectorAll) return;
        bindChatMarkdownActions();
        root.querySelectorAll('a[href]').forEach(function (anchor) {
            const href = anchor.getAttribute('href') || '';
            if (/^https?:/i.test(href)) {
                anchor.target = '_blank';
                anchor.rel = 'noopener noreferrer';
            }
        });
        root.querySelectorAll('pre').forEach(function (pre) {
            if (pre.closest('.chat-markdown-codeblock')) return;
            if (pre.classList.contains('tool-result') || pre.classList.contains('sanitized-raw-html-fallback')) return;
            const lang = codeBlockLanguage(pre);
            const block = global.document.createElement('div');
            block.className = 'chat-markdown-codeblock';
            block.setAttribute('data-language', lang || 'text');
            block.setAttribute('data-wrap', 'false');
            const header = global.document.createElement('div');
            header.className = 'chat-markdown-codeblock-header';
            const title = global.document.createElement('span');
            title.className = 'chat-markdown-codeblock-lang';
            title.textContent = lang || 'text';
            const actions = global.document.createElement('span');
            actions.className = 'chat-markdown-codeblock-actions';
            actions.setAttribute('role', 'toolbar');
            const wrapBtn = global.document.createElement('button');
            wrapBtn.type = 'button';
            wrapBtn.className = 'chat-markdown-chrome-action';
            wrapBtn.setAttribute('data-chat-code-action', 'wrap');
            wrapBtn.setAttribute('aria-pressed', 'false');
            wrapBtn.title = chatMarkdownLabel('chat.wrapLines', '自动换行');
            wrapBtn.setAttribute('aria-label', wrapBtn.title);
            wrapBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 7h16M4 12h10a4 4 0 0 1 0 8H8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M8 17l-2.5 2.5L8 22" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
            const copyBtn = global.document.createElement('button');
            copyBtn.type = 'button';
            copyBtn.className = 'chat-markdown-chrome-action';
            copyBtn.setAttribute('data-chat-code-action', 'copy');
            copyBtn.title = chatMarkdownLabel('chat.copyCode', '复制代码');
            copyBtn.setAttribute('aria-label', copyBtn.title);
            copyBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
            actions.appendChild(wrapBtn);
            actions.appendChild(copyBtn);
            header.appendChild(title);
            header.appendChild(actions);
            const parent = pre.parentNode;
            if (!parent) return;
            parent.insertBefore(block, pre);
            block.appendChild(header);
            block.appendChild(pre);
        });
    }

    function paintAgentMarkdownBubble(bubble) {
        if (!bubble || !bubble.classList || bubble.classList.contains('progress-container')) return;
        bubble.classList.add('chat-markdown');
        enhanceChatMarkdown(bubble);
    }

    function sanitizeRichHtml(html, profile) {
        if (typeof DOMPurify === 'undefined') {
            return null;
        }
        installDomPurifyHooks();
        return DOMPurify.sanitize(html, sanitizeConfigForProfile(profile || 'chat'));
    }

    function stripSuspiciousImages(root) {
        if (!root || !root.querySelectorAll) {
            return;
        }
        root.querySelectorAll('img').forEach(function (img) {
            const src = (img.getAttribute('src') || '').trim();
            if (!src || src.length <= 2 || /^[a-z]$/i.test(src)) {
                img.remove();
            }
        });
    }

    global.csMarkdownSanitize = {
        CHAT_SANITIZE_CONFIG: CHAT_SANITIZE_CONFIG,
        TIMELINE_SANITIZE_CONFIG: TIMELINE_SANITIZE_CONFIG,
        installDomPurifyHooks: installDomPurifyHooks,
        formatMarkdownToHtml: formatMarkdownToHtml,
        shouldPreserveAssistantLineBreaks: shouldPreserveAssistantLineBreaks,
        resolveMarkdownBreaks: resolveMarkdownBreaks,
        enhanceChatMarkdown: enhanceChatMarkdown,
        paintAgentMarkdownBubble: paintAgentMarkdownBubble,
        sanitizeRichHtml: sanitizeRichHtml,
        isHeavyRawHtml: isHeavyRawHtml,
        looksLikeMarkdown: looksLikeMarkdown,
        escapeHtmlLocal: escapeHtmlLocal,
        stripSuspiciousImages: stripSuspiciousImages,
    };

    global.formatMarkdown = function formatMarkdown(text, options) {
        return formatMarkdownToHtml(text, options);
    };
})(typeof window !== 'undefined' ? window : globalThis);
