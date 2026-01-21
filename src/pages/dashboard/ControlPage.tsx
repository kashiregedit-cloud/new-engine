import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Bot, MessageSquare, Loader2, Save, Image, Sparkles, MessageCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export default function ControlPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState({
    auto_reply: true,
    ai_enabled: true,
    media_enabled: true,
    response_language: 'bn',
    response_tone: 'professional'
  });

  useEffect(() => {
    fetchConfig();
  }, []);

  const fetchConfig = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
      .from('user_configs')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle(); // Use maybeSingle() instead of single() to avoid 406 error
    
    if (data) {
      setConfig({
        auto_reply: data.auto_reply ?? true,
        ai_enabled: data.ai_enabled ?? true,
        media_enabled: data.media_enabled ?? true,
        response_language: data.response_language || 'bn',
        response_tone: data.response_tone || 'professional'
      });
    }
    } catch (error) {
      console.error('Error fetching config:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error("Please login first");
        return;
      }

      const { error } = await supabase.from('user_configs').upsert({
        user_id: user.id,
        ...config
      });
      if (error) throw error;
      toast.success("Settings saved successfully");
    } catch (error: any) {
      toast.error("Failed to save settings: " + error.message);
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

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-bold text-foreground tracking-tight">Bot Control</h2>
          <p className="text-muted-foreground">
            Manage how your bot interacts with customers.
          </p>
        </div>
        <Button onClick={handleSave} disabled={saving} size="lg" className="shadow-lg">
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Save Changes
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Main Toggles */}
        <Card className="bg-card border-border shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bot className="h-5 w-5 text-primary" />
              Automation Features
            </CardTitle>
            <CardDescription>Turn core features on or off instantly</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            
            <div className="flex items-center justify-between p-3 bg-secondary/20 rounded-lg hover:bg-secondary/40 transition-colors">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-100 text-blue-600 rounded-full">
                   <MessageCircle size={20} />
                </div>
                <div className="space-y-0.5">
                  <Label className="text-base font-semibold cursor-pointer">Auto Reply</Label>
                  <p className="text-xs text-muted-foreground">
                    Master switch for all automated replies
                  </p>
                </div>
              </div>
              <Switch 
                checked={config.auto_reply}
                onCheckedChange={(c) => setConfig({...config, auto_reply: c})}
              />
            </div>

            <div className="flex items-center justify-between p-3 bg-secondary/20 rounded-lg hover:bg-secondary/40 transition-colors">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-purple-100 text-purple-600 rounded-full">
                   <Sparkles size={20} />
                </div>
                <div className="space-y-0.5">
                  <Label className="text-base font-semibold cursor-pointer">AI Intelligence</Label>
                  <p className="text-xs text-muted-foreground">
                    Use AI to generate smart answers
                  </p>
                </div>
              </div>
              <Switch 
                checked={config.ai_enabled}
                onCheckedChange={(c) => setConfig({...config, ai_enabled: c})}
              />
            </div>

            <div className="flex items-center justify-between p-3 bg-secondary/20 rounded-lg hover:bg-secondary/40 transition-colors">
              <div className="flex items-center gap-3">
                 <div className="p-2 bg-green-100 text-green-600 rounded-full">
                   <Image size={20} />
                </div>
                <div className="space-y-0.5">
                  <Label className="text-base font-semibold cursor-pointer">Media Analysis</Label>
                  <p className="text-xs text-muted-foreground">
                    Allow bot to see images and hear audio
                  </p>
                </div>
              </div>
              <Switch 
                checked={config.media_enabled}
                onCheckedChange={(c) => setConfig({...config, media_enabled: c})}
              />
            </div>

          </CardContent>
        </Card>

        {/* Personality Settings */}
        <Card className="bg-card border-border shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-primary" />
              Bot Personality
            </CardTitle>
            <CardDescription>Customize how your bot speaks</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-3">
              <Label className="text-base">Response Language</Label>
              <Select 
                value={config.response_language} 
                onValueChange={(v) => setConfig({...config, response_language: v})}
              >
                <SelectTrigger className="h-12">
                  <SelectValue placeholder="Select language" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bn">🇧🇩 Bangla (বাংলা)</SelectItem>
                  <SelectItem value="en">🇺🇸 English</SelectItem>
                  <SelectItem value="hi">🇮🇳 Hindi (हिंदी)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">The primary language for responses.</p>
            </div>

            <div className="space-y-3">
              <Label className="text-base">Tone of Voice</Label>
              <Select 
                value={config.response_tone} 
                onValueChange={(v) => setConfig({...config, response_tone: v})}
              >
                <SelectTrigger className="h-12">
                  <SelectValue placeholder="Select tone" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="professional">👔 Professional (Polite & Formal)</SelectItem>
                  <SelectItem value="friendly">😊 Friendly (Casual & Warm)</SelectItem>
                  <SelectItem value="casual">😎 Casual (Short & Relaxed)</SelectItem>
                </SelectContent>
              </Select>
               <p className="text-xs text-muted-foreground">Sets the mood of the conversation.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
