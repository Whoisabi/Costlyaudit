import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Loader2, TrendingDown, Server, Zap, Scale } from 'lucide-react';
import type { CostRecommendations } from '@shared/schema';

export function CostRecommendationsPanel() {
  const { data: recommendations, isLoading, error } = useQuery<CostRecommendations>({
    queryKey: ['/api/costs/recommendations'],
    queryFn: async () => {
      const response = await fetch('/api/costs/recommendations', {
        credentials: 'include'
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to fetch cost recommendations');
      }
      return response.json();
    },
  });

  const formatCurrency = (cents: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(cents / 100);
  };

  const formatPercentage = (value: number) => {
    return `${value.toFixed(1)}%`;
  };

  if (isLoading) {
    return (
      <Card data-testid="card-recommendations">
        <CardHeader>
          <CardTitle>Cost Optimization Recommendations</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card data-testid="card-recommendations">
        <CardHeader>
          <CardTitle>Cost Optimization Recommendations</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-destructive" data-testid="text-error">
            {error instanceof Error ? error.message : 'Failed to load recommendations'}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!recommendations) {
    return null;
  }

  const hasRecommendations = 
    recommendations.reservedInstances.length > 0 ||
    recommendations.savingsPlans.length > 0 ||
    recommendations.rightsizing.length > 0;

  if (!hasRecommendations) {
    return (
      <Card data-testid="card-recommendations">
        <CardHeader>
          <CardTitle>Cost Optimization Recommendations</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <p className="text-muted-foreground">
              No recommendations available at this time. This could mean:
            </p>
            <ul className="mt-4 space-y-2 text-sm text-muted-foreground text-left max-w-md mx-auto">
              <li>• Your resources are already optimally configured</li>
              <li>• Insufficient usage data (AWS needs 30 days of data)</li>
              <li>• Cost Explorer recommendations are not enabled</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="card-recommendations">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <CardTitle>Cost Optimization Recommendations</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              AWS-powered insights to reduce your infrastructure costs
            </p>
          </div>
          {recommendations.totalEstimatedMonthlySavings > 0 && (
            <div className="flex items-center gap-2">
              <TrendingDown className="h-5 w-5 text-primary" />
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Potential Monthly Savings</p>
                <p className="text-2xl font-bold text-primary" data-testid="text-total-savings">
                  {formatCurrency(recommendations.totalEstimatedMonthlySavings)}
                </p>
              </div>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="savings-plans" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="savings-plans" data-testid="tab-savings-plans">
              <Zap className="h-4 w-4 mr-2" />
              Savings Plans ({recommendations.savingsPlans.length})
            </TabsTrigger>
            <TabsTrigger value="reserved-instances" data-testid="tab-reserved-instances">
              <Server className="h-4 w-4 mr-2" />
              Reserved Instances ({recommendations.reservedInstances.length})
            </TabsTrigger>
            <TabsTrigger value="rightsizing" data-testid="tab-rightsizing">
              <Scale className="h-4 w-4 mr-2" />
              Rightsizing ({recommendations.rightsizing.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="savings-plans" className="space-y-4 mt-4">
            {recommendations.savingsPlans.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">
                No Savings Plans recommendations available.
              </p>
            ) : (
              <div className="space-y-3">
                {recommendations.savingsPlans.map((plan, idx) => (
                  <div 
                    key={idx}
                    className="border rounded-md p-4 space-y-3 hover-elevate"
                    data-testid={`savings-plan-${idx}`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary">{plan.planType}</Badge>
                          <Badge variant="outline">{plan.term}</Badge>
                          <Badge variant="outline">{plan.paymentOption}</Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          Commit to {formatCurrency(plan.hourlyCommitment)}/hour
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-muted-foreground">Estimated Monthly Savings</p>
                        <p className="text-xl font-bold text-primary">
                          {formatCurrency(plan.estimatedMonthlySavings)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatPercentage(plan.estimatedSavingsPercentage)} savings
                        </p>
                      </div>
                    </div>
                    {plan.upfrontCost > 0 && (
                      <div className="pt-2 border-t">
                        <p className="text-xs text-muted-foreground">
                          Upfront cost: <span className="font-medium">{formatCurrency(plan.upfrontCost)}</span>
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="reserved-instances" className="space-y-4 mt-4">
            {recommendations.reservedInstances.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">
                No Reserved Instance recommendations available.
              </p>
            ) : (
              <div className="space-y-3">
                {recommendations.reservedInstances.map((ri, idx) => (
                  <div 
                    key={idx}
                    className="border rounded-md p-4 space-y-3 hover-elevate"
                    data-testid={`reserved-instance-${idx}`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary">{ri.instanceType}</Badge>
                          <Badge variant="outline">{ri.region}</Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {ri.term} • {ri.paymentOption} • Qty: {ri.recommendedQuantity}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-muted-foreground">Estimated Monthly Savings</p>
                        <p className="text-xl font-bold text-primary">
                          {formatCurrency(ri.estimatedMonthlySavings)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatPercentage(ri.estimatedSavingsPercentage)} savings
                        </p>
                      </div>
                    </div>
                    {ri.upfrontCost > 0 && (
                      <div className="pt-2 border-t">
                        <p className="text-xs text-muted-foreground">
                          Estimated upfront cost: <span className="font-medium">{formatCurrency(ri.upfrontCost)}</span>
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="rightsizing" className="space-y-4 mt-4">
            {recommendations.rightsizing.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">
                No rightsizing recommendations available. Your instances appear to be appropriately sized.
              </p>
            ) : (
              <div className="space-y-3">
                {recommendations.rightsizing.map((rec, idx) => (
                  <div 
                    key={idx}
                    className="border rounded-md p-4 space-y-3 hover-elevate"
                    data-testid={`rightsizing-${idx}`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="space-y-1 flex-1">
                        <div className="flex items-center gap-2">
                          <Badge variant="destructive">{rec.currentInstanceType}</Badge>
                          <span className="text-muted-foreground">→</span>
                          <Badge variant="secondary">{rec.recommendedInstanceType}</Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {rec.resourceId} • {rec.region}
                        </p>
                        {rec.resourceName && (
                          <p className="text-xs text-muted-foreground">
                            {rec.resourceName}
                          </p>
                        )}
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-muted-foreground">Estimated Monthly Savings</p>
                        <p className="text-xl font-bold text-primary">
                          {formatCurrency(rec.estimatedMonthlySavings)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatPercentage(rec.estimatedSavingsPercentage)} savings
                        </p>
                      </div>
                    </div>
                    <div className="pt-2 border-t space-y-1">
                      <p className="text-xs text-muted-foreground">{rec.reason}</p>
                      {rec.cpuUtilization !== undefined && (
                        <p className="text-xs text-muted-foreground">
                          Average CPU: {formatPercentage(rec.cpuUtilization)}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
