import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Plus, Search, Eye, Pause, Play, BarChart2, Megaphone, MousePointer, DollarSign } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";

const ads = [
  {
    id: 1,
    name: "Summer Sale Campaign",
    platform: "Facebook",
    status: "Running",
    impressions: "125,432",
    clicks: "3,421",
    ctr: "2.7%",
    spent: "৳15,000",
    budget: "৳20,000",
    progress: 75,
  },
  {
    id: 2,
    name: "New Product Launch",
    platform: "Instagram",
    status: "Running",
    impressions: "89,234",
    clicks: "2,156",
    ctr: "2.4%",
    spent: "৳8,500",
    budget: "৳15,000",
    progress: 57,
  },
  {
    id: 3,
    name: "Brand Awareness",
    platform: "Facebook",
    status: "Paused",
    impressions: "45,678",
    clicks: "1,234",
    ctr: "2.7%",
    spent: "৳5,000",
    budget: "৳10,000",
    progress: 50,
  },
  {
    id: 4,
    name: "Retargeting Campaign",
    platform: "Instagram",
    status: "Completed",
    impressions: "200,000",
    clicks: "8,000",
    ctr: "4.0%",
    spent: "৳25,000",
    budget: "৳25,000",
    progress: 100,
  },
];

export default function AdsPage() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Ads Library</h2>
          <p className="text-muted-foreground">
            Manage and monitor your advertising campaigns
          </p>
        </div>
        <Button className="gap-2">
          <Plus size={18} />
          Create Campaign
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-card border-border">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Impressions</p>
                <p className="text-2xl font-bold text-foreground">460K</p>
              </div>
              <Megaphone className="h-8 w-8 text-primary" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Clicks</p>
                <p className="text-2xl font-bold text-chart-2">14.8K</p>
              </div>
              <MousePointer className="h-8 w-8 text-chart-2" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Avg. CTR</p>
                <p className="text-2xl font-bold text-chart-3">3.2%</p>
              </div>
              <BarChart2 className="h-8 w-8 text-chart-3" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Spent</p>
                <p className="text-2xl font-bold text-chart-4">৳53.5K</p>
              </div>
              <DollarSign className="h-8 w-8 text-chart-4" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
        <Input placeholder="Search campaigns..." className="pl-10" />
      </div>

      {/* Ads Table */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle>All Campaigns</CardTitle>
          <CardDescription>Monitor performance and manage your ad campaigns</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Campaign Name</TableHead>
                  <TableHead>Platform</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Impressions</TableHead>
                  <TableHead>Clicks</TableHead>
                  <TableHead>CTR</TableHead>
                  <TableHead>Budget</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ads.map((ad) => (
                  <TableRow key={ad.id}>
                    <TableCell className="font-medium">{ad.name}</TableCell>
                    <TableCell>{ad.platform}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          ad.status === "Running"
                            ? "default"
                            : ad.status === "Paused"
                            ? "secondary"
                            : "outline"
                        }
                        className={
                          ad.status === "Running"
                            ? "bg-chart-3 hover:bg-chart-3"
                            : ""
                        }
                      >
                        {ad.status}
                      </Badge>
                    </TableCell>
                    <TableCell>{ad.impressions}</TableCell>
                    <TableCell>{ad.clicks}</TableCell>
                    <TableCell>{ad.ctr}</TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <div className="text-sm">{ad.spent} / {ad.budget}</div>
                        <Progress value={ad.progress} className="h-1.5" />
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="icon">
                          <Eye size={16} />
                        </Button>
                        <Button variant="ghost" size="icon">
                          {ad.status === "Running" ? <Pause size={16} /> : <Play size={16} />}
                        </Button>
                        <Button variant="ghost" size="icon">
                          <BarChart2 size={16} />
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
    </div>
  );
}
