import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { DollarSign, AlertTriangle, CheckCircle, XCircle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import CostSummary from "@/components/CostSummary";
import CostForecast from "@/components/CostForecast";
import { AllServicesCosts } from "@/components/AllServicesCosts";
import { CostRecommendationsPanel } from "@/components/CostRecommendations";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

interface DashboardStats {
  totalSavings: number;
  highRiskResources: number;
  failedControls: number;
  passedControls: number;
  savingsByService: { service: string; savings: number }[];
  controlsByBenchmark: { benchmark: string; passed: number; failed: number }[];
}

const COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
];

export default function Dashboard() {
  const [includeCredits, setIncludeCredits] = useState(true);

  const { data: stats, isLoading } = useQuery<DashboardStats>({
    queryKey: ["/api/dashboard/stats"],
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-3xl font-semibold">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-2">
            Overview of your AWS cost optimization opportunities
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardHeader className="space-y-2 pb-4">
                <Skeleton className="h-4 w-24" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-10 w-32" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  const formatCurrency = (cents: number) => {
    return `$${(cents / 100).toFixed(2)}`;
  };

  return (
    <div className="p-6 space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-2">
            Overview of your AWS cost optimization opportunities
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            id="global-credits-toggle"
            checked={includeCredits}
            onCheckedChange={setIncludeCredits}
            data-testid="switch-global-credits"
          />
          <Label htmlFor="global-credits-toggle" className="text-sm cursor-pointer">
            {includeCredits ? 'With Credits' : 'Without Credits'}
          </Label>
        </div>
      </div>

      {/* AWS Cost Comparison and Forecast */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <CostSummary 
          includeCredits={includeCredits}
          onIncludeCreditsChange={setIncludeCredits}
          showToggle={false}
        />
        <CostForecast includeCredits={includeCredits} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-4">
            <CardTitle className="text-sm font-medium">Total Potential Savings</CardTitle>
            <DollarSign className="h-5 w-5 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold" data-testid="text-total-savings">
              {formatCurrency(stats?.totalSavings || 0)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">per month</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-4">
            <CardTitle className="text-sm font-medium">High Risk Resources</CardTitle>
            <AlertTriangle className="h-5 w-5 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold" data-testid="text-high-risk">
              {stats?.highRiskResources || 0}
            </div>
            <p className="text-xs text-muted-foreground mt-1">requiring attention</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-4">
            <CardTitle className="text-sm font-medium">Failed Controls</CardTitle>
            <XCircle className="h-5 w-5 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold" data-testid="text-failed-controls">
              {stats?.failedControls || 0}
            </div>
            <p className="text-xs text-muted-foreground mt-1">out of {(stats?.failedControls || 0) + (stats?.passedControls || 0)}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-4">
            <CardTitle className="text-sm font-medium">Passed Controls</CardTitle>
            <CheckCircle className="h-5 w-5 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold" data-testid="text-passed-controls">
              {stats?.passedControls || 0}
            </div>
            <p className="text-xs text-muted-foreground mt-1">compliant checks</p>
          </CardContent>
        </Card>
      </div>

      {stats?.savingsByService && stats.savingsByService.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Savings by Service</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={stats.savingsByService}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ service, savings }) =>
                      `${service}: ${formatCurrency(savings)}`
                    }
                    outerRadius={80}
                    fill="#8884d8"
                    dataKey="savings"
                  >
                    {stats.savingsByService.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value: number) => formatCurrency(value)} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Controls by Benchmark</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={stats.controlsByBenchmark}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="benchmark" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="passed" fill="hsl(var(--chart-1))" name="Passed" />
                  <Bar dataKey="failed" fill="hsl(var(--destructive))" name="Failed" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      )}

      {(!stats?.savingsByService || stats.savingsByService.length === 0) && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <p className="text-muted-foreground text-center">
              No data available. Connect an AWS account and run benchmarks to see insights.
            </p>
          </CardContent>
        </Card>
      )}

      {/* All Services Costs - shows ALL services with costs, clickable to see resource details */}
      <AllServicesCosts includeCredits={includeCredits} />

      {/* Cost Optimization Recommendations */}
      <CostRecommendationsPanel />
    </div>
  );
}
