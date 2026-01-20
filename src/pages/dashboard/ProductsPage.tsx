import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Plus, Search, Edit, Trash2, Package, Eye } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const products = [
  {
    id: 1,
    name: "Premium Chatbot Package",
    category: "Subscription",
    price: "৳5,000/mo",
    stock: "Unlimited",
    status: "Active",
  },
  {
    id: 2,
    name: "Basic Automation Plan",
    category: "Subscription",
    price: "৳2,500/mo",
    stock: "Unlimited",
    status: "Active",
  },
  {
    id: 3,
    name: "WhatsApp Integration",
    category: "Add-on",
    price: "৳1,000",
    stock: "Unlimited",
    status: "Active",
  },
  {
    id: 4,
    name: "Custom Bot Development",
    category: "Service",
    price: "৳15,000",
    stock: "10 slots",
    status: "Limited",
  },
  {
    id: 5,
    name: "Messenger Setup",
    category: "Service",
    price: "৳500",
    stock: "Unlimited",
    status: "Inactive",
  },
];

export default function ProductsPage() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Product Entry</h2>
          <p className="text-muted-foreground">
            Manage your products and services
          </p>
        </div>
        <Button className="gap-2">
          <Plus size={18} />
          Add Product
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-card border-border">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Products</p>
                <p className="text-2xl font-bold text-foreground">5</p>
              </div>
              <Package className="h-8 w-8 text-primary" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-sm text-muted-foreground">Active</p>
              <p className="text-2xl font-bold text-chart-3">3</p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-sm text-muted-foreground">Limited</p>
              <p className="text-2xl font-bold text-chart-4">1</p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-sm text-muted-foreground">Inactive</p>
              <p className="text-2xl font-bold text-chart-5">1</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
        <Input placeholder="Search products..." className="pl-10" />
      </div>

      {/* Products Table */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle>All Products</CardTitle>
          <CardDescription>View and manage your product catalog</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product Name</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>Stock</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.map((product) => (
                  <TableRow key={product.id}>
                    <TableCell className="font-medium">{product.name}</TableCell>
                    <TableCell>{product.category}</TableCell>
                    <TableCell>{product.price}</TableCell>
                    <TableCell>{product.stock}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          product.status === "Active"
                            ? "default"
                            : product.status === "Limited"
                            ? "secondary"
                            : "destructive"
                        }
                        className={
                          product.status === "Active"
                            ? "bg-chart-3 hover:bg-chart-3"
                            : product.status === "Limited"
                            ? "bg-chart-4 hover:bg-chart-4 text-foreground"
                            : ""
                        }
                      >
                        {product.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="icon">
                          <Eye size={16} />
                        </Button>
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

      {/* Add Product Form */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle>Add New Product</CardTitle>
          <CardDescription>Enter product details</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="product-name">Product Name</Label>
              <Input id="product-name" placeholder="Enter product name" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="product-category">Category</Label>
              <Input id="product-category" placeholder="Subscription, Add-on, Service" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="product-price">Price (৳)</Label>
              <Input id="product-price" placeholder="0.00" type="number" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="product-stock">Stock</Label>
              <Input id="product-stock" placeholder="Unlimited or quantity" />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="product-description">Description</Label>
              <Textarea id="product-description" placeholder="Enter product description" rows={4} />
            </div>
          </div>
          <Button className="mt-6">Add Product</Button>
        </CardContent>
      </Card>
    </div>
  );
}
