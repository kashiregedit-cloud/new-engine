import { useState, useEffect } from "react";
import { useWhatsApp } from "@/context/WhatsAppContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Loader2, Plus, QrCode, Trash2, Play, Pause, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { BACKEND_URL } from "@/config";

export default function SessionManager() {
  const { sessions, refreshSessions, loading: listLoading } = useWhatsApp();
  const [newSessionName, setNewSessionName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [qrCodeUrl, setQrCodeUrl] = useState<string | null>(null);
  const [viewingSessionQr, setViewingSessionQr] = useState<string | null>(null);

  const createSession = async () => {
    if (!newSessionName.trim()) {
      toast.error("Please enter a session name");
      return;
    }
    setIsCreating(true);
    setQrCodeUrl(null);
    try {
      const res = await fetch(`${BACKEND_URL}/session/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionName: newSessionName })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create session');
      
      toast.success("Session created! Fetching QR Code...");
      await refreshSessions();
      fetchQr(newSessionName);
      setNewSessionName("");
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setIsCreating(false);
    }
  };

  const fetchQr = async (sessionName: string, retries = 3) => {
    try {
      setViewingSessionQr(sessionName);
      
      // Check if session has a saved QR code first (from list)
      // @ts-ignore
      const session = sessions.find(s => s.name === sessionName);
      // @ts-ignore
      if (session?.qr_code) {
         // @ts-ignore
         setQrCodeUrl(session.qr_code);
         // Also fetch fresh in background
      } else {
         setQrCodeUrl(null);
      }

      // Add timestamp to prevent caching
      const res = await fetch(`${BACKEND_URL}/session/qr/${sessionName}?t=${Date.now()}`);
      if (res.ok) {
        const blob = await res.blob();
        setQrCodeUrl(URL.createObjectURL(blob));
      } else {
        if (retries > 0) {
            // Retry after 2 seconds
            setTimeout(() => fetchQr(sessionName, retries - 1), 2000);
            return;
        }
        if (!session?.qr_code) {
           toast.error("QR Code not available (Session might be connected or stopped)");
        }
      }
    } catch (e) {
      if (retries > 0) {
          setTimeout(() => fetchQr(sessionName, retries - 1), 2000);
          return;
      }
      console.error(e);
      toast.error("Failed to fetch QR");
    }
  };

  const handleAction = async (action: 'start' | 'stop' | 'delete', sessionName: string) => {
    try {
      const res = await fetch(`${BACKEND_URL}/session/${action}`, {
        method: action === 'delete' ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionName })
      });
      if (!res.ok) throw new Error('Action failed');
      toast.success(`Session ${action}ed successfully`);
      await refreshSessions();
      if (action === 'delete' && viewingSessionQr === sessionName) {
        setViewingSessionQr(null);
        setQrCodeUrl(null);
      }
    } catch (error) {
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
        <Button onClick={() => refreshSessions()} variant="outline" size="sm">
          <RefreshCw className={`mr-2 h-4 w-4 ${listLoading ? 'animate-spin' : ''}`} />
          Refresh List
        </Button>
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
              Step 1: Enter a name and click create.<br/>
              Step 2: Wait for QR Code to appear.<br/>
              Step 3: Scan with WhatsApp.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Session Name</label>
              <Input 
                placeholder="e.g. Sales Bot 1" 
                value={newSessionName}
                onChange={(e) => setNewSessionName(e.target.value)}
              />
            </div>
            <Button 
              className="w-full" 
              onClick={createSession} 
              disabled={isCreating}
            >
              {isCreating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Create & Get QR"}
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
              <CardDescription className="text-xs font-mono">ID: {session.id}</CardDescription>
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
