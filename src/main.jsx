import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  BarChart3, Bot, Building2, CalendarDays, Check, Clock3, Facebook,
  FileCheck2, Gauge, Instagram, KeyRound, LayoutDashboard, Linkedin,
  LogOut, Mail, Megaphone, MessageSquareText, PhoneCall, Plus,
  RadioTower, Search, Send, Settings2, ShieldCheck, SlidersHorizontal,
  Sparkles, Target, Trash2, Twitter, UserCog, Users, Workflow
} from 'lucide-react';
import './styles.css';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';
const TOKEN_KEY = 'octave.auth.token';

async function api(path, options = {}) {
  const token = localStorage.getItem(TOKEN_KEY);
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed: ${response.status}`);
  return body;
}

function uploadImage(file, purpose) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const result = await api('/api/uploads', { method: 'POST', body: JSON.stringify({ purpose, dataUrl: reader.result }) });
        resolve(result.url);
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = () => reject(new Error('Unable to read image'));
    reader.readAsDataURL(file);
  });
}

const posts = [
  ['09:30', 'Carousel: 5 signs your team needs a wellness reset', 'Instagram', 'Needs approval'],
  ['11:00', 'Thought-leadership post for HR leaders', 'LinkedIn', 'AI review'],
  ['15:15', 'Lead magnet email: free consultation invite', 'Email', 'Scheduled'],
  ['18:45', 'Retargeting ad variant B', 'Facebook', 'Drafting']
];
const navBase = [
  ['Overview', LayoutDashboard], ['Marketing', Megaphone], ['Leads', Target],
  ['Follow-ups', Workflow], ['Customers', Users], ['AI Agents', Bot], ['Settings', Settings2]
];
const platformNav = [['Admin', UserCog], ['AI Agents', Bot], ['Settings', Settings2]];
const tenantAdminNav = [['Tenant Setup', UserCog], ...navBase];

function App() {
  const [session, setSession] = useState(null);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      setBooting(false);
      return;
    }
    api('/api/auth/me')
      .then((result) => setSession({ token, user: result.user }))
      .catch(() => localStorage.removeItem(TOKEN_KEY))
      .finally(() => setBooting(false));
  }, []);

  if (booting) return <div className="bootScreen">Loading Octave CRM...</div>;
  if (!session) return <LoginPage onLogin={setSession} />;
  if (session.user.mustChangePassword) return <ForcePasswordChange session={session} onComplete={(user) => setSession({ ...session, user })} onLogout={() => { localStorage.removeItem(TOKEN_KEY); setSession(null); }} />;
  return <Workspace session={session} onLogout={() => { localStorage.removeItem(TOKEN_KEY); setSession(null); }} />;
}

function LoginPage({ onLogin }) {
  const resetToken = new URLSearchParams(window.location.search).get('resetToken') || '';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [resetEmail, setResetEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [mode, setMode] = useState(resetToken ? 'reset' : 'login');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function submit(event) {
    event.preventDefault();
    setError('');
    try {
      const result = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
      localStorage.setItem(TOKEN_KEY, result.token);
      onLogin({ token: result.token, user: result.user });
    } catch (err) {
      setError(err.message);
    }
  }

  async function requestReset(event) {
    event.preventDefault();
    setError('');
    setMessage('');
    try {
      const result = await api('/api/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email: resetEmail }) });
      setMessage(result.delivery?.sent ? 'Reset email sent.' : 'If the account exists, reset instructions will be sent when email is configured.');
    } catch (err) {
      setError(err.message);
    }
  }

  async function resetPassword(event) {
    event.preventDefault();
    setError('');
    setMessage('');
    try {
      await api('/api/auth/reset-password', { method: 'POST', body: JSON.stringify({ token: resetToken, newPassword }) });
      window.history.replaceState({}, '', window.location.pathname);
      setMode('login');
      setMessage('Password reset complete. Sign in with your new password.');
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <main className="loginShell">
      {mode === 'login' && <form className="loginCard" onSubmit={submit}>
        <div className="brand loginBrand"><div className="brandMark">O</div><div><strong>Octave CRM</strong><span>Multi-tenant AI marketing suite</span></div></div>
        <h1>Sign in</h1>
        <label>Email<input value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        {error && <div className="errorBox">{error}</div>}
        {message && <div className="credentialBox"><strong>{message}</strong></div>}
        <button className="primaryButton" type="submit"><KeyRound size={16} /> Login</button>
        <button className="linkButton" type="button" onClick={() => { setMode('forgot'); setError(''); setMessage(''); }}>Forgot password?</button>
      </form>}
      {mode === 'forgot' && <form className="loginCard" onSubmit={requestReset}>
        <div className="brand loginBrand"><div className="brandMark">O</div><div><strong>Octave CRM</strong><span>Password recovery</span></div></div>
        <h1>Reset password</h1>
        <label>Email<input value={resetEmail} onChange={(event) => setResetEmail(event.target.value)} required /></label>
        {error && <div className="errorBox">{error}</div>}
        {message && <div className="credentialBox"><strong>{message}</strong></div>}
        <button className="primaryButton" type="submit"><Mail size={16} /> Send reset link</button>
        <button className="linkButton" type="button" onClick={() => { setMode('login'); setError(''); setMessage(''); }}>Back to login</button>
      </form>}
      {mode === 'reset' && <form className="loginCard" onSubmit={resetPassword}>
        <div className="brand loginBrand"><div className="brandMark">O</div><div><strong>Octave CRM</strong><span>Choose a new password</span></div></div>
        <h1>New password</h1>
        <label>Password<input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required /></label>
        {error && <div className="errorBox">{error}</div>}
        {message && <div className="credentialBox"><strong>{message}</strong></div>}
        <button className="primaryButton" type="submit"><KeyRound size={16} /> Reset password</button>
      </form>}
    </main>
  );
}

function ForcePasswordChange({ session, onComplete, onLogout }) {
  const [form, setForm] = useState({ currentPassword: '', newPassword: '' });
  const [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault();
    setError('');
    try {
      await api('/api/auth/change-password', { method: 'POST', body: JSON.stringify(form) });
      const result = await api('/api/auth/me');
      onComplete(result.user);
    } catch (err) {
      setError(err.message);
    }
  }
  return <main className="loginShell"><form className="loginCard" onSubmit={submit}>
    <div className="brand loginBrand"><div className="brandMark">O</div><div><strong>Octave CRM</strong><span>{session.user.email}</span></div></div>
    <h1>Change password</h1>
    <label>Temporary password<input type="password" value={form.currentPassword} onChange={(event) => setForm({ ...form, currentPassword: event.target.value })} required /></label>
    <label>New password<input type="password" value={form.newPassword} onChange={(event) => setForm({ ...form, newPassword: event.target.value })} required /></label>
    {error && <div className="errorBox">{error}</div>}
    <button className="primaryButton" type="submit"><KeyRound size={16} /> Continue</button>
    <button className="linkButton" type="button" onClick={onLogout}>Logout</button>
  </form></main>;
}

function Workspace({ session, onLogout }) {
  const isAdmin = session.user.platformRole === 'platform_admin';
  const [view, setView] = useState(isAdmin ? 'Admin' : 'Marketing');
  const [tenants, setTenants] = useState([session.user.tenant]);
  const [tenantId, setTenantId] = useState(session.user.tenantId);
  const [systemStatus, setSystemStatus] = useState(null);
  const canManageTenant = isAdmin || session.user.platformRole === 'tenant_admin';
  const nav = isAdmin ? platformNav : session.user.platformRole === 'tenant_admin' ? tenantAdminNav : navBase;
  const tenant = tenants.find((item) => item.id === tenantId) || session.user.tenant;

  useEffect(() => {
    api('/api/tenants').then((result) => setTenants(result.tenants || [session.user.tenant])).catch(() => {});
    api('/api/system/status').then((result) => setSystemStatus(result)).catch((err) => setSystemStatus({ ok: false, paperclip: { error: err.message } }));
  }, [session.user.tenant]);

  return (
    <main className="shell">
      <aside className="sidebar">
        <BrandBlock isAdmin={isAdmin} tenant={tenant} role={session.user.role} />
        <nav className="navList">{nav.map(([label, Icon]) => <button className={view === label ? 'navItem active' : 'navItem'} key={label} onClick={() => setView(label)}><Icon size={18} /><span>{label}</span></button>)}</nav>
        <div className="approvalPanel"><ShieldCheck size={20} /><div><strong>Human approval</strong><span>Required before execution</span></div></div>
      </aside>
      <section className="workspace">
        <Topbar user={session.user} tenants={tenants} tenantId={tenantId} setTenantId={setTenantId} onLogout={onLogout} isAdmin={isAdmin} />
        {!isAdmin && <Hero tenant={tenant} />}
        {!isAdmin && <Stats systemStatus={systemStatus} tenantId={tenantId} />}
        {view === 'Admin' && isAdmin && <AdminConsole tenants={tenants} setTenants={setTenants} tenantId={tenantId} setTenantId={setTenantId} isPlatformAdmin={isAdmin} />}
        {view === 'Tenant Setup' && session.user.platformRole === 'tenant_admin' && <AdminConsole tenants={tenants} setTenants={setTenants} tenantId={tenantId} setTenantId={setTenantId} isPlatformAdmin={false} />}
        {!isAdmin && view === 'Overview' && <Overview tenantId={tenantId} canApprove={session.user.platformRole === 'tenant_admin' || session.user.platformRole === 'approver'} />}
        {!isAdmin && view === 'Marketing' && <Marketing tenantId={tenantId} canApprove={session.user.platformRole === 'tenant_admin' || session.user.platformRole === 'approver'} />}
        {!isAdmin && view === 'Leads' && <Leads tenantId={tenantId} />}
        {!isAdmin && view === 'Follow-ups' && <FollowUps tenantId={tenantId} />}
        {!isAdmin && view === 'Customers' && <Customers tenant={tenant} />}
        {view === 'AI Agents' && <AgentAdmin tenantId={tenantId} isAdmin={isAdmin} isPlatformHome={isAdmin && tenantId === session.user.tenantId} selectedTenantName={tenant.name} />}
        {view === 'Settings' && <Settings tenant={tenant} user={session.user} systemStatus={systemStatus} tenantId={tenantId} canManageEmail={canManageTenant} canManageTenantBrand={!isAdmin && canManageTenant} isPlatformAdmin={isAdmin} />}
      </section>
    </main>
  );
}

function Topbar({ user, tenants, tenantId, setTenantId, onLogout, isAdmin }) {
  return <header className="topbar">
    <div className="tenantSelect"><Building2 size={18} /><select disabled={!isAdmin} value={tenantId} onChange={(event) => setTenantId(event.target.value)}>{tenants.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
    <div className="searchBox"><Search size={17} /><input placeholder={isAdmin ? 'Search companies and users' : 'Search campaigns, leads, customers'} /></div>
    <div className="userSelect">{user.avatarUrl ? <img className="avatarImage" src={user.avatarUrl} alt="" /> : <span className="avatar">{user.initials}</span>}<strong>{user.name}</strong></div>
    <button className="iconTextButton" onClick={onLogout}><LogOut size={16} /> Logout</button>
  </header>;
}

function BrandBlock({ isAdmin, tenant, role }) {
  const logo = isAdmin ? '/octave-logo.jpeg' : tenant.logoUrl;
  return <div className="brand">{logo ? <img className="brandLogo" src={logo} alt="" /> : <div className="brandMark">O</div>}<div><strong>{isAdmin ? 'Octave CRM' : tenant.name}</strong><span>{isAdmin ? 'Platform admin' : role}</span></div></div>;
}

function Hero({ tenant }) {
  return <section className="heroBand">
    <div className="heroCopy"><div className="eyebrow"><Sparkles size={16} /> Digital & Social Media Marketing</div><h1>{tenant.name}</h1><p>Plan campaigns, generate content, capture leads, and route AI-generated work through Paperclip and local Ollama models with final human approval.</p></div>
    <div className="signalBoard"><div className="signalHeader"><RadioTower size={18} /><span>Live channel signal</span></div><div className="signalBars">{[48, 76, 62, 89, 54, 71].map((height) => <span key={height} style={{ height: `${height}%` }} />)}</div><div className="channelIcons"><Instagram size={18} /><Facebook size={18} /><Linkedin size={18} /><Twitter size={18} /><Mail size={18} /></div></div>
  </section>;
}

function Stats({ systemStatus, tenantId }) {
  const [summary, setSummary] = useState({ campaigns: 0, leads: 0, approvals: 0, tasks: 0 });
  const paperclip = systemStatus?.paperclip?.ok ? 'Paperclip online' : 'Paperclip pending';
  useEffect(() => { api(`/api/dashboard/summary?tenantId=${tenantId}`).then((result) => setSummary(result.summary || summary)).catch(() => {}); }, [tenantId]);
  return <section className="statsGrid">
    <Metric icon={Megaphone} label="Active campaigns" value={summary.campaigns} delta="Database backed" />
    <Metric icon={Target} label="Leads" value={summary.leads} delta="Tenant scoped" />
    <Metric icon={FileCheck2} label="Pending approvals" value={summary.approvals} delta={`${summary.tasks} open tasks`} />
    <Metric icon={Bot} label="Agent status" value={systemStatus?.ok ? 'Ready' : 'Check'} delta={paperclip} />
  </section>;
}

function AdminConsole({ tenants, setTenants, tenantId, setTenantId, isPlatformAdmin }) {
  const [tenantForm, setTenantForm] = useState({ name: '', plan: 'Starter', logoUrl: '', adminName: '', adminEmail: '', adminPassword: 'Tenant@12345', dummyUserCount: 0, dummyUserPassword: 'User@12345' });
  const [userForm, setUserForm] = useState({ name: '', email: '', password: 'User@12345', role: 'Tenant User', platformRole: 'tenant_user', team: 'Marketing', avatarUrl: '', dummyUserCount: 0, dummyUserPassword: 'User@12345' });
  const [passwordForm, setPasswordForm] = useState({ userId: '', newPassword: 'User@12345' });
  const [socialForm, setSocialForm] = useState({ platform: 'Instagram', handle: '', accessToken: '', appId: '', appSecret: '', pageId: '', status: 'Active' });
  const [users, setUsers] = useState([]);
  const [socialAccounts, setSocialAccounts] = useState([]);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!isPlatformAdmin) {
      loadUsers();
      loadSocialAccounts();
    }
  }, [tenantId, isPlatformAdmin]);

  async function loadUsers() {
    const result = await api(`/api/admin/users?tenantId=${tenantId}`);
    setUsers(result.users || []);
  }

  async function loadSocialAccounts() {
    const result = await api(`/api/social/accounts?tenantId=${tenantId}`);
    setSocialAccounts(result.accounts || []);
  }

  async function createTenant(event) {
    event.preventDefault();
    setMessage('');
    const result = await api('/api/admin/tenants', { method: 'POST', body: JSON.stringify(tenantForm) });
    setTenants([result.tenant, ...tenants]);
    setTenantId(result.tenant.id);
    setTenantForm({ name: '', plan: 'Starter', logoUrl: '', adminName: '', adminEmail: '', adminPassword: 'Tenant@12345', dummyUserCount: 0, dummyUserPassword: 'User@12345' });
    setMessage(`Created ${result.tenant.name}. ${result.dummyUsers?.length || 0} dummy user(s). Email ${deliveryText(result.emailDelivery)}`);
  }

  async function createUser(event) {
    event.preventDefault();
    setMessage('');
    const result = await api('/api/admin/users', { method: 'POST', body: JSON.stringify({ ...userForm, tenantId }) });
    const created = [result.user, ...(result.dummyUsers || [])].filter(Boolean);
    setUsers([...created, ...users]);
    setUserForm({ name: '', email: '', password: 'User@12345', role: 'Tenant User', platformRole: 'tenant_user', team: 'Marketing', avatarUrl: '', dummyUserCount: 0, dummyUserPassword: 'User@12345' });
    setMessage(`Created ${created.length} user(s). Email ${deliveryText(result.emailDelivery)}`);
  }

  async function setTenantStatus(id, status) {
    setMessage('');
    const result = await api(`/api/admin/tenants/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
    setTenants(tenants.map((item) => item.id === id ? { ...item, ...result.tenant } : item));
    setMessage(`${result.tenant.name} is now ${result.tenant.status}`);
  }

  async function deleteTenant(id) {
    const tenant = tenants.find((item) => item.id === id);
    if (!window.confirm(`Delete ${tenant?.name || 'this company'} and all its users?`)) return;
    setMessage('');
    await api(`/api/admin/tenants/${id}`, { method: 'DELETE' });
    const remaining = tenants.filter((item) => item.id !== id);
    setTenants(remaining);
    if (tenantId === id && remaining[0]) setTenantId(remaining[0].id);
    setMessage('Company and related users were deleted');
  }

  async function changeUserPassword(event) {
    event.preventDefault();
    setMessage('');
    if (!passwordForm.userId) return setMessage('Select a user first');
    const result = await api(`/api/admin/users/${passwordForm.userId}/password`, { method: 'POST', body: JSON.stringify({ newPassword: passwordForm.newPassword }) });
    setPasswordForm({ userId: '', newPassword: 'User@12345' });
    setMessage(`Password updated for ${result.user.email}`);
  }

  async function toggleUserAccess(user) {
    setMessage('');
    const result = await api(`/api/admin/users/${user.id}`, { method: 'PATCH', body: JSON.stringify({ tenantId, isActive: !user.isActive }) });
    setUsers((current) => current.map((item) => item.id === user.id ? result.user : item));
    setMessage(`${result.user.email} is now ${result.user.isActive ? 'active' : 'inactive'}`);
  }

  async function deleteUser(user) {
    if (!window.confirm(`Delete ${user.name || user.email}?`)) return;
    setMessage('');
    await api(`/api/admin/users/${user.id}`, { method: 'DELETE', body: JSON.stringify({ tenantId }) });
    setUsers((current) => current.filter((item) => item.id !== user.id));
    setMessage(`${user.email} was deleted`);
  }

  async function saveSocialAccount(event) {
    event.preventDefault();
    setMessage('');
    const credentials = {
      accessToken: socialForm.accessToken,
      appId: socialForm.appId,
      appSecret: socialForm.appSecret,
      pageId: socialForm.pageId
    };
    const result = await api('/api/social/accounts', {
      method: 'POST',
      body: JSON.stringify({ tenantId, platform: socialForm.platform, handle: socialForm.handle, status: socialForm.status, credentials })
    });
    setSocialAccounts((current) => [result.account, ...current.filter((item) => item.id !== result.account.id)]);
    setSocialForm({ platform: socialForm.platform, handle: '', accessToken: '', appId: '', appSecret: '', pageId: '', status: 'Active' });
    setMessage(`${result.account.platform} handle saved for agents`);
  }

  async function deleteSocialAccount(id) {
    await api(`/api/social/accounts/${id}`, { method: 'DELETE', body: JSON.stringify({ tenantId }) });
    setSocialAccounts((current) => current.filter((item) => item.id !== id));
    setMessage('Social handle removed');
  }

  return <section className="contentGrid">
    <Panel wide icon={UserCog} title={isPlatformAdmin ? 'Platform Admin Console' : 'Tenant Setup'} action="Secure">
      {message && <div className="statusStrip"><strong>{message}</strong><span>Changes are saved in PostgreSQL</span></div>}
      <div className="adminGrid">
        {isPlatformAdmin && <form className="agentForm" onSubmit={createTenant}>
          <h3>Create Company</h3>
          <label>Company name<input value={tenantForm.name} onChange={(event) => setTenantForm({ ...tenantForm, name: event.target.value })} required /></label>
          <label>Plan<select value={tenantForm.plan} onChange={(event) => setTenantForm({ ...tenantForm, plan: event.target.value })}><option>Starter</option><option>Growth</option><option>Scale</option></select></label>
          <label>Company logo URL<input value={tenantForm.logoUrl} onChange={(event) => setTenantForm({ ...tenantForm, logoUrl: event.target.value })} placeholder="https://..." /></label>
          <label>Tenant admin name<input value={tenantForm.adminName} onChange={(event) => setTenantForm({ ...tenantForm, adminName: event.target.value })} /></label>
          <label>Tenant admin email<input value={tenantForm.adminEmail} onChange={(event) => setTenantForm({ ...tenantForm, adminEmail: event.target.value })} /></label>
          <label>Tenant admin password<input value={tenantForm.adminPassword} onChange={(event) => setTenantForm({ ...tenantForm, adminPassword: event.target.value })} /></label>
          <label>Dummy tenant users<input type="number" min="0" max="50" value={tenantForm.dummyUserCount} onChange={(event) => setTenantForm({ ...tenantForm, dummyUserCount: event.target.value })} /></label>
          <label>Dummy user password<input value={tenantForm.dummyUserPassword} onChange={(event) => setTenantForm({ ...tenantForm, dummyUserPassword: event.target.value })} /></label>
          <button className="primaryButton" type="submit"><Plus size={16} /> Create company</button>
        </form>}
        {!isPlatformAdmin && <form className="agentForm" onSubmit={createUser}>
          <h3>Create Tenant User</h3>
          <label>Name<input value={userForm.name} onChange={(event) => setUserForm({ ...userForm, name: event.target.value })} required={Number(userForm.dummyUserCount || 0) === 0} /></label>
          <label>Email<input value={userForm.email} onChange={(event) => setUserForm({ ...userForm, email: event.target.value })} required={Number(userForm.dummyUserCount || 0) === 0} /></label>
          <label>Password<input value={userForm.password} onChange={(event) => setUserForm({ ...userForm, password: event.target.value })} required={Number(userForm.dummyUserCount || 0) === 0} /></label>
          <label>Access<select value={userForm.platformRole} onChange={(event) => setUserForm({ ...userForm, platformRole: event.target.value, role: event.target.selectedOptions[0].text })}><option value="tenant_user">Tenant User</option><option value="tenant_admin">Tenant Admin</option><option value="approver">Approver</option></select></label>
          <label>Team<input value={userForm.team} onChange={(event) => setUserForm({ ...userForm, team: event.target.value })} /></label>
          <label>Avatar URL<input value={userForm.avatarUrl} onChange={(event) => setUserForm({ ...userForm, avatarUrl: event.target.value })} placeholder="https://..." /></label>
          <label>Additional dummy users<input type="number" min="0" max="50" value={userForm.dummyUserCount} onChange={(event) => setUserForm({ ...userForm, dummyUserCount: event.target.value })} /></label>
          <label>Dummy user password<input value={userForm.dummyUserPassword} onChange={(event) => setUserForm({ ...userForm, dummyUserPassword: event.target.value })} /></label>
          <button className="primaryButton" type="submit"><Plus size={16} /> Create user(s)</button>
        </form>}
        {!isPlatformAdmin && <form className="agentForm" onSubmit={changeUserPassword}>
          <h3>Reset User Password</h3>
          <label>User<select value={passwordForm.userId} onChange={(event) => setPasswordForm({ ...passwordForm, userId: event.target.value })}><option value="">Select user</option>{users.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.email}</option>)}</select></label>
          <label>New password<input type="password" value={passwordForm.newPassword} onChange={(event) => setPasswordForm({ ...passwordForm, newPassword: event.target.value })} required /></label>
          <button className="primaryButton" type="submit"><KeyRound size={16} /> Update password</button>
        </form>}
        {!isPlatformAdmin && <form className="agentForm" onSubmit={saveSocialAccount}>
          <h3>Social Handles</h3>
          <label>Platform<select value={socialForm.platform} onChange={(event) => setSocialForm({ ...socialForm, platform: event.target.value })}><option>Instagram</option><option>Facebook</option><option>LinkedIn</option><option>X / Twitter</option><option>YouTube</option><option>Email</option></select></label>
          <label>Handle / page<input value={socialForm.handle} onChange={(event) => setSocialForm({ ...socialForm, handle: event.target.value })} placeholder="@brand or page name" required /></label>
          <label>Access token<input type="password" value={socialForm.accessToken} onChange={(event) => setSocialForm({ ...socialForm, accessToken: event.target.value })} /></label>
          <label>App ID<input value={socialForm.appId} onChange={(event) => setSocialForm({ ...socialForm, appId: event.target.value })} /></label>
          <label>App secret<input type="password" value={socialForm.appSecret} onChange={(event) => setSocialForm({ ...socialForm, appSecret: event.target.value })} /></label>
          <label>Page / account ID<input value={socialForm.pageId} onChange={(event) => setSocialForm({ ...socialForm, pageId: event.target.value })} /></label>
          <button className="primaryButton" type="submit"><Check size={16} /> Save handle</button>
        </form>}
        <div className="agentCards adminList">
          {isPlatformAdmin && <article className="agentCard companyList"><h3>Companies</h3>{tenants.filter((item) => item.id !== 'platform').length ? tenants.filter((item) => item.id !== 'platform').map((item) => <div className="companyRow" key={item.id}><div><strong>{item.name}</strong><p>{item.plan} · {item.status}</p></div><div className="miniActions"><button onClick={() => setTenantStatus(item.id, item.status === 'Restricted' ? 'Active' : 'Restricted')}>{item.status === 'Restricted' ? 'Activate' : 'Restrict'}</button><button className="dangerButton" onClick={() => deleteTenant(item.id)}><Trash2 size={14} /></button></div></div>) : <p>No tenant companies created yet.</p>}</article>}
          {!isPlatformAdmin && <article className="agentCard companyList"><h3>Users</h3>{users.map((item) => <div className="companyRow" key={item.id}><div><strong>{item.name}</strong><p>{item.email} · {item.role}</p></div><div className="miniActions"><span className={item.isActive ? 'badge' : 'badge danger'}>{item.isActive ? 'Active' : 'Inactive'}</span><button onClick={() => toggleUserAccess(item)}>{item.isActive ? 'Disable' : 'Enable'}</button>{item.platformRole !== 'platform_admin' && <button className="dangerButton" onClick={() => deleteUser(item)}><Trash2 size={14} /></button>}</div></div>)}</article>}
          {!isPlatformAdmin && <article className="agentCard companyList"><h3>Agent Social Access</h3>{socialAccounts.length ? socialAccounts.map((item) => <div className="companyRow" key={item.id}><div><strong>{item.platform}</strong><p>{item.handle} · {item.credentialKeys?.length || 0} credential keys</p></div><div className="miniActions"><span className="badge">{item.status}</span><button className="dangerButton" onClick={() => deleteSocialAccount(item.id)}><Trash2 size={14} /></button></div></div>) : <p>No social handles configured yet.</p>}</article>}
          <ActivityPanel tenantId={tenantId} isPlatformAdmin={isPlatformAdmin} />
        </div>
      </div>
    </Panel>
  </section>;
}

function ActivityPanel({ tenantId, isPlatformAdmin = false }) {
  const [auditLogs, setAuditLogs] = useState([]);
  const [emailLogs, setEmailLogs] = useState([]);
  useEffect(() => {
    api(`/api/admin/audit-logs?tenantId=${tenantId}`).then((result) => setAuditLogs(result.logs || [])).catch(() => {});
    api(`/api/admin/email-logs?tenantId=${tenantId}`).then((result) => setEmailLogs(result.logs || [])).catch(() => {});
  }, [tenantId]);
  return <article className="agentCard companyList"><h3>{isPlatformAdmin ? 'Complete Platform Logs' : 'My Activity & Email Logs'}</h3><div className="activityGrid"><div>{auditLogs.slice(0, 6).map((item) => <div className="logRow" key={item.id}><strong>{item.action}</strong><p>{item.actor || 'System'} · {formatDue(item.createdAt)}</p></div>)}</div><div>{emailLogs.slice(0, 6).map((item) => <div className="logRow" key={item.id}><strong>{item.status}: {item.recipient}</strong><p>{item.subject}</p></div>)}</div></div></article>;
}

function Overview({ tenantId, canApprove }) {
  const [leadsData, setLeadsData] = useState([]);
  useEffect(() => { api(`/api/leads?tenantId=${tenantId}`).then((result) => setLeadsData(result.leads || [])).catch(() => {}); }, [tenantId]);
  const stages = ['New', 'Qualified', 'Proposal', 'Won'];
  return <section className="contentGrid"><Panel icon={BarChart3} title="Revenue Pipeline" action="Forecast"><div className="stageGrid">{stages.map((stage) => { const count = leadsData.filter((lead) => lead.stage === stage).length; return <div className="stageCard" key={stage}><span>{stage}</span><strong>{count}</strong><small>{count ? 'Active records' : 'No records yet'}</small></div>; })}</div></Panel><Panel icon={ShieldCheck} title="Approval Queue" action="Review"><ApprovalList tenantId={tenantId} canApprove={canApprove} /></Panel></section>;
}

function Marketing({ tenantId, canApprove }) {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState({ name: '', stage: 'Draft', progress: 0, budget: 0, leadsCount: 0, channels: 'Instagram, Email' });
  const [message, setMessage] = useState('');
  useEffect(() => { loadCampaigns(); }, [tenantId]);
  async function loadCampaigns() {
    const result = await api(`/api/campaigns?tenantId=${tenantId}`);
    setItems(result.campaigns || []);
  }
  async function createCampaign(event) {
    event.preventDefault();
    setMessage('');
    const result = await api('/api/campaigns', { method: 'POST', body: JSON.stringify({ ...form, tenantId }) });
    setItems([result.campaign, ...items]);
    setForm({ name: '', stage: 'Draft', progress: 0, budget: 0, leadsCount: 0, channels: 'Instagram, Email' });
    setMessage('Campaign saved');
  }
  async function updateCampaign(id, stage) {
    const result = await api(`/api/campaigns/${id}`, { method: 'PATCH', body: JSON.stringify({ tenantId, stage, progress: stage === 'Scheduled' ? 100 : undefined }) });
    setItems((current) => current.map((item) => item.id === id ? { ...item, ...result.campaign } : item));
  }
  async function deleteCampaign(id) {
    await api(`/api/campaigns/${id}`, { method: 'DELETE', body: JSON.stringify({ tenantId }) });
    setItems((current) => current.filter((item) => item.id !== id));
  }
  return <section className="contentGrid"><Panel wide icon={CalendarDays} title="Campaign Command Center" action="New campaign">{message && <div className="statusStrip"><strong>{message}</strong><span>Stored in PostgreSQL</span></div>}<div className="moduleGrid"><form className="agentForm" onSubmit={createCampaign}><h3>Create Campaign</h3><label>Name<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required /></label><label>Stage<select value={form.stage} onChange={(event) => setForm({ ...form, stage: event.target.value })}><option>Draft</option><option>AI drafting</option><option>Human approval</option><option>Scheduled</option></select></label><label>Progress<input type="number" min="0" max="100" value={form.progress} onChange={(event) => setForm({ ...form, progress: event.target.value })} /></label><label>Budget<input type="number" min="0" value={form.budget} onChange={(event) => setForm({ ...form, budget: event.target.value })} /></label><label>Leads<input type="number" min="0" value={form.leadsCount} onChange={(event) => setForm({ ...form, leadsCount: event.target.value })} /></label><label>Channels<input value={form.channels} onChange={(event) => setForm({ ...form, channels: event.target.value })} /></label><button className="primaryButton" type="submit"><Plus size={16} /> Save campaign</button></form><div className="campaignList">{items.map((campaign) => <CampaignRow campaign={campaign} key={campaign.id} onSchedule={() => updateCampaign(campaign.id, 'Scheduled')} onDelete={() => deleteCampaign(campaign.id)} />)}</div></div></Panel><PublishingQueue /><Panel icon={ShieldCheck} title="Approval Queue" action="Approve"><ApprovalList tenantId={tenantId} canApprove={canApprove} /></Panel></section>;
}

function Leads({ tenantId }) {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState({ company: '', contactName: '', email: '', score: 50, source: 'Website', stage: 'New', nextAction: '' });
  const [csv, setCsv] = useState('company,contact_name,email,score,source,stage,next_action\n');
  const [message, setMessage] = useState('');
  useEffect(() => { loadLeads(); }, [tenantId]);
  async function loadLeads() {
    const result = await api(`/api/leads?tenantId=${tenantId}`);
    setItems(result.leads || []);
  }
  async function createLead(event) {
    event.preventDefault();
    const result = await api('/api/leads', { method: 'POST', body: JSON.stringify({ ...form, tenantId }) });
    setItems([result.lead, ...items]);
    setForm({ company: '', contactName: '', email: '', score: 50, source: 'Website', stage: 'New', nextAction: '' });
  }
  async function updateLead(id, stage) {
    const result = await api(`/api/leads/${id}`, { method: 'PATCH', body: JSON.stringify({ tenantId, stage }) });
    setItems((current) => current.map((item) => item.id === id ? { ...item, ...result.lead } : item));
  }
  async function deleteLead(id) {
    await api(`/api/leads/${id}`, { method: 'DELETE', body: JSON.stringify({ tenantId }) });
    setItems((current) => current.filter((item) => item.id !== id));
  }
  async function importLeads(event) {
    event.preventDefault();
    const result = await api('/api/leads/import', { method: 'POST', body: JSON.stringify({ tenantId, csv }) });
    setMessage(`Imported ${result.imported} lead(s)`);
    await loadLeads();
  }
  async function exportLeads() {
    const result = await fetch(`${API_BASE_URL}/api/leads/export?tenantId=${tenantId}`, { headers: { authorization: `Bearer ${localStorage.getItem(TOKEN_KEY)}` } });
    setCsv(await result.text());
    setMessage('CSV export loaded below');
  }
  async function convertLead(id) {
    const result = await api(`/api/leads/${id}/convert`, { method: 'POST', body: JSON.stringify({ tenantId }) });
    setMessage(`Converted to customer: ${result.customer.name}`);
    await loadLeads();
  }
  return <section className="contentGrid"><Panel wide icon={Target} title="Lead Capture & Qualification" action="Sync leads">{message && <div className="statusStrip"><strong>{message}</strong><span>Lead operations are audited</span></div>}<div className="moduleGrid"><form className="agentForm" onSubmit={createLead}><h3>Create Lead</h3><label>Company<input value={form.company} onChange={(event) => setForm({ ...form, company: event.target.value })} required /></label><label>Contact<input value={form.contactName} onChange={(event) => setForm({ ...form, contactName: event.target.value })} required /></label><label>Email<input value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label><label>Score<input type="number" min="0" max="100" value={form.score} onChange={(event) => setForm({ ...form, score: event.target.value })} /></label><label>Source<input value={form.source} onChange={(event) => setForm({ ...form, source: event.target.value })} /></label><label>Stage<select value={form.stage} onChange={(event) => setForm({ ...form, stage: event.target.value })}><option>New</option><option>Qualified</option><option>Proposal</option><option>Won</option></select></label><label>Next action<input value={form.nextAction} onChange={(event) => setForm({ ...form, nextAction: event.target.value })} /></label><button className="primaryButton" type="submit"><Plus size={16} /> Save lead</button></form><div className="leadTable">{items.map((lead) => <article className="leadTableRow" key={lead.id}><div className="leadScore">{lead.score}</div><div><h3>{lead.company}</h3><p>{lead.contactName} · {lead.source || lead.email || 'No source'}</p></div><span>{lead.stage}</span><strong>{lead.nextAction || 'No action'}</strong><div className="miniActions"><button onClick={() => updateLead(lead.id, 'Qualified')}>Qualify</button><button onClick={() => convertLead(lead.id)}>Convert</button><button className="dangerButton" onClick={() => deleteLead(lead.id)}><Trash2 size={14} /></button></div></article>)}</div></div></Panel><Panel icon={FileCheck2} title="Import / Export" action="CSV"><form className="agentForm" onSubmit={importLeads}><label>Lead CSV<textarea rows="8" value={csv} onChange={(event) => setCsv(event.target.value)} /></label><div className="formActions"><button className="secondaryButton" type="button" onClick={exportLeads}><FileCheck2 size={16} /> Export</button><button className="primaryButton" type="submit"><Plus size={16} /> Import</button></div></form></Panel></section>;
}

function FollowUps({ tenantId }) {
  const [items, setItems] = useState([]);
  const [assignableUsers, setAssignableUsers] = useState([]);
  const [form, setForm] = useState({ title: '', ownerUserId: '', dueAt: '', priority: 'Medium', channel: 'Email', status: 'Open' });
  useEffect(() => { loadTasks(); loadAssignableUsers(); }, [tenantId]);
  async function loadTasks() {
    const result = await api(`/api/follow-ups?tenantId=${tenantId}`);
    setItems(result.tasks || []);
  }
  async function loadAssignableUsers() {
    const result = await api(`/api/users/assignable?tenantId=${tenantId}`);
    setAssignableUsers(result.users || []);
    setForm((current) => current.ownerUserId ? current : { ...current, ownerUserId: result.users?.[0]?.id || '' });
  }
  async function createTask(event) {
    event.preventDefault();
    const result = await api('/api/follow-ups', { method: 'POST', body: JSON.stringify({ ...form, tenantId }) });
    setItems([result.task, ...items]);
    setForm({ title: '', ownerUserId: assignableUsers[0]?.id || '', dueAt: '', priority: 'Medium', channel: 'Email', status: 'Open' });
  }
  async function completeTask(id) {
    const result = await api(`/api/follow-ups/${id}`, { method: 'PATCH', body: JSON.stringify({ tenantId, status: 'Done' }) });
    setItems((current) => current.map((item) => item.id === id ? { ...item, ...result.task } : item));
  }
  async function assignTask(id, ownerUserId) {
    const result = await api(`/api/follow-ups/${id}`, { method: 'PATCH', body: JSON.stringify({ tenantId, ownerUserId }) });
    setItems((current) => current.map((item) => item.id === id ? { ...item, ...result.task } : item));
  }
  async function deleteTask(id) {
    await api(`/api/follow-ups/${id}`, { method: 'DELETE', body: JSON.stringify({ tenantId }) });
    setItems((current) => current.filter((item) => item.id !== id));
  }
  return <section className="contentGrid"><Panel wide icon={Workflow} title="Follow-up Workbench" action="Create task"><div className="moduleGrid"><form className="agentForm" onSubmit={createTask}><h3>Create Task</h3><label>Title<input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} required /></label><label>Assign to<select value={form.ownerUserId} onChange={(event) => setForm({ ...form, ownerUserId: event.target.value })}>{assignableUsers.map((user) => <option key={user.id} value={user.id}>{user.name} · {user.role}</option>)}</select></label><label>Due at<input type="datetime-local" value={form.dueAt} onChange={(event) => setForm({ ...form, dueAt: event.target.value })} /></label><label>Priority<select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })}><option>Low</option><option>Medium</option><option>High</option></select></label><label>Channel<select value={form.channel} onChange={(event) => setForm({ ...form, channel: event.target.value })}><option>Email</option><option>Phone</option><option>Social</option><option>Meeting</option></select></label><button className="primaryButton" type="submit"><Plus size={16} /> Save task</button></form><div className="taskBoard">{items.map((task) => <article className="taskCard" key={task.id}><div><strong>{task.title}</strong><p>{task.channel} · {task.status}</p><p>Assigned to {task.owner || 'Unassigned'}</p></div><span className={task.priority === 'High' ? 'badge danger' : 'badge'}>{task.priority}</span><small>{formatDue(task.dueAt)}</small><label>Assign<select value={task.ownerUserId || ''} onChange={(event) => assignTask(task.id, event.target.value)}>{assignableUsers.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label><div className="miniActions"><button onClick={() => completeTask(task.id)}>Done</button><button className="dangerButton" onClick={() => deleteTask(task.id)}><Trash2 size={14} /></button></div></article>)}</div></div></Panel><Panel icon={PhoneCall} title="Today" action="Start"><SettingsList items={[['Open tasks', items.filter((task) => task.status !== 'Done').length], ['High priority', items.filter((task) => task.priority === 'High').length], ['Completed', items.filter((task) => task.status === 'Done').length]]} /></Panel></section>;
}

function Customers({ tenant }) {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState({ name: '', health: 75, plan: tenant.plan || 'Starter', mrr: 0, status: 'Active' });
  useEffect(() => { loadCustomers(); }, [tenant.id]);
  async function loadCustomers() {
    const result = await api(`/api/customers?tenantId=${tenant.id}`);
    setItems(result.customers || []);
  }
  async function createCustomer(event) {
    event.preventDefault();
    const result = await api('/api/customers', { method: 'POST', body: JSON.stringify({ ...form, tenantId: tenant.id }) });
    setItems([result.customer, ...items]);
    setForm({ name: '', health: 75, plan: tenant.plan || 'Starter', mrr: 0, status: 'Active' });
  }
  async function deleteCustomer(id) {
    await api(`/api/customers/${id}`, { method: 'DELETE', body: JSON.stringify({ tenantId: tenant.id }) });
    setItems((current) => current.filter((item) => item.id !== id));
  }
  return <section className="contentGrid"><Panel wide icon={Users} title="Customer Relationship Management" action="Add customer"><div className="moduleGrid"><form className="agentForm" onSubmit={createCustomer}><h3>Create Customer</h3><label>Name<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required /></label><label>Health<input type="number" min="0" max="100" value={form.health} onChange={(event) => setForm({ ...form, health: event.target.value })} /></label><label>Plan<input value={form.plan} onChange={(event) => setForm({ ...form, plan: event.target.value })} /></label><label>MRR<input type="number" min="0" value={form.mrr} onChange={(event) => setForm({ ...form, mrr: event.target.value })} /></label><label>Status<input value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })} /></label><button className="primaryButton" type="submit"><Plus size={16} /> Save customer</button></form><div className="customerGrid">{items.map((customer) => <article className="customerCard" key={customer.id}><div className="customerTop"><div><h3>{customer.name}</h3><p>{customer.plan} · {formatCurrency(customer.mrr)} MRR</p></div><Gauge size={19} /></div><div className="progressTrack"><span style={{ width: `${customer.health}%` }} /></div><footer><strong>{customer.health}% health</strong><span>{customer.status}</span></footer><button className="inlineAction dangerButton" onClick={() => deleteCustomer(customer.id)}><Trash2 size={14} /> Delete</button></article>)}</div></div></Panel></section>;
}

function AgentAdmin({ tenantId, isAdmin, isPlatformHome = false, selectedTenantName = '' }) {
  const [agents, setAgents] = useState([]);
  const [models, setModels] = useState([]);
  const [status, setStatus] = useState('Checking Paperclip and Ollama...');
  const [prompt, setPrompt] = useState('Write a three-line campaign idea for a wellness webinar.');
  const [output, setOutput] = useState('');
  const [modelToFetch, setModelToFetch] = useState('llama3.2:3b');
  const [paperclipModels, setPaperclipModels] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [agentCount, setAgentCount] = useState(6);
  const [editingAgentId, setEditingAgentId] = useState('');
  const [editAgent, setEditAgent] = useState(null);
  const [agentForm, setAgentForm] = useState({ name: 'Campaign Assistant', type: 'Content', model: 'llama3.1:8b', temperature: 0.4, approvalRule: 'Human approval before execution', tools: 'Caption draft, Email draft', systemPrompt: 'You create marketing drafts for human approval.' });
  const [workflowForm, setWorkflowForm] = useState({ type: 'campaign_brief', title: 'Campaign brief draft', campaignName: '', subject: '', recipient: '', channels: 'Email, Instagram', context: '', dueAt: '', priority: 'Medium', channel: 'Email' });
  const [jobs, setJobs] = useState([]);
  const [jobRuns, setJobRuns] = useState([]);
  const [jobForm, setJobForm] = useState({ name: 'Weekly campaign draft', schedule: 'Every Monday 09:00', nextRunAt: '', jobType: 'ai_workflow' });
  const selectedModel = agentForm.model || models[0]?.name || 'llama3.1:8b';

  useEffect(() => { refresh(); }, [tenantId]);

  async function refresh() {
    const [agentsResult, modelsResult, paperclipResult, paperclipModelsResult] = await Promise.allSettled([
      api(`/api/ai/agents?tenantId=${tenantId}`),
      api('/api/ai/ollama/installed'),
      api('/api/paperclip/status'),
      api('/api/paperclip/models')
    ]);
    if (agentsResult.status === 'fulfilled') setAgents(agentsResult.value.agents || []);
    if (modelsResult.status === 'fulfilled') setModels(modelsResult.value.installed || modelsResult.value.models || []);
    if (paperclipModelsResult.status === 'fulfilled') setPaperclipModels(paperclipModelsResult.value.models || []);
    if (isAdmin) {
      api('/api/ai/agent-templates').then((result) => {
        setTemplates(result.templates || []);
        setAgentCount((current) => Math.min(Math.max(Number(current) || result.recommendedAgents || 6, 1), result.maxAgents || 12));
      }).catch(() => {});
    }
    if (!isAdmin) {
      api(`/api/scheduled-jobs?tenantId=${tenantId}`).then((result) => setJobs(result.jobs || [])).catch(() => {});
      api(`/api/scheduled-job-runs?tenantId=${tenantId}`).then((result) => setJobRuns(result.runs || [])).catch(() => {});
    }
    setStatus(paperclipResult.status === 'fulfilled' && paperclipResult.value.ok ? 'Paperclip connected' : `Paperclip unavailable: ${paperclipResult.reason?.message || paperclipResult.value?.error || 'check container logs'}`);
  }

  async function fetchModel() {
    if (!modelToFetch.trim()) return;
    setStatus(`Fetching ${modelToFetch} from Ollama...`);
    setOutput(`Pulling ${modelToFetch}. This can take several minutes on first install.`);
    try {
      const result = await api('/api/ai/ollama/pull', { method: 'POST', body: JSON.stringify({ model: modelToFetch.trim() }) });
      setModels(result.installed || []);
      setAgentForm((current) => ({ ...current, model: modelToFetch.trim() }));
      setOutput(`${modelToFetch} is available to Ollama. Paperclip will use it when selected on an agent.`);
      await refresh();
    } catch (error) {
      setOutput(error.message);
      setStatus('Ollama model fetch failed');
    }
  }

  async function createAgent(event) {
    event.preventDefault();
    const result = await api('/api/ai/agents', { method: 'POST', body: JSON.stringify({ ...agentForm, tenantId, tools: agentForm.tools.split(',').map((item) => item.trim()).filter(Boolean) }) });
    setAgents([...agents, result.agent]);
    setStatus('AI agent configuration saved by platform admin');
  }

  function startEditAgent(agent) {
    setEditingAgentId(agent.id);
    setEditAgent({
      name: agent.name || '',
      type: agent.type || 'General',
      model: agent.model || selectedModel,
      temperature: agent.temperature ?? 0.4,
      approvalRule: agent.approvalRule || 'Human approval before execution',
      status: agent.status || 'Ready',
      tools: (agent.tools || []).join(', '),
      systemPrompt: agent.systemPrompt || ''
    });
  }

  async function saveAgentSettings(event) {
    event.preventDefault();
    if (!editingAgentId || !editAgent) return;
    const result = await api(`/api/ai/agents/${editingAgentId}`, {
      method: 'PUT',
      body: JSON.stringify({
        ...editAgent,
        tools: editAgent.tools.split(',').map((item) => item.trim()).filter(Boolean)
      })
    });
    setAgents((current) => current.map((agent) => agent.id === result.agent.id ? result.agent : agent));
    setEditingAgentId('');
    setEditAgent(null);
    setStatus(`${result.agent.name} settings updated`);
  }

  async function activateFramework() {
    setStatus(`Activating ${agentCount} templated agent(s)...`);
    try {
      const result = await api('/api/ai/framework/activate', { method: 'POST', body: JSON.stringify({ tenantId, model: selectedModel, agentCount: Number(agentCount) }) });
      setAgents(result.agents || []);
      setStatus(`Agentic framework active with ${result.agents?.length || 0} saved agent(s) on ${result.model}`);
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function testOllama() {
    setOutput('Running test prompt...');
    try {
      const result = await api('/api/ai/ollama/test', { method: 'POST', body: JSON.stringify({ model: selectedModel, prompt, temperature: agentForm.temperature }) });
      setOutput(result.response || 'No response returned.');
    } catch (error) { setOutput(error.message); }
  }

  async function runAgent(agent) {
    setOutput(`Running ${agent.name}...`);
    try {
      const result = await api(`/api/ai/agents/${agent.id}/run`, { method: 'POST', body: JSON.stringify({ prompt, risk: 'Medium', tenantId }) });
      setOutput(result.output || 'Agent completed without output.');
    } catch (error) { setOutput(error.message); }
  }

  async function runWorkflow(event) {
    event.preventDefault();
    setOutput('Creating AI workflow draft for approval...');
    try {
      const result = await api('/api/ai/workflows', { method: 'POST', body: JSON.stringify({ ...workflowForm, tenantId }) });
      setOutput(`${result.output}\n\nApproval created: ${result.approval.title}`);
    } catch (error) { setOutput(error.message); }
  }

  async function createSchedule(event) {
    event.preventDefault();
    const result = await api('/api/scheduled-jobs', { method: 'POST', body: JSON.stringify({ ...jobForm, tenantId, payload: workflowForm }) });
    setJobs((current) => [result.job, ...current]);
    setStatus(`Scheduled ${result.job.name}`);
  }

  async function updateSchedule(job, status) {
    const result = await api(`/api/scheduled-jobs/${job.id}`, { method: 'PATCH', body: JSON.stringify({ tenantId, status }) });
    setJobs((current) => current.map((item) => item.id === job.id ? result.job : item));
  }

  return <section className="contentGrid"><Panel wide icon={Bot} title={isAdmin ? 'Platform AI Agent Setup' : 'AI Agent Workspace'} action={isAdmin ? 'Platform controlled' : 'Draft only'}>
    <div className="statusStrip"><strong>{isAdmin ? `Target company: ${selectedTenantName || 'Select a company'}` : status}</strong><span>{models.length ? `${models.length} Ollama model(s), ${paperclipModels.length} mapped through Paperclip` : 'No Ollama models found yet'}</span></div>
    {isAdmin && isPlatformHome && <div className="errorBox">Create or select a tenant company before configuring AI agents. Platform agents are not configured against the internal Octave Platform account.</div>}
    {isAdmin && !isPlatformHome && <div className="statusStrip"><strong>{status}</strong><span>Agent changes apply only to the selected tenant company.</span></div>}
    {!isAdmin && <div className="errorBox">Only the platform admin can create or modify Paperclip AI agent configuration.</div>}
    <div className="agentLayout">
      {isAdmin && !isPlatformHome && <form className="agentForm" onSubmit={createAgent}>
        <label>Agent name<input value={agentForm.name} onChange={(event) => setAgentForm({ ...agentForm, name: event.target.value })} /></label>
        <label>Type<input value={agentForm.type} onChange={(event) => setAgentForm({ ...agentForm, type: event.target.value })} /></label>
        <label>Installed Ollama model<select value={agentForm.model} onChange={(event) => setAgentForm({ ...agentForm, model: event.target.value })}>{models.length ? models.map((model) => <option key={model.name} value={model.name}>{model.name}</option>) : <option value={agentForm.model}>{agentForm.model}</option>}</select></label>
        <label>Fetch / install model<div className="inlineField"><input value={modelToFetch} onChange={(event) => setModelToFetch(event.target.value)} placeholder="llama3.2:3b" /><button className="secondaryButton" type="button" onClick={fetchModel}><Plus size={16} /> Fetch</button></div></label>
        <label>Required agents<input type="number" min="1" max={templates.length || 12} value={agentCount} onChange={(event) => setAgentCount(event.target.value)} /></label>
        <div className="templatePreview">{templates.slice(0, Number(agentCount) || 0).map((template) => <span key={template.key}>{template.name}</span>)}</div>
        <label>Temperature<input type="number" step="0.1" min="0" max="1" value={agentForm.temperature} onChange={(event) => setAgentForm({ ...agentForm, temperature: event.target.value })} /></label>
        <label>Tools<input value={agentForm.tools} onChange={(event) => setAgentForm({ ...agentForm, tools: event.target.value })} /></label>
        <label>System prompt<textarea rows="4" value={agentForm.systemPrompt} onChange={(event) => setAgentForm({ ...agentForm, systemPrompt: event.target.value })} /></label>
        <label>Test prompt<textarea rows="4" value={prompt} onChange={(event) => setPrompt(event.target.value)} /></label>
        <div className="formActions"><button className="secondaryButton" type="button" onClick={activateFramework}><Bot size={16} /> Activate framework</button><button className="secondaryButton" type="button" onClick={testOllama}><SlidersHorizontal size={16} /> Test Ollama</button><button className="primaryButton" type="submit"><Check size={16} /> Save agent</button></div>
        <div className="responseBox">{output || 'Paperclip and Ollama output will appear here.'}</div>
      </form>}
      {!isAdmin && <form className="agentForm" onSubmit={runWorkflow}>
        <h3>AI Workflow</h3>
        <label>Workflow<select value={workflowForm.type} onChange={(event) => setWorkflowForm({ ...workflowForm, type: event.target.value })}><option value="campaign_brief">Campaign brief</option><option value="follow_up_email">Follow-up email</option><option value="follow_up_task">Follow-up task</option></select></label>
        <label>Title<input value={workflowForm.title} onChange={(event) => setWorkflowForm({ ...workflowForm, title: event.target.value })} /></label>
        {workflowForm.type === 'campaign_brief' && <label>Campaign name<input value={workflowForm.campaignName} onChange={(event) => setWorkflowForm({ ...workflowForm, campaignName: event.target.value })} /></label>}
        {workflowForm.type === 'follow_up_email' && <label>Recipient email<input value={workflowForm.recipient} onChange={(event) => setWorkflowForm({ ...workflowForm, recipient: event.target.value })} /></label>}
        <label>Subject<input value={workflowForm.subject} onChange={(event) => setWorkflowForm({ ...workflowForm, subject: event.target.value })} /></label>
        <label>Channels<input value={workflowForm.channels} onChange={(event) => setWorkflowForm({ ...workflowForm, channels: event.target.value })} /></label>
        {workflowForm.type === 'follow_up_task' && <label>Due at<input type="datetime-local" value={workflowForm.dueAt} onChange={(event) => setWorkflowForm({ ...workflowForm, dueAt: event.target.value })} /></label>}
        <label>Context<textarea rows="4" value={workflowForm.context} onChange={(event) => setWorkflowForm({ ...workflowForm, context: event.target.value })} /></label>
        <button className="primaryButton" type="submit"><Bot size={16} /> Generate for approval</button>
        <div className="responseBox">{output || 'Workflow drafts and execution notes will appear here.'}</div>
      </form>}
      {!isAdmin && <form className="agentForm" onSubmit={createSchedule}>
        <h3>Schedule Agent Work</h3>
        <label>Name<input value={jobForm.name} onChange={(event) => setJobForm({ ...jobForm, name: event.target.value })} /></label>
        <label>Schedule<input value={jobForm.schedule} onChange={(event) => setJobForm({ ...jobForm, schedule: event.target.value })} /></label>
        <label>Next run<input type="datetime-local" value={jobForm.nextRunAt} onChange={(event) => setJobForm({ ...jobForm, nextRunAt: event.target.value })} /></label>
        <button className="primaryButton" type="submit"><CalendarDays size={16} /> Save schedule</button>
        <div className="timeline">{jobs.map((job) => <div className="timeItem" key={job.id}><span className="time">{job.status}</span><div><strong>{job.name}</strong><p>{job.schedule} · {formatDue(job.nextRunAt)}{job.retryCount ? ` · ${job.retryCount} retries` : ''}</p>{job.lastError && <small>{job.lastError}</small>}<div className="miniActions"><button type="button" onClick={() => updateSchedule(job, job.status === 'Paused' ? 'Active' : 'Paused')}>{job.status === 'Paused' ? 'Resume' : 'Pause'}</button><button type="button" onClick={() => updateSchedule(job, 'Archived')}>Archive</button></div></div></div>)}</div>
        <h3>Recent Runs</h3>
        <div className="timeline">{jobRuns.slice(0, 5).map((run) => <div className="timeItem" key={run.id}><span className="time">{run.status}</span><div><strong>{run.jobName || 'Scheduled job'}</strong><p>{formatDue(run.startedAt)}{run.approvalId ? ` · approval ${run.approvalId.slice(0, 8)}` : ''}</p>{run.error && <small>{run.error}</small>}</div></div>)}</div>
      </form>}
      <div className="agentCards">{agents.map((agent) => <article className="agentCard" key={agent.id}>{isAdmin && editingAgentId === agent.id && editAgent ? <form className="inlineEditForm" onSubmit={saveAgentSettings}>
        <label>Name<input value={editAgent.name} onChange={(event) => setEditAgent({ ...editAgent, name: event.target.value })} /></label>
        <label>Function<input value={editAgent.type} onChange={(event) => setEditAgent({ ...editAgent, type: event.target.value })} /></label>
        <label>Model<select value={editAgent.model} onChange={(event) => setEditAgent({ ...editAgent, model: event.target.value })}>{models.length ? models.map((model) => <option key={model.name} value={model.name}>{model.name}</option>) : <option value={editAgent.model}>{editAgent.model}</option>}</select></label>
        <label>Temperature<input type="number" step="0.1" min="0" max="1" value={editAgent.temperature} onChange={(event) => setEditAgent({ ...editAgent, temperature: event.target.value })} /></label>
        <label>Status<select value={editAgent.status} onChange={(event) => setEditAgent({ ...editAgent, status: event.target.value })}><option>Ready</option><option>Paused</option><option>Testing</option></select></label>
        <label>Approval rule<input value={editAgent.approvalRule} onChange={(event) => setEditAgent({ ...editAgent, approvalRule: event.target.value })} /></label>
        <label>Tools<input value={editAgent.tools} onChange={(event) => setEditAgent({ ...editAgent, tools: event.target.value })} /></label>
        <label>System prompt<textarea rows="4" value={editAgent.systemPrompt} onChange={(event) => setEditAgent({ ...editAgent, systemPrompt: event.target.value })} /></label>
        <div className="formActions"><button className="secondaryButton" type="button" onClick={() => { setEditingAgentId(''); setEditAgent(null); }}>Cancel</button><button className="primaryButton" type="submit"><Check size={16} /> Save settings</button></div>
      </form> : <>
        <div className="agentTop"><div><h3>{agent.name}</h3><p>{agent.type} · {agent.model}</p></div><span>{Number(agent.temperature)}</span></div><div className="chips">{(agent.tools || []).map((tool) => <span key={tool}>{tool}</span>)}</div><footer><Clock3 size={15} /><span>{agent.approvalRule} · {agent.status}</span></footer>{isAdmin ? <button className="inlineAction" onClick={() => startEditAgent(agent)}>Edit settings</button> : <button className="inlineAction" onClick={() => runAgent(agent)}>Run draft</button>}
      </>}</article>)}</div>
    </div>
  </Panel></section>;
}

function Settings({ tenant, user, systemStatus, tenantId, canManageEmail, canManageTenantBrand, isPlatformAdmin }) {
  if (isPlatformAdmin) {
    return <section className="contentGrid"><Panel wide icon={Settings2} title="Platform Settings" action="Platform"><div className="settingsGrid"><SettingsList title="Platform" items={[['Name', 'Octave Platform'], ['Signed in as', `${user.name} · ${user.role}`], ['Company management', 'Admin view'], ['Tenant operations', 'Hidden from platform admin']]} /><SettingsList title="Security" items={[['Tenant isolation', 'Platform admin cannot open tenant operations'], ['AI configuration', 'Platform admin configures tenant agents only'], ['Logs', 'Complete platform audit/email logs']]} /><SettingsList title="Services" items={[['Paperclip', systemStatus?.paperclip?.ok ? 'Online' : systemStatus?.paperclip?.error || 'Unavailable'], ['Ollama', systemStatus?.ollama?.ok ? 'Online' : systemStatus?.ollama?.error || 'Unavailable'], ['CRM API', '/api']]} /><ObservabilityPanel tenantId={tenantId} /><PasswordPanel /><EmailConfigPanel tenantId={tenantId} canManageEmail={canManageEmail} isPlatformAdmin={isPlatformAdmin} /><ActivityPanel tenantId={tenantId} isPlatformAdmin={isPlatformAdmin} /></div></Panel></section>;
  }
  return <section className="contentGrid"><Panel wide icon={Settings2} title="Tenant Settings" action="Live"><div className="settingsGrid"><SettingsList title="Tenant" items={[['Name', tenant.name], ['Plan', tenant.plan], ['Status', tenant.status], ['Signed in as', `${user.name} · ${user.role}`]]} /><SettingsList title="Security" items={[['Approval mode', 'Required for publish/send actions'], ['Tenant isolation', 'API scoped by login token'], ['AI configuration', 'Platform admin only']]} /><SettingsList title="Integrations" items={[['Paperclip', systemStatus?.paperclip?.ok ? 'Online' : systemStatus?.paperclip?.error || 'Unavailable'], ['Ollama', systemStatus?.ollama?.ok ? 'Online' : systemStatus?.ollama?.error || 'Unavailable'], ['CRM API', '/api']]} /><ObservabilityPanel tenantId={tenantId} /><PasswordPanel /><ProfilePanel tenant={tenant} user={user} canManageTenant={canManageTenantBrand} /><EmailConfigPanel tenantId={tenantId} canManageEmail={canManageEmail} isPlatformAdmin={isPlatformAdmin} /><ActivityPanel tenantId={tenantId} isPlatformAdmin={isPlatformAdmin} /></div></Panel></section>;
}

function ObservabilityPanel({ tenantId }) {
  const [data, setData] = useState(null);
  useEffect(() => { api(`/api/system/observability?tenantId=${tenantId}`).then(setData).catch(() => {}); }, [tenantId]);
  return <div className="settingsList"><h3>Observability</h3><div className="settingRow"><span>Database</span><strong>{data?.services?.database?.ok ? 'Online' : 'Check'}</strong></div><div className="settingRow"><span>Ollama</span><strong>{data?.services?.ollama?.ok ? 'Online' : 'Check'}</strong></div><div className="settingRow"><span>Paperclip</span><strong>{data?.services?.paperclip?.ok ? 'Online' : 'Check'}</strong></div><div className="settingRow"><span>Audit events</span><strong>{data?.metrics?.auditEvents ?? '-'}</strong></div><div className="settingRow"><span>Pending approvals</span><strong>{data?.metrics?.pendingApprovals ?? '-'}</strong></div></div>;
}

function PasswordPanel() {
  const [form, setForm] = useState({ currentPassword: '', newPassword: '' });
  const [message, setMessage] = useState('');

  async function submit(event) {
    event.preventDefault();
    setMessage('');
    try {
      await api('/api/auth/change-password', { method: 'POST', body: JSON.stringify(form) });
      setForm({ currentPassword: '', newPassword: '' });
      setMessage('Password changed successfully');
    } catch (error) {
      setMessage(error.message);
    }
  }

  return <form className="settingsList passwordPanel" onSubmit={submit}>
    <h3>Change Password</h3>
    <label>Current password<input type="password" value={form.currentPassword} onChange={(event) => setForm({ ...form, currentPassword: event.target.value })} required /></label>
    <label>New password<input type="password" value={form.newPassword} onChange={(event) => setForm({ ...form, newPassword: event.target.value })} required /></label>
    {message && <small>{message}</small>}
    <button className="primaryButton" type="submit"><KeyRound size={16} /> Change password</button>
  </form>;
}

function ProfilePanel({ tenant, user, canManageTenant }) {
  const [form, setForm] = useState({ tenantLogoUrl: tenant.logoUrl || '', avatarUrl: user.avatarUrl || '' });
  const [message, setMessage] = useState('');

  async function submit(event) {
    event.preventDefault();
    setMessage('');
    try {
      await api('/api/settings/profile', { method: 'PATCH', body: JSON.stringify({ tenantLogoUrl: canManageTenant ? form.tenantLogoUrl : '', avatarUrl: form.avatarUrl }) });
      setMessage('Branding saved. Refresh to see it everywhere.');
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function upload(event, purpose) {
    const file = event.target.files?.[0];
    if (!file) return;
    setMessage('Uploading image...');
    try {
      const url = await uploadImage(file, purpose);
      setForm((current) => purpose === 'logo' ? { ...current, tenantLogoUrl: url } : { ...current, avatarUrl: url });
      setMessage('Image uploaded. Save branding to apply it.');
    } catch (error) {
      setMessage(error.message);
    }
  }

  return <form className="settingsList passwordPanel" onSubmit={submit}>
    <h3>Logo & Avatar</h3>
    {canManageTenant && <label>Company logo URL<input value={form.tenantLogoUrl} onChange={(event) => setForm({ ...form, tenantLogoUrl: event.target.value })} placeholder="https://..." /><input type="file" accept="image/*" onChange={(event) => upload(event, 'logo')} /></label>}
    <label>Your avatar URL<input value={form.avatarUrl} onChange={(event) => setForm({ ...form, avatarUrl: event.target.value })} placeholder="https://..." /><input type="file" accept="image/*" onChange={(event) => upload(event, 'avatar')} /></label>
    {message && <small>{message}</small>}
    <button className="primaryButton" type="submit"><Check size={16} /> Save branding</button>
  </form>;
}

function EmailConfigPanel({ tenantId, canManageEmail, isPlatformAdmin }) {
  const [form, setForm] = useState({ enabled: false, smtpHost: '', smtpPort: 587, smtpSecure: false, smtpUser: '', smtpPass: '', fromEmail: '', fromName: 'Octave CRM' });
  const [message, setMessage] = useState('');
  const [testTo, setTestTo] = useState('');

  useEffect(() => {
    if (!canManageEmail) return;
    api(`/api/email/config${isPlatformAdmin ? '' : `?tenantId=${tenantId}`}`).then((result) => setForm({ ...form, ...result.config, smtpPass: '' })).catch((error) => setMessage(error.message));
  }, [tenantId, canManageEmail, isPlatformAdmin]);

  if (!canManageEmail) return null;

  async function save(event) {
    event.preventDefault();
    setMessage('');
    try {
      await api('/api/email/config', { method: 'PUT', body: JSON.stringify({ ...form, tenantId: isPlatformAdmin ? null : tenantId }) });
      setMessage('Email configuration saved');
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function sendTest() {
    setMessage('Sending test email...');
    try {
      const result = await api('/api/email/test', { method: 'POST', body: JSON.stringify({ tenantId: isPlatformAdmin ? null : tenantId, to: testTo }) });
      setMessage(result.delivery?.sent ? 'Test email sent' : result.delivery?.reason || result.delivery?.error || 'Email test failed');
    } catch (error) {
      setMessage(error.message);
    }
  }

  return <form className="settingsList passwordPanel" onSubmit={save}>
    <h3>{isPlatformAdmin ? 'Platform Email' : 'Tenant Email'}</h3>
    <label className="checkLine"><input type="checkbox" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} /> Enable credential emails</label>
    <label>SMTP host<input value={form.smtpHost} onChange={(event) => setForm({ ...form, smtpHost: event.target.value })} placeholder="smtp.example.com" /></label>
    <label>SMTP port<input type="number" value={form.smtpPort} onChange={(event) => setForm({ ...form, smtpPort: event.target.value })} /></label>
    <label className="checkLine"><input type="checkbox" checked={form.smtpSecure} onChange={(event) => setForm({ ...form, smtpSecure: event.target.checked })} /> Use SSL/TLS</label>
    <label>SMTP user<input value={form.smtpUser} onChange={(event) => setForm({ ...form, smtpUser: event.target.value })} /></label>
    <label>SMTP password<input type="password" value={form.smtpPass} onChange={(event) => setForm({ ...form, smtpPass: event.target.value })} placeholder={form.hasPassword ? 'Saved password unchanged' : ''} /></label>
    <label>From email<input value={form.fromEmail} onChange={(event) => setForm({ ...form, fromEmail: event.target.value })} /></label>
    <label>From name<input value={form.fromName} onChange={(event) => setForm({ ...form, fromName: event.target.value })} /></label>
    <label>Test recipient<input value={testTo} onChange={(event) => setTestTo(event.target.value)} placeholder="name@example.com" /></label>
    {message && <small>{message}</small>}
    <div className="formActions"><button className="secondaryButton" type="button" onClick={sendTest}><Send size={16} /> Test</button><button className="primaryButton" type="submit"><Check size={16} /> Save email</button></div>
  </form>;
}

function ApprovalList({ tenantId, canApprove = true }) {
  const [items, setItems] = useState([]);
  useEffect(() => { api(`/api/approvals?tenantId=${tenantId}`).then((result) => setItems(result.approvals || [])).catch(() => {}); }, [tenantId]);
  async function decide(id, status) {
    await api(`/api/approvals/${id}`, { method: 'PATCH', body: JSON.stringify({ status, tenantId }) });
    const result = await api(`/api/approvals?tenantId=${tenantId}`);
    setItems(result.approvals || []);
  }
  return <div className="approvalList">{items.map((approval) => <article className="approvalItem" key={approval.id}><div><strong>{approval.title}</strong><p>{approval.agent || 'System'} · {approval.status}{approval.actionType ? ` · ${approval.actionType}` : ''}</p>{approval.executionResult && <small>{approval.executionResult.executed ? 'Executed' : 'Not executed'}{approval.executionResult.reason ? `: ${approval.executionResult.reason}` : ''}</small>}</div><span className={approval.risk === 'High' ? 'badge danger' : 'badge'}>{approval.risk}</span>{canApprove && approval.status === 'pending' && <div className="approvalActions"><button onClick={() => decide(approval.id, 'approved')}>Approve & execute</button><button onClick={() => decide(approval.id, 'rejected')}>Reject</button></div>}</article>)}</div>;
}

function CampaignRow({ campaign, onSchedule, onDelete }) {
  return <article className="campaignRow"><div><h3>{campaign.name}</h3><p>{campaign.owner || 'Unassigned'} · {campaign.stage}</p><div className="chips">{(campaign.channels || []).map((channel) => <span key={channel}>{channel}</span>)}</div></div><div className="progressBlock"><div className="progressMeta"><span>{campaign.progress}%</span><strong>{campaign.leadsCount || 0} leads</strong></div><div className="progressTrack"><span style={{ width: `${campaign.progress}%` }} /></div><small>{formatCurrency(campaign.budget)} budget</small><div className="miniActions"><button onClick={onSchedule}>Schedule</button><button className="dangerButton" onClick={onDelete}><Trash2 size={14} /></button></div></div></article>;
}
function PublishingQueue() {
  return <Panel icon={MessageSquareText} title="Publishing Queue" action="Draft post"><div className="timeline">{posts.map(([time, title, channel, status]) => <div className="timeItem" key={title}><span className="time">{time}</span><div><strong>{title}</strong><p>{channel} · {status}</p></div></div>)}</div></Panel>;
}
function Panel({ icon, title, action, wide, children }) {
  return <div className={wide ? 'widePanel' : 'panel'}><PanelHeader icon={icon} title={title} action={action} />{children}</div>;
}
function SettingsList({ items, title }) {
  return <div className="settingsList">{title && <h3>{title}</h3>}{items.map(([label, value]) => <div className="settingRow" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>;
}
function Metric({ icon: Icon, label, value, delta }) {
  return <article className="metric"><div className="metricIcon"><Icon size={18} /></div><span>{label}</span><strong>{value}</strong><small>{delta}</small></article>;
}
function PanelHeader({ icon: Icon, title, action }) {
  return <div className="panelHeader"><div><Icon size={18} /><h2>{title}</h2></div><button><Plus size={16} /><span>{action}</span></button></div>;
}

function deliveryText(delivery) {
  if (delivery?.sent) return 'sent.';
  if (delivery?.skipped) return `skipped: ${delivery.reason}.`;
  if (delivery?.error) return `failed: ${delivery.error}.`;
  return 'not sent.';
}

function formatCurrency(value) {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0, style: 'currency', currency: 'INR' }).format(Number(value || 0));
}

function formatDue(value) {
  if (!value) return 'No due date';
  return new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

createRoot(document.getElementById('root')).render(<App />);
