import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, Calendar, DollarSign } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { CostForecast, ForecastTimePeriod } from "@shared/schema";

interface CostForecastProps {
  includeCredits: boolean;
}

const timePeriodLabels: Record<ForecastTimePeriod, string> = {
  '1_day': '1 Day',
  '7_days': '7 Days',
  'month_to_date': 'Month to Date',
  'current_month': 'Current Month',
  '1_month': '1 Month',
  '3_months': '3 Months',
  '6_months': '6 Months',
  '1_year': '1 Year',
};

export default function CostForecast({ includeCredits }: CostForecastProps) {
  const [timePeriod, setTimePeriod] = useState<ForecastTimePeriod>('current_month');
  
  const { data: forecast, isLoading, error } = useQuery<CostForecast>({
    queryKey: ["/api/costs/forecast", { includeCredits, timePeriod }],
    queryFn: async () => {
      const response = await fetch(`/api/costs/forecast?includeCredits=${includeCredits}&timePeriod=${timePeriod}`, {
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
        <Select value={timePeriod} onValueChange={(value) => setTimePeriod(value as ForecastTimePeriod)}>
          <SelectTrigger className="w-40" data-testid="select-time-period">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(timePeriodLabels).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Forecast for Selected Period */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Calendar className="h-4 w-4" />
              <span>{timePeriodLabels[forecast.timePeriod]}</span>
            </div>
          </div>
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-3xl font-bold" data-testid="text-forecast-amount">
              {formatCurrency(forecast.forecast.amount)}
            </span>
            {forecast.forecast.confidence && (
              <span className="text-sm text-muted-foreground">
                ({formatCurrency(forecast.forecast.confidence.lower)} - {formatCurrency(forecast.forecast.confidence.upper)})
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {formatDate(forecast.forecast.startDate)} to {formatDate(forecast.forecast.endDate)}
          </p>
          <p className="text-xs text-muted-foreground">
            Forecasted cost with 80% confidence interval
          </p>
        </div>

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
