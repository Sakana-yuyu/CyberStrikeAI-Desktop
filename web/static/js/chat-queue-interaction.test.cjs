const fs = require('node:fs');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const source = fs.readFileSync('web/static/js/chat.js', 'utf8');
const start = source.indexOf('function readChatQueue()');
const end = source.indexOf('// 发送消息', start);
assert.ok(start > 0 && end > start);

function makeRuntime() {
    const values = new Map();
    const elements = new Map();
    const calls = [];
    for (const id of ['chat-queue-banner', 'chat-queue-count', 'chat-queue-preview', 'chat-queue-guide']) {
        elements.set(id, { hidden: true, disabled: false, textContent: '', title: '' });
    }
    const context = vm.createContext({
        CHAT_QUEUE_STORAGE_KEY: 'test_chat_queue', chatQueueDrainBusy: false,
        currentConversationId: 'conversation-a', activeChatQuestion: null,
        localStorage: {
            getItem(key) { return values.get(key) || null; },
            setItem(key, value) { values.set(key, value); },
        },
        document: { getElementById(id) { return elements.get(id) || null; } },
        window: { addEventListener() {} },
        isCurrentChatTaskActive() { return true; },
        apiFetch: async (path, options) => { calls.push({ path, options }); return { ok: true, json: async () => ({ ok: true }) }; },
        addMessage(...args) { calls.push({ bubble: args }); },
        invalidateConversationLiteCache() {}, showChatToast() {}, setTimeout() {},
    });
    vm.runInContext(source.slice(start, end), context);
    return { context, elements, calls, values };
}

test('排队横幅展示待发消息，引导只消费队首且不调用取消接口', async () => {
    const runtime = makeRuntime();
    vm.runInContext(`writeQueuedChatItems('conversation-a', [
        {id:'one',message:'先检查认证',attachments:[]},
        {id:'two',message:'再检查权限',attachments:[]}
    ])`, runtime.context);
    assert.equal(runtime.elements.get('chat-queue-count').textContent, '2 条消息排队中');
    assert.equal(runtime.elements.get('chat-queue-preview').textContent, '先检查认证');
    await vm.runInContext('guideQueuedChatMessage()', runtime.context);
    assert.equal(runtime.calls[0].path, '/api/agent-loop/guide');
    assert.deepEqual(JSON.parse(runtime.calls[0].options.body), {
        conversationId: 'conversation-a', message: '先检查认证'
    });
    assert.equal(runtime.calls[1].bubble[1], '先检查认证');
    assert.equal(runtime.elements.get('chat-queue-count').textContent, '1 条消息排队中');
    assert.equal(runtime.elements.get('chat-queue-preview').textContent, '再检查权限');
});

test('只有新任务请求被接收后才从队列移除消息', async () => {
    const runtime = makeRuntime();
    vm.runInContext(`writeQueuedChatItems('conversation-a', [{id:'one',message:'下一条',attachments:[]}])`, runtime.context);
    runtime.context.isCurrentChatTaskActive = () => false;
    runtime.context.sendMessage = async () => false;
    await vm.runInContext('drainQueuedChatMessages()', runtime.context);
    assert.equal(runtime.elements.get('chat-queue-banner').hidden, false);
    runtime.context.sendMessage = async ({ onAccepted }) => { onAccepted(); return true; };
    await vm.runInContext('drainQueuedChatMessages()', runtime.context);
    assert.equal(runtime.elements.get('chat-queue-banner').hidden, true);
});
