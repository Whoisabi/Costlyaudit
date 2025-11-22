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

// Session storage table for user authentication
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// User storage table with email/password authentication
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email", { length: 255 }).notNull().unique(),
  password: text("password").notNull(), // hashed with bcrypt
  firstName: varchar("first_name", { length: 255 }),
  lastName: varchar("last_name", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const signupSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  firstName: z.string().min(1, "First name is required").optional(),
  lastName: z.string().min(1, "Last name is required").optional(),
});

export const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type User = typeof users.$inferSelect;
export type UserWithoutPassword = Omit<User, 'password'>;

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

// Extended service breakdown with full details
export const serviceBreakdownSchema = z.object({
  serviceCode: z.string(), // e.g., "AmazonEC2"
  serviceName: z.string(), // e.g., "Amazon Elastic Compute Cloud"
  amount: z.number(), // in cents
  region: z.string().optional(), // Primary region (if applicable)
  resourceCount: z.number().optional(), // Number of resources
});

export type ServiceBreakdown = z.infer<typeof serviceBreakdownSchema>;

// Resource cost details for drill-down
export const resourceCostDetailSchema = z.object({
  resourceId: z.string(), // AWS resource ID (e.g., i-1234567890abcdef0)
  resourceName: z.string().optional(), // Name tag or identifier
  resourceType: z.string(), // e.g., "EC2 Instance", "RDS Database"
  region: z.string(), // AWS region
  usageType: z.string(), // e.g., "BoxUsage:t2.micro"
  amount: z.number(), // in cents
  tags: z.record(z.string()).optional(), // Resource tags
});

export type ResourceCostDetail = z.infer<typeof resourceCostDetailSchema>;

// Service resources response (grouped by region)
export const serviceResourcesSchema = z.object({
  serviceCode: z.string(),
  serviceName: z.string(),
  totalAmount: z.number(), // in cents
  byRegion: z.array(z.object({
    region: z.string(),
    amount: z.number(), // in cents
    resources: z.array(resourceCostDetailSchema),
  })),
});

export type ServiceResources = z.infer<typeof serviceResourcesSchema>;

// AWS Recommendations types
export const reservedInstanceRecommendationSchema = z.object({
  serviceCode: z.string(), // e.g., "AmazonEC2"
  instanceType: z.string(), // e.g., "t3.medium"
  region: z.string(),
  paymentOption: z.string(), // e.g., "NO_UPFRONT", "PARTIAL_UPFRONT", "ALL_UPFRONT"
  term: z.string(), // e.g., "ONE_YEAR", "THREE_YEARS"
  estimatedMonthlySavings: z.number(), // in cents
  estimatedSavingsPercentage: z.number(),
  upfrontCost: z.number(), // in cents
  recommendedQuantity: z.number(),
});

export type ReservedInstanceRecommendation = z.infer<typeof reservedInstanceRecommendationSchema>;

export const savingsPlanRecommendationSchema = z.object({
  planType: z.string(), // "COMPUTE_SP" or "EC2_INSTANCE_SP"
  paymentOption: z.string(),
  term: z.string(),
  hourlyCommitment: z.number(), // in cents per hour
  estimatedMonthlySavings: z.number(), // in cents
  estimatedSavingsPercentage: z.number(),
  upfrontCost: z.number(), // in cents
});

export type SavingsPlanRecommendation = z.infer<typeof savingsPlanRecommendationSchema>;

export const rightsizingRecommendationSchema = z.object({
  resourceId: z.string(),
  resourceName: z.string().optional(),
  currentInstanceType: z.string(),
  recommendedInstanceType: z.string(),
  region: z.string(),
  estimatedMonthlySavings: z.number(), // in cents
  estimatedSavingsPercentage: z.number(),
  reason: z.string(), // Explanation for the recommendation
  cpuUtilization: z.number().optional(), // Average CPU utilization percentage
  memoryUtilization: z.number().optional(),
});

export type RightsizingRecommendation = z.infer<typeof rightsizingRecommendationSchema>;

// Combined recommendations response
export const costRecommendationsSchema = z.object({
  reservedInstances: z.array(reservedInstanceRecommendationSchema),
  savingsPlans: z.array(savingsPlanRecommendationSchema),
  rightsizing: z.array(rightsizingRecommendationSchema),
  totalEstimatedMonthlySavings: z.number(), // in cents
});

export type CostRecommendations = z.infer<typeof costRecommendationsSchema>;
