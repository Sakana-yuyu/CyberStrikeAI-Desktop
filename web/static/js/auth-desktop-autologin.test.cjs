const fs = require('node:fs');
const test = require('node:test');
const assert = require('node:assert/strict');

const auth = fs.readFileSync('web/static/js/auth.js', 'utf8');
const html = fs.readFileSync('web/templates/index.html', 'utf8');
const mainGo = fs.readFileSync('cmd/desktop/main.go', 'utf8');
const appGo = fs.readFileSync('internal/app/app.go', 'utf8');

function functionSource(source, name, nextName) {
    const start = source.indexOf(`function ${name}(`);
    const end = source.indexOf(`function ${nextName}(`, start);
    assert.notEqual(start, -1, `${name} should exist`);
    assert.notEqual(end, -1, `${nextName} should follow ${name}`);
    return source.slice(start, end);
}

test('桌面端引导令牌从 URL fragment 提取并立即清除', () => {
    const source = functionSource(auth, 'extractDesktopBootstrapToken', 'exchangeDesktopToken');
    assert.match(source, /\^#dt=\(\[A-Za-z0-9_\-\]\+\)/);
    assert.match(source, /history\.replaceState\(null, '', window\.location\.pathname \+ window\.location\.search\)/);
});

test('引导令牌换取会话走专用接口且失败不抛出', () => {
    const source = functionSource(auth, 'exchangeDesktopToken', 'desktopAutoReconnect');
    assert.match(source, /\/api\/auth\/desktop-session/);
    assert.match(source, /desktop_token/);
    assert.match(source, /saveAuth\(result\.token, result\.expires_at/);
    assert.match(source, /return false/);
});

test('应用初始化在弹登录层前先尝试桌面自动登录', () => {
    const start = auth.indexOf('async function initializeApp(');
    const end = auth.indexOf('\n}', start) + 2;
    assert.notEqual(start, -1, 'initializeApp should exist');
    const source = auth.slice(start, end);
    assert.match(source, /extractDesktopBootstrapToken\(\)/);
    assert.match(source, /window\.__csDesktopToken = bootstrapToken/);
    assert.match(source, /if \(window\.__csDesktopToken && await desktopAutoReconnect\(\)\)/);
    // 桌面分支必须位于 showLoginOverlay 兜底之前
    assert.ok(
        source.indexOf('desktopAutoReconnect()') < source.indexOf('showLoginOverlay()'),
        'desktop auto-login must run before falling back to login overlay'
    );
});

test('apiFetch 在 401 时用桌面令牌静默重连并重试一次', () => {
    const source = functionSource(auth, 'apiFetch', 'apiUploadWithProgress');
    assert.match(source, /response\.status === 401 && window\.__csDesktopToken/);
    assert.match(source, /await desktopAutoReconnect\(\)/);
    assert.match(source, /response = await fetch\(url, opts\)/);
});

test('会话校验失败时先尝试桌面重连再弹登录层', () => {
    const source = functionSource(auth, 'ensureAuthenticated', 'handleUnauthorized');
    assert.match(source, /window\.__csDesktopToken && await desktopAutoReconnect\(\)/);
});

test('桌面端入口生成一次性令牌并以 fragment 传入窗口 URL', () => {
    assert.match(mainGo, /generateDesktopToken\(\)/);
    assert.match(mainGo, /crypto\/rand/);
    assert.match(mainGo, /cfg\.DesktopBootstrapToken = desktopToken/);
    assert.match(mainGo, /openDesktopWindow\(baseURL \+ "#dt=" \+ desktopToken\)/);
    assert.match(mainGo, /cfg\.DesktopMode = true/);
});

test('desktop-session 路由仅在桌面模式注册', () => {
    assert.match(appGo, /if app\.config\.DesktopMode \{/);
    assert.match(appGo, /authRoutes\.POST\("\/desktop-session"/);
});

test('auth.js 缓存版本已更新', () => {
    assert.match(html, /\/static\/js\/auth\.js\?v=20260923-profile-1/);
});

test('引导令牌在 head 内联脚本截获，先于 router.js 的 hash 重写', () => {
    // router.js 的 initRouter 在脚本加载时把 hash 重写为 #dashboard，会冲掉 #dt=；
    // 因此截获必须发生在 head 内联脚本里（router.js 在 body 第 40 行加载）
    const capture = html.indexOf('window.__csDesktopToken = m[1]');
    const routerScript = html.indexOf('/static/js/router.js');
    assert.ok(capture !== -1, 'head inline capture script should exist');
    assert.ok(routerScript !== -1, 'router.js script tag should exist');
    assert.ok(capture < routerScript, 'token capture must run before router.js loads');
    const captureBlock = html.slice(html.lastIndexOf('<script>', capture), html.indexOf('</script>', capture));
    assert.match(captureBlock, /\^#dt=\(\[A-Za-z0-9_\-\]\+\)/);
    assert.match(captureBlock, /history\.replaceState\(null, '', window\.location\.pathname \+ window\.location\.search\)/);
});
