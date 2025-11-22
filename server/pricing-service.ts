import { 
  EC2Client, 
  DescribeInstancesCommand 
} from "@aws-sdk/client-ec2";
import { 
  RDSClient, 
  DescribeDBInstancesCommand 
} from "@aws-sdk/client-rds";
import type { AwsCredentials } from "./aws-service";

/**
 * Service to calculate AWS resource costs and potential savings
 * Uses rough estimates based on common pricing patterns
 */
export class PricingService {
  private ec2Client: EC2Client;
  private rdsClient: RDSClient;

  // Rough hourly costs for common instance types (in cents per hour)
  private static readonly EC2_HOURLY_COSTS: Record<string, number> = {
    // t2 family
    't2.nano': 1,
    't2.micro': 2,
    't2.small': 4,
    't2.medium': 8,
    't2.large': 16,
    't2.xlarge': 32,
    't2.2xlarge': 64,
    
    // t3 family
    't3.nano': 1,
    't3.micro': 2,
    't3.small': 4,
    't3.medium': 8,
    't3.large': 16,
    't3.xlarge': 32,
    't3.2xlarge': 64,
    
    // m5 family
    'm5.large': 19,
    'm5.xlarge': 38,
    'm5.2xlarge': 77,
    'm5.4xlarge': 154,
    'm5.8xlarge': 308,
    
    // c5 family
    'c5.large': 17,
    'c5.xlarge': 34,
    'c5.2xlarge': 68,
    'c5.4xlarge': 136,
    
    // r5 family
    'r5.large': 25,
    'r5.xlarge': 50,
    'r5.2xlarge': 100,
    'r5.4xlarge': 201,
  };

  private static readonly RDS_HOURLY_COSTS: Record<string, number> = {
    'db.t2.micro': 3,
    'db.t2.small': 6,
    'db.t2.medium': 12,
    'db.t3.micro': 3,
    'db.t3.small': 6,
    'db.t3.medium': 12,
    'db.m5.large': 28,
    'db.m5.xlarge': 57,
    'db.m5.2xlarge': 114,
    'db.r5.large': 38,
    'db.r5.xlarge': 76,
    'db.r5.2xlarge': 152,
  };

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
  }

  /**
   * Calculate monthly cost for an EC2 instance (in cents)
   */
  private calculateEC2MonthlyCost(instanceType: string): number {
    const hourlyCost = PricingService.EC2_HOURLY_COSTS[instanceType] || 10; // default 10 cents/hour
    const hoursPerMonth = 730; // average hours in a month
    return hourlyCost * hoursPerMonth;
  }

  /**
   * Calculate monthly cost for an RDS instance (in cents)
   */
  private calculateRDSMonthlyCost(instanceType: string): number {
    const hourlyCost = PricingService.RDS_HOURLY_COSTS[instanceType] || 15; // default 15 cents/hour
    const hoursPerMonth = 730;
    return hourlyCost * hoursPerMonth;
  }

  /**
   * Calculate savings for stopped EC2 instances
   * Savings = 100% of instance cost (we save the whole cost by keeping it stopped)
   */
  async calculateStoppedEC2Savings(instanceId: string): Promise<number> {
    try {
      const response = await this.ec2Client.send(
        new DescribeInstancesCommand({
          InstanceIds: [instanceId],
        })
      );

      const instance = response.Reservations?.[0]?.Instances?.[0];
      if (!instance || !instance.InstanceType) {
        return 0;
      }

      // If instance is stopped, we save 100% of its monthly cost by terminating it
      return this.calculateEC2MonthlyCost(instance.InstanceType);
    } catch (error) {
      console.error(`Error calculating savings for EC2 instance ${instanceId}:`, error);
      return 0;
    }
  }

  /**
   * Calculate savings for idle/underutilized EC2 instances
   * Savings = 50-75% of instance cost (downsizing or stopping during idle periods)
   */
  async calculateIdleEC2Savings(instanceId: string): Promise<number> {
    try {
      const response = await this.ec2Client.send(
        new DescribeInstancesCommand({
          InstanceIds: [instanceId],
        })
      );

      const instance = response.Reservations?.[0]?.Instances?.[0];
      if (!instance || !instance.InstanceType) {
        return 0;
      }

      // Assume we can save 60% by rightsizing or stopping during idle hours
      const monthlyCost = this.calculateEC2MonthlyCost(instance.InstanceType);
      return Math.floor(monthlyCost * 0.6);
    } catch (error) {
      console.error(`Error calculating savings for idle EC2 instance ${instanceId}:`, error);
      return 0;
    }
  }

  /**
   * Calculate savings for unattached EBS volumes
   * Rough estimate: $0.10/GB/month = 10 cents per GB
   */
  calculateEBSVolumeSavings(sizeInGB: number): number {
    const costPerGBPerMonth = 10; // 10 cents
    return sizeInGB * costPerGBPerMonth;
  }

  /**
   * Calculate savings for old snapshots
   * Rough estimate: $0.05/GB/month = 5 cents per GB
   */
  calculateSnapshotSavings(sizeInGB: number): number {
    const costPerGBPerMonth = 5; // 5 cents
    return sizeInGB * costPerGBPerMonth;
  }

  /**
   * Calculate savings for idle RDS instances
   */
  async calculateIdleRDSSavings(instanceId: string): Promise<number> {
    try {
      const response = await this.rdsClient.send(
        new DescribeDBInstancesCommand({
          DBInstanceIdentifier: instanceId,
        })
      );

      const instance = response.DBInstances?.[0];
      if (!instance || !instance.DBInstanceClass) {
        return 0;
      }

      // If idle, we can save 100% by stopping or terminating
      return this.calculateRDSMonthlyCost(instance.DBInstanceClass);
    } catch (error) {
      console.error(`Error calculating savings for RDS instance ${instanceId}:`, error);
      return 0;
    }
  }

  /**
   * Calculate savings for S3 buckets without lifecycle policies
   * Rough estimate: assume 100GB average, could save 50% with proper lifecycle management
   */
  calculateS3LifecycleSavings(): number {
    const averageBucketSizeGB = 100;
    const s3StandardCostPerGB = 2; // 2 cents per GB/month
    const savingsPercentage = 0.3; // 30% savings with lifecycle policies
    return Math.floor(averageBucketSizeGB * s3StandardCostPerGB * savingsPercentage);
  }

  /**
   * Calculate savings for DynamoDB tables using provisioned capacity
   * When on-demand would be cheaper
   */
  calculateDynamoDBSavings(readCapacity: number, writeCapacity: number): number {
    // Rough costs: $0.00065/hour per RCU, $0.00325/hour per WCU
    const rcuCostPerHour = 0.065; // cents
    const wcuCostPerHour = 0.325; // cents
    const hoursPerMonth = 730;
    
    const monthlyCost = (readCapacity * rcuCostPerHour + writeCapacity * wcuCostPerHour) * hoursPerMonth;
    
    // Assume 40% savings by switching to on-demand for low-traffic tables
    return Math.floor(monthlyCost * 0.4);
  }

  /**
   * Generic savings calculator based on control name
   */
  async calculateSavingsForControl(
    controlName: string,
    resourceId: string,
    resourceType: string
  ): Promise<number> {
    const lowerControlName = controlName.toLowerCase();

    // EC2 savings
    if (resourceType === 'EC2' || lowerControlName.includes('ec2') || lowerControlName.includes('instance')) {
      if (lowerControlName.includes('stopped')) {
        return await this.calculateStoppedEC2Savings(resourceId);
      }
      if (lowerControlName.includes('low utilization') || lowerControlName.includes('idle')) {
        return await this.calculateIdleEC2Savings(resourceId);
      }
      if (lowerControlName.includes('old') || lowerControlName.includes('running')) {
        // Default to idle calculation for old running instances
        return await this.calculateIdleEC2Savings(resourceId);
      }
    }

    // EBS savings
    if (lowerControlName.includes('volume') || lowerControlName.includes('ebs')) {
      if (lowerControlName.includes('unattached')) {
        // Default to 100GB for unattached volumes
        return this.calculateEBSVolumeSavings(100);
      }
    }

    // Snapshot savings
    if (lowerControlName.includes('snapshot')) {
      // Default to 50GB for old snapshots
      return this.calculateSnapshotSavings(50);
    }

    // RDS savings
    if (resourceType === 'RDS' || lowerControlName.includes('rds') || lowerControlName.includes('database')) {
      if (lowerControlName.includes('idle') || lowerControlName.includes('stopped')) {
        return await this.calculateIdleRDSSavings(resourceId);
      }
    }

    // S3 savings
    if (lowerControlName.includes('s3') || lowerControlName.includes('bucket')) {
      return this.calculateS3LifecycleSavings();
    }

    // DynamoDB savings
    if (lowerControlName.includes('dynamodb') || lowerControlName.includes('table')) {
      // Default to moderate provisioned capacity
      return this.calculateDynamoDBSavings(10, 5);
    }

    // Default: return 0 if we can't determine savings
    return 0;
  }
}
