import AndreoMark from "@/components/AndreoMark";
import { ArrowLeft, Boxes, CheckCircle2, CloudUpload, Code2, Download, FileArchive, FileCog, Globe2, Hammer, LayoutTemplate, Menu, Package, Play, Rocket, Smartphone, TerminalSquare, X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Link } from "wouter";

type BuildKind = "apk" | "exe" | "bundle" | "site";
type BuildJob = { id: string; name: string; kind: BuildKind; brief: string; createdAt: string; status: "ready" | "published" };

const buildTypes: Array<{ kind: BuildKind; title: string; description: string; icon: typeof Smartphone; color: string; output: string }> = [
  { kind: "apk", title: "Android APK", description: "Pacote instalável para Android", icon: Smartphone, color: "lime", output: ".apk" },
  { kind: "exe", title: "Windows EXE", description: "Aplicativo desktop executável", icon: TerminalSquare, color: "blue", output: ".exe" },
  { kind: "bundle", title: "Pacote de arquivos", description: "ZIP, código, assets e manifestos", icon: FileArchive, color: "violet", output: ".zip" },
  { kind: "site", title: "Site com URL", description: "Publicação web e entrega por link", icon: Globe2, color: "orange", output: "URL" },
];

const starterJobs: BuildJob[] = [
  { id: "AND-READY-01", name: "Landing Andreo", kind: "site", brief: "Página de apresentação com hero, pricing e contato.", createdAt: "Agora", status: "ready" },
];

function kindLabel(kind: BuildKind) { return buildTypes.find(item => item.kind === kind)?.title || kind; }

export default function BuildLab() {
  const [jobs, setJobs] = useState<BuildJob[]>(() => { try { return JSON.parse(localStorage.getItem("andreo-build-jobs") || "null") || starterJobs; } catch { return starterJobs; } });
  const [kind, setKind] = useState<BuildKind>("site");
  const [name, setName] = useState("");
  const [brief, setBrief] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const selected = buildTypes.find(item => item.kind === kind)!;
  const SelectedIcon = selected.icon;

  useEffect(() => { localStorage.setItem("andreo-build-jobs", JSON.stringify(jobs)); }, [jobs]);

  const createJob = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !brief.trim()) return;
    const job: BuildJob = { id: `AND-${Math.random().toString(36).slice(2, 8).toUpperCase()}`, name: name.trim(), kind, brief: brief.trim(), createdAt: "Agora", status: "ready" };
    setJobs(current => [job, ...current]); setName(""); setBrief("");
  };

  const downloadSpec = (job: BuildJob) => {
    const blob = new Blob([JSON.stringify({ product: "Andreo Build Lab", ...job }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${job.id.toLowerCase()}-spec.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return <div className="build-lab"><aside className={`build-sidebar ${sidebarOpen ? "is-open" : ""}`}><div className="sidebar-head"><div className="brand-lockup"><AndreoMark size="sm" /><div><div className="wordmark">Andreo</div><div className="wordmark-sub">BUILD LAB</div></div></div><button className="icon-button only-mobile" onClick={() => setSidebarOpen(false)}><X size={18} /></button></div><Link className="build-back" href="/"><ArrowLeft size={15} /> Voltar ao chat</Link><div className="build-nav-label">Pipelines</div><div className="build-nav-item active"><Boxes size={16} /> Build Lab <span>4</span></div><div className="build-nav-item"><Code2 size={16} /> Código fonte</div><div className="build-nav-item"><CloudUpload size={16} /> Entregas</div><div className="build-nav-item"><FileCog size={16} /> Variáveis</div><div className="sidebar-spacer" /><div className="sidebar-status"><span className="status-dot" /><span><strong>Runner pronto</strong><small>Ambiente preparado</small></span></div></aside><main className="build-main"><header className="build-topbar"><button className="icon-button only-mobile" onClick={() => setSidebarOpen(true)}><Menu size={19} /></button><div><div className="eyebrow"><Hammer size={13} /> ANDREO / BUILD LAB</div><h1>Transforme uma ideia em entrega.</h1></div><div className="build-top-actions"><span className="top-status"><span className="status-dot" /> PIPELINE READY</span><Link className="ghost-button" href="/andreo-console">Console admin</Link></div></header><section className="build-content"><div className="build-intro"><p>Prepare builds para Android, Windows, pacotes de arquivos e sites publicáveis. Cada pedido fica registrado como uma entrega organizada.</p><div className="build-stat"><strong>{jobs.length.toString().padStart(2, "0")}</strong><span>entregas<br />nesta sessão</span></div></div><div className="build-type-grid">{buildTypes.map(item => { const Icon = item.icon; return <button key={item.kind} className={`build-type-card ${kind === item.kind ? "selected" : ""}`} onClick={() => setKind(item.kind)}><span className={`build-type-icon ${item.color}`}><Icon size={19} /></span><strong>{item.title}</strong><small>{item.description}</small><span className="build-output">{item.output}</span></button>; })}</div><div className="build-workspace"><form className="build-form" onSubmit={createJob}><div className="card-heading"><div><span className="section-index">01</span><h2>Nova entrega</h2></div><span>CONFIGURAR</span></div><label>Nome do projeto<input value={name} onChange={event => setName(event.target.value)} placeholder={kind === "site" ? "ex.: Portal da minha empresa" : "ex.: Meu aplicativo"} /></label><label>O que deve ser criado?<textarea value={brief} onChange={event => setBrief(event.target.value)} rows={5} placeholder="Descreva telas, funcionalidades, tecnologia ou arquivos necessários..." /></label><div className="build-form-footer"><span><SelectedIcon size={14} /> Saída: {selected.title}</span><button className="primary-button" type="submit"><Play size={15} /> Criar pipeline</button></div></form><div className="build-flow"><div className="card-heading"><div><span className="section-index">02</span><h2>Fluxo de entrega</h2></div><span>PIPELINE</span></div><div className="flow-step active"><span>01</span><div><strong>Especificação</strong><small>Brief e stack definidos</small></div><CheckCircle2 size={15} /></div><div className="flow-line" /><div className="flow-step"><span>02</span><div><strong>Build</strong><small>Compilar e empacotar artefatos</small></div><Package size={15} /></div><div className="flow-line" /><div className="flow-step"><span>03</span><div><strong>Entrega</strong><small>{kind === "site" ? "Publicar e gerar URL" : "Baixar arquivo gerado"}</small></div><Rocket size={15} /></div><div className="delivery-note"><CloudUpload size={15} /><span>Sites recebem um endereço de entrega após a publicação. APK, EXE e pacotes ficam disponíveis para download na área de entregas.</span></div></div></div><div className="jobs-section"><div className="section-toolbar"><div><div className="eyebrow"><LayoutTemplate size={13} /> ENTREGAS RECENTES</div><h2>Seus pipelines</h2></div><span className="jobs-count">{jobs.length} itens</span></div><div className="jobs-list">{jobs.map(job => <div className="job-row" key={job.id}><div className={`job-kind ${job.kind}`}>{job.kind === "apk" ? <Smartphone size={16} /> : job.kind === "exe" ? <TerminalSquare size={16} /> : job.kind === "site" ? <Globe2 size={16} /> : <FileArchive size={16} />}</div><div className="job-info"><strong>{job.name}</strong><span>{kindLabel(job.kind)} · {job.id} · {job.createdAt}</span><small>{job.brief}</small></div><span className="job-status"><i /> {job.status === "published" ? "PUBLICADO" : "PRONTO PARA BUILD"}</span><button className="job-action" title="Baixar especificação" onClick={() => downloadSpec(job)}><Download size={15} /></button></div>)}</div></div></section></main></div>;
}
