import { int, longtext, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const appSettings = mysqlTable("appSettings", {
  id: int("id").primaryKey().default(1),
  chatName: varchar("chatName", { length: 80 }).notNull().default("Andreo"),
  displayName: varchar("displayName", { length: 120 }).notNull().default("Andreo AI"),
  icon: varchar("icon", { length: 24 }).notNull().default("A"),
  iconImageUrl: varchar("iconImageUrl", { length: 512 }).notNull().default(""),
  background: text("background").notNull(),
  backgroundImageUrl: varchar("backgroundImageUrl", { length: 512 }).notNull().default(""),
  brandSubtitle: varchar("brandSubtitle", { length: 80 }).notNull().default("AI / WORKSPACE"),
  welcomeEyebrow: varchar("welcomeEyebrow", { length: 120 }).notNull().default("INTELIGÊNCIA OPERACIONAL"),
  welcomeMessage: text("welcomeMessage").notNull(),
  welcomeDescription: varchar("welcomeDescription", { length: 240 }).notNull().default("Transforme intenção em entregas concretas."),
  inputPlaceholder: varchar("inputPlaceholder", { length: 180 }).notNull().default("Descreva o que você quer construir..."),
  toolsSectionLabel: varchar("toolsSectionLabel", { length: 100 }).notNull().default("Ferramentas do workspace"),
  newSessionLabel: varchar("newSessionLabel", { length: 80 }).notNull().default("Nova sessão"),
  onlineLabel: varchar("onlineLabel", { length: 40 }).notNull().default("ONLINE"),
  assistantLabel: varchar("assistantLabel", { length: 40 }).notNull().default("ASSISTANT"),
  userLabel: varchar("userLabel", { length: 40 }).notNull().default("Você"),
  processingLabel: varchar("processingLabel", { length: 40 }).notNull().default("PROCESSANDO"),
  quickPrompt1: varchar("quickPrompt1", { length: 180 }).notNull().default("Crie um componente React responsivo"),
  quickPrompt2: varchar("quickPrompt2", { length: 180 }).notNull().default("Explique este erro de TypeScript"),
  quickPrompt3: varchar("quickPrompt3", { length: 180 }).notNull().default("Pesquise tendências de design para SaaS"),
  systemPrompt: text("systemPrompt").notNull(),
  instructions: text("instructions").notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const conversations = mysqlTable("conversations", {
  id: int("id").autoincrement().primaryKey(),
  visitorId: varchar("visitorId", { length: 128 }).notNull(),
  title: varchar("title", { length: 180 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const conversationMessages = mysqlTable("conversationMessages", {
  id: int("id").autoincrement().primaryKey(),
  conversationId: int("conversationId").notNull(),
  role: mysqlEnum("role", ["user", "assistant"]).notNull(),
  content: longtext("content").notNull(),
  metadata: text("metadata"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type AppSettings = typeof appSettings.$inferSelect;
export type InsertAppSettings = typeof appSettings.$inferInsert;
export type Conversation = typeof conversations.$inferSelect;
export type ConversationMessage = typeof conversationMessages.$inferSelect;
