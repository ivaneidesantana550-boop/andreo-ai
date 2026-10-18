import AndreoMark from "@/components/AndreoMark";
import { Streamdown } from "streamdown";
import { ArrowUp, Braces, Boxes, Check, ChevronRight, Code2, Copy, Download, FilePlus2, Globe2, ImagePlus, Link2, Menu, MessageSquarePlus, Paperclip, PanelLeft, Search, Send, Sparkles, TerminalSquare, WandSparkles, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link as RouterLink } from "wouter";

type PublicSettings = { chatName: string; displayName: string; icon: string; iconImageUrl: string; background: string; backgroundImageUrl: string };
type ChatAttachment = { key: string; url: string; name: string; mimeType: string; size: number; textContent?: string };
type Message = { id: string; role: "user" | "assistant"; content: string; attachments?: ChatAttachment[]; imageUrl?: string; fileUrl?: string; fileName?: string };
type Tool = { label: string; caption: string; icon: typeof Code2; prompt: string; tone: string };

const defaultSettings: PublicSettings = { chatName: "Andreo", displayName: "Andreo AI", icon: "A", iconImageUrl: "", background: "radial-gradient(circle at 12% 0%, rgba(183,243,74,.08), transparent 28%), linear-gradient(145deg, #101712 0%, #0b0f0d 58%, #0a0d0c 100%)", backgroundImageUrl: "" };
const tools: Tool[] = [
  { label: "Gerar código", caption: "componentes & scripts", icon: Code2, prompt: "Gere uma solução de código completa para: ", tone: "lime" },
  { label: "Depurar", caption: "encontre o bug", icon: TerminalSquare, prompt: "Analise este erro e proponha a correção: ", tone: "blue" },
  { label: "Revisar", caption: "qualidade & segurança", icon: Braces, prompt: "Revise este código com foco em qualidade, segurança e clareza: ", tone: "violet" },
  { label: "Pesquisar na web", caption: "fontes & síntese", icon: Globe2, prompt: "Pesquise e sintetize informações confiáveis sobre: ", tone: "orange" },
  { label: "Abrir URL", caption: "ler uma página", icon: Link2, prompt: "Leia e explique o conteúdo desta URL: ", tone: "cyan" },
  { label: "Criar site", caption: "estrutura & UX", icon: WandSparkles, prompt: "Planeje e construa a estrutura de um site para: ", tone: "pink" },
];
const starterPrompts = ["Crie um componente React responsivo", "Explique este erro de TypeScript", "Pesquise tendências de design para SaaS"];
function uid() { return `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function fileToDataUrl(file: File) { return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file); }); }
function isTextLike(file: File) { return file.type.startsWith("text/") || /\.(md|json|csv|html?|css|js|jsx|ts|tsx|xml|yaml|yml|py|java|go|rs|sql|sh)$/i.test(file.name); }

export default function HomeWorkspace() {
  const [settings, setSettings] = useState(defaultSettings);
  const [messages, setMessages] = useState<Message[]>([{ id: "intro", role: "assistant", content: "Olá, eu sou o Andreo.\n\nSeu cockpit para transformar ideias em código, produto e ação na web. O que vamos construir hoje?" }]);
  const [draft, setDraft] = useState("");
  const [attachedFiles, setAttachedFiles] = useState<ChatAttachment[]>([]);
  const [sending, setSending] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [generating, setGenerating] = useState<"image" | "file" | "">("");
  const [imageMode, setImageMode] = useState(false);
  const [fileMode, setFileMode] = useState(false);
  const [imagePrompt, setImagePrompt] = useState("");
  const [fileName, setFileName] = useState("andreo-output.md");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const visibleTools = useMemo(() => tools.slice(0, 4), []);

  useEffect(() => { fetch("/api/settings").then(response => response.ok ? response.json() : Promise.reject(new Error("settings"))).then(data => setSettings({ ...defaultSettings, ...data })).catch(() => undefined); }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages, sending]);

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploadingFiles(true);
    try {
      const uploaded: ChatAttachment[] = [];
      for (const file of Array.from(files).slice(0, 10)) {
        const dataUrl = await fileToDataUrl(file);
        const response = await fetch("/api/chat/upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: file.name, dataUrl }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || `Não foi possível enviar ${file.name}.`);
        uploaded.push({ ...data, textContent: isTextLike(file) ? (await file.text()).slice(0, 120000) : undefined });
      }
      setAttachedFiles(current => [...current, ...uploaded]);
    } catch (error) {
      setMessages(current => [...current, { id: uid(), role: "assistant", content: `Não consegui importar o arquivo. ${error instanceof Error ? error.message : "Tente novamente."}` }]);
    } finally { setUploadingFiles(false); }
  };

  const submit = async (value?: string) => {
    const content = (value ?? draft).trim();
    if ((!content && !attachedFiles.length) || sending) return;
    const userMessage: Message = { id: uid(), role: "user", content: content || "Analise os arquivos anexados.", attachments: attachedFiles.length ? attachedFiles : undefined };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages); setDraft(""); setAttachedFiles([]); setSending(true);
    try {
      const response = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: nextMessages.map(({ role, content: text, attachments }) => ({ role, content: text, attachments })) }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não foi possível responder.");
      setMessages(current => [...current, { id: uid(), role: "assistant", content: data.content }]);
    } catch (error) { setMessages(current => [...current, { id: uid(), role: "assistant", content: `Não consegui concluir agora. ${error instanceof Error ? error.message : "Tente novamente em alguns instantes."}` }]); }
    finally { setSending(false); }
  };

  const generateImage = async () => {
    if (!imagePrompt.trim() || generating) return;
    setGenerating("image");
    try {
      const response = await fetch("/api/chat/generate-image", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: imagePrompt }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não foi possível criar a imagem.");
      setMessages(current => [...current, { id: uid(), role: "assistant", content: `Imagem criada a partir do pedido: “${imagePrompt}”`, imageUrl: data.url }]); setImagePrompt(""); setImageMode(false);
    } catch (error) { setMessages(current => [...current, { id: uid(), role: "assistant", content: error instanceof Error ? error.message : "Não consegui criar a imagem." }]); }
    finally { setGenerating(""); }
  };

  const generateFile = async () => {
    if (!draft.trim() || generating) return;
    setGenerating("file");
    try {
      const prompt = `Crie o conteúdo completo e pronto para uso do arquivo ${fileName}. Entregue somente o conteúdo do arquivo, sem cercas Markdown. Brief do usuário: ${draft}`;
      const aiResponse = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: [{ role: "user", content: prompt }] }) });
      const aiData = await aiResponse.json();
      if (!aiResponse.ok) throw new Error(aiData.error || "Não foi possível gerar o conteúdo.");
      const fileResponse = await fetch("/api/chat/create-file", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: fileName, content: aiData.content }) });
      const fileData = await fileResponse.json();
      if (!fileResponse.ok) throw new Error(fileData.error || "Não foi possível preparar o download.");
      setMessages(current => [...current, { id: uid(), role: "assistant", content: `Arquivo **${fileData.name}** criado e pronto para download.`, fileUrl: fileData.url, fileName: fileData.name }]); setDraft(""); setFileMode(false);
    } catch (error) { setMessages(current => [...current, { id: uid(), role: "assistant", content: error instanceof Error ? error.message : "Não consegui criar o arquivo." }]); }
    finally { setGenerating(""); }
  };

  const useTool = (tool: Tool) => { setDraft(tool.prompt); setSidebarOpen(false); window.setTimeout(() => document.getElementById("message-composer")?.focus(), 50); };
  const resetChat = () => { setMessages([{ id: uid(), role: "assistant", content: "Nova sessão pronta. O que você quer criar, investigar ou melhorar?" }]); setDraft(""); setAttachedFiles([]); setSidebarOpen(false); };
  const copyMessage = async (message: Message) => { await navigator.clipboard?.writeText(message.content); setCopiedId(message.id); window.setTimeout(() => setCopiedId(null), 1400); };

  const appStyle = { background: settings.background, ...(settings.backgroundImageUrl ? { backgroundImage: `linear-gradient(rgba(7, 12, 9, .64), rgba(7, 12, 9, .72)), url("${settings.backgroundImageUrl}")`, backgroundSize: "cover", backgroundPosition: "center" } : {}) };
  return <div className="andreo-app" style={appStyle}><div className="ambient-glow ambient-glow-one" /><div className="ambient-glow ambient-glow-two" /><aside className={`workspace-sidebar ${sidebarOpen ? "is-open" : ""}`}><div className="sidebar-head"><div className="brand-lockup"><AndreoMark icon={settings.icon} imageUrl={settings.iconImageUrl} size="sm" /><div><div className="wordmark">{settings.chatName}</div><div className="wordmark-sub">AI / WORKSPACE</div></div></div><button className="icon-button only-mobile" onClick={() => setSidebarOpen(false)} aria-label="Fechar menu"><X size={18} /></button></div><button className="new-session-button" onClick={resetChat}><MessageSquarePlus size={16} /> Nova sessão <span>⌘ K</span></button><div className="sidebar-section-label">Ferramentas do workspace</div><nav className="tool-list">{tools.map(tool => { const Icon = tool.icon; return <button key={tool.label} className="tool-list-item" onClick={() => useTool(tool)}><span className={`tool-icon ${tool.tone}`}><Icon size={16} /></span><span><strong>{tool.label}</strong><small>{tool.caption}</small></span><ChevronRight size={14} /></button>; })}</nav><RouterLink className="build-lab-link" href="/build-lab"><span className="tool-icon lime"><Boxes size={16} /></span><span><strong>Build Lab</strong><small>APK, EXE, ZIP e sites</small></span><ChevronRight size={14} /></RouterLink><div className="sidebar-spacer" /><div className="sidebar-status"><span className="status-dot" /><span><strong>Andreo online</strong><small>Pronto para executar</small></span><span className="status-pulse" /></div></aside><main className="workspace-main"><header className="topbar"><div className="topbar-left"><button className="icon-button only-mobile" onClick={() => setSidebarOpen(true)} aria-label="Abrir menu"><Menu size={19} /></button><div className="mobile-brand"><AndreoMark icon={settings.icon} imageUrl={settings.iconImageUrl} size="sm" /><span>{settings.chatName}</span></div><span className="breadcrumb desktop-only"><PanelLeft size={14} /> Workspace <span>/</span> Nova sessão</span></div><div className="topbar-right"><div className="top-status"><span className="status-dot" /> <span>ONLINE</span></div><button className="top-icon desktop-only" aria-label="Pesquisar"><Search size={16} /></button><button className="top-icon" onClick={resetChat} aria-label="Nova sessão"><MessageSquarePlus size={16} /></button></div></header><section className="chat-stage"><div className="chat-header"><div><div className="eyebrow"><Sparkles size={13} /> INTELIGÊNCIA OPERACIONAL</div><h1>{settings.displayName}</h1><p>Transforme intenção em entregas concretas.</p></div><div className="model-badge"><span className="model-dot" /> CORE <strong>ONLINE</strong></div></div><div className="conversation" aria-live="polite"><div className="conversation-intro"><span>17 OUT 2026</span><i /> <span>SESSÃO 01</span></div>{messages.map(message => <article key={message.id} className={`message-row ${message.role}`}>{message.role === "assistant" && <AndreoMark icon={settings.icon} imageUrl={settings.iconImageUrl} size="sm" />}<div className="message-stack"><div className="message-meta"><span>{message.role === "assistant" ? settings.chatName : "Você"}</span><span>{message.role === "assistant" ? "ASSISTANT" : "AGORA"}</span></div><div className="message-bubble">{message.role === "assistant" ? <Streamdown>{message.content}</Streamdown> : <p>{message.content}</p>}{message.attachments?.length ? <div className="message-attachments">{message.attachments.map(file => <span key={file.key}><Paperclip size={11} /> {file.name}</span>)}</div> : null}{message.imageUrl ? <div className="generated-asset"><img src={message.imageUrl} alt="Imagem gerada pelo Andreo" /><a href={message.imageUrl} download target="_blank" rel="noreferrer"><Download size={13} /> Baixar imagem</a></div> : null}{message.fileUrl ? <a className="generated-file" href={message.fileUrl} download target="_blank" rel="noreferrer"><FilePlus2 size={15} /><span><strong>{message.fileName}</strong><small>Arquivo pronto para download</small></span><Download size={14} /></a> : null}</div>{message.role === "assistant" && <div className="message-actions"><button onClick={() => copyMessage(message)}>{copiedId === message.id ? <Check size={13} /> : <Copy size={13} />} {copiedId === message.id ? "Copiado" : "Copiar"}</button></div>}</div></article>)}{sending && <article className="message-row assistant"><AndreoMark icon={settings.icon} imageUrl={settings.iconImageUrl} size="sm" /><div className="message-stack"><div className="message-meta"><span>{settings.chatName}</span><span>PROCESSANDO</span></div><div className="message-bubble thinking-bubble"><span /><span /><span /></div></div></article>}<div ref={endRef} /></div><div className="quick-prompts">{starterPrompts.map(prompt => <button key={prompt} onClick={() => setDraft(prompt)}>{prompt}<ArrowUp size={13} /></button>)}</div><div className="composer-wrap"><div className="composer">{attachedFiles.length ? <div className="attachment-strip">{attachedFiles.map(file => <span key={file.key}><Paperclip size={11} /> {file.name}<button onClick={() => setAttachedFiles(current => current.filter(item => item.key !== file.key))} aria-label={`Remover ${file.name}`}><X size={11} /></button></span>)}</div> : null}<textarea id="message-composer" value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submit(); } }} placeholder={uploadingFiles ? "Importando arquivos..." : "Descreva o que você quer construir..."} rows={1} /><div className="composer-bottom"><div className="composer-tools"><label className="composer-tool-button" title="Importar arquivos"><Paperclip size={17} /><input type="file" multiple onChange={event => void handleFiles(event.target.files)} /></label><button className={`composer-tool-button ${imageMode ? "active" : ""}`} onClick={() => { setImageMode(value => !value); setFileMode(false); }} title="Criar imagem"><ImagePlus size={17} /></button><button className={`composer-tool-button ${fileMode ? "active" : ""}`} onClick={() => { setFileMode(value => !value); setImageMode(false); }} title="Criar arquivo"><FilePlus2 size={17} /></button><span>{attachedFiles.length ? `${attachedFiles.length} arquivo(s) anexado(s)` : "Shift + Enter para nova linha"}</span></div><button className="send-button" onClick={() => void submit()} disabled={(!draft.trim() && !attachedFiles.length) || sending} aria-label="Enviar mensagem"><Send size={16} /></button></div>{imageMode ? <div className="composer-action-row"><input value={imagePrompt} onChange={event => setImagePrompt(event.target.value)} placeholder="Descreva a imagem que o Andreo deve criar..." /><button onClick={() => void generateImage()} disabled={!imagePrompt.trim() || Boolean(generating)}>{generating === "image" ? "Criando..." : "Gerar imagem"}</button></div> : null}{fileMode ? <div className="composer-action-row file-action-row"><input className="file-name-input" value={fileName} onChange={event => setFileName(event.target.value)} placeholder="nome-do-arquivo.md" /><span>Use o campo acima como briefing.</span><button onClick={() => void generateFile()} disabled={!draft.trim() || Boolean(generating)}>{generating === "file" ? "Gerando..." : "Gerar arquivo"}</button></div> : null}</div><div className="composer-note">Arquivos ficam disponíveis para o contexto da conversa. Imagens e arquivos gerados podem ser baixados imediatamente.</div></div></section><div className="mobile-tool-strip"><span>FERRAMENTAS</span>{visibleTools.map(tool => { const Icon = tool.icon; return <button key={tool.label} onClick={() => useTool(tool)}><Icon size={14} /> {tool.label}</button>; })}</div></main></div>;
}
