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
  systemPrompt: "Você é Andreo, um assistente de IA técnico, claro e orientado à execução.",
  instructions: "Responda em português quando o usuário escrever em português. Explique decisões, proponha passos concretos e produza código pronto para ser usado. Quando a solicitação envolver web, ajude a pesquisar, estruturar e revisar informações sem inventar fontes.",
} as const;

type EditableSetting = "chatName" | "displayName" | "icon" | "iconImageUrl" | "background" | "backgroundImageUrl" | "systemPrompt" | "instructions";
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
