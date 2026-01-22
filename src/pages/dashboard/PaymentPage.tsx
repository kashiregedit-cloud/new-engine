import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { CreditCard, Wallet, Plus, History, CheckCircle, Clock, XCircle, Loader2, Gift, Copy } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Database } from "@/integrations/supabase/types";

// Override Transaction type to match the new schema
type Transaction = {
  id: string;
  user_email: string;
  amount: number;
  method: string;
  trx_id: string;
  sender_number: string;
  status: string;
  created_at: string;
};

const topupAmounts = [500, 1000, 2000, 5000, 10000];

export default function PaymentPage() {
  const [balance, setBalance] = useState(0);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [customAmount, setCustomAmount] = useState("");
  const [selectedMethod, setSelectedMethod] = useState("bkash");
  const [transactionId, setTransactionId] = useState("");
  const [senderNumber, setSenderNumber] = useState("");
  const [submitting, setSubmitting] = useState(false);
  
  // Redeem State
  const [redeemCode, setRedeemCode] = useState("");
  const [redeeming, setRedeeming] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Fetch Balance
      const { data: configData } = await supabase
        .from('user_configs')
        .select('balance')
        .eq('user_id', user.id)
        .maybeSingle();
      
      const config = configData as { balance: number } | null;
      
      setBalance(config?.balance || 0);

      // Fetch Transactions
      const { data: txns } = await supabase
        .from('payment_transactions')
        .select('*')
        .eq('user_email', user.email)
        .order('created_at', { ascending: false });
      
      if (txns) setTransactions(txns as unknown as Transaction[]);

    } catch (error) {
      console.error(error);
      toast.error("Failed to load payment data");
    } finally {
      setLoading(false);
    }
  };

  const handleDeposit = async () => {
    if (!transactionId.trim()) {
        toast.error("Please enter Transaction ID");
        return;
    }
    
    if (!senderNumber.trim()) {
        toast.error("Please enter Sender Number");
        return;
    }

    // Determine amount
    const amount = parseFloat(customAmount);
    if (!amount || amount <= 0) {
        toast.error("Please enter a valid amount (Min 300 BDT)");
        return;
    }

    if (amount < 300) {
        toast.error("Minimum deposit is 300 BDT");
        return;
    }

    try {
        setSubmitting(true);
        const { data: { user } } = await supabase.auth.getUser();
        
        if (!user) throw new Error("User not found");

        const { error } = await (supabase as any).from('payment_transactions').insert({
            user_email: user.email,
            amount: amount,
            method: selectedMethod,
            status: 'pending',
            trx_id: transactionId,
            sender_number: senderNumber
        });

        if (error) throw error;

        toast.success("Deposit request submitted! Waiting for admin approval.");
        setTransactionId("");
        setSenderNumber("");
        setCustomAmount("");
        fetchData(); // Refresh list
    } catch (e: any) {
        console.error("Deposit Error:", e);
        const message = e?.message || (e instanceof Error ? e.message : "Unknown error");
        toast.error("Failed to submit deposit: " + message);
    } finally {
        setSubmitting(false);
    }
  };

  const handleRedeem = async () => {
    if (!redeemCode.trim()) {
      toast.error("Please enter a code");
      return;
    }

    setRedeeming(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Check code
      const { data: rawCodeData, error: codeError } = await supabase
        .from('referral_codes')
        .select('*')
        .eq('code', redeemCode)
        .eq('status', 'active')
        .maybeSingle();

      const codeData = rawCodeData as Database['public']['Tables']['referral_codes']['Row'] | null;

      if (codeError || !codeData) {
        toast.error("Invalid or inactive code");
        setRedeeming(false);
        return;
      }

      if (codeData.type !== 'balance') {
        toast.error("This code is not for balance topup");
        setRedeeming(false);
        return;
      }

      // Add balance
      const amount = Number(codeData.value);
      
      // Update balance
      const { error: balanceError } = await (supabase as any)
        .from('user_configs')
        .update({ balance: balance + amount })
        .eq('user_id', user.id);

      if (balanceError) throw balanceError;

      // Mark code as used (inactive)
      await (supabase as any)
        .from('referral_codes')
        .update({ status: 'inactive' })
        .eq('id', codeData.id);

      // Log transaction
      await (supabase as any).from('payment_transactions').insert({
        user_email: user.email,
        amount: amount,
        method: 'coupon',
        status: 'completed',
        trx_id: `COUPON-${redeemCode}`,
        sender_number: 'System'
      });

      toast.success(`Successfully redeemed ${amount} BDT!`);
      setRedeemCode("");
      fetchData();

    } catch (error: unknown) {
      console.error(error);
      const message = error instanceof Error ? error.message : "Unknown error";
      toast.error("Redemption failed: " + message);
    } finally {
      setRedeeming(false);
    }
  };

  const handleQuickSelect = (amount: number) => {
      setCustomAmount(amount.toString());
  };

  const copyNumber = () => {
      navigator.clipboard.writeText("01956871403");
      toast.success("Number copied to clipboard");
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-foreground">Payment / Topup</h2>
        <p className="text-muted-foreground">
          Manage your balance and payment methods
        </p>
      </div>

      {/* Balance Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-gradient-to-br from-primary to-primary/80 text-primary-foreground border-none shadow-lg">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm opacity-80 font-medium">Available Balance</p>
                <p className="text-4xl font-bold mt-1">৳{balance.toLocaleString()}</p>
              </div>
              <Wallet className="h-10 w-10 opacity-80" />
            </div>
            <p className="text-xs opacity-60 mt-4">Last updated just now</p>
          </CardContent>
        </Card>
        
        {/* Redeem Code Card */}
        <Card className="md:col-span-2 bg-card border-border">
            <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                    <Gift className="h-4 w-4 text-primary" />
                    Redeem Coupon
                </CardTitle>
            </CardHeader>
            <CardContent>
                <div className="flex gap-2">
                    <Input 
                        placeholder="Enter coupon code" 
                        value={redeemCode}
                        onChange={(e) => setRedeemCode(e.target.value)}
                    />
                    <Button onClick={handleRedeem} disabled={redeeming}>
                        {redeeming ? <Loader2 className="h-4 w-4 animate-spin" /> : "Redeem"}
                    </Button>
                </div>
            </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Topup Section */}
        <Card className="bg-card border-border shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5" />
              Manual Deposit
            </CardTitle>
            <CardDescription>Add funds via mobile banking</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            
            {/* Payment Method */}
            <div className="space-y-3">
              <Label>Select Method</Label>
              <RadioGroup value={selectedMethod} onValueChange={setSelectedMethod} className="grid grid-cols-3 gap-2">
                <div>
                  <RadioGroupItem value="bkash" id="bkash" className="peer sr-only" />
                  <Label
                    htmlFor="bkash"
                    className="flex flex-col items-center justify-center rounded-xl border-2 border-border p-4 hover:bg-secondary peer-data-[state=checked]:border-[#e2136e] peer-data-[state=checked]:bg-[#e2136e]/5 cursor-pointer transition-all"
                  >
                    <span className="font-bold text-[#e2136e]">bKash</span>
                  </Label>
                </div>
                <div>
                  <RadioGroupItem value="nagad" id="nagad" className="peer sr-only" />
                  <Label
                    htmlFor="nagad"
                    className="flex flex-col items-center justify-center rounded-xl border-2 border-border p-4 hover:bg-secondary peer-data-[state=checked]:border-[#ec1d24] peer-data-[state=checked]:bg-[#ec1d24]/5 cursor-pointer transition-all"
                  >
                    <span className="font-bold text-[#ec1d24]">Nagad</span>
                  </Label>
                </div>
                <div>
                  <RadioGroupItem value="rocket" id="rocket" className="peer sr-only" />
                  <Label
                    htmlFor="rocket"
                    className="flex flex-col items-center justify-center rounded-xl border-2 border-border p-4 hover:bg-secondary peer-data-[state=checked]:border-[#8c3494] peer-data-[state=checked]:bg-[#8c3494]/5 cursor-pointer transition-all"
                  >
                    <span className="font-bold text-[#8c3494]">Rocket</span>
                  </Label>
                </div>
              </RadioGroup>
            </div>

             {/* Payment Details Box */}
             <div className={`p-6 rounded-xl border transition-colors ${
                 selectedMethod === 'bkash' ? 'bg-[#e2136e]/10 border-[#e2136e]/20' :
                 selectedMethod === 'nagad' ? 'bg-[#ec1d24]/10 border-[#ec1d24]/20' :
                 'bg-[#8c3494]/10 border-[#8c3494]/20'
             }`}>
               <div className="text-center">
                   <p className="text-xs font-bold uppercase tracking-widest opacity-70 mb-2">Send Money (Personal)</p>
                   <div className="flex items-center justify-center gap-3 mb-2">
                       <h2 className="text-3xl font-black font-mono tracking-wider">01956871403</h2>
                       <Button size="icon" variant="ghost" className="h-8 w-8 hover:bg-background/20" onClick={copyNumber}>
                           <Copy className="h-4 w-4" />
                       </Button>
                   </div>
                   <p className="text-xs opacity-60">Copy this number and send money</p>
               </div>
            </div>

            {/* Quick Amounts */}
            <div>
              <Label className="text-sm font-medium">Select Amount</Label>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mt-2">
                {topupAmounts.map((amount) => (
                  <Button 
                    key={amount} 
                    variant={customAmount === amount.toString() ? "default" : "outline"} 
                    className="w-full text-xs sm:text-sm" 
                    onClick={() => handleQuickSelect(amount)}
                  >
                    ৳{amount}
                  </Button>
                ))}
              </div>
            </div>

            {/* Custom Amount */}
            <div className="space-y-2">
              <Label htmlFor="custom-amount">Amount (BDT)</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-bold">৳</span>
                <Input 
                    id="custom-amount" 
                    type="number" 
                    placeholder="Min 300" 
                    className="pl-8 font-mono font-bold" 
                    value={customAmount}
                    onChange={(e) => setCustomAmount(e.target.value)}
                />
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                <Label htmlFor="sender-number">Sender Number</Label>
                <Input 
                    id="sender-number" 
                    placeholder="e.g. 017..." 
                    value={senderNumber}
                    onChange={(e) => setSenderNumber(e.target.value)}
                />
                </div>

                <div className="space-y-2">
                <Label htmlFor="txn-id">Transaction ID</Label>
                <Input 
                    id="txn-id" 
                    placeholder="e.g. 9H7S..." 
                    value={transactionId}
                    onChange={(e) => setTransactionId(e.target.value)}
                />
                </div>
            </div>

            <Button className="w-full font-bold h-12 text-base" onClick={handleDeposit} disabled={submitting}>
                {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Verify Payment"}
            </Button>
          </CardContent>
        </Card>

        {/* Transaction History */}
        <Card className="bg-card border-border h-full shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <History className="h-5 w-5" />
                History
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-auto max-h-[600px] pr-2">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Details</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {transactions.length === 0 ? (
                        <TableRow>
                            <TableCell colSpan={2} className="text-center py-8 text-muted-foreground">No transactions found</TableCell>
                        </TableRow>
                    ) : (
                        transactions.map((txn) => (
                        <TableRow key={txn.id} className="group">
                            <TableCell>
                                <div className="flex flex-col gap-1">
                                    <div className="flex items-center gap-2">
                                        <Badge variant="outline" className="text-[10px] px-1 py-0 h-5">
                                            {txn.method}
                                        </Badge>
                                        <span className="text-sm font-medium">{txn.trx_id || "System"}</span>
                                    </div>
                                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                        <span>{new Date(txn.created_at).toLocaleDateString()}</span>
                                        <span>•</span>
                                        <div className={`flex items-center gap-1 ${
                                            txn.status === "completed" ? "text-green-500" :
                                            txn.status === "pending" ? "text-yellow-500" : "text-red-500"
                                        }`}>
                                            {txn.status === "completed" && <CheckCircle className="h-3 w-3" />}
                                            {txn.status === "pending" && <Clock className="h-3 w-3" />}
                                            {txn.status === "failed" && <XCircle className="h-3 w-3" />}
                                            <span className="capitalize">{txn.status}</span>
                                        </div>
                                    </div>
                                </div>
                            </TableCell>
                            <TableCell className="text-right">
                                <span className="font-mono font-bold text-green-600">
                                    +৳{txn.amount}
                                </span>
                            </TableCell>
                        </TableRow>
                        ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
        </Card>
      </div>
    </div>
  );
}
