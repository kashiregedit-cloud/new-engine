import { useEffect, useRef, useState } from "react";
import { BACKEND_URL } from "@/config";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Bot, MessageSquare, Loader2, Save, Image, Sparkles, MessageCircle, Lock, PackageSearch, ReplyAll, LayoutTemplate, Hand, StopCircle, RefreshCcw, Edit } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Link } from "react-router-dom";

export default function MessengerControlPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dbId, setDbId] = useState<string | null>(null);
  const [pageId, setPageId] = useState<string | null>(null);
  const [verified, setVerified] = useState(true);
  
  // Prompt State
  const [isPromptOpen, setIsPromptOpen] = useState(false);
  const [tempPrompt, setTempPrompt] = useState("");
  const [promptSaving, setPromptSaving] = useState(false);
  const [optimizing, setOptimizing] = useState(false);

  const [config, setConfig] = useState({
    reply_message: false,
    swipe_reply: false,
    image_detection: false,
    image_send: false,
    template: false,
    order_tracking: false,
    block_emoji: '',
    unblock_emoji: '',
    check_conversion: 10,
    text_prompt: '',
  });

  const lastDbIdRef = useRef<string | null>(null);

  useEffect(() => {
    const checkConnection = () => {
      const storedDbId = localStorage.getItem("active_fb_db_id");
      const storedPageId = localStorage.getItem("active_fb_page_id");
      
      if (storedDbId) {
        if (storedDbId !== lastDbIdRef.current) {
          lastDbIdRef.current = storedDbId;
          setDbId(storedDbId);
          if (storedPageId) setPageId(storedPageId);
          fetchConfig(storedDbId);
        }
      } else {
        lastDbIdRef.current = null;
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
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      const res = await fetch(`${BACKEND_URL}/messenger/config/${id}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });

      if (!res.ok) {
        throw new Error(`Failed to load configuration (${res.status})`);
      }

      const row: any = await res.json();

      setPageId(row.page_id || null);
      setVerified(row.verified !== false); 
      setConfig({
        reply_message: row.reply_message ?? false,
        swipe_reply: row.swipe_reply ?? false,
        image_detection: row.image_detection ?? false,
        image_send: row.image_send ?? false,
        template: row.template ?? false,
        order_tracking: row.order_tracking ?? false,
        block_emoji: row.block_emoji ?? '',
        unblock_emoji: row.unblock_emoji ?? '',
        check_conversion: row.check_conversion ?? 10,
        text_prompt: row.text_prompt ?? '',
      });
      setTempPrompt(row.text_prompt ?? '');
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
      const payload = { ...config };

      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      const res = await fetch(`${BACKEND_URL}/messenger/config/${dbId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        const msg = errBody.error || `Failed with status ${res.status}`;
        throw new Error(msg);
      }

      toast.success("Settings saved successfully");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      toast.error("Failed to save settings: " + message);
      console.error(error);
    } finally {
      setSaving(false);
    }
  };

  const handleSavePrompt = async () => {
    if (!dbId) return;
    setPromptSaving(true);
    try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;

        const res = await fetch(`${BACKEND_URL}/messenger/config/${dbId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {})
            },
            body: JSON.stringify({ text_prompt: tempPrompt })
        });

        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            const message = body.error || `Failed with status ${res.status}`;
            throw new Error(message);
        }
        
        // Update local config state
        setConfig(prev => ({ ...prev, text_prompt: tempPrompt }));
        
        toast.success("System prompt updated successfully!");
        
        // Auto-Trigger RAG Ingestion in Background
        if (pageId) {
            fetch(`${BACKEND_URL}/api/ai/ingest`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pageId: pageId, promptText: tempPrompt })
            }).then(() => console.log("RAG Ingestion Triggered"))
              .catch(err => console.error("RAG Ingestion Failed", err));
        }

        setIsPromptOpen(false);
    } catch (error: any) {
        console.error("Error saving prompt:", error);
        toast.error("Failed to save prompt: " + error.message);
    } finally {
        setPromptSaving(false);
    }
  };

  const handleOptimizePrompt = async () => {
    if (!tempPrompt) return;
    setOptimizing(true);
    try {
      const response = await fetch(`${BACKEND_URL}/api/ai/optimize-prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ promptText: tempPrompt })
      });
        
        const data = await response.json();
        if (data.success && data.optimizedPrompt) {
            setTempPrompt(data.optimizedPrompt);
            toast.success("Prompt optimized successfully!");
        } else {
            throw new Error(data.error || "Optimization failed");
        }
    } catch (error: any) {
        console.error("Optimization error:", error);
        toast.error("Failed to optimize: " + error.message);
    } finally {
        setOptimizing(false);
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
        <h2 className="text-2xl font-bold">No Page Connected</h2>
        <p className="text-muted-foreground">Please select a Facebook page to manage.</p>
        <Button asChild>
            <Link to="/dashboard/messenger/integration">Go to Pages</Link>
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
          <h2 className="text-3xl font-bold text-foreground tracking-tight">Messenger Bot Control</h2>
          <p className="text-muted-foreground">
            Manage your Facebook Messenger automation features.
          </p>
        </div>
        <div className="flex gap-2">
            <Button onClick={handleSave} disabled={saving} size="lg" className="shadow-lg">
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save Changes
            </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Reply Message */}
        <Card className="bg-[#0f0f0f]/80 backdrop-blur-sm border border-white/10">
          <CardContent className="p-6 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-full border border-[#00ff88]/40 bg-[#00ff88]/10 text-[#00ff88] shadow-[0_0_25px_rgba(0,255,136,0.25)]">
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
        <Card className="bg-[#0f0f0f]/80 backdrop-blur-sm border border-white/10">
          <CardContent className="p-6 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-full border border-[#00ff88]/40 bg-[#00ff88]/10 text-[#00ff88] shadow-[0_0_25px_rgba(0,255,136,0.25)]">
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

        {/* Image Send */}
        <Card className="bg-[#0f0f0f]/80 backdrop-blur-sm border border-white/10">
          <CardContent className="p-6 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-full border border-[#00ff88]/40 bg-[#00ff88]/10 text-[#00ff88] shadow-[0_0_25px_rgba(0,255,136,0.25)]">
                 <Image size={24} />
              </div>
              <div className="space-y-1">
                <Label className="text-lg font-semibold cursor-pointer">Image Detection</Label>
                <p className="text-sm text-muted-foreground">Analyze received images with AI.</p>
              </div>
            </div>
            <Switch 
              checked={config.image_detection}
              onCheckedChange={(c) => setConfig({...config, image_detection: c})}
            />
          </CardContent>
        </Card>

        {/* Image Send */}
        <Card className="bg-[#0f0f0f]/80 backdrop-blur-sm border border-white/10">
          <CardContent className="p-6 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-full border border-[#00ff88]/40 bg-[#00ff88]/10 text-[#00ff88] shadow-[0_0_25px_rgba(0,255,136,0.25)]">
                 <Sparkles size={24} />
              </div>
              <div className="space-y-1">
                <Label className="text-lg font-semibold cursor-pointer">Image Send</Label>
                <p className="text-sm text-muted-foreground">Allow bot to send generated images.</p>
              </div>
            </div>
            <Switch 
              checked={config.image_send}
              onCheckedChange={(c) => setConfig({...config, image_send: c})}
            />
          </CardContent>
        </Card>

         {/* Template */}
         <Card className="bg-[#0f0f0f]/80 backdrop-blur-sm border border-white/10">
          <CardContent className="p-6 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-full border border-[#00ff88]/40 bg-[#00ff88]/10 text-[#00ff88] shadow-[0_0_25px_rgba(0,255,136,0.25)]">
                 <LayoutTemplate size={24} />
              </div>
              <div className="space-y-1">
                <Label className="text-lg font-semibold cursor-pointer">Template</Label>
                <p className="text-sm text-muted-foreground">Use templates for structured messages.</p>
              </div>
            </div>
            <Switch 
              checked={config.template}
              onCheckedChange={(c) => setConfig({...config, template: c})}
            />
          </CardContent>
        </Card>

        {/* Order Tracking */}
        <Card className="bg-[#0f0f0f]/80 backdrop-blur-sm border border-white/10">
          <CardContent className="p-6 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-full border border-[#00ff88]/40 bg-[#00ff88]/10 text-[#00ff88]">
                 <PackageSearch size={24} />
              </div>
              <div className="space-y-1">
                <Label className="text-lg font-semibold cursor-pointer">Order Tracking</Label>
                <p className="text-sm text-muted-foreground">Track and manage orders automatically.</p>
              </div>
            </div>
            <Switch 
              checked={config.order_tracking}
              onCheckedChange={(c) => setConfig({...config, order_tracking: c})}
            />
          </CardContent>
        </Card>

      </div>

      {/* Human Handover / Block Logic Section */}
      <Card className="bg-[#0f0f0f]/80 backdrop-blur-sm border border-white/10">
        <CardHeader>
            <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl border border-[#00ff88]/40 bg-[#00ff88]/10 text-[#00ff88] shadow-[0_0_25px_rgba(0,255,136,0.25)]">
                    <Hand size={24} />
                </div>
                <div>
                    <CardTitle>Human Handover Settings</CardTitle>
                    <CardDescription>Configure how and when the AI should pause for a human agent.</CardDescription>
                </div>
            </div>
        </CardHeader>
        <CardContent className="grid gap-6 md:grid-cols-3">
            
            <div className="space-y-2">
                <Label className="flex items-center gap-2">
                    <StopCircle className="w-4 h-4 text-red-500" />
                    Block Emoji
                </Label>
                <Input 
                    placeholder="e.g. 🛑" 
                    value={config.block_emoji} 
                    onChange={(e) => setConfig({...config, block_emoji: e.target.value})}
                />
                <p className="text-xs text-muted-foreground">
                    AI stops if this emoji is found in recent messages.
                </p>
            </div>

            <div className="space-y-2">
                <Label className="flex items-center gap-2">
                    <RefreshCcw className="w-4 h-4 text-green-500" />
                    Unblock Emoji
                </Label>
                <Input 
                    placeholder="e.g. ✅" 
                    value={config.unblock_emoji} 
                    onChange={(e) => setConfig({...config, unblock_emoji: e.target.value})}
                />
                <p className="text-xs text-muted-foreground">
                    AI resumes if this emoji is sent after a block.
                </p>
            </div>

            <div className="space-y-2">
                <Label className="flex items-center gap-2">
                    <MessageSquare className="w-4 h-4 text-blue-500" />
                    Check Conversion Limit
                </Label>
                <Input 
                    type="number" 
                    min={1}
                    max={50}
                    value={config.check_conversion} 
                    onChange={(e) => setConfig({...config, check_conversion: parseInt(e.target.value) || 10})}
                />
                <p className="text-xs text-muted-foreground">
                    Number of recent messages to check for emojis.
                </p>
            </div>

        </CardContent>
      </Card>
    </div>
  );
}
