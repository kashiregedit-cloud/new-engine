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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
  const [loadingSession, setLoadingSession] = useState<{ name: string; action: string } | null>(null);
  
  // Renew States
  const [showRenewModal, setShowRenewModal] = useState(false);
  const [sessionToRenew, setSessionToRenew] = useState<string | null>(null);
  const [isRenewing, setIsRenewing] = useState(false);

  // Selection States
  const [selectedEngine, setSelectedEngine] = useState<"WEBJS" | "NOWEB">("WEBJS");
  const [selectedPlan, setSelectedPlan] = useState("30");

  // Create Session States
  // const [createCountryCode, setCreateCountryCode] = useState("+880"); // Removed

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

  // Poll for updates when QR dialog is open
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (viewingSessionQr) {
      interval = setInterval(refreshSessions, 3000); // Poll every 3s
    }
    return () => clearInterval(interval);
  }, [viewingSessionQr, refreshSessions]);

  // Poll for QR code specifically if it's missing in the active dialog
  useEffect(() => {
    let interval: NodeJS.Timeout;
    // We poll if:
    // 1. We are viewing a session
    // 2. The QR code is missing OR we just want to keep it fresh
    // 3. The session is NOT working (no need to poll if connected)
    if (viewingSessionQr) {
      const fetchQr = async () => {
          try {
              const res = await fetch(`${BACKEND_URL}/whatsapp/session/qr/${viewingSessionQr}`);
              const data = await res.json();
              if (data.qr_code) {
                  setQrCodeUrl(data.qr_code);
              }
          } catch (e) {
              console.error("Error polling QR:", e);
          }
      };
      
      fetchQr(); // Initial call
      interval = setInterval(fetchQr, 3000); // Poll every 3s
    }
    return () => clearInterval(interval);
  }, [viewingSessionQr]);

  // Calculate Price
  const getPrice = () => {
    // Determine price based on selected engine and plan
    if (selectedEngine === "WEBJS") {
      if (selectedPlan === "2") return 200; // Demo
      if (selectedPlan === "30") return 2000;
      if (selectedPlan === "60") return 3500;
      if (selectedPlan === "90") return 4000;
    } else {
      // NOWAB (NOWEB)
      if (selectedPlan === "2") return 100; // Demo
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
      // Sanitize session name: remove spaces, special chars
      const sanitizedName = newSessionName.trim().replace(/[^a-zA-Z0-9]/g, '_');
      const finalSessionName = `${sanitizedName}_${suffix}`;

      const payload = { 
        sessionName: finalSessionName,
        userEmail: user.email,
        userId: user.id,
        planDays: parseInt(selectedPlan), // Ensure number
        engine: selectedEngine
      };

      console.log("Creating session with payload:", payload);

      const res = await fetch(`${BACKEND_URL}/whatsapp/session/create`, {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            'Authorization': session?.access_token ? `Bearer ${session.access_token}` : ''
        },
        body: JSON.stringify(payload)
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create session');
      
      toast.success("Session created!");
      
      // Auto-connect database
      if (data.wp_db_id) {
          const dbIdStr = String(data.wp_db_id);
          localStorage.setItem("active_wp_db_id", dbIdStr);
          // Dispatch event for same-tab updates
          window.dispatchEvent(new Event("db-connection-changed"));
          toast.success(`Database Connected: ID ${data.wp_db_id}`);
      }

      fetchBalance(); 
      setShowCreateModal(false);
      setNewSessionName("");
      
      // Handle QR Code if present
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

  const fetchQr = async (sessionName: string, retries = 10) => {
    try {
      setViewingSessionQr(sessionName);
      
      const { data } = await supabase
        .from('whatsapp_message_database')
        .select('qr_code')
        .eq('session_name', sessionName)
        .single();
      
      const sessionData = data as { qr_code: string | null } | null;
        
      if (sessionData && sessionData.qr_code) {
          setQrCodeUrl(sessionData.qr_code);
          return;
      }

      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${BACKEND_URL}/whatsapp/session/qr/${sessionName}?t=${Date.now()}`, {
          headers: {
              'Authorization': session?.access_token ? `Bearer ${session.access_token}` : ''
          }
      });
      
      if (res.ok) {
        const data = await res.json();
        if (data.qr_code) {
            setQrCodeUrl(data.qr_code);
        } else {
             if (retries > 0) {
                setTimeout(() => fetchQr(sessionName, retries - 1), 3000);
             }
        }
      } else {
        if (retries > 0) {
            setTimeout(() => fetchQr(sessionName, retries - 1), 3000);
            return;
        }
        toast.error("QR Code not available yet");
      }
    } catch (e) {
        console.error(e);
        if (retries > 0) {
            setTimeout(() => fetchQr(sessionName, retries - 1), 3000);
        }
    }
  };

  const handleAction = async (action: 'start' | 'stop' | 'delete' | 'restart' | 'renew', sessionName: string) => {
    if (action === 'delete') {
        setSessionToDelete(sessionName);
        setShowDeleteModal(true);
        return;
    }
    
    if (action === 'renew') {
        setSessionToRenew(sessionName);
        setSelectedPlan("30"); // Default
        setShowRenewModal(true);
        return;
    }

    // Direct action for start/stop/restart
    executeAction(action, sessionName);
  };

  const handleRenewSession = async () => {
      if (!sessionToRenew) return;
      
      const price = getPrice();
      if (balance !== null && balance < price) {
          toast.error(`Insufficient Balance. You need ${price} BDT.`);
          return;
      }
  
      setIsRenewing(true);
      try {
          const { data: { session } } = await supabase.auth.getSession();
          const res = await fetch(`${BACKEND_URL}/whatsapp/session/renew`, {
              method: 'POST',
              headers: { 
                  'Content-Type': 'application/json',
                  'Authorization': session?.access_token ? `Bearer ${session.access_token}` : ''
              },
              body: JSON.stringify({ 
                  sessionName: sessionToRenew,
                  days: parseInt(selectedPlan)
              })
          });
  
          if (!res.ok) throw new Error('Renew failed');
          
          toast.success("Session renewed successfully!");
          await refreshSessions();
          setShowRenewModal(false);
          setSessionToRenew(null);
          fetchBalance();
      } catch (e: any) {
          toast.error(e.message || "Failed to renew");
      } finally {
          setIsRenewing(false);
      }
  };

  const executeAction = async (action: 'start' | 'stop' | 'delete' | 'restart', sessionName: string) => {
    if (action === 'delete') {
      setIsDeleting(true);
    } else {
      setLoadingSession({ name: sessionName, action });
    }
    
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${BACKEND_URL}/whatsapp/session/${action}`, {
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
      if (action === 'delete') {
        setIsDeleting(false);
      } else {
        setLoadingSession(null);
      }
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
        <Card className="border border-slate-800/60 bg-gradient-to-br from-slate-950 to-slate-900/50 hover:to-slate-900 hover:border-green-500/30 cursor-pointer transition-all duration-300 flex flex-col items-center justify-center min-h-[280px] md:min-h-[320px] group shadow-lg hover:shadow-green-500/10 rounded-2xl" onClick={() => setShowCreateModal(true)}>
          <CardContent className="flex flex-col items-center gap-6 py-8 md:py-10">
              <div className="relative">
                  <div className="absolute inset-0 bg-green-500/20 blur-2xl rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                  <div className="relative p-5 rounded-2xl bg-slate-900 border border-slate-800 group-hover:border-green-500/40 group-hover:bg-green-950/20 transition-all duration-300 shadow-xl ring-1 ring-white/5">
                    <Plus className="h-10 w-10 text-slate-500 group-hover:text-green-400 transition-colors duration-300" />
                  </div>
              </div>
              <div className="text-center space-y-2 max-w-[240px]">
                <h3 className="font-bold text-xl md:text-2xl text-slate-200 group-hover:text-green-400 transition-colors tracking-tight">Add Connection</h3>
                <p className="text-xs md:text-sm text-slate-500 px-2 leading-relaxed group-hover:text-slate-400 transition-colors">Deploy a new WhatsApp engine with our premium infrastructure.</p>
              </div>
              <Button variant="outline" className="mt-2 h-9 border-slate-700/50 text-slate-400 group-hover:text-green-400 group-hover:border-green-500/40 group-hover:bg-green-500/5 font-medium px-6 rounded-full transition-all text-xs md:text-sm">
                  Initialize
              </Button>
          </CardContent>
        </Card>

        {/* Existing Sessions List */}
        {sessions.map((session) => (
          <Card key={session.name} className="relative overflow-hidden border border-slate-800/60 bg-slate-950 shadow-lg hover:shadow-xl transition-all duration-300 group rounded-2xl hover:border-slate-700/80">
            {/* Status Indicator Line (Top) */}
            <div className={`absolute top-0 left-0 w-full h-[2px] ${session.status === 'WORKING' ? 'bg-gradient-to-r from-green-500/80 to-emerald-400/80' : 'bg-gradient-to-r from-yellow-500/80 to-orange-400/80'}`} />
            
            <CardHeader className="pb-3 bg-slate-900/20 border-b border-slate-800/40 pt-5">
              <div className="flex justify-between items-center mb-1">
                <div className="flex items-center gap-2.5">
                    <div className={`h-2.5 w-2.5 rounded-full shadow-[0_0_8px] ${session.status === 'WORKING' ? 'bg-green-500 shadow-green-500/40 animate-pulse' : 'bg-yellow-500 shadow-yellow-500/40'}`} />
                    <CardTitle className="text-lg md:text-xl font-bold text-slate-100 tracking-tight truncate max-w-[150px]">{session.name}</CardTitle>
                </div>
                <Badge variant="outline" className={`font-mono text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-md ${session.status === 'WORKING' ? 'border-green-500/20 text-green-400 bg-green-500/5' : 'border-yellow-500/20 text-yellow-400 bg-yellow-500/5'}`}>
                  {session.status}
                </Badge>
              </div>
              <CardDescription className="text-[10px] font-mono text-slate-600 flex items-center gap-1.5">
                <span className="text-slate-500">ID:</span> 
                <span className="bg-slate-900/50 px-1 py-0.5 rounded text-slate-400 truncate max-w-[180px]">{(session as any).wp_id || String(session.id)}</span>
              </CardDescription>
            </CardHeader>

            <CardContent className="pt-5 space-y-3">
              {/* Expiry Info Enhanced */}
              {(session as any).expires_at && (() => {
                  const expiresAt = new Date((session as any).expires_at);
                  const now = new Date();
                  const diffTime = expiresAt.getTime() - now.getTime();
                  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                  const isExpired = diffDays <= 0;
                  
                  return (
                    <div className={`flex justify-between items-center p-2.5 rounded-lg border mb-3 ${
                        isExpired 
                            ? "bg-red-500/5 border-red-500/20" 
                            : diffDays <= 3 
                                ? "bg-orange-500/5 border-orange-500/20" 
                                : "bg-slate-800/30 border-slate-700/30"
                    }`}>
                        <div className="flex flex-col gap-0.5">
                            <span className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">
                                {isExpired ? "Subscription Ended" : "Valid Until"}
                            </span>
                            <div className="flex items-center gap-1.5">
                                <div className={`h-1.5 w-1.5 rounded-full ${isExpired ? "bg-red-500" : diffDays <= 3 ? "bg-orange-500" : "bg-emerald-500"}`} />
                                <span className={`text-xs font-bold font-mono ${
                                    isExpired ? "text-red-400" : diffDays <= 3 ? "text-orange-400" : "text-emerald-400"
                                }`}>
                                    {isExpired 
                                        ? "EXPIRED" 
                                        : `${diffDays} Day${diffDays !== 1 ? 's' : ''} Left`}
                                </span>
                                <span className="text-[10px] text-slate-600 font-mono ml-1">
                                    ({expiresAt.toLocaleDateString()})
                                </span>
                            </div>
                        </div>
                         <Button 
                          variant="outline" 
                          size="sm" 
                          onClick={() => handleAction('renew', session.name)} 
                          className={`h-7 text-[10px] px-3 border-dashed ${
                              isExpired 
                                ? "border-red-500/30 text-red-400 hover:bg-red-500/10 hover:border-red-500/50" 
                                : "border-green-500/30 text-green-400 hover:bg-green-500/10 hover:border-green-500/50"
                          }`}
                      >
                          Renew
                      </Button>
                    </div>
                  );
              })()}

              {/* Control Grid */}
              <div className="grid grid-cols-2 gap-2.5">
                {session.status === 'STOPPED' ? (
                   <Button 
                     size="sm" 
                     variant="outline" 
                     disabled={loadingSession?.name === session.name}
                     className="h-9 border-slate-800 bg-slate-900/30 text-slate-300 hover:bg-green-950/20 hover:text-green-400 hover:border-green-500/20 transition-all text-xs" 
                     onClick={() => handleAction('start', session.name)}
                   >
                     {loadingSession?.name === session.name && loadingSession?.action === 'start' ? (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                     ) : (
                        <Play className="mr-1.5 h-3.5 w-3.5" />
                     )}
                     Start
                   </Button>
                ) : (
                   <Button 
                     size="sm" 
                     variant="outline" 
                     disabled={loadingSession?.name === session.name}
                     className="h-9 border-slate-800 bg-slate-900/30 text-slate-300 hover:bg-yellow-950/20 hover:text-yellow-400 hover:border-yellow-500/20 transition-all text-xs" 
                     onClick={() => handleAction('stop', session.name)}
                   >
                     {loadingSession?.name === session.name && loadingSession?.action === 'stop' ? (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                     ) : (
                        <Pause className="mr-1.5 h-3.5 w-3.5" />
                     )}
                     Stop
                   </Button>
                )}
                
                <Button 
                    size="sm" 
                    variant="outline" 
                    disabled={loadingSession?.name === session.name}
                    className="h-9 border-slate-800 bg-slate-900/30 text-slate-300 hover:bg-orange-950/20 hover:text-orange-400 hover:border-orange-500/20 transition-all text-xs" 
                    onClick={() => handleAction('restart', session.name)}
                >
                    <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loadingSession?.name === session.name && loadingSession?.action === 'restart' ? 'animate-spin' : ''}`} /> 
                    Restart
                </Button>
              </div>

              {/* Secondary Actions */}
              <div className="flex gap-2.5">
                  <Button 
                    variant="secondary" 
                    className={`flex-1 h-9 text-xs border border-slate-800/50 ${session.status === 'WORKING' ? 'bg-green-500/5 text-green-500 border-green-500/10' : 'bg-slate-800/50 text-slate-300 hover:bg-slate-800'}`}
                    onClick={() => fetchQr(session.name)}
                    disabled={session.status === 'WORKING'}
                  >
                    <QrCode className="mr-1.5 h-3.5 w-3.5" /> 
                    {session.status === 'WORKING' ? 'Linked' : 'Connect'}
                  </Button>

                  <Button size="sm" variant="outline" className="h-9 w-10 px-0 border-slate-800/50 bg-slate-900/30 text-slate-400 hover:bg-red-950/20 hover:text-red-400 hover:border-red-500/20 transition-all" onClick={() => handleAction('delete', session.name)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
              </div>

              {/* QR Display Area */}
              {viewingSessionQr === session.name && session.status !== 'WORKING' && (
                <div className="mt-3 flex flex-col items-center p-4 rounded-xl bg-white border-2 border-slate-800 shadow-inner animate-in fade-in zoom-in duration-300">
                    {qrCodeUrl ? (
                        <>
                            <img src={qrCodeUrl} alt="QR Code" className="w-40 h-40 object-contain mix-blend-multiply" />
                            <p className="text-[10px] text-slate-500 mt-2 font-medium uppercase tracking-widest">Scan with WhatsApp</p>
                        </>
                    ) : (
                        <div className="flex flex-col items-center justify-center h-40 w-40">
                            <Loader2 className="h-8 w-8 text-slate-400 animate-spin" />
                            <p className="text-xs text-slate-500 mt-2">Loading QR...</p>
                        </div>
                    )}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* CREATE SESSION MODAL */}
      <Dialog open={showCreateModal} onOpenChange={setShowCreateModal}>
        <DialogContent className="sm:max-w-[600px] bg-slate-950 shadow-2xl border border-slate-800 rounded-2xl overflow-hidden p-0 gap-0 text-slate-100">
          <div className="bg-slate-900/50 p-6 border-b border-slate-800">
            <DialogHeader>
              <DialogTitle className="text-2xl font-bold flex items-center gap-2 text-white">
                 <Zap className="h-6 w-6 text-green-500" />
                 Create New Session
              </DialogTitle>
              <DialogDescription className="text-slate-400">
                Configure your engine and subscription plan to start automating.
              </DialogDescription>
            </DialogHeader>
          </div>
          
          <div className="grid gap-6 p-6">
            {/* Engine Selection */}
            <div className="space-y-3">
                <Label className="text-base font-semibold text-slate-200">Select Engine</Label>
                <Tabs defaultValue="WEBJS" onValueChange={(v) => setSelectedEngine(v as any)} className="w-full">
                    <TabsList className="grid w-full grid-cols-2 p-1 bg-slate-900 rounded-xl h-12 border border-slate-800">
                        <TabsTrigger value="WEBJS" className="flex gap-2 data-[state=active]:bg-slate-800 data-[state=active]:text-green-400 data-[state=active]:shadow-sm text-slate-400 rounded-lg h-10 transition-all">
                            <Zap className="w-4 h-4" /> WEBJS (Premium)
                        </TabsTrigger>
                        <TabsTrigger value="NOWEB" className="flex gap-2 data-[state=active]:bg-slate-800 data-[state=active]:text-blue-400 data-[state=active]:shadow-sm text-slate-400 rounded-lg h-10 transition-all">
                            <Server className="w-4 h-4" /> NOWAB (Lite)
                        </TabsTrigger>
                    </TabsList>
                </Tabs>
                <p className="text-xs text-slate-400 bg-slate-900/50 p-3 rounded-lg border border-slate-800">
                    {selectedEngine === "WEBJS" 
                        ? "🚀 High performance, full browser simulation. Supports all features including heavy media." 
                        : "⚡ Lightweight, stable connection via WebSocket. Best for simple text/image automation."}
                </p>
            </div>

            {/* Plan Selection */}
            <div className="space-y-3">
                <Label className="text-base font-semibold text-slate-200">Select Duration</Label>
                <div className="grid grid-cols-4 gap-3">
                    {["2", "30", "60", "90"].map((plan) => {
                        const isSelected = selectedPlan === plan;
                        let price = 0;
                        if (selectedEngine === "WEBJS") {
                             if (plan === "2") price = 200;
                             else if (plan === "30") price = 2000;
                             else if (plan === "60") price = 3500;
                             else if (plan === "90") price = 4000;
                        } else {
                             if (plan === "2") price = 100;
                             else if (plan === "30") price = 500;
                             else if (plan === "60") price = 900;
                             else if (plan === "90") price = 1500;
                        }

                        return (
                            <div 
                                key={plan}
                                onClick={() => setSelectedPlan(plan)}
                                className={`cursor-pointer rounded-xl border-2 p-2 text-center transition-all duration-200 hover:scale-[1.02] ${
                                    isSelected 
                                    ? "border-green-500/50 bg-green-500/10 shadow-[0_0_15px_rgba(34,197,94,0.1)]" 
                                    : "border-slate-800 bg-slate-900/50 hover:border-slate-700 hover:bg-slate-900"
                                }`}
                            >
                                <div className={`text-sm md:text-base font-bold ${isSelected ? "text-green-400" : "text-slate-300"}`}>
                                    {plan === "1" ? "1 Day" : plan === "2" ? "48 Hrs" : `${plan} Days`}
                                </div>
                                <div className={`text-xs font-medium ${isSelected ? "text-green-500" : "text-slate-500"}`}>{price} BDT</div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Session Name */}
            <div className="space-y-2">
                <Label className="text-base font-semibold text-slate-200">Session Name</Label>
                <Input 
                    placeholder="e.g. Support Bot 1" 
                    value={newSessionName}
                    onChange={(e) => setNewSessionName(e.target.value)}
                    className="h-11 bg-slate-900 border-slate-800 focus:border-green-500 focus:ring-green-500/20 rounded-lg text-white placeholder:text-slate-600"
                />
            </div>

            {/* Total Price */}
            <div className="flex items-center justify-between rounded-xl border border-slate-800 p-5 bg-slate-900/50">
                <div className="flex flex-col">
                    <span className="text-sm font-semibold text-slate-300">Total Cost</span>
                    <span className="text-xs text-slate-500">Deducted from your balance</span>
                </div>
                <div className="text-3xl font-black text-green-500">
                    {getPrice()} <span className="text-sm font-medium text-green-600/70">BDT</span>
                </div>
            </div>
          </div>

          <div className="p-6 bg-slate-900 border-t border-slate-800 flex justify-end gap-3">
            <Button variant="outline" size="lg" onClick={() => setShowCreateModal(false)} className="border-slate-700 bg-transparent text-slate-300 hover:bg-slate-800 hover:text-white">Cancel</Button>
            <Button size="lg" onClick={handleCreateSession} disabled={isCreating} className="bg-green-600 hover:bg-green-700 text-white min-w-[150px] shadow-lg shadow-green-900/20">
                {isCreating ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : "Pay & Create"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* DELETE CONFIRMATION MODAL */}
      <Dialog open={showDeleteModal} onOpenChange={setShowDeleteModal}>
        <DialogContent className="sm:max-w-[425px] bg-slate-950 shadow-2xl border border-slate-800 rounded-2xl overflow-hidden p-0 gap-0">
          <div className="bg-red-950/30 p-6 border-b border-red-900/30">
            <DialogHeader>
              <DialogTitle className="text-xl font-bold text-red-500 flex items-center gap-2">
                  <Trash2 className="h-6 w-6" /> Delete Session?
              </DialogTitle>
            </DialogHeader>
          </div>
          
          <div className="p-6">
            <DialogDescription className="text-base text-slate-400">
              Are you sure you want to delete <strong className="text-red-400 bg-red-500/10 border border-red-500/20 px-2 py-0.5 rounded font-mono">{sessionToDelete}</strong>? 
              <br /><br />
              This action cannot be undone. It will disconnect the WhatsApp session and remove all associated data immediately.
            </DialogDescription>
          </div>

          <div className="p-6 bg-slate-900 border-t border-slate-800 flex justify-end gap-3">
            <Button variant="outline" onClick={() => setShowDeleteModal(false)} disabled={isDeleting} className="border-slate-700 bg-transparent text-slate-300 hover:bg-slate-800 hover:text-white">
                Cancel
            </Button>
            <Button 
                variant="destructive" 
                onClick={() => sessionToDelete && executeAction('delete', sessionToDelete)}
                disabled={isDeleting}
                className="bg-red-600 hover:bg-red-700 min-w-[120px] shadow-lg shadow-red-900/20"
            >
                {isDeleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Delete Session"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* RENEW SESSION MODAL */}
      <Dialog open={showRenewModal} onOpenChange={setShowRenewModal}>
        <DialogContent className="sm:max-w-[600px] bg-slate-950 shadow-2xl border border-slate-800 rounded-2xl overflow-hidden p-0 gap-0 text-slate-100">
          <div className="bg-slate-900/50 p-6 border-b border-slate-800">
            <DialogHeader>
              <DialogTitle className="text-2xl font-bold flex items-center gap-2 text-white">
                 <RefreshCw className="h-6 w-6 text-green-500" />
                 Renew Session
              </DialogTitle>
              <DialogDescription className="text-slate-400">
                Extend the validity of <span className="font-mono text-green-400">{sessionToRenew}</span>.
              </DialogDescription>
            </DialogHeader>
          </div>
          
          <div className="grid gap-6 p-6">
            {/* Plan Selection */}
            <div className="space-y-3">
                <Label className="text-base font-semibold text-slate-200">Select Extension Duration</Label>
                <div className="grid grid-cols-4 gap-3">
                    {["2", "30", "60", "90"].map((plan) => {
                        const isSelected = selectedPlan === plan;
                        const price = selectedEngine === "WEBJS" 
                            ? (plan === "2" ? 200 : plan === "30" ? 2000 : plan === "60" ? 3500 : 4000)
                            : (plan === "2" ? 100 : plan === "30" ? 500 : plan === "60" ? 900 : 1500);

                        return (
                            <div 
                                key={plan}
                                onClick={() => setSelectedPlan(plan)}
                                className={`cursor-pointer rounded-xl border-2 p-3 text-center transition-all duration-200 hover:scale-[1.02] ${
                                    isSelected 
                                    ? "border-green-500/50 bg-green-500/10 shadow-[0_0_15px_rgba(34,197,94,0.1)]" 
                                    : "border-slate-800 bg-slate-900/50 hover:border-slate-700 hover:bg-slate-900"
                                }`}
                            >
                                <div className={`text-lg font-bold ${isSelected ? "text-green-400" : "text-slate-300"}`}>{plan === "2" ? "48 Hrs" : `${plan} Days`}</div>
                                <div className={`text-sm font-medium ${isSelected ? "text-green-500" : "text-slate-500"}`}>{price} BDT</div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Total Price */}
            <div className="flex items-center justify-between rounded-xl border border-slate-800 p-5 bg-slate-900/50">
                <div className="flex flex-col">
                    <span className="text-sm font-semibold text-slate-300">Total Renewal Cost</span>
                    <span className="text-xs text-slate-500">Deducted from your balance</span>
                </div>
                <div className="text-3xl font-black text-green-500">
                    {getPrice()} <span className="text-sm font-medium text-green-600/70">BDT</span>
                </div>
            </div>
          </div>

          <div className="p-6 bg-slate-900 border-t border-slate-800 flex justify-end gap-3">
            <Button variant="outline" size="lg" onClick={() => setShowRenewModal(false)} className="border-slate-700 bg-transparent text-slate-300 hover:bg-slate-800 hover:text-white">Cancel</Button>
            <Button size="lg" onClick={handleRenewSession} disabled={isRenewing} className="bg-green-600 hover:bg-green-700 text-white min-w-[150px] shadow-lg shadow-green-900/20">
                {isRenewing ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : "Pay & Renew"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
