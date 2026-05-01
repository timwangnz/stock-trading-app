/**
 * About.jsx
 * Project summary page — describes Vantage and how it was built
 * entirely through Claude Cowork with no manual coding.
 */

import { TrendingUp, Database, Shield, Bot, BarChart2, Globe, Layers, Cpu, Lock, Zap, Code2, MessageSquare, User, GraduationCap, Gamepad2, Briefcase, Mail, Terminal, Package } from 'lucide-react'
import clsx from 'clsx'

// ── Data ──────────────────────────────────────────────────────────

const FEATURES = [
  { icon: BarChart2,  label: 'Live Market Data',  desc: 'Real-time prices, charts, and heatmaps via Polygon.io — API key never exposed to the browser.' },
  { icon: TrendingUp, label: 'Vibe Trading',       desc: 'Buy, sell, and manage a simulated portfolio with fractional shares and average cost tracking.' },
  { icon: Bot,        label: 'AI Trading Agent',   desc: 'Claude-powered assistant that executes trades via natural language — "buy 10 AAPL at 180".' },
  { icon: Shield,     label: 'Auth & RBAC',         desc: 'Google OAuth + email/password sign-in. Four roles: admin, premium, user, readonly.' },
  { icon: Database,   label: 'Persistent Storage', desc: 'PostgreSQL database on Railway — portfolio, watchlist, snapshots, and audit logs per user.' },
  { icon: BarChart2,  label: 'Portfolio History',  desc: 'Daily snapshots with SPY benchmark comparison and performance charts over time.' },
  { icon: Globe,      label: 'Market Heatmap',     desc: "Treemap visualisation with cell size = market cap and colour = today's % price change." },
  { icon: Layers,     label: 'Light / Dark Theme', desc: 'Runtime theme toggle using CSS custom properties and Tailwind — persisted per device.' },
]

const TECH = [
  { category: 'Frontend',  items: ['React 18', 'Vite', 'Tailwind CSS', 'Recharts', 'Lucide Icons'] },
  { category: 'Backend',   items: ['Express.js', 'Node 22 (ESM)', 'JWT Auth', 'bcryptjs', 'Helmet', 'Rate Limiting'] },
  { category: 'Database',  items: ['PostgreSQL', 'node-postgres (pg)', 'Railway managed DB'] },
  { category: 'Auth',      items: ['Google OAuth 2.0', 'JWT (24h expiry)', 'Role-Based Access Control'] },
  { category: 'AI & Data', items: ['Anthropic Claude API', 'Polygon.io Market Data', 'Server-side API proxy'] },
  { category: 'DevOps',    items: ['Docker (multi-stage build)', 'Railway (hosting)', 'Railway PostgreSQL'] },
]

const JOURNEY = [
  { step: '01', title: 'React App Foundation',      desc: 'Set up Vite + React + Tailwind. Built the dashboard, portfolio, and watchlist pages with live Polygon data.' },
  { step: '02', title: 'Light / Dark Theme System', desc: 'Created a CSS variables theme system with a centralized theme.js and runtime toggle via ThemeContext.' },
  { step: '03', title: 'Auth & Multi-user Support', desc: 'Added Google OAuth and email/password sign-in. JWT auth, RBAC with four roles, admin panel.' },
  { step: '04', title: 'API Key Security',          desc: 'Moved all Polygon API calls server-side. POLYGON_API_KEY never bundled into browser JS.' },
  { step: '05', title: 'AI Trading Agent',          desc: 'Integrated Claude via tool_use to execute buy/sell/remove trades through natural language.' },
  { step: '06', title: 'PostgreSQL Migration',      desc: 'Migrated from MySQL to PostgreSQL for free cloud hosting. Full query rewrite with pg library.' },
  { step: '07', title: 'Railway Deployment',        desc: 'Dockerized and deployed to Railway with environment variable management and health checks.' },
  { step: '08', title: 'Security Hardening',        desc: 'Added Helmet, rate limiting, CORS restriction, input validation, JWT fixes, and removed debug endpoints.' },
]

const TOC = [
  { id: 'overview',   label: 'Overview' },
  { id: 'built',      label: 'How It Was Built' },
  { id: 'features',   label: 'Features' },
  { id: 'tech',       label: 'Tech Stack' },
  { id: 'install',    label: 'Install Locally' },
  { id: 'about-tim',  label: 'About Dr. Tim' },
]

// ── Sub-components ────────────────────────────────────────────────

function SectionTitle({ id, children }) {
  return (
    <h2 id={id} className="text-primary font-semibold text-lg mb-4 flex items-center gap-2 scroll-mt-6">
      {children}
    </h2>
  )
}

function FeatureCard({ icon: Icon, label, desc }) {
  return (
    <div className="bg-surface-card border border-border rounded-xl p-5 flex gap-4">
      <div className="mt-0.5 shrink-0 w-8 h-8 rounded-lg bg-accent-blue/10 flex items-center justify-center">
        <Icon size={16} className="text-accent-blue" />
      </div>
      <div>
        <p className="text-primary font-medium text-sm mb-1">{label}</p>
        <p className="text-muted text-xs leading-relaxed">{desc}</p>
      </div>
    </div>
  )
}

function TechBadge({ label }) {
  return (
    <span className="inline-block text-xs px-2.5 py-1 rounded-full bg-surface border border-border text-secondary">
      {label}
    </span>
  )
}

function JourneyStep({ step, title, desc, last }) {
  return (
    <div className="flex gap-4">
      <div className="flex flex-col items-center">
        <div className="w-8 h-8 rounded-full bg-accent-blue/10 border border-accent-blue/30 flex items-center justify-center shrink-0">
          <span className="text-accent-blue text-xs font-bold">{step}</span>
        </div>
        {!last && <div className="w-px flex-1 bg-border mt-2 mb-0" />}
      </div>
      <div className={clsx('pb-6', last && 'pb-0')}>
        <p className="text-primary font-medium text-sm mb-1">{title}</p>
        <p className="text-muted text-xs leading-relaxed">{desc}</p>
      </div>
    </div>
  )
}

function TableOfContents() {
  return (
    <nav className="bg-surface-card border border-border rounded-xl p-5">
      <p className="text-primary font-semibold text-sm mb-3">Contents</p>
      <ol className="space-y-2">
        {TOC.map((item, i) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              className="flex items-center gap-2.5 text-sm text-muted hover:text-accent-blue transition-colors group"
            >
              <span className="w-5 h-5 rounded-full bg-surface border border-border flex items-center justify-center text-xs text-muted group-hover:border-accent-blue/40 group-hover:text-accent-blue transition-colors shrink-0">
                {i + 1}
              </span>
              {item.label}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  )
}

// ── Page ──────────────────────────────────────────────────────────

export default function About() {
  return (
    <div className="p-6 max-w-4xl mx-auto space-y-10">

      {/* Table of Contents */}
      <TableOfContents />

      {/* Hero */}
      <div id="overview" className="bg-surface-card border border-border rounded-2xl p-8 scroll-mt-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-accent-blue/10 flex items-center justify-center">
            <TrendingUp size={20} className="text-accent-blue" />
          </div>
          <div>
            <h1 className="text-primary font-bold text-2xl">Vantage</h1>
            <p className="text-muted text-sm">AI-powered vibe trading platform</p>
          </div>
        </div>

        <p className="text-secondary text-base leading-relaxed mb-3">
          Vantage is a full-stack vibe trading app built entirely through natural language using
          <span className="text-accent-blue font-medium"> Claude Cowork</span> — Anthropic's desktop
          agentic coding tool. The entire application — from the React frontend to the Express backend,
          PostgreSQL schema, Docker deployment, and security hardening — was built through conversation.
          <span className="text-primary font-medium"> Zero lines of code were written manually.</span>
        </p>

        <p className="text-secondary text-base leading-relaxed mb-5">
          Dr. Tim built this on a <span className="text-accent-blue font-medium">Claude Pro subscription</span> —
          working just <span className="text-primary font-medium">2 hours a day</span> and wrapping up the
          whole thing in <span className="text-primary font-medium">about 2 weeks</span>. That's a production-grade,
          multi-user, AI-powered trading platform in roughly the same time it takes most people to set up
          a Node project and argue about folder structure. ☕
        </p>

        <div className="flex flex-wrap gap-3">
          <div className="flex items-center gap-2 bg-gain/10 border border-gain/20 rounded-lg px-3 py-2">
            <MessageSquare size={14} className="text-gain" />
            <span className="text-gain text-xs font-medium">100% vibe coded</span>
          </div>
          <div className="flex items-center gap-2 bg-accent-blue/10 border border-accent-blue/20 rounded-lg px-3 py-2">
            <Code2 size={14} className="text-accent-blue" />
            <span className="text-accent-blue text-xs font-medium">No manual coding</span>
          </div>
          <div className="flex items-center gap-2 bg-accent-purple/10 border border-accent-purple/20 rounded-lg px-3 py-2">
            <Cpu size={14} className="text-accent-purple" />
            <span className="text-accent-purple text-xs font-medium">~2 weeks · 2 hrs/day</span>
          </div>
          <div className="flex items-center gap-2 bg-surface border border-border rounded-lg px-3 py-2">
            <Lock size={14} className="text-muted" />
            <span className="text-muted text-xs font-medium">Production-ready security</span>
          </div>
        </div>
      </div>

      {/* How it was built */}
      <div>
        <SectionTitle id="built"><Zap size={18} className="text-accent-blue" />How It Was Built</SectionTitle>
        <div className="bg-surface-card border border-border rounded-xl p-6">
          <p className="text-secondary text-base leading-relaxed mb-4">
            Every feature was described in plain English to Claude Cowork on a standard <span className="text-accent-blue font-medium">Claude Pro subscription</span> — no enterprise plan, no secret sauce.
            Dr. Tim sat down for 2 hours each morning, typed what he wanted, and Claude handled the rest:
            architecture decisions, debugging, database migrations, security hardening, and deployment.
            The hardest part was honestly waiting for Google's OAuth settings to propagate. 🙄
          </p>
          <div className="mt-4 space-y-0">
            {JOURNEY.map((s, i) => (
              <JourneyStep key={s.step} {...s} last={i === JOURNEY.length - 1} />
            ))}
          </div>
        </div>
      </div>

      {/* Features */}
      <div>
        <SectionTitle id="features"><BarChart2 size={18} className="text-accent-blue" />Features</SectionTitle>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {FEATURES.map(f => <FeatureCard key={f.label} {...f} />)}
        </div>
      </div>

      {/* Tech stack */}
      <div>
        <SectionTitle id="tech"><Layers size={18} className="text-accent-blue" />Tech Stack</SectionTitle>
        <div className="bg-surface-card border border-border rounded-xl divide-y divide-border">
          {TECH.map(({ category, items }) => (
            <div key={category} className="px-5 py-4 flex gap-4 items-start">
              <span className="text-muted text-xs w-24 shrink-0 pt-1">{category}</span>
              <div className="flex flex-wrap gap-2">
                {items.map(item => <TechBadge key={item} label={item} />)}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Install Locally */}
      <div>
        <SectionTitle id="install"><Terminal size={18} className="text-accent-blue" />Install Locally</SectionTitle>
        <div className="bg-surface-card border border-border rounded-xl p-6 space-y-5">

          {/* Intro */}
          <div className="bg-gain/8 border border-gain/25 rounded-xl p-5 flex gap-4 items-start">
            <div className="w-9 h-9 rounded-lg bg-gain/15 flex items-center justify-center shrink-0 mt-0.5">
              <Package size={18} className="text-gain" />
            </div>
            <div>
              <p className="text-primary font-semibold text-sm mb-1">Runs on any Mac — no technical experience needed</p>
              <p className="text-secondary text-base leading-relaxed">
                Buy a Mac Mini, install Docker Desktop (one GUI installer), open Terminal, and run one command.
                The script asks a few questions, generates all secrets automatically, and opens Vantage
                in your browser — usually in under 5 minutes.
              </p>
            </div>
          </div>

          {/* Step by step */}
          <div className="space-y-4">

            <div className="flex gap-4">
              <div className="w-7 h-7 rounded-full bg-accent-blue/10 border border-accent-blue/30 flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-accent-blue text-xs font-bold">1</span>
              </div>
              <div>
                <p className="text-primary font-medium text-sm mb-1">Install Docker Desktop</p>
                <p className="text-muted text-sm">Download from <a href="https://www.docker.com/products/docker-desktop/" target="_blank" rel="noreferrer" className="text-accent-blue hover:underline">docker.com</a> — click Download, open the installer, drag to Applications. That's it.</p>
              </div>
            </div>

            <div className="flex gap-4">
              <div className="w-7 h-7 rounded-full bg-accent-blue/10 border border-accent-blue/30 flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-accent-blue text-xs font-bold">2</span>
              </div>
              <div>
                <p className="text-primary font-medium text-sm mb-1">Open Terminal and run one command</p>
                <div className="bg-gray-950 rounded-xl p-4 font-mono text-sm border border-gray-800 mt-2">
                  <p className="text-gray-500 text-xs mb-1"># paste this into Terminal and press Enter:</p>
                  <p className="text-green-400 select-all">curl -fsSL https://raw.githubusercontent.com/timwangnz/stock-trading-app/main/install.sh | bash</p>
                </div>
              </div>
            </div>

            <div className="flex gap-4">
              <div className="w-7 h-7 rounded-full bg-accent-blue/10 border border-accent-blue/30 flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-accent-blue text-xs font-bold">3</span>
              </div>
              <div>
                <p className="text-primary font-medium text-sm mb-1">Answer a few questions</p>
                <p className="text-muted text-sm">The script will ask for your Polygon.io API key (free) and optionally a Resend key for email. Everything else — passwords, secrets — is generated automatically.</p>
              </div>
            </div>

            <div className="flex gap-4">
              <div className="w-7 h-7 rounded-full bg-gain/15 border border-gain/30 flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-gain text-xs font-bold">✓</span>
              </div>
              <div>
                <p className="text-primary font-medium text-sm mb-1">Done — browser opens automatically</p>
                <div className="bg-gray-950 rounded-xl p-4 font-mono text-xs border border-gray-800 mt-2 space-y-1">
                  <p className="text-blue-400">✓ Docker is running</p>
                  <p className="text-blue-400">✓ Database ready</p>
                  <p className="text-blue-400">✓ App running at http://localhost:3001</p>
                  <p className="text-green-400">🎉 Vantage is running! Opening browser...</p>
                </div>
              </div>
            </div>

          </div>

          <p className="text-muted text-sm pt-1">
            For server/office deployments, see the full guide in the{' '}
            <a href="https://github.com/timwangnz/stock-trading-app" target="_blank" rel="noreferrer" className="text-accent-blue hover:underline">README →</a>
          </p>
        </div>
      </div>

      {/* About Dr. Tim */}
      <div>
        <SectionTitle id="about-tim"><User size={18} className="text-accent-blue" />About Dr. Tim</SectionTitle>
        <div className="bg-surface-card border border-border rounded-xl p-6 space-y-5">

          <p className="text-secondary text-base leading-relaxed">
            Dr. Tim is a <span className="text-primary font-medium">retired software architect</span> with
            35 years of experience building enterprise software across almost every programming language
            that ever existed — and probably a few that shouldn't have. He has shipped systems in
            domains ranging from <span className="text-primary font-medium">ERP, CRM, and Business Intelligence</span> to
            things that were cutting-edge at the time and are now in a museum.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="bg-surface rounded-xl border border-border p-4 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <GraduationCap size={15} className="text-accent-blue" />
                <span className="text-primary text-xs font-semibold">Education</span>
              </div>
              <p className="text-muted text-xs leading-relaxed">
                Ph.D in Mathematics. Which explains why the portfolio P&L calculations are suspiciously precise.
              </p>
            </div>
            <div className="bg-surface rounded-xl border border-border p-4 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <Briefcase size={15} className="text-accent-blue" />
                <span className="text-primary text-xs font-semibold">Career</span>
              </div>
              <p className="text-muted text-xs leading-relaxed">
                35 years as a software architect. ERP, CRM, BI — if it had a three-letter acronym, he's built it.
              </p>
            </div>
            <div className="bg-surface rounded-xl border border-border p-4 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <Gamepad2 size={15} className="text-accent-blue" />
                <span className="text-primary text-xs font-semibold">Now</span>
              </div>
              <p className="text-muted text-xs leading-relaxed">
                Retired and loving it. Spends his time on games, exploring AI tools, and occasionally
                vibe coding full-stack apps just to see if he still can. Spoiler: he can.
              </p>
            </div>
          </div>

          <div className="bg-accent-blue/5 border border-accent-blue/15 rounded-lg p-4">
            <p className="text-secondary text-base leading-relaxed">
              💡 <span className="text-primary font-medium">Why build Vantage?</span> After 35 years
              of writing code the hard way, Dr. Tim wanted to see what was possible when you hand the
              keyboard to an AI and just describe what you want. The answer, it turns out, is: quite a lot —
              and in a fraction of the time. This project is his proof of concept that in the age of AI,
              experience and domain knowledge matter more than ever, even if you never touch the code directly.
            </p>
          </div>

          <div className="flex flex-wrap gap-3 pt-1">
            <a
              href="mailto:anpwang@gmail.com"
              className="flex items-center gap-2 text-xs text-muted hover:text-accent-blue transition-colors border border-border hover:border-accent-blue/40 rounded-lg px-3 py-2"
            >
              <Mail size={13} /> Get in touch
            </a>
          </div>
        </div>
      </div>

      {/* Footer note */}
      <div className="bg-accent-blue/5 border border-accent-blue/20 rounded-xl p-5 text-center">
        <p className="text-secondary text-base leading-relaxed">
          Built with <span className="text-accent-blue font-medium">Claude Pro + Claude Cowork</span> by Dr. Tim · April 2026
        </p>
        <p className="text-muted text-sm mt-1">
          ~28 hours of total work. About 2 weeks. One Claude Pro subscription. Proof that the bottleneck is no longer code — it's ideas.
        </p>
      </div>

    </div>
  )
}
