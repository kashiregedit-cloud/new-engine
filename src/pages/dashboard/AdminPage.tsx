import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Shield, Users, Settings, Database as DatabaseIcon, Activity, AlertTriangle, Trash2, Edit, Ban, CheckCircle, CreditCard, DollarSign, Loader2, XCircle } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Database } from "@/integrations/supabase/types";

// Override Transaction type to match the new schema provided by user
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

type Coupon = Database['public']['Tables']['referral_codes']['Row'];

export default function AdminPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loadingTxns, setLoadingTxns] = useState(false);
  const [loadingCoupons, setLoadingCoupons] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);

  // Login State
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [usernameInput, setUsernameInput] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);

  // Coupon Form
  const [couponCode, setCouponCode] = useState("");
  const [couponValue, setCouponValue] = useState("");

  useEffect(() => {
    if (isAuthenticated) {
      fetchTransactions();
      fetchCoupons();
    }
  }, [isAuthenticated]);

  const handleLogin = async () => {
    if (!usernameInput || !passwordInput) {
      toast.error("Please enter username and password");
      return;
    }

    setLoginLoading(true);
    try {
      // Query 'app_users' table
      const { data, error } = await (supabase as any)
        .from('app_users')
        .select('*')
        .eq('key', usernameInput)
        .eq('pas', passwordInput)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        setIsAuthenticated(true);
        toast.success("Login successful");
      } else {
        toast.error("Invalid credentials");
      }
    } catch (error: any) {
      console.error(error);
      toast.error("Login failed: " + (error.message || "Unknown error"));
    } finally {
      setLoginLoading(false);
    }
  };

  const fetchTransactions = async () => {
    setLoadingTxns(true);
    const { data } = await supabase
      .from('payment_transactions')
      .select('*')
      .order('created_at', { ascending: false });
    if (data) setTransactions(data as unknown as Transaction[]);
    setLoadingTxns(false);
  };

  const fetchCoupons = async () => {
    setLoadingCoupons(true);
    const { data } = await supabase
      .from('referral_codes')
      .select('*')
      .order('created_at', { ascending: false });
    if (data) setCoupons(data);
    setLoadingCoupons(false);
  };

  const handleApproveTxn = async (txn: any) => {
    try {
      setProcessingId(txn.id);
      
      // 1. Find User ID using email (Lookup from whatsapp_sessions)
      const { data: sessionData } = await supabase
        .from('whatsapp_sessions')
        .select('user_id')
        .eq('user_email', txn.user_email)
        .limit(1)
        .maybeSingle();

      let userId = null;
      if (sessionData) {
          userId = (sessionData as any).user_id;
      }

      if (!userId) {
          // Try to see if maybe user_id is actually stored in the txn (if schema was mixed)
          // But based on user input, it's not there.
          toast.error(`Could not find User ID for ${txn.user_email}. User needs active session.`);
          return;
      }

      // 2. Update Transaction Status
      const { error: txError } = await (supabase as any)
        .from('payment_transactions')
        .update({ status: 'completed' })
        .eq('id', txn.id);
      
      if (txError) throw txError;

      // 3. Add Balance to User
      const { data: userConfigData } = await (supabase as any)
        .from('user_configs')
        .select('balance')
        .eq('user_id', userId)
        .maybeSingle();

      const userConfig = userConfigData as { balance: number } | null;

      const currentBalance = userConfig ? (userConfig.balance || 0) : 0;
      const newBalance = currentBalance + Number(txn.amount);

      if (userConfig) {
        await (supabase as any)
          .from('user_configs')
          .update({ balance: newBalance })
          .eq('user_id', userId);
      } else {
        await (supabase as any)
          .from('user_configs')
          .insert({ user_id: userId, balance: newBalance });
      }

      toast.success(`Transaction approved. Added ${txn.amount} BDT to user.`);
      fetchTransactions();

    } catch (error: unknown) {
      console.error(error);
      const message = error instanceof Error ? error.message : "Unknown error";
      toast.error("Failed to approve: " + message);
    } finally {
      setProcessingId(null);
    }
  };

  const handleRejectTxn = async (txn: Transaction) => {
    try {
      setProcessingId(txn.id);
      const { error } = await (supabase as any)
        .from('payment_transactions')
        .update({ status: 'failed' })
        .eq('id', txn.id);
      
      if (error) throw error;
      
      toast.success("Transaction rejected.");
      fetchTransactions();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      toast.error("Failed to reject: " + message);
    } finally {
      setProcessingId(null);
    }
  };

  const handleCreateCoupon = async () => {
    if (!couponCode || !couponValue) {
      toast.error("Please fill all fields");
      return;
    }

    try {
      const { error } = await (supabase as any).from('referral_codes').insert({
        code: couponCode,
        value: Number(couponValue),
        type: 'balance',
        status: 'active'
      });

      if (error) throw error;

      toast.success("Coupon created!");
      setCouponCode("");
      setCouponValue("");
      fetchCoupons();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      toast.error("Failed to create coupon: " + message);
    }
  };

  const toggleCouponStatus = async (coupon: Coupon) => {
    const newStatus = coupon.status === 'active' ? 'inactive' : 'active';
    await (supabase as any).from('referral_codes').update({ status: newStatus }).eq('id', coupon.id);
    fetchCoupons();
  };

  if (!isAuthenticated) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] animate-in fade-in duration-500">
        <Card className="w-full max-w-md shadow-lg border-t-4 border-t-primary">
          <CardHeader className="text-center space-y-2">
            <Shield className="h-12 w-12 mx-auto text-primary" />
            <CardTitle className="text-2xl">Admin Login</CardTitle>
            <CardDescription>Secure Area. Please authenticate.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Username (Key)</Label>
              <Input 
                value={usernameInput} 
                onChange={e => setUsernameInput(e.target.value)} 
                placeholder="Enter admin key"
                onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
              />
            </div>
            <div className="space-y-2">
              <Label>Password</Label>
              <Input 
                type="password" 
                value={passwordInput} 
                onChange={e => setPasswordInput(e.target.value)} 
                placeholder="Enter password"
                onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
              />
            </div>
            <Button className="w-full font-bold" onClick={handleLogin} disabled={loginLoading}>
              {loginLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Access Dashboard"}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with Warning */}
      <div className="flex items-center gap-4 p-4 bg-destructive/10 rounded-lg border border-destructive/20">
        <Shield className="h-8 w-8 text-destructive" />
        <div>
          <h2 className="text-xl font-bold text-foreground">Admin Control Panel</h2>
          <p className="text-sm text-muted-foreground">
            Manage payments, users, and system settings.
          </p>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="payments" className="space-y-4">
        <TabsList className="bg-secondary">
          <TabsTrigger value="payments">Payments</TabsTrigger>
          <TabsTrigger value="coupons">Coupons</TabsTrigger>
          <TabsTrigger value="users">User Management</TabsTrigger>
          <TabsTrigger value="system">System Settings</TabsTrigger>
        </TabsList>

        {/* Payments Tab */}
        <TabsContent value="payments">
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle>Transaction Requests</CardTitle>
              <CardDescription>Approve or reject deposit requests</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>User Email</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Details</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loadingTxns ? (
                       <TableRow><TableCell colSpan={6} className="text-center">Loading...</TableCell></TableRow>
                    ) : transactions.length === 0 ? (
                       <TableRow><TableCell colSpan={6} className="text-center">No transactions found</TableCell></TableRow>
                    ) : (
                      transactions.map((txn: any) => (
                        <TableRow key={txn.id}>
                          <TableCell className="font-medium text-sm">{txn.user_email}</TableCell>
                          <TableCell className="capitalize">{txn.method}</TableCell>
                          <TableCell className="font-bold text-green-600">৳{txn.amount}</TableCell>
                          <TableCell>
                            <div className="text-xs">
                              <p>TRX: {txn.trx_id}</p>
                              <p className="text-muted-foreground">Sender: {txn.sender_number}</p>
                              <p className="text-muted-foreground">{new Date(txn.created_at).toLocaleString()}</p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant={txn.status === 'completed' ? 'default' : txn.status === 'pending' ? 'secondary' : 'destructive'}>
                              {txn.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            {txn.status === 'pending' && (
                              <div className="flex justify-end gap-2">
                                <Button 
                                  size="sm" 
                                  variant="outline" 
                                  className="text-green-600 border-green-200 hover:bg-green-50"
                                  onClick={() => handleApproveTxn(txn)}
                                  disabled={processingId === txn.id}
                                >
                                  {processingId === txn.id ? <Loader2 className="h-4 w-4 animate-spin"/> : <CheckCircle className="h-4 w-4" />}
                                </Button>
                                <Button 
                                  size="sm" 
                                  variant="outline" 
                                  className="text-red-600 border-red-200 hover:bg-red-50"
                                  onClick={() => handleRejectTxn(txn)}
                                  disabled={processingId === txn.id}
                                >
                                  {processingId === txn.id ? <Loader2 className="h-4 w-4 animate-spin"/> : <XCircle className="h-4 w-4" />}
                                </Button>
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Coupons Tab */}
        <TabsContent value="coupons">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="bg-card border-border md:col-span-1">
              <CardHeader>
                <CardTitle>Create Coupon</CardTitle>
                <CardDescription>Add new balance codes</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Coupon Code</Label>
                  <Input placeholder="e.g. WELCOME500" value={couponCode} onChange={(e) => setCouponCode(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Value (BDT)</Label>
                  <Input type="number" placeholder="500" value={couponValue} onChange={(e) => setCouponValue(e.target.value)} />
                </div>
                <Button className="w-full" onClick={handleCreateCoupon}>Create Code</Button>
              </CardContent>
            </Card>

            <Card className="bg-card border-border md:col-span-2">
              <CardHeader>
                <CardTitle>Active Coupons</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Code</TableHead>
                      <TableHead>Value</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loadingCoupons ? (
                         <TableRow><TableCell colSpan={4}>Loading...</TableCell></TableRow>
                    ) : coupons.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="font-mono font-bold">{c.code}</TableCell>
                        <TableCell>৳{c.value}</TableCell>
                        <TableCell>
                          <Badge variant={c.status === 'active' ? 'default' : 'secondary'}>{c.status}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button size="sm" variant="ghost" onClick={() => toggleCouponStatus(c)}>
                            {c.status === 'active' ? 'Deactivate' : 'Activate'}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Users Tab (Placeholder) */}
        <TabsContent value="users">
          <Card>
            <CardHeader><CardTitle>User Management</CardTitle></CardHeader>
            <CardContent><p className="text-muted-foreground">User management features coming soon.</p></CardContent>
          </Card>
        </TabsContent>

        {/* System Tab (Placeholder) */}
        <TabsContent value="system">
           <Card>
            <CardHeader><CardTitle>System Settings</CardTitle></CardHeader>
            <CardContent><p className="text-muted-foreground">System settings coming soon.</p></CardContent>
          </Card>
        </TabsContent>

      </Tabs>
    </div>
  );
}
