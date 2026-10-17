import AndreoMark from "@/components/AndreoMark";
import { ArrowLeft, Check, Eye, EyeOff, LockKeyhole, Save, SlidersHorizontal } from "lucide-react";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "wouter";

type Settings = {
  id?: number;
  chatName: string;
  displayName: string;
  icon: string;
  background: string;
  systemPrompt: string;
  instructions: string;
};

const emptySettings: Settings = {
  chatName: "Andreo",
  displayName: "Andreo AI",
  icon: "A",
  background: "radial-gradient(circle at 12% 0%, rgba(183,243,74,.08), transparent 28%), linear-gradient(145deg, #101712 0%, #0b0f0d 58%, #0a0d0c 100%)",
  systemPrompt: "",
  instructions: "",
};

const TOKEN_KEY = "andreo-admin-token";

export default function Admin() {
  const [token, setToken] = useState(() => sessionStorage.getItem(TOKEN_KEY) || "");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [settings, setSettings] = useState<Settings>(emptySettings);
  const [loading, setLoading] = useState(Boolean(token));
  const [saving, setSaving] = useState(false);
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
    setSettings(await response.json());
    setLoading(false);
  };

  useEffect(() => {
    if (token) void loadSettings(token);
  }, [token]);

  const login = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    const response = await fetch("/api/admin/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error || "Não foi possível entrar.");
      return;
    }
    sessionStorage.setItem(TOKEN_KEY, data.token);
    setPassword("");
    setToken(data.token);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setNotice("");
    setError("");
    const response = await fetch("/api/admin/settings", { method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(settings) });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error || "Não foi possível salvar.");
    } else {
      setSettings(data);
      setNotice("Alterações publicadas no chat.");
      window.setTimeout(() => setNotice(""), 3200);
    }
    setSaving(false);
  };

  const update = (key: keyof Settings, value: string) => setSettings(current => ({ ...current, [key]: value }));

  if (!token) {
    return <div className="admin-page auth-page"><div className="auth-card"><AndreoMark size="lg" /><div className="eyebrow"><LockKeyhole size={13} /> ÁREA RESTRITA</div><h1>Andreo Console</h1><p>Entre para ajustar identidade, comportamento e aparência do workspace.</p><form onSubmit={login}><label htmlFor="admin-password">Senha de administrador</label><div className="password-field"><input id="admin-password" autoFocus type={showPassword ? "text" : "password"} value={password} onChange={event => setPassword(event.target.value)} placeholder="••••••" /><button type="button" onClick={() => setShowPassword(value => !value)} aria-label="Exibir senha">{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></div>{error && <div className="form-error">{error}</div>}<button className="primary-button" type="submit"><LockKeyhole size={16} /> Acessar console</button></form><Link className="back-link" href="/"><ArrowLeft size={14} /> Voltar ao chat</Link></div></div>;
  }

  if (loading) return <div className="admin-page loading-page"><div className="loading-line" /> Carregando configurações...</div>;

  return <div className="admin-page"><header className="admin-topbar"><Link className="back-link" href="/"><ArrowLeft size={15} /> Voltar ao chat</Link><div className="admin-title"><SlidersHorizontal size={17} /><span>ANDREO CONSOLE</span><small>CONFIGURAÇÃO PRIVADA</small></div><button className="ghost-button" onClick={() => { sessionStorage.removeItem(TOKEN_KEY); setToken(""); }}><LockKeyhole size={14} /> Sair</button></header><main className="admin-main"><div className="admin-heading"><div><div className="eyebrow"><span className="status-dot" /> ADMIN / CONTROL ROOM</div><h1>Configure o comportamento do Andreo.</h1><p>As alterações são aplicadas imediatamente no chat público.</p></div><div className="admin-preview"><div style={{ background: settings.background }}><AndreoMark icon={settings.icon} size="sm" /></div><span>PREVIEW</span></div></div><form onSubmit={save} className="admin-grid"><section className="admin-card"><div className="card-heading"><div><span className="section-index">01</span><h2>Identidade</h2></div><span>MARCA</span></div><div className="form-grid"><label>Nome curto<input value={settings.chatName} onChange={event => update("chatName", event.target.value)} /></label><label>Nome exibido<input value={settings.displayName} onChange={event => update("displayName", event.target.value)} /></label><label>Ícone do chat<input value={settings.icon} onChange={event => update("icon", event.target.value)} placeholder="A, ◈ ou emoji" /></label></div><p className="field-hint">Use até 24 caracteres: uma letra, símbolo ou emoji funciona melhor no avatar quadrado.</p></section><section className="admin-card"><div className="card-heading"><div><span className="section-index">02</span><h2>Comportamento</h2></div><span>LLM</span></div><label>System prompt<textarea value={settings.systemPrompt} onChange={event => update("systemPrompt", event.target.value)} rows={5} /></label><label>Instruções adicionais<textarea value={settings.instructions} onChange={event => update("instructions", event.target.value)} rows={6} /></label></section><section className="admin-card"><div className="card-heading"><div><span className="section-index">03</span><h2>Aparência</h2></div><span>VISUAL</span></div><label>Fundo do chat<textarea value={settings.background} onChange={event => update("background", event.target.value)} rows={3} /><span className="field-hint">Aceita qualquer valor CSS de background: cor, gradiente ou imagem.</span></label><div className="background-swatches"><button type="button" onClick={() => update("background", "radial-gradient(circle at 12% 0%, rgba(183,243,74,.10), transparent 30%), linear-gradient(145deg, #101712 0%, #0b0f0d 58%, #0a0d0c 100%)")} style={{ background: "linear-gradient(145deg, #101712, #0b0f0d)" }} /><button type="button" onClick={() => update("background", "linear-gradient(135deg, #111827 0%, #0f172a 48%, #172554 100%)")} style={{ background: "linear-gradient(135deg, #111827, #172554)" }} /><button type="button" onClick={() => update("background", "linear-gradient(135deg, #25130c 0%, #120b0b 55%, #250f1f 100%)")} style={{ background: "linear-gradient(135deg, #25130c, #250f1f)" }} /></div></section><div className="admin-actions">{notice && <span className="save-notice"><Check size={15} /> {notice}</span>}{error && <span className="form-error">{error}</span>}<button className="primary-button" type="submit" disabled={saving}><Save size={16} /> {saving ? "Salvando..." : "Salvar alterações"}</button></div></form></main></div>;
}
