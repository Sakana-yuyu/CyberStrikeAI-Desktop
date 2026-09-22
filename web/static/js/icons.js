/**
 * 统一 SVG 图标库（lucide 风格，stroke=currentColor）。
 * 用于替换全局 emoji：innerHTML 场景用 csIcon('name') 注入 SVG 字符串；
 * textContent/纯文本场景不要塞 emoji，直接用 csTextIcon() 拿纯文本符号或留空。
 */
(function () {
    'use strict';

    var PATHS = {
        // 状态
        check: '<polyline points="20 6 9 17 4 12"/>',
        'check-circle': '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
        'x-circle': '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>',
        x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
        warning: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
        info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
        ban: '<circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>',
        shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
        'shield-check': '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/>',
        hourglass: '<path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"/><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/>',
        clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
        timer: '<line x1="10" x2="14" y1="2" y2="2"/><line x1="12" x2="15" y1="14" y2="11"/><circle cx="12" cy="14" r="8"/>',
        pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
        play: '<polygon points="6 3 20 12 6 21 6 3"/>',
        'stop-square': '<rect x="5" y="5" width="14" height="14" rx="2"/>',
        'skip-forward': '<polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/>',
        refresh: '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>',
        shuffle: '<polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/>',
        'arrow-right': '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>',
        'corner-right': '<polyline points="15 10 20 15 15 20"/><path d="M4 4v7a4 4 0 0 0 4 4h12"/>',
        // 对象
        wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
        settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.84 1 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
        robot: '<rect x="4" y="8" width="16" height="12" rx="2"/><circle cx="12" cy="4" r="1.5"/><path d="M12 5.5V8"/><path d="M8.5 14h.01"/><path d="M15.5 14h.01"/><path d="M9 17.5h6"/>',
        brain: '<path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z"/><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z"/>',
        link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
        memo: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
        book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
        judge: '<path d="m14 13-8.5 8.5a2.12 2.12 0 1 1-3-3L11 10"/><path d="m16 16 6-6"/><path d="m8 8 6-6"/><path d="m9 7 8 8"/><path d="m21 11-8-8"/>',
        compass: '<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>',
        chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
        pin: '<line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/>',
        folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
        file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
        user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
        'chart-bar': '<line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/>',
        clipboard: '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>',
        search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
        globe: '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
        download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
        upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
        trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
        satellite: '<path d="M13 7 9 3 3 9l4 4"/><path d="m17 11 4 4-6 6-4-4"/><path d="m8 12 4 4"/><path d="m13 7 4-4 4 4-4 4z"/><path d="m9 3 6 6"/><path d="M16 8 9 15"/>',
        broom: '<path d="m13 11 9-9"/><path d="M14.6 12.6c.8.8.9 2.1-.1 3l-3.2-3.2c.9-1 2.2-.9 3 .1z"/><path d="m11.5 12.5-5.7 1.9c-.8.3-1.4 1-1.6 1.9L3 22l5.7-1.2c.9-.2 1.6-.8 1.9-1.6l1.9-5.7z"/>',
        database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>',
        layers: '<path d="m12 2 8 4-8 4-8-4 8-4Z"/><path d="m4 10 8 4 8-4"/><path d="m4 14 8 4 8-4"/>',
        paperclip: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
        pencil: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
        trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
        bulb: '<path d="M9 18h6"/><path d="M10 22h4"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14"/>',
        scroll: '<path d="M8 21h12a2 2 0 0 0 2-2v-2H10v2a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v3h4"/><path d="M19 17V5a2 2 0 0 0-2-2H4"/>',
        terminal: '<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>',
        gauge: '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
        monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>',
        key: '<path d="m21 2-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4"/>',
        lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
        audit: '<path d="M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3"/><path d="M18.37 3.63a2.12 2.12 0 0 1 3 3L12 16l-4 1 1-4Z"/>',
        workflow: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><path d="M10 6.5h6a2 2 0 0 1 2 2V14"/>',
        wifi: '<path d="M5 13a10 10 0 0 1 14 0"/><path d="M8.5 16.5a5 5 0 0 1 7 0"/><path d="M2 9.5a15 15 0 0 1 20 0"/><line x1="12" y1="20" x2="12.01" y2="20"/>',
        bug: '<path d="m8 2 1.88 1.88"/><path d="M14.12 3.88 16 2"/><path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6z"/><path d="M12 20v-9"/><path d="M6.53 9C4.6 8.8 3 7.1 3 5"/><path d="M6 13H2"/><path d="M3 21c0-2.1 1.7-3.9 3.8-4"/><path d="M20.97 5c0 2.1-1.6 3.8-3.5 4"/><path d="M22 13h-4"/><path d="M17.2 17c2.1.1 3.8 1.9 3.8 4"/>',
        'list-checks': '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>',
        'square-stack': '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 2v2"/><path d="M16 2v2"/><path d="M2 8h2"/><path d="M2 16h2"/><path d="M20 8h2"/><path d="M20 16h2"/><path d="M8 22v-2"/><path d="M16 22v-2"/>',
        target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
        microscope: '<path d="M6 18h8"/><path d="M3 22h18"/><path d="M14 22a7 7 0 1 0 0-14h-1"/><path d="M9 14h2"/><path d="M9 12a2 2 0 0 1-2-2V6h6v4a2 2 0 0 1-2 2z"/><path d="M12 6V3a1 1 0 0 0-1-1H9a1 1 0 0 0-1 1v3"/>',
        flask: '<path d="M10 2v7.31"/><path d="M14 9.3V1.99"/><path d="M8.5 2h7"/><path d="M14 9.3a6.5 6.5 0 1 1-4 0"/><path d="M5.52 16h12.96"/>',
        zap: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
        star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
        eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
        flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>',
        flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
        fingerprint: '<path d="M2 12C2 6.5 6.5 2 12 2a10 10 0 0 1 8 4"/><path d="M5 19.5C5.5 18 6 15 6 12c0-.7.12-1.37.34-2"/><path d="M17.29 21.02c.12-.6.43-2.3.5-3.02"/><path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4"/><path d="M8.65 22c.21-.66.45-1.32.57-2"/><path d="M14 13.12c0 2.38 0 6.38-1 8.88"/><path d="M2 16h.01"/><path d="M21.8 16c.2-2 .131-5.354 0-6"/><path d="M9 6.8a6 6 0 0 1 9 5.2c0 .47 0 1.17-.02 2"/>'
    };

    /**
     * 返回内联 SVG 字符串，用于 innerHTML / 模板字符串场景。
     * csIcon('check') 或 csIcon('check', {size: 14, cls: 'extra'})
     */
    function csIcon(name, opts) {
        var body = PATHS[name];
        if (!body) return '';
        opts = opts || {};
        var size = opts.size || 14;
        var cls = 'cs-icon cs-icon-' + name + (opts.cls ? ' ' + opts.cls : '');
        var sw = opts.strokeWidth || 2;
        return '<svg class="' + cls + '" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" ' +
            'fill="none" stroke="currentColor" stroke-width="' + sw + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
            body + '</svg>';
    }

    /** 仅需要一个行内图标 + 文本时：csIconText('check', '完成') -> icon + 文本 span */
    function csIconText(name, text, opts) {
        return '<span class="cs-icon-text">' + csIcon(name, opts) + '<span>' + (text == null ? '' : text) + '</span></span>';
    }

    /** 时间线条目类型 → 图标名（替代原先标题里的 emoji 前缀） */
    var TIMELINE_TYPE_ICONS = {
        workflow_start: 'workflow',
        workflow_complete: 'check-circle',
        workflow_paused: 'pause',
        workflow_hitl_waiting: 'judge',
        node_start: 'play',
        node_complete: 'check',
        condition: 'shuffle',
        branch: 'corner-right',
        tool_node: 'wrench',
        tool_call: 'wrench',
        tool_calls_detected: 'wrench',
        tool_result: 'wrench',
        agent_output: 'robot',
        workflow_agent_output: 'robot',
        eino_agent_reply: 'chat',
        hitl_interrupt: 'judge',
        hitl_audit_agent_started: 'judge',
        hitl_audit_agent: 'judge',
        hitl_resumed: 'judge',
        hitl_rejected: 'judge',
        thinking: 'brain',
        reasoning_chain: 'link',
        planning: 'memo',
        knowledge_retrieval: 'book',
        iteration: 'refresh',
        eino_run_retry: 'refresh',
        eino_pending_orphaned: 'broom',
        cancelled: 'ban',
        task_cancelled: 'ban',
        error: 'x-circle',
        iteration_limit: 'ban',
        user_interrupt_continue: 'pause',
        eino_usage_summary: 'chart-bar',
        progress: 'info'
    };

    /** 返回该时间线类型对应的 SVG 图标串；无映射返回空串 */
    function csTimelineIcon(type) {
        var name = TIMELINE_TYPE_ICONS[type];
        return name ? csIcon(name, { size: 13 }) : '';
    }

    /** 工作区导航项（agent-workspace-link）data-page / data-settings-section → 图标名 */
    var WORKSPACE_LINK_ICONS = {
        'settings:basic': 'settings',
        'settings:hitl': 'judge',
        'settings:audit': 'audit',
        'settings:robots': 'robot',
        'settings:c2': 'satellite',
        'settings:infocollect': 'database',
        'settings:knowledge': 'book',
        'api-keys': 'key',
        'hitl': 'list-checks',
        'tool-guard': 'shield-check',
        'mcp-management': 'square-stack',
        'mcp-monitor': 'monitor',
        'knowledge-management': 'book',
        'knowledge-retrieval-logs': 'search',
        'skills-management': 'bulb',
        'skills-monitor': 'gauge',
        'agents-management': 'robot',
        'roles-management': 'user',
        'projects': 'folder',
        'asset-overview': 'chart-bar',
        'asset-library': 'database',
        'info-collect': 'compass',
        'vulnerabilities': 'bug',
        'tasks': 'list-checks',
        'workflows': 'workflow',
        'webshell': 'terminal',
        'c2-listeners': 'wifi',
        'c2-sessions': 'link',
        'c2-tasks': 'list-checks',
        'c2-payloads': 'file',
        'c2-events': 'clock',
        'c2-profiles': 'shuffle',
        'chat-files': 'paperclip',
        'dashboard': 'gauge',
    };

    function workspaceLinkIconName(link) {
        var page = link.getAttribute('data-page') || '';
        var section = link.getAttribute('data-settings-section') || '';
        if (page === 'settings' && section && WORKSPACE_LINK_ICONS['settings:' + section]) {
            return WORKSPACE_LINK_ICONS['settings:' + section];
        }
        if (page && WORKSPACE_LINK_ICONS[page]) return WORKSPACE_LINK_ICONS[page];
        // 无 data-page 的外链项：API 文档 / GitHub
        var onclick = link.getAttribute('onclick') || '';
        if (onclick.indexOf('api-docs') !== -1) return 'memo';
        if (onclick.indexOf('github.com') !== -1) return 'globe';
        var i18n = link.getAttribute('data-i18n') || '';
        if (i18n === 'settings.nav.terminal') return 'terminal';
        return '';
    }

    /** 左下角「菜单」胶囊弹出项 data-agent-rail-action → 图标名 */
    var RAIL_MENU_ICONS = {
        dashboard: 'gauge',
        'asset-overview': 'layers',
        terminal: 'terminal',
        settings: 'settings'
    };

    /** 为 .agent-workspace-link / .agent-rail-menu-item 前置图标；幂等，可重复调用 */
    function csDecorateWorkspaceNav(root) {
        var scope = root && root.querySelectorAll ? root : document;
        var links = scope.querySelectorAll('.agent-workspace-link');
        for (var i = 0; i < links.length; i++) {
            var link = links[i];
            if (link.querySelector('.agent-workspace-link-icon')) continue;
            var name = workspaceLinkIconName(link);
            if (!name) continue;
            link.insertAdjacentHTML('afterbegin',
                '<span class="agent-workspace-link-icon" aria-hidden="true">' + csIcon(name, { size: 15 }) + '</span>');
        }
        var items = scope.querySelectorAll('.agent-rail-menu-item[data-agent-rail-action]');
        for (var j = 0; j < items.length; j++) {
            var item = items[j];
            if (item.querySelector('.agent-workspace-link-icon')) continue;
            var action = item.getAttribute('data-agent-rail-action') || '';
            var iconName = RAIL_MENU_ICONS[action];
            if (!iconName) continue;
            item.insertAdjacentHTML('afterbegin',
                '<span class="agent-workspace-link-icon" aria-hidden="true">' + csIcon(iconName, { size: 15 }) + '</span>');
        }
    }

    /** 角色/数据字段中可能出现的 emoji → 图标名 */
    var EMOJI_ICON_MAP = {
        '🎯': 'target', '🔍': 'search', '🔬': 'microscope', '🔭': 'microscope',
        '🛡': 'shield', '🕵': 'search', '🧪': 'flask', '⚗': 'flask',
        '🐛': 'bug', '🐞': 'bug', '💻': 'monitor', '🖥': 'monitor',
        '🌐': 'globe', '📡': 'satellite', '📶': 'wifi',
        '🔒': 'lock', '🔓': 'lock', '🔐': 'lock', '🔑': 'key', '🗝': 'key',
        '⚡': 'zap', '🏆': 'trophy', '🥇': 'trophy', '📊': 'chart-bar', '📈': 'chart-bar',
        '🗄': 'database', '💾': 'database', '📁': 'folder', '🗂': 'folder',
        '📝': 'memo', '📄': 'file', '📜': 'scroll', '🤖': 'robot',
        '⚙': 'settings', '🧠': 'brain', '📚': 'book', '📖': 'book',
        '🔗': 'link', '📌': 'pin', '📍': 'pin', '⭐': 'star', '🌟': 'star',
        '💡': 'bulb', '🛠': 'wrench', '🔧': 'wrench', '🔨': 'wrench',
        '🧭': 'compass', '👤': 'user', '👁': 'eye', '🚨': 'warning', '⚠': 'warning',
        '🚩': 'flag', '🏁': 'flag', '🔥': 'flame', '💬': 'chat', '💭': 'chat',
        '🧬': 'fingerprint', '🧾': 'memo', '⏱': 'timer', '⏰': 'clock',
        '⌛': 'hourglass', '⏳': 'hourglass', '🎓': 'book', '🧰': 'wrench',
        '💣': 'flame', '🧲': 'link', '🎲': 'shuffle', '🃏': 'user',
        '🔵': 'check-circle', '🟢': 'check-circle', '🔴': 'x-circle', '✅': 'check'
    };

    var EMOJI_LIKE_RE = /[\u2190-\u2BFF\u{1F000}-\u{1FAFF}\uFE0F\u{1F1E6}-\u{1F1FF}]/u;

    function escapeIconText(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    /** 归一化角色 icon 值：处理 \U0001F3C6 形式的 Unicode 转义 */
    function normalizeRoleIconValue(value) {
        if (value == null) return '';
        var icon = String(value).trim();
        var m = icon.match(/^"?\\U([0-9A-F]{8})"?$/i);
        if (m) {
            try { icon = String.fromCodePoint(parseInt(m[1], 16)); } catch (e) { return ''; }
        }
        return icon;
    }

    /**
     * 解析角色 icon 值 → 图标名。emoji/Unicode 转义映射、PATHS 键名直通；
     * 未知 emoji 返回 'user'；普通文本返回 ''（由 csRoleIcon 转义后原样展示）。
     */
    function csRoleIconName(value) {
        var icon = normalizeRoleIconValue(value);
        if (!icon || icon.charAt(0) === '<') return '';
        var stripped = icon.replace(/\uFE0F/g, '').trim();
        if (PATHS[stripped]) return stripped;
        var name = EMOJI_ICON_MAP[icon] || EMOJI_ICON_MAP[stripped];
        if (name) return name;
        return EMOJI_LIKE_RE.test(icon) ? 'user' : '';
    }

    /**
     * 角色图标渲染：emoji/Unicode 转义 → SVG 图标；已是 SVG 标记直通；
     * 未知 emoji → 默认 user 图标；普通文本（字母/汉字等）转义后原样保留。
     * 返回值可安全插入 innerHTML。
     */
    function csRoleIcon(value, opts) {
        var icon = normalizeRoleIconValue(value);
        if (!icon) return csIcon('user', opts);
        if (icon.charAt(0) === '<') return icon;
        var name = csRoleIconName(icon);
        if (name) return csIcon(name, opts);
        return escapeIconText(icon);
    }

    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', function () { csDecorateWorkspaceNav(document); });
        } else {
            csDecorateWorkspaceNav(document);
        }
    }

    window.csIcon = csIcon;
    window.csIconText = csIconText;
    window.csTimelineIcon = csTimelineIcon;
    window.csRoleIcon = csRoleIcon;
    window.csRoleIconName = csRoleIconName;
    window.csDecorateWorkspaceNav = csDecorateWorkspaceNav;
    window.CS_ICONS = PATHS;
})();
