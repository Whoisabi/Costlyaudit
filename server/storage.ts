import {
  users,
  awsAccounts,
  benchmarkResults,
  controlResults,
  queryHistory,
  type User,
  type UpsertUser,
  type AwsAccount,
  type InsertAwsAccount,
  type BenchmarkResult,
  type ControlResult,
  type QueryHistory,
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, and } from "drizzle-orm";
import { randomBytes, createCipheriv, createDecipheriv } from "crypto";

// Encryption for AWS credentials
const ALGORITHM = "aes-256-cbc";
const ENCRYPTION_KEY = process.env.SESSION_SECRET 
  ? Buffer.from(process.env.SESSION_SECRET.padEnd(32, '0').slice(0, 32))
  : Buffer.alloc(32);

function encrypt(text: string): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  return `${iv.toString("hex")}:${encrypted}`;
}

function decrypt(text: string): string {
  const [ivHex, encryptedHex] = text.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const decipher = createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
  let decrypted = decipher.update(encryptedHex, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

// Type for AWS account without decrypted secret
export type AwsAccountDisplay = Omit<AwsAccount, 'secretAccessKey'> & {
  secretAccessKey: string; // Will be "***ENCRYPTED***"
};

// Type for individual resource check from AWS service
export interface ResourceCheck {
  id: string;
  name: string;
  passed: boolean;
  resourceId?: string;
  estimatedSavings: number;
  reason?: string;
}

export interface IStorage {
  // User operations
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(userData: { email: string; password: string; firstName?: string; lastName?: string }): Promise<User>;
  upsertUser(user: UpsertUser): Promise<User>;

  // AWS Account operations (internal - with decrypted secrets for backend use)
  getAwsAccounts(userId: string): Promise<AwsAccount[]>;
  getAwsAccount(id: string): Promise<AwsAccount | undefined>;
  createAwsAccount(account: InsertAwsAccount): Promise<AwsAccount>;
  deleteAwsAccount(id: string, userId: string): Promise<boolean>;
  
  // AWS Account operations (for API responses - secrets masked)
  getAwsAccountsForDisplay(userId: string): Promise<AwsAccountDisplay[]>;
  createAwsAccountForDisplay(account: InsertAwsAccount): Promise<AwsAccountDisplay>;

  // Benchmark operations
  saveBenchmarkResult(
    result: Omit<BenchmarkResult, "id" | "executedAt">, 
    checks: ResourceCheck[]
  ): Promise<BenchmarkResult>;
  getBenchmarkResults(awsAccountId: string): Promise<BenchmarkResult[]>;

  // Control operations
  saveControlResult(result: Omit<ControlResult, "id" | "executedAt">): Promise<ControlResult>;
  getControlResults(awsAccountId: string): Promise<ControlResult[]>;
  getControlResultsByBenchmark(benchmarkResultId: string): Promise<ControlResult[]>;

  // Query history operations
  saveQuery(userId: string, awsAccountId: string | null, query: string, resultJson: any): Promise<QueryHistory>;
  getQueryHistory(userId: string): Promise<QueryHistory[]>;
}

export class DatabaseStorage implements IStorage {
  // User operations
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async createUser(userData: { email: string; password: string; firstName?: string; lastName?: string }): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(userData)
      .returning();
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(userData)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          ...userData,
          updatedAt: new Date(),
        },
      })
      .returning();
    return user;
  }

  // AWS Account operations
  async getAwsAccounts(userId: string): Promise<AwsAccount[]> {
    const accounts = await db
      .select()
      .from(awsAccounts)
      .where(eq(awsAccounts.userId, userId))
      .orderBy(desc(awsAccounts.createdAt));

    // Decrypt secret access keys before returning
    return accounts.map(account => ({
      ...account,
      secretAccessKey: decrypt(account.secretAccessKey),
    }));
  }

  async getAwsAccount(id: string): Promise<AwsAccount | undefined> {
    const [account] = await db
      .select()
      .from(awsAccounts)
      .where(eq(awsAccounts.id, id));

    if (!account) return undefined;

    return {
      ...account,
      secretAccessKey: decrypt(account.secretAccessKey),
    };
  }

  async createAwsAccount(accountData: InsertAwsAccount): Promise<AwsAccount> {
    const [account] = await db
      .insert(awsAccounts)
      .values({
        ...accountData,
        secretAccessKey: encrypt(accountData.secretAccessKey),
      })
      .returning();

    return {
      ...account,
      secretAccessKey: decrypt(account.secretAccessKey),
    };
  }

  async deleteAwsAccount(id: string, userId: string): Promise<boolean> {
    const result = await db
      .delete(awsAccounts)
      .where(
        and(
          eq(awsAccounts.id, id),
          eq(awsAccounts.userId, userId)
        )
      )
      .returning();
    
    return result.length > 0;
  }

  // AWS Account operations for display (secrets masked)
  async getAwsAccountsForDisplay(userId: string): Promise<AwsAccountDisplay[]> {
    const accounts = await db
      .select()
      .from(awsAccounts)
      .where(eq(awsAccounts.userId, userId))
      .orderBy(desc(awsAccounts.createdAt));

    // Return without decrypting - just mask the encrypted value
    return accounts.map(account => ({
      ...account,
      secretAccessKey: "***ENCRYPTED***",
    }));
  }

  async createAwsAccountForDisplay(accountData: InsertAwsAccount): Promise<AwsAccountDisplay> {
    const [account] = await db
      .insert(awsAccounts)
      .values({
        ...accountData,
        secretAccessKey: encrypt(accountData.secretAccessKey),
      })
      .returning();

    return {
      ...account,
      secretAccessKey: "***ENCRYPTED***",
    };
  }

  // Benchmark operations
  async saveBenchmarkResult(
    result: Omit<BenchmarkResult, "id" | "executedAt">,
    checks: ResourceCheck[]
  ): Promise<BenchmarkResult> {
    const [saved] = await db
      .insert(benchmarkResults)
      .values(result)
      .returning();
    
    // Save individual resource checks as control results
    if (checks.length > 0) {
      const controlResultsToInsert = checks.map(check => ({
        benchmarkResultId: saved.id,
        awsAccountId: result.awsAccountId,
        controlId: check.id,
        controlName: check.name,
        resourceId: check.resourceId || null,
        resourceType: result.benchmarkId.toUpperCase(),
        passed: check.passed,
        reason: check.reason,
        estimatedSavings: check.estimatedSavings,
      }));
      
      await db.insert(controlResults).values(controlResultsToInsert);
    }
    
    return saved;
  }

  async getBenchmarkResults(awsAccountId: string): Promise<BenchmarkResult[]> {
    return await db
      .select()
      .from(benchmarkResults)
      .where(eq(benchmarkResults.awsAccountId, awsAccountId))
      .orderBy(desc(benchmarkResults.executedAt));
  }

  // Control operations
  async saveControlResult(result: Omit<ControlResult, "id" | "executedAt">): Promise<ControlResult> {
    const [saved] = await db
      .insert(controlResults)
      .values(result)
      .returning();
    return saved;
  }

  async getControlResults(awsAccountId: string): Promise<ControlResult[]> {
    return await db
      .select()
      .from(controlResults)
      .where(eq(controlResults.awsAccountId, awsAccountId))
      .orderBy(desc(controlResults.executedAt));
  }

  async getControlResultsByBenchmark(benchmarkResultId: string): Promise<ControlResult[]> {
    return await db
      .select()
      .from(controlResults)
      .where(eq(controlResults.benchmarkResultId, benchmarkResultId))
      .orderBy(desc(controlResults.executedAt));
  }

  // Query history operations
  async saveQuery(userId: string, awsAccountId: string | null, query: string, resultJson: any): Promise<QueryHistory> {
    const [saved] = await db
      .insert(queryHistory)
      .values({
        userId,
        awsAccountId,
        query,
        resultJson,
      })
      .returning();
    return saved;
  }

  async getQueryHistory(userId: string): Promise<QueryHistory[]> {
    return await db
      .select()
      .from(queryHistory)
      .where(eq(queryHistory.userId, userId))
      .orderBy(desc(queryHistory.executedAt))
      .limit(50);
  }
}

export const storage = new DatabaseStorage();
