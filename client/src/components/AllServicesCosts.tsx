import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import type { ServiceBreakdown, ServiceResources } from '@shared/schema';

interface AllServicesCostsProps {
  includeCredits: boolean;
}

export function AllServicesCosts({ includeCredits }: AllServicesCostsProps) {
  const [expandedService, setExpandedService] = useState<string | null>(null);

  const { data: services, isLoading, error } = useQuery<ServiceBreakdown[]>({
    queryKey: ['/api/costs/services', { includeCredits }],
    queryFn: async () => {
      const response = await fetch(`/api/costs/services?includeCredits=${includeCredits}`, {
        credentials: 'include'
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to fetch services costs');
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

  const toggleService = (serviceCode: string) => {
    setExpandedService(expandedService === serviceCode ? null : serviceCode);
  };

  if (isLoading) {
    return (
      <Card data-testid="card-services-costs">
        <CardHeader>
          <CardTitle>All Services Costs</CardTitle>
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
      <Card data-testid="card-services-costs">
        <CardHeader>
          <CardTitle>All Services Costs</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-destructive" data-testid="text-error">
            {error instanceof Error ? error.message : 'Failed to load services costs'}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!services || services.length === 0) {
    return (
      <Card data-testid="card-services-costs">
        <CardHeader>
          <CardTitle>All Services Costs</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No services with costs found for this month.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="card-services-costs">
      <CardHeader>
        <CardTitle>All Services Costs</CardTitle>
        <p className="text-sm text-muted-foreground">
          {services.length} service{services.length !== 1 ? 's' : ''} with costs this month
        </p>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {services.map((service) => (
            <div key={service.serviceCode} className="border rounded-md">
              <Button
                variant="ghost"
                className="w-full justify-between p-4 h-auto hover-elevate"
                onClick={() => toggleService(service.serviceCode)}
                data-testid={`button-service-${service.serviceCode}`}
              >
                <div className="flex items-center gap-3 flex-1 text-left">
                  {expandedService === service.serviceCode ? (
                    <ChevronDown className="h-4 w-4 flex-shrink-0" />
                  ) : (
                    <ChevronRight className="h-4 w-4 flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate" data-testid={`text-service-name-${service.serviceCode}`}>
                      {service.serviceName}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {service.serviceCode}
                    </p>
                  </div>
                </div>
                <div className="font-semibold text-right" data-testid={`text-service-amount-${service.serviceCode}`}>
                  {formatCurrency(service.amount)}
                </div>
              </Button>
              {expandedService === service.serviceCode && (
                <ServiceResourcesDetail 
                  serviceCode={service.serviceCode}
                  includeCredits={includeCredits}
                />
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

interface ServiceResourcesDetailProps {
  serviceCode: string;
  includeCredits: boolean;
}

function ServiceResourcesDetail({ serviceCode, includeCredits }: ServiceResourcesDetailProps) {
  const { data: resources, isLoading, error } = useQuery<ServiceResources>({
    queryKey: ['/api/costs/services', serviceCode, 'resources', { includeCredits }],
    queryFn: async () => {
      const response = await fetch(
        `/api/costs/services/${encodeURIComponent(serviceCode)}/resources?includeCredits=${includeCredits}`,
        { credentials: 'include' }
      );
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to fetch service resources');
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

  if (isLoading) {
    return (
      <div className="p-4 border-t bg-muted/20">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading resource details...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 border-t bg-muted/20">
        <p className="text-sm text-destructive">
          {error instanceof Error ? error.message : 'Failed to load resource details'}
        </p>
      </div>
    );
  }

  if (!resources || resources.byRegion.length === 0) {
    return (
      <div className="p-4 border-t bg-muted/20">
        <p className="text-sm text-muted-foreground">
          No detailed resource information available for this service.
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 border-t bg-muted/20 space-y-4" data-testid={`detail-service-${serviceCode}`}>
      <div className="space-y-3">
        {resources.byRegion.map((regionData) => (
          <div key={regionData.region} className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-primary" />
                <span className="font-medium text-sm" data-testid={`text-region-${regionData.region}`}>
                  {regionData.region}
                </span>
              </div>
              <span className="text-sm font-semibold" data-testid={`text-region-amount-${regionData.region}`}>
                {formatCurrency(regionData.amount)}
              </span>
            </div>
            
            <div className="ml-4 space-y-1">
              {regionData.resources.slice(0, 10).map((resource, idx) => (
                <div 
                  key={`${resource.resourceId}-${idx}`}
                  className="flex items-center justify-between text-xs py-1 px-2 rounded-md hover-elevate"
                  data-testid={`resource-${resource.resourceId}`}
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-mono truncate text-muted-foreground">
                      {resource.usageType}
                    </p>
                    {resource.resourceName && (
                      <p className="text-xs text-muted-foreground truncate">
                        {resource.resourceName}
                      </p>
                    )}
                  </div>
                  <span className="ml-2 font-medium whitespace-nowrap">
                    {formatCurrency(resource.amount)}
                  </span>
                </div>
              ))}
              {regionData.resources.length > 10 && (
                <p className="text-xs text-muted-foreground italic px-2">
                  ... and {regionData.resources.length - 10} more resource{regionData.resources.length - 10 !== 1 ? 's' : ''}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
