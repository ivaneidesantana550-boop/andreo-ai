import { int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

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
  systemPrompt: text("systemPrompt").notNull(),
  instructions: text("instructions").notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AppSettings = typeof appSettings.$inferSelect;
export type InsertAppSettings = typeof appSettings.$inferInsert;
