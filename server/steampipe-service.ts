import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execAsync = promisify(exec);

const STEAMPIPE_BIN = path.join(process.cwd(), '.local/bin/steampipe');
const POWERPIPE_BIN = path.join(process.cwd(), '.local/bin/powerpipe');
const POWERPIPE_WORKSPACE = path.join(process.env.HOME || '/home/runner', 'steampipe-workspace');

export interface SteampipeControl {
  name: string;
  status: 'ok' | 'alarm' | 'error' | 'skip' | 'info';
  reason: string;
  resource: string;
  dimensions?: Record<string, string>;
}

export interface SteampipeBenchmarkResult {
  name: string;
  title: string;
  description: string;
  summary: {
    status: {
      ok: number;
      alarm: number;
      error: number;
      skip: number;
      info: number;
    };
  };
  controls: SteampipeControl[];
}

export class SteampipeService {
  private static instance: SteampipeService;
  
  private constructor() {}
  
  static getInstance(): SteampipeService {
    if (!SteampipeService.instance) {
      SteampipeService.instance = new SteampipeService();
    }
    return SteampipeService.instance;
  }

  async runBenchmark(
    benchmarkName: string,
    awsAccessKeyId: string,
    awsSecretAccessKey: string,
    awsRegion: string = 'us-east-1'
  ): Promise<SteampipeBenchmarkResult> {
    try {
      const env = {
        ...process.env,
        AWS_ACCESS_KEY_ID: awsAccessKeyId,
        AWS_SECRET_ACCESS_KEY: awsSecretAccessKey,
        AWS_REGION: awsRegion,
        STEAMPIPE_INSTALL_DIR: path.dirname(STEAMPIPE_BIN),
      };

      const command = `cd ${POWERPIPE_WORKSPACE} && ${POWERPIPE_BIN} benchmark run ${benchmarkName} --output json`;
      
      const { stdout, stderr } = await execAsync(command, {
        env,
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
        timeout: 300000, // 5 minute timeout
      });

      if (stderr && !stderr.includes('Warning')) {
        console.error('Steampipe stderr:', stderr);
      }

      return this.parseBenchmarkOutput(stdout);
    } catch (error: any) {
      console.error('Error running Steampipe benchmark:', error);
      throw new Error(`Failed to run benchmark ${benchmarkName}: ${error.message}`);
    }
  }

  private parseBenchmarkOutput(jsonOutput: string): SteampipeBenchmarkResult {
    try {
      const lines = jsonOutput.trim().split('\n');
      const lastLine = lines[lines.length - 1];
      const result = JSON.parse(lastLine);

      return {
        name: result.name || result.benchmark?.name || 'unknown',
        title: result.title || result.benchmark?.title || 'Unknown Benchmark',
        description: result.description || result.benchmark?.description || '',
        summary: {
          status: {
            ok: result.summary?.status?.ok || 0,
            alarm: result.summary?.status?.alarm || 0,
            error: result.summary?.status?.error || 0,
            skip: result.summary?.status?.skip || 0,
            info: result.summary?.status?.info || 0,
          },
        },
        controls: this.extractControls(result),
      };
    } catch (error: any) {
      console.error('Error parsing benchmark output:', error);
      throw new Error(`Failed to parse benchmark output: ${error.message}`);
    }
  }

  private extractControls(result: any): SteampipeControl[] {
    const controls: SteampipeControl[] = [];

    const processNode = (node: any) => {
      if (node.control_results) {
        for (const control of node.control_results) {
          controls.push({
            name: control.control?.title || control.title || 'Unknown Control',
            status: control.status || 'skip',
            reason: control.reason || '',
            resource: control.resource || '',
            dimensions: control.dimensions || {},
          });
        }
      }

      if (node.children) {
        for (const child of node.children) {
          processNode(child);
        }
      }
    };

    processNode(result);
    return controls;
  }

  async runEC2Benchmark(accessKeyId: string, secretAccessKey: string, region: string) {
    return this.runBenchmark('aws_thrifty.benchmark.ec2', accessKeyId, secretAccessKey, region);
  }

  async runRDSBenchmark(accessKeyId: string, secretAccessKey: string, region: string) {
    return this.runBenchmark('aws_thrifty.benchmark.rds', accessKeyId, secretAccessKey, region);
  }

  async runS3Benchmark(accessKeyId: string, secretAccessKey: string, region: string) {
    return this.runBenchmark('aws_thrifty.benchmark.s3', accessKeyId, secretAccessKey, region);
  }

  async runDynamoDBBenchmark(accessKeyId: string, secretAccessKey: string, region: string) {
    return this.runBenchmark('aws_thrifty.benchmark.dynamodb', accessKeyId, secretAccessKey, region);
  }

  async runElastiCacheBenchmark(accessKeyId: string, secretAccessKey: string, region: string) {
    return this.runBenchmark('aws_thrifty.benchmark.elasticache', accessKeyId, secretAccessKey, region);
  }

  async runRedshiftBenchmark(accessKeyId: string, secretAccessKey: string, region: string) {
    return this.runBenchmark('aws_thrifty.benchmark.redshift', accessKeyId, secretAccessKey, region);
  }

  async runLambdaBenchmark(accessKeyId: string, secretAccessKey: string, region: string) {
    return this.runBenchmark('aws_thrifty.benchmark.lambda', accessKeyId, secretAccessKey, region);
  }

  async runAllBenchmarks(accessKeyId: string, secretAccessKey: string, region: string) {
    const benchmarks = [
      'ec2',
      'rds',
      's3',
      'dynamodb',
      'elasticache',
      'redshift',
      'lambda',
    ];

    const results: Record<string, SteampipeBenchmarkResult> = {};

    for (const benchmark of benchmarks) {
      try {
        console.log(`Running ${benchmark} benchmark...`);
        results[benchmark] = await this.runBenchmark(
          `aws_thrifty.benchmark.${benchmark}`,
          accessKeyId,
          secretAccessKey,
          region
        );
      } catch (error: any) {
        console.error(`Failed to run ${benchmark} benchmark:`, error.message);
        results[benchmark] = {
          name: benchmark,
          title: `${benchmark.toUpperCase()} Benchmark`,
          description: 'Failed to run',
          summary: {
            status: { ok: 0, alarm: 0, error: 1, skip: 0, info: 0 },
          },
          controls: [],
        };
      }
    }

    return results;
  }

  async calculateSavingsFromControls(
    controls: SteampipeControl[],
    pricingService: any
  ): Promise<number> {
    let totalSavings = 0;

    for (const control of controls) {
      if (control.status === 'ok') {
        continue; // No savings for passing controls
      }

      try {
        // Extract resource ID from the control resource field
        // Format is typically "arn:aws:service:region:account:resource/id"
        const resourceId = this.extractResourceId(control.resource);
        const resourceType = this.extractResourceType(control.resource);

        // Calculate savings based on control type
        const savings = await pricingService.calculateSavingsForControl(
          control.name,
          resourceId,
          resourceType
        );

        totalSavings += savings;
      } catch (error) {
        console.error(`Error calculating savings for control ${control.name}:`, error);
        // Continue with other controls
      }
    }

    return totalSavings;
  }

  private extractResourceId(resourceArn: string): string {
    if (!resourceArn) return '';
    
    // Try to extract ID from ARN format
    const arnParts = resourceArn.split('/');
    if (arnParts.length > 1) {
      return arnParts[arnParts.length - 1];
    }
    
    // If not an ARN, return the whole string
    return resourceArn;
  }

  private extractResourceType(resourceArn: string): string {
    if (!resourceArn) return 'Unknown';
    
    // Extract service from ARN: arn:aws:SERVICE:region:account:resource
    const arnParts = resourceArn.split(':');
    if (arnParts.length >= 3 && arnParts[0] === 'arn') {
      const service = arnParts[2];
      
      // Map AWS service names to our resource types
      const serviceMap: Record<string, string> = {
        'ec2': 'EC2',
        'rds': 'RDS',
        's3': 'S3',
        'dynamodb': 'DynamoDB',
        'elasticache': 'ElastiCache',
        'redshift': 'Redshift',
        'lambda': 'Lambda',
      };
      
      return serviceMap[service] || service.toUpperCase();
    }
    
    return 'Unknown';
  }
}

export const steampipeService = SteampipeService.getInstance();
