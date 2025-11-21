import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Search, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Resource {
  id: string;
  resourceId: string;
  resourceType: string;
  service: string;
  region: string;
  status: string;
  reason: string;
  savingsPotential: number;
  awsConsoleUrl: string;
}

export default function Resources() {
  const [searchTerm, setSearchTerm] = useState("");

  const { data: resources, isLoading } = useQuery<Resource[]>({
    queryKey: ["/api/resources"],
  });

  const filteredResources = resources?.filter((resource) =>
    Object.values(resource).some((value) =>
      String(value).toLowerCase().includes(searchTerm.toLowerCase())
    )
  );

  const formatCurrency = (cents: number) => {
    return `$${(cents / 100).toFixed(2)}`;
  };

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case "failed":
        return "destructive";
      case "warning":
        return "secondary";
      case "passed":
        return "default";
      default:
        return "secondary";
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-semibold">Resource Explorer</h1>
        <p className="text-sm text-muted-foreground mt-2">
          Browse and analyze affected AWS resources
        </p>
      </div>

      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search resources..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
            data-testid="input-search"
          />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Affected Resources</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-4">
              {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : !filteredResources || filteredResources.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground">
                {searchTerm
                  ? "No resources found matching your search."
                  : "No resources available. Run benchmarks to populate this list."}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Resource ID</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Service</TableHead>
                    <TableHead>Region</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead className="text-right">Savings</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredResources.map((resource) => (
                    <TableRow key={resource.id} data-testid={`row-resource-${resource.id}`}>
                      <TableCell className="font-mono text-sm" data-testid={`text-resource-id-${resource.id}`}>
                        {resource.resourceId}
                      </TableCell>
                      <TableCell>{resource.resourceType}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">{resource.service}</Badge>
                      </TableCell>
                      <TableCell>{resource.region}</TableCell>
                      <TableCell>
                        <Badge variant={getStatusColor(resource.status)}>
                          {resource.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-xs truncate">
                        {resource.reason}
                      </TableCell>
                      <TableCell className="text-right font-semibold text-primary">
                        {formatCurrency(resource.savingsPotential)}/mo
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => window.open(resource.awsConsoleUrl, "_blank")}
                          data-testid={`button-console-${resource.id}`}
                        >
                          <ExternalLink className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
