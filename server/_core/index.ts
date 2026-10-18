import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { publicPlatformScript } from "./publicConfig";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { invokeLLM, type Message } from "./llm";
import {
  createAdminToken,
  getAppSettings,
  isAdminPasswordValid,
  isAdminTokenValid,
  updateAppSettings,
} from "../settings";
import { storageGetSignedUrl, storagePut } from "../storage";
import { generateImage } from "./imageGeneration";
import { strToU8, zipSync } from "fflate";

const CAPABILITY_CONTEXT = `
Capacidades disponíveis no workspace: geração de código, revisão e refatoração, debugging, explicação de APIs, criação de componentes e sites, pesquisa na web, abertura e leitura de URLs, síntese de páginas, comparação de fontes e planejamento técnico. Seja honesto quando uma ação externa não estiver disponível diretamente e ofereça o próximo passo mais útil.
`;

type ChatAttachmentInput = { key: string; name: string; mimeType: string; textContent?: string };
type ChatMessageInput = { role: "user" | "assistant"; content: string; attachments?: ChatAttachmentInput[] };
const MAX_RESPONSE_CHARS = 1_000_000;
const MAX_COMPLETION_TOKENS_PER_PART = 16_000;
const MAX_CONTINUATION_PARTS = 64;
const ARTIFACT_RESPONSE_FORMAT = {
  type: "json_schema" as const,
  json_schema: {
    name: "andreo_artifact_project",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["name", "description", "files"],
      properties: {
        name: { type: "string" },
        description: { type: "string" },
        files: {
          type: "array",
          minItems: 1,
          maxItems: 80,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["path", "content"],
            properties: { path: { type: "string" }, content: { type: "string" } },
          },
        },
      },
    },
  },
};

function adminTokenFromRequest(req: express.Request) {
  const header = req.header("authorization") || "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

function requireAdmin(req: express.Request, res: express.Response) {
  if (!isAdminTokenValid(adminTokenFromRequest(req))) {
    res.status(401).json({ error: "Sessão admin expirada. Entre novamente." });
    return false;
  }
  return true;
}

function publicSettings(settings: Awaited<ReturnType<typeof getAppSettings>>) {
  return {
    chatName: settings.chatName,
    displayName: settings.displayName,
    icon: settings.icon,
    iconImageUrl: settings.iconImageUrl,
    background: settings.background,
    backgroundImageUrl: settings.backgroundImageUrl,
    brandSubtitle: settings.brandSubtitle,
    welcomeEyebrow: settings.welcomeEyebrow,
    welcomeMessage: settings.welcomeMessage,
    welcomeDescription: settings.welcomeDescription,
    inputPlaceholder: settings.inputPlaceholder,
    toolsSectionLabel: settings.toolsSectionLabel,
    newSessionLabel: settings.newSessionLabel,
    onlineLabel: settings.onlineLabel,
    assistantLabel: settings.assistantLabel,
    userLabel: settings.userLabel,
    processingLabel: settings.processingLabel,
    quickPrompt1: settings.quickPrompt1,
    quickPrompt2: settings.quickPrompt2,
    quickPrompt3: settings.quickPrompt3,
  };
}

function contentToText(content: unknown) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map(part => (typeof part === "string" ? part : (part as { text?: string }).text || ""))
      .join("\n")
      .trim();
  }
  return "";
}

function safeFileName(value: string, fallback: string) {
  const name = value.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100);
  return name || fallback;
}

function safeRelativePath(value: string, fallback: string) {
  const parts = value.split(/[\\/]+/).filter(part => part && part !== "." && part !== "..");
  const path = parts.map(part => safeFileName(part, "arquivo")).join("/");
  return path || fallback;
}

const GITHUB_REPOSITORY = "ivaneidesantana550-boop/andreo-ai";

async function githubRequest(path: string, init: RequestInit = {}) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("O runner do GitHub ainda não está configurado.");
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const isManualRedirect = init.redirect === "manual" && response.status >= 300 && response.status < 400;
  if (!response.ok && !isManualRedirect) {
    const detail = await response.text();
    throw new Error(`GitHub Actions respondeu ${response.status}: ${detail.slice(0, 240)}`);
  }
  return response;
}

async function findWorkflowRun(workflow: string, startedAt: number) {
  const response = await githubRequest(`/repos/${GITHUB_REPOSITORY}/actions/workflows/${workflow}/runs?event=workflow_dispatch&per_page=10`);
  const data = await response.json() as { workflow_runs?: Array<{ id: number; created_at: string; html_url: string; status: string; conclusion: string | null }> };
  return data.workflow_runs?.find(run => new Date(run.created_at).getTime() >= startedAt - 30_000) || null;
}

async function dispatchBuild(kind: "apk" | "exe", projectUrl: string, artifactName: string) {
  const workflow = kind === "apk" ? "build-android.yml" : "build-windows.yml";
  const startedAt = Date.now();
  await githubRequest(`/repos/${GITHUB_REPOSITORY}/actions/workflows/${workflow}/dispatches`, {
    method: "POST",
    body: JSON.stringify({ ref: "main", inputs: { project_url: projectUrl, artifact_name: artifactName } }),
  });
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 1500));
    const run = await findWorkflowRun(workflow, startedAt);
    if (run) return { id: run.id, status: run.status, conclusion: run.conclusion, html_url: run.html_url, workflow };
  }
  return { id: null, status: "queued", conclusion: null, html_url: `https://github.com/${GITHUB_REPOSITORY}/actions/workflows/${workflow}`, workflow };
}

function mimeForFile(name: string) {
  const extension = name.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    md: "text/markdown", txt: "text/plain", json: "application/json", csv: "text/csv",
    html: "text/html", css: "text/css", js: "text/javascript", ts: "text/typescript",
    jsx: "text/javascript", tsx: "text/typescript", xml: "application/xml",
  };
  return map[extension || ""] || "application/octet-stream";
}

function parseJsonObject(value: string) {
  const cleaned = value.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("O gerador não retornou um projeto válido.");
  return JSON.parse(cleaned.slice(start, end + 1)) as { name?: string; description?: string; files?: Array<{ path?: string; content?: string }> };
}

async function generateSiteDefinition(brief: string, settings: Awaited<ReturnType<typeof getAppSettings>>) {
  const prompt = `Crie um projeto de site completo e funcional para o seguinte pedido: ${brief}

Escolha a melhor stack para o pedido e preserve a stack solicitada pelo usuário. Você pode usar HTML/CSS/JavaScript, TypeScript, React, Vue, Angular, Next.js, Vite, Node/Express, PHP, Python, Java, Ruby, Go ou outra linguagem/framework adequado. Gere a estrutura real do projeto, incluindo package.json, arquivos de configuração, código-fonte, componentes, rotas, estilos, assets textuais e README quando forem necessários. Não reduza um pedido de React, Vue, backend ou aplicação full-stack a uma página HTML estática. Não use placeholders vazios.

Responda SOMENTE com JSON válido neste formato: {"name":"nome curto","description":"descrição","files":[{"path":"caminho/real.ext","content":"conteúdo completo"}]}. Cada item de files deve ser um arquivo real e completo, com caminhos relativos seguros. Para projetos que tenham uma entrada web estática, inclua também index.html para permitir preview imediato; para stacks que exigem build, inclua todos os arquivos necessários para instalação e build. O ZIP deve ser utilizável fora do Andreo.`;
  const result = await invokeLLM({
    messages: [
      { role: "system", content: `${settings.systemPrompt}\n${settings.instructions}\nVocê é o gerador de artefatos web do Andreo. Gere arquivos reais, completos e executáveis.` },
      { role: "user", content: prompt },
    ],
    maxTokens: 16_000,
    model: "gpt-5",
    responseFormat: ARTIFACT_RESPONSE_FORMAT,
  });
  return parseJsonObject(contentToText(result.choices?.[0]?.message?.content));
}


function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] || character);
}

function fallbackSiteDefinition(brief: string) {
  const cleanBrief = brief.replace(/\s+/g, " ").trim();
  const lower = cleanBrief.toLowerCase();
  const subject = cleanBrief.replace(/^(crie|criar|faça|faca|construa|desenvolva|monte)\s+(um|uma)?\s*(site|landing page|website)?\s*(para|de)?\s*/i, "").replace(/[.!?]+$/, "").trim();
  const category = lower.includes("café") || lower.includes("cafeteria") ? "cafeteria" : lower.includes("restaurante") || lower.includes("comida") ? "food" : lower.includes("loja") || lower.includes("produto") ? "store" : lower.includes("saas") || lower.includes("software") || lower.includes("app") ? "saas" : "studio";
  const themes: Record<string, { brand: string; eyebrow: string; headline: string; accent: string }> = {
    cafeteria: { brand: "Aurora Coffee", eyebrow: "CAFÉ ARTESANAL · DESDE 2018", headline: "Pequenos rituais. Grandes dias.", accent: "#d9a56c" },
    food: { brand: "Mesa & Brasa", eyebrow: "COZINHA AUTORAL · RESERVAS ABERTAS", headline: "Sabor que fica na memória.", accent: "#f39a67" },
    store: { brand: "Forma Studio", eyebrow: "OBJETOS COM INTENÇÃO", headline: "Escolhas que transformam espaços.", accent: "#d4ef72" },
    saas: { brand: "Northstar", eyebrow: "A NOVA CAMADA DE PRODUTIVIDADE", headline: "Seu trabalho, finalmente em fluxo.", accent: "#8cb7ff" },
    studio: { brand: "NOVA / STUDIO", eyebrow: "ESTRATÉGIA · DESIGN · TECNOLOGIA", headline: "Ideias que ganham presença.", accent: "#c5a4ff" },
  };
  const theme = themes[category];
  const safeSubject = escapeHtml(subject.slice(0, 180) || cleanBrief.slice(0, 180) || "uma experiência digital memorável");
  const safeBrand = escapeHtml(theme.brand);
  const index = `<!doctype html>
<html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><meta name="description" content="${safeSubject}"><title>${safeBrand} — ${escapeHtml(theme.headline)}</title><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap" rel="stylesheet"><link rel="stylesheet" href="styles.css"></head>
<body><div class="grain"></div><header class="nav"><a class="brand" href="#top">${safeBrand}<i></i></a><nav><a href="#sobre">Sobre</a><a href="#experiencia">Experiência</a><a href="#contato">Contato</a></nav><a class="nav-cta" href="#contato">Começar <span>↗</span></a><button class="menu" aria-label="Abrir menu">☰</button></header><main id="top"><section class="hero"><div class="hero-copy"><p class="eyebrow">${theme.eyebrow}</p><h1>${theme.headline}</h1><p class="intro">${safeSubject.charAt(0).toUpperCase()+safeSubject.slice(1)} — uma presença digital desenhada para ser lembrada.</p><div class="hero-actions"><a class="button" href="#contato">Conheça de perto <span>↗</span></a><a class="text-link" href="#experiencia">Explorar <span>↓</span></a></div></div><div class="hero-art"><div class="orb orb-a"></div><div class="orb orb-b"></div><div class="art-card"><span class="card-kicker">ANDREO SELECT</span><strong>${category === "saas" ? "Built for momentum" : "Feito para o seu momento"}</strong><small>01 / 04</small></div></div></section><section class="marquee"><span>FEITO COM INTENÇÃO</span><i>✦</i><span>DESIGN QUE RESPIRA</span><i>✦</i><span>DETALHES QUE FICAM</span><i>✦</i></section><section id="sobre" class="manifesto"><p class="eyebrow">01 — A IDEIA</p><div><h2>Não é só presença.<br><em>É personalidade.</em></h2><p>Construímos experiências claras, bonitas e vivas — com uma linguagem própria para cada história e cada pessoa que chega até aqui.</p></div></section><section id="experiencia" class="features"><article class="feature feature-large"><span>01</span><h3>Uma primeira impressão que faz sentido.</h3><p>Hierarquia, ritmo e espaço para que a mensagem encontre as pessoas certas.</p><a href="#contato">Ver possibilidades <b>↗</b></a></article><article class="feature feature-dark"><span>02</span><h3>Detalhes que criam conexão.</h3><p>Do primeiro scroll ao último clique, tudo tem intenção.</p><a href="#contato">Conversar agora <b>↗</b></a></article><article class="feature feature-outline"><span>03</span><h3>Pronto para evoluir.</h3><p>Uma base flexível para crescer junto com o seu próximo capítulo.</p><a href="#contato">Começar projeto <b>↗</b></a></article></section><section class="quote"><span>“</span><blockquote>O melhor digital não parece complicado.<br><em>Parece inevitável.</em></blockquote><small>— PRINCÍPIO DO PROJETO</small></section><section id="contato" class="contact"><div><p class="eyebrow">02 — O PRÓXIMO PASSO</p><h2>Vamos fazer algo<br><em>que tenha presença.</em></h2></div><form id="contact-form"><label>Seu melhor e-mail<input required type="email" placeholder="voce@email.com"></label><button class="button" type="submit">Enviar mensagem <span>↗</span></button><small id="form-status"></small></form></section></main><footer><strong>${safeBrand}</strong><span>Feito com Andreo AI · ${new Date().getFullYear()}</span><a href="#top">Voltar ao topo ↑</a></footer><script src="script.js"></script></body></html>`;
  const css = `:root{--accent:${theme.accent};--ink:#171714;--paper:#eee9df;--muted:#77756c;font-family:'DM Sans',sans-serif;color:var(--ink);background:var(--paper)}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;overflow-x:hidden;background:var(--paper)}a{color:inherit;text-decoration:none}.grain{position:fixed;inset:0;pointer-events:none;opacity:.055;z-index:10;background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 180 180' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.7'/%3E%3C/svg%3E)}.nav{max-width:1280px;margin:auto;padding:28px 5vw;display:flex;align-items:center;gap:40px}.brand{font:700 20px 'Space Grotesk';letter-spacing:-.05em;margin-right:auto}.brand i{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--accent);margin-left:5px}nav{display:flex;gap:28px;color:#6d6b63;font-size:14px}.nav-cta{font-weight:700;font-size:14px}.nav-cta span,.button span{font-size:18px}.menu{display:none;border:0;background:none;font-size:22px}.hero{max-width:1280px;margin:5vh auto 0;padding:4vh 5vw 13vh;display:grid;grid-template-columns:1.1fr .9fr;align-items:center;gap:8vw}.eyebrow{font-size:11px;font-weight:700;letter-spacing:.16em;color:#77756c}.hero h1{font:600 clamp(58px,8vw,122px)/.9 'Space Grotesk';letter-spacing:-.08em;max-width:800px;margin:24px 0}.intro{max-width:430px;font-size:18px;line-height:1.55;color:#636158}.hero-actions{display:flex;align-items:center;gap:28px;margin-top:38px}.button{display:inline-flex;align-items:center;gap:22px;border:0;border-radius:999px;background:var(--ink);color:var(--paper);padding:16px 21px;font-weight:700;cursor:pointer}.text-link{font-weight:700;border-bottom:1px solid var(--ink);padding-bottom:5px}.text-link span{margin-left:18px}.hero-art{min-height:470px;position:relative;overflow:hidden;border-radius:220px 220px 18px 18px;background:#c7d2ba;background:linear-gradient(140deg,#d5d5bd,#8a9d88)}.orb{position:absolute;border-radius:50%;filter:blur(1px)}.orb-a{width:310px;height:310px;right:-50px;top:40px;background:var(--accent);mix-blend-mode:multiply}.orb-b{width:220px;height:220px;left:20px;bottom:55px;background:#f0d7b3;mix-blend-mode:multiply}.art-card{position:absolute;left:34px;right:34px;bottom:30px;padding:19px;background:rgba(238,233,223,.86);backdrop-filter:blur(10px);display:grid;gap:8px}.card-kicker{font-size:9px;letter-spacing:.16em;color:#77756c}.art-card strong{font:600 25px 'Space Grotesk';letter-spacing:-.06em}.art-card small{color:#77756c}.marquee{border-block:1px solid #cfcbc0;display:flex;justify-content:space-around;padding:18px 5vw;color:#77756c;font-size:10px;letter-spacing:.18em}.marquee i{color:var(--accent);font-style:normal}.manifesto{max-width:1280px;margin:auto;padding:17vh 5vw;display:grid;grid-template-columns:1fr 2fr;gap:10vw}.manifesto h2,.contact h2{font:600 clamp(42px,6vw,82px)/.95 'Space Grotesk';letter-spacing:-.08em;margin:0}.manifesto em,.contact em,.quote em{color:#77756c;font-style:normal}.manifesto p:not(.eyebrow){max-width:470px;margin:24px 0 0;color:#77756c;font-size:18px;line-height:1.6}.features{max-width:1280px;margin:auto;padding:0 5vw 17vh;display:grid;grid-template-columns:1.25fr .9fr .9fr;gap:15px}.feature{min-height:390px;padding:30px;display:flex;flex-direction:column;border-radius:12px}.feature span{font-size:12px}.feature h3{font:600 clamp(28px,3vw,48px)/1 'Space Grotesk';letter-spacing:-.06em;margin:auto 0 18px;max-width:360px}.feature p{color:#77756c;line-height:1.5;max-width:300px}.feature a{margin-top:30px;font-weight:700}.feature a b{float:right;font-size:19px}.feature-large{background:var(--accent)}.feature-dark{background:#24231f;color:var(--paper)}.feature-dark p{color:#aaa69a}.feature-outline{border:1px solid #cfcbc0}.quote{max-width:1280px;margin:auto;padding:10vh 5vw 18vh;text-align:center}.quote>span{font:100px 'Space Grotesk';line-height:.3;color:var(--accent)}blockquote{font:600 clamp(34px,5vw,68px)/.98 'Space Grotesk';letter-spacing:-.07em;margin:30px auto;max-width:900px}.quote small{font-size:10px;letter-spacing:.16em;color:#77756c}.contact{max-width:1280px;margin:auto;padding:10vh 5vw 15vh;display:grid;grid-template-columns:1.2fr .8fr;gap:8vw;border-top:1px solid #cfcbc0}.contact form{align-self:end;display:grid;gap:16px}.contact label{font-size:12px;color:#77756c;display:grid;gap:9px}.contact input{padding:16px 0;border:0;border-bottom:1px solid #aaa69a;background:transparent;outline:0;font:18px 'DM Sans';color:var(--ink)}.contact input:focus{border-color:var(--ink)}.contact .button{justify-content:center;margin-top:15px}.contact small{color:#657c40}.contact h2{margin-top:20px}footer{max-width:1280px;margin:auto;padding:26px 5vw;border-top:1px solid #cfcbc0;display:flex;justify-content:space-between;color:#77756c;font-size:12px}footer strong{color:var(--ink)}@media(max-width:760px){.nav{padding:20px 6vw}.nav nav,.nav-cta{display:none}.menu{display:block}.hero{display:block;padding:7vh 6vw 12vh}.hero h1{font-size:clamp(53px,15vw,90px)}.hero-art{min-height:370px;margin-top:60px}.marquee{gap:25px;justify-content:flex-start;overflow:hidden;white-space:nowrap}.marquee span:nth-of-type(2),.marquee i:nth-of-type(2){display:none}.manifesto{display:block;padding:13vh 6vw}.manifesto>div{margin-top:35px}.features{display:block;padding:0 6vw 13vh}.feature{min-height:330px;margin:12px 0}.quote{padding:5vh 6vw 13vh}.contact{display:block;padding:9vh 6vw 13vh}.contact form{margin-top:45px}footer{padding:22px 6vw;gap:15px;flex-wrap:wrap}footer span{order:3;width:100%}}`;
  const script = `document.getElementById('contact-form').addEventListener('submit',function(event){event.preventDefault();document.getElementById('form-status').textContent='Mensagem recebida — entraremos em contato em breve.';this.reset();});document.querySelector('.menu')?.addEventListener('click',()=>document.querySelector('nav')?.classList.toggle('open'));`;
  return { name: theme.brand, description: `Site completo para ${safeSubject || "sua ideia"}, com identidade visual, navegação responsiva e interação de contato.`, files: [{ path: "index.html", content: index }, { path: "styles.css", content: css }, { path: "script.js", content: script }] };
}


function fallbackArtifactDefinition(brief: string, kind: "apk" | "exe") {
  const cleanBrief = brief.replace(/\s+/g, " ").trim();
  const safeLabel = cleanBrief.slice(0, 100).replace(/[^a-zA-Z0-9À-ÿ .,!?-]/g, "");
  if (kind === "apk") {
    const javaLabel = safeLabel.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return { name: "Andreo Android App", description: "Aplicativo Android Java pronto para compilação automática.", files: [
      { path: "settings.gradle", content: "pluginManagement { repositories { google(); mavenCentral(); gradlePluginPortal() } }\ndependencyResolutionManagement { repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS); repositories { google(); mavenCentral() } }\nrootProject.name='AndreoApp'\ninclude ':app'\n" },
      { path: "build.gradle", content: "plugins { id 'com.android.application' version '8.7.2' apply false }\n" },
      { path: "gradle.properties", content: "org.gradle.jvmargs=-Xmx2g -Dfile.encoding=UTF-8\nandroid.useAndroidX=true\n" },
      { path: "app/build.gradle", content: "plugins { id 'com.android.application' }\nandroid { namespace 'com.andreo.app'; compileSdk 35\n defaultConfig { applicationId 'com.andreo.app'; minSdk 24; targetSdk 35; versionCode 1; versionName '1.0' }\n}\n" },
      { path: "app/src/main/AndroidManifest.xml", content: "<manifest xmlns:android='http://schemas.android.com/apk/res/android'><application android:theme='@style/AppTheme' android:label='Andreo'><activity android:name='.MainActivity' android:exported='true'><intent-filter><action android:name='android.intent.action.MAIN'/><category android:name='android.intent.category.LAUNCHER'/></intent-filter></activity></application></manifest>" },
      { path: "app/src/main/res/values/styles.xml", content: "<resources><style name='AppTheme' parent='android:style/Theme.Material.Light.NoActionBar'><item name='android:fontFamily'>sans</item></style></resources>" },
      { path: "app/src/main/java/com/andreo/app/MainActivity.java", content: `package com.andreo.app;\nimport android.app.Activity;\nimport android.os.Bundle;\nimport android.widget.TextView;\npublic class MainActivity extends Activity { @Override public void onCreate(Bundle state) { super.onCreate(state); TextView view = new TextView(this); view.setText("${javaLabel}"); view.setTextSize(20); view.setPadding(32,32,32,32); setContentView(view); } }\n` },
      { path: "README.md", content: `# Andreo Android App\n\nPedido: ${cleanBrief}\n\nProjeto Java Android pronto para assembleDebug.\n` },
    ] };
  }
  const packageJson = JSON.stringify({ name: "andreo-desktop-app", version: "1.0.0", main: "main.js", scripts: { "build:win": "electron-builder --win --x64" }, devDependencies: { electron: "^30.0.0", "electron-builder": "^24.13.3" }, build: { appId: "com.andreo.desktop", productName: "Andreo Desktop", files: ["main.js", "index.html"], win: { target: ["portable"] } } }, null, 2);
  return { name: "Andreo Desktop App", description: "Aplicativo Electron pronto para compilação automática no Windows.", files: [
    { path: "package.json", content: packageJson },
    { path: "main.js", content: "const { app, BrowserWindow } = require('electron'); function createWindow(){ const win = new BrowserWindow({width:1200,height:800}); win.loadFile('index.html'); } app.whenReady().then(createWindow); app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});\n" },
    { path: "index.html", content: `<!doctype html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Andreo Desktop</title><style>body{font-family:system-ui;background:#111a13;color:#f5f7f2;display:grid;place-items:center;min-height:100vh;margin:0}main{max-width:720px;padding:48px}h1{font-size:54px;color:#b7f34a}p{font-size:20px;line-height:1.6;color:#b7c5b7}</style></head><body><main><small>ANDREO DESKTOP</small><h1>Seu aplicativo começa aqui.</h1><p>${escapeHtml(cleanBrief)}</p></main></body></html>` },
    { path: "README.md", content: `# Andreo Desktop App\n\nPedido: ${cleanBrief}\n\nProjeto Electron pronto para build: npm install && npm run build:win.\n` },
  ] };
}

async function generateArtifactDefinition(brief: string, kind: "apk" | "exe", settings: Awaited<ReturnType<typeof getAppSettings>>) {
  const target = kind === "apk" ? "Android APK" : "Windows EXE";
  const targetRules = kind === "apk"
    ? "Gere um projeto Android Gradle compilável sem intervenção usando SOMENTE Java (não use Kotlin, .kt ou o plugin org.jetbrains.kotlin.android): inclua gradlew executável, gradlew.bat, settings.gradle, build.gradle, gradle.properties, app/build.gradle, AndroidManifest.xml, uma Activity Java e os recursos necessários. Use um projeto pequeno compatível com Android SDK atual e assembleDebug."
    : "Gere um projeto Electron compilável no Windows: inclua package.json com script build:win e configuração electron-builder, main.js e uma interface renderer.html ou equivalente. O script deve produzir um EXE em dist. Inclua todas as dependências no package.json e não dependa de arquivos fora do ZIP.";
  const prompt = `Crie um projeto completo para gerar um ${target} a partir deste pedido: ${brief}\n\n${targetRules}\n\nResponda SOMENTE com JSON válido neste formato: {"name":"nome curto","description":"descrição","files":[{"path":"README.md","content":"..."},{"path":"arquivo/com/caminho.ext","content":"..."}]}. Inclua arquivos reais, completos e executáveis. Preserve barras nos caminhos. Não entregue apenas uma explicação.`;
  const result = await invokeLLM({
    messages: [
      { role: "system", content: `${settings.systemPrompt}\n${settings.instructions}\nVocê é o gerador de projetos compiláveis do Andreo. Gere arquivos reais e completos.` },
      { role: "user", content: prompt },
    ],
    maxTokens: 16_000,
    model: "gpt-5",
    responseFormat: ARTIFACT_RESPONSE_FORMAT,
  });
  return parseJsonObject(contentToText(result.choices?.[0]?.message?.content));
}

async function enrichMessages(input: ChatMessageInput[]): Promise<Message[]> {
  const result: Message[] = [];
  for (const message of input) {
    if ((message.role !== "user" && message.role !== "assistant") || typeof message.content !== "string") continue;
    if (!message.attachments?.length || message.role !== "user") {
      result.push({ role: message.role, content: message.content });
      continue;
    }
    const parts: Array<Record<string, unknown>> = [{ type: "text", text: message.content }];
    for (const attachment of message.attachments.slice(0, 10)) {
      if (attachment.textContent) {
        parts.push({ type: "text", text: `\n\n[Arquivo ${attachment.name}]\n${attachment.textContent}` });
        continue;
      }
      if (!attachment.key) {
        parts.push({ type: "text", text: `\n[Arquivo anexado: ${attachment.name}]` });
        continue;
      }
      try {
        const signedUrl = await storageGetSignedUrl(attachment.key);
        if (attachment.mimeType.startsWith("image/")) {
          parts.push({ type: "image_url", image_url: { url: signedUrl, detail: "auto" } });
        } else if (["application/pdf", "audio/mpeg", "audio/wav", "audio/mp4", "video/mp4"].includes(attachment.mimeType)) {
          parts.push({ type: "file_url", file_url: { url: signedUrl, mime_type: attachment.mimeType } });
        } else {
          parts.push({ type: "text", text: `\n[Arquivo anexado: ${attachment.name}. O arquivo foi armazenado, mas seu tipo não pode ser lido diretamente pelo modelo.]` });
        }
      } catch {
        parts.push({ type: "text", text: `\n[Arquivo anexado: ${attachment.name}. Não foi possível abrir uma prévia.]` });
      }
    }
    result.push({ role: "user", content: parts as Message["content"] });
  }
  return result;
}

async function generateLongCompletion(system: string, history: Message[]) {
  let combined = "";
  let conversation = history;
  for (let part = 0; part < MAX_CONTINUATION_PARTS && combined.length < MAX_RESPONSE_CHARS; part += 1) {
    const result = await invokeLLM({
      messages: [{ role: "system", content: system }, ...conversation],
      maxTokens: MAX_COMPLETION_TOKENS_PER_PART,
    });
    const piece = contentToText(result.choices?.[0]?.message?.content);
    if (!piece) break;
    combined += piece.slice(0, MAX_RESPONSE_CHARS - combined.length);
    const finishReason = result.choices?.[0]?.finish_reason;
    if (combined.length >= MAX_RESPONSE_CHARS || (finishReason !== "length" && finishReason !== "max_tokens")) break;
    conversation = [
      ...history,
      { role: "assistant", content: combined.slice(-12_000) },
      { role: "user", content: "Continue exatamente do último caractere da resposta anterior. Não repita nada, não resuma e não adicione explicações; entregue apenas a continuação completa." },
    ];
  }
  return combined.slice(0, MAX_RESPONSE_CHARS);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
  app.get("/api/platform/config.js", (_req, res) => {
    res.set("Cache-Control", "no-store").type("application/javascript").send(publicPlatformScript());
  });
  app.get("/manus-routes.json", (_req, res) => {
    res.type("application/json").json({
      routes: [
        { path: "/", title: "Andreo AI" },
        { path: "/andreo-console", title: "Andreo Console" },
      ],
    });
  });

  app.get("/api/settings", async (_req, res) => {
    try {
      res.json(publicSettings(await getAppSettings()));
    } catch (error) {
      console.error("[Settings] public read failed", error);
      res.status(500).json({ error: "Não foi possível carregar as configurações." });
    }
  });

  app.post("/api/admin/login", (req, res) => {
    if (!isAdminPasswordValid(req.body?.password)) {
      res.status(401).json({ error: "Senha incorreta." });
      return;
    }
    res.json({ token: createAdminToken() });
  });

  app.get("/api/admin/settings", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      res.json(await getAppSettings());
    } catch (error) {
      console.error("[Settings] admin read failed", error);
      res.status(500).json({ error: "Não foi possível carregar o painel." });
    }
  });

  app.patch("/api/admin/settings", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const body = req.body ?? {};
      const allowed = ["chatName", "displayName", "icon", "iconImageUrl", "background", "backgroundImageUrl", "brandSubtitle", "welcomeEyebrow", "welcomeMessage", "welcomeDescription", "inputPlaceholder", "toolsSectionLabel", "newSessionLabel", "onlineLabel", "assistantLabel", "userLabel", "processingLabel", "quickPrompt1", "quickPrompt2", "quickPrompt3", "systemPrompt", "instructions"] as const;
      const patch = Object.fromEntries(allowed.filter(key => typeof body[key] === "string").map(key => [key, body[key]]));
      res.json(await updateAppSettings(patch));
    } catch (error) {
      console.error("[Settings] admin update failed", error);
      res.status(500).json({ error: "Não foi possível salvar as configurações." });
    }
  });

  app.post("/api/admin/upload-asset", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const kind = req.body?.kind === "icon" ? "icon" : req.body?.kind === "background" ? "background" : "";
      const dataUrl = typeof req.body?.dataUrl === "string" ? req.body.dataUrl : "";
      const match = dataUrl.match(/^data:(image\/(?:png|jpeg|webp|gif|svg\+xml));base64,([A-Za-z0-9+/=]+)$/);
      if (!kind || !match) {
        res.status(400).json({ error: "Envie uma imagem PNG, JPG, WEBP, GIF ou SVG válida." });
        return;
      }
      const buffer = Buffer.from(match[2], "base64");
      if (buffer.byteLength > 6 * 1024 * 1024) {
        res.status(413).json({ error: "A imagem deve ter no máximo 6 MB." });
        return;
      }
      const extension = match[1].split("/")[1].replace("svg+xml", "svg").replace("jpeg", "jpg");
      const uploaded = await storagePut(`andreo/${kind}.${extension}`, buffer, match[1]);
      res.json({ url: uploaded.url });
    } catch (error) {
      console.error("[Assets] upload failed", error);
      res.status(500).json({ error: "Não foi possível armazenar essa imagem." });
    }
  });

  app.post("/api/chat/upload", async (req, res) => {
    try {
      const dataUrl = typeof req.body?.dataUrl === "string" ? req.body.dataUrl : "";
      const name = safeFileName(typeof req.body?.name === "string" ? req.body.name : "arquivo", "arquivo");
      const match = dataUrl.match(/^data:([^;]+);base64,([A-Za-z0-9+/=]+)$/);
      if (!match) {
        res.status(400).json({ error: "Arquivo inválido." });
        return;
      }
      const buffer = Buffer.from(match[2], "base64");
      if (buffer.byteLength > 20 * 1024 * 1024) {
        res.status(413).json({ error: "Cada arquivo deve ter no máximo 20 MB." });
        return;
      }
      const mimeType = match[1].slice(0, 120);
      const uploaded = await storagePut(`uploads/${Date.now()}-${name}`, buffer, mimeType);
      res.json({ key: uploaded.key, url: uploaded.url, name, mimeType, size: buffer.byteLength });
    } catch (error) {
      console.error("[Chat] file upload failed", error);
      res.status(500).json({ error: "Não foi possível enviar esse arquivo." });
    }
  });

  app.post("/api/chat/generate-image", async (req, res) => {
    try {
      const prompt = typeof req.body?.prompt === "string" ? req.body.prompt.trim().slice(0, 4000) : "";
      if (!prompt) {
        res.status(400).json({ error: "Descreva a imagem que você quer criar." });
        return;
      }
      const result = await generateImage({ prompt, quality: "medium" });
      if (!result.url) {
        res.status(502).json({ error: "O gerador não retornou uma imagem." });
        return;
      }
      res.json({ url: result.url, prompt });
    } catch (error) {
      console.error("[Chat] image generation failed", error);
      res.status(500).json({ error: "Não consegui criar a imagem agora. Tente novamente." });
    }
  });

  app.post("/api/chat/create-site", async (req, res) => {
    try {
      const brief = typeof req.body?.brief === "string" ? req.body.brief.trim() : "";
      if (!brief) {
        res.status(400).json({ error: "Descreva o site que você quer criar." });
        return;
      }
      const settings = await getAppSettings();
      let usedFallback = false;
      let definition: Awaited<ReturnType<typeof generateSiteDefinition>>;
      try {
        definition = await generateSiteDefinition(brief, settings);
      } catch (error) {
        usedFallback = true;
        console.error("[Chat] site AI generator unavailable; using local fallback", error);
        definition = fallbackSiteDefinition(brief);
      }
      const files = (definition.files || [])
        .map(file => ({ path: safeRelativePath(String(file.path || "arquivo.txt").replace(/^\/+/, ""), "arquivo.txt"), content: String(file.content || "") }))
        .filter(file => file.content.trim())
        .slice(0, 40);
      if (!files.length) {
        res.status(502).json({ error: "O gerador não entregou arquivos para este site." });
        return;
      }
      const zipEntries = Object.fromEntries(files.map(file => [file.path, strToU8(file.content)]));
      const zipBuffer = Buffer.from(zipSync(zipEntries, { level: 6 }));
      const slug = safeFileName(String(definition.name || "andreo-site"), "andreo-site").toLowerCase();
      const stamp = Date.now();
      const zip = await storagePut(`sites/${stamp}-${slug}.zip`, zipBuffer, "application/zip");
      const index = files.find(file => file.path.toLowerCase() === "index.html");
      const previewContent = index?.content || `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(String(definition.name || "Projeto Andreo"))}</title><style>body{font-family:system-ui;background:#0b100d;color:#eaf2e8;max-width:760px;margin:10vh auto;padding:24px}code{color:#b7f34a}li{margin:8px 0}</style><h1>${escapeHtml(String(definition.name || "Projeto Andreo"))}</h1><p>Este projeto usa uma stack que precisa ser executada pelo próprio runtime. Baixe o ZIP para rodar o build completo.</p><h2>Arquivos entregues</h2><ul>${files.map(file => `<li><code>${escapeHtml(file.path)}</code></li>`).join("")}</ul>`;
      const preview = await storagePut(`sites/${stamp}-${slug}-preview.html`, previewContent, "text/html; charset=utf-8");
      res.json({ name: definition.name || slug, description: usedFallback ? `${definition.description} O pedido foi preservado no conteúdo-base e você já pode baixar e testar.` : definition.description || "Site gerado pelo Andreo.", files: files.map(file => file.path), zipUrl: zip.url, previewUrl: preview.url, zipName: `${slug}.zip`, fallback: usedFallback });
    } catch (error) {
      console.error("[Chat] site creation failed", error);
      res.status(500).json({ error: "Não consegui gerar o site completo agora. Tente novamente." });
    }
  });

  app.post("/api/chat/create-artifact", async (req, res) => {
    try {
      const kind = req.body?.kind === "apk" ? "apk" : req.body?.kind === "exe" ? "exe" : "";
      const brief = typeof req.body?.brief === "string" ? req.body.brief.trim() : "";
      if (!kind || !brief) {
        res.status(400).json({ error: "Informe se o artefato é APK ou EXE e descreva o que deve ser criado." });
        return;
      }
      const settings = await getAppSettings();
      let usedFallback = false;
      let definition: Awaited<ReturnType<typeof generateArtifactDefinition>>;
      try {
        definition = await generateArtifactDefinition(brief, kind, settings);
      } catch (error) {
        usedFallback = true;
        console.error(`[Chat] ${kind} AI generator unavailable; using compilable base`, error);
        definition = fallbackArtifactDefinition(brief, kind);
      }
      const files = (definition.files || [])
        .map(file => ({ path: safeRelativePath(String(file.path || "arquivo.txt").replace(/^\/+/, ""), "arquivo.txt"), content: String(file.content || "") }))
        .filter(file => file.content.trim())
        .slice(0, 60);
      if (!files.length) {
        res.status(502).json({ error: "O gerador não entregou arquivos para este projeto." });
        return;
      }
      const manifest = JSON.stringify({ name: definition.name || `andreo-${kind}-project`, target: kind === "apk" ? "android" : "windows", generatedBy: "andreo", brief, files: files.map(file => file.path) }, null, 2);
      const zipEntries = Object.fromEntries([...files, { path: "andreo.project.json", content: manifest }].map(file => [file.path, strToU8(file.content)]));
      const slug = safeFileName(String(definition.name || `andreo-${kind}-project`), `andreo-${kind}-project`).toLowerCase();
      const stamp = Date.now();
      const zip = await storagePut(`artifacts/${stamp}-${slug}.zip`, Buffer.from(zipSync(zipEntries, { level: 6 })), "application/zip");
      const origin = typeof req.body?.origin === "string" && /^https?:\/\//i.test(req.body.origin) ? req.body.origin.replace(/\/$/, "") : "";
      const projectUrl = origin ? new URL(zip.url, origin).toString() : "";
      let build: { id: number | null; status: string; conclusion: string | null; html_url: string; workflow: string } | null = null;
      if (projectUrl) {
        build = await dispatchBuild(kind, projectUrl, `${slug}-${kind}`);
      }
      res.json({ name: definition.name || slug, description: usedFallback ? `${definition.description} O pedido original foi incluído no README do projeto.` : definition.description || `Projeto ${kind.toUpperCase()} pronto para compilação.`, zipUrl: zip.url, zipName: `${slug}-${kind}-project.zip`, kind, build, fallback: usedFallback });
    } catch (error) {
      console.error("[Chat] artifact creation failed", error);
      res.status(500).json({ error: "Não consegui gerar o pacote do aplicativo agora. Tente novamente." });
    }
  });

  app.get("/api/chat/build-status/:runId", async (req, res) => {
    try {
      const runId = Number(req.params.runId);
      if (!Number.isSafeInteger(runId) || runId <= 0) {
        res.status(400).json({ error: "Execução inválida." });
        return;
      }
      const runResponse = await githubRequest(`/repos/${GITHUB_REPOSITORY}/actions/runs/${runId}`);
      const run = await runResponse.json() as { id: number; status: string; conclusion: string | null; html_url: string; name?: string };
      const result: { runId: number; status: string; conclusion: string | null; runUrl: string; downloadUrl?: string; fileName?: string } = { runId: run.id, status: run.status, conclusion: run.conclusion, runUrl: run.html_url };
      if (run.status === "completed" && run.conclusion === "success") {
        const artifactsResponse = await githubRequest(`/repos/${GITHUB_REPOSITORY}/actions/runs/${runId}/artifacts`);
        const artifacts = await artifactsResponse.json() as { artifacts?: Array<{ id: number; name: string; expired: boolean }> };
        const artifact = artifacts.artifacts?.find(item => !item.expired);
        if (artifact) {
          result.downloadUrl = `/api/chat/build-artifact/${artifact.id}`;
          result.fileName = artifact.name;
        }
      }
      res.json(result);
    } catch (error) {
      console.error("[Chat] build status failed", error);
      res.status(502).json({ error: "Não consegui consultar o andamento do build." });
    }
  });

  app.get("/api/chat/build-artifact/:artifactId", async (req, res) => {
    try {
      const artifactId = Number(req.params.artifactId);
      if (!Number.isSafeInteger(artifactId) || artifactId <= 0) {
        res.status(400).json({ error: "Artefato inválido." });
        return;
      }
      const response = await githubRequest(`/repos/${GITHUB_REPOSITORY}/actions/artifacts/${artifactId}/zip`, { redirect: "manual" });
      const location = response.headers.get("location");
      if (location) {
        res.redirect(location);
        return;
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="andreo-build-${artifactId}.zip"`);
      res.send(buffer);
    } catch (error) {
      console.error("[Chat] artifact download failed", error);
      res.status(502).json({ error: "Não consegui preparar o download do build." });
    }
  });

  app.post("/api/chat/create-file", async (req, res) => {
    try {
      const content = typeof req.body?.content === "string" ? req.body.content : "";
      const name = safeFileName(typeof req.body?.name === "string" ? req.body.name : "andreo-output.md", "andreo-output.md");
      if (!content.trim()) {
        res.status(400).json({ error: "O arquivo precisa ter conteúdo." });
        return;
      }
      if (Buffer.byteLength(content, "utf8") > 5 * 1024 * 1024) {
        res.status(413).json({ error: "O arquivo gerado deve ter no máximo 5 MB." });
        return;
      }
      const uploaded = await storagePut(`generated/${Date.now()}-${name}`, content, mimeForFile(name));
      res.json({ url: uploaded.url, name, mimeType: mimeForFile(name) });
    } catch (error) {
      console.error("[Chat] file creation failed", error);
      res.status(500).json({ error: "Não consegui preparar o arquivo para download." });
    }
  });

  app.post("/api/chat", async (req, res) => {
    try {
      const input = Array.isArray(req.body?.messages) ? req.body.messages : [];
      const history = await enrichMessages(input as ChatMessageInput[]);

      if (!history.length || history[history.length - 1].role !== "user") {
        res.status(400).json({ error: "Envie uma mensagem para começar." });
        return;
      }

      const settings = await getAppSettings();
      const system = `${settings.systemPrompt}\n\nInstruções operacionais:\n${settings.instructions}\n${CAPABILITY_CONTEXT}`;
      const content = await generateLongCompletion(system, history);
      if (!content) {
        res.status(502).json({ error: "O Andreo não retornou conteúdo. Tente novamente." });
        return;
      }
      res.json({ content });
    } catch (error) {
      console.error("[Chat] request failed", error);
      res.status(500).json({ error: "Não consegui responder agora. Verifique a conexão e tente novamente." });
    }
  });

  registerOAuthRoutes(app);
  app.use("/api/trpc", createExpressMiddleware({ router: appRouter, createContext }));

  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const port = Number(process.env.PORT || "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PORT");
  server.on("error", error => {
    console.error("Server failed:", error.message);
    process.exit(1);
  });
  server.listen(port, "0.0.0.0", () => console.log(`Server listening on port ${port}`));
}

startServer().catch(error => {
  console.error(error);
  process.exit(1);
});
