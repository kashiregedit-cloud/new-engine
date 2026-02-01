import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { Calendar as CalendarIcon, Download, ShoppingBag } from "lucide-react";
import { toast } from "sonner";

export default function MessengerOrderTrackingPage() {
  const [orders, setOrders] = useState<any[]>([]);
  const [orderLoading, setOrderLoading] = useState(false);
  const [dateFilter, setDateFilter] = useState<'today' | 'yesterday' | 'custom'>('today');
  const [date, setDate] = useState<Date | undefined>(new Date());

  useEffect(() => {
    const fetchOrders = async () => {
      setOrderLoading(true);
      try {
        let query = (supabase.from('fb_order_tracking') as any).select('*').order('created_at', { ascending: false });
        
        // Filter by active page ID to prevent data leakage
        const activePageId = localStorage.getItem("active_fb_page_id");
        if (activePageId) {
           query = query.eq('page_id', activePageId);
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);

        if (dateFilter === 'today') {
           query = query.gte('created_at', today.toISOString()).lt('created_at', tomorrow.toISOString());
        } else if (dateFilter === 'yesterday') {
           query = query.gte('created_at', yesterday.toISOString()).lt('created_at', today.toISOString());
        } else if (dateFilter === 'custom' && date) {
           const customStart = new Date(date);
           customStart.setHours(0, 0, 0, 0);
           const customEnd = new Date(date);
           customEnd.setHours(23, 59, 59, 999);
           query = query.gte('created_at', customStart.toISOString()).lte('created_at', customEnd.toISOString());
        }

        const { data, error } = await query;
        if (error) throw error;
        setOrders(data || []);
      } catch (error) {
        console.error("Error fetching orders:", error);
        toast.error("Failed to fetch orders");
      } finally {
        setOrderLoading(false);
      }
    };

    fetchOrders();
  }, [dateFilter, date]);

  const downloadCSV = () => {
    if (!orders.length) {
      toast.error("No orders to export");
      return;
    }
    
    const headers = ["ID", "Product Name", "Number", "Location", "Quantity", "Price", "Date"];
    const csvContent = [
      headers.join(","),
      ...orders.map(order => [
        order.id,
        `"${order.product_name || ''}"`,
        order.number,
        `"${order.location || ''}"`,
        order.product_quantity,
        order.price,
        order.created_at
      ].join(","))
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `fb_orders_${dateFilter}_${format(new Date(), 'yyyy-MM-dd')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
           <h2 className="text-3xl font-bold tracking-tight">Messenger Order Tracking</h2>
           <p className="text-muted-foreground">
             View and manage customer orders collected by the Facebook bot.
           </p>
        </div>
      </div>

      <Card className="border-l-4 border-l-blue-500 shadow-md">
        <CardHeader>
           <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                  <CardTitle className="flex items-center gap-2">
                      <ShoppingBag className="h-5 w-5" />
                      Order List
                  </CardTitle>
                  <CardDescription>All orders within the selected period.</CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-6">
                  <Select value={dateFilter} onValueChange={(val: any) => setDateFilter(val)}>
                      <SelectTrigger className="w-[130px]">
                          <SelectValue placeholder="Filter" />
                      </SelectTrigger>
                      <SelectContent>
                          <SelectItem value="today">Today</SelectItem>
                          <SelectItem value="yesterday">Yesterday</SelectItem>
                          <SelectItem value="custom">Custom Date</SelectItem>
                      </SelectContent>
                  </Select>
                  
                  {dateFilter === 'custom' && (
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            variant={"outline"}
                            className={cn(
                              "w-[240px] justify-start text-left font-normal",
                              !date && "text-muted-foreground"
                            )}
                          >
                            <CalendarIcon className="mr-2 h-4 w-4" />
                            {date ? format(date, "PPP") : <span>Pick a date</span>}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0">
                          <Calendar
                            mode="single"
                            selected={date}
                            onSelect={setDate}
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
                  )}

                  <Button variant="outline" onClick={downloadCSV}>
                      <Download className="mr-2 h-4 w-4" />
                      CSV
                  </Button>
              </div>
           </div>
        </CardHeader>
        <CardContent>
          {orderLoading ? (
               <div className="flex justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary"></div>
               </div>
          ) : orders.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground border-2 border-dashed rounded-lg">
                  <ShoppingBag className="mx-auto h-12 w-12 opacity-20 mb-3" />
                  <p>No orders found for the selected period.</p>
              </div>
          ) : (
              <div className="rounded-md border overflow-hidden">
                  <Table>
                      <TableHeader className="bg-muted/50">
                          <TableRow>
                              <TableHead>Date</TableHead>
                              <TableHead>Product</TableHead>
                              <TableHead>Qty</TableHead>
                              <TableHead>Price</TableHead>
                              <TableHead>Location</TableHead>
                              <TableHead>Customer</TableHead>
                              <TableHead className="w-[50px]"></TableHead>
                          </TableRow>
                      </TableHeader>
                      <TableBody>
                          {orders.map((order) => (
                              <TableRow key={order.id} className="hover:bg-muted/50">
                                  <TableCell className="font-medium whitespace-nowrap">
                                      {format(new Date(order.created_at), "MMM d, HH:mm")}
                                  </TableCell>
                                  <TableCell className="font-medium">{order.product_name}</TableCell>
                                  <TableCell>{order.product_quantity}</TableCell>
                                  <TableCell>{order.price}</TableCell>
                                  <TableCell className="max-w-[200px]">
                                    <Popover>
                                      <PopoverTrigger asChild>
                                        <span className="truncate block cursor-pointer hover:underline text-primary" title="Click to view full address">
                                          {order.location}
                                        </span>
                                      </PopoverTrigger>
                                      <PopoverContent className="w-80">
                                        <div className="space-y-2">
                                          <h4 className="font-medium leading-none">Full Address</h4>
                                          <p className="text-sm text-muted-foreground break-words">{order.location}</p>
                                        </div>
                                      </PopoverContent>
                                    </Popover>
                                  </TableCell>
                                  <TableCell>{order.number}</TableCell>
                                  <TableCell>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      onClick={() => handleCopy(order)}
                                      title="Copy Order Details"
                                    >
                                      {copiedId === order.id ? (
                                        <Check className="h-4 w-4 text-green-500" />
                                      ) : (
                                        <Copy className="h-4 w-4" />
                                      )}
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
