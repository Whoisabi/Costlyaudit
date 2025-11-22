import { sql } from 'drizzle-orm';
import {
  index,
  jsonb,
  pgTable,
  timestamp,
  varchar,
  text,
  integer,
  boolean,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Session storage table (mandatory for Replit Auth)
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// User storage table (mandatory for Replit Auth)
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;

// AWS Accounts table for storing user's AWS credentials
export const awsAccounts = pgTable("aws_accounts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  nickname: varchar("nickname", { length: 255 }).notNull(),
  accessKeyId: varchar("access_key_id", { length: 255 }).notNull(),
  secretAccessKey: text("secret_access_key").notNull(), // encrypted
  region: varchar("region", { length: 50 }).notNull().default('us-east-1'),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertAwsAccountSchema = createInsertSchema(awsAccounts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertAwsAccount = z.infer<typeof insertAwsAccountSchema>;
export type AwsAccount = typeof awsAccounts.$inferSelect;

// Benchmark results table
export const benchmarkResults = pgTable("benchmark_results", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  awsAccountId: varchar("aws_account_id").notNull().references(() => awsAccounts.id, { onDelete: "cascade" }),
  benchmarkId: varchar("benchmark_id", { length: 255 }).notNull(),
  benchmarkName: varchar("benchmark_name", { length: 255 }).notNull(),
  controlsPassed: integer("controls_passed").notNull().default(0),
  controlsFailed: integer("controls_failed").notNull().default(0),
  estimatedSavings: integer("estimated_savings").notNull().default(0), // in cents
  resultJson: jsonb("result_json"),
  executedAt: timestamp("executed_at").defaultNow(),
});

export type BenchmarkResult = typeof benchmarkResults.$inferSelect;

// Control results table - stores individual resource checks from benchmarks
export const controlResults = pgTable("control_results", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  benchmarkResultId: varchar("benchmark_result_id").notNull().references(() => benchmarkResults.id, { onDelete: "cascade" }),
  awsAccountId: varchar("aws_account_id").notNull().references(() => awsAccounts.id, { onDelete: "cascade" }),
  controlId: varchar("control_id", { length: 255 }).notNull(),
  controlName: text("control_name").notNull(),
  resourceId: varchar("resource_id", { length: 255 }), // AWS resource ID (instance-id, bucket name, etc.)
  resourceType: varchar("resource_type", { length: 100 }), // EC2, S3, RDS, etc.
  passed: boolean("passed").notNull().default(false),
  reason: text("reason"), // Why this check failed/passed
  estimatedSavings: integer("estimated_savings").notNull().default(0), // in cents
  executedAt: timestamp("executed_at").defaultNow(),
});

export type ControlResult = typeof controlResults.$inferSelect;

// Query history table
export const queryHistory = pgTable("query_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  awsAccountId: varchar("aws_account_id").references(() => awsAccounts.id, { onDelete: "set null" }),
  query: text("query").notNull(),
  resultJson: jsonb("result_json"),
  executedAt: timestamp("executed_at").defaultNow(),
});

export type QueryHistory = typeof queryHistory.$inferSelect;

// AWS Cost Explorer types
export const monthlyCostSchema = z.object({
  amount: z.number(), // in cents
  startDate: z.string(),
  endDate: z.string(),
});

export const serviceCostSchema = z.object({
  service: z.string(),
  amount: z.number(), // in cents
});

export const costSummarySchema = z.object({
  currentMonth: monthlyCostSchema,
  previousMonth: monthlyCostSchema,
  percentageChange: z.number(),
  costDifference: z.number(), // in cents
  topServices: z.array(serviceCostSchema),
});

export type MonthlyCost = z.infer<typeof monthlyCostSchema>;
export type ServiceCost = z.infer<typeof serviceCostSchema>;
export type CostSummary = z.infer<typeof costSummarySchema>;
