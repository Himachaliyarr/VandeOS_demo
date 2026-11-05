import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Activity, Bell, BookOpen, BriefcaseBusiness, CalendarDays, ChartNoAxesCombined, ChevronDown, CircleDollarSign, CircleHelp, Clock3, LayoutDashboard, LifeBuoy, LogOut, Megaphone, Menu, Package, Settings2, Users, Workflow, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { api, initials, titleCase } from '../lib/api.js';
import { canAccessWorkspaceModule } from '../lib/access.js';

const links = [
  { to: '/', label: 'Overview', icon: LayoutDashboard },
  { to: '/employees', label: 'People', icon: Users, staff: true },
  { to: '/attendance', label: 'Attendance', icon: Clock3 },
  { to: '/leaves', label: 'Time off', icon: CalendarDays },
  { to: '/crm', label: 'CRM', icon: Users, workspaceModule: 'crm' },
  { to: '/projects', label: 'Projects & tasks', icon: BriefcaseBusiness, workspaceModule: 'projects' },
  { to: '/academy', label: 'Academy', icon: BookOpen, workspaceModule: 'academy' },
  { to: '/finance', label: 'Finance', icon: CircleDollarSign, roles: ['SUPER_ADMIN'] },
  { to: '/marketing', label: 'Marketing', icon: Megaphone, workspaceModule: 'marketing' },
  { to: '/inventory', label: 'Inventory', icon: Package, workspaceModule: 'inventory' },
  { to: '/support', label: 'Support', icon: LifeBuoy, workspaceModule: 'support' },
  { to: '/automations', label: 'Automations', icon: Workflow, roles: ['SUPER_ADMIN'] },
  { to: '/reports', label: 'Reports', icon: ChartNoAxesCombined, workspaceModule: 'reports' },
  { to: '/notifications', label: 'Notifications', icon: Bell },
  { to: '/portal/client', label: 'Client portal', icon: BriefcaseBusiness, roles: ['CLIENT'], portal: true },
  { to: '/portal/student', label: 'Student portal', icon: BookOpen, roles: ['STUDENT'], portal: true },
  { to: '/activity', label: 'Audit history', icon: Activity, owner: true },
  { to: '/settings', label: 'Workspace settings', icon: Settings2, owner: true }
];

export default function Layout() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [unread, setUnread] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => { api('/notifications?limit=1').then(result => setUnread(result.data.unread || 0)).catch(() => {}); }, [location.pathname]);
  const logout = async () => { await signOut(); navigate('/login'); };
  const portalUser = ['CLIENT', 'STUDENT'].includes(user.role);
  const internalUser = ['SUPER_ADMIN', 'HR', 'EMPLOYEE'].includes(user.role);
  const visibleLinks = links.filter(link => (!portalUser || link.portal || link.to === '/notifications') && (portalUser || !link.portal) && (!link.staff || ['SUPER_ADMIN', 'HR'].includes(user.role)) && (!link.owner || user.role === 'SUPER_ADMIN') && (!link.internal || internalUser) && (link.workspaceModule ? canAccessWorkspaceModule(user, link.workspaceModule) : !link.roles || link.roles.includes(user.role)));
  const pageTitle = visibleLinks.find(link => link.to === location.pathname)?.label || 'People operations';

  return <div className="app-shell">
    <aside className={`sidebar ${menuOpen ? 'sidebar-open' : ''}`}>
      <div className="brand"><div className="brand-mark">V<span>.</span></div><div><strong>vande<span>os</span></strong><small>PEOPLE OPERATIONS</small></div><button className="sidebar-close icon-button" onClick={() => setMenuOpen(false)} aria-label="Close menu"><X size={18} /></button></div>
      <div className="workspace-switch"><div className="workspace-glyph">VD</div><div><strong>Vande Digital</strong><small>Single office · India</small></div><ChevronDown size={15} /></div>
      <div className="nav-caption">WORKSPACE</div>
      <nav className="side-nav">{visibleLinks.map(({ to, label, icon: Icon }) => <NavLink key={to} end={to === '/'} to={to} onClick={() => setMenuOpen(false)} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}><Icon size={18} strokeWidth={1.8} /><span>{label}</span>{label === 'Notifications' && unread > 0 && <i className="nav-count">{unread > 9 ? '9+' : unread}</i>}</NavLink>)}</nav>
      <div className="sidebar-bottom"><div className="help-card"><CircleHelp size={17} /><div><strong>Need a hand?</strong><span>Read the setup guide</span></div><span className="help-arrow">↗</span></div><div className="user-menu"><div className="avatar avatar-mint">{initials(user.name)}</div><div className="user-menu-copy"><strong>{user.name}</strong><span>{titleCase(user.role)}</span></div><button onClick={logout} className="icon-button logout-button" aria-label="Sign out"><LogOut size={17} /></button></div></div>
    </aside>
    {menuOpen && <button className="mobile-scrim" onClick={() => setMenuOpen(false)} aria-label="Close navigation" />}
    <main className="main-area"><header className="topbar"><button className="mobile-menu icon-button" onClick={() => setMenuOpen(true)} aria-label="Open menu"><Menu size={20} /></button><div className="crumb"><span>Workspace</span><span className="crumb-slash">/</span><strong>{pageTitle}</strong></div><div className="topbar-right"><div className="live-status"><span />All systems operational</div><div className="topbar-divider" /><button className="topbar-user" onClick={() => navigate('/notifications')} title="Notifications"><Bell size={18} />{unread > 0 && <i />}</button><button className="topbar-avatar" onClick={() => navigate('/settings')}>{initials(user.name)}</button></div></header><div className="content"><Outlet /></div><footer className="footer"><span>VANDE OS <b>•</b> WORKSPACE</span><span>Built for people to do their best work.</span></footer></main>
  </div>;
}
