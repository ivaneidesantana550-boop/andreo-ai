import AndreoMark from "@/components/AndreoMark";
import { Streamdown } from "streamdown";
import {
  ArrowUp,
  Braces,
  Check,
  ChevronRight,
  Code2,
  Copy,
  Globe2,
  Link2,
  Menu,
  MessageSquarePlus,
  Paperclip,
  PanelLeft,
  Search,
  Send,
  Sparkles,
  TerminalSquare,
  WandSparkles,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

type PublicSettings = {
  chatName: string;
  displayName: string;
  icon: string;
  background: string;
};

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

type Tool = {
  label: string;
  caption: string;
  icon: typeof Code2;
  prompt: string;
  tone: string;
};

const defaultSettings: PublicSettings = {
  chatName: "Andreo",
  displayName: "Andreo AI",
  icon: "A",
  background: "radial-gradient(circle at 12% 0%, rgba(183,243,74,.08), transparent 28%), linear-gradient(145deg, #101712 0%, #0b0f0d 58%, #0a0d0c 100%)",
};

const tools: Tool[] = [
  { label: "Gerar código", caption: "componentes & scripts", icon: Code2, prompt: "Gere uma solução de código completa para: ", tone: "lime" },
  { label: "Depurar", caption: "encontre o bug", icon: TerminalSquare, prompt: "Analise este erro e proponha a correção: ", tone: "blue" },
  { label: "Revisar", caption: "qualidade & segurança", icon: Braces, prompt: "Revise este código com foco em qualidade, segurança e clareza: ", tone: "violet" },
  { label: "Pesquisar na web", caption: "fontes & síntese", icon: Globe2, prompt: "Pesquise e sintetize informações confiáveis sobre: ", tone: "orange" },
  { label: "Abrir URL", caption: "ler uma página", icon: Link2, prompt: "Leia e explique o conteúdo desta URL: ", tone: "cyan" },
  { label: "Criar site", caption: "estrutura & UX", icon: WandSparkles, prompt: "Planeje e construa a estrutura de um site para: ", tone: "pink" },
];

const starterPrompts = [
  "Crie um componente React responsivo",
  "Explique este erro de TypeScript",
  "Pesquise tendências de design para SaaS",
];

function uid() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export default function Home() {
  const [settings, setSettings] = useState(defaultSettings);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "intro",
      role: "assistant",
      content: "Olá, eu sou o Andreo.\n\nSeu cockpit para transformar ideias em código, produto e ação na web. O que vamos construir hoje?",
    },
  ]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/settings")
      .then(response => (response.ok ? response.json() : Promise.reject(new Error("settings"))))
      .then(data => setSettings({ ...defaultSettings, ...data }))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, sending]);

  const visibleTools = useMemo(() => tools.slice(0, 4), []);

  const submit = async (value?: string) => {
    const content = (value ?? draft).trim();
    if (!content || sending) return;
    const userMessage: Message = { id: uid(), role: "user", content };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setDraft("");
    setSending(true);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages.map(({ role, content: text }) => ({ role, content: text })) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não foi possível responder.");
      setMessages(current => [...current, { id: uid(), role: "assistant", content: data.content }]);
    } catch (error) {
      setMessages(current => [
        ...current,
        { id: uid(), role: "assistant", content: `Não consegui concluir agora. ${error instanceof Error ? error.message : "Tente novamente em alguns instantes."}` },
      ]);
    } finally {
      setSending(false);
    }
  };

  const useTool = (tool: Tool) => {
    setDraft(tool.prompt);
    setSidebarOpen(false);
    window.setTimeout(() => document.getElementById("message-composer")?.focus(), 50);
  };

  const resetChat = () => {
    setMessages([{ id: uid(), role: "assistant", content: "Nova sessão pronta. O que você quer criar, investigar ou melhorar?" }]);
    setDraft("");
    setSidebarOpen(false);
  };

  const copyMessage = async (message: Message) => {
    await navigator.clipboard?.writeText(message.content);
    setCopiedId(message.id);
    window.setTimeout(() => setCopiedId(null), 1400);
  };

  return (
    <div className="andreo-app" style={{ background: settings.background }}>
      <div className="ambient-glow ambient-glow-one" />
      <div className="ambient-glow ambient-glow-two" />
      <aside className={`workspace-sidebar ${sidebarOpen ? "is-open" : ""}`}>
        <div className="sidebar-head">
          <div className="brand-lockup">
            <AndreoMark icon={settings.icon} size="sm" />
            <div>
              <div className="wordmark">{settings.chatName}</div>
              <div className="wordmark-sub">AI / WORKSPACE</div>
            </div>
          </div>
          <button className="icon-button only-mobile" onClick={() => setSidebarOpen(false)} aria-label="Fechar menu"><X size={18} /></button>
        </div>
        <button className="new-session-button" onClick={resetChat}><MessageSquarePlus size={16} /> Nova sessão <span>⌘ K</span></button>
        <div className="sidebar-section-label">Ferramentas do workspace</div>
        <nav className="tool-list">
          {tools.map(tool => {
            const Icon = tool.icon;
            return <button key={tool.label} className="tool-list-item" onClick={() => useTool(tool)}><span className={`tool-icon ${tool.tone}`}><Icon size={16} /></span><span><strong>{tool.label}</strong><small>{tool.caption}</small></span><ChevronRight size={14} /></button>;
          })}
        </nav>
        <div className="sidebar-spacer" />
        <div className="sidebar-status"><span className="status-dot" /><span><strong>Andreo online</strong><small>Pronto para executar</small></span><span className="status-pulse" /></div>
      </aside>

      <main className="workspace-main">
        <header className="topbar">
          <div className="topbar-left"><button className="icon-button only-mobile" onClick={() => setSidebarOpen(true)} aria-label="Abrir menu"><Menu size={19} /></button><div className="mobile-brand"><AndreoMark icon={settings.icon} size="sm" /><span>{settings.chatName}</span></div><span className="breadcrumb desktop-only"><PanelLeft size={14} /> Workspace <span>/</span> Nova sessão</span></div>
          <div className="topbar-right"><div className="top-status"><span className="status-dot" /> <span>ONLINE</span></div><button className="top-icon desktop-only" aria-label="Pesquisar"><Search size={16} /></button><button className="top-icon" onClick={resetChat} aria-label="Nova sessão"><MessageSquarePlus size={16} /></button></div>
        </header>

        <section className="chat-stage">
          <div className="chat-header"><div><div className="eyebrow"><Sparkles size={13} /> INTELIGÊNCIA OPERACIONAL</div><h1>{settings.displayName}</h1><p>Transforme intenção em entregas concretas.</p></div><div className="model-badge"><span className="model-dot" /> CORE <strong>ONLINE</strong></div></div>
          <div className="conversation" aria-live="polite">
            <div className="conversation-intro"><span>17 OUT 2026</span><i /> <span>SESSÃO 01</span></div>
            {messages.map(message => (
              <article key={message.id} className={`message-row ${message.role}`}>
                {message.role === "assistant" && <AndreoMark icon={settings.icon} size="sm" />}
                <div className="message-stack"><div className="message-meta"><span>{message.role === "assistant" ? settings.chatName : "Você"}</span><span>{message.role === "assistant" ? "ASSISTANT" : "AGORA"}</span></div><div className="message-bubble">{message.role === "assistant" ? <Streamdown>{message.content}</Streamdown> : <p>{message.content}</p>}</div>{message.role === "assistant" && <div className="message-actions"><button onClick={() => copyMessage(message)}>{copiedId === message.id ? <Check size={13} /> : <Copy size={13} />} {copiedId === message.id ? "Copiado" : "Copiar"}</button></div>}</div>
              </article>
            ))}
            {sending && <article className="message-row assistant"><AndreoMark icon={settings.icon} size="sm" /><div className="message-stack"><div className="message-meta"><span>{settings.chatName}</span><span>PROCESSANDO</span></div><div className="message-bubble thinking-bubble"><span /><span /><span /></div></div></article>}
            <div ref={endRef} />
          </div>

          <div className="quick-prompts">{starterPrompts.map(prompt => <button key={prompt} onClick={() => setDraft(prompt)}>{prompt}<ArrowUp size={13} /></button>)}</div>
          <div className="composer-wrap"><div className="composer"><textarea id="message-composer" value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submit(); } }} placeholder="Descreva o que você quer construir..." rows={1} /><div className="composer-bottom"><div className="composer-tools"><button aria-label="Anexar arquivo"><Paperclip size={17} /></button><span>Shift + Enter para nova linha</span></div><button className="send-button" onClick={() => void submit()} disabled={!draft.trim() || sending} aria-label="Enviar mensagem"><Send size={16} /></button></div></div><div className="composer-note">Andreo pode cometer erros. Verifique respostas críticas antes de executar.</div></div>
        </section>
        <div className="mobile-tool-strip"><span>FERRAMENTAS</span>{visibleTools.map(tool => { const Icon = tool.icon; return <button key={tool.label} onClick={() => useTool(tool)}><Icon size={14} /> {tool.label}</button>; })}</div>
      </main>
    </div>
  );
}
