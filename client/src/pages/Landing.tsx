import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart3, Cloud, DollarSign, ShieldCheck } from "lucide-react";

export default function Landing() {
  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-6 py-12">
        <div className="flex flex-col items-center text-center space-y-8">
          <div className="space-y-4">
            <h1 className="text-5xl font-semibold text-foreground">
              CostlyAgent
            </h1>
            <p className="text-xl text-muted-foreground max-w-2xl">
              Analyze and optimize your AWS infrastructure costs with
              AI-powered insights using Steampipe and Powerpipe
            </p>
          </div>

          <Button
            size="lg"
            onClick={() => (window.location.href = "/api/login")}
            data-testid="button-login"
            className="text-lg px-8"
          >
            Get Started
          </Button>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mt-12 w-full">
            <Card>
              <CardHeader className="space-y-2 pb-4">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">Cost Analysis</CardTitle>
                  <DollarSign className="h-5 w-5 text-primary" />
                </div>
              </CardHeader>
              <CardContent>
                <CardDescription>
                  Identify potential savings across 15 benchmarks and 41 cost controls
                </CardDescription>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="space-y-2 pb-4">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">Multi-Account</CardTitle>
                  <Cloud className="h-5 w-5 text-primary" />
                </div>
              </CardHeader>
              <CardContent>
                <CardDescription>
                  Manage and analyze multiple AWS accounts from a single dashboard
                </CardDescription>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="space-y-2 pb-4">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">Visual Insights</CardTitle>
                  <BarChart3 className="h-5 w-5 text-primary" />
                </div>
              </CardHeader>
              <CardContent>
                <CardDescription>
                  Interactive charts and dashboards for clear cost visualization
                </CardDescription>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="space-y-2 pb-4">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">Secure</CardTitle>
                  <ShieldCheck className="h-5 w-5 text-primary" />
                </div>
              </CardHeader>
              <CardContent>
                <CardDescription>
                  Enterprise-grade security with encrypted credential storage
                </CardDescription>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
