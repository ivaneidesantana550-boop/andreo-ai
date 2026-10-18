import AndreoMark from "@/components/AndreoMark";
import { ArrowLeft, Check, Eye, EyeOff, ImagePlus, LockKeyhole, Save, SlidersHorizontal, Trash2, Upload } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Link } from "wouter";

type Settings = {
  chatName: string;
  displayName: string;
  icon: string;
  iconImageUrl: string;
  background: string;
  backgroundImageUrl: string;
  brandSubtitle: string;
  welcomeEyebrow: string;
  welcomeMessage: string;
  welcomeDescription: string;
  inputPlaceholder: string;
  toolsSectionLabel: string;
  newSessionLabel: string;
  onlineLabel: string;
  assistantLabel: string;
  userLabel: string;
  processingLabel: string;
  quickPrompt1: string;
  quickPrompt2: string;
  quickPrompt3: string;
  systemPrompt: string;
  instructions: string;
};

const emptySettings: Settings = {
  chatName: "Andreo",
  displayName: "Andreo AI",
  icon: "A",
  iconImageUrl: "",
  background: "radial-gradient(circle at 12% 0%, rgba(183,243,74,.08), transparent 28%), linear-gradient(145deg, #101712 0%, #0b0f0d 58%, #0a0d0c 100%)",
  backgroundImageUrl: "",
  brandSubtitle: "AI / WORKSPACE",
  welcomeEyebrow: "INTELIGÊNCIA OPERACIONAL",
  welcomeMessage: "Olá, eu sou o Andreo.\n\nSeu cockpit para transformar ideias em código, produto e ação na web. O que vamos construir hoje?",
  welcomeDescription: "Transforme intenção em entregas concretas.",
  inputPlaceholder: "Descreva o que você quer construir...",
  toolsSectionLabel: "Ferramentas do workspace",
  newSessionLabel: "Nova sessão",
  onlineLabel: "ONLINE",
  assistantLabel: "ASSISTANT",
  userLabel: "Você",
  processingLabel: "PROCESSANDO",
  quickPrompt1: "Crie um componente React responsivo",
  quickPrompt2: "Explique este erro de TypeScript",
  quickPrompt3: "Pesquise tendências de design para SaaS",
  systemPrompt: "",
  instructions: "",
};

const TOKEN_KEY = "andreo-admin-token";

type AssetKind = "icon" | "background";

export default function AdminPanel() {
  const [token, setToken] = useState(() => sessionStorage.getItem(TOKEN_KEY) || "");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [settings, setSettings] = useState<Settings>(emptySettings);
  const [loading, setLoading] = useState(Boolean(token));
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<AssetKind | "">("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const loadSettings = async (authToken: string) => {
    setLoading(true);
    const response = await fetch("/api/admin/settings", { headers: { Authorization: `Bearer ${authToken}` } });
    if (!response.ok) {
      sessionStorage.removeItem(TOKEN_KEY);
      setToken("");
      setLoading(false);
      return;
    }
    setSettings({ ...emptySettings, ...(await response.json()) });
    setLoading(false);
  };

  useEffect(() => { if (token) void loadSettings(token); }, [token]);

  const login = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    const response = await fetch("/api/admin/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
    const data = await response.json();
    if (!response.ok) { setError(data.error || "Não foi possível entrar."); return; }
    sessionStorage.setItem(TOKEN_KEY, data.token);
    setPassword("");
    setToken(data.token);
  };

  const update = (key: keyof Settings, value: string) => setSettings(current => ({ ...current, [key]: value }));

  const uploadAsset = async (kind: AssetKind, file?: File) => {
    if (!file) return;
    setUploading(kind);
    setError("");
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const response = await fetch("/api/admin/upload-asset", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ kind, dataUrl: reader.result }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Upload recusado.");
        update(kind === "icon" ? "iconImageUrl" : "backgroundImageUrl", data.url);
        setNotice(kind === "icon" ? "Ícone enviado. Salve para publicar." : "Fundo enviado. Salve para publicar.");
      } catch (uploadError) {
        setError(uploadError instanceof Error ? uploadError.message : "Não foi possível enviar a imagem.");
      } finally {
        setUploading("");
      }
    };
    reader.readAsDataURL(file);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true); setNotice(""); setError("");
    const response = await fetch("/api/admin/settings", { method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(settings) });
    const data = await response.json();
    if (!response.ok) setError(data.error || "Não foi possível salvar.");
    else { setSettings({ ...emptySettings, ...data }); setNotice("Alterações publicadas no chat."); window.setTimeout(() => setNotice(""), 3200); }
    setSaving(false);
  };

  if (!token) return <div className="admin-page auth-page"><div className="auth-card"><AndreoMark size="lg" /><div className="eyebrow"><LockKeyhole size={13} /> ÁREA RESTRITA</div><h1>Andreo Console</h1><p>Entre para ajustar identidade, comportamento, assets visuais e o workspace de entregas.</p><form onSubmit={login}><label htmlFor="admin-password">Senha de administrador</label><div className="password-field"><input id="admin-password" autoFocus type={showPassword ? "text" : "password"} value={password} onChange={event => setPassword(event.target.value)} placeholder="••••••" /><button type="button" onClick={() => setShowPassword(value => !value)} aria-label="Exibir senha">{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></div>{error && <div className="form-error">{error}</div>}<button className="primary-button" type="submit"><LockKeyhole size={16} /> Acessar console</button></form><Link className="back-link" href="/"><ArrowLeft size={14} /> Voltar ao chat</Link></div></div>;

  if (loading) return <div className="admin-page loading-page"><div className="loading-line" /> Carregando configurações...</div>;

  return <div className="admin-page"><header className="admin-topbar"><Link className="back-link" href="/"><ArrowLeft size={15} /> Voltar ao chat</Link><div className="admin-title"><SlidersHorizontal size={17} /><span>ANDREO CONSOLE</span><small>CONFIGURAÇÃO PRIVADA</small></div><button className="ghost-button" onClick={() => { sessionStorage.removeItem(TOKEN_KEY); setToken(""); }}><LockKeyhole size={14} /> Sair</button></header><main className="admin-main"><div className="admin-heading"><div><div className="eyebrow"><span className="status-dot" /> ADMIN / CONTROL ROOM</div><h1>Configure o comportamento do Andreo.</h1><p>Assets enviados são armazenados e aplicados no chat após salvar.</p></div><div className="admin-preview"><div style={{ background: settings.background, ...(settings.backgroundImageUrl ? { backgroundImage: `url("${settings.backgroundImageUrl}")`, backgroundSize: "cover" } : {}) }}><AndreoMark icon={settings.icon} imageUrl={settings.iconImageUrl} size="sm" /></div><span>PREVIEW</span></div></div><form onSubmit={save} className="admin-grid"><section className="admin-card"><div className="card-heading"><div><span className="section-index">01</span><h2>Identidade</h2></div><span>MARCA</span></div><div className="form-grid"><label>Nome curto<input value={settings.chatName} onChange={event => update("chatName", event.target.value)} /></label><label>Nome exibido<input value={settings.displayName} onChange={event => update("displayName", event.target.value)} /></label><label>Fallback do ícone<input value={settings.icon} onChange={event => update("icon", event.target.value)} placeholder="A ou símbolo" /></label></div><div className="asset-upload-row"><div className="asset-thumb">{settings.iconImageUrl ? <img src={settings.iconImageUrl} alt="Ícone atual" /> : <AndreoMark icon={settings.icon} size="sm" />}</div><div><strong>Imagem do ícone</strong><small>PNG, JPG, WEBP, GIF ou SVG · máximo 6 MB</small><label className="upload-button"><Upload size={14} /> {uploading === "icon" ? "Enviando..." : "Escolher imagem"}<input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" onChange={event => void uploadAsset("icon", event.target.files?.[0])} /></label></div>{settings.iconImageUrl && <button type="button" className="remove-asset" onClick={() => update("iconImageUrl", "")} aria-label="Remover ícone"><Trash2 size={15} /></button>}</div></section><section className="admin-card"><div className="card-heading"><div><span className="section-index">02</span><h2>Textos do chat</h2></div><span>CONTEÚDO</span></div><label>Etiqueta superior<input value={settings.welcomeEyebrow} onChange={event => update("welcomeEyebrow", event.target.value)} /></label><label>Mensagem inicial<textarea value={settings.welcomeMessage} onChange={event => update("welcomeMessage", event.target.value)} rows={5} /></label><label>Descrição abaixo do título<input value={settings.welcomeDescription} onChange={event => update("welcomeDescription", event.target.value)} /></label><label>Placeholder do campo de mensagem<input value={settings.inputPlaceholder} onChange={event => update("inputPlaceholder", event.target.value)} /></label><div className="form-grid"><label>Subtítulo da marca<input value={settings.brandSubtitle} onChange={event => update("brandSubtitle", event.target.value)} /></label><label>Seção de ferramentas<input value={settings.toolsSectionLabel} onChange={event => update("toolsSectionLabel", event.target.value)} /></label><label>Botão de nova sessão<input value={settings.newSessionLabel} onChange={event => update("newSessionLabel", event.target.value)} /></label><label>Status online<input value={settings.onlineLabel} onChange={event => update("onlineLabel", event.target.value)} /></label><label>Nome do assistente<input value={settings.assistantLabel} onChange={event => update("assistantLabel", event.target.value)} /></label><label>Nome do usuário<input value={settings.userLabel} onChange={event => update("userLabel", event.target.value)} /></label><label>Status de processamento<input value={settings.processingLabel} onChange={event => update("processingLabel", event.target.value)} /></label></div><div className="form-grid"><label>Sugestão 1<input value={settings.quickPrompt1} onChange={event => update("quickPrompt1", event.target.value)} /></label><label>Sugestão 2<input value={settings.quickPrompt2} onChange={event => update("quickPrompt2", event.target.value)} /></label><label>Sugestão 3<input value={settings.quickPrompt3} onChange={event => update("quickPrompt3", event.target.value)} /></label></div></section><section className="admin-card"><div className="card-heading"><div><span className="section-index">02</span><h2>Comportamento</h2></div><span>LLM</span></div><label>System prompt<textarea value={settings.systemPrompt} onChange={event => update("systemPrompt", event.target.value)} rows={5} /></label><label>Instruções adicionais<textarea value={settings.instructions} onChange={event => update("instructions", event.target.value)} rows={6} /></label></section><section className="admin-card"><div className="card-heading"><div><span className="section-index">03</span><h2>Aparência</h2></div><span>VISUAL</span></div><label>Fundo CSS de fallback<textarea value={settings.background} onChange={event => update("background", event.target.value)} rows={3} /><span className="field-hint">Usado quando não houver uma imagem de fundo.</span></label><div className="asset-upload-row background-upload"><div className="asset-thumb">{settings.backgroundImageUrl ? <img src={settings.backgroundImageUrl} alt="Fundo atual" /> : <ImagePlus size={18} />}</div><div><strong>Imagem de fundo</strong><small>A imagem cobre todo o chat com uma camada de contraste.</small><label className="upload-button"><Upload size={14} /> {uploading === "background" ? "Enviando..." : "Escolher imagem"}<input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" onChange={event => void uploadAsset("background", event.target.files?.[0])} /></label></div>{settings.backgroundImageUrl && <button type="button" className="remove-asset" onClick={() => update("backgroundImageUrl", "")} aria-label="Remover fundo"><Trash2 size={15} /></button>}</div></section><div className="admin-actions">{notice && <span className="save-notice"><Check size={15} /> {notice}</span>}{error && <span className="form-error">{error}</span>}<Link className="ghost-button" href="/">Voltar ao chat</Link><button className="primary-button" type="submit" disabled={saving}><Save size={16} /> {saving ? "Salvando..." : "Salvar alterações"}</button></div></form></main></div>;
}
