/**
 * 桌面 Agent 壳：默认停在对话，其余页面从工作区进入，终端贴在对话下方。
 * 仪表盘 / 资产概览嵌入对话主栏；左侧栏 footer 为单一胶囊菜单。
 */
(function () {
    var settingsSection = 'basic';
    var EMBED_PAGES = { dashboard: true, 'asset-overview': true };
    var embeddedPageId = null;
    var pageHomes = Object.create(null);
    var suppressHashSync = false;
    var railMenuOpen = false;

    function currentPageId() {
        if (typeof window.currentPage === 'function') return window.currentPage();
        return '';
    }

    function setConversationTitle(title) {
        var text = String(title || '').trim();
        var heading = document.getElementById('agent-chat-title');
        var fallback = '新对话';
        if (typeof window.t === 'function') {
            var translated = window.t('agentShell.newConversation');
            if (translated && translated !== 'agentShell.newConversation') fallback = translated;
        }
        if (heading) heading.textContent = text || fallback;
        document.title = text ? (text + ' — CyberStrikeAI') : 'CyberStrikeAI';
    }

    function placeRailFooter(pageId) {
        var footer = document.getElementById('agent-rail-footer');
        if (!footer) return;
        var host = pageId === 'chat' || EMBED_PAGES[pageId]
            ? document.getElementById('conversation-sidebar')
            : document.getElementById('agent-workspace-nav');
        if (host && footer.parentElement !== host) host.appendChild(footer);
    }

    function markWorkspaceActive(pageId) {
        var c2Active = false;
        document.querySelectorAll('[data-agent-link]').forEach(function (el) {
            var page = el.getAttribute('data-page') || '';
            var section = el.getAttribute('data-settings-section') || '';
            var active = page === pageId && (pageId !== 'settings' || section === settingsSection);
            el.classList.toggle('is-active', active);
            if (active && el.hasAttribute('data-agent-c2') && page.indexOf('c2-') === 0) {
                c2Active = true;
            }
        });
        document.querySelectorAll('[data-agent-c2-group]').forEach(function (group) {
            if (c2Active) group.open = true;
            group.classList.toggle('is-active', c2Active);
        });
    }

    function markRailEmbedActive(pageId) {
        document.querySelectorAll('#agent-rail-menu [data-agent-embed]').forEach(function (el) {
            var match = !!pageId && el.getAttribute('data-agent-embed') === pageId;
            el.classList.toggle('is-active', match);
            el.setAttribute('aria-pressed', match ? 'true' : 'false');
        });
    }

    function syncAgentC2(enabled) {
        var hide = enabled === false;
        document.querySelectorAll('[data-agent-c2]').forEach(function (el) {
            el.classList.toggle('agent-c2-disabled', hide);
        });
    }

    function syncAgentShell(pageId) {
        var onChat = pageId === 'chat' || !!EMBED_PAGES[pageId] || !!embeddedPageId;
        document.documentElement.classList.toggle('agent-on-chat', onChat);
        placeRailFooter(onChat ? 'chat' : pageId);
        markWorkspaceActive(pageId);
        markRailEmbedActive(embeddedPageId);
        syncAgentC2(window.__c2Enabled !== false);
        if (typeof applyRBACToUI === 'function') {
            var footer = document.getElementById('agent-rail-footer');
            var nav = document.getElementById('agent-workspace-nav');
            if (footer) applyRBACToUI(footer);
            if (nav) applyRBACToUI(nav);
        }
    }

    function ensureEmbedHost() {
        var host = document.getElementById('agent-chat-embed');
        if (host) return host;
        var chatContainer = document.querySelector('#page-chat .chat-container');
        if (!chatContainer) return null;
        host = document.createElement('div');
        host.id = 'agent-chat-embed';
        host.className = 'agent-chat-embed';
        host.hidden = true;
        chatContainer.insertBefore(host, chatContainer.firstChild);
        return host;
    }

    function rememberPageHome(page) {
        var id = page.id;
        if (!id || pageHomes[id]) return;
        pageHomes[id] = { parent: page.parentNode, next: page.nextSibling };
    }

    function restoreEmbeddedPage() {
        if (!embeddedPageId) return;
        var page = document.getElementById('page-' + embeddedPageId);
        var home = page ? pageHomes[page.id] : null;
        if (page) {
            page.classList.remove('active', 'agent-chat-embed-page', 'page-enter-anim');
            if (home && home.parent) {
                if (home.next && home.next.parentNode === home.parent) {
                    home.parent.insertBefore(page, home.next);
                } else {
                    home.parent.appendChild(page);
                }
            }
        }
        embeddedPageId = null;
        markRailEmbedActive(null);
        var host = document.getElementById('agent-chat-embed');
        if (host) host.hidden = true;
        document.documentElement.classList.remove('agent-chat-embedding');
        var chatContainer = document.querySelector('#page-chat .chat-container');
        if (chatContainer) chatContainer.classList.remove('has-agent-embed');
    }

    function closeChatEmbed(opts) {
        opts = opts || {};
        if (!embeddedPageId) return;
        restoreEmbeddedPage();
        if (opts.restoreHash) {
            var hashPage = window.location.hash.slice(1).split('?')[0];
            if (hashPage && EMBED_PAGES[hashPage]) {
                suppressHashSync = true;
                history.replaceState(null, '', '#chat');
                suppressHashSync = false;
            }
        }
    }

    function initEmbeddedPage(pageId) {
        if (pageId === 'dashboard' && typeof window.refreshDashboard === 'function') {
            window.refreshDashboard();
            return;
        }
        if (pageId === 'asset-overview' && typeof window.loadAssetOverview === 'function') {
            window.loadAssetOverview();
        }
    }

    function openChatEmbed(pageId) {
        if (!EMBED_PAGES[pageId]) return;
        var page = document.getElementById('page-' + pageId);
        if (!page) return;

        if (embeddedPageId === pageId) {
            markRailEmbedActive(pageId);
            syncAgentShell('chat');
            if (window.location.hash.slice(1).split('?')[0] !== pageId) {
                suppressHashSync = true;
                history.replaceState(null, '', '#' + pageId);
                suppressHashSync = false;
            }
            return;
        }

        if (embeddedPageId) restoreEmbeddedPage();

        if (currentPageId() !== 'chat' && typeof originalSwitchPage === 'function') {
            originalSwitchPage.call(window, 'chat');
        }

        if (!document.getElementById('page-chat')) return;

        var host = ensureEmbedHost();
        if (!host) return;

        rememberPageHome(page);
        host.appendChild(page);
        page.classList.add('active', 'agent-chat-embed-page');
        page.classList.remove('page-enter-anim');
        void page.offsetWidth;
        page.classList.add('page-enter-anim');

        host.hidden = false;
        document.documentElement.classList.add('agent-chat-embedding');
        var chatContainer = document.querySelector('#page-chat .chat-container');
        if (chatContainer) chatContainer.classList.add('has-agent-embed');

        embeddedPageId = pageId;
        markRailEmbedActive(pageId);
        syncAgentShell('chat');

        suppressHashSync = true;
        if (window.location.hash.slice(1).split('?')[0] !== pageId) {
            history.replaceState(null, '', '#' + pageId);
        }
        suppressHashSync = false;

        window.currentPageId = pageId;
        initEmbeddedPage(pageId);
        if (typeof applyRBACToUI === 'function') applyRBACToUI(page);
    }

    function setTerminalPressed(open) {
        var rail = document.querySelector('#agent-rail-menu [data-agent-rail-action="terminal"]');
        if (rail) rail.setAttribute('aria-pressed', open ? 'true' : 'false');
    }

    function openAgentTerminal() {
        closeChatEmbed({ restoreHash: true });
        if (currentPageId() !== 'chat' && typeof window.switchPage === 'function') {
            window.switchPage('chat');
        }
        var drawer = document.getElementById('agent-terminal-drawer');
        if (drawer) drawer.hidden = false;
        setTerminalPressed(true);
        window.setTimeout(function () {
            if (typeof window.initTerminal === 'function') window.initTerminal();
        }, 40);
    }

    function closeAgentTerminal() {
        var drawer = document.getElementById('agent-terminal-drawer');
        if (drawer) drawer.hidden = true;
        setTerminalPressed(false);
    }

    function toggleAgentTerminal() {
        var drawer = document.getElementById('agent-terminal-drawer');
        if (drawer && !drawer.hidden) closeAgentTerminal();
        else openAgentTerminal();
    }

    function openAgentDestination(page, section) {
        if (!page) return;
        if (page === 'settings' && section) settingsSection = section;
        if (typeof window.switchPage === 'function') window.switchPage(page);
        if (page === 'settings' && section && typeof window.switchSettingsSection === 'function') {
            window.switchSettingsSection(section);
        }
    }

    function clearRailPopoverPlacement(el) {
        if (!el) return;
        var home = el.__railHome;
        if (home && home.parent && el.parentElement !== home.parent) {
            if (home.next && home.next.parentNode === home.parent) {
                home.parent.insertBefore(el, home.next);
            } else {
                home.parent.appendChild(el);
            }
        }
        el.classList.remove('agent-rail-popover', 'agent-rail-morphing');
        el.style.position = '';
        el.style.left = '';
        el.style.right = '';
        el.style.top = '';
        el.style.bottom = '';
        el.style.width = '';
        el.style.maxWidth = '';
        el.style.zIndex = '';
        el.style.transformOrigin = '';
    }

    /**
     * Fixed-position rail popovers above the anchor, right-aligned when possible,
     * clamped so the full card stays inside the viewport.
     * Reparents to document.body so overflow:hidden on sidebar/layout cannot clip.
     */
    function placeRailPopover(popover, anchor) {
        if (!popover || !anchor) return;
        var pad = 12;
        var gap = 8;
        var preferred = 320;
        if (popover.id === 'notification-dropdown') preferred = 340;
        else if (popover.id === 'agent-rail-menu') preferred = 260;
        var width = Math.min(preferred, Math.max(160, window.innerWidth - pad * 2));
        var rect = anchor.getBoundingClientRect();

        if (!popover.__railHome) {
            popover.__railHome = {
                parent: popover.parentElement,
                next: popover.nextSibling
            };
        }
        if (popover.parentElement !== document.body) {
            document.body.appendChild(popover);
        }

        popover.classList.add('agent-rail-popover');
        popover.style.position = 'fixed';
        popover.style.zIndex = '2400';
        popover.style.width = width + 'px';
        popover.style.maxWidth = (window.innerWidth - pad * 2) + 'px';
        popover.style.right = 'auto';
        popover.style.bottom = 'auto';

        var left = rect.right - width;
        if (left < pad) left = pad;
        if (left + width > window.innerWidth - pad) {
            left = Math.max(pad, window.innerWidth - pad - width);
        }

        var height = popover.offsetHeight || 0;
        var top = rect.top - gap - height;
        if (top < pad) {
            top = rect.bottom + gap;
            if (height && top + height > window.innerHeight - pad) {
                top = Math.max(pad, window.innerHeight - pad - height);
            }
        }

        popover.style.left = Math.round(left) + 'px';
        popover.style.top = Math.round(top) + 'px';
    }

    /**
     * cm-pill motion language: grow from the 40×40 control into the already-
     * positioned (viewport-clamped) panel via scale + border-radius.
     */
    function playRailMorphOpen(anchor, panel) {
        if (!anchor || !panel) return;
        if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            return;
        }
        var a = anchor.getBoundingClientRect();
        var p = panel.getBoundingClientRect();
        if (!p.width || !p.height || !a.width || !a.height) return;

        var sx = Math.min(1, a.width / p.width);
        var sy = Math.min(1, a.height / p.height);
        var originX = ((a.left + a.width / 2) - p.left) / p.width * 100;
        var originY = ((a.top + a.height / 2) - p.top) / p.height * 100;
        originX = Math.max(0, Math.min(100, originX));
        originY = Math.max(0, Math.min(100, originY));

        panel.classList.add('agent-rail-morphing');
        panel.style.transformOrigin = originX.toFixed(1) + '% ' + originY.toFixed(1) + '%';

        if (panel.__railMorphAnim && typeof panel.__railMorphAnim.cancel === 'function') {
            panel.__railMorphAnim.cancel();
        }

        var anim = panel.animate(
            [
                {
                    transform: 'scale(' + sx.toFixed(3) + ', ' + sy.toFixed(3) + ')',
                    borderRadius: '20px',
                    opacity: 0.92
                },
                {
                    transform: 'scale(1, 1)',
                    borderRadius: '16px',
                    opacity: 1
                }
            ],
            {
                duration: 380,
                easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
                fill: 'both'
            }
        );
        panel.__railMorphAnim = anim;
        function clearMorph() {
            panel.classList.remove('agent-rail-morphing');
            panel.style.transformOrigin = '';
            try { anim.cancel(); } catch (e) { /* ignore */ }
        }
        anim.addEventListener('finish', clearMorph);
        anim.addEventListener('cancel', clearMorph);
    }

    function bindRailSink(el) {
        if (!el || el.__agentRailSinkBound) return;
        el.__agentRailSinkBound = true;
        el.addEventListener('pointerdown', function () {
            el.setAttribute('data-sink', 'true');
        });
        function clearSink() {
            el.removeAttribute('data-sink');
        }
        el.addEventListener('pointerup', clearSink);
        el.addEventListener('pointercancel', clearSink);
        el.addEventListener('pointerleave', clearSink);
    }

    function syncRailPopoverPlacement(popoverId, anchorId) {
        var popover = document.getElementById(popoverId);
        var anchor = document.getElementById(anchorId);
        if (!popover) return;
        var hidden = popover.hidden || popover.style.display === 'none'
            || window.getComputedStyle(popover).display === 'none';
        if (hidden) {
            clearRailPopoverPlacement(popover);
            return;
        }
        if (anchor) placeRailPopover(popover, anchor);
    }

    function hideNestedPanels() {
        var notif = document.getElementById('notification-dropdown');
        if (notif) {
            notif.style.display = 'none';
            clearRailPopoverPlacement(notif);
        }
        var user = document.getElementById('user-menu-dropdown');
        if (user) {
            user.style.display = 'none';
            clearRailPopoverPlacement(user);
        }
        var avatar = document.getElementById('user-avatar-btn');
        if (avatar) {
            avatar.classList.remove('active');
            avatar.setAttribute('aria-expanded', 'false');
        }
        var bellBtn = document.getElementById('notification-bell-btn');
        if (bellBtn) {
            bellBtn.classList.remove('active');
            bellBtn.setAttribute('aria-expanded', 'false');
        }
    }

    function closeAgentRailMenu() {
        var btn = document.getElementById('agent-rail-capsule');
        var menu = document.getElementById('agent-rail-menu');
        if (btn) btn.setAttribute('aria-expanded', 'false');
        if (menu) {
            menu.hidden = true;
            clearRailPopoverPlacement(menu);
            menu.classList.remove('agent-rail-popover', 'agent-rail-morphing');
        }
        railMenuOpen = false;
        hideNestedPanels();
    }

    function openAgentRailMenu() {
        var btn = document.getElementById('agent-rail-capsule');
        var menu = document.getElementById('agent-rail-menu');
        if (!btn || !menu) return;
        menu.hidden = false;
        btn.setAttribute('aria-expanded', 'true');
        railMenuOpen = true;
        markRailEmbedActive(embeddedPageId);
        placeRailPopover(menu, btn);
        window.requestAnimationFrame(function () {
            placeRailPopover(menu, btn);
            playRailMorphOpen(btn, menu);
        });
        var first = menu.querySelector('[role="menuitem"]:not([hidden])');
        if (first && typeof first.focus === 'function') {
            window.setTimeout(function () { first.focus(); }, 0);
        }
    }

    function toggleAgentRailMenu() {
        if (railMenuOpen) closeAgentRailMenu();
        else openAgentRailMenu();
    }

    function runRailAction(action, el) {
        switch (action) {
            case 'dashboard':
                closeAgentRailMenu();
                if (typeof window.switchPage === 'function') window.switchPage('dashboard');
                break;
            case 'asset-overview':
                closeAgentRailMenu();
                if (typeof window.switchPage === 'function') window.switchPage('asset-overview');
                break;
            case 'terminal':
                closeAgentRailMenu();
                toggleAgentTerminal();
                break;
            case 'settings':
                closeAgentRailMenu();
                openAgentDestination('settings', 'basic');
                break;
            case 'theme':
                if (window.cycleThemePreference) window.cycleThemePreference();
                closeAgentRailMenu();
                break;
            case 'lang': {
                var lang = el && el.getAttribute('data-lang');
                if (lang && typeof window.onLanguageSelect === 'function') window.onLanguageSelect(lang);
                closeAgentRailMenu();
                break;
            }
            default:
                break;
        }
    }

    function installRailPopoverHooks() {
        var origToggleUser = window.toggleUserMenu;
        if (typeof origToggleUser === 'function' && !origToggleUser.__railPlace) {
            window.toggleUserMenu = function () {
                origToggleUser.apply(this, arguments);
                var user = document.getElementById('user-menu-dropdown');
                var avatar = document.getElementById('user-avatar-btn');
                if (user && user.style.display !== 'none' && avatar) {
                    window.requestAnimationFrame(function () {
                        placeRailPopover(user, avatar);
                        playRailMorphOpen(avatar, user);
                    });
                } else if (user) {
                    clearRailPopoverPlacement(user);
                }
            };
            window.toggleUserMenu.__railPlace = true;
        }

        var origToggleNotif = window.toggleNotificationDropdown;
        if (typeof origToggleNotif === 'function' && !origToggleNotif.__railPlace) {
            window.toggleNotificationDropdown = function () {
                var result = origToggleNotif.apply(this, arguments);
                window.setTimeout(function () {
                    var notif = document.getElementById('notification-dropdown');
                    var bell = document.getElementById('notification-bell-btn');
                    if (notif && notif.style.display !== 'none' && bell) {
                        placeRailPopover(notif, bell);
                        playRailMorphOpen(bell, notif);
                        window.setTimeout(function () {
                            if (notif.style.display !== 'none') placeRailPopover(notif, bell);
                        }, 60);
                    } else if (notif) {
                        clearRailPopoverPlacement(notif);
                    }
                }, 0);
                return result;
            };
            window.toggleNotificationDropdown.__railPlace = true;
        }

        if (!window.__agentRailPopoverResizeBound) {
            window.__agentRailPopoverResizeBound = true;
            window.addEventListener('resize', function () {
                syncRailPopoverPlacement('user-menu-dropdown', 'user-avatar-btn');
                syncRailPopoverPlacement('notification-dropdown', 'notification-bell-btn');
                if (railMenuOpen) {
                    syncRailPopoverPlacement('agent-rail-menu', 'agent-rail-capsule');
                }
            });
        }
    }

    function bindRailFooterActions() {
        installRailPopoverHooks();
        var bell = document.getElementById('notification-bell-btn');
        var avatar = document.getElementById('user-avatar-btn');
        var capsule = document.getElementById('agent-rail-capsule');
        bindRailSink(bell);
        bindRailSink(avatar);
        bindRailSink(capsule);
        if (bell && !bell.__agentRailBound) {
            bell.__agentRailBound = true;
            bell.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                closeAgentRailMenu();
                var user = document.getElementById('user-menu-dropdown');
                if (user) {
                    user.style.display = 'none';
                    clearRailPopoverPlacement(user);
                }
                if (avatar) {
                    avatar.classList.remove('active');
                    avatar.setAttribute('aria-expanded', 'false');
                }
                if (typeof window.toggleNotificationDropdown === 'function') {
                    window.toggleNotificationDropdown();
                }
            });
        }
        if (avatar && !avatar.__agentRailBound) {
            avatar.__agentRailBound = true;
            avatar.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                closeAgentRailMenu();
                var notifDrop = document.getElementById('notification-dropdown');
                if (notifDrop) {
                    notifDrop.style.display = 'none';
                    clearRailPopoverPlacement(notifDrop);
                }
                var bellBtn = document.getElementById('notification-bell-btn');
                if (bellBtn) {
                    bellBtn.classList.remove('active');
                    bellBtn.setAttribute('aria-expanded', 'false');
                }
                if (typeof window.toggleUserMenu === 'function') {
                    window.toggleUserMenu();
                }
            });
        }
    }

    function bindRailCapsule() {
        var wrap = document.getElementById('agent-rail-capsule-wrap');
        var btn = document.getElementById('agent-rail-capsule');
        var menu = document.getElementById('agent-rail-menu');
        bindRailFooterActions();
        if (!wrap || !btn || !menu || btn.__agentCapsuleBound) return;
        btn.__agentCapsuleBound = true;

        btn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            hideNestedPanels();
            toggleAgentRailMenu();
        });

        menu.addEventListener('click', function (e) {
            var target = e.target.closest('[data-agent-rail-action]');
            if (!target || !menu.contains(target)) return;
            e.preventDefault();
            e.stopPropagation();
            runRailAction(target.getAttribute('data-agent-rail-action'), target);
        });

        document.addEventListener('click', function (e) {
            if (!railMenuOpen) return;
            if (wrap.contains(e.target)) return;
            if (menu.contains(e.target)) return;
            closeAgentRailMenu();
        });

        document.addEventListener('keydown', function (e) {
            if (!railMenuOpen) return;
            if (e.key === 'Escape') {
                e.preventDefault();
                closeAgentRailMenu();
                btn.focus();
            }
        });
    }

    var originalSwitchPage = window.switchPage;
    if (typeof originalSwitchPage === 'function') {
        window.switchPage = function (pageId) {
            if (EMBED_PAGES[pageId]) {
                openChatEmbed(pageId);
                return;
            }
            closeChatEmbed();
            var result = originalSwitchPage.apply(this, arguments);
            syncAgentShell(pageId);
            return result;
        };
    }

    function wrapSettingsSection() {
        var original = window.switchSettingsSection;
        if (typeof original !== 'function' || original.__agentWrapped) return;
        var wrapped = function (section) {
            if (section === 'terminal') {
                openAgentTerminal();
                return;
            }
            if (section) settingsSection = section;
            var result = original.apply(this, arguments);
            markWorkspaceActive(currentPageId() || 'settings');
            return result;
        };
        wrapped.__agentWrapped = true;
        window.switchSettingsSection = wrapped;
    }

    function wrapStartNewConversation() {
        var original = window.startNewConversation;
        if (typeof original !== 'function' || original.__agentEmbedWrapped) return;
        var wrapped = function () {
            closeChatEmbed({ restoreHash: true });
            closeAgentRailMenu();
            setCreateMenuOpen(false);
            return original.apply(this, arguments);
        };
        wrapped.__agentEmbedWrapped = true;
        window.startNewConversation = wrapped;
    }

    window.setAgentConversationTitle = setConversationTitle;
    window.openAgentTerminal = openAgentTerminal;
    window.closeAgentTerminal = closeAgentTerminal;
    window.toggleAgentTerminal = toggleAgentTerminal;
    window.openAgentDestination = openAgentDestination;
    window.syncAgentWorkspaceC2 = syncAgentC2;
    window.syncAgentShell = syncAgentShell;
    window.closeAgentChatEmbed = closeChatEmbed;
    window.closeAgentRailMenu = closeAgentRailMenu;
    window.toggleAgentRailMenu = toggleAgentRailMenu;
    window.placeAgentRailPopover = placeRailPopover;
    window.clearAgentRailPopover = clearRailPopoverPlacement;

    wrapSettingsSection();
    document.addEventListener('DOMContentLoaded', function () {
        wrapSettingsSection();
        wrapStartNewConversation();
        bindRailCapsule();
        syncAgentShell(currentPageId() || 'chat');
    });

    document.addEventListener('conversation-changed', function () {
        if (!embeddedPageId) return;
        closeChatEmbed({ restoreHash: true });
        syncAgentShell('chat');
    });

    window.setTimeout(wrapStartNewConversation, 0);
    window.setTimeout(wrapStartNewConversation, 500);
    window.setTimeout(bindRailCapsule, 0);

    function createMenu() {
        return document.getElementById('new-task-menu');
    }

    function setCreateMenuOpen(open) {
        var stage = createMenu();
        if (!stage) return;
        if (open) {
            closeAgentRailMenu();
            var items = stage.querySelectorAll('.cm-item');
            var visible = 0;
            items.forEach(function (item) {
                if (item.offsetParent !== null || getComputedStyle(item).display !== 'none') visible += 1;
            });
            if (!visible) visible = items.length || 1;
            var height = 22 + visible * 34 + Math.max(0, visible - 1) * 2;
            stage.style.setProperty('--cm-panel-h', height + 'px');
        }
        stage.setAttribute('data-open', open ? 'true' : 'false');
        var pill = stage.querySelector('.cm-pill');
        if (pill) pill.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (!open) {
            var hov = stage.querySelector('.cm-hov-pill');
            if (hov) hov.removeAttribute('data-on');
        }
    }

    function bindCreateMenu() {
        var stage = createMenu();
        if (!stage || stage.dataset.bound === '1') return;
        stage.dataset.bound = '1';
        var pill = stage.querySelector('.cm-pill');
        var hov = stage.querySelector('.cm-hov-pill');
        if (pill) {
            pill.addEventListener('click', function (event) {
                event.stopPropagation();
                setCreateMenuOpen(stage.getAttribute('data-open') !== 'true');
            });
        }
        stage.addEventListener('pointerdown', function (event) {
            event.stopPropagation();
            if (event.target.closest && event.target.closest('.cm-pill')) {
                stage.setAttribute('data-sink', 'true');
            }
        });
        window.addEventListener('pointerup', function () {
            stage.removeAttribute('data-sink');
        });
        function placeHovPill(button) {
            if (!hov) return;
            var layer = hov.parentElement;
            if (!layer) return;
            var layerRect = layer.getBoundingClientRect();
            var btnRect = button.getBoundingClientRect();
            var x = Math.round(btnRect.left - layerRect.left);
            var y = Math.round(btnRect.top - layerRect.top);
            hov.style.width = Math.round(btnRect.width) + 'px';
            hov.style.height = Math.round(btnRect.height) + 'px';
            hov.style.transform = 'translate(' + x + 'px, ' + y + 'px)';
            hov.setAttribute('data-on', 'true');
            hov.setAttribute('data-moving', 'true');
            window.clearTimeout(hov._moveTimer);
            hov._moveTimer = window.setTimeout(function () {
                hov.removeAttribute('data-moving');
            }, 140);
        }
        stage.querySelectorAll('.cm-item button').forEach(function (button) {
            button.addEventListener('mouseenter', function () {
                placeHovPill(button);
            });
            button.addEventListener('focus', function () {
                placeHovPill(button);
            });
            button.addEventListener('click', function () {
                var action = button.getAttribute('data-action');
                setCreateMenuOpen(false);
                if (action === 'conversation' && typeof window.startNewConversation === 'function') {
                    window.startNewConversation();
                } else if (action === 'project' && typeof window.showNewProjectModalFromChatSidebar === 'function') {
                    window.showNewProjectModalFromChatSidebar();
                }
            });
        });
        stage.addEventListener('mouseleave', function () {
            if (!hov) return;
            hov.removeAttribute('data-on');
            hov.removeAttribute('data-moving');
        });
        document.addEventListener('pointerdown', function (event) {
            if (!stage.contains(event.target)) setCreateMenuOpen(false);
        });
        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape') setCreateMenuOpen(false);
        });
    }

    document.addEventListener('DOMContentLoaded', bindCreateMenu);
    window.setTimeout(bindCreateMenu, 0);
})();
