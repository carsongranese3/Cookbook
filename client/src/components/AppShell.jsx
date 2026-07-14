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
    id: 'pantry',
    label: 'Pantry',
    tabLabel: 'Pantry',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M5 3h14a1 1 0 011 1v16a1 1 0 01-1 1H5a1 1 0 01-1-1V4a1 1 0 011-1z"/>
        <path d="M8 3v4M16 3v4M4 7h16"/>
        <path d="M9 13h6M9 17h4"/>
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
  {
    id: 'history',
    label: 'History',
    tabLabel: 'Log',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <polyline points="12 8 12 12 14 14"/>
        <path d="M3.05 11a9 9 0 1 0 .5-3M3 4v4h4"/>
      </svg>
    ),
  },
];

// Phone tab order: 5 tabs — Home, Plan, List, Pantry, Log. Adding a recipe is a
// top-right button on the Library screen (calls onNew), not a bottom tab.
const PHONE_ORDER = ['library', 'plan', 'shopping', 'pantry', 'history'];

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
            <svg width="17" height="17" viewBox="0 0 64 64" aria-hidden="true">
              <path d="M31 21C24 16 15.5 16 12.5 17L12.5 45.5C15.5 44.5 24 44.5 31 49.5Z" fill="#fff"/>
              <path d="M33 21C40 16 48.5 16 51.5 17L51.5 45.5C48.5 44.5 40 44.5 33 49.5Z" fill="#fff"/>
            </svg>
          </div>
          <span className="sidebar-wordmark">The Cookbook</span>
        </a>

        <nav className="sidebar-nav">
          {/* 'add' is intentionally omitted on desktop — use the "+ New recipe"
              button (which has an Import-from-video toggle). Phone keeps its Add tab. */}
          {NAV_ITEMS.filter((item) => item.id !== 'add').map((item) => (
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
          <div className="sidebar-avatar" aria-hidden="true">C</div>
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
