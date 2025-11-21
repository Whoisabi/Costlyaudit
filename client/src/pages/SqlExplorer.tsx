import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Play, History, Save } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { isUnauthorizedError } from "@/lib/authUtils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";

interface QueryResult {
  columns: string[];
  rows: any[];
  rowCount: number;
}

interface QueryHistoryItem {
  id: string;
  query: string;
  executedAt: string;
}

export default function SqlExplorer() {
  const { toast } = useToast();
  const [query, setQuery] = useState("SELECT * FROM aws_ec2_instance LIMIT 10;");
  const [showHistory, setShowHistory] = useState(false);

  const { data: history } = useQuery<QueryHistoryItem[]>({
    queryKey: ["/api/queries/history"],
  });

  const executeMutation = useMutation({
    mutationFn: async (sql: string) => {
      const response = await apiRequest("POST", "/api/queries/execute", { query: sql });
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/queries/history"] });
      toast({
        title: "Success",
        description: "Query executed successfully",
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
        description: error.message || "Failed to execute query",
        variant: "destructive",
      });
    },
  });

  const handleExecute = () => {
    if (!query.trim()) {
      toast({
        title: "Error",
        description: "Please enter a query",
        variant: "destructive",
      });
      return;
    }
    executeMutation.mutate(query);
  };

  const handleLoadHistory = (historyQuery: string) => {
    setQuery(historyQuery);
    setShowHistory(false);
  };

  const result = executeMutation.data as QueryResult | undefined;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-semibold">SQL Query Explorer</h1>
        <p className="text-sm text-muted-foreground mt-2">
          Execute Steampipe SQL queries against your AWS infrastructure
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Query Editor</CardTitle>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowHistory(!showHistory)}
                    data-testid="button-history"
                  >
                    <History className="h-4 w-4 mr-2" />
                    History
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <Textarea
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="SELECT * FROM aws_ec2_instance;"
                className="font-mono min-h-[200px]"
                data-testid="textarea-query"
              />
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">Steampipe SQL</Badge>
                </div>
                <Button
                  onClick={handleExecute}
                  disabled={executeMutation.isPending}
                  data-testid="button-execute"
                >
                  <Play className="h-4 w-4 mr-2" />
                  {executeMutation.isPending ? "Executing..." : "Execute Query"}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Results</CardTitle>
            </CardHeader>
            <CardContent>
              {executeMutation.isPending ? (
                <div className="space-y-4">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : result && result.rows && result.rows.length > 0 ? (
                <div className="space-y-4">
                  <div className="text-sm text-muted-foreground">
                    {result.rowCount} row{result.rowCount !== 1 ? "s" : ""} returned
                  </div>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          {result.columns.map((col) => (
                            <TableHead key={col}>{col}</TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {result.rows.map((row, idx) => (
                          <TableRow key={idx}>
                            {result.columns.map((col) => (
                              <TableCell key={col} className="font-mono text-xs">
                                {typeof row[col] === "object"
                                  ? JSON.stringify(row[col])
                                  : String(row[col] ?? "")}
                              </TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              ) : (
                <div className="text-center py-12">
                  <p className="text-muted-foreground">
                    {executeMutation.isError
                      ? "Query execution failed. Check your SQL syntax."
                      : "Execute a query to see results"}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {showHistory && (
          <div className="lg:col-span-1">
            <Card>
              <CardHeader>
                <CardTitle>Query History</CardTitle>
              </CardHeader>
              <CardContent>
                {!history || history.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">
                    No query history yet
                  </p>
                ) : (
                  <div className="space-y-2">
                    {history.slice(0, 10).map((item) => (
                      <button
                        key={item.id}
                        onClick={() => handleLoadHistory(item.query)}
                        className="w-full text-left p-3 rounded-md hover-elevate active-elevate-2 border"
                        data-testid={`button-history-${item.id}`}
                      >
                        <p className="text-xs font-mono truncate">{item.query}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {new Date(item.executedAt).toLocaleString()}
                        </p>
                      </button>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
