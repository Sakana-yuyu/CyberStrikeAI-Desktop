package security

import (
	"database/sql"
	"errors"
	"strings"
	"sync"
	"time"

	"cyberstrike-ai/internal/database"

	"github.com/google/uuid"
)

// Predefined errors for authentication operations.
var (
	ErrInvalidPassword = errors.New("invalid password")
)

// Session represents an authenticated user session.
type Session struct {
	Token            string
	ExpiresAt        time.Time
	UserID           string
	Username         string
	DisplayName      string
	Roles            []string
	Permissions      map[string]bool
	PermissionScopes map[string]string
	Scope            string
}

// AuthManager manages password-based authentication and session lifecycle.
type AuthManager struct {
	sessionDuration time.Duration
	db              *database.DB

	mu          sync.RWMutex
	sessions    map[string]Session
	disabled    bool
	anonSession *Session
}

// NewAuthManager creates a new AuthManager instance.
func NewAuthManager(sessionDurationHours int) *AuthManager {
	if sessionDurationHours <= 0 {
		sessionDurationHours = 12
	}

	return &AuthManager{
		sessionDuration: time.Duration(sessionDurationHours) * time.Hour,
		sessions:        make(map[string]Session),
	}
}

// AttachRBACStore enables multi-user RBAC authentication. When no users exist yet,
// it bootstraps the built-in admin account and returns the generated initial password.
func (a *AuthManager) AttachRBACStore(db *database.DB) (generatedAdminPassword string, err error) {
	if db == nil {
		return "", errors.New("database is required for authentication")
	}

	needsAdminPassword, err := db.RBACNeedsAdminPassword()
	if err != nil {
		return "", err
	}

	adminPasswordHash := ""
	if needsAdminPassword {
		generatedAdminPassword, err = GenerateStrongPassword(24)
		if err != nil {
			return "", err
		}
		adminPasswordHash, err = HashPassword(generatedAdminPassword)
		if err != nil {
			return "", err
		}
	}

	if err := db.BootstrapRBAC(adminPasswordHash, PermissionCatalog); err != nil {
		return "", err
	}

	a.mu.Lock()
	a.db = db
	a.mu.Unlock()
	return generatedAdminPassword, nil
}

// SetDisabled 关闭登录鉴权：此后所有请求均以内置管理员匿名会话放行。
// 仅限本地可信部署使用（如 desktop --no-window 仅监听回环地址）。
func (a *AuthManager) SetDisabled(disabled bool) {
	a.mu.Lock()
	a.disabled = disabled
	a.anonSession = nil
	a.mu.Unlock()
}

// Disabled 报告登录鉴权是否已关闭。
func (a *AuthManager) Disabled() bool {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return a.disabled
}

// anonymousSession 返回共享的内置管理员会话；长期有效（鉴权关闭时过期无意义），
// 首次调用时惰性签发并缓存，避免每请求新建会话导致 sessions map 无限增长。
func (a *AuthManager) anonymousSession() (Session, bool) {
	a.mu.RLock()
	if a.anonSession != nil {
		session := *a.anonSession
		a.mu.RUnlock()
		return session, true
	}
	a.mu.RUnlock()

	user, err := a.lookupUser("admin")
	if err != nil {
		return Session{}, false
	}
	session, err := a.buildSession(user)
	if err != nil {
		return Session{}, false
	}
	// 前端按 expires_at 判断本地会话是否有效；鉴权关闭时给一个长期过期时间，
	// 防止前端误认为会话过期而弹出登录层。
	session.ExpiresAt = time.Now().AddDate(10, 0, 0)

	a.mu.Lock()
	if a.anonSession == nil {
		a.sessions[session.Token] = session
		a.anonSession = &session
	}
	cached := *a.anonSession
	a.mu.Unlock()
	return cached, true
}

// Authenticate validates the password and creates a new session.
func (a *AuthManager) Authenticate(username, password string) (string, time.Time, error) {
	session, err := a.authenticateSession(username, password)
	if err != nil {
		return "", time.Time{}, err
	}
	a.storeSession(session)
	return session.Token, session.ExpiresAt, nil
}

// IssueLocalDesktopSession mints a session for username WITHOUT password
// verification. It exists solely for the desktop client's one-shot bootstrap
// endpoint (loopback + per-process token guarded) so the packaged app opens
// straight into the UI. Never expose it through a password-accepting route.
func (a *AuthManager) IssueLocalDesktopSession(username string) (string, time.Time, error) {
	user, err := a.lookupUser(username)
	if err != nil {
		return "", time.Time{}, err
	}
	session, err := a.buildSession(user)
	if err != nil {
		return "", time.Time{}, err
	}
	a.storeSession(session)
	return session.Token, session.ExpiresAt, nil
}

func (a *AuthManager) storeSession(session Session) {
	a.mu.Lock()
	a.sessions[session.Token] = session
	a.mu.Unlock()
}

func (a *AuthManager) authenticateSession(username, password string) (Session, error) {
	user, err := a.lookupUser(username)
	if err != nil {
		return Session{}, err
	}
	if !VerifyPasswordHash(password, user.PasswordHash) {
		return Session{}, ErrInvalidPassword
	}
	return a.buildSession(user)
}

// lookupUser trims/normalizes username (empty → admin) and requires an enabled account.
func (a *AuthManager) lookupUser(username string) (*database.RBACUser, error) {
	a.mu.RLock()
	db := a.db
	a.mu.RUnlock()
	if db == nil {
		return nil, errors.New("authentication store is not configured")
	}

	username = strings.TrimSpace(strings.ToLower(username))
	if username == "" {
		username = "admin"
	}
	user, err := db.GetRBACUserByUsername(username)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, ErrInvalidPassword
		}
		return nil, err
	}
	if !user.Enabled {
		return nil, ErrInvalidPassword
	}
	return user, nil
}

// buildSession resolves RBAC access and mints a fresh session token.
func (a *AuthManager) buildSession(user *database.RBACUser) (Session, error) {
	a.mu.RLock()
	db := a.db
	sessionDuration := a.sessionDuration
	a.mu.RUnlock()
	if db == nil {
		return Session{}, errors.New("authentication store is not configured")
	}

	access, err := db.ResolveRBACAccess(user.ID)
	if err != nil {
		return Session{}, err
	}
	roleIDs := make([]string, 0, len(access.Roles))
	for _, role := range access.Roles {
		roleIDs = append(roleIDs, role.ID)
	}
	return Session{
		Token:            uuid.NewString(),
		ExpiresAt:        time.Now().Add(sessionDuration),
		UserID:           user.ID,
		Username:         user.Username,
		DisplayName:      user.DisplayName,
		Roles:            roleIDs,
		Permissions:      access.Permissions,
		PermissionScopes: access.PermissionScopes,
		Scope:            access.Scope,
	}, nil
}

func (s Session) ScopeFor(permission string) string {
	if scope := strings.TrimSpace(s.PermissionScopes[strings.TrimSpace(permission)]); scope != "" {
		return scope
	}
	return strings.TrimSpace(s.Scope)
}

// ValidateToken checks whether the provided token is still valid.
// 鉴权关闭（auth.enabled: false）时无视令牌内容，直接返回内置管理员匿名会话。
func (a *AuthManager) ValidateToken(token string) (Session, bool) {
	if a.Disabled() {
		return a.anonymousSession()
	}
	if strings.TrimSpace(token) == "" {
		return Session{}, false
	}

	a.mu.RLock()
	session, ok := a.sessions[token]
	a.mu.RUnlock()
	if !ok {
		return Session{}, false
	}

	if time.Now().After(session.ExpiresAt) {
		a.mu.Lock()
		delete(a.sessions, token)
		a.mu.Unlock()
		return Session{}, false
	}

	return session, true
}

// CheckPassword verifies whether the provided password matches the current password.
func (a *AuthManager) CheckPassword(password string) bool {
	return a.CheckUserPassword("admin", password)
}

// CheckUserPassword verifies whether the provided password matches a user.
func (a *AuthManager) CheckUserPassword(username, password string) bool {
	a.mu.RLock()
	db := a.db
	a.mu.RUnlock()
	if db == nil {
		return false
	}
	user, err := db.GetRBACUserByUsername(username)
	if err != nil {
		return false
	}
	return VerifyPasswordHash(password, user.PasswordHash)
}

func (a *AuthManager) UpdateUserPassword(userID, password string) error {
	password = strings.TrimSpace(password)
	if password == "" {
		return errors.New("auth password must be configured")
	}
	hash, err := HashPassword(password)
	if err != nil {
		return err
	}
	a.mu.RLock()
	db := a.db
	a.mu.RUnlock()
	if db == nil {
		return errors.New("authentication store is not configured")
	}
	if err := db.UpdateRBACUserPassword(userID, hash); err != nil {
		return err
	}
	a.mu.Lock()
	for token, session := range a.sessions {
		if session.UserID == userID {
			delete(a.sessions, token)
		}
	}
	a.mu.Unlock()
	return nil
}

// RevokeToken invalidates the specified token.
func (a *AuthManager) RevokeToken(token string) {
	if strings.TrimSpace(token) == "" {
		return
	}

	a.mu.Lock()
	delete(a.sessions, token)
	a.mu.Unlock()
}

func (a *AuthManager) RevokeUserSessions(userID string) {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return
	}
	a.mu.Lock()
	for token, session := range a.sessions {
		if session.UserID == userID {
			delete(a.sessions, token)
		}
	}
	a.mu.Unlock()
}

func (a *AuthManager) RevokeAllSessions() {
	a.mu.Lock()
	a.sessions = make(map[string]Session)
	a.mu.Unlock()
}

// SessionDurationHours returns the configured session duration in hours.
func (a *AuthManager) SessionDurationHours() int {
	return int(a.sessionDuration / time.Hour)
}

func allPermissions() map[string]bool {
	out := make(map[string]bool, len(PermissionCatalog))
	for key := range PermissionCatalog {
		out[key] = true
	}
	return out
}
