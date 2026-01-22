import { useState, useEffect, useCallback } from "react";
import { useWhatsApp } from "@/context/WhatsAppContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Loader2, Plus, QrCode, Trash2, Play, Pause, RefreshCw, Server, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { BACKEND_URL } from "@/config";
import { supabase } from "@/integrations/supabase/client";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function SessionManager() {
  const { sessions, refreshSessions, loading: listLoading } = useWhatsApp();
  const [newSessionName, setNewSessionName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [qrCodeUrl, setQrCodeUrl] = useState<string | null>(null);
  const [viewingSessionQr, setViewingSessionQr] = useState<string | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  
  // Modal States
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [sessionToDelete, setSessionToDelete] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Selection States
  const [selectedEngine, setSelectedEngine] = useState<"WEBJS" | "NOWEB">("WEBJS");
  const [selectedPlan, setSelectedPlan] = useState("30");

  const fetchBalance = useCallback(async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      
      const { data } = await supabase
        .from('user_configs')
        .select('balance')
        .eq('user_id', user.id)
        .maybeSingle();
      
      if (data) {
          setBalance((data as any).balance);
      }
  }, []);

  useEffect(() => {
    fetchBalance();
  }, [fetchBalance]);

  // Calculate Price
  const getPrice = () => {
    // Determine price based on selected engine and plan
    if (selectedEngine === "WEBJS") {
      if (selectedPlan === "30") return 2000;
      if (selectedPlan === "60") return 3500;
      if (selectedPlan === "90") return 4000;
    } else {
      // NOWAB (NOWEB)
      if (selectedPlan === "30") return 500;
      if (selectedPlan === "60") return 900;
      if (selectedPlan === "90") return 1500;
    }
    return 0;
  };

  const handleCreateSession = async () => {
    if (!newSessionName.trim()) {
      toast.error("Please enter a session name");
      return;
    }

    const price = getPrice();
    if (balance !== null && balance < price) {
        toast.error(`Insufficient Balance. You need ${price} BDT.`);
        return;
    }

    setIsCreating(true);
    setQrCodeUrl(null);
    try {
      let { data: { session } } = await supabase.auth.getSession();
      
      if (!session || !session.user || !session.access_token) {
        const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
        if (refreshError || !refreshData.session) {
             throw new Error("User session expired. Please logout and login again.");
        }
        session = refreshData.session;
      }

      const { data: { user: authUser } } = await supabase.auth.getUser();
      const user = authUser || session.user;
      
      if (!user?.email) throw new Error("User email not found. Please contact support.");

      const suffix = Math.random().toString(36).substring(2, 8);
      const finalSessionName = `${newSessionName.trim()}_${suffix}`;

      const payload = { 
        sessionName: finalSessionName,
        userEmail: user.email,
        userId: user.id,
        planDays: parseInt(selectedPlan), // Ensure number
        engine: selectedEngine
      };

      console.log("Creating session with payload:", payload);

      const res = await fetch(`${BACKEND_URL}/session/create`, {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            'Authorization': session?.access_token ? `Bearer ${session.access_token}` : ''
        },
        body: JSON.stringify(payload)
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create session');
      
      toast.success("Session created! Fetching QR Code...");
      fetchBalance(); 
      setShowCreateModal(false);
      setNewSessionName("");
      
      if (data.qr_code) {
          setQrCodeUrl(data.qr_code);
          setViewingSessionQr(finalSessionName);
      } else {
          fetchQr(finalSessionName);
      }
      
      await refreshSessions();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      toast.error(message);
    } finally {
      setIsCreating(false);
    }
  };

  const fetchQr = async (sessionName: string, retries = 3) => {
    try {
      setViewingSessionQr(sessionName);
      
      const { data } = await supabase
        .from('whatsapp_sessions')
        .select('qr_code')
        .eq('session_name', sessionName)
        .single();
      
      const sessionData = data as { qr_code: string | null } | null;
        
      if (sessionData && sessionData.qr_code) {
          setQrCodeUrl(sessionData.qr_code);
          return;
      }

      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${BACKEND_URL}/session/qr/${sessionName}?t=${Date.now()}`, {
          headers: {
              'Authorization': session?.access_token ? `Bearer ${session.access_token}` : ''
          }
      });
      
      if (res.ok) {
        const blob = await res.blob();
        if (blob.size > 0) {
            setQrCodeUrl(URL.createObjectURL(blob));
        }
      } else {
        if (retries > 0) {
            setTimeout(() => fetchQr(sessionName, retries - 1), 2000);
            return;
        }
        toast.error("QR Code not available yet");
      }
    } catch (e) {
      if (retries > 0) {
          setTimeout(() => fetchQr(sessionName, retries - 1), 2000);
          return;
      }
      console.error(e);
    }
  };

  const handleAction = async (action: 'start' | 'stop' | 'delete' | 'restart', sessionName: string) => {
    if (action === 'delete') {
        setSessionToDelete(sessionName);
        setShowDeleteModal(true);
        return;
    }

    // Direct action for start/stop/restart
    executeAction(action, sessionName);
  };

  const executeAction = async (action: 'start' | 'stop' | 'delete' | 'restart', sessionName: string) => {
    if (action === 'delete') setIsDeleting(true);
    
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${BACKEND_URL}/session/${action}`, {
        method: action === 'delete' ? 'DELETE' : 'POST',
        headers: { 
            'Content-Type': 'application/json',
            'Authorization': session?.access_token ? `Bearer ${session.access_token}` : ''
        },
        body: JSON.stringify({ sessionName })
      });
      
      if (!res.ok) throw new Error('Action failed');
      
      toast.success(`Session ${action}ed successfully`);
      
      if (action === 'restart') {
          setTimeout(async () => {
              await refreshSessions();
              fetchQr(sessionName);
          }, 3000);
      } else {
          await refreshSessions();
      }

      if (action === 'delete') {
          if (viewingSessionQr === sessionName) {
            setViewingSessionQr(null);
            setQrCodeUrl(null);
          }
          setShowDeleteModal(false);
          setSessionToDelete(null);
      }
    } catch (error: unknown) {
      toast.error(`Failed to ${action} session`);
    } finally {
      if (action === 'delete') setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
           <h2 className="text-3xl font-bold tracking-tight">WhatsApp Sessions</h2>
           <p className="text-muted-foreground">Create and manage your WhatsApp connections.</p>
        </div>
        <div className="flex gap-2 items-center">
          {balance !== null && (
              <Badge variant="outline" className="text-base px-3 py-1 border-green-200 bg-green-50 text-green-700">
                  Balance: {balance} BDT
              </Badge>
          )}
          <Button onClick={() => refreshSessions()} variant="outline" size="sm">
            <RefreshCw className={`mr-2 h-4 w-4 ${listLoading ? 'animate-spin' : ''}`} />
            Refresh List
          </Button>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {/* New Session Trigger Card */}
        <Card className="border-dashed border-2 border-slate-200 hover:border-green-500 hover:bg-green-50/10 cursor-pointer transition-all duration-300 flex flex-col items-center justify-center min-h-[300px] group shadow-sm hover:shadow-md" onClick={() => setShowCreateModal(true)}>
          <CardContent className="flex flex-col items-center gap-4 py-10">
              <div className="p-4 rounded-full bg-green-50 group-hover:bg-green-100 transition-colors">
                <Plus className="h-8 w-8 text-green-600" />
              </div>
              <div className="text-center">
                <h3 className="font-semibold text-lg text-slate-900">Create New Session</h3>
                <p className="text-sm text-muted-foreground mt-1">Add a new WhatsApp connection</p>
              </div>
          </CardContent>
        </Card>

        {/* Existing Sessions List */}
        {sessions.map((session) => (
          <Card key={session.name} className="relative overflow-hidden border-slate-200 shadow-sm hover:shadow-md transition-shadow">
            <div className={`absolute top-0 left-0 w-1 h-full ${session.status === 'WORKING' ? 'bg-green-500' : 'bg-yellow-500'}`} />
            <CardHeader className="pb-2 bg-slate-50/50">
              <div className="flex justify-between items-start">
                <CardTitle className="text-xl">{session.name}</CardTitle>
                <Badge variant={session.status === 'WORKING' ? 'default' : 'secondary'}>
                  {session.status}
                </Badge>
              </div>
              <CardDescription className="text-xs font-mono">ID: {String(session.id)}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex gap-2 mb-4">
                {session.status === 'STOPPED' ? (
                   <Button size="sm" variant="outline" className="w-full" onClick={() => handleAction('start', session.name)}>
                     <Play className="mr-2 h-4 w-4" /> Start
                   </Button>
                ) : (
                   <Button size="sm" variant="outline" className="w-full" onClick={() => handleAction('stop', session.name)}>
                     <Pause className="mr-2 h-4 w-4" /> Stop
                   </Button>
                )}
                
                <Button size="sm" variant="outline" className="w-full border-orange-200 hover:bg-orange-50 text-orange-600" onClick={() => handleAction('restart', session.name)}>
                    <RefreshCw className="mr-2 h-4 w-4" /> Restart
                </Button>

                <Button size="sm" variant="destructive" onClick={() => handleAction('delete', session.name)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              
              <Button 
                variant="secondary" 
                className="w-full" 
                onClick={() => fetchQr(session.name)}
                disabled={session.status === 'WORKING'}
              >
                <QrCode className="mr-2 h-4 w-4" /> 
                {session.status === 'WORKING' ? 'Connected' : 'Scan QR Code'}
              </Button>

              {viewingSessionQr === session.name && qrCodeUrl && session.status !== 'WORKING' && (
                <div className="mt-4 flex justify-center bg-white p-4 rounded-lg">
                  <img src={qrCodeUrl} alt="QR Code" className="w-48 h-48 object-contain" />
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* CREATE SESSION MODAL */}
      <Dialog open={showCreateModal} onOpenChange={setShowCreateModal}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Create New WhatsApp Session</DialogTitle>
            <DialogDescription>
              Configure your engine and subscription plan.
            </DialogDescription>
          </DialogHeader>
          
          <div className="grid gap-6 py-4">
            {/* Engine Selection */}
            <div className="space-y-3">
                <Label>Select Engine</Label>
                <Tabs defaultValue="WEBJS" onValueChange={(v) => setSelectedEngine(v as any)} className="w-full">
                    <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="WEBJS" className="flex gap-2">
                            <Zap className="w-4 h-4" /> WEBJS (Premium)
                        </TabsTrigger>
                        <TabsTrigger value="NOWEB" className="flex gap-2">
                            <Server className="w-4 h-4" /> NOWAB (Lite)
                        </TabsTrigger>
                    </TabsList>
                </Tabs>
                <p className="text-xs text-muted-foreground">
                    {selectedEngine === "WEBJS" 
                        ? "High performance, full browser simulation. Best for heavy usage." 
                        : "Lightweight, stable connection. Good for standard usage."}
                </p>
            </div>

            {/* Plan Selection */}
            <div className="space-y-3">
                <Label>Select Duration</Label>
                <div className="grid grid-cols-3 gap-3">
                    {["30", "60", "90"].map((plan) => {
                        const isSelected = selectedPlan === plan;
                        const price = selectedEngine === "WEBJS" 
                            ? (plan === "30" ? 2000 : plan === "60" ? 3500 : 4000)
                            : (plan === "30" ? 500 : plan === "60" ? 900 : 1500);

                        return (
                            <div 
                                key={plan}
                                onClick={() => setSelectedPlan(plan)}
                                className={`cursor-pointer rounded-lg border-2 p-4 text-center transition-all hover:border-green-500 ${
                                    isSelected ? "border-green-600 bg-green-50" : "border-muted"
                                }`}
                            >
                                <div className="text-lg font-bold">{plan} Days</div>
                                <div className="text-sm text-muted-foreground">{price} BDT</div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Session Name */}
            <div className="space-y-2">
                <Label>Session Name</Label>
                <Input 
                    placeholder="e.g. Support Bot 1" 
                    value={newSessionName}
                    onChange={(e) => setNewSessionName(e.target.value)}
                />
            </div>

            {/* Total Price */}
            <div className="flex items-center justify-between rounded-lg border p-4 bg-slate-50">
                <div className="flex flex-col">
                    <span className="text-sm font-medium">Total Cost</span>
                    <span className="text-xs text-muted-foreground">Deducted from balance</span>
                </div>
                <div className="text-2xl font-bold text-green-700">
                    {getPrice()} BDT
                </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateModal(false)}>Cancel</Button>
            <Button onClick={handleCreateSession} disabled={isCreating} className="bg-green-600 hover:bg-green-700">
                {isCreating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Pay & Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* DELETE CONFIRMATION MODAL */}
      <Dialog open={showDeleteModal} onOpenChange={setShowDeleteModal}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle className="text-red-600 flex items-center gap-2">
                <Trash2 className="h-5 w-5" /> Delete Session?
            </DialogTitle>
            <DialogDescription className="pt-2">
              Are you sure you want to delete <strong>{sessionToDelete}</strong>? 
              <br /><br />
              This action cannot be undone. It will disconnect the WhatsApp session and remove all associated data.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setShowDeleteModal(false)} disabled={isDeleting}>
                Cancel
            </Button>
            <Button 
                variant="destructive" 
                onClick={() => sessionToDelete && executeAction('delete', sessionToDelete)}
                disabled={isDeleting}
            >
                {isDeleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Delete Session"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
