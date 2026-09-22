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

    /* —— Chat right-side project file browser (Code Work FileBrowserPanel layout) —— */
    /* Prefer GET /api/projects/:id/linked-tree; fall back to /api/chat-uploads workspace. */

    var filesPanelOpen = false;
    var filesPanelHideTimer = 0;
    var filesExpanded = Object.create(null);
    var filesLoadToken = 0;
    var filesLinkedProjectId = '';
    var filesLinkedLoaded = Object.create(null);
    var filesLinkedRelByKey = Object.create(null);
    var filesSelectedKey = '';
    var filesViewerOpen = false;
    var filesViewerToken = 0;
    var filesViewerProjectLabel = '';
    var filesOpenTabs = []; // { id, pathKey, relPath, source, name }
    var filesActiveTabId = '';
    var LEVEL_PAD = 12; // compact density indent ≈ Code Work --trees-level-gap * depth + base

    function filesT(key, fallback) {
        if (typeof window.t === 'function') {
            var v = window.t(key);
            if (v && v !== key) return v;
        }
        return fallback;
    }

    function filesEscape(text) {
        return String(text == null ? '' : text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function ensureFileIcons() {
        if (window.CodeWorkFileIcons && typeof window.CodeWorkFileIcons.ensureSprite === 'function') {
            window.CodeWorkFileIcons.ensureSprite();
        }
    }

    function folderIconHtml() {
        if (window.CodeWorkFileIcons && window.CodeWorkFileIcons.folderIconHtml) {
            return window.CodeWorkFileIcons.folderIconHtml();
        }
        return '';
    }

    function fileIconHtml(fileName) {
        if (window.CodeWorkFileIcons && window.CodeWorkFileIcons.fileIconHtml) {
            return window.CodeWorkFileIcons.fileIconHtml(fileName);
        }
        return '';
    }

    function currentChatProjectId() {
        var loaded = String(window._loadedConversationProjectId || '').trim();
        if (loaded) return loaded;
        if (typeof window.getActiveProjectId === 'function') {
            return String(window.getActiveProjectId() || '').trim();
        }
        return '';
    }

    function currentChatConversationId() {
        return String(window.currentConversationId || '').trim();
    }

    function currentChatProjectName(projectId) {
        var id = String(projectId || '').trim();
        if (!id) return '';
        if (window.projectNameById && window.projectNameById[id]) {
            return String(window.projectNameById[id]);
        }
        var label = document.getElementById('chat-project-text');
        if (label) {
            var text = String(label.textContent || '').trim();
            if (text && text !== filesT('projects.noProject', '无项目')) return text;
        }
        return id;
    }

    function makeTreeNode() {
        return { dirs: Object.create(null), files: [], lazy: false };
    }

    function stripWorkspacePrefix(rel, projectId) {
        var rp = String(rel || '').replace(/\\/g, '/').replace(/^\/+/, '');
        rp = rp.replace(/^__workspace__\//, '');
        if (projectId) {
            var projPrefix = 'projects/' + projectId + '/';
            if (rp.indexOf(projPrefix) === 0) return rp.slice(projPrefix.length);
            if (rp === 'projects/' + projectId) return '';
        }
        if (rp.indexOf('projects/') === 0) {
            var parts = rp.split('/');
            if (parts.length >= 2) return parts.slice(2).join('/');
        }
        if (rp.indexOf('conversations/') === 0) {
            var cparts = rp.split('/');
            if (cparts.length >= 2) return cparts.slice(2).join('/');
        }
        return rp;
    }

    function insertFilePath(root, relPath, name) {
        var parts = String(relPath || '').split('/').filter(Boolean);
        if (!parts.length) {
            if (name) root.files.push(String(name));
            return;
        }
        var node = root;
        var i;
        for (i = 0; i < parts.length - 1; i++) {
            if (!node.dirs[parts[i]]) node.dirs[parts[i]] = makeTreeNode();
            node = node.dirs[parts[i]];
        }
        node.files.push(parts[parts.length - 1]);
    }

    function insertFolderPath(root, relPath) {
        var parts = String(relPath || '').split('/').filter(Boolean);
        if (!parts.length) return;
        var node = root;
        var i;
        for (i = 0; i < parts.length; i++) {
            if (!node.dirs[parts[i]]) node.dirs[parts[i]] = makeTreeNode();
            node = node.dirs[parts[i]];
        }
    }

    function buildProjectTree(files, folders, projectId) {
        var root = makeTreeNode();
        (Array.isArray(files) ? files : []).forEach(function (f) {
            if (!f || f.source !== 'workspace') return;
            var rel = stripWorkspacePrefix(f.relativePath || f.RelativePath, projectId);
            if (!rel) {
                var n = f.name || f.Name;
                if (n) root.files.push(String(n));
                return;
            }
            insertFilePath(root, rel, f.name || f.Name);
        });
        (Array.isArray(folders) ? folders : []).forEach(function (folder) {
            var fp = stripWorkspacePrefix(folder, projectId);
            if (fp) insertFolderPath(root, fp);
        });
        return root;
    }

    function treeFromLinkedEntries(entries) {
        var root = makeTreeNode();
        (Array.isArray(entries) ? entries : []).forEach(function (e) {
            if (!e || !e.name) return;
            if (e.type === 'dir') {
                var child = makeTreeNode();
                child.lazy = true;
                root.dirs[e.name] = child;
            } else {
                root.files.push(String(e.name));
            }
        });
        return root;
    }

    function treeHasContent(node) {
        if (!node) return false;
        if (node.files && node.files.length) return true;
        var key;
        for (key in node.dirs) {
            if (Object.prototype.hasOwnProperty.call(node.dirs, key)) return true;
        }
        return false;
    }

    function sortNames(names) {
        return names.slice().sort(function (a, b) {
            return a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
        });
    }

    function joinRelPath(base, name) {
        var b = String(base || '').replace(/^\/+|\/+$/g, '');
        var n = String(name || '');
        return b ? (b + '/' + n) : n;
    }

    function renderFileRowHtml(file, pathKey, depth, source, relPath) {
        var fpad = 8 + depth * LEVEL_PAD;
        var selected = filesSelectedKey === pathKey;
        var html = '';
        html += '<button type="button" class="agent-chat-files-row is-file' + (selected ? ' is-selected' : '') +
            '" role="treeitem" aria-selected="' + (selected ? 'true' : 'false') + '"' +
            ' data-files-file="1" data-files-path="' + filesEscape(pathKey) + '"' +
            ' data-files-source="' + filesEscape(source) + '"' +
            ' data-files-rel="' + filesEscape(relPath) + '"' +
            ' style="padding-left:' + fpad + 'px">';
        html += '<span class="agent-chat-files-icon" aria-hidden="true">' + fileIconHtml(file) + '</span>';
        html += '<span class="agent-chat-files-name">' + filesEscape(file) + '</span>';
        html += '</button>';
        return html;
    }

    function renderTreeNodeHtml(name, node, pathKey, depth, isRoot, relPath, source) {
        var expanded = filesExpanded[pathKey] === true;
        if (isRoot && filesExpanded[pathKey] == null) expanded = true;
        if (isRoot) filesExpanded[pathKey] = expanded;
        var pad = 8 + depth * LEVEL_PAD;
        var dirNames = sortNames(Object.keys(node.dirs));
        var fileNames = sortNames(node.files || []);
        var lazy = !!node.lazy && !filesLinkedLoaded[pathKey];
        var src = source || 'linked';
        if (relPath != null) filesLinkedRelByKey[pathKey] = relPath;
        var html = '';
        html += '<div class="agent-chat-files-node" role="group">';
        html += '<button type="button" class="agent-chat-files-row" role="treeitem" aria-expanded="' + (expanded ? 'true' : 'false') + '" data-files-path="' + filesEscape(pathKey) + '"' +
            (lazy ? ' data-files-lazy="1"' : '') +
            (relPath != null ? ' data-files-rel="' + filesEscape(relPath) + '"' : '') +
            ' data-files-source="' + filesEscape(src) + '"' +
            ' style="padding-left:' + pad + 'px">';
        html += '<span class="agent-chat-files-icon is-folder" aria-hidden="true">' + folderIconHtml() + '</span>';
        html += '<span class="agent-chat-files-name' + (isRoot ? ' is-root' : '') + '">' + filesEscape(name) + '</span>';
        html += '</button>';
        html += '<div class="agent-chat-files-children' + (expanded ? ' is-open' : '') + '" data-files-children="' + filesEscape(pathKey) + '">';
        if (!lazy) {
            dirNames.forEach(function (dir) {
                var childRel = joinRelPath(relPath, dir);
                html += renderTreeNodeHtml(dir, node.dirs[dir], pathKey + '/' + dir, depth + 1, false, childRel, src);
            });
            fileNames.forEach(function (file) {
                var fileRel = joinRelPath(relPath, file);
                html += renderFileRowHtml(file, pathKey + '/' + file, depth + 1, src, fileRel);
            });
        }
        html += '</div></div>';
        return html;
    }

    function filesPanelReducedMotion() {
        try {
            return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
        } catch (e) {
            return false;
        }
    }

    function setFilesPanelOpen(open) {
        filesPanelOpen = !!open;
        var panel = document.getElementById('agent-chat-files-panel');
        var btn = document.getElementById('agent-chat-files-toggle');
        var container = document.querySelector('#page-chat .chat-container');
        if (btn) {
            btn.setAttribute('aria-pressed', filesPanelOpen ? 'true' : 'false');
            btn.setAttribute('aria-expanded', filesPanelOpen ? 'true' : 'false');
        }
        if (container) container.classList.toggle('has-agent-files-panel', filesPanelOpen);
        if (panel) {
            if (filesPanelHideTimer) {
                clearTimeout(filesPanelHideTimer);
                filesPanelHideTimer = 0;
            }
            if (filesPanelOpen) {
                var wasHidden = panel.hidden;
                panel.hidden = false;
                if (wasHidden) {
                    panel.classList.remove('is-open');
                    void panel.offsetWidth;
                }
                panel.classList.add('is-open');
            } else {
                panel.classList.remove('is-open');
                if (filesPanelReducedMotion()) {
                    panel.hidden = true;
                } else {
                    filesPanelHideTimer = window.setTimeout(function () {
                        filesPanelHideTimer = 0;
                        if (!filesPanelOpen) panel.hidden = true;
                    }, 320);
                }
            }
        }
        if (filesPanelOpen) {
            ensureFileIcons();
            loadAgentChatFilesTree();
        }
    }

    function toggleAgentChatFilesPanel() {
        setFilesPanelOpen(!filesPanelOpen);
    }

    function closeAgentChatFilesPanel() {
        setFilesPanelOpen(false);
    }

    async function fetchLinkedTree(projectId, relPath) {
        var url = '/api/projects/' + encodeURIComponent(projectId) + '/linked-tree';
        if (relPath) url += '?path=' + encodeURIComponent(relPath);
        var res = await window.apiFetch(url);
        if (!res.ok) {
            var errText = await res.text();
            throw new Error(errText || String(res.status));
        }
        return res.json();
    }

    async function fetchWorkspaceTree(projectId) {
        var params = new URLSearchParams();
        params.set('project', projectId);
        params.set('source', 'workspace');
        params.set('pageSize', 'all');
        var convId = currentChatConversationId();
        if (convId) params.set('conversation', convId);
        var res = await window.apiFetch('/api/chat-uploads?' + params.toString());
        if (!res.ok) {
            var errText = await res.text();
            throw new Error(errText || String(res.status));
        }
        var data = await res.json();
        var files = Array.isArray(data.files) ? data.files : [];
        var folders = Array.isArray(data.folders) ? data.folders : [];
        return buildProjectTree(files, folders, projectId);
    }

    async function loadAgentChatFilesTree() {
        var treeEl = document.getElementById('agent-chat-files-tree');
        if (!treeEl || !filesPanelOpen) return;
        ensureFileIcons();
        var projectId = currentChatProjectId();
        var token = ++filesLoadToken;
        filesLinkedProjectId = '';
        filesLinkedLoaded = Object.create(null);
        filesLinkedRelByKey = Object.create(null);

        if (!projectId) {
            treeEl.innerHTML = '<p class="agent-chat-files-empty">' + filesEscape(filesT('agentShell.filesEmptyNoProject', '当前对话未绑定项目，绑定后可浏览项目文件。')) + '</p>';
            return;
        }

        treeEl.innerHTML = '<p class="agent-chat-files-loading">' + filesEscape(filesT('agentShell.filesLoading', '加载中…')) + '</p>';

        try {
            if (typeof window.apiFetch !== 'function') {
                throw new Error('apiFetch unavailable');
            }

            var linkedData = null;
            try {
                linkedData = await fetchLinkedTree(projectId, '');
            } catch (linkedErr) {
                console.warn('linked-tree unavailable, falling back to workspace', linkedErr);
            }
            if (token !== filesLoadToken || !filesPanelOpen) return;

            var html = '';
            var hasAny = false;
            var projectLabel = currentChatProjectName(projectId) || projectId;
            filesViewerProjectLabel = projectLabel;

            if (linkedData && linkedData.linked) {
                filesLinkedProjectId = projectId;
                var linkedRoot = treeFromLinkedEntries(linkedData.entries);
                var rootName = projectLabel || linkedData.rootName || projectId;
                filesLinkedLoaded[rootName] = true;
                filesLinkedRelByKey[rootName] = '';
                filesExpanded[rootName] = true;
                if (treeHasContent(linkedRoot)) {
                    hasAny = true;
                    html += renderTreeNodeHtml(rootName, linkedRoot, rootName, 0, true, '', 'linked');
                }

                try {
                    var wsTree = await fetchWorkspaceTree(projectId);
                    if (token !== filesLoadToken || !filesPanelOpen) return;
                    if (treeHasContent(wsTree)) {
                        hasAny = true;
                        var wsName = filesT('agentShell.filesWorkspaceRoot', '工作区副本');
                        filesExpanded[wsName] = false;
                        html += renderTreeNodeHtml(wsName, wsTree, wsName, 0, true, '', 'workspace');
                    }
                } catch (wsErr) {
                    console.warn('workspace tree optional load failed', wsErr);
                }
            } else {
                var onlyWs = await fetchWorkspaceTree(projectId);
                if (token !== filesLoadToken || !filesPanelOpen) return;
                if (treeHasContent(onlyWs)) {
                    hasAny = true;
                    filesExpanded[projectLabel] = true;
                    html += renderTreeNodeHtml(projectLabel, onlyWs, projectLabel, 0, true, '', 'workspace');
                }
            }

            if (!hasAny) {
                treeEl.innerHTML = '<p class="agent-chat-files-empty">' + filesEscape(filesT('agentShell.filesEmptyNoFiles', '项目文件夹暂无文件。')) + '</p>';
                return;
            }
            treeEl.innerHTML = html;
        } catch (e) {
            if (token !== filesLoadToken) return;
            console.error(e);
            treeEl.innerHTML = '<p class="agent-chat-files-error">' + filesEscape(filesT('agentShell.filesLoadError', '无法加载文件列表')) + '</p>';
        }
    }

    async function loadLinkedFolderChildren(btn, kids) {
        var pathKey = btn.getAttribute('data-files-path') || '';
        var rel = btn.getAttribute('data-files-rel');
        var source = btn.getAttribute('data-files-source') || 'linked';
        if (rel == null) rel = filesLinkedRelByKey[pathKey] || '';
        if (!filesLinkedProjectId || !pathKey || filesLinkedLoaded[pathKey]) return;
        kids.innerHTML = '<p class="agent-chat-files-loading" style="padding-left:' + (parseInt(btn.style.paddingLeft, 10) || 8) + 'px">' +
            filesEscape(filesT('agentShell.filesLoading', '加载中…')) + '</p>';
        try {
            var data = await fetchLinkedTree(filesLinkedProjectId, rel);
            if (!filesPanelOpen || pathKey !== btn.getAttribute('data-files-path')) return;
            filesLinkedLoaded[pathKey] = true;
            btn.removeAttribute('data-files-lazy');
            var node = treeFromLinkedEntries(data && data.entries);
            var depth = Math.max(0, Math.round(((parseInt(btn.style.paddingLeft, 10) || 8) - 8) / LEVEL_PAD));
            var dirNames = sortNames(Object.keys(node.dirs));
            var fileNames = sortNames(node.files || []);
            var html = '';
            dirNames.forEach(function (dir) {
                var childRel = joinRelPath(rel, dir);
                html += renderTreeNodeHtml(dir, node.dirs[dir], pathKey + '/' + dir, depth + 1, false, childRel, source);
            });
            fileNames.forEach(function (file) {
                var fileRel = joinRelPath(rel, file);
                html += renderFileRowHtml(file, pathKey + '/' + file, depth + 1, source, fileRel);
            });
            if (!html) {
                var emptyPad = 8 + (depth + 1) * LEVEL_PAD;
                html = '<p class="agent-chat-files-empty" style="padding:4px 8px 4px ' + emptyPad + 'px">' +
                    filesEscape(filesT('agentShell.filesEmptyFolder', '空文件夹')) + '</p>';
            }
            kids.innerHTML = html;
        } catch (e) {
            console.error(e);
            kids.innerHTML = '<p class="agent-chat-files-error" style="padding-left:' + (parseInt(btn.style.paddingLeft, 10) || 8) + 'px">' +
                filesEscape(filesT('agentShell.filesLoadError', '无法加载文件列表')) + '</p>';
        }
    }

    function setSelectedFileRow(pathKey) {
        filesSelectedKey = pathKey || '';
        var treeEl = document.getElementById('agent-chat-files-tree');
        if (!treeEl) return;
        treeEl.querySelectorAll('.agent-chat-files-row.is-file').forEach(function (row) {
            var key = row.getAttribute('data-files-path') || '';
            var on = key && key === filesSelectedKey;
            row.classList.toggle('is-selected', on);
            row.setAttribute('aria-selected', on ? 'true' : 'false');
        });
    }

    function closeAgentFileViewer() {
        filesViewerOpen = false;
        filesViewerToken++;
        filesOpenTabs = [];
        filesActiveTabId = '';
        closeFileViewerMoreMenu();
        var viewer = document.getElementById('agent-file-viewer');
        var main = document.querySelector('#page-chat .agent-chat-main');
        if (viewer) {
            viewer.hidden = true;
            var body = document.getElementById('agent-file-viewer-body');
            if (body) {
                body.classList.remove('is-status');
                body.innerHTML = '';
            }
        }
        if (main) main.classList.remove('has-file-viewer');
        setSelectedFileRow('');
        renderFileTabs();
        var crumbs = document.getElementById('agent-file-viewer-crumbs');
        if (crumbs) crumbs.innerHTML = '';
    }

    function fileTabId(source, relPath) {
        return String(source || 'linked') + ':' + String(relPath || '');
    }

    function fileBasename(relPath) {
        var parts = String(relPath || '').split('/').filter(Boolean);
        return parts.length ? parts[parts.length - 1] : String(relPath || '');
    }

    function findFileTabIndex(id) {
        for (var i = 0; i < filesOpenTabs.length; i++) {
            if (filesOpenTabs[i].id === id) return i;
        }
        return -1;
    }

    function getActiveFileTab() {
        var idx = findFileTabIndex(filesActiveTabId);
        return idx >= 0 ? filesOpenTabs[idx] : null;
    }

    function renderFileTabs() {
        var list = document.getElementById('agent-file-viewer-tabs');
        if (!list) return;
        ensureFileIcons();
        if (!filesOpenTabs.length) {
            list.innerHTML = '';
            return;
        }
        var html = '';
        filesOpenTabs.forEach(function (tab) {
            var active = tab.id === filesActiveTabId;
            html += '<div class="agent-file-tab' + (active ? ' is-active' : '') + '"' +
                ' role="tab" aria-selected="' + (active ? 'true' : 'false') + '"' +
                ' data-active-tab="' + (active ? 'true' : 'false') + '"' +
                ' data-file-tab-id="' + filesEscape(tab.id) + '" title="' + filesEscape(tab.relPath) + '">';
            html += '<button type="button" class="agent-file-tab-close" data-file-tab-close="' +
                filesEscape(tab.id) + '" aria-label="Close ' + filesEscape(tab.name) + '" title="Close">';
            html += '<span class="agent-file-tab-icon" aria-hidden="true">' + fileIconHtml(tab.name) + '</span>';
            html += '<svg class="agent-file-tab-x" width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
            html += '</button>';
            html += '<button type="button" class="agent-file-tab-label" data-file-tab-activate="' +
                filesEscape(tab.id) + '"><span class="agent-file-tab-name">' + filesEscape(tab.name) + '</span></button>';
            html += '</div>';
        });
        list.innerHTML = html;
        var activeEl = list.querySelector('.agent-file-tab.is-active');
        if (activeEl && typeof activeEl.scrollIntoView === 'function') {
            try { activeEl.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) { /* ignore */ }
        }
    }

    function setViewerBodyStatus(html) {
        var body = document.getElementById('agent-file-viewer-body');
        if (!body) return;
        body.classList.add('is-status');
        body.innerHTML = html;
    }

    function setViewerBodyContent(html) {
        var body = document.getElementById('agent-file-viewer-body');
        if (!body) return;
        body.classList.remove('is-status');
        body.innerHTML = html;
    }

    function renderViewerCrumbs(projectLabel, relPath) {
        var el = document.getElementById('agent-file-viewer-crumbs');
        if (!el) return;
        var parts = String(relPath || '').split('/').filter(Boolean);
        var html = '<span class="agent-file-viewer-crumb">' + filesEscape(projectLabel || 'project') + '</span>';
        parts.forEach(function (part, idx) {
            html += '<span class="agent-file-viewer-sep" aria-hidden="true">›</span>';
            html += '<span class="agent-file-viewer-crumb' + (idx === parts.length - 1 ? ' is-file' : '') + '">' +
                filesEscape(part) + '</span>';
        });
        el.innerHTML = html;
    }

    function renderCodeLines(text) {
        var lines = String(text == null ? '' : text).split('\n');
        var html = '<pre class="agent-file-viewer-code">';
        for (var i = 0; i < lines.length; i++) {
            html += '<div class="agent-file-line"><span class="agent-file-gutter">' + (i + 1) +
                '</span><span class="agent-file-text">' + filesEscape(lines[i]) + '</span></div>';
        }
        html += '</pre>';
        return html;
    }

    function showViewerShell() {
        var viewer = document.getElementById('agent-file-viewer');
        var main = document.querySelector('#page-chat .agent-chat-main');
        if (!viewer || !main) return false;
        filesViewerOpen = true;
        viewer.hidden = false;
        main.classList.add('has-file-viewer');
        return true;
    }

    async function loadActiveFileTabContent() {
        var tab = getActiveFileTab();
        var projectId = currentChatProjectId();
        if (!tab || !projectId) return;

        ensureFileIcons();
        setSelectedFileRow(tab.pathKey);
        renderViewerCrumbs(filesViewerProjectLabel || currentChatProjectName(projectId) || projectId, tab.relPath);
        setViewerBodyStatus('<p class="agent-file-viewer-loading">' +
            filesEscape(filesT('agentShell.fileViewerLoading', '正在打开文件…')) + '</p>');

        var token = ++filesViewerToken;
        var source = tab.source;
        var relPath = tab.relPath;

        try {
            var data = null;
            if (source === 'linked') {
                var res = await window.apiFetch(
                    '/api/projects/' + encodeURIComponent(projectId) +
                    '/linked-file?path=' + encodeURIComponent(relPath)
                );
                if (!res.ok) throw new Error(await res.text() || String(res.status));
                data = await res.json();
                if (!data.linked) throw new Error(data.error || 'not linked');
            } else {
                var apiPath = '__workspace__/projects/' + projectId + '/' + relPath;
                var wsRes = await window.apiFetch('/api/chat-uploads/content?path=' + encodeURIComponent(apiPath));
                if (!wsRes.ok) {
                    var errBody = await wsRes.text();
                    if (wsRes.status === 400 && /binary/i.test(errBody)) {
                        data = { kind: 'binary', path: relPath, name: tab.name };
                    } else if (wsRes.status === 413 || /too large/i.test(errBody)) {
                        data = { kind: 'too_large', path: relPath, name: tab.name };
                    } else {
                        throw new Error(errBody || String(wsRes.status));
                    }
                } else {
                    var wsData = await wsRes.json();
                    data = {
                        kind: 'text',
                        path: relPath,
                        name: tab.name,
                        content: wsData.content || '',
                        encoding: 'utf-8'
                    };
                }
            }
            if (token !== filesViewerToken || !filesViewerOpen || filesActiveTabId !== tab.id) return;

            if (data.kind === 'too_large') {
                setViewerBodyStatus('<p class="agent-file-viewer-empty">' +
                    filesEscape(filesT('agentShell.fileViewerTooLarge', '文件过大（超过 1MB），无法预览。')) + '</p>');
                return;
            }
            if (data.kind === 'binary') {
                setViewerBodyStatus('<p class="agent-file-viewer-empty">' +
                    filesEscape(filesT('agentShell.fileViewerBinary', '此文件为二进制内容，无法在预览中显示。')) + '</p>');
                return;
            }
            if (data.kind === 'image' && data.content) {
                var mime = data.contentType || 'image/png';
                setViewerBodyContent('<div class="agent-file-viewer-image-wrap"><img alt="' +
                    filesEscape(data.name || relPath) + '" src="data:' + filesEscape(mime) +
                    ';base64,' + data.content + '"/></div>');
                return;
            }
            if (isMarkdownFileName(tab.name) || isMarkdownFileName(relPath)) {
                setViewerBodyContent(renderMarkdownArticle(data.content || ''));
                var article = document.querySelector('#agent-file-viewer-body .agent-file-viewer-md');
                if (article) {
                    enhanceMarkdownArticle(article, tab);
                }
                return;
            }
            setViewerBodyContent(renderCodeLines(data.content || ''));
        } catch (e) {
            if (token !== filesViewerToken || filesActiveTabId !== tab.id) return;
            console.error(e);
            setViewerBodyStatus('<p class="agent-file-viewer-error">' +
                filesEscape(filesT('agentShell.fileViewerError', '无法打开该文件')) + '</p>');
        }
    }

    function isMarkdownFileName(name) {
        return /\.(md|markdown)$/i.test(String(name || ''));
    }

    function renderMarkdownArticle(text) {
        var html = '';
        if (typeof window.formatMarkdown === 'function') {
            html = window.formatMarkdown(text, { profile: 'chat' });
        } else if (window.csMarkdownSanitize && typeof window.csMarkdownSanitize.formatMarkdownToHtml === 'function') {
            html = window.csMarkdownSanitize.formatMarkdownToHtml(text, { profile: 'chat' });
        } else {
            html = '<pre>' + filesEscape(text) + '</pre>';
        }
        return '<article class="agent-file-viewer-md">' + html + '</article>';
    }

    function dirnameRel(relPath) {
        var parts = String(relPath || '').replace(/\\/g, '/').split('/');
        parts.pop();
        return parts.join('/');
    }

    function resolveRelativePath(baseRel, href) {
        var h = String(href || '').replace(/\\/g, '/').replace(/^\.\//, '');
        if (!h || h.indexOf('..') >= 0) return '';
        if (h.charAt(0) === '/') h = h.replace(/^\/+/, '');
        var base = dirnameRel(baseRel);
        return joinRelPath(base, h);
    }

    function replaceImgWithAlt(img) {
        var span = document.createElement('span');
        span.className = 'agent-file-md-img-fallback';
        span.textContent = img.getAttribute('alt') || img.getAttribute('src') || '';
        if (img.parentNode) img.parentNode.replaceChild(span, img);
    }

    function enhanceMarkdownArticle(article, tab) {
        if (!article) return;
        if (window.csMarkdownSanitize && typeof window.csMarkdownSanitize.stripSuspiciousImages === 'function') {
            window.csMarkdownSanitize.stripSuspiciousImages(article);
        }
        [].slice.call(article.querySelectorAll('a[href]')).forEach(function (a) {
            var href = (a.getAttribute('href') || '').trim();
            if (/^https?:\/\//i.test(href) || href.indexOf('mailto:') === 0) {
                a.setAttribute('target', '_blank');
                a.setAttribute('rel', 'noopener noreferrer');
            } else if (/^file:/i.test(href) || href.indexOf('javascript:') === 0) {
                a.removeAttribute('href');
            }
        });
        var imgs = [].slice.call(article.querySelectorAll('img[src]'));
        imgs.forEach(function (img) {
            var src = (img.getAttribute('src') || '').trim();
            if (/^https?:\/\//i.test(src) || /^data:image\//i.test(src)) return;
            if (/^file:/i.test(src) || src.indexOf('..') >= 0 || !src) {
                replaceImgWithAlt(img);
                return;
            }
            var resolved = resolveRelativePath(tab.relPath, src);
            if (!resolved || tab.source !== 'linked') {
                replaceImgWithAlt(img);
                return;
            }
            var projectId = currentChatProjectId();
            if (!projectId || typeof window.apiFetch !== 'function') {
                replaceImgWithAlt(img);
                return;
            }
            window.apiFetch(
                '/api/projects/' + encodeURIComponent(projectId) +
                '/linked-file?path=' + encodeURIComponent(resolved)
            ).then(function (res) {
                if (!res.ok) throw new Error(String(res.status));
                return res.json();
            }).then(function (data) {
                if (!img.isConnected) return;
                if (data && data.kind === 'image' && data.content) {
                    img.setAttribute('src', 'data:' + (data.contentType || 'image/png') + ';base64,' + data.content);
                    img.removeAttribute('title');
                } else {
                    replaceImgWithAlt(img);
                }
            }).catch(function () {
                if (img.isConnected) replaceImgWithAlt(img);
            });
        });
    }

    function activateFileTab(tabId) {
        var idx = findFileTabIndex(tabId);
        if (idx < 0) return;
        filesActiveTabId = tabId;
        renderFileTabs();
        loadActiveFileTabContent();
    }

    function closeFileTab(tabId) {
        var idx = findFileTabIndex(tabId);
        if (idx < 0) return;
        var wasActive = filesActiveTabId === tabId;
        filesOpenTabs.splice(idx, 1);
        if (!filesOpenTabs.length) {
            closeAgentFileViewer();
            return;
        }
        if (wasActive) {
            var next = filesOpenTabs[Math.min(idx, filesOpenTabs.length - 1)];
            filesActiveTabId = next.id;
            renderFileTabs();
            loadActiveFileTabContent();
        } else {
            renderFileTabs();
        }
    }

    function closeOtherFileTabs() {
        var active = getActiveFileTab();
        if (!active) return;
        filesOpenTabs = filesOpenTabs.filter(function (t) { return t.id === active.id; });
        renderFileTabs();
    }

    function setMenuItemDisabled(el, disabled) {
        if (!el) return;
        el.disabled = !!disabled;
        el.setAttribute('aria-disabled', disabled ? 'true' : 'false');
    }

    function syncFileViewerMoreLabels() {
        var btn = document.getElementById('agent-file-viewer-more');
        var moreLabel = filesT('agentShell.fileViewerMore', '更多');
        if (btn) {
            btn.setAttribute('aria-label', moreLabel);
            btn.setAttribute('title', moreLabel);
        }
        var menu = document.getElementById('agent-file-viewer-more-menu');
        if (!menu) return;
        var map = {
            'close-current': ['agentShell.fileViewerCloseCurrent', '关闭当前'],
            'close-others': ['agentShell.fileViewerCloseOthers', '关闭其他'],
            'close-all': ['agentShell.fileViewerCloseAll', '关闭全部'],
            'copy-path': ['agentShell.fileViewerCopyPath', '复制路径'],
            'reveal-in-tree': ['agentShell.fileViewerRevealInTree', '在文件树中定位']
        };
        Object.keys(map).forEach(function (action) {
            var el = menu.querySelector('[data-file-menu="' + action + '"]');
            if (el) el.textContent = filesT(map[action][0], map[action][1]);
        });
    }

    function updateFileViewerMenuEnabled() {
        var menu = document.getElementById('agent-file-viewer-more-menu');
        if (!menu) return;
        var tab = getActiveFileTab();
        var hasTab = !!tab;
        var multi = filesOpenTabs.length > 1;
        setMenuItemDisabled(menu.querySelector('[data-file-menu="close-current"]'), !hasTab);
        setMenuItemDisabled(menu.querySelector('[data-file-menu="close-others"]'), !hasTab || !multi);
        setMenuItemDisabled(menu.querySelector('[data-file-menu="close-all"]'), false);
        setMenuItemDisabled(menu.querySelector('[data-file-menu="copy-path"]'), !hasTab);
        setMenuItemDisabled(menu.querySelector('[data-file-menu="reveal-in-tree"]'), !hasTab);
    }

    function closeFileViewerMoreMenu() {
        var menu = document.getElementById('agent-file-viewer-more-menu');
        var btn = document.getElementById('agent-file-viewer-more');
        if (menu) {
            menu.hidden = true;
            menu.classList.remove('is-up');
        }
        if (btn) btn.setAttribute('aria-expanded', 'false');
    }

    function openFileViewerMoreMenu() {
        var menu = document.getElementById('agent-file-viewer-more-menu');
        var btn = document.getElementById('agent-file-viewer-more');
        if (!menu || !btn) return;
        syncFileViewerMoreLabels();
        updateFileViewerMenuEnabled();
        menu.classList.remove('is-up');
        menu.hidden = false;
        btn.setAttribute('aria-expanded', 'true');
        var rect = menu.getBoundingClientRect();
        if (rect.bottom > (window.innerHeight - 8)) {
            menu.classList.add('is-up');
        }
        var first = menu.querySelector('.agent-file-viewer-menu-item:not(:disabled)');
        if (first && typeof first.focus === 'function') {
            try { first.focus(); } catch (e) { /* ignore */ }
        }
    }

    function toggleFileViewerMoreMenu(e) {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        var menu = document.getElementById('agent-file-viewer-more-menu');
        if (menu && !menu.hidden) closeFileViewerMoreMenu();
        else openFileViewerMoreMenu();
    }

    async function copyActiveFilePath() {
        var tab = getActiveFileTab();
        if (!tab) return;
        var path = String(tab.relPath || '');
        try {
            if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
                throw new Error('clipboard unavailable');
            }
            await navigator.clipboard.writeText(path);
        } catch (e) {
            console.warn(filesT('agentShell.fileViewerCopyFailed', '复制失败'), e);
        }
    }

    async function ensureTreeFolderExpanded(pathKey) {
        var btn = [].slice.call(document.querySelectorAll(
            '#agent-chat-files-tree .agent-chat-files-row[data-files-path]:not([data-files-file])'
        )).find(function (el) {
            return el.getAttribute('data-files-path') === pathKey;
        });
        if (!btn) return;
        var open = filesExpanded[pathKey] === true || btn.getAttribute('aria-expanded') === 'true';
        var group = btn.parentElement;
        var kids = group && group.querySelector(':scope > .agent-chat-files-children');
        if (!open) {
            filesExpanded[pathKey] = true;
            btn.setAttribute('aria-expanded', 'true');
            if (kids) kids.classList.add('is-open');
        }
        if (btn.getAttribute('data-files-lazy') === '1' && kids) {
            await loadLinkedFolderChildren(btn, kids);
        }
    }

    async function revealActiveFileInTree() {
        var tab = getActiveFileTab();
        if (!tab) return;
        if (!filesPanelOpen) setFilesPanelOpen(true);
        await new Promise(function (r) { setTimeout(r, 80); });
        var pathKey = tab.pathKey || '';
        if (!pathKey) return;
        var parts = pathKey.split('/').filter(Boolean);
        var acc = '';
        for (var i = 0; i < parts.length - 1; i++) {
            acc = acc ? (acc + '/' + parts[i]) : parts[i];
            await ensureTreeFolderExpanded(acc);
        }
        setSelectedFileRow(pathKey);
        var row = [].slice.call(document.querySelectorAll(
            '#agent-chat-files-tree .agent-chat-files-row[data-files-file="1"]'
        )).find(function (el) {
            return el.getAttribute('data-files-path') === pathKey ||
                el.getAttribute('data-files-rel') === tab.relPath;
        });
        if (row && typeof row.scrollIntoView === 'function') {
            try { row.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
            catch (e) { row.scrollIntoView(true); }
        }
    }

    function onFileViewerMenuAction(e) {
        var item = e.target.closest && e.target.closest('[data-file-menu]');
        if (!item || item.disabled) return;
        e.preventDefault();
        e.stopPropagation();
        var action = item.getAttribute('data-file-menu') || '';
        closeFileViewerMoreMenu();
        if (action === 'close-current') {
            if (filesActiveTabId) closeFileTab(filesActiveTabId);
        } else if (action === 'close-others') {
            closeOtherFileTabs();
        } else if (action === 'close-all') {
            closeAgentFileViewer();
        } else if (action === 'copy-path') {
            copyActiveFilePath();
        } else if (action === 'reveal-in-tree') {
            revealActiveFileInTree();
        }
    }

    function onDocumentForFileViewerMenu(e) {
        var menu = document.getElementById('agent-file-viewer-more-menu');
        if (!menu || menu.hidden) return;
        if (e.type === 'keydown') {
            if (e.key === 'Escape') {
                e.preventDefault();
                closeFileViewerMoreMenu();
                var btn = document.getElementById('agent-file-viewer-more');
                if (btn) btn.focus();
            }
            return;
        }
        var wrap = document.querySelector('.agent-file-viewer-more-wrap');
        if (wrap && wrap.contains(e.target)) return;
        closeFileViewerMoreMenu();
    }

    function openAgentFileViewer(opts) {
        var source = opts.source || 'linked';
        var relPath = String(opts.relPath || '').replace(/^\/+/, '');
        var pathKey = opts.pathKey || relPath;
        var projectId = currentChatProjectId();
        if (!relPath || !projectId) return;
        if (!showViewerShell()) return;

        var id = fileTabId(source, relPath);
        var existing = findFileTabIndex(id);
        if (existing < 0) {
            filesOpenTabs.push({
                id: id,
                pathKey: pathKey,
                relPath: relPath,
                source: source,
                name: fileBasename(relPath)
            });
        } else {
            filesOpenTabs[existing].pathKey = pathKey;
        }
        filesActiveTabId = id;
        renderFileTabs();
        loadActiveFileTabContent();
    }

    function onFileTabsClick(e) {
        var closeBtn = e.target.closest && e.target.closest('[data-file-tab-close]');
        if (closeBtn) {
            e.preventDefault();
            e.stopPropagation();
            closeFileTab(closeBtn.getAttribute('data-file-tab-close') || '');
            return;
        }
        var activateBtn = e.target.closest && e.target.closest('[data-file-tab-activate]');
        if (activateBtn) {
            e.preventDefault();
            activateFileTab(activateBtn.getAttribute('data-file-tab-activate') || '');
            return;
        }
        var card = e.target.closest && e.target.closest('.agent-file-tab[data-file-tab-id]');
        if (card) {
            e.preventDefault();
            activateFileTab(card.getAttribute('data-file-tab-id') || '');
        }
    }

    function onFilesTreeClick(e) {
        var fileRow = e.target.closest && e.target.closest('.agent-chat-files-row[data-files-file="1"]');
        if (fileRow) {
            e.preventDefault();
            openAgentFileViewer({
                pathKey: fileRow.getAttribute('data-files-path') || '',
                relPath: fileRow.getAttribute('data-files-rel') || '',
                source: fileRow.getAttribute('data-files-source') || 'linked'
            });
            return;
        }

        var btn = e.target.closest && e.target.closest('.agent-chat-files-row[data-files-path]:not([data-files-file])');
        if (!btn) return;
        e.preventDefault();
        var pathKey = btn.getAttribute('data-files-path') || '';
        if (!pathKey) return;
        var open = filesExpanded[pathKey] === true;
        if (filesExpanded[pathKey] == null && btn.getAttribute('aria-expanded') === 'true') open = true;
        var next = !open;
        filesExpanded[pathKey] = next;
        btn.setAttribute('aria-expanded', next ? 'true' : 'false');
        var group = btn.parentElement;
        var kids = group && group.querySelector(':scope > .agent-chat-files-children');
        if (kids) kids.classList.toggle('is-open', next);
        if (next && btn.getAttribute('data-files-lazy') === '1' && kids) {
            loadLinkedFolderChildren(btn, kids);
        }
    }

    function bindAgentChatFilesPanel() {
        ensureFileIcons();
        var toggle = document.getElementById('agent-chat-files-toggle');
        var treeEl = document.getElementById('agent-chat-files-tree');
        var staleClose = document.getElementById('agent-chat-files-close');
        if (staleClose && staleClose.parentElement) staleClose.parentElement.removeChild(staleClose);
        var moreBtn = document.getElementById('agent-file-viewer-more');
        var moreMenu = document.getElementById('agent-file-viewer-more-menu');
        var tabsEl = document.getElementById('agent-file-viewer-tabs');
        if (toggle && !toggle.__agentFilesBound) {
            toggle.__agentFilesBound = true;
            toggle.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                toggleAgentChatFilesPanel();
            });
        }
        if (treeEl && !treeEl.__agentFilesBound) {
            treeEl.__agentFilesBound = true;
            treeEl.addEventListener('click', onFilesTreeClick);
        }
        if (moreBtn && !moreBtn.__agentFilesBound) {
            moreBtn.__agentFilesBound = true;
            syncFileViewerMoreLabels();
            moreBtn.addEventListener('click', toggleFileViewerMoreMenu);
        }
        if (moreMenu && !moreMenu.__agentFilesBound) {
            moreMenu.__agentFilesBound = true;
            moreMenu.addEventListener('click', onFileViewerMenuAction);
        }
        if (!document.__agentFileMoreDocBound) {
            document.__agentFileMoreDocBound = true;
            document.addEventListener('click', onDocumentForFileViewerMenu);
            document.addEventListener('keydown', onDocumentForFileViewerMenu);
        }
        if (tabsEl && !tabsEl.__agentFilesBound) {
            tabsEl.__agentFilesBound = true;
            tabsEl.addEventListener('click', onFileTabsClick);
        }
    }

    window.toggleAgentChatFilesPanel = toggleAgentChatFilesPanel;
    window.closeAgentChatFilesPanel = closeAgentChatFilesPanel;
    window.closeAgentFileViewer = closeAgentFileViewer;
    window.refreshAgentChatFilesPanel = loadAgentChatFilesTree;

    document.addEventListener('DOMContentLoaded', bindAgentChatFilesPanel);
    window.setTimeout(bindAgentChatFilesPanel, 0);

    document.addEventListener('conversation-changed', function () {
        closeAgentFileViewer();
        if (filesPanelOpen) loadAgentChatFilesTree();
    });

    document.addEventListener('languagechange', function () {
        if (filesPanelOpen) loadAgentChatFilesTree();
    });
})();
