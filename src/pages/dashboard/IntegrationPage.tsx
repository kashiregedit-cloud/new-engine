import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useParams } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { 
  Loader2, 
  RefreshCw, 
  CheckCircle, 
  XCircle, 
  Plus, 
  Trash2, 
  StopCircle, 
  PlayCircle, 
  QrCode, 
  Search,
  Eye,
  Settings,
  MoreVertical
} from "lucide-react";
import { BACKEND_URL } from "@/config";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose
} from "@/components/ui/dialog";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// Internal Custom Alert Component to bypass library issues
const CustomAlert = ({ 
  open, 
  title, 
  message, 
  onConfirm, 
  onCancel, 
  confirmText = "Yes", 
  cancelText = "No",
  type = 'warning' 
}: {
  open: boolean;
  title: string;
  message: React.ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
  confirmText?: string;
  cancelText?: string;
  type?: 'warning' | 'info';
}) => {
  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0 }}>
       <div className="bg-white rounded-lg shadow-2xl w-[90%] max-w-sm overflow-hidden animate-in zoom-in-95 duration-200 border-0 relative z-[100000]">
          <div className={`${type === 'warning' ? 'bg-[#ff5f5f]' : 'bg-blue-500'} p-6 flex justify-center items-center`}>
             <div className="bg-white rounded-full p-3 shadow-sm">
                {type === 'warning' ? (
                   <div className="text-[#ff5f5f] font-bold text-2xl h-8 w-8 flex items-center justify-center">!</div>
                ) : (
                   <div className="text-blue-500 font-bold text-2xl h-8 w-8 flex items-center justify-center">i</div>
                )}
             </div>
          </div>
          <div className="p-6 text-center">
             <h3 className="text-2xl font-bold text-gray-700 mb-2 uppercase tracking-wide">{title}</h3>
             <div className="text-gray-500 mb-8 text-sm leading-relaxed">{message}</div>
             <div className="flex gap-4 justify-center">
                <button 
                  onClick={onConfirm} 
                  className={`flex-1 py-2.5 px-4 rounded font-semibold text-white shadow-md transition-transform active:scale-95 ${type === 'warning' ? 'bg-[#ff5f5f] hover:bg-[#ff4f4f]' : 'bg-blue-500 hover:bg-blue-600'}`}
                >
                  {confirmText}
                </button>
                <button 
                  onClick={onCancel} 
                  className="flex-1 py-2.5 px-4 rounded font-semibold text-gray-600 bg-gray-200 hover:bg-gray-300 shadow-sm transition-transform active:scale-95"
                >
                  {cancelText}
                </button>
             </div>
          </div>
       </div>
    </div>,
    document.body
  );
};

interface WhatsAppSession {
  id: string;
  session_name: string;
  status: string;
  qr_code?: string;
  user_email?: string;
  user_id?: string;
  updated_at?: string;
  session_id?: string;
}

export default function IntegrationPage() {
  const { platform } = useParams();
  const [sessions, setSessions] = useState<WhatsAppSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [newSessionName, setNewSessionName] = useState("");
  const [creating, setCreating] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [qrSession, setQrSession] = useState<WhatsAppSession | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showPaymentConfirm, setShowPaymentConfirm] = useState(false);
  const [sessionToDelete, setSessionToDelete] = useState<string | null>(null);
  const [restartingId, setRestartingId] = useState<string | null>(null);
  const [balance, setBalance] = useState<number | null>(null);

  const fetchBalance = React.useCallback(async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      
      const { data, error } = await supabase
        .from('user_configs')
        .select('balance')
        .eq('user_id', user.id)
        .maybeSingle();
      
      if (error) {
          console.error("Error fetching balance:", error);
      }

      if (data) {
          setBalance((data as any).balance);
      }
  }, []);

  const fetchSessions = React.useCallback(async () => {
     setLoading(true);
     try {
       const { data: { user } } = await supabase.auth.getUser();
       if (!user) return;
       
       // Relaxed query: match user_id OR user_email (if user_id is missing/null in DB)
       const { data, error } = await supabase
         .from('whatsapp_sessions')
         .select('*')
         .or(`user_id.eq.${user.id},user_email.eq.${user.email}`)
         .order('created_at', { ascending: false });

       if (error) throw error;
       
       if (data) {
           setSessions(data as WhatsAppSession[]);
       }
     } catch (error: unknown) {
       console.error('Error fetching sessions:', error);
       toast.error('Failed to load sessions');
     } finally {
       setLoading(false);
     }
  }, []);

  useEffect(() => {
    console.log("IntegrationPage v1.5 (NATIVE POPUP) loaded");
    if (platform === 'whatsapp') {
      fetchSessions();
      fetchBalance();
    }
  }, [platform, fetchSessions, fetchBalance]);

  // Sync qrSession with sessions list when it updates
  useEffect(() => {
    if (qrSession) {
      const updatedSession = sessions.find(s => s.id === qrSession.id);
      if (updatedSession && updatedSession.qr_code !== qrSession.qr_code) {
        setQrSession(updatedSession);
      }
    }
  }, [sessions, qrSession]);

  // Poll for updates when QR dialog is open
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (qrSession && qrSession.status !== 'WORKING') {
      interval = setInterval(fetchSessions, 3000); // Poll every 3s
    }
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qrSession?.status, qrSession?.id, fetchSessions]); // Depend on status/id, not full object to avoid loop




  const handleStartNew = (e: React.MouseEvent) => {
    e.preventDefault(); 
    
    if (!newSessionName.trim()) {
      toast.error("Please enter a session name");
      return;
    }

    // Direct Browser Confirmation (Guaranteed to work)
    const confirmed = window.confirm(`Confirm Payment?\n\nCreating a new session will deduct 500 BDT.\n\nCurrent Balance: ${balance || 0} BDT\nAfter Deduction: ${(balance || 0) - 500} BDT\n\nPress OK to Pay & Create.`);
    
    if (confirmed) {
        createSession();
    }
  };

  const createSession = async () => {
    // Check moved to handleStartNew, but safe to keep basic check
    if (!newSessionName.trim()) return;

    setCreating(true);
    try {
      let { data: { session } } = await supabase.auth.getSession();
      
      // Strict check for session validity
      if (!session || !session.user || !session.access_token) {
        // Try to refresh session
        const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
        if (refreshError || !refreshData.session) {
             throw new Error("User session expired. Please logout and login again.");
        }
        session = refreshData.session;
      }

      // Re-fetch user after potential refresh
      const { data: { user: authUser } } = await supabase.auth.getUser();
      const user = authUser || session.user; // Fallback to session user if getUser fails
      
      if (!user?.email) throw new Error("User email not found. Please contact support.");

      // Generate random suffix for unique session name (6 chars)
      const suffix = Math.random().toString(36).substring(2, 8);
      const finalSessionName = `${newSessionName.trim()}_${suffix}`;

      const payload = { 
        sessionName: finalSessionName, 
        userEmail: user.email, 
        userId: user.id
      };
      console.log("Sending payload to /session/create:", payload);

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
      
      toast.success("Session created! Please scan the QR code.");
      setNewSessionName("");
      
      // Optimistically add to list
      const newSession: WhatsAppSession = {
          id: data.id || data.session_name,
          session_name: data.session_name,
          status: 'created',
          qr_code: data.qr_code,
          user_email: user.email,
          user_id: user.id
      };
      setSessions(prev => [newSession, ...prev]);

      // Immediately show QR from response if available, even if DB fetch might fail/delay
      if (data.qr_code) {
          setQrSession(newSession);
      }

      fetchSessions();
      fetchBalance(); // Update balance after deduction
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      toast.error(message);
    } finally {
      setCreating(false);
    }
  };

  const handleAction = async (sessionName: string, action: 'start' | 'stop' | 'delete' | 'restart') => {
    try {
      let { data: { session } } = await supabase.auth.getSession();
      
      // Strict check for session validity
      if (!session || !session.user || !session.access_token) {
        // Try to refresh session
        const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
        if (refreshError || !refreshData.session) {
             throw new Error("User session expired. Please logout and login again.");
        }
        session = refreshData.session;
      }

      if (action === 'delete') {
      // Don't wait for response, just optimistic update immediately
      setSessions(prev => prev.filter(s => s.session_name !== sessionName));
      
      try {
        await fetch(`${BACKEND_URL}/session/${action}`, {
          method: 'POST',
          headers: { 
              'Content-Type': 'application/json',
              'Authorization': session?.access_token ? `Bearer ${session.access_token}` : ''
          },
          body: JSON.stringify({ sessionName })
        });
        toast.success(`Session ${action}ed successfully`);
      } catch (e) {
        console.error("Delete failed but removed from UI:", e);
        // Don't re-add to UI to avoid confusion, user wants it gone
      }
      return;
    }

    if (action === 'restart') {
       setRestartingId(sessionName);
    }
    
    const res = await fetch(`${BACKEND_URL}/session/${action}`, {
      method: 'POST',
      headers: { 
          'Content-Type': 'application/json',
          'Authorization': session?.access_token ? `Bearer ${session.access_token}` : ''
      },
      body: JSON.stringify({ sessionName })
    });
    
    if (!res.ok) throw new Error(`Failed to ${action} session`);
    
    toast.success(action === 'restart' ? "Session restarting. Check QR shortly." : `Session ${action}ed successfully`);
    
    if (action === 'restart') {
       // Show QR modal immediately with loading state to trigger polling
       const session = sessions.find(s => s.session_name === sessionName);
       if (session) {
           setQrSession({ ...session, qr_code: undefined, status: 'RESTARTING' });
       }
       fetchSessions();
    } else {
       setTimeout(() => fetchSessions(), 2000);
    }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      toast.error(message);
    } finally {
      if (action === 'restart') setRestartingId(null);
    }
  };

  const filteredSessions = sessions.filter(session => 
    session.session_name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'WORKING':
        return <Badge className="bg-green-500 hover:bg-green-600"><CheckCircle className="w-3 h-3 mr-1" /> WORKING</Badge>;
      case 'STOPPED':
        return <Badge variant="secondary"><StopCircle className="w-3 h-3 mr-1" /> STOPPED</Badge>;
      case 'created':
      case 'scanned': // WAHA might return scanned before working
        return <Badge className="bg-orange-500 hover:bg-orange-600"><QrCode className="w-3 h-3 mr-1" /> SCAN_QR_CODE</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  if (platform !== 'whatsapp') {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-4 capitalize">{platform} Integration</h1>
        <p className="text-muted-foreground">Integration for {platform} is coming soon.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-2">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
           <h1 className="text-2xl font-bold">WhatsApp Sessions</h1>
           <p className="text-muted-foreground">Manage your WhatsApp connections and sessions.</p>
        </div>
        <div className="flex gap-2 items-center">
          {balance !== null && (
              <Badge variant="outline" className="text-base px-3 py-1 border-green-200 bg-green-50 text-green-700">
                  Balance: {balance} BDT
              </Badge>
          )}
          <Button variant="outline" onClick={() => { fetchSessions(); fetchBalance(); }} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>
      
      {/* Controls Bar */}
      <div className="flex flex-col md:flex-row gap-4 justify-between items-end md:items-center bg-card p-4 rounded-lg border">
        {/* Create Session Form */}
        <div className="flex gap-2 w-full md:w-auto items-end">
             <div className="grid w-full max-w-sm items-center gap-1.5">
              <Label htmlFor="sessionName">New Session Name</Label>
              <Input 
                id="sessionName" 
                placeholder="e.g., Sales Bot" 
                value={newSessionName}
                onChange={(e) => setNewSessionName(e.target.value)}
                className="w-[200px]"
              />
            </div>
            <Button onClick={handleStartNew} disabled={creating} className="bg-green-600 hover:bg-green-700">
              {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              Start New
            </Button>
        </div>

        {/* Search */}
        <div className="relative w-full md:w-[300px]">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="Search by Name..." 
            className="pl-8" 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      {/* Sessions Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {filteredSessions.length === 0 ? (
           <div className="col-span-full text-center p-8 border rounded-lg bg-muted/20">
             {loading ? (
                <div className="flex flex-col items-center gap-2">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    <p>Loading sessions...</p>
                </div>
             ) : (
                <p className="text-muted-foreground">No sessions found. Create one to get started.</p>
             )}
           </div>
        ) : (
          filteredSessions.map((session) => (
            <Card key={session.id} className="overflow-hidden">
              <CardHeader className="pb-2">
                <div className="flex justify-between items-start">
                    <div>
                        <CardTitle className="text-lg">{session.session_name}</CardTitle>
                        <CardDescription className="text-xs mt-1">ID: {(session.id || session.session_id || 'N/A').slice(0, 8)}...</CardDescription>
                    </div>
                    {getStatusBadge(session.status)}
                </div>
              </CardHeader>
              <CardContent className="pb-2">
                <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                        <span className="text-muted-foreground">Account:</span>
                        <span className="font-medium">{session.user_email || 'N/A'}</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-muted-foreground">Server:</span>
                        <span className="font-medium">WAHA</span>
                    </div>
                </div>
              </CardContent>
              <div className="flex items-center justify-between p-4 bg-muted/20 border-t">
                  <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button variant="outline" size="sm" onClick={() => setQrSession(session)}>
                                <QrCode className="h-4 w-4 mr-2 text-blue-500" />
                                View QR
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>Scan QR Code</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>

                  <div className="flex gap-1">
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleAction(session.session_name, 'start')}>
                                    <PlayCircle className="h-4 w-4 text-green-500" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>Start Session</TooltipContent>
                        </Tooltip>
                    </TooltipProvider>

                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button variant="outline" size="sm" className="h-8 border-orange-200 hover:bg-orange-50 text-orange-600" onClick={() => handleAction(session.session_name, 'restart')} disabled={restartingId === session.session_name}>
                                    {restartingId === session.session_name ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
                                    Restart
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>Restart Session</TooltipContent>
                        </Tooltip>
                    </TooltipProvider>

                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleAction(session.session_name, 'stop')}>
                                    <StopCircle className="h-4 w-4 text-red-500" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>Stop Session</TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                    
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500 hover:text-red-600 hover:bg-red-50" onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        
                        // Direct Browser Confirmation (Guaranteed to work)
                        const confirmed = window.confirm(`WARNING!\n\nAre you sure you want to delete session "${session.session_name}"?\n\nThis action is PERMANENT.`);
                        
                        if (confirmed) {
                             handleAction(session.session_name, 'delete');
                        }
                    }}>
                        <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
              </div>
            </Card>
          ))
        )}
      </div>

      {/* QR Code Dialog */}
      <Dialog open={!!qrSession} onOpenChange={(open) => !open && setQrSession(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Session QR Code: {qrSession?.session_name}</DialogTitle>
            <DialogDescription>
              Scan this QR code with your WhatsApp to connect.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center justify-center p-6 gap-4">
            {qrSession?.qr_code ? (
              <img 
                src={qrSession.qr_code} 
                alt="QR Code" 
                className="w-64 h-64 object-contain border rounded-lg bg-white"
              />
            ) : qrSession?.status === 'WORKING' ? (
                <div className="flex flex-col items-center justify-center h-64 w-64 bg-green-50 rounded-lg border border-green-200">
                    <CheckCircle className="h-8 w-8 text-green-500 mb-2" />
                    <p className="text-green-700 font-medium">Session Connected</p>
                    <p className="text-xs text-green-600 text-center px-4 mt-1">To scan a new QR code, please click "Regenerate QR" below.</p>
                </div>
            ) : (
                <div className="flex flex-col items-center justify-center h-64 w-64 bg-secondary/20 rounded-lg border border-dashed">
                    <Loader2 className="h-8 w-8 animate-spin text-primary mb-2" />
                    <p className="text-muted-foreground text-sm">Waiting for QR Code...</p>
                </div>
            )}
            
            <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => {
                    if (qrSession) handleAction(qrSession.session_name, 'restart');
                }}>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Regenerate QR
                </Button>
                <Button variant="outline" size="sm" onClick={fetchSessions}>
                    <CheckCircle className="h-4 w-4 mr-2" />
                    I Scanned It
                </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog - REPLACED WITH CUSTOM POPUP */}
      <CustomAlert 
        open={showDeleteConfirm}
        title="WARNING!"
        message={
          <>
            Are you sure you want to delete this session? <br/>
            This action is permanent.
          </>
        }
        onConfirm={() => {
          if (sessionToDelete) {
              handleAction(sessionToDelete, 'delete');
          }
          setShowDeleteConfirm(false);
          setSessionToDelete(null);
        }}
        onCancel={() => {
            setShowDeleteConfirm(false);
            setSessionToDelete(null);
        }}
      />

      {/* Payment Confirmation Dialog - REPLACED WITH CUSTOM POPUP */}
      <CustomAlert 
        open={showPaymentConfirm}
        title="Confirm Payment"
        type="info"
        message={
          <>
            Creating a new session will deduct <strong>500 BDT</strong>.
            <br />
            {balance !== null && (
                <span className="block mt-2 text-xs bg-gray-100 p-2 rounded">
                    Current: <strong>{balance} BDT</strong> → After: <strong>{balance - 500} BDT</strong>
                </span>
            )}
          </>
        }
        confirmText="Confirm & Pay"
        onConfirm={() => {
          setShowPaymentConfirm(false);
          createSession();
        }}
        onCancel={() => setShowPaymentConfirm(false)}
      />
    </div>
  );
}
