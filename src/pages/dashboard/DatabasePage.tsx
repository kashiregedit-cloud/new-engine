import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Database, Plus, Settings, Trash2, RefreshCw, CheckCircle, XCircle } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const databases = [
  {
    id: 1,
    name: "Primary Database",
    type: "PostgreSQL",
    status: "Connected",
    lastSync: "2 mins ago",
    records: "15,432",
  },
  {
    id: 2,
    name: "Analytics DB",
    type: "MongoDB",
    status: "Connected",
    lastSync: "5 mins ago",
    records: "8,231",
  },
  {
    id: 3,
    name: "Backup Database",
    type: "MySQL",
    status: "Disconnected",
    lastSync: "2 hours ago",
    records: "12,100",
  },
];

export default function DatabasePage() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Database Connect</h2>
          <p className="text-muted-foreground">
            Manage your database connections and sync settings
          </p>
        </div>
        <Button className="gap-2">
          <Plus size={18} />
          Add Database
        </Button>
      </div>

      {/* Connection Status */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-card border-border">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Databases</p>
                <p className="text-2xl font-bold text-foreground">3</p>
              </div>
              <Database className="h-8 w-8 text-primary" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Connected</p>
                <p className="text-2xl font-bold text-chart-3">2</p>
              </div>
              <CheckCircle className="h-8 w-8 text-chart-3" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Records</p>
                <p className="text-2xl font-bold text-foreground">35,763</p>
              </div>
              <RefreshCw className="h-8 w-8 text-chart-2" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Database Table */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle>Connected Databases</CardTitle>
          <CardDescription>View and manage all your database connections</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last Sync</TableHead>
                  <TableHead>Records</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {databases.map((db) => (
                  <TableRow key={db.id}>
                    <TableCell className="font-medium">{db.name}</TableCell>
                    <TableCell>{db.type}</TableCell>
                    <TableCell>
                      <Badge
                        variant={db.status === "Connected" ? "default" : "destructive"}
                        className={db.status === "Connected" ? "bg-chart-3 hover:bg-chart-3" : ""}
                      >
                        {db.status}
                      </Badge>
                    </TableCell>
                    <TableCell>{db.lastSync}</TableCell>
                    <TableCell>{db.records}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="icon">
                          <RefreshCw size={16} />
                        </Button>
                        <Button variant="ghost" size="icon">
                          <Settings size={16} />
                        </Button>
                        <Button variant="ghost" size="icon" className="text-destructive">
                          <Trash2 size={16} />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Add New Database Form */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle>Add New Database</CardTitle>
          <CardDescription>Enter your database connection details</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="db-name">Database Name</Label>
              <Input id="db-name" placeholder="My Database" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="db-type">Database Type</Label>
              <Input id="db-type" placeholder="PostgreSQL, MySQL, MongoDB..." />
            </div>
            <div className="space-y-2">
              <Label htmlFor="db-host">Host</Label>
              <Input id="db-host" placeholder="localhost or IP address" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="db-port">Port</Label>
              <Input id="db-port" placeholder="5432" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="db-user">Username</Label>
              <Input id="db-user" placeholder="database_user" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="db-pass">Password</Label>
              <Input id="db-pass" type="password" placeholder="••••••••" />
            </div>
          </div>
          <Button className="mt-6">Test Connection</Button>
        </CardContent>
      </Card>
    </div>
  );
}
