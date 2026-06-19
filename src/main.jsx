import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  BarChart3, Bot, Building2, CalendarDays, Check, Clock3, Facebook,
  FileCheck2, Gauge, Instagram, KeyRound, LayoutDashboard, Linkedin,
  LogOut, Mail, Megaphone, MessageSquareText, PhoneCall, Plus,
  RadioTower, Search, Send, Settings2, ShieldCheck, SlidersHorizontal,
  Sparkles, Target, Twitter, UserCog, Users, Workflow
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

const campaigns = [
  { name: 'Monsoon Wellness Reset', owner: 'Campaign Team', stage: 'Human approval', progress: 72, budget: '1.8L', leads: 284, approval: '2 creatives pending', channels: ['Instagram', 'Facebook', 'Email'] },
  { name: 'Corporate Health Webinar', owner: 'Tenant Admin', stage: 'AI drafting', progress: 48, budget: '85K', leads: 96, approval: 'Landing page copy', channels: ['LinkedIn', 'Email'] },
  { name: 'Referral Boost Week', owner: 'Approver', stage: 'Scheduled', progress: 91, budget: '42K', leads: 138, approval: 'Approved', channels: ['Instagram', 'Email'] }
];
const posts = [
  ['09:30', 'Carousel: 5 signs your team needs a wellness reset', 'Instagram', 'Needs approval'],
  ['11:00', 'Thought-leadership post for HR leaders', 'LinkedIn', 'AI review'],
  ['15:15', 'Lead magnet email: free consultation invite', 'Email', 'Scheduled'],
  ['18:45', 'Retargeting ad variant B', 'Facebook', 'Drafting']
];
const leads = [
  ['Acme Shared Services', 'Priya N.', 92, 'LinkedIn webinar', 'Qualified', 'Call today 16:00'],
  ['MetroBuild Group', 'Rohit V.', 84, 'Facebook lead form', 'Proposal', 'Send pricing deck'],
  ['Futura Labs', 'Sara M.', 78, 'Instagram DM', 'New', 'Qualify need'],
  ['NimbleWorks', 'Ishaan K.', 69, 'Email campaign', 'Nurture', 'Follow up in 2 days']
];
const navBase = [
  ['Overview', LayoutDashboard], ['Marketing', Megaphone], ['Leads', Target],
  ['Follow-ups', Workflow], ['Customers', Users], ['AI Agents', Bot], ['Settings', Settings2]
];

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
  return <Workspace session={session} onLogout={() => { localStorage.removeItem(TOKEN_KEY); setSession(null); }} />;
}

function LoginPage({ onLogin }) {
  const [email, setEmail] = useState('admin@octave.local');
  const [password, setPassword] = useState('Admin@12345');
  const [error, setError] = useState('');

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

  return (
    <main className="loginShell">
      <form className="loginCard" onSubmit={submit}>
        <div className="brand loginBrand"><div className="brandMark">O</div><div><strong>Octave CRM</strong><span>Multi-tenant AI marketing suite</span></div></div>
        <h1>Sign in</h1>
        <label>Email<input value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        {error && <div className="errorBox">{error}</div>}
        <button className="primaryButton" type="submit"><KeyRound size={16} /> Login</button>
        <div className="credentialBox">
          <strong>Initial credentials</strong>
          <span>Platform admin: admin@octave.local / Admin@12345</span>
          <span>Tenant admin: ananya@example.com / Tenant@12345</span>
          <span>Tenant user: karan@example.com / User@12345</span>
        </div>
      </form>
    </main>
  );
}

function Workspace({ session, onLogout }) {
  const [view, setView] = useState('Marketing');
  const [tenants, setTenants] = useState([session.user.tenant]);
  const [tenantId, setTenantId] = useState(session.user.tenantId);
  const [systemStatus, setSystemStatus] = useState(null);
  const isAdmin = session.user.platformRole === 'platform_admin';
  const nav = isAdmin ? [['Admin', UserCog], ...navBase] : navBase;
  const tenant = tenants.find((item) => item.id === tenantId) || session.user.tenant;

  useEffect(() => {
    api('/api/tenants').then((result) => setTenants(result.tenants || [session.user.tenant])).catch(() => {});
    api('/api/system/status').then((result) => setSystemStatus(result)).catch((err) => setSystemStatus({ ok: false, paperclip: { error: err.message } }));
  }, [session.user.tenant]);

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand"><div className="brandMark">O</div><div><strong>Octave CRM</strong><span>{isAdmin ? 'Platform admin' : session.user.role}</span></div></div>
        <nav className="navList">{nav.map(([label, Icon]) => <button className={view === label ? 'navItem active' : 'navItem'} key={label} onClick={() => setView(label)}><Icon size={18} /><span>{label}</span></button>)}</nav>
        <div className="approvalPanel"><ShieldCheck size={20} /><div><strong>Human approval</strong><span>Required before execution</span></div></div>
      </aside>
      <section className="workspace">
        <Topbar user={session.user} tenants={tenants} tenantId={tenantId} setTenantId={setTenantId} onLogout={onLogout} isAdmin={isAdmin} />
        <Hero tenant={tenant} />
        <Stats systemStatus={systemStatus} />
        {view === 'Admin' && isAdmin && <AdminConsole tenants={tenants} setTenants={setTenants} tenantId={tenantId} setTenantId={setTenantId} />}
        {view === 'Overview' && <Overview tenantId={tenantId} />}
        {view === 'Marketing' && <Marketing tenantId={tenantId} />}
        {view === 'Leads' && <Leads />}
        {view === 'Follow-ups' && <FollowUps />}
        {view === 'Customers' && <Customers tenant={tenant} />}
        {view === 'AI Agents' && <AgentAdmin tenantId={tenantId} isAdmin={isAdmin} />}
        {view === 'Settings' && <Settings tenant={tenant} user={session.user} systemStatus={systemStatus} />}
      </section>
    </main>
  );
}

function Topbar({ user, tenants, tenantId, setTenantId, onLogout, isAdmin }) {
  return <header className="topbar">
    <div className="tenantSelect"><Building2 size={18} /><select disabled={!isAdmin} value={tenantId} onChange={(event) => setTenantId(event.target.value)}>{tenants.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
    <div className="searchBox"><Search size={17} /><input placeholder="Search campaigns, leads, customers" /></div>
    <div className="userSelect"><span className="avatar">{user.initials}</span><strong>{user.name}</strong></div>
    <button className="iconTextButton" onClick={onLogout}><LogOut size={16} /> Logout</button>
  </header>;
}

function Hero({ tenant }) {
  return <section className="heroBand">
    <div className="heroCopy"><div className="eyebrow"><Sparkles size={16} /> Digital & Social Media Marketing</div><h1>{tenant.name}</h1><p>Plan campaigns, generate content, capture leads, and route AI-generated work through Paperclip and local Ollama models with final human approval.</p></div>
    <div className="signalBoard"><div className="signalHeader"><RadioTower size={18} /><span>Live channel signal</span></div><div className="signalBars">{[48, 76, 62, 89, 54, 71].map((height) => <span key={height} style={{ height: `${height}%` }} />)}</div><div className="channelIcons"><Instagram size={18} /><Facebook size={18} /><Linkedin size={18} /><Twitter size={18} /><Mail size={18} /></div></div>
  </section>;
}

function Stats({ systemStatus }) {
  const paperclip = systemStatus?.paperclip?.ok ? 'Paperclip online' : 'Paperclip pending';
  return <section className="statsGrid">
    <Metric icon={Megaphone} label="Active campaigns" value="12" delta="+3 this week" />
    <Metric icon={Target} label="New leads" value="518" delta="31% AI-qualified" />
    <Metric icon={FileCheck2} label="Pending approvals" value="9" delta="4 high priority" />
    <Metric icon={Bot} label="Agent status" value={systemStatus?.ok ? 'Ready' : 'Check'} delta={paperclip} />
  </section>;
}

function AdminConsole({ tenants, setTenants, tenantId, setTenantId }) {
  const [tenantForm, setTenantForm] = useState({ name: '', plan: 'Starter', adminName: '', adminEmail: '', adminPassword: 'Tenant@12345' });
  const [userForm, setUserForm] = useState({ name: '', email: '', password: 'User@12345', role: 'Tenant User', platformRole: 'tenant_user', team: 'Marketing' });
  const [users, setUsers] = useState([]);
  const [message, setMessage] = useState('');

  useEffect(() => { loadUsers(); }, [tenantId]);

  async function loadUsers() {
    const result = await api(`/api/admin/users?tenantId=${tenantId}`);
    setUsers(result.users || []);
  }

  async function createTenant(event) {
    event.preventDefault();
    setMessage('');
    const result = await api('/api/admin/tenants', { method: 'POST', body: JSON.stringify(tenantForm) });
    setTenants([result.tenant, ...tenants]);
    setTenantId(result.tenant.id);
    setTenantForm({ name: '', plan: 'Starter', adminName: '', adminEmail: '', adminPassword: 'Tenant@12345' });
    setMessage(`Created ${result.tenant.name}`);
  }

  async function createUser(event) {
    event.preventDefault();
    setMessage('');
    const result = await api('/api/admin/users', { method: 'POST', body: JSON.stringify({ ...userForm, tenantId }) });
    setUsers([result.user, ...users]);
    setUserForm({ name: '', email: '', password: 'User@12345', role: 'Tenant User', platformRole: 'tenant_user', team: 'Marketing' });
    setMessage(`Created user ${result.user.email}`);
  }

  return <section className="contentGrid">
    <Panel wide icon={UserCog} title="Platform Admin Console" action="Secure">
      {message && <div className="statusStrip"><strong>{message}</strong><span>Changes are saved in PostgreSQL</span></div>}
      <div className="adminGrid">
        <form className="agentForm" onSubmit={createTenant}>
          <h3>Create Company</h3>
          <label>Company name<input value={tenantForm.name} onChange={(event) => setTenantForm({ ...tenantForm, name: event.target.value })} required /></label>
          <label>Plan<select value={tenantForm.plan} onChange={(event) => setTenantForm({ ...tenantForm, plan: event.target.value })}><option>Starter</option><option>Growth</option><option>Scale</option></select></label>
          <label>Tenant admin name<input value={tenantForm.adminName} onChange={(event) => setTenantForm({ ...tenantForm, adminName: event.target.value })} /></label>
          <label>Tenant admin email<input value={tenantForm.adminEmail} onChange={(event) => setTenantForm({ ...tenantForm, adminEmail: event.target.value })} /></label>
          <label>Tenant admin password<input value={tenantForm.adminPassword} onChange={(event) => setTenantForm({ ...tenantForm, adminPassword: event.target.value })} /></label>
          <button className="primaryButton" type="submit"><Plus size={16} /> Create company</button>
        </form>
        <form className="agentForm" onSubmit={createUser}>
          <h3>Create Tenant User</h3>
          <label>Name<input value={userForm.name} onChange={(event) => setUserForm({ ...userForm, name: event.target.value })} required /></label>
          <label>Email<input value={userForm.email} onChange={(event) => setUserForm({ ...userForm, email: event.target.value })} required /></label>
          <label>Password<input value={userForm.password} onChange={(event) => setUserForm({ ...userForm, password: event.target.value })} required /></label>
          <label>Access<select value={userForm.platformRole} onChange={(event) => setUserForm({ ...userForm, platformRole: event.target.value, role: event.target.selectedOptions[0].text })}><option value="tenant_user">Tenant User</option><option value="tenant_admin">Tenant Admin</option><option value="approver">Approver</option></select></label>
          <label>Team<input value={userForm.team} onChange={(event) => setUserForm({ ...userForm, team: event.target.value })} /></label>
          <button className="primaryButton" type="submit"><Plus size={16} /> Create user</button>
        </form>
        <div className="agentCards adminList">{users.map((item) => <article className="agentCard" key={item.id}><div className="agentTop"><div><h3>{item.name}</h3><p>{item.email}</p></div><span>{item.initials}</span></div><footer><UserCog size={15} /><span>{item.role} · {item.team || 'No team'}</span></footer></article>)}</div>
      </div>
    </Panel>
  </section>;
}

function Overview({ tenantId }) {
  return <section className="contentGrid"><Panel icon={BarChart3} title="Revenue Pipeline" action="Forecast"><div className="stageGrid">{['New', 'Qualified', 'Proposal', 'Won'].map((stage, index) => <div className="stageCard" key={stage}><span>{stage}</span><strong>{[96, 64, 28, 11][index]}</strong><small>{['18.4L', '12.1L', '8.7L', '3.4L'][index]}</small></div>)}</div></Panel><Panel icon={ShieldCheck} title="Approval Queue" action="Review"><ApprovalList tenantId={tenantId} /></Panel></section>;
}

function Marketing({ tenantId }) {
  return <section className="contentGrid"><Panel wide icon={CalendarDays} title="Campaign Command Center" action="New campaign"><div className="campaignList">{campaigns.map((campaign) => <CampaignRow campaign={campaign} key={campaign.name} />)}</div></Panel><PublishingQueue /><Panel icon={ShieldCheck} title="Approval Queue" action="Approve"><ApprovalList tenantId={tenantId} /></Panel></section>;
}

function Leads() {
  return <section className="contentGrid"><Panel wide icon={Target} title="Lead Capture & Qualification" action="Sync leads"><div className="leadTable">{leads.map(([company, contact, score, source, stage, next]) => <article className="leadTableRow" key={company}><div className="leadScore">{score}</div><div><h3>{company}</h3><p>{contact} · {source}</p></div><span>{stage}</span><strong>{next}</strong></article>)}</div></Panel><PublishingQueue /></section>;
}

function FollowUps() {
  const tasks = [['Call Acme Shared Services', 'Today 16:00', 'High', 'Phone'], ['Approve webinar nurture email', 'Today 18:00', 'High', 'Email'], ['Send MetroBuild deck', 'Tomorrow 10:00', 'Medium', 'Email'], ['Qualify Instagram DM leads', 'Tomorrow 14:30', 'Medium', 'Social']];
  return <section className="contentGrid"><Panel wide icon={Workflow} title="Follow-up Workbench" action="Create task"><div className="taskBoard">{tasks.map(([title, due, priority, channel]) => <article className="taskCard" key={title}><div><strong>{title}</strong><p>{channel}</p></div><span className={priority === 'High' ? 'badge danger' : 'badge'}>{priority}</span><small>{due}</small></article>)}</div></Panel><Panel icon={PhoneCall} title="Today" action="Start"><SettingsList items={[['Calls', '3 scheduled'], ['Emails', '7 prepared drafts'], ['Approvals', '2 waiting']]} /></Panel></section>;
}

function Customers({ tenant }) {
  const customers = [[tenant.name, 91, tenant.plan, '1.2L', 'Expansion ready'], ['UrbanEdge Realty', 82, 'Scale', '2.8L', 'Onboarding'], ['BrightByte Academy', 74, 'Starter', '48K', 'Needs adoption']];
  return <section className="contentGrid"><Panel wide icon={Users} title="Customer Relationship Management" action="Add customer"><div className="customerGrid">{customers.map(([name, health, plan, mrr, status]) => <article className="customerCard" key={name}><div className="customerTop"><div><h3>{name}</h3><p>{plan} · {mrr} MRR</p></div><Gauge size={19} /></div><div className="progressTrack"><span style={{ width: `${health}%` }} /></div><footer><strong>{health}% health</strong><span>{status}</span></footer></article>)}</div></Panel></section>;
}

function AgentAdmin({ tenantId, isAdmin }) {
  const [agents, setAgents] = useState([]);
  const [models, setModels] = useState([]);
  const [status, setStatus] = useState('Checking Paperclip and Ollama...');
  const [prompt, setPrompt] = useState('Write a three-line campaign idea for a wellness webinar.');
  const [output, setOutput] = useState('');
  const [agentForm, setAgentForm] = useState({ name: 'Campaign Assistant', type: 'Content', model: 'llama3.1:8b', temperature: 0.4, approvalRule: 'Human approval before execution', tools: 'Caption draft, Email draft', systemPrompt: 'You create marketing drafts for human approval.' });
  const selectedModel = agentForm.model || models[0]?.name || 'llama3.1:8b';

  useEffect(() => { refresh(); }, [tenantId]);

  async function refresh() {
    const [agentsResult, modelsResult, paperclipResult] = await Promise.allSettled([
      api(`/api/ai/agents?tenantId=${tenantId}`),
      api('/api/ai/ollama/models'),
      api('/api/paperclip/status')
    ]);
    if (agentsResult.status === 'fulfilled') setAgents(agentsResult.value.agents || []);
    if (modelsResult.status === 'fulfilled') setModels(modelsResult.value.models || []);
    setStatus(paperclipResult.status === 'fulfilled' && paperclipResult.value.ok ? 'Paperclip connected' : `Paperclip unavailable: ${paperclipResult.reason?.message || paperclipResult.value?.error || 'check container logs'}`);
  }

  async function createAgent(event) {
    event.preventDefault();
    const result = await api('/api/ai/agents', { method: 'POST', body: JSON.stringify({ ...agentForm, tenantId, tools: agentForm.tools.split(',').map((item) => item.trim()).filter(Boolean) }) });
    setAgents([...agents, result.agent]);
    setStatus('AI agent configuration saved by platform admin');
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

  return <section className="contentGrid"><Panel wide icon={Bot} title="AI Agent Configuration" action={isAdmin ? 'Admin only' : 'Read only'}>
    <div className="statusStrip"><strong>{status}</strong><span>{models.length ? `${models.length} Ollama model(s)` : 'No Ollama models found yet'}</span></div>
    {!isAdmin && <div className="errorBox">Only the platform admin can create or modify Paperclip AI agent configuration.</div>}
    <div className="agentLayout">
      {isAdmin && <form className="agentForm" onSubmit={createAgent}>
        <label>Agent name<input value={agentForm.name} onChange={(event) => setAgentForm({ ...agentForm, name: event.target.value })} /></label>
        <label>Type<input value={agentForm.type} onChange={(event) => setAgentForm({ ...agentForm, type: event.target.value })} /></label>
        <label>Ollama model<input value={agentForm.model} onChange={(event) => setAgentForm({ ...agentForm, model: event.target.value })} /></label>
        <label>Temperature<input type="number" step="0.1" min="0" max="1" value={agentForm.temperature} onChange={(event) => setAgentForm({ ...agentForm, temperature: event.target.value })} /></label>
        <label>Tools<input value={agentForm.tools} onChange={(event) => setAgentForm({ ...agentForm, tools: event.target.value })} /></label>
        <label>System prompt<textarea rows="4" value={agentForm.systemPrompt} onChange={(event) => setAgentForm({ ...agentForm, systemPrompt: event.target.value })} /></label>
        <label>Test prompt<textarea rows="4" value={prompt} onChange={(event) => setPrompt(event.target.value)} /></label>
        <div className="formActions"><button className="secondaryButton" type="button" onClick={testOllama}><SlidersHorizontal size={16} /> Test Ollama</button><button className="primaryButton" type="submit"><Check size={16} /> Save agent</button></div>
        <div className="responseBox">{output || 'Paperclip and Ollama output will appear here.'}</div>
      </form>}
      <div className="agentCards">{agents.map((agent) => <article className="agentCard" key={agent.id}><div className="agentTop"><div><h3>{agent.name}</h3><p>{agent.type} · {agent.model}</p></div><span>{Number(agent.temperature)}</span></div><div className="chips">{(agent.tools || []).map((tool) => <span key={tool}>{tool}</span>)}</div><footer><Clock3 size={15} /><span>{agent.approvalRule} · {agent.status}</span></footer><button className="inlineAction" onClick={() => runAgent(agent)}>Run draft</button></article>)}</div>
    </div>
  </Panel></section>;
}

function Settings({ tenant, user, systemStatus }) {
  return <section className="contentGrid"><Panel wide icon={Settings2} title="Tenant & Production Settings" action="Live"><div className="settingsGrid"><SettingsList title="Tenant" items={[['Name', tenant.name], ['Plan', tenant.plan], ['Status', tenant.status], ['Signed in as', `${user.name} · ${user.role}`]]} /><SettingsList title="Security" items={[['Approval mode', 'Required for publish/send actions'], ['Tenant isolation', 'API scoped by login token'], ['AI configuration', 'Platform admin only']]} /><SettingsList title="Integrations" items={[['Paperclip', systemStatus?.paperclip?.ok ? 'Online' : systemStatus?.paperclip?.error || 'Unavailable'], ['Ollama', systemStatus?.ollama?.ok ? 'Online' : systemStatus?.ollama?.error || 'Unavailable'], ['CRM API', '/api']]} /></div></Panel></section>;
}

function ApprovalList({ tenantId }) {
  const [items, setItems] = useState([]);
  useEffect(() => { api(`/api/approvals?tenantId=${tenantId}`).then((result) => setItems(result.approvals || [])).catch(() => {}); }, [tenantId]);
  async function decide(id, status) {
    await api(`/api/approvals/${id}`, { method: 'PATCH', body: JSON.stringify({ status, tenantId }) });
    setItems((current) => current.map((item) => item.id === id ? { ...item, status } : item));
  }
  return <div className="approvalList">{items.map((approval) => <article className="approvalItem" key={approval.id}><div><strong>{approval.title}</strong><p>{approval.agent || 'System'} · {approval.status}</p></div><span className={approval.risk === 'High' ? 'badge danger' : 'badge'}>{approval.risk}</span>{approval.status === 'pending' && <div className="approvalActions"><button onClick={() => decide(approval.id, 'approved')}>Approve</button><button onClick={() => decide(approval.id, 'rejected')}>Reject</button></div>}</article>)}</div>;
}

function CampaignRow({ campaign }) {
  return <article className="campaignRow"><div><h3>{campaign.name}</h3><p>{campaign.owner} · {campaign.stage}</p><div className="chips">{campaign.channels.map((channel) => <span key={channel}>{channel}</span>)}</div></div><div className="progressBlock"><div className="progressMeta"><span>{campaign.progress}%</span><strong>{campaign.leads} leads</strong></div><div className="progressTrack"><span style={{ width: `${campaign.progress}%` }} /></div><small>{campaign.budget} · {campaign.approval}</small></div></article>;
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

createRoot(document.getElementById('root')).render(<App />);
