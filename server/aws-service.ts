import { 
  EC2Client, 
  DescribeInstancesCommand, 
  DescribeVolumesCommand,
  DescribeSnapshotsCommand,
  DescribeAddressesCommand 
} from "@aws-sdk/client-ec2";
import { 
  RDSClient, 
  DescribeDBInstancesCommand, 
  DescribeDBSnapshotsCommand 
} from "@aws-sdk/client-rds";
import { 
  S3Client, 
  ListBucketsCommand,
  GetBucketVersioningCommand,
  GetBucketLifecycleConfigurationCommand 
} from "@aws-sdk/client-s3";
import { 
  DynamoDBClient, 
  ListTablesCommand,
  DescribeTableCommand 
} from "@aws-sdk/client-dynamodb";
import { 
  ElastiCacheClient, 
  DescribeCacheClustersCommand 
} from "@aws-sdk/client-elasticache";
import { 
  RedshiftClient, 
  DescribeClustersCommand 
} from "@aws-sdk/client-redshift";
import { 
  LambdaClient, 
  ListFunctionsCommand 
} from "@aws-sdk/client-lambda";
import {
  CostExplorerClient,
  GetCostAndUsageCommand,
  GetReservationPurchaseRecommendationCommand,
  GetSavingsPlansPurchaseRecommendationCommand,
  GetRightsizingRecommendationCommand,
} from "@aws-sdk/client-cost-explorer";
import type { 
  CostSummary, 
  MonthlyCost, 
  ServiceCost,
  ServiceBreakdown,
  ServiceResources,
  CostRecommendations,
} from "@shared/schema";

export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
}

export interface BenchmarkCheck {
  id: string;
  name: string;
  passed: boolean;
  resourceId?: string;
  estimatedSavings: number; // in cents
  reason?: string;
}

export interface BenchmarkResult {
  benchmarkId: string;
  benchmarkName: string;
  checks: BenchmarkCheck[];
  controlsPassed: number;
  controlsFailed: number;
  estimatedSavings: number;
}

/**
 * AWS Service for scanning and analyzing AWS infrastructure
 * Based on AWS Thrifty mod benchmarks
 */
export class AwsService {
  private ec2Client: EC2Client;
  private rdsClient: RDSClient;
  private s3Client: S3Client;
  private dynamodbClient: DynamoDBClient;
  private elasticacheClient: ElastiCacheClient;
  private redshiftClient: RedshiftClient;
  private lambdaClient: LambdaClient;
  private costExplorerClient: CostExplorerClient;

  constructor(credentials: AwsCredentials) {
    const config = {
      region: credentials.region,
      credentials: {
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
      },
    };

    this.ec2Client = new EC2Client(config);
    this.rdsClient = new RDSClient(config);
    this.s3Client = new S3Client(config);
    this.dynamodbClient = new DynamoDBClient(config);
    this.elasticacheClient = new ElastiCacheClient(config);
    this.redshiftClient = new RedshiftClient(config);
    this.lambdaClient = new LambdaClient(config);
    // Cost Explorer must use us-east-1 region
    this.costExplorerClient = new CostExplorerClient({
      region: 'us-east-1',
      credentials: {
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
      },
    });
  }

  /**
   * Run EC2 benchmark checks
   */
  async runEC2Benchmark(): Promise<BenchmarkResult> {
    const checks: BenchmarkCheck[] = [];

    try {
      // Check for stopped instances
      const instancesResponse = await this.ec2Client.send(new DescribeInstancesCommand({}));
      const instances = instancesResponse.Reservations?.flatMap(r => r.Instances || []) || [];
      
      for (const instance of instances) {
        if (instance.State?.Name === 'stopped') {
          checks.push({
            id: `ec2-stopped-${instance.InstanceId}`,
            name: 'EC2 instance should not be stopped for more than 30 days',
            passed: false,
            resourceId: instance.InstanceId,
            estimatedSavings: 0, // Requires Steampipe integration for accurate calculation
            reason: `Instance ${instance.InstanceId} is stopped but still incurring charges for EBS volumes`,
          });
        }
      }

      // Check for unattached volumes
      const volumesResponse = await this.ec2Client.send(new DescribeVolumesCommand({}));
      const volumes = volumesResponse.Volumes || [];
      
      for (const volume of volumes) {
        if (volume.State === 'available') {
          checks.push({
            id: `ec2-volume-${volume.VolumeId}`,
            name: 'EBS volumes should be attached to instances',
            passed: false,
            resourceId: volume.VolumeId,
            estimatedSavings: 0, // Requires Steampipe integration for accurate calculation
            reason: `Volume ${volume.VolumeId} (${volume.Size}GB) is unattached and incurring costs`,
          });
        }
      }

      // Check for old snapshots
      const snapshotsResponse = await this.ec2Client.send(new DescribeSnapshotsCommand({ OwnerIds: ['self'] }));
      const snapshots = snapshotsResponse.Snapshots || [];
      const oldSnapshotDate = new Date();
      oldSnapshotDate.setDate(oldSnapshotDate.getDate() - 90); // 90 days ago
      
      for (const snapshot of snapshots) {
        if (snapshot.StartTime && snapshot.StartTime < oldSnapshotDate) {
          checks.push({
            id: `ec2-snapshot-${snapshot.SnapshotId}`,
            name: 'EBS snapshots should not be older than 90 days',
            passed: false,
            resourceId: snapshot.SnapshotId,
            estimatedSavings: 0, // Requires Steampipe integration for accurate calculation
            reason: `Snapshot ${snapshot.SnapshotId} is older than 90 days`,
          });
        }
      }

      // Check for unattached elastic IPs
      const addressesResponse = await this.ec2Client.send(new DescribeAddressesCommand({}));
      const addresses = addressesResponse.Addresses || [];
      
      for (const address of addresses) {
        if (!address.AssociationId) {
          checks.push({
            id: `ec2-eip-${address.AllocationId}`,
            name: 'Elastic IPs should be attached to instances',
            passed: false,
            resourceId: address.AllocationId,
            estimatedSavings: 0, // Requires Steampipe integration for accurate calculation
            reason: `Elastic IP ${address.PublicIp} is unattached and incurring charges`,
          });
        }
      }

    } catch (error: any) {
      console.error('Error running EC2 benchmark:', error);
      // Re-throw AWS SDK errors so routes can handle them appropriately
      if (error.name === 'CredentialsError' || error.name === 'InvalidClientTokenId' || 
          error.name === 'UnauthorizedException' || error.name === 'AccessDeniedException') {
        throw error;
      }
      // For other errors, log but continue with empty results (service may not be in use)
    }

    const controlsPassed = checks.filter(c => c.passed).length;
    const controlsFailed = checks.filter(c => !c.passed).length;
    const estimatedSavings = checks.reduce((sum, c) => sum + c.estimatedSavings, 0);

    return {
      benchmarkId: 'ec2',
      benchmarkName: 'EC2',
      checks,
      controlsPassed,
      controlsFailed,
      estimatedSavings,
    };
  }

  /**
   * Run RDS benchmark checks
   */
  async runRDSBenchmark(): Promise<BenchmarkResult> {
    const checks: BenchmarkCheck[] = [];

    try {
      const response = await this.rdsClient.send(new DescribeDBInstancesCommand({}));
      const instances = response.DBInstances || [];

      for (const instance of instances) {
        // Check for stopped instances
        if (instance.DBInstanceStatus === 'stopped') {
          checks.push({
            id: `rds-stopped-${instance.DBInstanceIdentifier}`,
            name: 'RDS instances should not be stopped for extended periods',
            passed: false,
            resourceId: instance.DBInstanceIdentifier,
            estimatedSavings: 0, // Requires Steampipe integration for accurate calculation
            reason: `RDS instance ${instance.DBInstanceIdentifier} is stopped`,
          });
        }

        // Check for old generation instance types
        if (instance.DBInstanceClass?.includes('.t2.') || instance.DBInstanceClass?.includes('.m3.')) {
          checks.push({
            id: `rds-old-gen-${instance.DBInstanceIdentifier}`,
            name: 'RDS instances should use current generation instance types',
            passed: false,
            resourceId: instance.DBInstanceIdentifier,
            estimatedSavings: 0, // Requires Steampipe integration for accurate calculation
            reason: `RDS instance ${instance.DBInstanceIdentifier} uses old generation instance type ${instance.DBInstanceClass}`,
          });
        }
      }

      // Check for old snapshots
      const snapshotsResponse = await this.rdsClient.send(new DescribeDBSnapshotsCommand({ SnapshotType: 'manual' }));
      const snapshots = snapshotsResponse.DBSnapshots || [];
      const oldSnapshotDate = new Date();
      oldSnapshotDate.setDate(oldSnapshotDate.getDate() - 90);
      
      for (const snapshot of snapshots) {
        if (snapshot.SnapshotCreateTime && snapshot.SnapshotCreateTime < oldSnapshotDate) {
          checks.push({
            id: `rds-snapshot-${snapshot.DBSnapshotIdentifier}`,
            name: 'RDS snapshots should not be older than 90 days',
            passed: false,
            resourceId: snapshot.DBSnapshotIdentifier,
            estimatedSavings: 0, // Requires Steampipe integration for accurate calculation
            reason: `RDS snapshot ${snapshot.DBSnapshotIdentifier} is older than 90 days`,
          });
        }
      }

    } catch (error) {
      console.error('Error running RDS benchmark:', error);
    }

    const controlsPassed = checks.filter(c => c.passed).length;
    const controlsFailed = checks.filter(c => !c.passed).length;
    const estimatedSavings = checks.reduce((sum, c) => sum + c.estimatedSavings, 0);

    return {
      benchmarkId: 'rds',
      benchmarkName: 'RDS',
      checks,
      controlsPassed,
      controlsFailed,
      estimatedSavings,
    };
  }

  /**
   * Run S3 benchmark checks
   */
  async runS3Benchmark(): Promise<BenchmarkResult> {
    const checks: BenchmarkCheck[] = [];

    try {
      const response = await this.s3Client.send(new ListBucketsCommand({}));
      const buckets = response.Buckets || [];

      for (const bucket of buckets) {
        if (!bucket.Name) continue;

        try {
          // Check for versioning
          const versioningResponse = await this.s3Client.send(
            new GetBucketVersioningCommand({ Bucket: bucket.Name })
          );
          
          if (versioningResponse.Status === 'Enabled' && !versioningResponse.MFADelete) {
            checks.push({
              id: `s3-versioning-${bucket.Name}`,
              name: 'S3 buckets with versioning should have lifecycle policies',
              passed: false,
              resourceId: bucket.Name,
              estimatedSavings: 0, // Requires Steampipe integration for accurate calculation
              reason: `Bucket ${bucket.Name} has versioning enabled without lifecycle management`,
            });
          }

          // Check for lifecycle policies
          try {
            await this.s3Client.send(
              new GetBucketLifecycleConfigurationCommand({ Bucket: bucket.Name })
            );
          } catch (error: any) {
            if (error.name === 'NoSuchLifecycleConfiguration') {
              checks.push({
                id: `s3-lifecycle-${bucket.Name}`,
                name: 'S3 buckets should have lifecycle policies to optimize costs',
                passed: false,
                resourceId: bucket.Name,
                estimatedSavings: 0, // Requires Steampipe integration for accurate calculation
                reason: `Bucket ${bucket.Name} does not have lifecycle policies configured`,
              });
            }
          }
        } catch (error) {
          // Skip buckets we can't access
          console.error(`Error checking bucket ${bucket.Name}:`, error);
        }
      }

    } catch (error) {
      console.error('Error running S3 benchmark:', error);
    }

    const controlsPassed = checks.filter(c => c.passed).length;
    const controlsFailed = checks.filter(c => !c.passed).length;
    const estimatedSavings = checks.reduce((sum, c) => sum + c.estimatedSavings, 0);

    return {
      benchmarkId: 's3',
      benchmarkName: 'S3',
      checks,
      controlsPassed,
      controlsFailed,
      estimatedSavings,
    };
  }

  /**
   * Run DynamoDB benchmark checks
   */
  async runDynamoDBBenchmark(): Promise<BenchmarkResult> {
    const checks: BenchmarkCheck[] = [];

    try {
      const response = await this.dynamodbClient.send(new ListTablesCommand({}));
      const tableNames = response.TableNames || [];

      for (const tableName of tableNames) {
        const tableResponse = await this.dynamodbClient.send(
          new DescribeTableCommand({ TableName: tableName })
        );
        const table = tableResponse.Table;

        if (table?.BillingModeSummary?.BillingMode === 'PROVISIONED') {
          const readCapacity = table.ProvisionedThroughput?.ReadCapacityUnits || 0;
          const writeCapacity = table.ProvisionedThroughput?.WriteCapacityUnits || 0;
          
          if (readCapacity > 10 || writeCapacity > 10) {
            checks.push({
              id: `dynamodb-capacity-${tableName}`,
              name: 'DynamoDB tables should use on-demand billing for variable workloads',
              passed: false,
              resourceId: tableName,
              estimatedSavings: 0, // Requires Steampipe integration for accurate calculation
              reason: `Table ${tableName} uses provisioned capacity (${readCapacity} RCU, ${writeCapacity} WCU)`,
            });
          }
        }
      }

    } catch (error) {
      console.error('Error running DynamoDB benchmark:', error);
    }

    const controlsPassed = checks.filter(c => c.passed).length;
    const controlsFailed = checks.filter(c => !c.passed).length;
    const estimatedSavings = checks.reduce((sum, c) => sum + c.estimatedSavings, 0);

    return {
      benchmarkId: 'dynamodb',
      benchmarkName: 'DynamoDB',
      checks,
      controlsPassed,
      controlsFailed,
      estimatedSavings,
    };
  }

  /**
   * Run ElastiCache benchmark checks
   */
  async runElastiCacheBenchmark(): Promise<BenchmarkResult> {
    const checks: BenchmarkCheck[] = [];

    try {
      const response = await this.elasticacheClient.send(new DescribeCacheClustersCommand({}));
      const clusters = response.CacheClusters || [];

      for (const cluster of clusters) {
        // Check for old generation node types
        if (cluster.CacheNodeType?.includes('.t2.') || cluster.CacheNodeType?.includes('.m3.')) {
          checks.push({
            id: `elasticache-old-gen-${cluster.CacheClusterId}`,
            name: 'ElastiCache clusters should use current generation node types',
            passed: false,
            resourceId: cluster.CacheClusterId,
            estimatedSavings: 0, // Requires Steampipe integration for accurate calculation
            reason: `Cluster ${cluster.CacheClusterId} uses old generation node type ${cluster.CacheNodeType}`,
          });
        }
      }

    } catch (error) {
      console.error('Error running ElastiCache benchmark:', error);
    }

    const controlsPassed = checks.filter(c => c.passed).length;
    const controlsFailed = checks.filter(c => !c.passed).length;
    const estimatedSavings = checks.reduce((sum, c) => sum + c.estimatedSavings, 0);

    return {
      benchmarkId: 'elasticache',
      benchmarkName: 'ElastiCache',
      checks,
      controlsPassed,
      controlsFailed,
      estimatedSavings,
    };
  }

  /**
   * Run Redshift benchmark checks
   */
  async runRedshiftBenchmark(): Promise<BenchmarkResult> {
    const checks: BenchmarkCheck[] = [];

    try {
      const response = await this.redshiftClient.send(new DescribeClustersCommand({}));
      const clusters = response.Clusters || [];

      for (const cluster of clusters) {
        // Check for paused clusters
        if (cluster.ClusterStatus === 'paused') {
          checks.push({
            id: `redshift-paused-${cluster.ClusterIdentifier}`,
            name: 'Redshift clusters should not be paused for extended periods',
            passed: false,
            resourceId: cluster.ClusterIdentifier,
            estimatedSavings: 0, // Requires Steampipe integration for accurate calculation
            reason: `Cluster ${cluster.ClusterIdentifier} is paused`,
          });
        }

        // Check for old generation node types
        if (cluster.NodeType?.includes('dc1.') || cluster.NodeType?.includes('ds1.')) {
          checks.push({
            id: `redshift-old-gen-${cluster.ClusterIdentifier}`,
            name: 'Redshift clusters should use current generation node types',
            passed: false,
            resourceId: cluster.ClusterIdentifier,
            estimatedSavings: 0, // Requires Steampipe integration for accurate calculation
            reason: `Cluster ${cluster.ClusterIdentifier} uses old generation node type ${cluster.NodeType}`,
          });
        }
      }

    } catch (error) {
      console.error('Error running Redshift benchmark:', error);
    }

    const controlsPassed = checks.filter(c => c.passed).length;
    const controlsFailed = checks.filter(c => !c.passed).length;
    const estimatedSavings = checks.reduce((sum, c) => sum + c.estimatedSavings, 0);

    return {
      benchmarkId: 'redshift',
      benchmarkName: 'Redshift',
      checks,
      controlsPassed,
      controlsFailed,
      estimatedSavings,
    };
  }

  /**
   * Run Lambda benchmark checks
   */
  async runLambdaBenchmark(): Promise<BenchmarkResult> {
    const checks: BenchmarkCheck[] = [];

    try {
      const response = await this.lambdaClient.send(new ListFunctionsCommand({}));
      const functions = response.Functions || [];

      for (const func of functions) {
        // Check for over-provisioned memory
        if (func.MemorySize && func.MemorySize > 3008) {
          checks.push({
            id: `lambda-memory-${func.FunctionName}`,
            name: 'Lambda functions should not be over-provisioned',
            passed: false,
            resourceId: func.FunctionName,
            estimatedSavings: 0, // Requires Steampipe integration for accurate calculation
            reason: `Function ${func.FunctionName} has ${func.MemorySize}MB memory which may be over-provisioned`,
          });
        }

        // Check for old runtime versions
        if (func.Runtime?.includes('nodejs12') || func.Runtime?.includes('python3.6') || func.Runtime?.includes('python3.7')) {
          checks.push({
            id: `lambda-runtime-${func.FunctionName}`,
            name: 'Lambda functions should use supported runtime versions',
            passed: false,
            resourceId: func.FunctionName,
            estimatedSavings: 0, // Security/compatibility issue, not cost
            reason: `Function ${func.FunctionName} uses deprecated runtime ${func.Runtime}`,
          });
        }
      }

    } catch (error) {
      console.error('Error running Lambda benchmark:', error);
    }

    const controlsPassed = checks.filter(c => c.passed).length;
    const controlsFailed = checks.filter(c => !c.passed).length;
    const estimatedSavings = checks.reduce((sum, c) => sum + c.estimatedSavings, 0);

    return {
      benchmarkId: 'lambda',
      benchmarkName: 'Lambda',
      checks,
      controlsPassed,
      controlsFailed,
      estimatedSavings,
    };
  }

  /**
   * Run a specific benchmark by ID
   */
  async runBenchmark(benchmarkId: string): Promise<BenchmarkResult> {
    switch (benchmarkId) {
      case 'ec2':
        return this.runEC2Benchmark();
      case 'rds':
        return this.runRDSBenchmark();
      case 's3':
        return this.runS3Benchmark();
      case 'dynamodb':
        return this.runDynamoDBBenchmark();
      case 'elasticache':
        return this.runElastiCacheBenchmark();
      case 'redshift':
        return this.runRedshiftBenchmark();
      case 'lambda':
        return this.runLambdaBenchmark();
      default:
        throw new Error(`Unknown benchmark: ${benchmarkId}`);
    }
  }

  /**
   * Check which services are actually in use
   */
  async getActiveServices(): Promise<string[]> {
    const activeServices: string[] = [];

    try {
      const instances = await this.ec2Client.send(new DescribeInstancesCommand({}));
      if (instances.Reservations && instances.Reservations.length > 0) {
        activeServices.push('ec2');
      }
    } catch (error) {
      // Service not available or no permissions
    }

    try {
      const dbInstances = await this.rdsClient.send(new DescribeDBInstancesCommand({}));
      if (dbInstances.DBInstances && dbInstances.DBInstances.length > 0) {
        activeServices.push('rds');
      }
    } catch (error) {
      // Service not available or no permissions
    }

    try {
      const buckets = await this.s3Client.send(new ListBucketsCommand({}));
      if (buckets.Buckets && buckets.Buckets.length > 0) {
        activeServices.push('s3');
      }
    } catch (error) {
      // Service not available or no permissions
    }

    try {
      const tables = await this.dynamodbClient.send(new ListTablesCommand({}));
      if (tables.TableNames && tables.TableNames.length > 0) {
        activeServices.push('dynamodb');
      }
    } catch (error) {
      // Service not available or no permissions
    }

    try {
      const clusters = await this.elasticacheClient.send(new DescribeCacheClustersCommand({}));
      if (clusters.CacheClusters && clusters.CacheClusters.length > 0) {
        activeServices.push('elasticache');
      }
    } catch (error) {
      // Service not available or no permissions
    }

    try {
      const redshiftClusters = await this.redshiftClient.send(new DescribeClustersCommand({}));
      if (redshiftClusters.Clusters && redshiftClusters.Clusters.length > 0) {
        activeServices.push('redshift');
      }
    } catch (error) {
      // Service not available or no permissions
    }

    try {
      const functions = await this.lambdaClient.send(new ListFunctionsCommand({}));
      if (functions.Functions && functions.Functions.length > 0) {
        activeServices.push('lambda');
      }
    } catch (error) {
      // Service not available or no permissions
    }

    return activeServices;
  }

  /**
   * Get cost summary for current and previous month with optional credit exclusion
   * @param includeCredits - If false, excludes AWS credits and refunds from cost calculation
   */
  async getCostSummary(includeCredits: boolean = true): Promise<CostSummary> {
    const today = new Date();
    
    // Calculate date ranges
    const currentMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const nextMonthStart = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    const previousMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    
    // Format dates as YYYY-MM-DD
    const formatDate = (date: Date) => date.toISOString().split('T')[0];
    
    // Build filter to exclude credits/refunds if needed
    const filter = includeCredits ? undefined : {
      Not: {
        Dimensions: {
          Key: 'RECORD_TYPE' as const,
          Values: ['Credit', 'Refund', 'Tax']
        }
      }
    } as any;

    try {
      // Get current and previous month costs in one call
      const costResponse = await this.costExplorerClient.send(
        new GetCostAndUsageCommand({
          TimePeriod: {
            Start: formatDate(previousMonthStart),
            End: formatDate(nextMonthStart),
          },
          Granularity: 'MONTHLY',
          Metrics: ['AmortizedCost'],
          Filter: filter,
        })
      );

      // Get costs by service for current month
      const serviceCostResponse = await this.costExplorerClient.send(
        new GetCostAndUsageCommand({
          TimePeriod: {
            Start: formatDate(currentMonthStart),
            End: formatDate(nextMonthStart),
          },
          Granularity: 'MONTHLY',
          Metrics: ['AmortizedCost'],
          GroupBy: [
            {
              Type: 'DIMENSION',
              Key: 'SERVICE',
            },
          ],
          Filter: filter,
        })
      );

      // Extract cost data
      const results = costResponse.ResultsByTime || [];
      const previousMonthData = results[0];
      const currentMonthData = results[1];

      const previousAmount = parseFloat(previousMonthData?.Total?.AmortizedCost?.Amount || '0');
      const currentAmount = parseFloat(currentMonthData?.Total?.AmortizedCost?.Amount || '0');

      // Calculate percentage change
      const costDifference = currentAmount - previousAmount;
      const percentageChange = previousAmount > 0 
        ? ((costDifference / previousAmount) * 100) 
        : 0;

      // Extract top 5 services by cost
      const serviceGroups = serviceCostResponse.ResultsByTime?.[0]?.Groups || [];
      const topServices: ServiceCost[] = serviceGroups
        .map(group => ({
          service: group.Keys?.[0] || 'Unknown',
          amount: parseFloat(group.Metrics?.AmortizedCost?.Amount || '0'),
        }))
        .filter(service => service.amount > 0.01) // Filter out negligible costs
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 5);

      return {
        currentMonth: {
          amount: Math.round(currentAmount * 100), // Convert to cents
          startDate: formatDate(currentMonthStart),
          endDate: formatDate(today),
        },
        previousMonth: {
          amount: Math.round(previousAmount * 100), // Convert to cents
          startDate: formatDate(previousMonthStart),
          endDate: formatDate(currentMonthStart),
        },
        percentageChange: Math.round(percentageChange * 100) / 100, // Round to 2 decimals
        costDifference: Math.round(costDifference * 100), // Convert to cents
        topServices: topServices.map(s => ({
          service: s.service,
          amount: Math.round(s.amount * 100), // Convert to cents
        })),
      };
    } catch (error: any) {
      console.error('Error fetching cost data from AWS Cost Explorer:', error);
      
      // Provide helpful error messages
      if (error.name === 'AccessDeniedException') {
        throw new Error('AWS credentials do not have permission to access Cost Explorer. Please ensure your IAM user has ce:GetCostAndUsage permission.');
      }
      
      if (error.name === 'DataUnavailableException') {
        throw new Error('Cost Explorer data is not available yet. It may take 24 hours for data to appear after enabling Cost Explorer.');
      }
      
      throw new Error(`Failed to fetch cost data: ${error.message}`);
    }
  }

  /**
   * Get all services with costs (not just top 5)
   * @param includeCredits - If false, excludes AWS credits and refunds
   */
  async getAllServicesCosts(includeCredits: boolean = true): Promise<ServiceBreakdown[]> {
    const today = new Date();
    const currentMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const nextMonthStart = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    
    const formatDate = (date: Date) => date.toISOString().split('T')[0];
    
    const filter = includeCredits ? undefined : {
      Not: {
        Dimensions: {
          Key: 'RECORD_TYPE' as const,
          Values: ['Credit', 'Refund', 'Tax']
        }
      }
    } as any;

    try {
      const response = await this.costExplorerClient.send(
        new GetCostAndUsageCommand({
          TimePeriod: {
            Start: formatDate(currentMonthStart),
            End: formatDate(nextMonthStart),
          },
          Granularity: 'MONTHLY',
          Metrics: ['AmortizedCost'],
          GroupBy: [
            {
              Type: 'DIMENSION',
              Key: 'SERVICE',
            },
          ],
          Filter: filter,
        })
      );

      const serviceGroups = response.ResultsByTime?.[0]?.Groups || [];
      const services: ServiceBreakdown[] = serviceGroups
        .map(group => {
          const serviceCode = group.Keys?.[0] || 'Unknown';
          const amount = parseFloat(group.Metrics?.AmortizedCost?.Amount || '0');
          
          return {
            serviceCode,
            serviceName: serviceCode, // Will be mapped to friendly names in frontend
            amount: Math.round(amount * 100), // Convert to cents
          };
        })
        .filter(service => service.amount > 0) // Only services with costs
        .sort((a, b) => b.amount - a.amount); // Sort by cost descending

      return services;
    } catch (error: any) {
      console.error('Error fetching all services costs:', error);
      throw new Error(`Failed to fetch services costs: ${error.message}`);
    }
  }

  /**
   * Get resource-level cost breakdown for a specific service
   * @param serviceCode - AWS service code (e.g., "Amazon Elastic Compute Cloud")
   * @param includeCredits - If false, excludes AWS credits
   */
  async getServiceResourceCosts(serviceCode: string, includeCredits: boolean = true): Promise<ServiceResources> {
    const today = new Date();
    const currentMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const nextMonthStart = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    
    const formatDate = (date: Date) => date.toISOString().split('T')[0];
    
    const baseFilter = {
      Dimensions: {
        Key: 'SERVICE' as const,
        Values: [serviceCode]
      }
    };

    const filter = includeCredits ? baseFilter : {
      And: [
        baseFilter,
        {
          Not: {
            Dimensions: {
              Key: 'RECORD_TYPE' as const,
              Values: ['Credit', 'Refund', 'Tax']
            }
          }
        }
      ]
    } as any;

    try {
      // Get costs grouped by region and usage type
      const response = await this.costExplorerClient.send(
        new GetCostAndUsageCommand({
          TimePeriod: {
            Start: formatDate(currentMonthStart),
            End: formatDate(nextMonthStart),
          },
          Granularity: 'MONTHLY',
          Metrics: ['AmortizedCost'],
          GroupBy: [
            {
              Type: 'DIMENSION',
              Key: 'REGION',
            },
            {
              Type: 'DIMENSION',
              Key: 'USAGE_TYPE',
            },
          ],
          Filter: filter,
        })
      );

      const groups = response.ResultsByTime?.[0]?.Groups || [];
      
      // Organize by region
      const byRegionMap = new Map<string, any[]>();
      let totalAmount = 0;

      for (const group of groups) {
        const keys = group.Keys || [];
        const region = keys[0] || 'Unknown';
        const usageType = keys[1] || 'Unknown';
        const amount = parseFloat(group.Metrics?.AmortizedCost?.Amount || '0');
        
        if (amount <= 0) continue;

        totalAmount += amount;

        if (!byRegionMap.has(region)) {
          byRegionMap.set(region, []);
        }

        byRegionMap.get(region)!.push({
          resourceId: usageType, // Using usage type as identifier since we can't get actual resource IDs from Cost Explorer
          resourceType: usageType,
          region,
          usageType,
          amount: Math.round(amount * 100), // Convert to cents
        });
      }

      // Convert map to array format
      const byRegion = Array.from(byRegionMap.entries()).map(([region, resources]) => {
        const regionTotal = resources.reduce((sum, r) => sum + r.amount, 0);
        return {
          region,
          amount: regionTotal,
          resources: resources.sort((a, b) => b.amount - a.amount), // Sort by cost
        };
      }).sort((a, b) => b.amount - a.amount); // Sort regions by cost

      return {
        serviceCode,
        serviceName: serviceCode,
        totalAmount: Math.round(totalAmount * 100), // Convert to cents
        byRegion,
      };
    } catch (error: any) {
      console.error('Error fetching service resource costs:', error);
      throw new Error(`Failed to fetch resource costs for ${serviceCode}: ${error.message}`);
    }
  }

  /**
   * Get cost optimization recommendations from AWS Cost Explorer
   */
  async getCostRecommendations(): Promise<CostRecommendations> {
    try {
      // Fetch Reserved Instance recommendations
      const riRecommendations: any[] = [];
      try {
        const riResponse = await this.costExplorerClient.send(
          new GetReservationPurchaseRecommendationCommand({
            Service: 'Amazon Elastic Compute Cloud - Compute',
            PaymentOption: 'NO_UPFRONT',
            TermInYears: 'ONE_YEAR',
            LookbackPeriodInDays: 'THIRTY_DAYS',
          })
        );

        const recommendations = riResponse.Recommendations || [];
        for (const rec of recommendations) {
          const details = rec.RecommendationDetails?.[0];
          if (!details) continue;

          riRecommendations.push({
            serviceCode: 'AmazonEC2',
            instanceType: details.InstanceDetails?.EC2InstanceDetails?.InstanceType || 'Unknown',
            region: details.InstanceDetails?.EC2InstanceDetails?.Region || 'Unknown',
            paymentOption: 'NO_UPFRONT',
            term: 'ONE_YEAR',
            estimatedMonthlySavings: Math.round(
              parseFloat(rec.RecommendationSummary?.TotalEstimatedMonthlySavingsAmount || '0') * 100
            ),
            estimatedSavingsPercentage: parseFloat(
              rec.RecommendationSummary?.TotalEstimatedMonthlySavingsPercentage || '0'
            ),
            upfrontCost: Math.round(
              parseFloat(details.RecommendedNormalizedUnitsToPurchase || '0') * 
              parseFloat(details.RecurringStandardMonthlyCost || '0') * 100
            ),
            recommendedQuantity: parseFloat(details.RecommendedNormalizedUnitsToPurchase || '0'),
          });
        }
      } catch (error) {
        console.log('No RI recommendations available or error fetching:', error);
      }

      // Fetch Savings Plans recommendations
      const spRecommendations: any[] = [];
      try {
        const spResponse = await this.costExplorerClient.send(
          new GetSavingsPlansPurchaseRecommendationCommand({
            SavingsPlansType: 'COMPUTE_SP',
            PaymentOption: 'NO_UPFRONT',
            TermInYears: 'ONE_YEAR',
            LookbackPeriodInDays: 'THIRTY_DAYS',
          })
        );

        const recommendations = spResponse.SavingsPlansPurchaseRecommendation?.SavingsPlansPurchaseRecommendationDetails || [];
        for (const rec of recommendations) {
          spRecommendations.push({
            planType: 'COMPUTE_SP',
            paymentOption: 'NO_UPFRONT',
            term: 'ONE_YEAR',
            hourlyCommitment: Math.round(parseFloat(rec.HourlyCommitmentToPurchase || '0') * 100),
            estimatedMonthlySavings: Math.round(parseFloat(rec.EstimatedMonthlySavingsAmount || '0') * 100),
            estimatedSavingsPercentage: parseFloat(rec.EstimatedSavingsPercentage || '0'),
            upfrontCost: Math.round(parseFloat(rec.UpfrontCost || '0') * 100),
          });
        }
      } catch (error) {
        console.log('No Savings Plans recommendations available or error fetching:', error);
      }

      // Fetch Rightsizing recommendations
      const rightsizingRecommendations: any[] = [];
      try {
        const rightSizeResponse = await this.costExplorerClient.send(
          new GetRightsizingRecommendationCommand({
            Service: 'AmazonEC2',
          })
        );

        const recommendations = rightSizeResponse.RightsizingRecommendations || [];
        for (const rec of recommendations) {
          // Type-safe check for Modify type
          if (rec.RightsizingType?.toLowerCase() !== 'modify') continue;

          const current = rec.CurrentInstance;
          const target = rec.ModifyRecommendationDetail?.TargetInstances?.[0];

          if (!current || !target) continue;

          // Extract tag value safely
          const nameTag = current.Tags?.find(t => t.Key === 'Name');
          const resourceName = nameTag?.Values?.[0];

          // Get instance types safely
          const currentType = current.ResourceDetails?.EC2ResourceDetails?.InstanceType || 'Unknown';
          const targetType = (target as any).DefaultTargetInstance?.InstanceType || 'Unknown';

          // Calculate savings percentage from available data
          const monthlySavings = parseFloat(target.EstimatedMonthlySavings || '0');
          const monthlyCost = parseFloat(target.EstimatedMonthlyCost || '0');
          const savingsPercentage = monthlyCost > 0 
            ? ((monthlySavings / monthlyCost) * 100) 
            : 0;

          rightsizingRecommendations.push({
            resourceId: current.ResourceId || 'Unknown',
            resourceName: resourceName,
            currentInstanceType: currentType,
            recommendedInstanceType: targetType,
            region: current.ResourceDetails?.EC2ResourceDetails?.Region || 'Unknown',
            estimatedMonthlySavings: Math.round(monthlySavings * 100),
            estimatedSavingsPercentage: savingsPercentage,
            reason: `Instance is underutilized. Current average CPU: ${
              current.ResourceUtilization?.EC2ResourceUtilization?.MaxCpuUtilizationPercentage || 'Unknown'
            }%`,
            cpuUtilization: parseFloat(
              current.ResourceUtilization?.EC2ResourceUtilization?.MaxCpuUtilizationPercentage || '0'
            ),
          });
        }
      } catch (error) {
        console.log('No rightsizing recommendations available or error fetching:', error);
      }

      // Calculate total estimated savings
      const totalEstimatedMonthlySavings = 
        riRecommendations.reduce((sum, r) => sum + r.estimatedMonthlySavings, 0) +
        spRecommendations.reduce((sum, r) => sum + r.estimatedMonthlySavings, 0) +
        rightsizingRecommendations.reduce((sum, r) => sum + r.estimatedMonthlySavings, 0);

      return {
        reservedInstances: riRecommendations,
        savingsPlans: spRecommendations,
        rightsizing: rightsizingRecommendations,
        totalEstimatedMonthlySavings,
      };
    } catch (error: any) {
      console.error('Error fetching cost recommendations:', error);
      throw new Error(`Failed to fetch cost recommendations: ${error.message}`);
    }
  }
}
