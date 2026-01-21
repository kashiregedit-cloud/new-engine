import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, RefreshCw, CheckCircle, XCircle, Plus, Trash2, StopCircle, PlayCircle, QrCode } from "lucide-react";
import { BACKEND_URL } from "@/config";

interface WhatsAppSession {
  id: string;
  session_name: string;
  status: string;
  qr_code?: string;
  plan_days?: number;
  user_email?: string;
}

export default function IntegrationPage() {
  const { platform } = useParams();
  const [sessions, setSessions] = useState<WhatsAppSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [newSessionName, setNewSessionName] = useState("");
  const [creating, setCreating] = useState(false);

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

      const { data, error } = await supabase
        .from('whatsapp_sessions')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setSessions(data || []);
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
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) throw new Error("User not authenticated");

      const res = await fetch(`${BACKEND_URL}/session/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          sessionName: newSessionName, 
          userEmail: user.email, 
          userId: user.id,
          plan: 30 // Default plan
        })
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create session');
      
      toast.success("Session created! Waiting for QR Code...");
      setNewSessionName("");
      fetchSessions(); // Refresh list
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setCreating(false);
    }
  };

  const handleAction = async (sessionName: string, action: 'start' | 'stop' | 'delete') => {
    try {
      const res = await fetch(`${BACKEND_URL}/session/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionName })
      });
      
      if (!res.ok) throw new Error(`Failed to ${action} session`);
      
      toast.success(`Session ${action}ed successfully`);
      fetchSessions();
    } catch (error: any) {
      toast.error(error.message);
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
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
           <h1 className="text-2xl font-bold">WhatsApp Sessions</h1>
           <p className="text-muted-foreground">Manage your WhatsApp connections and sessions.</p>
        </div>
        <Button variant="outline" onClick={fetchSessions} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>
      
      {/* Create New Session */}
      <Card className="border-dashed border-2">
        <CardHeader>
          <CardTitle>Create New Session</CardTitle>
          <CardDescription>Enter a unique name for your new WhatsApp session.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4">
            <div className="grid w-full max-w-sm items-center gap-1.5">
              <Label htmlFor="sessionName">Session Name</Label>
              <Input 
                id="sessionName" 
                placeholder="e.g., Support Bot 1" 
                value={newSessionName}
                onChange={(e) => setNewSessionName(e.target.value)}
              />
            </div>
            <div className="flex items-end">
              <Button onClick={createSession} disabled={creating}>
                {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                Create Session
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Session List */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {sessions.map((session) => (
          <Card key={session.id} className="relative overflow-hidden">
            <div className={`absolute top-0 left-0 w-1 h-full ${session.status === 'WORKING' ? 'bg-green-500' : 'bg-orange-500'}`} />
            <CardHeader className="pb-2">
              <div className="flex justify-between items-start">
                <div>
                  <CardTitle className="text-lg">{session.session_name}</CardTitle>
                  <CardDescription className="flex items-center gap-2 mt-1">
                    <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                      session.status === 'WORKING' 
                        ? 'bg-green-100 text-green-700' 
                        : 'bg-orange-100 text-orange-700'
                    }`}>
                      {session.status === 'WORKING' ? <CheckCircle size={12} className="mr-1"/> : <XCircle size={12} className="mr-1"/>}
                      {session.status}
                    </span>
                    {session.plan_days && (
                       <span className="text-xs text-muted-foreground bg-secondary px-2 py-1 rounded-full">
                         {session.plan_days} Days Plan
                       </span>
                    )}
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {/* QR Code Display */}
              {(session.status === 'created' || session.status === 'STOPPED') && session.qr_code ? (
                <div className="flex flex-col items-center justify-center p-4 bg-white rounded-lg border my-4">
                  <img src={session.qr_code} alt="QR Code" className="w-48 h-48 object-contain" />
                  <p className="text-xs text-muted-foreground mt-2">Scan with WhatsApp</p>
                </div>
              ) : session.status === 'WORKING' ? (
                <div className="flex flex-col items-center justify-center p-8 bg-green-50/50 rounded-lg border border-green-100 my-4">
                  <CheckCircle className="h-12 w-12 text-green-500 mb-2" />
                  <p className="text-green-700 font-medium">Connected</p>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center p-8 bg-secondary/20 rounded-lg border border-dashed my-4 min-h-[200px]">
                   {creating ? (
                      <div className="text-center">
                        <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2 text-muted-foreground" />
                        <p className="text-sm text-muted-foreground">Generating QR...</p>
                      </div>
                   ) : (
                      <div className="text-center">
                        <QrCode className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                        <p className="text-sm text-muted-foreground">QR Not Available</p>
                        <Button variant="link" size="sm" onClick={fetchSessions} className="mt-1 h-auto p-0">
                          Click to Refresh
                        </Button>
                      </div>
                   )}
                </div>
              )}
            </CardContent>
            <CardFooter className="bg-secondary/10 pt-4 flex justify-between gap-2">
              {session.status === 'WORKING' ? (
                <Button variant="destructive" size="sm" className="w-full" onClick={() => handleAction(session.session_name, 'stop')}>
                  <StopCircle className="mr-2 h-4 w-4" /> Stop
                </Button>
              ) : (
                <Button variant="default" size="sm" className="w-full" onClick={() => handleAction(session.session_name, 'start')}>
                  <PlayCircle className="mr-2 h-4 w-4" /> Start
                </Button>
              )}
              <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive" onClick={() => handleAction(session.session_name, 'delete')}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </CardFooter>
          </Card>
        ))}

        {sessions.length === 0 && !loading && (
          <div className="col-span-full text-center py-12 text-muted-foreground">
            <p>No active sessions found. Create one to get started.</p>
          </div>
        )}
      </div>
    </div>
  );
}
