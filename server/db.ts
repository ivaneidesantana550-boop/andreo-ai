import { and, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { conversationMessages, conversations, InsertUser, users } from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) throw new Error("Database is not available");

  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};
  const textFields = ["name", "email", "loginMethod"] as const;
  for (const field of textFields) {
    if (user[field] !== undefined) {
      values[field] = user[field] ?? null;
      updateSet[field] = user[field] ?? null;
    }
  }
  if (user.lastSignedIn !== undefined) {
    values.lastSignedIn = user.lastSignedIn;
    updateSet.lastSignedIn = user.lastSignedIn;
  }
  if (user.role !== undefined) {
    values.role = user.role;
    updateSet.role = user.role;
  } else if (user.openId === ENV.ownerOpenId) {
    values.role = 'admin';
    updateSet.role = 'admin';
  }
  if (!values.lastSignedIn) values.lastSignedIn = new Date();
  if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();
  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function listConversations(visitorId: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select({ id: conversations.id, title: conversations.title, createdAt: conversations.createdAt, updatedAt: conversations.updatedAt })
    .from(conversations)
    .where(eq(conversations.visitorId, visitorId))
    .orderBy(desc(conversations.updatedAt))
    .limit(50);
}

export async function getConversationMessages(visitorId: string, conversationId: number) {
  const db = await getDb();
  if (!db) return null;
  const conversation = await db.select({ id: conversations.id, title: conversations.title })
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.visitorId, visitorId)))
    .limit(1);
  if (!conversation[0]) return null;
  const messages = await db.select({ id: conversationMessages.id, role: conversationMessages.role, content: conversationMessages.content, metadata: conversationMessages.metadata, createdAt: conversationMessages.createdAt })
    .from(conversationMessages)
    .where(eq(conversationMessages.conversationId, conversationId))
    .orderBy(conversationMessages.createdAt, conversationMessages.id);
  return { conversation: conversation[0], messages };
}

export async function saveConversationTurn(visitorId: string, conversationId: number | undefined, userContent: string, assistantContent: string, metadata?: string) {
  const db = await getDb();
  if (!db) return null;
  let id = conversationId;
  if (id) {
    const owned = await db.select({ id: conversations.id }).from(conversations).where(and(eq(conversations.id, id), eq(conversations.visitorId, visitorId))).limit(1);
    if (!owned[0]) id = undefined;
  }
  if (!id) {
    const title = userContent.replace(/\s+/g, " ").trim().slice(0, 180) || "Nova conversa";
    const created = await db.insert(conversations).values({ visitorId, title }).$returningId();
    id = created[0]?.id;
  }
  if (!id) return null;
  await db.insert(conversationMessages).values([
    { conversationId: id, role: "user", content: userContent },
    { conversationId: id, role: "assistant", content: assistantContent, metadata: metadata ?? null },
  ]);
  return id;
}
