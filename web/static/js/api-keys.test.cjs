const test = require('node:test');
const assert = require('node:assert/strict');
global.window = {};
const { mergeMutation, esc, vendor, balanceLabel } = require('./api-keys.js');
const fixture = () => ({ default_channel: 'a', future_option: true, channels: { a: { name: 'A', api_key: 'secret-a', reasoning: { mode: 'on' } }, b: { name: 'B', api_key: 'secret-b' } } });
test('edit merges only selected fields, preserves advanced channel and AI options', () => {
    const ai = fixture();
    const result = mergeMutation(ai, { kind: 'edit', id: 'a', original: ai.channels.a, channel: { name: 'Renamed' } });
    assert.equal(result.channels.a.name, 'Renamed');
    assert.equal(result.channels.a.api_key, 'secret-a');
    assert.deepEqual(result.channels.a.reasoning, { mode: 'on' });
    assert.deepEqual(result.channels.b, ai.channels.b);
    assert.equal(result.future_option, true);
    assert.equal(ai.channels.a.name, 'A');
});
test('fresh unrelated channels survive add and delete', () => {
    const ai = fixture();
    ai.channels.concurrent = { name: 'Concurrent' };
    const added = mergeMutation(ai, { kind: 'add', id: 'new', channel: { name: 'New' } });
    const deleted = mergeMutation(added, { kind: 'delete', id: 'b' });
    assert.ok(deleted.channels.concurrent);
    assert.ok(deleted.channels.new);
    assert.equal(deleted.channels.b, undefined);
});
test('stale edits, missing channels and duplicate IDs are rejected', () => {
    assert.throws(() => mergeMutation(fixture(), { kind: 'edit', id: 'a', original: { name: 'Old' } }));
    assert.throws(() => mergeMutation(fixture(), { kind: 'edit', id: 'missing' }));
    assert.throws(() => mergeMutation(fixture(), { kind: 'add', id: 'a' }));
});
test('default and last channel cannot be deleted; default can be switched', () => {
    assert.throws(() => mergeMutation(fixture(), { kind: 'delete', id: 'a' }));
    const switched = mergeMutation(fixture(), { kind: 'default', id: 'b' });
    assert.equal(switched.default_channel, 'b');
    const single = mergeMutation(switched, { kind: 'delete', id: 'a' });
    assert.throws(() => mergeMutation(single, { kind: 'delete', id: 'b' }));
});
test('HTML values escaped and vendor detection requires exact host', () => {
    assert.equal(esc('<img onerror="x">'), '&lt;img onerror=&quot;x&quot;&gt;');
    assert.equal(vendor({ base_url: 'https://api.deepseek.com/v1' }), 'DeepSeek');
    assert.equal(vendor({ base_url: 'https://api.deepseek.com.attacker.test/v1' }), '自定义');
});
test('restricted deep link resumes after auth and still rejects missing permission', () => {
    const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
    const events = {}, switched = [];
    const context = { window: { location: { hash: '#api-keys' }, addEventListener: (name, cb) => { events[name] = cb; } }, document: { addEventListener() {} }, setTimeout, clearTimeout };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(__dirname, 'router.js'), 'utf8'), context);
    vm.runInContext('switchPage = function(page) { if (hasPermission("config:write")) record(page); };', context);
    context.record = page => switched.push(page);
    context.hasPermission = () => false;
    events['app-authenticated']();
    assert.deepEqual(switched, []);
    context.hasPermission = () => true;
    events['app-authenticated']();
    assert.deepEqual(switched, ['api-keys']);
    context.window.location.hash = '#chat';
    events['app-authenticated']();
    assert.deepEqual(switched, ['api-keys']);
});

test('successful authentication emits route-ready event', () => {
    const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
    const events = [];
    const context = { window: { dispatchEvent: event => events.push(event.type) }, document: { addEventListener() {} }, Event };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(__dirname, 'auth.js'), 'utf8'), context);
    vm.runInContext('resolveAuthPromises(false); resolveAuthPromises(true);', context);
    assert.deepEqual(events, ['app-authenticated']);
});

test('top-level page, script and permission navigation are wired', () => {
    const fs = require('node:fs'), path = require('node:path');
    const html = fs.readFileSync(path.join(__dirname, '../../templates/index.html'), 'utf8');
    assert.match(html, /data-page="api-keys" data-require-permission="config:write"/);
    assert.match(html, /id="page-api-keys" class="page"/);
    assert.match(html, /src="\/static\/js\/api-keys.js/);
    assert.match(fs.readFileSync(path.join(__dirname, 'auth.js'), 'utf8'), /'api-keys': 'config:write'/);
});
test('balance label distinguishes unsupported provider from query failure', () => {
    assert.equal(balanceLabel({ status: 'unavailable', message: 'no adapter' }), '服务商不支持');
    assert.equal(balanceLabel({ status: 'error' }), '查询失败');
    assert.equal(balanceLabel({ status: 'available', amounts: [{ currency: 'CNY', remaining: '12.34' }] }), '12.34 CNY');
    assert.equal(balanceLabel({ status: 'available', amounts: [] }), '未返回余额');
});
