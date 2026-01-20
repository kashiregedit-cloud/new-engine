import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Bot, MessageSquare, Loader2, Save } from "lucide-react";
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
        .single();

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

      // Check if config exists
      const { data: existing } = await supabase
        .from('user_configs')
        .select('id')
        .eq('user_id', user.id)
        .single();

      const payload = {
        user_id: user.id,
        ...config
      };

      if (existing) {
         const { error } = await supabase.from('user_configs').update(config).eq('user_id', user.id);
         if (error) throw error;
      } else {
         const { error } = await supabase.from('user_configs').insert(payload);
         if (error) throw error;
      }
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
          <h2 className="text-2xl font-bold text-foreground">Control Page</h2>
          <p className="text-muted-foreground">
            Configure your chatbot behavior and automation settings
          </p>
        </div>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Save Changes
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Bot Settings */}
        <Card className="bg-card border-border">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Bot className="h-5 w-5 text-primary" />
              <CardTitle>Bot Settings</CardTitle>
            </div>
            <CardDescription>Configure chatbot behavior</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Auto Reply</Label>
                <p className="text-sm text-muted-foreground">
                  Automatically respond to messages
                </p>
              </div>
              <Switch 
                checked={config.auto_reply}
                onCheckedChange={(c) => setConfig({...config, auto_reply: c})}
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>AI Powered Responses</Label>
                <p className="text-sm text-muted-foreground">
                  Use AI to generate smart replies
                </p>
              </div>
              <Switch 
                checked={config.ai_enabled}
                onCheckedChange={(c) => setConfig({...config, ai_enabled: c})}
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Media Analysis (Image/Audio)</Label>
                <p className="text-sm text-muted-foreground">
                  Analyze images and audio for product queries
                </p>
              </div>
              <Switch 
                checked={config.media_enabled}
                onCheckedChange={(c) => setConfig({...config, media_enabled: c})}
              />
            </div>
          </CardContent>
        </Card>

        {/* Response Settings */}
        <Card className="bg-card border-border">
          <CardHeader>
            <div className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-primary" />
              <CardTitle>Response Settings</CardTitle>
            </div>
            <CardDescription>Customize message responses</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label>Response Language</Label>
              <Select 
                value={config.response_language} 
                onValueChange={(v) => setConfig({...config, response_language: v})}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select language" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bn">বাংলা (Bengali)</SelectItem>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="hi">हिंदी (Hindi)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Response Tone</Label>
              <Select 
                value={config.response_tone} 
                onValueChange={(v) => setConfig({...config, response_tone: v})}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select tone" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="professional">Professional</SelectItem>
                  <SelectItem value="friendly">Friendly</SelectItem>
                  <SelectItem value="casual">Casual</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
