import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { CreditCard, Wallet, Plus, History, CheckCircle, Clock, XCircle, ArrowUpRight, ArrowDownLeft } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const transactions = [
  {
    id: "TXN001",
    type: "topup",
    amount: "৳5,000",
    method: "bKash",
    status: "Completed",
    date: "2024-01-15 10:30 AM",
  },
  {
    id: "TXN002",
    type: "payment",
    amount: "৳2,500",
    method: "Balance",
    status: "Completed",
    date: "2024-01-14 02:15 PM",
  },
  {
    id: "TXN003",
    type: "topup",
    amount: "৳10,000",
    method: "Nagad",
    status: "Pending",
    date: "2024-01-13 11:45 AM",
  },
  {
    id: "TXN004",
    type: "payment",
    amount: "৳1,000",
    method: "Balance",
    status: "Failed",
    date: "2024-01-12 04:20 PM",
  },
];

const topupAmounts = [1000, 2000, 5000, 10000, 20000, 50000];

export default function PaymentPage() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-foreground">Payment / Topup</h2>
        <p className="text-muted-foreground">
          Manage your balance and payment methods
        </p>
      </div>

      {/* Balance Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-gradient-to-br from-primary to-primary/80 text-primary-foreground">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm opacity-80">Current Balance</p>
                <p className="text-3xl font-bold">৳12,500</p>
              </div>
              <Wallet className="h-10 w-10 opacity-80" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Spent</p>
                <p className="text-2xl font-bold text-foreground">৳45,000</p>
              </div>
              <ArrowUpRight className="h-8 w-8 text-chart-5" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Topup</p>
                <p className="text-2xl font-bold text-chart-3">৳57,500</p>
              </div>
              <ArrowDownLeft className="h-8 w-8 text-chart-3" />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Topup Section */}
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5" />
              Add Balance
            </CardTitle>
            <CardDescription>Select amount and payment method</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Quick Amounts */}
            <div>
              <Label className="text-sm font-medium">Quick Select</Label>
              <div className="grid grid-cols-3 gap-2 mt-2">
                {topupAmounts.map((amount) => (
                  <Button key={amount} variant="outline" className="w-full">
                    ৳{amount.toLocaleString()}
                  </Button>
                ))}
              </div>
            </div>

            {/* Custom Amount */}
            <div className="space-y-2">
              <Label htmlFor="custom-amount">Or Enter Custom Amount</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">৳</span>
                <Input id="custom-amount" type="number" placeholder="0" className="pl-8" />
              </div>
            </div>

            {/* Payment Method */}
            <div className="space-y-2">
              <Label>Payment Method</Label>
              <RadioGroup defaultValue="bkash" className="grid grid-cols-2 gap-2">
                <div>
                  <RadioGroupItem value="bkash" id="bkash" className="peer sr-only" />
                  <Label
                    htmlFor="bkash"
                    className="flex items-center justify-center rounded-lg border-2 border-border p-3 hover:bg-secondary peer-data-[state=checked]:border-primary cursor-pointer"
                  >
                    bKash
                  </Label>
                </div>
                <div>
                  <RadioGroupItem value="nagad" id="nagad" className="peer sr-only" />
                  <Label
                    htmlFor="nagad"
                    className="flex items-center justify-center rounded-lg border-2 border-border p-3 hover:bg-secondary peer-data-[state=checked]:border-primary cursor-pointer"
                  >
                    Nagad
                  </Label>
                </div>
                <div>
                  <RadioGroupItem value="rocket" id="rocket" className="peer sr-only" />
                  <Label
                    htmlFor="rocket"
                    className="flex items-center justify-center rounded-lg border-2 border-border p-3 hover:bg-secondary peer-data-[state=checked]:border-primary cursor-pointer"
                  >
                    Rocket
                  </Label>
                </div>
                <div>
                  <RadioGroupItem value="card" id="card" className="peer sr-only" />
                  <Label
                    htmlFor="card"
                    className="flex items-center justify-center rounded-lg border-2 border-border p-3 hover:bg-secondary peer-data-[state=checked]:border-primary cursor-pointer"
                  >
                    <CreditCard size={16} className="mr-2" />
                    Card
                  </Label>
                </div>
              </RadioGroup>
            </div>

            <Button className="w-full">Proceed to Payment</Button>
          </CardContent>
        </Card>

        {/* Payment Instructions */}
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle>Payment Instructions</CardTitle>
            <CardDescription>How to complete your payment</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="p-4 rounded-lg bg-secondary">
              <h4 className="font-medium text-foreground mb-2">bKash / Nagad / Rocket</h4>
              <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
                <li>Select the amount and payment method</li>
                <li>Send money to: <span className="font-mono text-foreground">01712-XXXXXX</span></li>
                <li>Enter the Transaction ID below</li>
                <li>Wait for confirmation (usually within 5 minutes)</li>
              </ol>
            </div>

            <div className="space-y-2">
              <Label htmlFor="txn-id">Transaction ID</Label>
              <Input id="txn-id" placeholder="Enter your transaction ID" />
            </div>

            <Button variant="outline" className="w-full">Submit for Verification</Button>
          </CardContent>
        </Card>
      </div>

      {/* Transaction History */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            Transaction History
          </CardTitle>
          <CardDescription>Your recent transactions and payments</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Transaction ID</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.map((txn) => (
                  <TableRow key={txn.id}>
                    <TableCell className="font-mono">{txn.id}</TableCell>
                    <TableCell>
                      <Badge variant={txn.type === "topup" ? "default" : "secondary"}>
                        {txn.type === "topup" ? "Topup" : "Payment"}
                      </Badge>
                    </TableCell>
                    <TableCell className={txn.type === "topup" ? "text-chart-3" : "text-chart-5"}>
                      {txn.type === "topup" ? "+" : "-"}{txn.amount}
                    </TableCell>
                    <TableCell>{txn.method}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {txn.status === "Completed" && <CheckCircle className="h-4 w-4 text-chart-3" />}
                        {txn.status === "Pending" && <Clock className="h-4 w-4 text-chart-4" />}
                        {txn.status === "Failed" && <XCircle className="h-4 w-4 text-chart-5" />}
                        <span>{txn.status}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{txn.date}</TableCell>
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
