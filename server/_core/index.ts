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

const CAPABILITY_CONTEXT = `
Capacidades disponíveis no workspace: geração de código, revisão e refatoração, debugging, explicação de APIs, criação de componentes, pesquisa na web, abertura e leitura de URLs, síntese de páginas, comparação de fontes e planejamento técnico. Seja honesto quando uma ação externa não estiver disponível diretamente e ofereça o próximo passo mais útil.
`;

type ChatAttachmentInput = { key: string; name: string; mimeType: string; textContent?: string };
type ChatMessageInput = { role: "user" | "assistant"; content: string; attachments?: ChatAttachmentInput[] };
const MAX_RESPONSE_CHARS = 1_000_000;
const MAX_COMPLETION_TOKENS_PER_PART = 16_000;
const MAX_CONTINUATION_PARTS = 64;
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

function cleanAssistantText(value: string) {
  return value
    .replace(/^\s*\$\$\[\]\$\$\s*/i, "")
    .replace(/^\s*<think>[\s\S]*?<\/think>\s*/i, "")
    .trim();
}

function safeFileName(value: string, fallback: string) {
  const name = value.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100);
  return name || fallback;
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
    const piece = cleanAssistantText(contentToText(result.choices?.[0]?.message?.content));
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
      const system = `Regras permanentes: responda com profissionalismo e respeito. Não incentive invasões, malware, keyloggers, roubo de dados ou outras ações ilícitas. Quando um pedido for inseguro, explique o risco e ofereça uma alternativa legítima.\n\n${CAPABILITY_CONTEXT}\n\nInstruções operacionais adicionais:\n${settings.instructions}\n\nSYSTEM PROMPT PERSONALIZADO DO ADMINISTRADOR — aplique este texto como a identidade, o estilo e o comportamento principal do Andreo:\n${settings.systemPrompt}`;
      const content = await generateLongCompletion(system, history);
      if (!content) {
        res.status(502).json({ error: "O Andreo não retornou conteúdo. Tente novamente." });
        return;
      }
      res.json({ content });
    } catch (error) {
      console.error("[Chat] request failed", error);
      const detail = error instanceof Error ? error.message : String(error);
      if (/\b412\b|usage exhausted|usage_exhausted/i.test(detail)) {
        res.status(503).json({ error: "O serviço de IA atingiu o limite de uso disponível para esta conta. Isso não é uma falha de conexão; é necessário liberar o acesso ao modelo ou conectar um provedor de IA com cota disponível." });
        return;
      }
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
