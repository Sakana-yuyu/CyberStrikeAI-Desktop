const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, 'settings.js'), 'utf8');
const start = source.indexOf('function applyAIChannelVendorPreset(');
const end = source.indexOf('function syncAIChannelEditorPreview()', start);

function setup(fetch, allowed = true) {
    const elements = Object.fromEntries(['ai-channel-balance-btn', 'ai-channel-balance-result', 'openai-provider', 'openai-base-url', 'openai-api-key', 'openai-model'].map(id => [id, {value: 'old-secret', textContent: '', disabled: false}]));
    const context = vm.createContext({
        document: {getElementById: id => elements[id]},
        requirePermission: () => allowed,
        readAIChannelFromMainForm: () => ({base_url: 'https://api.deepseek.com/v1', api_key: 'draft-secret'}),
        selectedAIChannelId: 'test', apiFetch: fetch, AbortController, setTimeout, clearTimeout,
        syncSettingsCustomSelect() {}, syncAIChannelEditorPreview() {}, syncModelListFetchButtons() {}
    });
    vm.runInContext(source.slice(start, end), context);
    return {context, elements};
}

test('no automatic requests; manual balance sends channel draft and renders zero safely', async () => {
    let calls = 0;
    const {context, elements} = setup(async (url, options) => {
        calls++;
        assert.equal(url, '/api/config/channel-balance');
        assert.equal(JSON.parse(options.body).api_key, 'draft-secret');
        return {ok: true, json: async () => ({status: 'available', amounts: [{remaining: '0.00', currency: 'CNY'}]})};
    });
    assert.equal(calls, 0);
    await context.queryAIChannelBalance();
    assert.equal(calls, 1);
    assert.match(elements['ai-channel-balance-result'].textContent, /0.00 CNY/);
    assert.equal(elements['ai-channel-balance-btn'].disabled, false);
});

test('permission denied makes no request', async () => {
    const {context} = setup(() => assert.fail('unexpected request'), false);
    await context.queryAIChannelBalance();
});

test('channel change discards in-flight balance and prevents duplicate clicks', async () => {
    let resolve;
    let calls = 0;
    const {context, elements} = setup(() => { calls++; return new Promise(r => { resolve = r; }); });
    const pending = context.queryAIChannelBalance();
    await context.queryAIChannelBalance();
    assert.equal(calls, 1);
    context.invalidateAIChannelBalance();
    resolve({ok: true, json: async () => ({status: 'available', amounts: [{remaining: '99', currency: 'USD'}]})});
    await pending;
    assert.equal(elements['ai-channel-balance-result'].textContent, '');
    assert.equal(elements['ai-channel-balance-btn'].disabled, false);
});

test('preset clears previous key and model without saving or probing', () => {
    const {context, elements} = setup(() => assert.fail('unexpected request'));
    context.applyAIChannelVendorPreset('deepseek');
    assert.equal(elements['openai-base-url'].value, 'https://api.deepseek.com/v1');
    assert.equal(elements['openai-api-key'].value, '');
    assert.equal(elements['openai-model'].value, '');
});

test('request errors do not expose exception secrets', async () => {
    const {context, elements} = setup(async () => { throw new Error('draft-secret'); });
    await context.queryAIChannelBalance();
    assert.doesNotMatch(elements['ai-channel-balance-result'].textContent, /secret/);
    assert.equal(elements['ai-channel-balance-btn'].disabled, false);
});
