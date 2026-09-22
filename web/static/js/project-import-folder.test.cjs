const fs = require('node:fs');
const test = require('node:test');
const assert = require('node:assert/strict');

const projects = fs.readFileSync('web/static/js/projects.js', 'utf8');
const html = fs.readFileSync('web/templates/index.html', 'utf8');
const guards = fs.readFileSync('web/static/js/rbac-guards.js', 'utf8');
const zh = JSON.parse(fs.readFileSync('web/static/i18n/zh-CN.json', 'utf8'));
const en = JSON.parse(fs.readFileSync('web/static/i18n/en-US.json', 'utf8'));

function functionSource(source, name, nextName) {
    const start = source.indexOf(`function ${name}(`);
    const end = source.indexOf(`function ${nextName}(`, start);
    assert.notEqual(start, -1, `${name} should exist`);
    assert.notEqual(end, -1, `${nextName} should follow ${name}`);
    return source.slice(start, end);
}

test('项目页与项目详情提供受权限保护的导入入口', () => {
    assert.match(html, /onclick="showEmptyProjectModal\(\)"[\s\S]*?data-require-permission="project:write"/);
    assert.match(html, /onclick="showNewProjectModal\(\)"[\s\S]*?data-require-permission="project:write"/);
    assert.match(html, /onclick="showImportFolderModalForCurrentProject\(\)"[\s\S]*?data-require-permission="project:write"/);
    assert.match(guards, /showImportFolderModal: 'project:write'/);
    assert.match(guards, /showEmptyProjectModal: 'project:write'/);
    assert.match(guards, /startProjectFolderImport: 'project:write'/);
    assert.match(guards, /linkProjectFolder: 'project:write'/);
});

test('导入弹窗包含目录选择、目标切换与进度反馈', () => {
    assert.match(html, /id="project-import-modal"/);
    assert.match(html, /id="project-import-pick-btn"/);
    assert.match(html, /name="project-import-target"/);
    assert.match(html, /id="project-import-progress-fill"/);
    assert.match(html, /id="project-import-existing-select"/);
    assert.match(html, /projects\.importModalTitle/);
    assert.match(html, /showEmptyProjectModalFromImport\(\)/);
    assert.match(projects, /input\.webkitdirectory = true/);
    assert.match(projects, /function showNewProjectModal\(\)[\s\S]*?showImportFolderModal\(\)/);
    assert.match(projects, /function showEmptyProjectModal\(/);
});

test('关联模式默认开启：路径输入 + 原生浏览 + 不复制', () => {
    assert.match(html, /name="project-import-mode"[\s\S]*?value="link"[\s\S]*?checked/);
    assert.match(html, /id="project-import-path"/);
    assert.match(html, /id="project-import-browse-btn"[\s\S]*?onclick="browseProjectImportFolder\(\)"/);
    const browse = projects.indexOf('function browseProjectImportFolder(');
    const browseEnd = projects.indexOf('function ', browse + 10);
    const src = projects.slice(browse, browseEnd);
    assert.match(src, /\/api\/projects\/pick-folder/);
    assert.match(src, /res\.status === 404/);

    const link = projects.indexOf('function linkProjectFolder(');
    const linkEnd = projects.indexOf('function ', link + 10);
    const linkSrc = projects.slice(link, linkEnd);
    assert.match(linkSrc, /\/api\/projects\/link-folder/);
    assert.match(linkSrc, /body\.projectId = projectId/);
    assert.match(linkSrc, /\{ path: linkedPath \}/);
});

test('提交入口按模式分流：关联走 linkProjectFolder，复制走原上传', () => {
    const start = projects.indexOf('async function startProjectFolderImport(');
    const end = projects.indexOf('\n}', start);
    const src = projects.slice(start, end);
    assert.match(src, /!== 'copy'\) \{\s*await linkProjectFolder\(\);/);
});

test('导入按批次上传并携带相对路径', () => {
    const start = projects.indexOf('function startProjectFolderImport(');
    assert.notEqual(start, -1, 'startProjectFolderImport should exist');
    const source = projects.slice(start);
    assert.match(source, /form\.append\('paths', item\.rel\)/);
    assert.match(source, /form\.append\('files', item\.file, item\.file\.name\)/);
    assert.match(source, /\/api\/projects\/import-folder/);
    assert.match(source, /slice\(off, off \+ PROJECT_IMPORT_BATCH_SIZE\)/);
});

test('前端跳过名单与服务端一致', () => {
    for (const dir of ['node_modules', '.git', '__pycache__']) {
        assert.match(projects, new RegExp(`'${dir}'`));
    }
    assert.match(projects, /PROJECT_IMPORT_BATCH_SIZE = 40/);
});

test('导入文案在中英文语言包中成对出现', () => {
    const importKeys = Object.keys(zh.projects).filter((k) => k.startsWith('import'));
    assert.ok(importKeys.length >= 20, `expected import i18n keys, got ${importKeys.length}`);
    for (const key of importKeys) {
        assert.ok(en.projects[key], `en-US missing projects.${key}`);
        assert.ok(String(zh.projects[key]).trim().length > 0, `zh-CN empty projects.${key}`);
    }
});
