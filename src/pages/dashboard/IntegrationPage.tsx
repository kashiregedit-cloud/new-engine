import { useEffect, useState } from "react";
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
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface WhatsAppSession {
  id: string;
  session_name: string;
  status: string;
  qr_code?: string;
  plan_days?: number;
  user_email?: string;
  updated_at?: string;
}

export default function IntegrationPage() {
  const { platform } = useParams();
  const [sessions, setSessions] = useState<WhatsAppSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [newSessionName, setNewSessionName] = useState("");
  const [creating, setCreating] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [qrSession, setQrSession] = useState<WhatsAppSession | null>(null);

  useEffect(() => {
    if (platform === 'whatsapp') {
      fetchSessions();
    }
  }, [platform]);

  const fetchSessions = async () => {
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
       
       if (data) {
           // No need to fetch from session_qr_link as backend now stores QR in whatsapp_sessions
           setSessions(data);
       }
 
       if (error) throw error;
     } catch (error) {
       console.error("Error fetching sessions:", error);
     } finally {
       setLoading(false);
     }
   };

  const createSession = async () => {
    if (!newSessionName.trim()) {
      toast.error("Please enter a session name");
      return;
    }

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
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) throw new Error("User email not found. Please contact support.");

      const payload = { 
        sessionName: newSessionName, 
        userEmail: user.email, 
        userId: user.id,
        plan: 30 
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
          plan_days: data.plan_days,
          user_email: user.email,
          user_id: user.id
      };
      setSessions(prev => [newSession, ...prev]);

      // Immediately show QR from response if available, even if DB fetch might fail/delay
      if (data.qr_code) {
          setQrSession(newSession);
      }

      fetchSessions(); 
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setCreating(false);
    }
  };

  const handleAction = async (sessionName: string, action: 'start' | 'stop' | 'delete' | 'restart') => {
    try {
      if (action === 'restart') {
         toast.info("Restarting session...");
      }
      
      const res = await fetch(`${BACKEND_URL}/session/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionName })
      });
      
      if (!res.ok) throw new Error(`Failed to ${action} session`);
      
      toast.success(action === 'restart' ? "Session restarting. Check QR shortly." : `Session ${action}ed successfully`);
      
      setTimeout(() => fetchSessions(), 2000);
    } catch (error: any) {
      toast.error(error.message);
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
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchSessions} disabled={loading}>
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
            <Button onClick={createSession} disabled={creating} className="bg-green-600 hover:bg-green-700">
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
                        <CardDescription className="text-xs mt-1">ID: {session.id.slice(0, 8)}...</CardDescription>
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
                    <div className="flex justify-between">
                        <span className="text-muted-foreground">Plan:</span>
                        <span className="font-medium">{session.plan_days || 30} Days</span>
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
                                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleAction(session.session_name, 'restart')}>
                                    <RefreshCw className="h-4 w-4 text-orange-500" />
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
                    
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleAction(session.session_name, 'delete')}>
                                    <Trash2 className="h-4 w-4 text-gray-500" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>Delete Session</TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
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
          <div className="flex items-center justify-center p-6">
            {qrSession?.qr_code ? (
              <img src={qrSession.qr_code} alt="QR Code" className="w-64 h-64 object-contain border rounded-lg" />
            ) : (
               <div className="flex flex-col items-center justify-center h-64 w-64 bg-secondary/20 rounded-lg border border-dashed">
                  <QrCode className="h-12 w-12 text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">No QR Code Available</p>
                  <Button variant="link" onClick={() => {
                      if (qrSession) handleAction(qrSession.session_name, 'restart');
                  }}>
                    Generate New QR
                  </Button>
               </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
