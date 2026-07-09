/**
 * AppShell — renders the desktop sidebar + main scroll area, or
 * the phone bottom tab bar, depending on viewport width.
 * Navigation is controlled by the `activeTab` prop.
 */

const NAV_ITEMS = [
  {
    id: 'library',
    label: 'Library',
    tabLabel: 'Home',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
        <polyline points="9 22 9 12 15 12 15 22"/>
      </svg>
    ),
  },
  {
    id: 'plan',
    label: 'Meal Plan',
    tabLabel: 'Plan',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <rect x="3" y="4" width="18" height="18" rx="2"/>
        <path d="M3 10h18M8 2v4M16 2v4"/>
      </svg>
    ),
  },
  {
    id: 'shopping',
    label: 'Shopping List',
    tabLabel: 'List',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <circle cx="9" cy="20" r="1.4"/>
        <circle cx="18" cy="20" r="1.4"/>
        <path d="M2 3h3l2.6 12.6a1 1 0 001 .8h8.8a1 1 0 001-.8L21 7H6"/>
      </svg>
    ),
  },
  {
    id: 'add',
    label: 'Add from Video',
    tabLabel: 'Add',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <polygon points="23 7 16 12 23 17 23 7"/>
        <rect x="1" y="5" width="15" height="14" rx="2"/>
      </svg>
    ),
  },
];

// Phone tab order: Home, Plan, Add, List
const PHONE_ORDER = ['library', 'plan', 'add', 'shopping'];

export default function AppShell({ activeTab, onNav, recipeCount, children }) {
  return (
    <div className="app-shell">
      {/* ── Desktop sidebar ── */}
      <aside className="sidebar" aria-label="Main navigation">
        <a
          className="sidebar-brand"
          onClick={(e) => { e.preventDefault(); onNav('library'); }}
          href="/"
          aria-label="Cookbook home"
        >
          <div className="sidebar-logo" aria-hidden="true">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" aria-hidden="true">
              <path d="M4 3h16v4a4 4 0 01-4 4H8a4 4 0 01-4-4V3z"/>
              <path d="M4 11v10M20 11v10"/>
            </svg>
          </div>
          <span className="sidebar-wordmark">Pantry</span>
        </a>

        <nav className="sidebar-nav">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              className={`sidebar-nav-item ${activeTab === item.id ? 'active' : ''}`}
              onClick={() => onNav(item.id)}
              aria-current={activeTab === item.id ? 'page' : undefined}
            >
              <span className="sidebar-nav-icon">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-avatar" aria-hidden="true">P</div>
          <div className="sidebar-footer-text">
            <div className="name">My Kitchen</div>
            <div className="count">{recipeCount} recipe{recipeCount !== 1 ? 's' : ''}</div>
          </div>
        </div>
      </aside>

      {/* ── Main content ── */}
      <main className="main-scroll" id="main-content" tabIndex={-1}>
        {children}
      </main>

      {/* ── Phone bottom tab bar ── */}
      <nav className="tab-bar" aria-label="Main navigation">
        {PHONE_ORDER.map((id) => {
          const item = NAV_ITEMS.find((n) => n.id === id);
          return (
            <button
              key={id}
              className={`tab-item ${activeTab === id ? 'active' : ''}`}
              onClick={() => onNav(id)}
              aria-label={item.label}
              aria-current={activeTab === id ? 'page' : undefined}
            >
              {item.icon}
              <span>{item.tabLabel}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
