import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth, isAuthenticated } from "./replitAuth";
import { insertAwsAccountSchema } from "@shared/schema";
import { z } from "zod";

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
      
      const accounts = await storage.getAwsAccounts(userId);
      if (accounts.length === 0) {
        res.status(400).json({ message: "No AWS accounts connected" });
        return;
      }

      // Simulate benchmark execution (in real implementation, call Steampipe)
      const account = accounts[0];
      
      await storage.saveBenchmarkResult({
        awsAccountId: account.id,
        benchmarkId,
        benchmarkName: benchmarkId.toUpperCase(),
        controlsPassed: Math.floor(Math.random() * 10),
        controlsFailed: Math.floor(Math.random() * 5),
        estimatedSavings: Math.floor(Math.random() * 50000),
        resultJson: { message: "Benchmark executed successfully" },
      });

      res.json({ success: true });
    } catch (error) {
      console.error("Error running benchmark:", error);
      res.status(500).json({ message: "Failed to run benchmark" });
    }
  });

  // Resources route
  app.get("/api/resources", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const accounts = await storage.getAwsAccounts(userId);
      
      let allResources: any[] = [];
      for (const account of accounts) {
        const controls = await storage.getControlResults(account.id);
        const resources = controls.map(control => ({
          id: control.id,
          resourceId: `resource-${control.id}`,
          resourceType: control.controlName,
          service: control.controlId.split('_')[0].toUpperCase(),
          region: account.region,
          status: control.status,
          reason: `Control ${control.controlName} ${control.status}`,
          savingsPotential: control.estimatedSavings,
          awsConsoleUrl: `https://console.aws.amazon.com/${control.controlId}`,
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
