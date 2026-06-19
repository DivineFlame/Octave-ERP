import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Bot,
  Building2,
  CalendarDays,
  Check,
  ChevronDown,
  Clock3,
  Facebook,
  FileCheck2,
  Instagram,
  LayoutDashboard,
  Linkedin,
  Mail,
  Megaphone,
  MessageSquareText,
  Plus,
  RadioTower,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Target,
  Twitter,
  Users,
  Workflow
} from 'lucide-react';
import './styles.css';

const tenants = [
  {
    id: 'northstar',
    name: 'Northstar Wellness',
    plan: 'Growth',
    status: 'Active',
    users: 18,
    channels: ['Instagram', 'Facebook', 'LinkedIn', 'Email']
  },
  {
    id: 'urbanedge',
    name: 'UrbanEdge Realty',
    plan: 'Scale',
    status: 'Active',
    users: 26,
    channels: ['Facebook', 'LinkedIn', 'X', 'Email']
  },
  {
    id: 'brightbyte',
    name: 'BrightByte Academy',
    plan: 'Starter',
    status: 'Review',
    users: 9,
    channels: ['Instagram', 'Email']
  }
];

const users = [
  { name: 'Ananya Rao', role: 'Tenant Admin', team: 'Marketing Ops', initials: 'AR' },
  { name: 'Karan Mehta', role: 'Campaign Manager', team: 'Demand Gen', initials: 'KM' },
  { name: 'Mira Sen', role: 'Approver', team: 'Brand', initials: 'MS' },
  { name: 'Dev Iyer', role: 'Sales Follow-up', team: 'CRM', initials: 'DI' }
];

const campaigns = [
  {
    name: 'Monsoon Wellness Reset',
    owner: 'Karan Mehta',
    stage: 'Human approval',
    progress: 72,
    budget: '₹1.8L',
    leads: 284,
    approval: '2 creatives pending',
    channels: ['Instagram', 'Facebook', 'Email']
  },
  {
    name: 'Corporate Health Webinar',
    owner: 'Ananya Rao',
    stage: 'AI drafting',
    progress: 48,
    budget: '₹85K',
    leads: 96,
    approval: 'Landing page copy',
    channels: ['LinkedIn', 'Email']
  },
  {
    name: 'Referral Boost Week',
    owner: 'Mira Sen',
    stage: 'Scheduled',
    progress: 91,
    budget: '₹42K',
    leads: 138,
    approval: 'Approved',
    channels: ['Instagram', 'Email']
  }
];

const posts = [
  { time: '09:30', title: 'Carousel: 5 signs your team needs a wellness reset', channel: 'Instagram', status: 'Needs approval' },
  { time: '11:00', title: 'Thought-leadership post for HR leaders', channel: 'LinkedIn', status: 'AI review' },
  { time: '15:15', title: 'Lead magnet email: free consultation invite', channel: 'Email', status: 'Scheduled' },
  { time: '18:45', title: 'Retargeting ad variant B', channel: 'Facebook', status: 'Drafting' }
];

const leads = [
  { company: 'Acme Shared Services', contact: 'Priya N.', score: 92, source: 'LinkedIn webinar', next: 'Call today 16:00' },
  { company: 'MetroBuild Group', contact: 'Rohit V.', score: 84, source: 'Facebook lead form', next: 'Send pricing deck' },
  { company: 'Futura Labs', contact: 'Sara M.', score: 78, source: 'Instagram DM', next: 'Qualify need' }
];

const agents = [
  {
    name: 'Campaign Strategist',
    type: 'Planning',
    model: 'llama3.1:8b',
    temperature: 0.4,
    approval: 'Every campaign brief',
    tools: ['Market research', 'Audience map', 'Budget split']
  },
  {
    name: 'Social Copywriter',
    type: 'Content',
    model: 'mistral:7b',
    temperature: 0.7,
    approval: 'Before publishing',
    tools: ['Caption draft', 'Hashtag set', 'Tone rewrite']
  },
  {
    name: 'Lead Nurture Agent',
    type: 'Follow-up',
    model: 'qwen2.5:14b',
    temperature: 0.3,
    approval: 'High-value leads',
    tools: ['Email sequence', 'CRM notes', 'Follow-up tasks']
  }
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
          {[
            ['Overview', LayoutDashboard],
            ['Marketing', Megaphone],
            ['Leads', Target],
            ['Follow-ups', Workflow],
            ['Customers', Users],
            ['AI Agents', Bot],
            ['Settings', Settings2]
          ].map(([label, Icon]) => (
            <button
              className={activeView === label ? 'navItem active' : 'navItem'}
              key={label}
              onClick={() => setActiveView(label)}
              type="button"
              title={label}
            >
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
        <header className="topbar">
          <div className="tenantSelect">
            <Building2 size={18} />
            <select value={tenantId} onChange={(event) => setTenantId(event.target.value)} aria-label="Select tenant">
              {tenants.map((tenant) => (
                <option key={tenant.id} value={tenant.id}>{tenant.name}</option>
              ))}
            </select>
            <ChevronDown size={16} />
          </div>

          <div className="searchBox">
            <Search size={17} />
            <input placeholder="Search campaigns, leads, posts" />
          </div>

          <div className="userSelect">
            <span className="avatar">{currentUser.initials}</span>
            <select
              value={currentUser.name}
              onChange={(event) => setCurrentUser(users.find((user) => user.name === event.target.value))}
              aria-label="Select user"
            >
              {users.map((user) => (
                <option key={user.name} value={user.name}>{user.name}</option>
              ))}
            </select>
          </div>
        </header>

        <section className="heroBand">
          <div className="heroCopy">
            <div className="eyebrow"><Sparkles size={16} /> Digital & Social Media Marketing</div>
            <h1>{selectedTenant.name}</h1>
            <p>Plan campaigns, generate social content, capture leads, and route every AI action through Paperclip-managed Ollama agents with final human approval.</p>
          </div>
          <div className="signalBoard" aria-label="Marketing performance visual">
            <div className="signalHeader">
              <RadioTower size={18} />
              <span>Live channel signal</span>
            </div>
            <div className="signalBars">
              <span style={{ height: '48%' }} />
              <span style={{ height: '76%' }} />
              <span style={{ height: '62%' }} />
              <span style={{ height: '89%' }} />
              <span style={{ height: '54%' }} />
              <span style={{ height: '71%' }} />
            </div>
            <div className="channelIcons">
              <Instagram size={18} />
              <Facebook size={18} />
              <Linkedin size={18} />
              <Twitter size={18} />
              <Mail size={18} />
            </div>
          </div>
        </section>

        <section className="statsGrid">
          <Metric icon={Megaphone} label="Active campaigns" value="12" delta="+3 this week" />
          <Metric icon={Target} label="New leads" value="518" delta="31% AI-qualified" />
          <Metric icon={FileCheck2} label="Pending approvals" value="9" delta="4 high priority" />
          <Metric icon={Bot} label="Agent runs" value="1,284" delta="Paperclip online" />
        </section>

        <section className="contentGrid">
          <div className="widePanel">
            <PanelHeader icon={CalendarDays} title="Campaign Command Center" action="New campaign" />
            <div className="campaignList">
              {campaigns.map((campaign) => (
                <article className="campaignRow" key={campaign.name}>
                  <div>
                    <h3>{campaign.name}</h3>
                    <p>{campaign.owner} · {campaign.stage}</p>
                    <div className="chips">
                      {campaign.channels.map((channel) => <span key={channel}>{channel}</span>)}
                    </div>
                  </div>
                  <div className="progressBlock">
                    <div className="progressMeta">
                      <span>{campaign.progress}%</span>
                      <strong>{campaign.leads} leads</strong>
                    </div>
                    <div className="progressTrack"><span style={{ width: `${campaign.progress}%` }} /></div>
                    <small>{campaign.budget} · {campaign.approval}</small>
                  </div>
                </article>
              ))}
            </div>
          </div>

          <div className="panel">
            <PanelHeader icon={MessageSquareText} title="Publishing Queue" action="Draft post" />
            <div className="timeline">
              {posts.map((post) => (
                <div className="timeItem" key={`${post.time}-${post.title}`}>
                  <span className="time">{post.time}</span>
                  <div>
                    <strong>{post.title}</strong>
                    <p>{post.channel} · {post.status}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="panel">
            <PanelHeader icon={Target} title="Lead Capture & Follow-ups" action="Sync leads" />
            <div className="leadList">
              {leads.map((lead) => (
                <article className="leadRow" key={lead.company}>
                  <div className="leadScore">{lead.score}</div>
                  <div>
                    <h3>{lead.company}</h3>
                    <p>{lead.contact} · {lead.source}</p>
                    <span>{lead.next}</span>
                  </div>
                </article>
              ))}
            </div>
          </div>

          <div className="widePanel">
            <PanelHeader icon={Bot} title="Admin AI Agent Configuration" action="Add agent" />
            <div className="agentLayout">
              <div className="agentForm">
                <label>
                  Paperclip server URL
                  <input defaultValue="http://localhost:8088" />
                </label>
                <label>
                  Ollama model registry
                  <input defaultValue="http://localhost:11434" />
                </label>
                <label>
                  Default approval rule
                  <select defaultValue="human">
                    <option value="human">Human approval before publish/send</option>
                    <option value="manager">Manager approval for paid campaigns</option>
                    <option value="draft">Draft only, no execution</option>
                  </select>
                </label>
                <div className="formActions">
                  <button className="secondaryButton" type="button"><SlidersHorizontal size={16} /> Test connection</button>
                  <button className="primaryButton" type="button"><Check size={16} /> Save configuration</button>
                </div>
              </div>
              <div className="agentCards">
                {agents.map((agent) => (
                  <article className="agentCard" key={agent.name}>
                    <div className="agentTop">
                      <div>
                        <h3>{agent.name}</h3>
                        <p>{agent.type} · {agent.model}</p>
                      </div>
                      <span>{agent.temperature}</span>
                    </div>
                    <div className="chips">
                      {agent.tools.map((tool) => <span key={tool}>{tool}</span>)}
                    </div>
                    <footer>
                      <Clock3 size={15} />
                      <span>{agent.approval}</span>
                    </footer>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}

function Metric({ icon: Icon, label, value, delta }) {
  return (
    <article className="metric">
      <div className="metricIcon"><Icon size={18} /></div>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{delta}</small>
    </article>
  );
}

function PanelHeader({ icon: Icon, title, action }) {
  return (
    <div className="panelHeader">
      <div>
        <Icon size={18} />
        <h2>{title}</h2>
      </div>
      <button type="button">
        <Plus size={16} />
        <span>{action}</span>
      </button>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
