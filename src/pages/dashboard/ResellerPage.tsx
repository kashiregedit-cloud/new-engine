import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Plus, Search, Users, DollarSign, TrendingUp, Star, Edit, Trash2 } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

const resellers = [
  {
    id: 1,
    name: "Rahim Ahmed",
    email: "rahim@example.com",
    phone: "+880 1712-345678",
    status: "Active",
    sales: "৳125,000",
    commission: "৳12,500",
    clients: 25,
    rating: 4.8,
  },
  {
    id: 2,
    name: "Karim Hossain",
    email: "karim@example.com",
    phone: "+880 1812-345678",
    status: "Active",
    sales: "৳98,000",
    commission: "৳9,800",
    clients: 18,
    rating: 4.5,
  },
  {
    id: 3,
    name: "Fatima Begum",
    email: "fatima@example.com",
    phone: "+880 1912-345678",
    status: "Active",
    sales: "৳156,000",
    commission: "৳15,600",
    clients: 32,
    rating: 4.9,
  },
  {
    id: 4,
    name: "Jamal Uddin",
    email: "jamal@example.com",
    phone: "+880 1612-345678",
    status: "Inactive",
    sales: "৳45,000",
    commission: "৳4,500",
    clients: 8,
    rating: 4.2,
  },
];

export default function ResellerPage() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Reseller Management</h2>
          <p className="text-muted-foreground">
            Manage your reseller network and track performance
          </p>
        </div>
        <Button className="gap-2">
          <Plus size={18} />
          Add Reseller
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-card border-border">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Resellers</p>
                <p className="text-2xl font-bold text-foreground">4</p>
              </div>
              <Users className="h-8 w-8 text-primary" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Sales</p>
                <p className="text-2xl font-bold text-chart-3">৳424K</p>
              </div>
              <DollarSign className="h-8 w-8 text-chart-3" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Commission</p>
                <p className="text-2xl font-bold text-chart-2">৳42.4K</p>
              </div>
              <TrendingUp className="h-8 w-8 text-chart-2" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Clients</p>
                <p className="text-2xl font-bold text-chart-4">83</p>
              </div>
              <Star className="h-8 w-8 text-chart-4" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
        <Input placeholder="Search resellers..." className="pl-10" />
      </div>

      {/* Resellers Table */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle>All Resellers</CardTitle>
          <CardDescription>View and manage your reseller network</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reseller</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Sales</TableHead>
                  <TableHead>Commission</TableHead>
                  <TableHead>Clients</TableHead>
                  <TableHead>Rating</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {resellers.map((reseller) => (
                  <TableRow key={reseller.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="h-9 w-9">
                          <AvatarImage src="" />
                          <AvatarFallback className="bg-primary text-primary-foreground">
                            {reseller.name.charAt(0)}
                          </AvatarFallback>
                        </Avatar>
                        <span className="font-medium">{reseller.name}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">
                        <p>{reseller.email}</p>
                        <p className="text-muted-foreground">{reseller.phone}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={reseller.status === "Active" ? "default" : "secondary"}
                        className={reseller.status === "Active" ? "bg-chart-3 hover:bg-chart-3" : ""}
                      >
                        {reseller.status}
                      </Badge>
                    </TableCell>
                    <TableCell>{reseller.sales}</TableCell>
                    <TableCell>{reseller.commission}</TableCell>
                    <TableCell>{reseller.clients}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Star className="h-4 w-4 text-chart-4 fill-chart-4" />
                        <span>{reseller.rating}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="icon">
                          <Edit size={16} />
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

      {/* Add Reseller Form */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle>Add New Reseller</CardTitle>
          <CardDescription>Register a new reseller to your network</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="reseller-name">Full Name</Label>
              <Input id="reseller-name" placeholder="Enter full name" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reseller-email">Email</Label>
              <Input id="reseller-email" type="email" placeholder="email@example.com" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reseller-phone">Phone Number</Label>
              <Input id="reseller-phone" placeholder="+880 1XXX-XXXXXX" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reseller-commission">Commission Rate (%)</Label>
              <Input id="reseller-commission" type="number" placeholder="10" />
            </div>
          </div>
          <Button className="mt-6">Add Reseller</Button>
        </CardContent>
      </Card>
    </div>
  );
}
