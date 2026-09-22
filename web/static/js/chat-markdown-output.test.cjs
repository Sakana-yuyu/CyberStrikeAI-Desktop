const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const context = {
    console,
    setTimeout,
    clearTimeout,
};
context.globalThis = context;
context.window = context;
context.self = context;
context.global = context;
vm.createContext(context);

function load(relativePath) {
    vm.runInContext(fs.readFileSync(path.join(root, relativePath), 'utf8'), context, { filename: relativePath });
}

load('vendor/marked.min.js');
load('vendor/purify.min.js');
load('js/sanitize-markdown.js');

const api = context.csMarkdownSanitize;
assert.ok(api, 'csMarkdownSanitize should load');

assert.strictEqual(api.shouldPreserveAssistantLineBreaks('★ Insight ──\nline'), true);
assert.strictEqual(api.shouldPreserveAssistantLineBreaks('普通段落\n下一行'), false);
assert.strictEqual(api.resolveMarkdownBreaks('普通段落\n下一行', { layout: 'agent' }), false);
assert.strictEqual(api.resolveMarkdownBreaks('普通段落\n下一行', { layout: 'agent', breaks: true }), true);
assert.strictEqual(api.resolveMarkdownBreaks('普通段落\n下一行', { profile: 'chat' }), true);

function render(text, options) {
    return context.marked.parse(text, {
        async: false,
        gfm: true,
        breaks: api.resolveMarkdownBreaks(text, options),
    });
}

const agentHtml = render('第一行\n第二行\n\n- 一项\n- 二项\n\n`inline`\n\n```js\nconst n = 1;\n```\n', { profile: 'chat', layout: 'agent' });
assert.ok(!/<br\s*\/?>/i.test(agentHtml), 'agent prose should not hard-break single newlines');
assert.ok(agentHtml.includes('<li>'), agentHtml);
assert.ok(agentHtml.includes('language-js'), agentHtml);
assert.ok(agentHtml.includes('<code>inline</code>'), agentHtml);

const userHtml = render('第一行\n第二行', { profile: 'chat', layout: 'agent', breaks: true });
assert.ok(/<br\s*\/?>/i.test(userHtml), 'user messages keep typed line breaks');

const legacyHtml = render('第一行\n第二行', { profile: 'chat' });
assert.ok(/<br\s*\/?>/i.test(legacyHtml), 'non-agent callers keep the previous line breaks');

console.log('chat-markdown-output.test.cjs passed');
