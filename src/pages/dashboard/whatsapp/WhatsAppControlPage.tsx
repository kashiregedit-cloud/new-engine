import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Bot, MessageSquare, Loader2, Save, Image, Sparkles, MessageCircle, Lock, PackageSearch, ReplyAll, Mic, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Link } from "react-router-dom";

export default function WhatsAppControlPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dbId, setDbId] = useState<string | null>(null);
  const [verified, setVerified] = useState(true);
  const [config, setConfig] = useState({
    reply_message: false,
    swipe_reply: false,
    image_detection: false,
    image_send: false,
    order_tracking: false,
    audio_detection: false,
    file_upload: false
  });

  useEffect(() => {
    const checkConnection = () => {
      const storedDbId = localStorage.getItem("active_wp_db_id");
      if (storedDbId) {
        setDbId(storedDbId);
        fetchConfig(storedDbId);
      } else {
        setDbId(null);
        setLoading(false);
      }
    };

    checkConnection();

    window.addEventListener("storage", checkConnection);
    window.addEventListener("db-connection-changed", checkConnection);

    return () => {
      window.removeEventListener("storage", checkConnection);
      window.removeEventListener("db-connection-changed", checkConnection);
    };
  }, []);

  const fetchConfig = async (id: string) => {
    try {
      const { data, error } = await supabase
        .from('wp_message_database')
        .select('*')
        .eq('id', parseInt(id))
        .single();

      if (error) throw error;

      if (data) {
        // Explicitly cast data to any to bypass 'never' type inference
        const row = data as any;
        setVerified(row.verified !== false); 
        setConfig({
          reply_message: row.reply_message ?? false,
          swipe_reply: row.swipe_reply ?? false,
          image_detection: row.image_detection ?? false,
          image_send: row.image_send ?? false,
          order_tracking: row.order_tracking ?? false,
          audio_detection: row.audio_detection ?? false,
          file_upload: row.file_upload ?? false
        });
      }
    } catch (error) {
      console.error('Error fetching config:', error);
      toast.error("Failed to load configuration");
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!dbId) return;
    setSaving(true);
    try {
      const { error } = await (supabase
        .from('wp_message_database') as any)
        .update(config)
        .eq('id', parseInt(dbId));

      if (error) throw error;
      toast.success("Settings saved successfully");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      toast.error("Failed to save settings: " + message);
      console.error(error);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!dbId) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] space-y-4">
        <Bot className="h-16 w-16 text-muted-foreground" />
        <h2 className="text-2xl font-bold">No Database Connected</h2>
        <p className="text-muted-foreground">Please connect to a database to manage bot controls.</p>
        <Button asChild>
            <Link to="/dashboard/whatsapp/database">Go to Database</Link>
        </Button>
      </div>
    );
  }

  if (!verified) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 backdrop-blur-sm p-4">
        <div className="max-w-md w-full text-center space-y-6 p-8 rounded-xl border bg-card shadow-2xl">
          <div className="mx-auto w-16 h-16 bg-destructive/10 rounded-full flex items-center justify-center">
            <Lock className="w-8 h-8 text-destructive" />
          </div>
          <div className="space-y-2">
            <h2 className="text-2xl font-bold text-destructive">Account Locked</h2>
            <p className="text-muted-foreground">
              Your session has expired or is unverified. Please reactivate your account to access bot controls.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-bold text-foreground tracking-tight">Bot Control</h2>
          <p className="text-muted-foreground">
            Manage your automation features.
          </p>
        </div>
        <Button onClick={handleSave} disabled={saving} size="lg" className="shadow-lg">
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Save Changes
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Reply Message */}
        <Card className="bg-card border-border shadow-sm">
          <CardContent className="p-6 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-blue-100 text-blue-600 rounded-full">
                 <MessageCircle size={24} />
              </div>
              <div className="space-y-1">
                <Label className="text-lg font-semibold cursor-pointer">Reply Message</Label>
                <p className="text-sm text-muted-foreground">Auto-reply to incoming texts.</p>
              </div>
            </div>
            <Switch 
              checked={config.reply_message}
              onCheckedChange={(c) => setConfig({...config, reply_message: c})}
            />
          </CardContent>
        </Card>

        {/* Swipe Reply */}
        <Card className="bg-card border-border shadow-sm">
          <CardContent className="p-6 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-purple-100 text-purple-600 rounded-full">
                 <ReplyAll size={24} />
              </div>
              <div className="space-y-1">
                <Label className="text-lg font-semibold cursor-pointer">Swipe Reply</Label>
                <p className="text-sm text-muted-foreground">Enable swipe-to-reply context.</p>
              </div>
            </div>
            <Switch 
              checked={config.swipe_reply}
              onCheckedChange={(c) => setConfig({...config, swipe_reply: c})}
            />
          </CardContent>
        </Card>

        {/* Image Detection */}
        <Card className="bg-card border-border shadow-sm">
          <CardContent className="p-6 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-green-100 text-green-600 rounded-full">
                 <Image size={24} />
              </div>
              <div className="space-y-1">
                <Label className="text-lg font-semibold cursor-pointer">Image Detection</Label>
                <p className="text-sm text-muted-foreground">Analyze received images.</p>
              </div>
            </div>
            <Switch 
              checked={config.image_detection}
              onCheckedChange={(c) => setConfig({...config, image_detection: c})}
            />
          </CardContent>
        </Card>

        {/* Image Send */}
        <Card className="bg-card border-border shadow-sm">
          <CardContent className="p-6 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-orange-100 text-orange-600 rounded-full">
                 <Image size={24} />
              </div>
              <div className="space-y-1">
                <Label className="text-lg font-semibold cursor-pointer">Image Send</Label>
                <p className="text-sm text-muted-foreground">Allow bot to send images.</p>
              </div>
            </div>
            <Switch 
              checked={config.image_send}
              onCheckedChange={(c) => setConfig({...config, image_send: c})}
            />
          </CardContent>
        </Card>

        {/* Order Tracking */}
        <Card className="bg-card border-border shadow-sm">
          <CardContent className="p-6 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-pink-100 text-pink-600 rounded-full">
                 <PackageSearch size={24} />
              </div>
              <div className="space-y-1">
                <Label className="text-lg font-semibold cursor-pointer">Order Tracking</Label>
                <p className="text-sm text-muted-foreground">Automated order status checks.</p>
              </div>
            </div>
            <Switch 
              checked={config.order_tracking}
              onCheckedChange={(c) => setConfig({...config, order_tracking: c})}
            />
          </CardContent>
        </Card>

        {/* Audio Detection */}
        <Card className="bg-card border-border shadow-sm">
          <CardContent className="p-6 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-yellow-100 text-yellow-600 rounded-full">
                 <Mic size={24} />
              </div>
              <div className="space-y-1">
                <Label className="text-lg font-semibold cursor-pointer">Audio Detection</Label>
                <p className="text-sm text-muted-foreground">Transcribe and process audio messages.</p>
              </div>
            </div>
            <Switch 
              checked={config.audio_detection}
              onCheckedChange={(c) => setConfig({...config, audio_detection: c})}
            />
          </CardContent>
        </Card>

        {/* Direct File Upload */}
        <Card className="bg-card border-border shadow-sm">
          <CardContent className="p-6 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-indigo-100 text-indigo-600 rounded-full">
                 <Upload size={24} />
              </div>
              <div className="space-y-1">
                <Label className="text-lg font-semibold cursor-pointer">Direct File Upload</Label>
                <p className="text-sm text-muted-foreground">Allow users to upload files directly.</p>
              </div>
            </div>
            <Switch 
              checked={config.file_upload}
              onCheckedChange={(c) => setConfig({...config, file_upload: c})}
            />
          </CardContent>
        </Card>

      </div>
    </div>
  );
}
