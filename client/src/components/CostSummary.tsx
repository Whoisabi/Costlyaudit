import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, TrendingDown, DollarSign, Minus } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { CostSummary } from "@shared/schema";

export default function CostSummary() {
  const [includeCredits, setIncludeCredits] = useState(true);

  const { data: costData, isLoading, error } = useQuery<CostSummary>({
    queryKey: ["/api/costs/summary", { includeCredits }],
    queryFn: async () => {
      const response = await fetch(`/api/costs/summary?includeCredits=${includeCredits}`, {
        credentials: 'include'
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to fetch cost summary');
      }
      return response.json();
    },
  });

  const formatCurrency = (cents: number) => {
    return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  };

  if (error) {
    return (
      <Alert data-testid="alert-cost-error">
        <AlertDescription>
          {(error as Error).message}
        </AlertDescription>
      </Alert>
    );
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-4">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-6 w-32" />
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
          <Skeleton className="h-48 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!costData) {
    return null;
  }

  const isIncrease = costData.costDifference > 0;
  const isDecrease = costData.costDifference < 0;
  const percentageChangeAbs = Math.abs(costData.percentageChange);

  return (
    <Card data-testid="card-cost-summary">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-4 space-y-0 pb-4">
        <CardTitle className="text-lg font-semibold">AWS Cost Comparison</CardTitle>
        <div className="flex items-center gap-2">
          <Switch
            id="include-credits"
            checked={includeCredits}
            onCheckedChange={setIncludeCredits}
            data-testid="switch-include-credits"
          />
          <Label htmlFor="include-credits" className="text-sm cursor-pointer">
            {includeCredits ? 'With Credits' : 'Without Credits'}
          </Label>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Cost Comparison Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Current Month */}
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Current Month ({formatDate(costData.currentMonth.startDate)})
            </p>
            <div className="text-3xl font-bold" data-testid="text-current-cost">
              {formatCurrency(costData.currentMonth.amount)}
            </div>
            <p className="text-xs text-muted-foreground">
              as of {formatDate(costData.currentMonth.endDate)}
            </p>
          </div>

          {/* Previous Month */}
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Previous Month ({formatDate(costData.previousMonth.startDate)})
            </p>
            <div className="text-3xl font-bold" data-testid="text-previous-cost">
              {formatCurrency(costData.previousMonth.amount)}
            </div>
            <p className="text-xs text-muted-foreground">
              full month
            </p>
          </div>

          {/* Change */}
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Month-over-Month Change</p>
            <div className="flex items-center gap-2">
              <div 
                className={`text-3xl font-bold ${isIncrease ? 'text-destructive' : isDecrease ? 'text-primary' : ''}`}
                data-testid="text-cost-change"
              >
                {isIncrease ? '+' : ''}{formatCurrency(costData.costDifference)}
              </div>
              {isIncrease && <TrendingUp className="h-6 w-6 text-destructive" data-testid="icon-trending-up" />}
              {isDecrease && <TrendingDown className="h-6 w-6 text-primary" data-testid="icon-trending-down" />}
              {!isIncrease && !isDecrease && <Minus className="h-6 w-6 text-muted-foreground" data-testid="icon-no-change" />}
            </div>
            <p className={`text-xs font-medium ${isIncrease ? 'text-destructive' : isDecrease ? 'text-primary' : 'text-muted-foreground'}`}>
              {isIncrease ? '+' : isDecrease ? '-' : ''}{percentageChangeAbs.toFixed(1)}% {isIncrease ? 'increase' : isDecrease ? 'decrease' : 'no change'}
            </p>
          </div>
        </div>

        {/* Top Services */}
        {costData.topServices.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-sm font-medium">Top 5 Services by Cost</h3>
            <div className="space-y-2">
              {costData.topServices.map((service, index) => {
                const percentage = costData.currentMonth.amount > 0 
                  ? (service.amount / costData.currentMonth.amount) * 100 
                  : 0;
                
                return (
                  <div key={service.service} className="space-y-1" data-testid={`service-${index}`}>
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">{service.service}</span>
                      <span className="text-muted-foreground">{formatCurrency(service.amount)}</span>
                    </div>
                    <div className="w-full bg-muted rounded-full h-2">
                      <div 
                        className="bg-primary rounded-full h-2 transition-all" 
                        style={{ width: `${Math.min(percentage, 100)}%` }}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {percentage.toFixed(1)}% of total
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {costData.topServices.length === 0 && (
          <div className="text-center py-6 text-muted-foreground">
            <DollarSign className="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p>No service cost data available yet</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
