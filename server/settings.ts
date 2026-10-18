import { createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { appSettings, type AppSettings } from "../drizzle/schema";
import { getDb } from "./db";
import { ENV } from "./_core/env";

export const DEFAULT_SETTINGS = {
  id: 1,
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
  systemPrompt: "Você é Andreo, um assistente de IA técnico, claro e orientado à execução.",
  instructions: "Responda em português quando o usuário escrever em português. Explique decisões, proponha passos concretos e produza código pronto para ser usado. Quando a solicitação envolver web, ajude a pesquisar, estruturar e revisar informações sem inventar fontes.",
} as const;

type EditableSetting = "chatName" | "displayName" | "icon" | "iconImageUrl" | "background" | "backgroundImageUrl" | "brandSubtitle" | "welcomeEyebrow" | "welcomeMessage" | "welcomeDescription" | "inputPlaceholder" | "toolsSectionLabel" | "newSessionLabel" | "onlineLabel" | "assistantLabel" | "userLabel" | "processingLabel" | "quickPrompt1" | "quickPrompt2" | "quickPrompt3" | "systemPrompt" | "instructions";
type SettingsPatch = Partial<Record<EditableSetting, string>>;

let memorySettings: AppSettings = { ...DEFAULT_SETTINGS, updatedAt: new Date() };

function normalizeSettings(values: SettingsPatch) {
  return {
    chatName: String(values.chatName ?? DEFAULT_SETTINGS.chatName).trim().slice(0, 80) || DEFAULT_SETTINGS.chatName,
    displayName: String(values.displayName ?? DEFAULT_SETTINGS.displayName).trim().slice(0, 120) || DEFAULT_SETTINGS.displayName,
    icon: String(values.icon ?? DEFAULT_SETTINGS.icon).trim().slice(0, 24) || DEFAULT_SETTINGS.icon,
    iconImageUrl: String(values.iconImageUrl ?? DEFAULT_SETTINGS.iconImageUrl).trim().slice(0, 512),
    background: String(values.background ?? DEFAULT_SETTINGS.background).trim().slice(0, 5000) || DEFAULT_SETTINGS.background,
    backgroundImageUrl: String(values.backgroundImageUrl ?? DEFAULT_SETTINGS.backgroundImageUrl).trim().slice(0, 512),
    brandSubtitle: String(values.brandSubtitle ?? DEFAULT_SETTINGS.brandSubtitle).trim().slice(0, 80) || DEFAULT_SETTINGS.brandSubtitle,
    welcomeEyebrow: String(values.welcomeEyebrow ?? DEFAULT_SETTINGS.welcomeEyebrow).trim().slice(0, 120) || DEFAULT_SETTINGS.welcomeEyebrow,
    welcomeMessage: String(values.welcomeMessage ?? DEFAULT_SETTINGS.welcomeMessage).trim().slice(0, 20000) || DEFAULT_SETTINGS.welcomeMessage,
    welcomeDescription: String(values.welcomeDescription ?? DEFAULT_SETTINGS.welcomeDescription).trim().slice(0, 240) || DEFAULT_SETTINGS.welcomeDescription,
    inputPlaceholder: String(values.inputPlaceholder ?? DEFAULT_SETTINGS.inputPlaceholder).trim().slice(0, 180) || DEFAULT_SETTINGS.inputPlaceholder,
    toolsSectionLabel: String(values.toolsSectionLabel ?? DEFAULT_SETTINGS.toolsSectionLabel).trim().slice(0, 100) || DEFAULT_SETTINGS.toolsSectionLabel,
    newSessionLabel: String(values.newSessionLabel ?? DEFAULT_SETTINGS.newSessionLabel).trim().slice(0, 80) || DEFAULT_SETTINGS.newSessionLabel,
    onlineLabel: String(values.onlineLabel ?? DEFAULT_SETTINGS.onlineLabel).trim().slice(0, 40) || DEFAULT_SETTINGS.onlineLabel,
    assistantLabel: String(values.assistantLabel ?? DEFAULT_SETTINGS.assistantLabel).trim().slice(0, 40) || DEFAULT_SETTINGS.assistantLabel,
    userLabel: String(values.userLabel ?? DEFAULT_SETTINGS.userLabel).trim().slice(0, 40) || DEFAULT_SETTINGS.userLabel,
    processingLabel: String(values.processingLabel ?? DEFAULT_SETTINGS.processingLabel).trim().slice(0, 40) || DEFAULT_SETTINGS.processingLabel,
    quickPrompt1: String(values.quickPrompt1 ?? DEFAULT_SETTINGS.quickPrompt1).trim().slice(0, 180) || DEFAULT_SETTINGS.quickPrompt1,
    quickPrompt2: String(values.quickPrompt2 ?? DEFAULT_SETTINGS.quickPrompt2).trim().slice(0, 180) || DEFAULT_SETTINGS.quickPrompt2,
    quickPrompt3: String(values.quickPrompt3 ?? DEFAULT_SETTINGS.quickPrompt3).trim().slice(0, 180) || DEFAULT_SETTINGS.quickPrompt3,
    systemPrompt: String(values.systemPrompt ?? DEFAULT_SETTINGS.systemPrompt).trim().slice(0, 12000) || DEFAULT_SETTINGS.systemPrompt,
    instructions: String(values.instructions ?? DEFAULT_SETTINGS.instructions).trim().slice(0, 12000) || DEFAULT_SETTINGS.instructions,
  };
}

export async function getAppSettings(): Promise<AppSettings> {
  const db = await getDb();
  if (!db) return memorySettings;

  const rows = await db.select().from(appSettings).where(eq(appSettings.id, 1)).limit(1);
  if (rows[0]) {
    memorySettings = rows[0];
    return rows[0];
  }

  const initial = { id: 1, ...normalizeSettings(DEFAULT_SETTINGS) };
  await db.insert(appSettings).values(initial);
  const created = { ...initial, updatedAt: new Date() } as AppSettings;
  memorySettings = created;
  return created;
}

export async function updateAppSettings(patch: SettingsPatch): Promise<AppSettings> {
  const current = await getAppSettings();
  const next = normalizeSettings({ ...current, ...patch });
  const db = await getDb();

  if (!db) {
    memorySettings = { ...current, ...next, updatedAt: new Date() };
    return memorySettings;
  }

  await db.update(appSettings).set({ ...next, updatedAt: new Date() }).where(eq(appSettings.id, 1));
  const saved = { ...current, ...next, updatedAt: new Date() } as AppSettings;
  memorySettings = saved;
  return saved;
}

const ADMIN_PASSWORD = "251831";
const TOKEN_TTL_MS = 8 * 60 * 60 * 1000;

function secret() {
  return ENV.cookieSecret || "andreo-admin-secret";
}

export function createAdminToken() {
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  const payload = String(expiresAt);
  const signature = createHmac("sha256", secret()).update(payload).digest("hex");
  return `${payload}.${signature}`;
}

export function isAdminPasswordValid(password: unknown) {
  return typeof password === "string" && password === ADMIN_PASSWORD;
}

export function isAdminTokenValid(token: unknown) {
  if (typeof token !== "string") return false;
  const [expiresAt, signature] = token.split(".");
  if (!expiresAt || !signature || Number(expiresAt) < Date.now()) return false;
  const expected = createHmac("sha256", secret()).update(expiresAt).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}
