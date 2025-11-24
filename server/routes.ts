import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth, isAuthenticated, hashPassword, verifyPassword } from "./customAuth";
import { 
  insertAwsAccountSchema, 
  costSummarySchema, 
  signupSchema,
  loginSchema,
  type CostSummary,
  type ServiceBreakdown,
  type ServiceResources,
  type CostRecommendations,
} from "@shared/schema";
import { z } from "zod";
import { AwsService } from "./aws-service";
import { steampipeService } from "./steampipe-service";
import { PricingService } from "./pricing-service";

/**
 * Parse AWS ARN to extract resource ID for Cost Explorer queries
 * Cost Explorer expects just the resource ID (not the full ARN or namespace prefix)
 * 
 * Examples:
 * Slash-delimited (EC2, ELB, etc.):
 *   - arn:aws:ec2:region:account:instance/i-123 → i-123
 *   - arn:aws:ec2:region:account:snapshot/snap-123 → snap-123
 *   - arn:aws:elasticloadbalancing:region:account:loadbalancer/app/my-lb/123 → app/my-lb/123
 * 
 * Colon-delimited (RDS, Lambda, etc.):
 *   - arn:aws:rds:region:account:db:mydb → mydb
 *   - arn:aws:lambda:region:account:function:myfunc → myfunc
 *   - arn:aws:rds:region:account:snapshot:rds:mydb-snap → rds:mydb-snap
 */
function parseResourceIdFromArn(arn: string): string {
  // If not an ARN, return as-is (might already be a resource ID)
  if (!arn.startsWith('arn:')) {
    return arn;
  }

  // Parse ARN: arn:aws:service:region:account:resource
  const parts = arn.split(':');
  if (parts.length < 6) {
    return arn; // Invalid ARN, return as-is
  }

  // The resource part is everything after the 5th colon
  const resourcePart = parts.slice(5).join(':');

  // For slash-delimited resources (EC2, EBS, ELB, DynamoDB, etc.)
  // Format: resource-type/resource-id or resource-type/segment1/segment2/...
  // Examples:
  //   - instance/i-123 → i-123
  //   - snapshot/snap-123 → snap-123  
  //   - loadbalancer/app/my-lb/123 → app/my-lb/123 (multi-segment)
  if (resourcePart.includes('/')) {
    const firstSlashIndex = resourcePart.indexOf('/');
    // Return everything after the first slash (preserves multi-segment IDs)
    return resourcePart.substring(firstSlashIndex + 1);
  }
  
  // For colon-delimited resources (RDS, Lambda, etc.)
  // Format: resource-type:resource-id
  // Examples:
  //   - db:mydb → mydb
  //   - function:myfunc → myfunc
  //   - snapshot:rds:mydb-snapshot → rds:mydb-snapshot (multi-colon, keep rest)
  if (resourcePart.includes(':')) {
    const firstColonIndex = resourcePart.indexOf(':');
    // Return everything after the first colon (preserves multi-colon IDs)
    return resourcePart.substring(firstColonIndex + 1);
  }
  
  // For resources without delimiters, return as-is
  return resourcePart;
}

/**
 * Determine Cost Explorer service name from ARN
 * Maps AWS resource ARNs to official Cost Explorer SERVICE dimension values
 */
function getCostExplorerServiceFromArn(arn: string): string | null {
  if (!arn.startsWith('arn:')) {
    return null; // Not an ARN, can't determine service
  }

  // Parse ARN: arn:aws:service:region:account:resource-type/resource-id
  const parts = arn.split(':');
  if (parts.length < 6) {
    return null;
  }

  const service = parts[2]; // e.g., "ec2", "rds", "s3"
  const resourcePart = parts.slice(5).join(':'); // Everything after account ID

  // For EC2 service, determine if it's compute or other based on resource type
  if (service === 'ec2') {
    if (resourcePart.startsWith('instance/')) {
      return 'Amazon Elastic Compute Cloud - Compute';
    } else if (resourcePart.startsWith('volume/') || resourcePart.startsWith('snapshot/')) {
      return 'EC2 - Other'; // EBS volumes and snapshots
    } else if (resourcePart.startsWith('elastic-ip/') || resourcePart.startsWith('address/')) {
      return 'EC2 - Other'; // Elastic IPs
    } else {
      return 'Amazon Elastic Compute Cloud - Compute'; // Default to compute
    }
  }

  // Service name mappings
  const serviceMap: Record<string, string | null> = {
    'rds': 'Amazon Relational Database Service',
    'elasticache': 'Amazon ElastiCache',
    'redshift': 'Amazon Redshift',
    'lambda': 'AWS Lambda',
    'elasticloadbalancing': 'Amazon Elastic Load Balancing',
    's3': null, // Not supported for resource-level queries
    'dynamodb': null, // Not supported for resource-level queries
  };

  return serviceMap[service] || null;
}

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
  setupAuth(app);

  // Auth routes
  app.post('/api/auth/signup', async (req, res) => {
    try {
      const input = signupSchema.parse(req.body);
      
      // Check if user already exists
      const existingUser = await storage.getUserByEmail(input.email);
      if (existingUser) {
        return res.status(400).json({ message: "Email already registered" });
      }
      
      // Hash password and create user
      const hashedPassword = await hashPassword(input.password);
      const user = await storage.createUser({
        email: input.email,
        password: hashedPassword,
        firstName: input.firstName,
        lastName: input.lastName,
      });
      
      // Create session
      req.session.userId = user.id;
      
      // Return user without password
      const { password: _, ...userWithoutPassword } = user;
      res.json(userWithoutPassword);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid input", errors: error.errors });
      }
      console.error("Error during signup:", error);
      res.status(500).json({ message: "Failed to create account" });
    }
  });

  app.post('/api/auth/login', async (req, res) => {
    try {
      const input = loginSchema.parse(req.body);
      
      // Find user by email
      const user = await storage.getUserByEmail(input.email);
      if (!user) {
        return res.status(401).json({ message: "Invalid email or password" });
      }
      
      // Verify password
      const isValid = await verifyPassword(input.password, user.password);
      if (!isValid) {
        return res.status(401).json({ message: "Invalid email or password" });
      }
      
      // Create session
      req.session.userId = user.id;
      
      // Return user without password
      const { password: _, ...userWithoutPassword } = user;
      res.json(userWithoutPassword);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid input", errors: error.errors });
      }
      console.error("Error during login:", error);
      res.status(500).json({ message: "Login failed" });
    }
  });

  app.post('/api/auth/logout', (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ message: "Failed to logout" });
      }
      res.json({ message: "Logged out successfully" });
    });
  });

  app.get('/api/auth/user', isAuthenticated, async (req, res) => {
    try {
      // User is already attached to req by isAuthenticated middleware
      res.json(req.user);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // AWS Accounts routes
  app.get("/api/aws-accounts", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const accounts = await storage.getAwsAccountsForDisplay(userId);
      res.json(accounts);
    } catch (error) {
      console.error("Error fetching AWS accounts:", error);
      res.status(500).json({ message: "Failed to fetch AWS accounts" });
    }
  });

  app.post("/api/aws-accounts", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
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
      const userId = req.user.id;
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
      const userId = req.user.id;
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
      const userId = req.user.id;
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
      const userId = req.user.id;
      const { benchmarkId, useSteampipe } = req.body;
      
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
      
      // Use Steampipe if requested (for accurate savings calculation)
      if (useSteampipe) {
        try {
          const steampipeResult = await steampipeService.runBenchmark(
            `aws_thrifty.benchmark.${benchmarkId}`,
            account.accessKeyId,
            account.secretAccessKey,
            account.region
          );

          // Create pricing service to calculate savings
          const pricingService = new PricingService({
            accessKeyId: account.accessKeyId,
            secretAccessKey: account.secretAccessKey,
            region: account.region,
          });

          // Count resources by service for better cost distribution
          const resourceCountByService: Record<string, number> = {};
          for (const control of steampipeResult.controls) {
            if (control.status !== 'ok') {
              const serviceCode = getCostExplorerServiceFromArn(control.resource);
              if (serviceCode) {
                resourceCountByService[serviceCode] = (resourceCountByService[serviceCode] || 0) + 1;
              }
            }
          }

          // Calculate savings for each control
          let checksWithSavings = await Promise.all(
            steampipeResult.controls.map(async (control) => {
              let estimatedSavings = 0;

              if (control.status !== 'ok') {
                try {
                  // Extract resource ID from ARN
                  const resourceId = parseResourceIdFromArn(control.resource);
                  
                  // Determine Cost Explorer service name from ARN
                  const serviceCode = getCostExplorerServiceFromArn(control.resource);
                  
                  // Skip if service not supported for resource-level queries
                  if (!serviceCode) {
                    console.warn(`Cost Explorer resource-level data not available for ${control.resource}`);
                    estimatedSavings = 0;
                  } else {
                    // Pass resource count for this service to enable accurate cost distribution
                    const resourceCount = resourceCountByService[serviceCode];
                    estimatedSavings = await pricingService.calculateSavingsForControlWithService(
                      control.name,
                      resourceId,
                      serviceCode,
                      resourceCount
                    );
                  }
                } catch (error) {
                  console.error(`Error calculating savings for ${control.name}:`, error);
                }
              }

              return {
                id: control.name,
                name: control.name,
                passed: control.status === 'ok',
                resourceId: control.resource,
                estimatedSavings,
                reason: control.reason,
                serviceCode: getCostExplorerServiceFromArn(control.resource), // Add service code for capping
              };
            })
          );

          // CAP SAVINGS: Ensure total savings per service never exceed actual service costs
          try {
            // Get all service costs from Cost Explorer
            const allServiceCosts = await pricingService.getAllServicesCosts();
            
            // Create a map of service costs by service code (in cents)
            const serviceCostMap: Record<string, number> = {};
            for (const service of allServiceCosts) {
              serviceCostMap[service.serviceCode] = service.amount;
            }
            
            console.log('Service cost map:', Object.entries(serviceCostMap).map(([k, v]) => `${k}: $${(v / 100).toFixed(2)}`).join(', '));
            
            // Comprehensive service mapping: handles ARN services, resource names, and benchmark context
            // Maps to Cost Explorer SERVICE dimension values (as they appear in getAllServicesCosts)
            const serviceMapping: Record<string, string> = {
              // S3 - handles both ARN and bucket name formats
              's3': 'Amazon Simple Storage Service',
              'amazons3': 'Amazon Simple Storage Service',
              'amazon simple storage service': 'Amazon Simple Storage Service',
              
              // DynamoDB - handles both ARN and table name formats
              'dynamodb': 'Amazon DynamoDB',
              'amazondynamodb': 'Amazon DynamoDB',
              'amazon dynamodb': 'Amazon DynamoDB',
              
              // EC2 - multiple service types
              'ec2': 'Amazon Elastic Compute Cloud - Compute',
              'amazonec2': 'Amazon Elastic Compute Cloud - Compute',
              'amazon elastic compute cloud': 'Amazon Elastic Compute Cloud - Compute',
              'amazon elastic compute cloud - compute': 'Amazon Elastic Compute Cloud - Compute',
              'ec2 - other': 'EC2 - Other', // EBS, EIPs, etc.
              
              // RDS
              'rds': 'Amazon Relational Database Service',
              'amazonrds': 'Amazon Relational Database Service',
              'amazon relational database service': 'Amazon Relational Database Service',
              
              // ElastiCache
              'elasticache': 'Amazon ElastiCache',
              'amazonelasticache': 'Amazon ElastiCache',
              'amazon elasticache': 'Amazon ElastiCache',
              
              // Redshift
              'redshift': 'Amazon Redshift',
              'amazonredshift': 'Amazon Redshift',
              'amazon redshift': 'Amazon Redshift',
              
              // Lambda
              'lambda': 'AWS Lambda',
              'awslambda': 'AWS Lambda',
              'amazon lambda': 'AWS Lambda',
              'aws lambda': 'AWS Lambda',
              
              // ELB
              'elb': 'Elastic Load Balancing',
              'elasticloadbalancing': 'Elastic Load Balancing',
              'elastic load balancing': 'Elastic Load Balancing',
            };
            
            // Normalize service code to handle Cost Explorer variations
            const normalizeServiceCode = (code: string): string => {
              const lowercased = code.toLowerCase().trim();
              return serviceMapping[lowercased] || code;
            };
            
            // Create normalized lookup map (all values in CENTS)
            const normalizedCostMap: Record<string, number> = {};
            for (const [serviceCode, amountInCents] of Object.entries(serviceCostMap)) {
              const normalized = normalizeServiceCode(serviceCode);
              normalizedCostMap[normalized] = (normalizedCostMap[normalized] || 0) + amountInCents;
            }
            
            // Helper to extract service from benchmark ID and resource ID
            const getServiceFromBenchmarkContext = (benchmarkId: string, resourceId: string): string | null => {
              // Benchmark ID gives us the service family (e.g., "s3", "ec2", "rds")
              const serviceLookup: Record<string, string> = {
                's3': 'Amazon Simple Storage Service',
                'ec2': 'Amazon Elastic Compute Cloud - Compute',
                'rds': 'Amazon Relational Database Service',
                'dynamodb': 'Amazon DynamoDB',
                'elasticache': 'Amazon ElastiCache',
                'redshift': 'Amazon Redshift',
                'lambda': 'AWS Lambda',
              };
              
              return serviceLookup[benchmarkId] || null;
            };
            
            // Group ALL checks by service (ensuring ALL savings are accounted for and capped)
            const savingsByService: Record<string, { total: number; checks: any[] }> = {};
            for (const check of checksWithSavings) {
              // Skip passed checks (no savings)
              if (check.passed || check.estimatedSavings === 0) {
                continue;
              }
              
              // Ensure estimatedSavings is in CENTS (should already be, but verify)
              check.estimatedSavings = Math.round(check.estimatedSavings);
              
              // Determine service code using multiple fallback strategies
              let serviceCode: string | null = check.serviceCode;
              
              // Fallback 1: Extract from ARN if serviceCode is null
              if (!serviceCode && check.resourceId && check.resourceId.startsWith('arn:')) {
                const arnParts = check.resourceId.split(':');
                if (arnParts.length >= 3) {
                  const arnService = arnParts[2].toLowerCase();
                  serviceCode = normalizeServiceCode(arnService);
                }
              }
              
              // Fallback 2: Use benchmark context (handles non-ARN identifiers like bucket names, table names)
              if (!serviceCode) {
                serviceCode = getServiceFromBenchmarkContext(benchmarkId, check.resourceId);
              }
              
              // Fallback 3: Last resort - set to "Unknown Service" and zero it out
              if (!serviceCode) {
                serviceCode = 'Unknown Service';
                console.warn(`⚠️ Could not determine service for ${check.resourceId} in benchmark ${benchmarkId}, will zero savings`);
              }
              
              // Add check to savings map
              if (!savingsByService[serviceCode]) {
                savingsByService[serviceCode] = { total: 0, checks: [] };
              }
              savingsByService[serviceCode].total += check.estimatedSavings;
              savingsByService[serviceCode].checks.push(check);
            }
            
            // Cap savings for each service
            for (const [serviceCode, data] of Object.entries(savingsByService)) {
              // Try exact match first, then normalized match
              let actualCost = serviceCostMap[serviceCode];
              
              // If no exact match, try normalized lookup
              if (actualCost === undefined) {
                const normalized = normalizeServiceCode(serviceCode);
                actualCost = normalizedCostMap[normalized];
              }
              
              // If still no match, service is not in Cost Explorer
              if (actualCost === undefined) {
                console.warn(`⚠️ Service ${serviceCode} not found in Cost Explorer. Setting all savings to $0.00 to enforce cap.`);
                for (const check of data.checks) {
                  const originalSavings = check.estimatedSavings;
                  check.estimatedSavings = 0;
                  console.log(`  ✓ ${check.name}: $${(originalSavings / 100).toFixed(2)} → $0.00 (no cost data)`);
                }
                continue;
              }
              
              console.log(`Service ${serviceCode}: savings=$${(data.total / 100).toFixed(2)}, actualCost=$${(actualCost / 100).toFixed(2)}`);
              
              // If actual cost is zero or near-zero, cap all savings to zero
              if (actualCost <= 0) {
                console.warn(`⚠️ Service ${serviceCode} has $0.00 cost. Setting all savings to $0.00 to enforce cap.`);
                for (const check of data.checks) {
                  const originalSavings = check.estimatedSavings;
                  check.estimatedSavings = 0;
                  console.log(`  ✓ ${check.name}: $${(originalSavings / 100).toFixed(2)} → $0.00 (zero cost)`);
                }
                continue;
              }
              
              // If total savings exceed actual cost, scale down proportionally with rounding remainder redistribution
              if (data.total > actualCost) {
                const scalingFactor = actualCost / data.total;
                console.log(`⚠️ Capping ${serviceCode} savings: $${(data.total / 100).toFixed(2)} → $${(actualCost / 100).toFixed(2)} (${(scalingFactor * 100).toFixed(1)}% of original)`);
                
                // Scale each check's savings
                for (const check of data.checks) {
                  const originalSavings = check.estimatedSavings;
                  check.estimatedSavings = Math.floor(check.estimatedSavings * scalingFactor);
                  console.log(`  - ${check.name}: $${(originalSavings / 100).toFixed(2)} → $${(check.estimatedSavings / 100).toFixed(2)}`);
                }
                
                // Recompute total after rounding to check for remainder
                const cappedTotal = data.checks.reduce((sum: number, check: any) => sum + check.estimatedSavings, 0);
                const remainder = actualCost - cappedTotal;
                
                if (remainder > 0) {
                  // Redistribute remainder to the check with largest savings to maintain exact cap
                  const largestCheck = data.checks.reduce((max: any, check: any) => 
                    check.estimatedSavings > max.estimatedSavings ? check : max, 
                    data.checks[0]
                  );
                  largestCheck.estimatedSavings += remainder;
                  console.log(`  ✓ Redistributed remainder of $${(remainder / 100).toFixed(2)} to ${largestCheck.name}`);
                }
                
                // Final verification: ensure total savings equals actual cost
                const finalTotal = data.checks.reduce((sum: number, check: any) => sum + check.estimatedSavings, 0);
                console.log(`  ✓ Final total: $${(finalTotal / 100).toFixed(2)} (exactly matches actual cost: $${(actualCost / 100).toFixed(2)})`);
              } else {
                console.log(`✓ Service ${serviceCode} savings within limits (no cap needed)`);
              }
            }
          } catch (error) {
            console.error('Error capping savings to service costs:', error);
            // Continue without capping if there's an error
          }

          const controlsPassed = steampipeResult.summary.status.ok;
          const controlsFailed = 
            steampipeResult.summary.status.alarm + 
            steampipeResult.summary.status.error;

          // Calculate total savings (after capping)
          const totalSavings = checksWithSavings.reduce(
            (sum, check) => sum + check.estimatedSavings,
            0
          );

          // Save the benchmark result
          await storage.saveBenchmarkResult({
            awsAccountId: account.id,
            benchmarkId: benchmarkId,
            benchmarkName: steampipeResult.title,
            controlsPassed,
            controlsFailed,
            estimatedSavings: totalSavings,
            resultJson: { 
              steampipe: true,
              checks: checksWithSavings,
              rawResult: steampipeResult 
            },
          }, checksWithSavings);

          res.json({ 
            success: true, 
            result: {
              benchmarkId,
              benchmarkName: steampipeResult.title,
              checks: checksWithSavings,
              controlsPassed,
              controlsFailed,
              estimatedSavings: totalSavings,
            }
          });
          return;
        } catch (steampipeError: any) {
          console.error('Steampipe benchmark failed, falling back to AWS SDK:', steampipeError);
          // Fall through to use AWS SDK if Steampipe fails
        }
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
      const userId = req.user.id;
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
      const userId = req.user.id;
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

  // All Services Costs route - returns ALL services with costs (not just top 5)
  app.get("/api/costs/services", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const includeCredits = req.query.includeCredits !== 'false';
      
      const accounts = await storage.getAwsAccounts(userId);
      if (accounts.length === 0) {
        res.status(400).json({ 
          message: "No AWS accounts connected. Please add an AWS account first.",
          action: "Go to AWS Accounts page to connect your first account."
        });
        return;
      }

      // TODO: Add multi-account support - currently showing costs for first account only
      // Future enhancement: aggregate costs across all accounts or allow account selection
      const account = accounts[0];
      
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

      const services: ServiceBreakdown[] = await awsService.getAllServicesCosts(includeCredits);
      res.json(services);
    } catch (error: any) {
      console.error("Error fetching services costs:", error);
      
      if (error.name === 'AccessDeniedException' || error.message?.includes('permission')) {
        res.status(403).json({ 
          message: "AWS credentials do not have permission to access Cost Explorer.",
          action: "Add the 'ce:GetCostAndUsage' permission to your IAM user or role in the AWS Console."
        });
        return;
      }
      
      res.status(500).json({ 
        message: error.message || "Failed to fetch services costs" 
      });
    }
  });

  // Service Resources route - returns detailed resource breakdown for a specific service
  app.get("/api/costs/services/:serviceCode/resources", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { serviceCode } = req.params;
      const includeCredits = req.query.includeCredits !== 'false';
      
      const accounts = await storage.getAwsAccounts(userId);
      if (accounts.length === 0) {
        res.status(400).json({ 
          message: "No AWS accounts connected. Please add an AWS account first." 
        });
        return;
      }

      const account = accounts[0];
      
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

      const serviceResources: ServiceResources = await awsService.getServiceResourceCosts(
        decodeURIComponent(serviceCode),
        includeCredits
      );
      res.json(serviceResources);
    } catch (error: any) {
      console.error("Error fetching service resources:", error);
      
      if (error.name === 'AccessDeniedException' || error.message?.includes('permission')) {
        res.status(403).json({ 
          message: "AWS credentials do not have permission to access Cost Explorer.",
          action: "Add the 'ce:GetCostAndUsage' permission to your IAM user or role in the AWS Console."
        });
        return;
      }
      
      res.status(500).json({ 
        message: error.message || "Failed to fetch service resources" 
      });
    }
  });

  // Cost Recommendations route - returns RI, Savings Plans, and Rightsizing recommendations
  app.get("/api/costs/recommendations", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      
      const accounts = await storage.getAwsAccounts(userId);
      if (accounts.length === 0) {
        res.status(400).json({ 
          message: "No AWS accounts connected. Please add an AWS account first." 
        });
        return;
      }

      const account = accounts[0];
      
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

      const recommendations: CostRecommendations = await awsService.getCostRecommendations();
      res.json(recommendations);
    } catch (error: any) {
      console.error("Error fetching cost recommendations:", error);
      
      if (error.name === 'AccessDeniedException' || error.message?.includes('permission')) {
        res.status(403).json({ 
          message: "AWS credentials do not have permission to access Cost Explorer recommendations. Ensure your IAM user has ce:GetReservationPurchaseRecommendation, ce:GetSavingsPlansPurchaseRecommendation, and ce:GetRightsizingRecommendation permissions." 
        });
        return;
      }
      
      res.status(500).json({ 
        message: error.message || "Failed to fetch cost recommendations" 
      });
    }
  });

  // Cost Forecast route - returns forecasted costs for selected time period
  app.get("/api/costs/forecast", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      
      // Validate includeCredits parameter
      const includeCreditsParam = req.query.includeCredits;
      const includeCredits = includeCreditsParam === undefined || includeCreditsParam === 'true';
      
      // Validate timePeriod parameter
      const timePeriodParam = req.query.timePeriod as string;
      const validTimePeriods = ['1_day', '7_days', 'month_to_date', 'current_month', '1_month', '3_months', '6_months', '1_year'];
      const timePeriod = validTimePeriods.includes(timePeriodParam) ? timePeriodParam : 'current_month';
      
      const accounts = await storage.getAwsAccounts(userId);
      if (accounts.length === 0) {
        const today = new Date();
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        res.status(200).json({ 
          forecast: { 
            amount: 0, 
            startDate: today.toISOString().split('T')[0], 
            endDate: tomorrow.toISOString().split('T')[0]
          },
          timePeriod: timePeriod as any,
          yearToDateActual: 0,
          yearToDateForecast: 0
        });
        return;
      }

      const account = accounts[0];
      
      if (!account.accessKeyId || !account.secretAccessKey) {
        const today = new Date();
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        res.status(200).json({ 
          forecast: { 
            amount: 0, 
            startDate: today.toISOString().split('T')[0], 
            endDate: tomorrow.toISOString().split('T')[0]
          },
          timePeriod: timePeriod as any,
          yearToDateActual: 0,
          yearToDateForecast: 0
        });
        return;
      }
      
      const awsService = new AwsService({
        accessKeyId: account.accessKeyId,
        secretAccessKey: account.secretAccessKey,
        region: account.region,
      });

      const forecast = await awsService.getCostForecast(timePeriod as any, includeCredits);
      res.json(forecast);
    } catch (error: any) {
      console.error("Error fetching cost forecast:", error);
      
      if (error.name === 'AccessDeniedException' || error.message?.includes('permission')) {
        res.status(403).json({ 
          message: "AWS credentials do not have permission to access Cost Explorer forecasts. Ensure your IAM user has ce:GetCostForecast permission." 
        });
        return;
      }
      
      res.status(500).json({ 
        message: error.message || "Failed to fetch cost forecast" 
      });
    }
  });

  // Resources route - returns all resources with cost optimization recommendations
  app.get("/api/resources", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
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
      const userId = req.user.id;
      const history = await storage.getQueryHistory(userId);
      res.json(history);
    } catch (error) {
      console.error("Error fetching query history:", error);
      res.status(500).json({ message: "Failed to fetch query history" });
    }
  });

  app.post("/api/queries/execute", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
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
