/* Independent home page; AI.Channels remains the only persisted source of truth. */
(() => {
    'use strict';
    const state = { ai: null, selected: new Set(), results: {}, busy: false, editing: null, original: null, bound: false };
    const el = id => document.getElementById(`api-keys-${id}`);
    const allowed = () => typeof hasPermission === 'function' && hasPermission('config:write');
    const clone = value => JSON.parse(JSON.stringify(value));
    const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const presets = {
        openai: ['OpenAI', 'openai_compatible', 'https://api.openai.com/v1'],
        claude: ['Anthropic', 'claude', 'https://api.anthropic.com'],
        deepseek: ['DeepSeek', 'openai_compatible', 'https://api.deepseek.com/v1'],
        siliconflow: ['SiliconFlow', 'openai_compatible', 'https://api.siliconflow.cn/v1'],
        moonshot: ['Moonshot', 'openai_compatible', 'https://api.moonshot.cn/v1'],
        openrouter: ['OpenRouter', 'openai_compatible', 'https://openrouter.ai/api/v1']
    };
    function vendor(channel) {
        try {
            const host = new URL(channel.base_url).hostname;
            return Object.values(presets).find(p => new URL(p[2]).hostname === host)?.[0] || '自定义';
        } catch (_) { return '自定义'; }
    }
    // 后端 status 取值为 available / unavailable / error；unavailable 表示该服务商无余额接口
    function balanceLabel(data) {
        if (data.status === 'available') return (data.amounts || []).map(a => `${a.remaining} ${a.currency}`).join(' / ') || '未返回余额';
        return data.status === 'unavailable' ? '服务商不支持' : '查询失败';
    }
    function message(text) { el('message').textContent = text; }
    async function request(url, options = {}) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 40000);
        try {
            const response = await apiFetch(url, { ...options, signal: controller.signal });
            if (!response.ok) throw new Error(response.status === 409 ? '配置已被其他页面修改，请刷新后重试。' : response.status === 403 ? '权限不足。' : '请求失败，请重试。');
            return await response.json();
        } catch (error) {
            if (error.name === 'AbortError') throw new Error('请求超时，请刷新确认服务器状态后重试。');
            throw error;
        } finally { clearTimeout(timer); }
    }
    const post = (url, body, method = 'POST') => request(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    function render() {
        const channels = state.ai?.channels || {};
        const ids = Object.keys(channels);
        state.selected = new Set([...state.selected].filter(id => Object.hasOwn(channels, id)));
        el('count').textContent = `${ids.length} 个密钥 · 已选 ${state.selected.size}`;
        el('all').checked = ids.length > 0 && state.selected.size === ids.length;
        el('all').indeterminate = state.selected.size > 0 && state.selected.size < ids.length;
        el('rows').innerHTML = ids.map(id => {
            const ch = channels[id], result = state.results[id] || {};
            return `<tr><td><input type="checkbox" data-select="${esc(id)}" aria-label="选择 ${esc(ch.name || id)}" ${state.selected.has(id) ? 'checked' : ''}></td><td><strong>${esc(ch.name || id)}</strong>${id === state.ai.default_channel ? '<span class="api-keys-default">默认</span>' : ''}<small>${esc(vendor(ch))}</small></td><td><code>${ch.api_key ? '••••••••' : '未配置'}</code></td><td>${esc(ch.model || '—')}</td><td class="api-keys-url">${esc(ch.base_url || '—')}</td><td>${esc(result.test || '未测试')}</td><td>${esc(result.balance || '未查询')}</td><td><div class="api-keys-row-actions">${[['edit', '编辑'], ['test', '测试'], ['balance', '余额'], ['default', '设为默认'], ['delete', '删除']].map(([action, label]) => `<button type="button" class="btn-secondary" data-action="${action}" data-id="${esc(id)}" ${action === 'default' && id === state.ai.default_channel ? 'disabled' : ''}>${label}</button>`).join('')}</div></td></tr>`;
        }).join('') || '<tr><td colspan="8">暂无 API Key，请添加通道。</td></tr>';
        document.querySelectorAll('#page-api-keys button, #page-api-keys input, #page-api-keys select').forEach(node => {
            node.disabled = state.busy || !allowed() || (node.dataset.action === 'default' && node.dataset.id === state.ai?.default_channel);
        });
        el('test').disabled ||= !state.selected.size;
        el('balance').disabled ||= !state.selected.size;
        el('add').disabled ||= !state.ai;
    }
    async function load() {
        const cfg = await request('/api/config');
        state.ai = clone(cfg.ai?.channels ? cfg.ai : ensureAIConfigShape(cfg));
        state.results = {};
        if (typeof populateChatAIChannelSelect === 'function') populateChatAIChannelSelect(state.ai);
    }
    async function locked(work) {
        if (!allowed() || state.busy) return;
        state.busy = true;
        render();
        try { await work(); } catch (error) { message(error.message || '操作失败。'); }
        finally { state.busy = false; render(); }
    }
    // Merge only the requested mutation into a fresh snapshot, guarded by backend CAS.
    function mergeMutation(ai, mutation) {
        const next = clone(ai);
        next.channels ||= {};
        const exists = Object.hasOwn(next.channels, mutation.id);
        if (mutation.kind !== 'add' && !exists) throw new Error('该通道已删除，请刷新。');
        if (mutation.kind === 'add' && exists) throw new Error('通道 ID 冲突，请重试。');
        if (mutation.original && JSON.stringify(next.channels[mutation.id]) !== JSON.stringify(mutation.original)) throw new Error('该通道已更改，请取消编辑并刷新。');
        if (mutation.kind === 'delete') {
            if (Object.keys(next.channels).length <= 1) throw new Error('至少保留一个 AI 通道。');
            if (next.default_channel === mutation.id) throw new Error('请先将其他通道设为默认，再删除此通道。');
            delete next.channels[mutation.id];
        } else if (mutation.kind === 'default') next.default_channel = mutation.id;
        else next.channels[mutation.id] = { ...(next.channels[mutation.id] || {}), ...mutation.channel };
        if (!next.default_channel) next.default_channel = mutation.id;
        return next;
    }
    async function save(mutation) {
        const latest = await request('/api/config');
        const expected = latest.ai;
        const next = mergeMutation(expected || ensureAIConfigShape(latest), mutation);
        await post('/api/config', { ai: next, ...(expected ? { ai_expected: expected } : {}) }, 'PUT');
        // PUT persists; distinguish apply failures so users do not unknowingly duplicate saves.
        try { await post('/api/config/apply', {}); }
        catch (_) { await load(); throw new Error('配置已保存，但应用失败。请在设置中重新应用配置。'); }
        await load();
        message('配置已保存并应用。');
    }
    function edit(id = null) {
        if (!allowed() || state.busy) return;
        state.editing = id;
        state.original = id ? clone(state.ai.channels[id]) : null;
        const ch = state.original || {};
        el('form').reset();
        el('editor-title').textContent = id ? '编辑 API Key' : '添加 API Key';
        el('name').value = ch.name || '';
        el('provider').value = ch.provider === 'claude' ? 'claude' : 'openai_compatible';
        el('url').value = ch.base_url || '';
        el('model').value = ch.model || '';
        el('secret').required = !id;
        el('form-message').textContent = '';
        el('dialog').showModal();
        el('name').focus();
    }
    async function submit(event) {
        event.preventDefault();
        if (!allowed() || state.busy) return;
        const original = state.original;
        const key = el('secret').value.trim();
        if (!key && (!original || el('url').value.trim() !== original.base_url || el('provider').value !== (original.provider === 'claude' ? 'claude' : 'openai_compatible'))) {
            el('form-message').textContent = '新增或更换服务商地址时，请输入 API Key。'; return;
        }
        const url = new URL(el('url').value.trim());
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) { el('form-message').textContent = '请输入不含账号密码的 HTTP(S) 地址。'; return; }
        const channel = { name: el('name').value.trim(), provider: el('provider').value, base_url: el('url').value.trim(), model: el('model').value.trim(), api_key: key || original?.api_key || '' };
        if (!channel.name || !channel.model || !channel.api_key) { el('form-message').textContent = '请填写名称、模型和密钥。'; return; }
        const id = state.editing || `key-${crypto.randomUUID()}`;
        if (!original) Object.assign(channel, { max_total_tokens: 120000, max_completion_tokens: 32768, reasoning: { mode: 'auto', profile: vendor(channel) === 'DeepSeek' ? 'deepseek' : 'auto', allow_client_reasoning: true } });
        await locked(async () => {
            try { await save({ kind: original ? 'edit' : 'add', id, channel, original }); el('dialog').close(); }
            catch (error) { el('form-message').textContent = error.message; }
        });
    }
    async function check(ids, kind) {
        if (!ids.length) return;
        if (kind === 'test' && !confirm(`测试 ${ids.length} 个通道可能产生 API 费用，继续？`)) return;
        await locked(async () => {
            for (const id of ids) {
                const ch = state.ai.channels[id];
                if (!ch) continue;
                const result = state.results[id] ||= {};
                result[kind] = '查询中…'; render();
                try {
                    if (!ch.api_key || !ch.base_url || (kind === 'test' && !ch.model)) { result[kind] = '配置不完整'; continue; }
                    const data = await post(kind === 'test' ? '/api/config/test-openai' : '/api/config/channel-balance', kind === 'test' ? { provider: ch.provider, base_url: ch.base_url, api_key: ch.api_key, model: ch.model } : { channel_id: id });
                    if (kind === 'test') result.test = data.success ? `可用${data.latency_ms != null ? ` · ${data.latency_ms} ms` : ''}` : '测试失败';
                    else result.balance = balanceLabel(data);
                    // Never render upstream error text: it may contain submitted credentials.
                } catch (_) { result[kind] = '请求失败或超时'; }
                finally { render(); }
            }
            message(`${kind === 'test' ? '测试' : '余额查询'}完成，共 ${ids.length} 个通道。`);
        });
    }
    function bind() {
        if (state.bound) return;
        state.bound = true;
        el('add').onclick = () => edit();
        el('refresh').onclick = () => locked(async () => { await load(); message('已刷新。'); });
        el('test').onclick = () => check([...state.selected], 'test');
        el('balance').onclick = () => check([...state.selected], 'balance');
        el('all').onchange = event => { state.selected = new Set(event.target.checked ? Object.keys(state.ai?.channels || {}) : []); render(); };
        el('rows').onchange = event => { const id = event.target.dataset.select; if (id) { event.target.checked ? state.selected.add(id) : state.selected.delete(id); render(); } };
        el('rows').onclick = event => {
            const button = event.target.closest('button[data-action]');
            if (!button || state.busy || !allowed()) return;
            const { action, id } = button.dataset;
            if (action === 'edit') edit(id);
            else if (action === 'test' || action === 'balance') check([id], action);
            else if (action !== 'delete' || confirm(`确定删除通道「${state.ai.channels[id].name || id}」？`)) locked(() => save({ kind: action, id, original: state.ai.channels[id] }));
        };
        el('form').onsubmit = submit;
        el('cancel').onclick = () => el('dialog').close();
        el('dialog').addEventListener('cancel', event => { if (state.busy) event.preventDefault(); });
        el('dialog').addEventListener('close', () => { el('secret').value = ''; state.original = null; state.editing = null; });
        el('vendor').onchange = () => {
            const preset = presets[el('vendor').value];
            if (!preset) return;
            el('provider').value = preset[1]; el('url').value = preset[2];
            el('secret').value = ''; el('secret').required = true; el('model').value = '';
        };
    }
    window.initAPIKeysPage = async () => {
        if (!allowed()) return;
        bind();
        await locked(async () => { message('加载中…'); await load(); message(''); });
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = { mergeMutation, esc, vendor, balanceLabel };
})();
