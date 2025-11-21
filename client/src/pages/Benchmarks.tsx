import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Play, CheckCircle2, XCircle, AlertTriangle, ChevronRight } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { isUnauthorizedError } from "@/lib/authUtils";

interface Benchmark {
  id: string;
  name: string;
  description: string;
  totalControls: number;
  passedControls: number;
  failedControls: number;
  estimatedSavings: number;
  service: string;
}

const benchmarkMetadata: Record<string, { name: string; description: string; totalControls: number; service: string }> = {
  "ec2": {
    name: "EC2 Cost Optimization",
    description: "Identify underutilized and idle EC2 instances",
    totalControls: 8,
    service: "EC2",
  },
  "ebs": {
    name: "EBS Volume Optimization",
    description: "Find unused and unattached EBS volumes",
    totalControls: 5,
    service: "EBS",
  },
  "rds": {
    name: "RDS Database Optimization",
    description: "Optimize RDS instance sizes and storage",
    totalControls: 6,
    service: "RDS",
  },
  "s3": {
    name: "S3 Storage Optimization",
    description: "Identify opportunities for S3 storage class optimization",
    totalControls: 4,
    service: "S3",
  },
  "elb": {
    name: "Load Balancer Optimization",
    description: "Find unused and idle load balancers",
    totalControls: 3,
    service: "ELB",
  },
  "lambda": {
    name: "Lambda Function Optimization",
    description: "Optimize Lambda memory and execution time",
    totalControls: 4,
    service: "Lambda",
  },
  "cloudfront": {
    name: "CloudFront Distribution Optimization",
    description: "Optimize CloudFront configurations and caching",
    totalControls: 2,
    service: "CloudFront",
  },
  "elasticache": {
    name: "ElastiCache Optimization",
    description: "Identify underutilized ElastiCache clusters",
    totalControls: 3,
    service: "ElastiCache",
  },
  "redshift": {
    name: "Redshift Optimization",
    description: "Optimize Redshift cluster sizing and usage",
    totalControls: 2,
    service: "Redshift",
  },
};

// Normalize benchmark IDs to lowercase for consistent comparison
const normalizeId = (id: string) => id.toLowerCase();

interface ResourceDetail {
  id: string;
  resourceId: string;
  resourceType: string;
  controlName: string;
  passed: boolean;
  reason: string;
  estimatedSavings: number;
  executedAt: string;
}

export default function Benchmarks() {
  const { toast } = useToast();
  const [selectedBenchmarkId, setSelectedBenchmarkId] = useState<string | null>(null);
  const [showResourcesDialog, setShowResourcesDialog] = useState(false);

  const { data: apiResults, isLoading } = useQuery<Array<{
    id: string;
    awsAccountId: string;
    benchmarkId: string;
    benchmarkName: string;
    controlsPassed: number;
    controlsFailed: number;
    estimatedSavings: number;
    executedAt: string;
  }>>({
    queryKey: ["/api/benchmarks/results"],
  });

  // Fetch resource details when a benchmark is selected
  // The queryKey array gets joined with "/" by the default queryFn
  const { data: resourceDetails, isLoading: isLoadingResources } = useQuery<ResourceDetail[]>({
    queryKey: ["/api/benchmarks", selectedBenchmarkId, "resources"],
    enabled: !!selectedBenchmarkId && showResourcesDialog,
  });

  // Merge API results with metadata, showing all available benchmarks
  const benchmarks: (Benchmark & { resultId?: string })[] = Object.keys(benchmarkMetadata).map((benchmarkId) => {
    const metadata = benchmarkMetadata[benchmarkId];
    const apiResult = apiResults?.find(r => normalizeId(r.benchmarkId) === normalizeId(benchmarkId));
    
    return {
      id: benchmarkId,
      name: metadata.name,
      description: metadata.description,
      totalControls: metadata.totalControls,
      service: metadata.service,
      passedControls: apiResult?.controlsPassed || 0,
      failedControls: apiResult?.controlsFailed || 0,
      estimatedSavings: apiResult?.estimatedSavings || 0,
      resultId: apiResult?.id, // Store the actual result ID for fetching resources
    };
  });

  const runBenchmarkMutation = useMutation({
    mutationFn: async (benchmarkId: string) => {
      await apiRequest("POST", "/api/benchmarks/run", { benchmarkId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/benchmarks/results"] });
      toast({
        title: "Success",
        description: "Benchmark executed successfully",
      });
    },
    onError: (error: Error) => {
      if (isUnauthorizedError(error)) {
        toast({
          title: "Unauthorized",
          description: "You are logged out. Logging in again...",
          variant: "destructive",
        });
        setTimeout(() => {
          window.location.href = "/api/login";
        }, 500);
        return;
      }
      toast({
        title: "Error",
        description: "Failed to run benchmark",
        variant: "destructive",
      });
    },
  });

  const formatCurrency = (cents: number) => {
    return `$${(cents / 100).toFixed(2)}`;
  };

  const getProgressPercentage = (passed: number, total: number) => {
    if (total === 0) return 0;
    return Math.round((passed / total) * 100);
  };

  const handleViewResources = (benchmarkResultId: string, benchmarkName: string) => {
    setSelectedBenchmarkId(benchmarkResultId);
    setShowResourcesDialog(true);
  };

  const selectedBenchmarkName = selectedBenchmarkId
    ? apiResults?.find(r => r.id === selectedBenchmarkId)?.benchmarkName
    : null;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-semibold">Benchmarks</h1>
        <p className="text-sm text-muted-foreground mt-2">
          Run cost optimization benchmarks across your AWS services
        </p>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Card key={i}>
              <CardHeader className="space-y-2">
                <Skeleton className="h-6 w-40" />
                <Skeleton className="h-4 w-full" />
              </CardHeader>
              <CardContent className="space-y-4">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-20 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {benchmarks.map((benchmark) => {
            const progress = getProgressPercentage(
              benchmark.passedControls,
              benchmark.totalControls
            );

            return (
              <Card key={benchmark.id} className="hover-elevate">
                <CardHeader className="space-y-2 pb-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1">
                      <CardTitle className="text-lg">{benchmark.name}</CardTitle>
                      <Badge variant="secondary" data-testid={`badge-service-${benchmark.id}`}>
                        {benchmark.service}
                      </Badge>
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {benchmark.description}
                  </p>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Progress</span>
                      <span className="font-medium">{progress}%</span>
                    </div>
                    <Progress value={progress} />
                  </div>

                  <div className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <CheckCircle2 className="h-3 w-3" />
                      Passed
                    </span>
                    <span className="font-medium" data-testid={`text-passed-${benchmark.id}`}>
                      {benchmark.passedControls}/{benchmark.totalControls}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <XCircle className="h-3 w-3" />
                      Failed
                    </span>
                    <span className="font-medium text-destructive" data-testid={`text-failed-${benchmark.id}`}>
                      {benchmark.failedControls}
                    </span>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t">
                    <span className="text-sm text-muted-foreground">Est. Savings</span>
                    <span className="font-semibold text-primary" data-testid={`text-savings-${benchmark.id}`}>
                      {formatCurrency(benchmark.estimatedSavings)}/mo
                    </span>
                  </div>

                  <div className="flex gap-2">
                    <Button
                      className="flex-1"
                      variant="outline"
                      onClick={() => runBenchmarkMutation.mutate(benchmark.id)}
                      disabled={runBenchmarkMutation.isPending}
                      data-testid={`button-run-${benchmark.id}`}
                    >
                      <Play className="h-4 w-4 mr-2" />
                      {runBenchmarkMutation.isPending ? "Running..." : "Run"}
                    </Button>
                    {benchmark.resultId && (
                      <Button
                        className="flex-1"
                        variant="default"
                        onClick={() => handleViewResources(benchmark.resultId!, benchmark.name)}
                        data-testid={`button-view-resources-${benchmark.id}`}
                      >
                        View Resources
                        <ChevronRight className="h-4 w-4 ml-2" />
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Resource Details Dialog */}
      <Dialog open={showResourcesDialog} onOpenChange={(open) => {
        setShowResourcesDialog(open);
        if (!open && selectedBenchmarkId) {
          // Clear query data to prevent stale UI
          queryClient.setQueryData(["/api/benchmarks", selectedBenchmarkId, "resources"], undefined);
          // Clear selected benchmark after clearing data
          setSelectedBenchmarkId(null);
        }
      }}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selectedBenchmarkName || "Benchmark"} - Resources</DialogTitle>
            <DialogDescription>
              Detailed resource-level cost optimization opportunities
            </DialogDescription>
          </DialogHeader>

          {isLoadingResources ? (
            <div className="space-y-4">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : !resourceDetails || !Array.isArray(resourceDetails) || resourceDetails.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <CheckCircle2 className="h-12 w-12 mx-auto mb-4 text-green-600" />
              <p className="text-lg font-medium">All checks passed!</p>
              <p className="text-sm">No cost optimization opportunities found.</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Resource ID</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Issue</TableHead>
                      <TableHead className="text-right">Est. Savings/mo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {resourceDetails.map((resource) => (
                      <TableRow key={resource.id} data-testid={`row-resource-${resource.id}`}>
                        <TableCell className="font-mono text-sm" data-testid={`cell-resource-id-${resource.id}`}>
                          {resource.resourceId}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">{resource.resourceType}</Badge>
                        </TableCell>
                        <TableCell className="max-w-md">
                          <div className="flex items-start gap-2">
                            <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-500 mt-0.5 flex-shrink-0" />
                            <span className="text-sm">{resource.reason}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-semibold text-primary">
                          {formatCurrency(resource.estimatedSavings)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
