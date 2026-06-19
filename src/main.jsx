import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  BarChart3, Bot, Building2, CalendarDays, Check, ChevronDown, Clock3,
  Facebook, FileCheck2, Filter, Gauge, Instagram, LayoutDashboard, Linkedin,
  Mail, Megaphone, MessageSquareText, PhoneCall, Plus, RadioTower, Search,
  Send, Settings2, ShieldCheck, SlidersHorizontal, Sparkles, Target, Twitter,
  UserCog, Users, Workflow
} from 'lucide-react';
import './styles.css';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';
const api = async (path, options) => {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: { 'content-type': 'application/json', ...(options?.headers || {}) },
    ...options
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed: ${response.status}`);
  return body;
};

const tenants = [
  { id: 'northstar', name: 'Northstar Wellness', plan: 'Growth', status: 'Active', users: 18 },
  { id: 'urbanedge', name: 'UrbanEdge Realty', plan: 'Scale', status: 'Active', users: 26 },
  { id: 'brightbyte', name: 'BrightByte Academy', plan: 'Starter', status: 'Review', users: 9 }
];
const users = [
  { name: 'Ananya Rao', role: 'Tenant Admin', initials: 'AR' },
  { name: 'Karan Mehta', role: 'Campaign Manager', initials: 'KM' },
  { name: 'Mira Sen', role: 'Approver', initials: 'MS' },
  { name: 'Dev Iyer', role: 'Sales Follow-up', initials: 'DI' }
];
const campaigns = [
  { name: 'Monsoon Wellness Reset', owner: 'Karan Mehta', stage: 'Human approval', progress: 72, budget: '1.8L', leads: 284, approval: '2 creatives pending', channels: ['Instagram', 'Facebook', 'Email'] },
  { name: 'Corporate Health Webinar', owner: 'Ananya Rao', stage: 'AI drafting', progress: 48, budget: '85K', leads: 96, approval: 'Landing page copy', channels: ['LinkedIn', 'Email'] },
  { name: 'Referral Boost Week', owner: 'Mira Sen', stage: 'Scheduled', progress: 91, budget: '42K', leads: 138, approval: 'Approved', channels: ['Instagram', 'Email'] }
];
const posts = [
  ['09:30', 'Carousel: 5 signs your team needs a wellness reset', 'Instagram', 'Needs approval'],
  ['11:00', 'Thought-leadership post for HR leaders', 'LinkedIn', 'AI review'],
  ['15:15', 'Lead magnet email: free consultation invite', 'Email', 'Scheduled'],
  ['18:45', 'Retargeting ad variant B', 'Facebook', 'Drafting']
];
const leads = [
  ['Acme Shared Services', 'Priya N.', 92, 'LinkedIn webinar', 'Qualified', 'Dev Iyer', 'Call today 16:00'],
  ['MetroBuild Group', 'Rohit V.', 84, 'Facebook lead form', 'Proposal', 'Ananya Rao', 'Send pricing deck'],
  ['Futura Labs', 'Sara M.', 78, 'Instagram DM', 'New', 'Karan Mehta', 'Qualify need'],
  ['NimbleWorks', 'Ishaan K.', 69, 'Email campaign', 'Nurture', 'Mira Sen', 'Follow up in 2 days']
];
const fallbackAgents = [
  { name: 'Campaign Strategist', type: 'Planning', model: 'llama3.1:8b', temperature: 0.4, status: 'Ready', approval: 'Every campaign brief', tools: ['Market research', 'Audience map', 'Budget split'] },
  { name: 'Social Copywriter', type: 'Content', model: 'mistral:7b', temperature: 0.7, status: 'Ready', approval: 'Before publishing', tools: ['Caption draft', 'Hashtag set', 'Tone rewrite'] },
  { name: 'Lead Nurture Agent', type: 'Follow-up', model: 'qwen2.5:14b', temperature: 0.3, status: 'Ready', approval: 'High-value leads', tools: ['Email sequence', 'CRM notes', 'Follow-up tasks'] }
];
const fallbackApprovals = [
  { item: 'Monsoon Reset carousel creative', agent: 'Social Copywriter', risk: 'Low', decision: 'Pending brand approval', status: 'pending' },
  { item: 'Corporate webinar email sequence', agent: 'Lead Nurture Agent', risk: 'Medium', decision: 'Pending compliance check', status: 'pending' },
  { item: 'Paid campaign budget split', agent: 'Campaign Strategist', risk: 'High', decision: 'Pending admin approval', status: 'pending' }
];
const nav = [
  ['Overview', LayoutDashboard], ['Marketing', Megaphone], ['Leads', Target],
  ['Follow-ups', Workflow], ['Customers', Users], ['AI Agents', Bot], ['Settings', Settings2]
];

function App() {
  const [tenantId, setTenantId] = useState('northstar');
  const [user, setUser] = useState(users[0]);
  const [view, setView] = useState('Marketing');
  const [approvalMode, setApprovalMode] = useState(true);
  const tenant = useMemo(() => tenants.find((item) => item.id === tenantId), [tenantId]);

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand"><div className="brandMark">O</div><div><strong>Octave CRM</strong><span>AI-assisted growth ops</span></div></div>
        <nav className="navList">{nav.map(([label, Icon]) => <button className={view === label ? 'navItem active' : 'navItem'} key={label} onClick={() => setView(label)}><Icon size={18} /><span>{label}</span></button>)}</nav>
        <div className="approvalPanel"><ShieldCheck size={20} /><div><strong>Human approval</strong><span>{approvalMode ? 'Required before execution' : 'Draft-only mode'}</span></div><label className="switch"><input checked={approvalMode} onChange={() => setApprovalMode(!approvalMode)} type="checkbox" /><span /></label></div>
      </aside>
      <section className="workspace">
        <Topbar tenant={tenant} tenantId={tenantId} setTenantId={setTenantId} user={user} setUser={setUser} />
        <Hero tenant={tenant} />
        <Stats />
        {view === 'Overview' && <Overview />}
        {view === 'Marketing' && <Marketing />}
        {view === 'Leads' && <Leads />}
        {view === 'Follow-ups' && <FollowUps />}
        {view === 'Customers' && <Customers />}
        {view === 'AI Agents' && <AgentAdmin />}
        {view === 'Settings' && <Settings tenant={tenant} />}
      </section>
    </main>
  );
}

function Topbar({ tenant, tenantId, setTenantId, user, setUser }) {
  return <header className="topbar"><div className="tenantSelect"><Building2 size={18} /><select value={tenantId} onChange={(event) => setTenantId(event.target.value)}>{tenants.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><ChevronDown size={16} /></div><div className="searchBox"><Search size={17} /><input placeholder={`Search ${tenant.name}`} /></div><div className="userSelect"><span className="avatar">{user.initials}</span><select value={user.name} onChange={(event) => setUser(users.find((item) => item.name === event.target.value))}>{users.map((item) => <option key={item.name}>{item.name}</option>)}</select></div></header>;
}

function Hero({ tenant }) {
  return <section className="heroBand"><div className="heroCopy"><div className="eyebrow"><Sparkles size={16} /> Digital & Social Media Marketing</div><h1>{tenant.name}</h1><p>Plan campaigns, generate social content, capture leads, and route every AI action through Paperclip-managed Ollama agents with final human approval.</p></div><div className="signalBoard"><div className="signalHeader"><RadioTower size={18} /><span>Live channel signal</span></div><div className="signalBars">{[48, 76, 62, 89, 54, 71].map((height) => <span key={height} style={{ height: `${height}%` }} />)}</div><div className="channelIcons"><Instagram size={18} /><Facebook size={18} /><Linkedin size={18} /><Twitter size={18} /><Mail size={18} /></div></div></section>;
}

function Stats() {
  return <section className="statsGrid"><Metric icon={Megaphone} label="Active campaigns" value="12" delta="+3 this week" /><Metric icon={Target} label="New leads" value="518" delta="31% AI-qualified" /><Metric icon={FileCheck2} label="Pending approvals" value="9" delta="4 high priority" /><Metric icon={Bot} label="Agent runs" value="1,284" delta="Paperclip online" /></section>;
}

function Overview() {
  return <section className="contentGrid"><Panel icon={BarChart3} title="Revenue Pipeline" action="Forecast"><div className="stageGrid">{['New', 'Qualified', 'Proposal', 'Won'].map((stage, index) => <div className="stageCard" key={stage}><span>{stage}</span><strong>{[96, 64, 28, 11][index]}</strong><small>{['18.4L', '12.1L', '8.7L', '3.4L'][index]}</small></div>)}</div></Panel><Panel icon={ShieldCheck} title="Approval Queue" action="Review"><ApprovalList /></Panel></section>;
}

function Marketing() {
  return <section className="contentGrid"><Panel wide icon={CalendarDays} title="Campaign Command Center" action="New campaign"><div className="campaignList">{campaigns.map((campaign) => <CampaignRow campaign={campaign} key={campaign.name} />)}</div></Panel><PublishingQueue /><Panel icon={ShieldCheck} title="Approval Queue" action="Approve"><ApprovalList /></Panel></section>;
}

function Leads() {
  return <section className="contentGrid"><Panel wide icon={Target} title="Lead Capture & Qualification" action="Sync leads"><div className="tableHeader"><button><Filter size={15} /> Filter</button><button><Send size={15} /> Assign sequence</button></div><div className="leadTable">{leads.map(([company, contact, score, source, stage, owner, next]) => <article className="leadTableRow" key={company}><div className="leadScore">{score}</div><div><h3>{company}</h3><p>{contact} · {source}</p></div><span>{stage}</span><span>{owner}</span><strong>{next}</strong></article>)}</div></Panel><PublishingQueue /><Panel icon={Bot} title="AI Qualification Rules" action="Edit"><SettingsList items={[["High score threshold", "80+ lead score requires human review"], ["Source weighting", "LinkedIn and webinar leads receive priority"], ["Auto enrichment", "Company size, domain, and role lookup enabled"]]} /></Panel></section>;
}

function FollowUps() {
  const tasks = [['Call Acme Shared Services', 'Dev Iyer', 'Today 16:00', 'High', 'Phone'], ['Approve webinar nurture email', 'Mira Sen', 'Today 18:00', 'High', 'Email'], ['Send MetroBuild deck', 'Ananya Rao', 'Tomorrow 10:00', 'Medium', 'Email'], ['Qualify Instagram DM leads', 'Karan Mehta', 'Tomorrow 14:30', 'Medium', 'Social']];
  return <section className="contentGrid"><Panel wide icon={Workflow} title="Follow-up Workbench" action="Create task"><div className="taskBoard">{tasks.map(([title, owner, due, priority, channel]) => <article className="taskCard" key={title}><div><strong>{title}</strong><p>{owner} · {channel}</p></div><span className={priority === 'High' ? 'badge danger' : 'badge'}>{priority}</span><small>{due}</small></article>)}</div></Panel><Panel icon={PhoneCall} title="Today" action="Start"><SettingsList items={[["Calls", "3 scheduled"], ["Emails", "7 prepared drafts"], ["Approvals", "2 waiting"]]} /></Panel><Panel icon={Bot} title="Nurture Agent" action="Run"><SettingsList items={[["Mode", "Draft sequences only"], ["Guardrail", "Do not send without approver"], ["Escalation", "Score 85+ goes to sales owner"]]} /></Panel></section>;
}

function Customers() {
  const customers = [['Acme Shared Services', 91, 'Growth', '1.2L', 'Expansion ready'], ['UrbanEdge Realty', 82, 'Scale', '2.8L', 'Onboarding'], ['BrightByte Academy', 74, 'Starter', '48K', 'Needs adoption']];
  return <section className="contentGrid"><Panel wide icon={Users} title="Customer Relationship Management" action="Add customer"><div className="customerGrid">{customers.map(([name, health, plan, mrr, status]) => <article className="customerCard" key={name}><div className="customerTop"><div><h3>{name}</h3><p>{plan} · {mrr} MRR</p></div><Gauge size={19} /></div><div className="progressTrack"><span style={{ width: `${health}%` }} /></div><footer><strong>{health}% health</strong><span>{status}</span></footer></article>)}</div></Panel><Panel icon={MessageSquareText} title="Recent Touchpoints" action="Log"><SettingsList items={[["Acme", "Quarterly review completed"], ["UrbanEdge", "Onboarding sequence active"], ["BrightByte", "Adoption risk flagged"]]} /></Panel><Panel icon={Sparkles} title="Expansion Signals" action="Review"><SettingsList items={[["Usage", "Campaign volume up 28%"], ["Engagement", "Stakeholder opened proposal"], ["Risk", "1 customer below health threshold"]]} /></Panel></section>;
}

function AgentAdmin() {
  const [backendAgents, setBackendAgents] = useState(fallbackAgents);
  const [models, setModels] = useState([]);
  const [status, setStatus] = useState('Checking API...');
  const [prompt, setPrompt] = useState('Write a three-line campaign idea for a wellness webinar.');
  const [output, setOutput] = useState('');
  const selectedModel = backendAgents[0]?.model || models[0]?.name || 'llama3.1:8b';

  useEffect(() => { let mounted = true; Promise.allSettled([api('/api/ai/agents'), api('/api/ai/ollama/models')]).then(([agentsResult, modelsResult]) => { if (!mounted) return; if (agentsResult.status === 'fulfilled' && agentsResult.value.agents?.length) setBackendAgents(agentsResult.value.agents.map((agent) => ({ id: agent.id, name: agent.name, type: agent.type, model: agent.model, temperature: Number(agent.temperature), approval: agent.approvalRule, status: agent.status, tools: agent.tools || [] }))); if (modelsResult.status === 'fulfilled') { setModels(modelsResult.value.models || []); setStatus(modelsResult.value.models?.length ? 'Ollama connected' : 'Ollama connected, no models found'); } else setStatus(`Ollama unavailable: ${modelsResult.reason.message}`); }); return () => { mounted = false; }; }, []);
  async function testOllama() { setOutput('Running test prompt...'); try { const result = await api('/api/ai/ollama/test', { method: 'POST', body: JSON.stringify({ model: selectedModel, prompt, temperature: backendAgents[0]?.temperature || 0.4 }) }); setOutput(result.response || 'No response returned.'); setStatus('Ollama test completed'); } catch (error) { setOutput(error.message); setStatus('Ollama test failed'); } }
  async function runAgent(agent) { setOutput(`Running ${agent.name}...`); try { const result = await api(`/api/ai/agents/${agent.id}/run`, { method: 'POST', body: JSON.stringify({ prompt, risk: 'Medium' }) }); setOutput(result.output || 'Agent completed without output.'); setStatus('Agent draft created and sent to approvals'); } catch (error) { setOutput(error.message); setStatus('Agent run failed'); } }

  return <section className="contentGrid"><Panel wide icon={Bot} title="Admin AI Agent Configuration" action="Add agent"><div className="statusStrip"><strong>{status}</strong><span>{models.length ? `${models.length} local model(s) available` : 'Ollama /api/tags supplies models'}</span></div><div className="agentLayout"><div className="agentForm"><label>Paperclip server URL<input defaultValue="http://paperclip" /></label><label>Ollama model registry<input defaultValue="http://ollama:11434" /></label><label>Available Ollama models<select value={selectedModel} onChange={() => {}}>{(models.length ? models : [{ name: selectedModel }]).map((model) => <option key={model.name}>{model.name}</option>)}</select></label><label>Default approval rule<select defaultValue="human"><option value="human">Human approval before publish/send</option><option value="manager">Manager approval for paid campaigns</option><option value="draft">Draft only, no execution</option></select></label><label>Test prompt<textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows="4" /></label><div className="formActions"><button className="secondaryButton" onClick={testOllama}><SlidersHorizontal size={16} /> Test Ollama</button><button className="primaryButton"><Check size={16} /> Save configuration</button></div><div className="responseBox">{output || 'Ollama and agent test output will appear here.'}</div></div><div className="agentCards">{backendAgents.map((agent) => <article className="agentCard" key={agent.id || agent.name}><div className="agentTop"><div><h3>{agent.name}</h3><p>{agent.type} · {agent.model}</p></div><span>{agent.temperature}</span></div><div className="chips">{agent.tools.map((tool) => <span key={tool}>{tool}</span>)}</div><footer><Clock3 size={15} /><span>{agent.approval} · {agent.status}</span></footer>{agent.id && <button className="inlineAction" onClick={() => runAgent(agent)}>Run draft</button>}</article>)}</div></div></Panel><Panel icon={ShieldCheck} title="Guardrails" action="Edit"><SettingsList items={[["Publishing", "No social post without human approval"], ["Lead outreach", "No auto-send to high-value leads"], ["Audit", "Store prompt, output, approver, and timestamp"]]} /></Panel><Panel icon={UserCog} title="Role Access" action="Manage"><SettingsList items={[["Super Admin", "All tenants and agents"], ["Tenant Admin", "Own tenant configuration"], ["Approver", "Review and approve queued actions"]]} /></Panel></section>;
}

function Settings({ tenant }) { return <section className="contentGrid"><Panel wide icon={Settings2} title="Tenant & Production Settings" action="Save"><div className="settingsGrid"><SettingsList title="Tenant" items={[["Name", tenant.name], ["Plan", tenant.plan], ["Status", tenant.status], ["Users", `${tenant.users} active users`]]} /><SettingsList title="Security" items={[["Approval mode", "Required for publish/send actions"], ["Audit log", "Enabled for every AI run"], ["Tenant isolation", "Scoped by tenant id and role"]]} /><SettingsList title="Integrations" items={[["Paperclip", "http://paperclip"], ["Ollama", "http://ollama:11434"], ["CRM API", "/api"]]} /></div></Panel></section>; }
function ApprovalList() { const [items, setItems] = useState(fallbackApprovals); useEffect(() => { let mounted = true; api('/api/approvals').then((result) => { if (mounted && result.approvals?.length) setItems(result.approvals.map((item) => ({ id: item.id, item: item.title, agent: item.agent || 'System', risk: item.risk, status: item.status, decision: item.status === 'pending' ? 'Pending human approval' : item.status }))); }).catch(() => {}); return () => { mounted = false; }; }, []); async function decide(id, status) { await api(`/api/approvals/${id}`, { method: 'PATCH', body: JSON.stringify({ status, decidedBy: 'admin' }) }); setItems((current) => current.map((item) => item.id === id ? { ...item, status, decision: status } : item)); } return <div className="approvalList">{items.map((approval) => <article className="approvalItem" key={approval.id || approval.item}><div><strong>{approval.item}</strong><p>{approval.agent} · {approval.decision}</p></div><span className={approval.risk === 'High' ? 'badge danger' : 'badge'}>{approval.risk}</span>{approval.id && approval.status === 'pending' && <div className="approvalActions"><button onClick={() => decide(approval.id, 'approved')}>Approve</button><button onClick={() => decide(approval.id, 'rejected')}>Reject</button></div>}</article>)}</div>; }
function CampaignRow({ campaign }) { return <article className="campaignRow"><div><h3>{campaign.name}</h3><p>{campaign.owner} · {campaign.stage}</p><div className="chips">{campaign.channels.map((channel) => <span key={channel}>{channel}</span>)}</div></div><div className="progressBlock"><div className="progressMeta"><span>{campaign.progress}%</span><strong>{campaign.leads} leads</strong></div><div className="progressTrack"><span style={{ width: `${campaign.progress}%` }} /></div><small>{campaign.budget} · {campaign.approval}</small></div></article>; }
function PublishingQueue() { return <Panel icon={MessageSquareText} title="Publishing Queue" action="Draft post"><div className="timeline">{posts.map(([time, title, channel, status]) => <div className="timeItem" key={title}><span className="time">{time}</span><div><strong>{title}</strong><p>{channel} · {status}</p></div></div>)}</div></Panel>; }
function Panel({ icon, title, action, wide, children }) { return <div className={wide ? 'widePanel' : 'panel'}><PanelHeader icon={icon} title={title} action={action} />{children}</div>; }
function SettingsList({ items, title }) { return <div className="settingsList">{title && <h3>{title}</h3>}{items.map(([label, value]) => <div className="settingRow" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>; }
function Metric({ icon: Icon, label, value, delta }) { return <article className="metric"><div className="metricIcon"><Icon size={18} /></div><span>{label}</span><strong>{value}</strong><small>{delta}</small></article>; }
function PanelHeader({ icon: Icon, title, action }) { return <div className="panelHeader"><div><Icon size={18} /><h2>{title}</h2></div><button><Plus size={16} /><span>{action}</span></button></div>; }

createRoot(document.getElementById('root')).render(<App />);
