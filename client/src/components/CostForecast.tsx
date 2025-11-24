import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, Calendar, DollarSign } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { CostForecast } from "@shared/schema";

interface CostForecastProps {
  includeCredits: boolean;
}

export default function CostForecast({ includeCredits }: CostForecastProps) {
  const { data: forecast, isLoading, error } = useQuery<CostForecast>({
    queryKey: ["/api/costs/forecast", { includeCredits }],
    queryFn: async () => {
      const response = await fetch(`/api/costs/forecast?includeCredits=${includeCredits}`, {
        credentials: 'include'
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to fetch cost forecast');
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
      <Alert data-testid="alert-forecast-error">
        <AlertDescription>
          {(error as Error).message}
        </AlertDescription>
      </Alert>
    );
  }

  if (isLoading) {
    return (
      <Card data-testid="card-forecast">
        <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-4">
          <Skeleton className="h-6 w-48" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!forecast) {
    return null;
  }

  return (
    <Card data-testid="card-forecast">
      <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-4">
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-primary" />
          Cost Forecast
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Next Month Forecast */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Calendar className="h-4 w-4" />
              <span>Next Month ({formatDate(forecast.nextMonth.startDate)})</span>
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold" data-testid="text-forecast-next-month">
              {formatCurrency(forecast.nextMonth.amount)}
            </span>
            {forecast.nextMonth.confidence && (
              <span className="text-sm text-muted-foreground">
                ({formatCurrency(forecast.nextMonth.confidence.lower)} - {formatCurrency(forecast.nextMonth.confidence.upper)})
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Forecasted cost for next month with 80% confidence
          </p>
        </div>

        {/* Next 3 Months Forecast */}
        {forecast.next3Months && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Calendar className="h-4 w-4" />
              <span>Next 3 Months</span>
            </div>
            <div className="text-2xl font-semibold" data-testid="text-forecast-next-3months">
              {formatCurrency(forecast.next3Months.amount)}
            </div>
            <p className="text-xs text-muted-foreground">
              Total forecasted cost for the next quarter
            </p>
          </div>
        )}

        {/* Year to Date */}
        <div className="border-t pt-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <DollarSign className="h-4 w-4" />
            <span>Year to Date</span>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Actual Spend</p>
              <p className="text-xl font-bold" data-testid="text-ytd-actual">
                {formatCurrency(forecast.yearToDateActual)}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Projected Total</p>
              <p className="text-xl font-bold" data-testid="text-ytd-forecast">
                {formatCurrency(forecast.yearToDateForecast)}
              </p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Forecasted total cost by end of year
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
