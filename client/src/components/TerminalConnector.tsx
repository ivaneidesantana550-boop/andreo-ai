import { useEffect, useState } from "react";
import { Check, Copy, Power, Terminal, X } from "lucide-react";

type Props = { onClose: () => void };
type Command = { id: string; command: string; status: string; output?: string; error?: string };
export default function TerminalConnector({ onClose }: Props) {
  const [browserToken, setBrowserToken] = useState("");
  const [code, setCode] = useState("");
  const [agentCommand, setAgentCommand] = useState("");
  const [status, setStatus] = useState("starting");
  const [command, setCommand] = useState("");
  const [commands, setCommands] = useState<Command[]>([]);
  const [copied, setCopied] = useState(false);
  useEffect(() => { fetch("/api/terminal/pair/start", { method: "POST" }).then(r => r.json()).then(data => { setBrowserToken(data.browserToken); setCode(data.code); setAgentCommand(data.agentCommand); setStatus("waiting"); }); }, []);
  useEffect(() => { if (!browserToken || status === "connected") return; const timer = window.setInterval(() => fetch(`/api/terminal/pair/status?token=${browserToken}`).then(r => r.ok ? r.json() : null).then(data => { if (data?.status === "connected") setStatus("connected"); }), 1500); return () => window.clearInterval(timer); }, [browserToken, status]);
  useEffect(() => { if (!browserToken || status !== "connected") return; const timer = window.setInterval(() => fetch(`/api/terminal/commands?token=${browserToken}`).then(r => r.json()).then(data => setCommands(data.commands || [])), 1000); return () => window.clearInterval(timer); }, [browserToken, status]);
  const copy = async (text: string) => { await navigator.clipboard?.writeText(text); setCopied(true); window.setTimeout(() => setCopied(false), 1500); };
  const send = async () => { const value = command.trim(); if (!value || !window.confirm(`Confirmar execução no terminal?\n\n${value}`)) return; await fetch("/api/terminal/command", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: browserToken, command: value }) }); setCommand(""); };
  return <div className="terminal-modal-backdrop"><section className="terminal-modal"><header><div><div className="eyebrow"><Terminal size={14} /> TERMINAL LOCAL</div><h2>{status === "connected" ? "Terminal conectado" : "Conectar um terminal"}</h2></div><button className="icon-button" onClick={onClose}><X size={17} /></button></header>{status !== "connected" ? <><p>Baixe o agente, instale o Node.js no computador ou no Termux e execute o arquivo:</p><p><a className="primary-button" href="/andreo-terminal-agent.mjs" download>Baixar agente do terminal</a></p><p>Depois execute:</p><div className="terminal-code"><code>{agentCommand || "Preparando comando..."}</code><button onClick={() => void copy(agentCommand)}><Copy size={14} /> {copied ? "Copiado" : "Copiar"}</button></div><p>Depois informe este código no agente:</p><div className="pair-code">{code || "------"}</div><small>O código expira em 10 minutos. O terminal só recebe comandos confirmados por você.</small></> : <><div className="terminal-connected"><span className="status-dot" /> Conectado e aguardando comandos</div><label>Comando para executar<textarea value={command} onChange={e => setCommand(e.target.value)} placeholder="npm install...\npython script.py\napt install ..." rows={3} /></label><button className="primary-button" onClick={() => void send()} disabled={!command.trim()}><Check size={15} /> Confirmar e enviar comando</button><div className="terminal-output">{commands.slice().reverse().map(item => <article key={item.id}><div><code>{item.command}</code><span>{item.status}</span></div>{item.output && <pre>{item.output}</pre>}{item.error && <pre className="terminal-error">{item.error}</pre>}</article>)}</div></>}<footer><Power size={14} /> Execução visível, confirmação obrigatória e limitada às permissões do terminal conectado.</footer></section></div>;
}
