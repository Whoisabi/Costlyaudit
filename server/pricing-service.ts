import { AwsService, type AwsCredentials } from "./aws-service";

/**
 * Service to calculate AWS resource costs and potential savings
 * Uses actual AWS Cost Explorer data for accurate calculations
 */
export class PricingService {
  private awsService: AwsService;

  constructor(credentials: AwsCredentials) {
    this.awsService = new AwsService(credentials);
  }

  /**
   * Get actual monthly cost for a resource using Cost Explorer
   * Returns cost in cents, or null if data not available
   */
  private async getResourceMonthlyCost(
    resourceId: string,
    serviceCode: string
  ): Promise<number | null> {
    // Query last 7 days of actual costs
    const dailyCost = await this.awsService.getResourceCost(resourceId, serviceCode, 7);
    
    if (dailyCost === null) {
      return null;
    }

    // Extrapolate to monthly cost (30 days)
    return dailyCost * 30;
  }

  /**
   * Calculate savings with explicit service code (preferred method)
   * Uses actual Cost Explorer data when available
   */
  async calculateSavingsForControlWithService(
    controlName: string,
    resourceId: string,
    serviceCode: string
  ): Promise<number> {
    const lowerControlName = controlName.toLowerCase();

    try {
      // Get actual monthly cost from Cost Explorer
      const monthlyCost = await this.getResourceMonthlyCost(resourceId, serviceCode);

      if (monthlyCost === null || monthlyCost === 0) {
        // No cost data available, return 0
        console.warn(`No cost data found for resource ${resourceId} in service ${serviceCode}`);
        return 0;
      }

      // Determine savings percentage based on optimization type
      let savingsPercentage = 1.0; // Default: 100% savings for stopped/unused resources

      if (lowerControlName.includes('low utilization') || lowerControlName.includes('idle')) {
        savingsPercentage = 0.6; // 60% savings for idle resources
      } else if (lowerControlName.includes('upgrade') || lowerControlName.includes('graviton')) {
        savingsPercentage = 0.3; // 30% savings for right-sizing/upgrades
      }

      // Calculate savings (in cents)
      const savings = Math.round(monthlyCost * savingsPercentage);
      console.log(`Savings for ${resourceId}: $${(savings / 100).toFixed(2)}/month (${(savingsPercentage * 100)}% of $${(monthlyCost / 100).toFixed(2)})`);
      return savings;

    } catch (error) {
      console.error(`Error calculating savings for ${resourceId}:`, error);
      return 0;
    }
  }

  /**
   * Generic savings calculator based on control name and resource (legacy method)
   * Uses actual Cost Explorer data when available
   * @deprecated Use calculateSavingsForControlWithService instead
   */
  async calculateSavingsForControl(
    controlName: string,
    resourceId: string,
    resourceType: string
  ): Promise<number> {
    const lowerControlName = controlName.toLowerCase();
    const upperResourceType = resourceType.toUpperCase();

    try {
      // Map to Cost Explorer service names using both resourceType (from ARN) and control name
      let serviceCode = 'Amazon Elastic Compute Cloud - Compute'; // default (EC2 instances)
      
      // Check resourceType first (more reliable than control name parsing)
      if (upperResourceType === 'RDS' || lowerControlName.includes('rds') || lowerControlName.includes('database')) {
        serviceCode = 'Amazon Relational Database Service';
      } 
      // EBS volumes and snapshots use "EC2 - Other" service
      else if (upperResourceType === 'EBS' || lowerControlName.includes('ebs') || lowerControlName.includes('volume') || lowerControlName.includes('snapshot')) {
        serviceCode = 'EC2 - Other';
      }
      // Elastic IPs also use "EC2 - Other"
      else if (lowerControlName.includes('elastic ip') || lowerControlName.includes('eip') || lowerControlName.includes('address')) {
        serviceCode = 'EC2 - Other';
      }
      // Load balancers
      else if (upperResourceType === 'ELB' || upperResourceType === 'ELASTICLOADBALANCING' || 
               lowerControlName.includes('load balancer') || lowerControlName.includes('elb') || lowerControlName.includes('alb')) {
        serviceCode = 'Amazon Elastic Load Balancing';
      }
      // ElastiCache - handle plural from ARN (ELASTICACHES)
      else if (upperResourceType.includes('ELASTICACHE') || lowerControlName.includes('elasticache') || lowerControlName.includes('cache cluster')) {
        serviceCode = 'Amazon ElastiCache';
      }
      // Redshift
      else if (upperResourceType === 'REDSHIFT' || lowerControlName.includes('redshift')) {
        serviceCode = 'Amazon Redshift';
      }
      // Lambda
      else if (upperResourceType === 'LAMBDA' || lowerControlName.includes('lambda')) {
        serviceCode = 'AWS Lambda';
      }
      // S3 and DynamoDB: GetCostAndUsageWithResources doesn't support resource-level queries well
      // Return 0 for now (can add alternative estimation logic later)
      else if (upperResourceType === 'S3' || upperResourceType === 'DYNAMODB' || 
               lowerControlName.includes('s3') || lowerControlName.includes('dynamodb')) {
        console.warn(`Cost Explorer resource-level data not available for ${resourceType}, returning $0`);
        return 0;
      }

      // Get actual monthly cost from Cost Explorer
      const monthlyCost = await this.getResourceMonthlyCost(resourceId, serviceCode);

      // If Cost Explorer data not available, return 0 with warning
      if (monthlyCost === null) {
        console.warn(`Cost Explorer data not available for resource ${resourceId}`);
        return 0;
      }

      // Calculate savings based on optimization type
      let savingsPercentage = 0;

      // Stopped/idle resources: save 100% by terminating
      if (lowerControlName.includes('stopped') || lowerControlName.includes('idle')) {
        savingsPercentage = 1.0;
      }
      // Unattached volumes/IPs: save 100% by deleting
      else if (lowerControlName.includes('unattached') || lowerControlName.includes('elastic ip')) {
        savingsPercentage = 1.0;
      }
      // Old snapshots: save 100% by deleting
      else if (lowerControlName.includes('snapshot') && lowerControlName.includes('old')) {
        savingsPercentage = 1.0;
      }
      // Underutilized/rightsizing: save 50-70%
      else if (lowerControlName.includes('low utilization') || lowerControlName.includes('rightsize')) {
        savingsPercentage = 0.6;
      }
      // Old generation instances: save ~30% by upgrading
      else if (lowerControlName.includes('old') || lowerControlName.includes('generation')) {
        savingsPercentage = 0.3;
      }
      // Lifecycle/versioning/on-demand: save ~30%
      else if (lowerControlName.includes('lifecycle') || lowerControlName.includes('versioning') || 
               lowerControlName.includes('on-demand') || lowerControlName.includes('provisioned')) {
        savingsPercentage = 0.3;
      }
      // Default: 20% savings for generic optimizations
      else {
        savingsPercentage = 0.2;
      }

      return Math.floor(monthlyCost * savingsPercentage);
    } catch (error) {
      console.error(`Error calculating savings for ${resourceId}:`, error);
      return 0;
    }
  }
}
