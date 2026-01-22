import { useState, useEffect, useCallback } from "react";
import { useWhatsApp } from "@/context/WhatsAppContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Loader2, Plus, QrCode, Trash2, Play, Pause, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { BACKEND_URL } from "@/config";
import { supabase } from "@/integrations/supabase/client";
import { Label } from "@/components/ui/label";

export default function SessionManager() {
  const { sessions, refreshSessions, loading: listLoading } = useWhatsApp();
  const [newSessionName, setNewSessionName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [qrCodeUrl, setQrCodeUrl] = useState<string | null>(null);
  const [viewingSessionQr, setViewingSessionQr] = useState<string | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [selectedPlan, setSelectedPlan] = useState("30");

  const fetchBalance = useCallback(async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      
      const { data, error } = await supabase
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

  const handleStartNew = async () => {
    if (!newSessionName.trim()) {
      toast.error("Please enter a session name");
      return;
    }

    // Determine price based on plan
    let price = 500;
    if (selectedPlan === "60") price = 900;
    if (selectedPlan === "90") price = 800;

    // Force Browser Native Popup
    setTimeout(() => {
        const confirmed = window.confirm(
            `Confirm Payment?\n\nPlan: ${selectedPlan} Days\nPrice: ${price} BDT\n\nBalance will be deducted. Press OK to Pay & Create.`
        );
        
        if (confirmed) {
            createSession();
        }
    }, 100);
  };

  const createSession = async () => {
    setIsCreating(true);
    setQrCodeUrl(null);
    try {
      let { data: { session } } = await supabase.auth.getSession();
      
      // Strict check for session validity
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

      // Generate random suffix for unique session name (6 chars) to avoid collisions
      const suffix = Math.random().toString(36).substring(2, 8);
      const finalSessionName = `${newSessionName.trim()}_${suffix}`;

      const payload = { 
        sessionName: finalSessionName,
        userEmail: user.email,
        userId: user.id,
        planDays: selectedPlan
      };

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
      fetchBalance(); // Update balance
      
      // Use the QR code returned directly from creation response if available
      if (data.qr_code) {
          setQrCodeUrl(data.qr_code);
          setViewingSessionQr(finalSessionName);
      } else {
          fetchQr(finalSessionName);
      }
      
      await refreshSessions();
      setNewSessionName("");
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
      
      // 1. Try to get from Supabase first (Base64 is reliable)
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

      // 2. Fallback to backend fetch with Auth header
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
        const confirmed = window.confirm(
            "Are you sure you want to DELETE this session?\n\nThis will disconnect your WhatsApp and cannot be undone.\n\nPress OK to Delete."
        );
        if (!confirmed) return;
    }

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
          // Wait and refresh to show new status/QR
          setTimeout(async () => {
              await refreshSessions();
              fetchQr(sessionName);
          }, 3000);
      } else {
          await refreshSessions();
      }

      if (action === 'delete' && viewingSessionQr === sessionName) {
        setViewingSessionQr(null);
        setQrCodeUrl(null);
      }
    } catch (error: unknown) {
      toast.error(`Failed to ${action} session`);
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
        {/* Create New Session Card */}
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5" />
              New Session
            </CardTitle>
            <CardDescription>
              Select plan, enter name, and pay to create.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Plan Selection */}
            <div className="space-y-2">
                <Label>Select Plan</Label>
                <div className="grid grid-cols-3 gap-2">
                    <div 
                      className={`border p-2 rounded-lg text-center cursor-pointer transition-colors ${selectedPlan === "30" ? "border-green-500 bg-green-50" : "border-gray-200 hover:border-green-200"}`}
                      onClick={() => setSelectedPlan("30")}
                    >
                        <div className="font-bold text-sm">30 Days</div>
                        <div className="text-xs text-gray-500">500 BDT</div>
                    </div>
                    <div 
                      className={`border p-2 rounded-lg text-center cursor-pointer transition-colors ${selectedPlan === "60" ? "border-green-500 bg-green-50" : "border-gray-200 hover:border-green-200"}`}
                      onClick={() => setSelectedPlan("60")}
                    >
                        <div className="font-bold text-sm">60 Days</div>
                        <div className="text-xs text-gray-500">900 BDT</div>
                    </div>
                    <div 
                      className={`border p-2 rounded-lg text-center cursor-pointer transition-colors ${selectedPlan === "90" ? "border-green-500 bg-green-50" : "border-gray-200 hover:border-green-200"}`}
                      onClick={() => setSelectedPlan("90")}
                    >
                        <div className="font-bold text-sm">90 Days</div>
                        <div className="text-xs text-gray-500">800 BDT</div>
                    </div>
                </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Session Name</label>
              <Input 
                placeholder="e.g. Sales Bot 1" 
                value={newSessionName}
                onChange={(e) => setNewSessionName(e.target.value)}
              />
            </div>
            <Button 
              className="w-full bg-green-600 hover:bg-green-700" 
              onClick={handleStartNew} 
              disabled={isCreating}
            >
              {isCreating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Pay & Create"}
            </Button>
          </CardContent>
        </Card>

        {/* Existing Sessions List */}
        {sessions.map((session) => (
          <Card key={session.name} className="relative overflow-hidden">
            <div className={`absolute top-0 left-0 w-1 h-full ${session.status === 'WORKING' ? 'bg-green-500' : 'bg-yellow-500'}`} />
            <CardHeader className="pb-2">
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
    </div>
  );
}
