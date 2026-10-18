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
  if (!response.ok) {
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
  const prompt = `Crie um site completo e funcional para o seguinte pedido: ${brief}\n\nResponda SOMENTE com JSON válido neste formato: {"name":"nome curto","description":"descrição","files":[{"path":"index.html","content":"..."},{"path":"styles.css","content":"..."},{"path":"script.js","content":"..."}]}. Inclua sempre um index.html pronto para abrir no navegador, com CSS e JavaScript funcionais. Não use placeholders vazios. O index.html deve ser autocontido para servir como preview imediato, mesmo que os demais arquivos também sejam incluídos no ZIP.`;
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

async function generateArtifactDefinition(brief: string, kind: "apk" | "exe", settings: Awaited<ReturnType<typeof getAppSettings>>) {
  const target = kind === "apk" ? "Android APK" : "Windows EXE";
  const targetRules = kind === "apk"
    ? "Gere um projeto Android Gradle compilável sem intervenção: inclua gradlew executável, gradlew.bat, settings.gradle, build.gradle, gradle.properties, app/build.gradle, AndroidManifest.xml, uma Activity Java/Kotlin e os recursos necessários. Use um projeto pequeno compatível com Android SDK atual e assembleDebug."
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
      const definition = await generateSiteDefinition(brief, settings);
      const files = (definition.files || [])
        .map(file => ({ path: safeRelativePath(String(file.path || "arquivo.txt").replace(/^\/+/, ""), "arquivo.txt"), content: String(file.content || "") }))
        .filter(file => file.content.trim())
        .slice(0, 40);
      if (!files.some(file => file.path.toLowerCase() === "index.html")) {
        res.status(502).json({ error: "O gerador não entregou um index.html funcional." });
        return;
      }
      const zipEntries = Object.fromEntries(files.map(file => [file.path, strToU8(file.content)]));
      const zipBuffer = Buffer.from(zipSync(zipEntries, { level: 6 }));
      const slug = safeFileName(String(definition.name || "andreo-site"), "andreo-site").toLowerCase();
      const stamp = Date.now();
      const zip = await storagePut(`sites/${stamp}-${slug}.zip`, zipBuffer, "application/zip");
      const index = files.find(file => file.path.toLowerCase() === "index.html")!;
      const preview = await storagePut(`sites/${stamp}-${slug}-preview.html`, index.content, "text/html; charset=utf-8");
      res.json({ name: definition.name || slug, description: definition.description || "Site gerado pelo Andreo.", files: files.map(file => file.path), zipUrl: zip.url, previewUrl: preview.url, zipName: `${slug}.zip` });
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
      const definition = await generateArtifactDefinition(brief, kind, settings);
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
      res.json({ name: definition.name || slug, description: definition.description || `Projeto ${kind.toUpperCase()} pronto para compilação.`, zipUrl: zip.url, zipName: `${slug}-${kind}-project.zip`, kind, build });
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
