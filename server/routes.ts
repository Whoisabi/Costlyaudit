import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth, isAuthenticated } from "./replitAuth";
import { insertAwsAccountSchema, costSummarySchema, type CostSummary } from "@shared/schema";
import { z } from "zod";
import { AwsService } from "./aws-service";

// Simple in-memory cache for cost data (to avoid excessive Cost Explorer API calls)
interface CostCache {
  data: CostSummary;
  timestamp: number;
  userId: string;
  includeCredits: boolean;
}

const costCache: Map<string, CostCache> = new Map();
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours in milliseconds

function getCachedCost(userId: string, accountId: string, includeCredits: boolean): CostSummary | null {
  const cacheKey = `${userId}-${accountId}-${includeCredits}`;
  const cached = costCache.get(cacheKey);
  
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  
  // Remove expired cache
  if (cached) {
    costCache.delete(cacheKey);
  }
  
  return null;
}

function setCachedCost(userId: string, accountId: string, includeCredits: boolean, data: CostSummary): void {
  const cacheKey = `${userId}-${accountId}-${includeCredits}`;
  costCache.set(cacheKey, {
    data,
    timestamp: Date.now(),
    userId,
    includeCredits,
  });
}

function invalidateCostCache(userId: string, accountId: string): void {
  const keys = Array.from(costCache.keys());
  keys.forEach(key => {
    if (key.startsWith(`${userId}-${accountId}-`)) {
      costCache.delete(key);
    }
  });
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Auth middleware
  await setupAuth(app);

  // Auth routes
  app.get('/api/auth/user', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);
      res.json(user);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // AWS Accounts routes
  app.get("/api/aws-accounts", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const accounts = await storage.getAwsAccountsForDisplay(userId);
      res.json(accounts);
    } catch (error) {
      console.error("Error fetching AWS accounts:", error);
      res.status(500).json({ message: "Failed to fetch AWS accounts" });
    }
  });

  app.post("/api/aws-accounts", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const accountData = insertAwsAccountSchema.parse({
        ...req.body,
        userId,
      });
      
      const account = await storage.createAwsAccountForDisplay(accountData);
      
      // Invalidate cost cache when new account is added
      invalidateCostCache(userId, account.id);
      
      res.json(account);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid input", errors: error.errors });
        return;
      }
      console.error("Error creating AWS account:", error);
      res.status(500).json({ message: "Failed to create AWS account" });
    }
  });

  app.delete("/api/aws-accounts/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const deleted = await storage.deleteAwsAccount(req.params.id, userId);
      
      if (!deleted) {
        res.status(404).json({ message: "AWS account not found or access denied" });
        return;
      }
      
      // Invalidate cost cache for this account
      invalidateCostCache(userId, req.params.id);
      
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting AWS account:", error);
      res.status(500).json({ message: "Failed to delete AWS account" });
    }
  });

  // Dashboard stats route
  app.get("/api/dashboard/stats", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const accounts = await storage.getAwsAccounts(userId);
      
      if (accounts.length === 0) {
        res.json({
          totalSavings: 0,
          highRiskResources: 0,
          failedControls: 0,
          passedControls: 0,
          savingsByService: [],
          controlsByBenchmark: [],
        });
        return;
      }

      // Aggregate data from all accounts
      let totalSavings = 0;
      let totalFailedControls = 0;
      let totalPassedControls = 0;
      const savingsByService: Record<string, number> = {};

      for (const account of accounts) {
        const benchmarks = await storage.getBenchmarkResults(account.id);
        for (const benchmark of benchmarks) {
          totalSavings += benchmark.estimatedSavings;
          totalFailedControls += benchmark.controlsFailed;
          totalPassedControls += benchmark.controlsPassed;
          
          savingsByService[benchmark.benchmarkName] = 
            (savingsByService[benchmark.benchmarkName] || 0) + benchmark.estimatedSavings;
        }
      }

      const savingsByServiceArray = Object.entries(savingsByService).map(([service, savings]) => ({
        service,
        savings,
      }));

      res.json({
        totalSavings,
        highRiskResources: totalFailedControls,
        failedControls: totalFailedControls,
        passedControls: totalPassedControls,
        savingsByService: savingsByServiceArray,
        controlsByBenchmark: [],
      });
    } catch (error) {
      console.error("Error fetching dashboard stats:", error);
      res.status(500).json({ message: "Failed to fetch dashboard stats" });
    }
  });

  // Benchmarks routes
  app.get("/api/benchmarks/results", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const accounts = await storage.getAwsAccounts(userId);
      
      let allResults: any[] = [];
      for (const account of accounts) {
        const results = await storage.getBenchmarkResults(account.id);
        allResults = [...allResults, ...results];
      }
      
      res.json(allResults);
    } catch (error) {
      console.error("Error fetching benchmark results:", error);
      res.status(500).json({ message: "Failed to fetch benchmark results" });
    }
  });

  app.post("/api/benchmarks/run", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { benchmarkId } = req.body;
      
      // Validate benchmarkId
      const validBenchmarks = ['ec2', 'rds', 's3', 'dynamodb', 'elasticache', 'redshift', 'lambda'];
      if (!benchmarkId || !validBenchmarks.includes(benchmarkId)) {
        res.status(400).json({ 
          message: "Invalid benchmark ID", 
          validBenchmarks 
        });
        return;
      }
      
      const accounts = await storage.getAwsAccounts(userId);
      if (accounts.length === 0) {
        res.status(400).json({ message: "No AWS accounts connected. Please add an AWS account first." });
        return;
      }

      const account = accounts[0];
      
      // Validate credentials exist
      if (!account.accessKeyId || !account.secretAccessKey) {
        res.status(400).json({ message: "AWS credentials are missing or invalid" });
        return;
      }
      
      // Use real AWS scanning with decrypted credentials
      const awsService = new AwsService({
        accessKeyId: account.accessKeyId,
        secretAccessKey: account.secretAccessKey,
        region: account.region,
      });

      // Run the actual benchmark against real AWS resources
      const result = await awsService.runBenchmark(benchmarkId);
      
      // Save the benchmark result to database (including individual resource checks)
      await storage.saveBenchmarkResult({
        awsAccountId: account.id,
        benchmarkId: result.benchmarkId,
        benchmarkName: result.benchmarkName,
        controlsPassed: result.controlsPassed,
        controlsFailed: result.controlsFailed,
        estimatedSavings: result.estimatedSavings,
        resultJson: { checks: result.checks },
      }, result.checks);

      res.json({ success: true, result });
    } catch (error: any) {
      console.error("Error running benchmark:", error);
      
      // Provide more specific error messages for AWS credential issues
      if (error.name === 'CredentialsError' || error.name === 'InvalidClientTokenId') {
        res.status(401).json({ 
          message: "AWS credentials are invalid or expired. Please update your credentials." 
        });
        return;
      }
      
      if (error.name === 'UnauthorizedException' || error.name === 'AccessDeniedException') {
        res.status(403).json({ 
          message: "AWS credentials do not have sufficient permissions to run this benchmark." 
        });
        return;
      }
      
      if (error.message?.includes('Unknown benchmark')) {
        res.status(400).json({ message: error.message });
        return;
      }
      
      res.status(500).json({ 
        message: "Failed to run benchmark. Please check your AWS credentials and try again." 
      });
    }
  });

  // Get detailed resource checks for a specific benchmark (only failed checks)
  app.get("/api/benchmarks/:id/resources", isAuthenticated, async (req: any, res) => {
    try {
      const benchmarkResultId = req.params.id;
      const resources = await storage.getControlResultsByBenchmark(benchmarkResultId);
      
      // Only return failed checks (optimization opportunities)
      // Treat undefined/null as failed (optimization opportunities)
      const failedResources = resources
        .filter(control => control.passed !== true)
        .map(control => ({
          id: control.id,
          resourceId: control.resourceId || 'N/A',
          resourceType: control.resourceType || 'Unknown',
          controlName: control.controlName,
          passed: control.passed,
          reason: control.reason || `Resource optimization opportunity: ${control.controlName}`,
          estimatedSavings: control.estimatedSavings,
          executedAt: control.executedAt,
        }));
      
      res.json(failedResources);
    } catch (error) {
      console.error("Error fetching benchmark resources:", error);
      res.status(500).json({ message: "Failed to fetch benchmark resources" });
    }
  });

  // Get active AWS services (to show only relevant benchmarks)
  app.get("/api/benchmarks/active-services", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const accounts = await storage.getAwsAccounts(userId);
      
      if (accounts.length === 0) {
        res.json({ services: [] });
        return;
      }

      const account = accounts[0];
      
      // Validate credentials exist
      if (!account.accessKeyId || !account.secretAccessKey) {
        res.json({ services: [], error: "AWS credentials are missing" });
        return;
      }
      
      const awsService = new AwsService({
        accessKeyId: account.accessKeyId,
        secretAccessKey: account.secretAccessKey,
        region: account.region,
      });

      const activeServices = await awsService.getActiveServices();
      res.json({ services: activeServices });
    } catch (error: any) {
      console.error("Error fetching active services:", error);
      
      // Provide helpful error messages
      if (error.name === 'CredentialsError' || error.name === 'InvalidClientTokenId') {
        res.json({ 
          services: [], 
          error: "AWS credentials are invalid or expired" 
        });
        return;
      }
      
      res.json({ 
        services: [], 
        error: "Failed to detect active services" 
      });
    }
  });

  // Cost Summary route - returns current vs previous month cost comparison
  app.get("/api/costs/summary", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const includeCredits = req.query.includeCredits !== 'false'; // Default to true
      
      const accounts = await storage.getAwsAccounts(userId);
      if (accounts.length === 0) {
        res.status(400).json({ 
          message: "No AWS accounts connected. Please add an AWS account first." 
        });
        return;
      }

      const account = accounts[0];
      
      // Check cache first (with account ID)
      const cachedData = getCachedCost(userId, account.id, includeCredits);
      if (cachedData) {
        res.json(cachedData);
        return;
      }
      
      // Validate credentials exist
      if (!account.accessKeyId || !account.secretAccessKey) {
        res.status(400).json({ 
          message: "AWS credentials are missing or invalid" 
        });
        return;
      }
      
      const awsService = new AwsService({
        accessKeyId: account.accessKeyId,
        secretAccessKey: account.secretAccessKey,
        region: account.region,
      });

      const costSummary = await awsService.getCostSummary(includeCredits);
      
      // Validate response against schema before caching
      const validatedCostSummary = costSummarySchema.parse(costSummary);
      
      // Cache the validated result (with account ID)
      setCachedCost(userId, account.id, includeCredits, validatedCostSummary);
      
      res.json(validatedCostSummary);
    } catch (error: any) {
      console.error("Error fetching cost summary:", error);
      
      // Provide helpful error messages
      if (error.name === 'AccessDeniedException' || error.message?.includes('permission')) {
        res.status(403).json({ 
          message: "AWS credentials do not have permission to access Cost Explorer. Please ensure your IAM user has ce:GetCostAndUsage permission." 
        });
        return;
      }
      
      if (error.name === 'DataUnavailableException' || error.message?.includes('not available')) {
        res.status(503).json({ 
          message: "Cost Explorer data is not available yet. It may take 24 hours for data to appear after enabling Cost Explorer." 
        });
        return;
      }
      
      res.status(500).json({ 
        message: error.message || "Failed to fetch cost summary" 
      });
    }
  });

  // Resources route - returns all resources with cost optimization recommendations
  app.get("/api/resources", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const accounts = await storage.getAwsAccounts(userId);
      
      let allResources: any[] = [];
      for (const account of accounts) {
        const controls = await storage.getControlResults(account.id);
        const resources = controls
          .filter(control => !control.passed) // Only show failed checks (optimization opportunities)
          .map(control => ({
            id: control.id,
            resourceId: control.resourceId || 'N/A',
            resourceType: control.resourceType || 'Unknown',
            controlName: control.controlName,
            service: control.resourceType || 'Unknown',
            region: account.region,
            status: control.passed ? 'passed' : 'failed',
            reason: control.reason || `Resource optimization opportunity: ${control.controlName}`,
            savingsPotential: control.estimatedSavings,
            awsConsoleUrl: control.resourceId 
              ? `https://console.aws.amazon.com`
              : undefined,
          }));
        allResources = [...allResources, ...resources];
      }
      
      res.json(allResources);
    } catch (error) {
      console.error("Error fetching resources:", error);
      res.status(500).json({ message: "Failed to fetch resources" });
    }
  });

  // SQL Query routes
  app.get("/api/queries/history", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const history = await storage.getQueryHistory(userId);
      res.json(history);
    } catch (error) {
      console.error("Error fetching query history:", error);
      res.status(500).json({ message: "Failed to fetch query history" });
    }
  });

  app.post("/api/queries/execute", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { query } = req.body;
      
      if (!query || typeof query !== "string") {
        res.status(400).json({ message: "Invalid query" });
        return;
      }

      const accounts = await storage.getAwsAccounts(userId);
      
      // Simulate query execution (in real implementation, call Steampipe)
      const mockResult = {
        columns: ["id", "name", "status", "region"],
        rows: [
          { id: "i-1234567", name: "web-server-1", status: "running", region: "us-east-1" },
          { id: "i-7654321", name: "web-server-2", status: "stopped", region: "us-west-2" },
        ],
        rowCount: 2,
      };

      await storage.saveQuery(
        userId,
        accounts.length > 0 ? accounts[0].id : null,
        query,
        mockResult
      );

      res.json(mockResult);
    } catch (error) {
      console.error("Error executing query:", error);
      res.status(500).json({ message: "Failed to execute query" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
