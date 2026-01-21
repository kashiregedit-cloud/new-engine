import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, RefreshCw, CheckCircle, XCircle } from "lucide-react";
import { BACKEND_URL } from "@/config";

export default function IntegrationPage() {
  const { platform } = useParams();
  const [sessionName, setSessionName] = useState("default");
  const [qrCodeUrl, setQrCodeUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sessionStatus, setSessionStatus] = useState<string | null>(null);

  useEffect(() => {
    if (platform === 'whatsapp') {
      checkSession();
    }
  }, [platform, sessionName]);

  const checkSession = async () => {
    // Check Supabase for existing session
    const { data } = await supabase.from('whatsapp_sessions').select('*').eq('session_name', sessionName).maybeSingle();
    if (data) {
      setSessionStatus(data.status);
      if (data.status === 'created' || data.status === 'STOPPED') {
          fetchQr();
      }
    } else {
      setSessionStatus(null);
      setQrCodeUrl(null);
    }
  };

  const createSession = async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) throw new Error("User not authenticated");

      const res = await fetch(`${BACKEND_URL}/session/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionName, userEmail: user.email, userId: user.id })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create session');
      
      toast.success("Session created! Fetching QR Code...");
      setSessionStatus('created');
      fetchQr();
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchQr = async () => {
    try {
      // Direct fetch to backend which proxies WAHA
      const res = await fetch(`${BACKEND_URL}/session/qr/${sessionName}`);
      if (res.ok) {
        const blob = await res.blob();
        setQrCodeUrl(URL.createObjectURL(blob));
      }
    } catch (e) {
      console.error(e);
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
      <h1 className="text-2xl font-bold">WhatsApp Integration</h1>
      
      <Card>
        <CardHeader>
          <CardTitle>Connection Status</CardTitle>
          <CardDescription>Manage your WhatsApp connection</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <div className={`p-3 rounded-full ${sessionStatus === 'WORKING' ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>
              {sessionStatus === 'WORKING' ? <CheckCircle size={24} /> : <XCircle size={24} />}
            </div>
            <div>
              <p className="font-medium capitalize">{sessionStatus || 'Not Connected'}</p>
              <p className="text-sm text-muted-foreground">Session: {sessionName}</p>
            </div>
          </div>

          {!sessionStatus || sessionStatus === 'STOPPED' ? (
             <Button onClick={createSession} disabled={loading}>
               {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
               Create Session & Connect
             </Button>
          ) : null}

          {qrCodeUrl && sessionStatus !== 'WORKING' && (
            <div className="mt-4">
              <p className="mb-2 font-medium">Scan this QR Code with WhatsApp:</p>
              <img src={qrCodeUrl} alt="QR Code" className="border rounded-lg shadow-sm max-w-xs" />
              <Button variant="outline" size="sm" onClick={fetchQr} className="mt-2">
                <RefreshCw className="mr-2 h-4 w-4" /> Refresh QR
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
