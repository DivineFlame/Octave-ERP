import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  BarChart3,
  Bot,
  Building2,
  CalendarDays,
  Check,
  ChevronDown,
  Clock3,
  Facebook,
  FileCheck2,
  Filter,
  Gauge,
  Instagram,
  LayoutDashboard,
  Linkedin,
  Mail,
  Megaphone,
  MessageSquareText,
  PhoneCall,
  Plus,
  RadioTower,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Target,
  Twitter,
  UserCog,
  Users,
  Workflow
} from 'lucide-react';
import './styles.css';

const tenants = [
  { id: 'northstar', name: 'Northstar Wellness', plan: 'Growth', status: 'Active', users: 18, channels: ['Instagram', 'Facebook', 'LinkedIn', 'Email'] },
  { id: 'urbanedge', name: 'UrbanEdge Realty', plan: 'Scale', status: 'Active', users: 26, channels: ['Facebook', 'LinkedIn', 'X', 'Email'] },
  { id: 'brightbyte', name: 'BrightByte Academy', plan: 'Starter', status: 'Review', users: 9, channels: ['Instagram', 'Email'] }
];

const users = [
  { name: 'Ananya Rao', role: 'Tenant Admin', team: 'Marketing Ops', initials: 'AR' },
  { name: 'Karan Mehta', role: 'Campaign Manager', team: 'Demand Gen', initials: 'KM' },
  { name: 'Mira Sen', role: 'Approver', team: 'Brand', initials: 'MS' },
  { name: 'Dev Iyer', role: 'Sales Follow-up', team: 'CRM', initials: 'DI' }
];

const campaigns = [
  { name: 'Monsoon Wellness Reset', owner: 'Karan Mehta', stage: 'Human approval', progress: 72, budget: '₹1.8L', leads: 284, approval: '2 creatives pending', channels: ['Instagram', 'Facebook', 'Email'] },
  { name: 'Corporate Health Webinar', owner: 'Ananya Rao', stage: 'AI drafting', progress: 48, budget: '₹85K', leads: 96, approval: 'Landing page copy', channels: ['LinkedIn', 'Email'] },
  { name: 'Referral Boost Week', owner: 'Mira Sen', stage: 'Scheduled', progress: 91, budget: '₹42K', leads: 138, approval: 'Approved', channels: ['Instagram', 'Email'] }
];

const posts = [
  { time: '09:30', title: 'Carousel: 5 signs your team needs a wellness reset', channel: 'Instagram', status: 'Needs approval' },
  { time: '11:00', title: 'Thought-leadership post for HR leaders', channel: 'LinkedIn', status: 'AI review' },
  { time: '15:15', title: 'Lead magnet email: free consultation invite', channel: 'Email', status: 'Scheduled' },
  { time: '18:45', title: 'Retargeting ad variant B', channel: 'Facebook', status: 'Drafting' }
];

const leads = [
  { company: 'Acme Shared Services', contact: 'Priya N.', score: 92, source: 'LinkedIn webinar', stage: 'Qualified', owner: 'Dev Iyer', next: 'Call today 16:00' },
  { company: 'MetroBuild Group', contact: 'Rohit V.', score: 84, source: 'Facebook lead form', stage: 'Proposal', owner: 'Ananya Rao', next: 'Send pricing deck' },
  { company: 'Futura Labs', contact: 'Sara M.', score: 78, source: 'Instagram DM', stage: 'New', owner: 'Karan Mehta', next: 'Qualify need' },
  { company: 'NimbleWorks', contact: 'Ishaan K.', score: 69, source: 'Email campaign', stage: 'Nurture', owner: 'Mira Sen', next: 'Follow up in 2 days' }
];

const followUps = [
  { title: 'Call Acme Shared Services', owner: 'Dev Iyer', due: 'Today 16:00', priority: 'High', channel: 'Phone' },
  { title: 'Approve webinar nurture email', owner: 'Mira Sen', due: 'Today 18:00', priority: 'High', channel: 'Email' },
  { title: 'Send MetroBuild deck', owner: 'Ananya Rao', due: 'Tomorrow 10:00', priority: 'Medium', channel: 'Email' },
  { title: 'Qualify Instagram DM leads', owner: 'Karan Mehta', due: 'Tomorrow 14:30', priority: 'Medium', channel: 'Social' }
];

const customers = [
  { name: 'Acme Shared Services', health: 91, plan: 'Growth', mrr: '₹1.2L', status: 'Expansion ready' },
  { name: 'UrbanEdge Realty', health: 82, plan: 'Scale', mrr: '₹2.8L', status: 'Onboarding' },
  { name: 'BrightByte Academy', health: 74, plan: 'Starter', mrr: '₹48K', status: 'Needs adoption' }
];

const approvals = [
  { item: 'Monsoon Reset carousel creative', agent: 'Social Copywriter', risk: 'Low', decision: 'Pending brand approval' },
  { item: 'Corporate webinar email sequence', agent: 'Lead Nurture Agent', risk: 'Medium', decision: 'Pending compliance check' },
  { item: 'Paid campaign budget split', agent: 'Campaign Strategist', risk: 'High', decision: 'Pending admin approval' }
];

const agents = [
  { name: 'Campaign Strategist', type: 'Planning', model: 'llama3.1:8b', temperature: 0.4, status: 'Ready', approval: 'Every campaign brief', tools: ['Market research', 'Audience map', 'Budget split'] },
  { name: 'Social Copywriter', type: 'Content', model: 'mistral:7b', temperature: 0.7, status: 'Drafting', approval: 'Before publishing', tools: ['Caption draft', 'Hashtag set', 'Tone rewrite'] },
  { name: 'Lead Nurture Agent', type: 'Follow-up', model: 'qwen2.5:14b', temperature: 0.3, status: 'Ready', approval: 'High-value leads', tools: ['Email sequence', 'CRM notes', 'Follow-up tasks'] }
];

const menu = [
  ['Overview', LayoutDashboard],
  ['Marketing', Megaphone],
  ['Leads', Target],
  ['Follow-ups', Workflow],
  ['Customers', Users],
  ['AI Agents', Bot],
  ['Settings', Settings2]
];

function App() {
  const [tenantId, setTenantId] = useState('northstar');
  const [currentUser, setCurrentUser] = useState(users[0]);
  const [activeView, setActiveView] = useState('Marketing');
  const [approvalMode, setApprovalMode] = useState(true);
  const selectedTenant = useMemo(() => tenants.find((tenant) => tenant.id === tenantId), [tenantId]);

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brandMark">O</div>
          <div>
            <strong>Octave CRM</strong>
            <span>AI-assisted growth ops</span>
          </div>
        </div>
        <nav className="navList" aria-label="Primary navigation">
          {menu.map(([label, Icon]) => (
            <button className={activeView === label ? 'navItem active' : 'navItem'} key={label} onClick={() => setActiveView(label)} type="button" title={label}>
              <Icon size={18} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="approvalPanel">
          <ShieldCheck size={20} />
          <div>
            <strong>Human approval</strong>
            <span>{approvalMode ? 'Required before execution' : 'Draft-only mode'}</span>
          </div>
          <label className="switch" title="Toggle approval mode">
            <input checked={approvalMode} onChange={() => setApprovalMode(!approvalMode)} type="checkbox" />
            <span />
          </label>
        </div>
      </aside>
      <section className="workspace">
        <Topbar currentUser={currentUser} selectedTenant={selectedTenant} setCurrentUser={setCurrentUser} setTenantId={setTenantId} tenantId={tenantId} />
        <Hero selectedTenant={selectedTenant} />
        <Stats />
        {activeView === 'Overview' && <Overview />}
        {activeView === 'Marketing' && <Marketing />}
        {activeView === 'Leads' && <Leads />}
        {activeView === 'Follow-ups' && <FollowUps />}
        {activeView === 'Customers' && <Customers />}
        {activeView === 'AI Agents' && <AgentAdmin />}
        {activeView === 'Settings' && <Settings selectedTenant={selectedTenant} />}
      </section>
    </main>
  );
}

function Topbar({ currentUser, selectedTenant, setCurrentUser, setTenantId, tenantId }) {
  return (
    <header className="topbar">
      <div className="tenantSelect">
        <Building2 size={18} />
        <select value={tenantId} onChange={(event) => setTenantId(event.target.value)} aria-label="Select tenant">
          {tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}
        </select>
        <ChevronDown size={16} />
      </div>
      <div className="searchBox">
        <Search size={17} />
        <input placeholder={`Search ${selectedTenant.name}`} />
      </div>
      <div className="userSelect">
        <span className="avatar">{currentUser.initials}</span>
        <select value={currentUser.name} onChange={(event) => setCurrentUser(users.find((user) => user.name === event.target.value))} aria-label="Select user">
          {users.map((user) => <option key={user.name} value={user.name}>{user.name}</option>)}
        </select>
      </div>
    </header>
  );
}

function Hero({ selectedTenant }) {
  return (
    <section className="heroBand">
      <div className="heroCopy">
        <div className="eyebrow"><Sparkles size={16} /> Digital & Social Media Marketing</div>
        <h1>{selectedTenant.name}</h1>
        <p>Plan campaigns, generate social content, capture leads, and route every AI action through Paperclip-managed Ollama agents with final human approval.</p>
      </div>
      <div className="signalBoard" aria-label="Marketing performance visual">
        <div className="signalHeader"><RadioTower size={18} /><span>Live channel signal</span></div>
        <div className="signalBars">
          {[48, 76, 62, 89, 54, 71].map((height) => <span key={height} style={{ height: `${height}%` }} />)}
        </div>
        <div className="channelIcons"><Instagram size={18} /><Facebook size={18} /><Linkedin size={18} /><Twitter size={18} /><Mail size={18} /></div>
      </div>
    </section>
  );
}

function Stats() {
  return (
    <section className="statsGrid">
      <Metric icon={Megaphone} label="Active campaigns" value="12" delta="+3 this week" />
      <Metric icon={Target} label="New leads" value="518" delta="31% AI-qualified" />
      <Metric icon={FileCheck2} label="Pending approvals" value="9" delta="4 high priority" />
      <Metric icon={Bot} label="Agent runs" value="1,284" delta="Paperclip online" />
    </section>
  );
}

function Overview() {
  return (
    <section className="contentGrid">
      <div className="panel">
        <PanelHeader icon={BarChart3} title="Revenue Pipeline" action="Forecast" />
        <div className="stageGrid">
          {['New', 'Qualified', 'Proposal', 'Won'].map((stage, index) => (
            <div className="stageCard" key={stage}>
              <span>{stage}</span>
              <strong>{[96, 64, 28, 11][index]}</strong>
              <small>{['₹18.4L', '₹12.1L', '₹8.7L', '₹3.4L'][index]}</small>
            </div>
          ))}
        </div>
      </div>
      <div className="panel"><PanelHeader icon={ShieldCheck} title="Approval Queue" action="Review" /><ApprovalList /></div>
    </section>
  );
}

function Marketing() {
  return (
    <section className="contentGrid">
      <div className="widePanel">
        <PanelHeader icon={CalendarDays} title="Campaign Command Center" action="New campaign" />
        <div className="campaignList">{campaigns.map((campaign) => <CampaignRow campaign={campaign} key={campaign.name} />)}</div>
      </div>
      <PublishingQueue />
      <div className="panel"><PanelHeader icon={ShieldCheck} title="Approval Queue" action="Approve" /><ApprovalList /></div>
    </section>
  );
}

function Leads() {
  return (
    <section className="contentGrid">
      <div className="widePanel">
        <PanelHeader icon={Target} title="Lead Capture & Qualification" action="Sync leads" />
        <div className="tableHeader"><button type="button"><Filter size={15} /> Filter</button><button type="button"><Send size={15} /> Assign sequence</button></div>
        <div className="leadTable">
          {leads.map((lead) => (
            <article className="leadTableRow" key={lead.company}>
              <div className="leadScore">{lead.score}</div>
              <div><h3>{lead.company}</h3><p>{lead.contact} · {lead.source}</p></div>
              <span>{lead.stage}</span><span>{lead.owner}</span><strong>{lead.next}</strong>
            </article>
          ))}
        </div>
      </div>
      <PublishingQueue />
      <div className="panel"><PanelHeader icon={Bot} title="AI Qualification Rules" action="Edit" /><SettingsList items={[["High score threshold", "80+ lead score requires human review"], ["Source weighting", "LinkedIn and webinar leads receive priority"], ["Auto enrichment", "Company size, domain, and role lookup enabled"]]} /></div>
    </section>
  );
}

function FollowUps() {
  return (
    <section className="contentGrid">
      <div className="widePanel">
        <PanelHeader icon={Workflow} title="Follow-up Workbench" action="Create task" />
        <div className="taskBoard">{followUps.map((task) => <TaskCard task={task} key={task.title} />)}</div>
      </div>
      <div className="panel"><PanelHeader icon={PhoneCall} title="Today" action="Start" /><SettingsList items={[["Calls", "3 scheduled"], ["Emails", "7 prepared drafts"], ["Approvals", "2 waiting"]]} /></div>
      <div className="panel"><PanelHeader icon={Bot} title="Nurture Agent" action="Run" /><SettingsList items={[["Mode", "Draft sequences only"], ["Guardrail", "Do not send without approver"], ["Escalation", "Score 85+ goes to sales owner"]]} /></div>
    </section>
  );
}

function Customers() {
  return (
    <section className="contentGrid">
      <div className="widePanel">
        <PanelHeader icon={Users} title="Customer Relationship Management" action="Add customer" />
        <div className="customerGrid">{customers.map((customer) => <CustomerCard customer={customer} key={customer.name} />)}</div>
      </div>
      <div className="panel"><PanelHeader icon={MessageSquareText} title="Recent Touchpoints" action="Log" /><SettingsList items={[["Acme", "Quarterly review completed"], ["UrbanEdge", "Onboarding sequence active"], ["BrightByte", "Adoption risk flagged"]]} /></div>
      <div className="panel"><PanelHeader icon={Sparkles} title="Expansion Signals" action="Review" /><SettingsList items={[["Usage", "Campaign volume up 28%"], ["Engagement", "Stakeholder opened proposal"], ["Risk", "1 customer below health threshold"]]} /></div>
    </section>
  );
}

function AgentAdmin() {
  return (
    <section className="contentGrid">
      <div className="widePanel">
        <PanelHeader icon={Bot} title="Admin AI Agent Configuration" action="Add agent" />
        <div className="agentLayout">
          <div className="agentForm">
            <label>Paperclip server URL<input defaultValue="http://paperclip:8088" /></label>
            <label>Ollama model registry<input defaultValue="http://ollama:11434" /></label>
            <label>Default approval rule<select defaultValue="human"><option value="human">Human approval before publish/send</option><option value="manager">Manager approval for paid campaigns</option><option value="draft">Draft only, no execution</option></select></label>
            <div className="formActions"><button className="secondaryButton" type="button"><SlidersHorizontal size={16} /> Test connection</button><button className="primaryButton" type="button"><Check size={16} /> Save configuration</button></div>
          </div>
          <div className="agentCards">{agents.map((agent) => <AgentCard agent={agent} key={agent.name} />)}</div>
        </div>
      </div>
      <div className="panel"><PanelHeader icon={ShieldCheck} title="Guardrails" action="Edit" /><SettingsList items={[["Publishing", "No social post without human approval"], ["Lead outreach", "No auto-send to high-value leads"], ["Audit", "Store prompt, output, approver, and timestamp"]]} /></div>
      <div className="panel"><PanelHeader icon={UserCog} title="Role Access" action="Manage" /><SettingsList items={[["Super Admin", "All tenants and agents"], ["Tenant Admin", "Own tenant configuration"], ["Approver", "Review and approve queued actions"]]} /></div>
    </section>
  );
}

function Settings({ selectedTenant }) {
  return (
    <section className="contentGrid">
      <div className="widePanel">
        <PanelHeader icon={Settings2} title="Tenant & Production Settings" action="Save" />
        <div className="settingsGrid">
          <SettingsList title="Tenant" items={[["Name", selectedTenant.name], ["Plan", selectedTenant.plan], ["Status", selectedTenant.status], ["Users", `${selectedTenant.users} active users`]]} />
          <SettingsList title="Security" items={[["Approval mode", "Required for publish/send actions"], ["Audit log", "Enabled for every AI run"], ["Tenant isolation", "Scoped by tenant id and role"]]} />
          <SettingsList title="Integrations" items={[["Paperclip", "http://paperclip:8088"], ["Ollama", "http://ollama:11434"], ["CRM API", "Ready for backend service"]]} />
        </div>
      </div>
    </section>
  );
}

function CampaignRow({ campaign }) {
  return (
    <article className="campaignRow">
      <div><h3>{campaign.name}</h3><p>{campaign.owner} · {campaign.stage}</p><div className="chips">{campaign.channels.map((channel) => <span key={channel}>{channel}</span>)}</div></div>
      <div className="progressBlock"><div className="progressMeta"><span>{campaign.progress}%</span><strong>{campaign.leads} leads</strong></div><div className="progressTrack"><span style={{ width: `${campaign.progress}%` }} /></div><small>{campaign.budget} · {campaign.approval}</small></div>
    </article>
  );
}

function PublishingQueue() {
  return <div className="panel"><PanelHeader icon={MessageSquareText} title="Publishing Queue" action="Draft post" /><div className="timeline">{posts.map((post) => <div className="timeItem" key={`${post.time}-${post.title}`}><span className="time">{post.time}</span><div><strong>{post.title}</strong><p>{post.channel} · {post.status}</p></div></div>)}</div></div>;
}

function ApprovalList() {
  return <div className="approvalList">{approvals.map((approval) => <article className="approvalItem" key={approval.item}><div><strong>{approval.item}</strong><p>{approval.agent} · {approval.decision}</p></div><span className={approval.risk === 'High' ? 'badge danger' : 'badge'}>{approval.risk}</span></article>)}</div>;
}

function TaskCard({ task }) {
  return <article className="taskCard"><div><strong>{task.title}</strong><p>{task.owner} · {task.channel}</p></div><span className={task.priority === 'High' ? 'badge danger' : 'badge'}>{task.priority}</span><small>{task.due}</small></article>;
}

function CustomerCard({ customer }) {
  return <article className="customerCard"><div className="customerTop"><div><h3>{customer.name}</h3><p>{customer.plan} · {customer.mrr} MRR</p></div><Gauge size={19} /></div><div className="progressTrack"><span style={{ width: `${customer.health}%` }} /></div><footer><strong>{customer.health}% health</strong><span>{customer.status}</span></footer></article>;
}

function AgentCard({ agent }) {
  return <article className="agentCard"><div className="agentTop"><div><h3>{agent.name}</h3><p>{agent.type} · {agent.model}</p></div><span>{agent.temperature}</span></div><div className="chips">{agent.tools.map((tool) => <span key={tool}>{tool}</span>)}</div><footer><Clock3 size={15} /><span>{agent.approval} · {agent.status}</span></footer></article>;
}

function SettingsList({ items, title }) {
  return <div className="settingsList">{title && <h3>{title}</h3>}{items.map(([label, value]) => <div className="settingRow" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>;
}

function Metric({ icon: Icon, label, value, delta }) {
  return <article className="metric"><div className="metricIcon"><Icon size={18} /></div><span>{label}</span><strong>{value}</strong><small>{delta}</small></article>;
}

function PanelHeader({ icon: Icon, title, action }) {
  return <div className="panelHeader"><div><Icon size={18} /><h2>{title}</h2></div><button type="button"><Plus size={16} /><span>{action}</span></button></div>;
}

createRoot(document.getElementById('root')).render(<App />);
