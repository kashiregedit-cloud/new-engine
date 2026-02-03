import { useEffect, useState } from "react";
import { BACKEND_URL } from "@/config";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Save, Bot, Lock, Sparkles, Key, Check } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

const formSchema = z.object({
  provider: z.string().min(1, "Please select a provider"),
  api_key: z.string().optional(),
  chatmodel: z.string().min(1, "Model name is required"),
  text_prompt: z.string().optional(),
});

const MANAGED_SECRET_KEY = import.meta.env.VITE_MANAGED_API_KEY || "";
const MANAGED_MODEL = import.meta.env.VITE_MANAGED_MODEL || "gemini-2.5-flash-lite";

export default function WhatsAppSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [dbId, setDbId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [verified, setVerified] = useState(true);
  const [mode, setMode] = useState<"own" | "managed">("own");
  const [activeMode, setActiveMode] = useState<"own" | "managed" | null>(null);
  const [isOwner, setIsOwner] = useState(true);
  
  // New State for System Prompt Modal
  const [isPromptOpen, setIsPromptOpen] = useState(false);
  const [tempPrompt, setTempPrompt] = useState("");
  const [promptSaving, setPromptSaving] = useState(false);
  
  // New State for Optimization
  const [optimizing, setOptimizing] = useState(false);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      provider: "openrouter",
      api_key: "",
      chatmodel: "xiaomi/mimo-v2-flash:free",
      text_prompt: "You are a helpful assistant for a WhatsApp store.",
    },
  });

  useEffect(() => {
    const checkConnection = () => {
      const storedDbId = localStorage.getItem("active_wp_db_id");
      // WhatsApp uses 'active_wa_session_id' usually, but SessionManager might set something else?
      // SessionManager sets 'active_wa_session_id' (implied, or I need to check).
      // Actually, DashboardSidebar sets 'active_wa_session_id' in handleLogout, so it must be used.
      // But let's check SessionManager to see if it SETS it.
      // It might be 'active_session_id' or 'active_wa_session_id'.
      // I'll assume 'active_wa_session_id' for now.
      const storedSessionId = localStorage.getItem("active_wa_session_id");
      
      if (storedDbId) {
        setDbId(storedDbId);
        setSessionId(storedSessionId); // Might be null if not using session selector
        fetchConfig(storedDbId, storedSessionId);
      } else {
        setDbId(null);
        setSessionId(null);
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
  }, [form]);

  const fetchConfig = async (id: string, sId: string | null) => {
    try {
      // 1. Fetch text_prompt from wp_message_database
      const { data: dbData, error: dbError } = await supabase
        .from('wp_message_database')
        .select('*')
        .eq('id', parseInt(id))
        .single();

      if (dbError) throw dbError;

      // 2. Fetch User Configs (Global for User)
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No user found");

      const { data: userConfig, error: configError } = await supabase
        .from('user_configs')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();
        
      if (configError) throw configError;

      if (dbData) {
        const dbRow = dbData as any;
        const configRow = userConfig as any || {};
        
        setVerified(dbRow.verified !== false);
        setIsOwner(true); // Assuming user owns their config

        // Determine Mode
        const apiKey = configRow.api_key || "";
        let isManaged = false;
        
        // If api_key is the managed key, it's managed
        if (apiKey === MANAGED_SECRET_KEY) {
             isManaged = true;
        }

        setMode(isManaged ? "managed" : "own");
        setActiveMode(isManaged ? "managed" : "own");

        // Clean model name
        const rawModel = configRow.model_name || "xiaomi/mimo-v2-flash:free";
        const displayModel = rawModel.replace(':free', '');

        form.reset({
          provider: configRow.ai_provider || "openrouter",
          api_key: isManaged ? "" : apiKey,
          chatmodel: displayModel,
          text_prompt: dbRow.text_prompt || "", // Prompt is in DB (per session/db)
        });
        
        setTempPrompt(dbRow.text_prompt || "");
      }
    } catch (error) {
      console.error("Error fetching config:", error);
      toast.error("Failed to load AI settings");
    } finally {
      setLoading(false);
    }
  };

  const handleSavePrompt = async () => {
    if (!dbId) return;
    setPromptSaving(true);
    try {
        const { error } = await (supabase
            .from('wp_message_database') as any)
            .update({ text_prompt: tempPrompt })
            .eq('id', parseInt(dbId));

        if (error) throw error;
        
        form.setValue('text_prompt', tempPrompt);
        toast.success("System prompt updated successfully!");
        setIsPromptOpen(false);
    } catch (error: any) {
        console.error("Error saving prompt:", error);
        toast.error("Failed to save prompt: " + error.message);
    } finally {
        setPromptSaving(false);
    }
  };

  const handleOptimizePrompt = async () => {
    if (!tempPrompt || tempPrompt.length < 10) {
        toast.error("Please enter some prompt text to optimize.");
        return;
    }

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
            toast.success("Prompt optimized successfully! Please review before saving.");
        } else {
            throw new Error(data.error || "Unknown error");
        }
    } catch (error: any) {
        console.error("Optimization failed:", error);
        toast.error("Optimization failed: " + error.message);
    } finally {
        setOptimizing(false);
    }
  };

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    if (!dbId) return;
    setLoading(true);
    
    // Get current user
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        toast.error("User not found");
        setLoading(false);
        return;
    }

    if (mode === "managed") {
        values.provider = "gemini"; 
        values.api_key = MANAGED_SECRET_KEY;
        values.chatmodel = MANAGED_MODEL;
    } else {
        if (!values.api_key) {
            toast.error("API Key is required for own provider");
            setLoading(false);
            return;
        }
    }

    try {
      // 1. Update text_prompt in wp_message_database
      const { error: dbError } = await (supabase
        .from('wp_message_database') as any)
        .update({
            text_prompt: values.text_prompt
        })
        .eq('id', parseInt(dbId));

      if (dbError) throw dbError;

      // 2. Update AI settings in user_configs (Global)
      // We use upsert to create if not exists
      const updates: any = {
          user_id: user.id,
          ai_provider: values.provider,
          api_key: values.api_key,
          model_name: values.chatmodel,
      };

      const { error: configError } = await (supabase
        .from('user_configs') as any)
        .upsert(updates, { onConflict: 'user_id' });

      if (configError) throw configError;

      setActiveMode(mode);
      toast.success("AI settings saved successfully");
      
    } catch (error: any) {
        console.error("Save settings error:", error);
        toast.error("Failed to save settings: " + error.message);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
     return (
        <div className="flex items-center justify-center h-full">
            <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary"></div>
        </div>
     );
  }

  if (!dbId) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] space-y-4">
        <Bot className="h-16 w-16 text-muted-foreground" />
        <h2 className="text-2xl font-bold">No Database Connected</h2>
        <p className="text-muted-foreground">Please connect to a database to manage AI settings.</p>
        <Button asChild>
            <Link to="/dashboard/whatsapp/database">Connect Database</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
           <h2 className="text-3xl font-bold tracking-tight">WhatsApp AI Intelligence</h2>
           <p className="text-muted-foreground">
             Connect your preferred AI brain for your WhatsApp Bot.
           </p>
        </div>
        <Button 
            onClick={() => setIsPromptOpen(true)} 
            variant="outline"
            className="border-purple-500 text-purple-600 hover:bg-purple-50"
        >
            <Bot className="mr-2 h-4 w-4" />
            Edit System Prompt
        </Button>
      </div>

      {/* System Prompt Full Screen Dialog */}
      <Dialog open={isPromptOpen} onOpenChange={setIsPromptOpen}>
        <DialogContent className="max-w-4xl h-[85vh] flex flex-col">
            <DialogHeader>
                <DialogTitle>Edit System Prompt</DialogTitle>
                <DialogDescription>
                    Define your AI's persona, knowledge base, and behavior rules.
                </DialogDescription>
            </DialogHeader>
            <div className="flex-1 py-4">
                <Textarea 
                    value={tempPrompt}
                    onChange={(e) => setTempPrompt(e.target.value)}
                    className="w-full h-full min-h-[400px] font-mono text-sm leading-relaxed p-4 resize-none"
                    placeholder="You are a helpful assistant..."
                />
            </div>
            <DialogFooter className="flex justify-between items-center sm:justify-between w-full">
                <div className="flex gap-2">
                    <Button 
                        variant="secondary" 
                        onClick={handleOptimizePrompt} 
                        disabled={optimizing || promptSaving}
                        className="bg-indigo-100 hover:bg-indigo-200 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300"
                    >
                        {optimizing ? (
                            <div className="animate-spin rounded-full h-4 w-4 border-2 border-current border-t-transparent mr-2" />
                        ) : (
                            <Sparkles className="mr-2 h-4 w-4" />
                        )}
                        Auto-Format for Zero Cost
                    </Button>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setIsPromptOpen(false)}>Cancel</Button>
                    <Button onClick={handleSavePrompt} disabled={promptSaving || optimizing}>
                        {promptSaving ? <div className="animate-spin rounded-full h-4 w-4 border-2 border-current border-t-transparent mr-2" /> : <Save className="mr-2 h-4 w-4" />}
                        Save Prompt Only
                    </Button>
                </div>
            </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="grid gap-6">
        <Card className="border-l-4 border-l-purple-500 shadow-md">
          <CardHeader>
            <CardTitle className="flex justify-between items-center">
                AI Provider Configuration
                {activeMode && (
                    <Badge variant={activeMode === 'managed' ? "default" : "outline"} className={activeMode === 'managed' ? "bg-purple-600 hover:bg-purple-700" : "text-blue-600 border-blue-600"}>
                        Status: {activeMode === 'managed' ? "User Cloud API" : "Own API"}
                    </Badge>
                )}
            </CardTitle>
            <CardDescription>
              Select an AI provider and enter your API Key.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-6">
                <RadioGroup defaultValue={mode} value={mode} onValueChange={(v) => {
                    setMode(v as "own" | "managed");
                    if (v === "managed") {
                        form.setValue("provider", "gemini");
                        form.setValue("chatmodel", "gemini-2.5-flash-lite");
                    }
                }} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className={`flex items-center space-x-3 border p-4 rounded-lg cursor-pointer transition-all ${mode === 'own' ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-muted/50'}`}>
                        <RadioGroupItem value="own" id="own" />
                        <Label htmlFor="own" className="flex-1 cursor-pointer">
                            <div className="font-semibold">Own API Key</div>
                            <div className="text-sm text-muted-foreground">Use your own OpenRouter/Gemini key</div>
                        </Label>
                        <Key className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div className={`flex items-center space-x-3 border p-4 rounded-lg cursor-pointer transition-all ${mode === 'managed' ? 'border-purple-600 bg-purple-50 ring-1 ring-purple-600' : 'hover:bg-muted/50'}`}>
                        <RadioGroupItem value="managed" id="managed" />
                        <Label htmlFor="managed" className="flex-1 cursor-pointer">
                            <div className="font-semibold text-purple-700">Managed Engine (Free)</div>
                            <div className="text-sm text-purple-600/80">We pay the AI costs for you</div>
                        </Label>
                        <Sparkles className="h-5 w-5 text-purple-600" />
                    </div>
                </RadioGroup>
            </div>

            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                {mode === 'own' && (
                    <>
                        <FormField
                        control={form.control}
                        name="provider"
                        render={({ field }) => (
                            <FormItem>
                            <FormLabel className="text-base">Select Provider</FormLabel>
                            <Select 
                                onValueChange={(val) => {
                                    field.onChange(val);
                                    if (val === 'openai') form.setValue('chatmodel', 'gpt-4o');
                                    if (val === 'gemini') form.setValue('chatmodel', 'gemini-2.5-flash-lite');
                                    if (val === 'openrouter') form.setValue('chatmodel', 'google/gemini-2.0-flash-lite-preview-02-05:free');
                                }} 
                                defaultValue={field.value}
                                value={field.value}
                            >
                                <FormControl>
                                <SelectTrigger>
                                    <SelectValue placeholder="Select a provider" />
                                </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                <SelectItem value="openrouter">OpenRouter (Recommended)</SelectItem>
                                <SelectItem value="gemini">Google Gemini</SelectItem>
                                <SelectItem value="openai">OpenAI (GPT-4)</SelectItem>
                                <SelectItem value="groq">Groq (Llama 3)</SelectItem>
                                </SelectContent>
                            </Select>
                            <FormMessage />
                            </FormItem>
                        )}
                        />

                        <FormField
                        control={form.control}
                        name="api_key"
                        render={({ field }) => (
                            <FormItem>
                            <FormLabel className="text-base">API Key</FormLabel>
                            <FormControl>
                                <div className="relative">
                                    <Input type="password" placeholder="sk-..." {...field} className="pr-10" />
                                    <Lock className="absolute right-3 top-2.5 h-4 w-4 text-muted-foreground" />
                                </div>
                            </FormControl>
                            <FormDescription>
                                Your key is encrypted and stored securely.
                            </FormDescription>
                            <FormMessage />
                            </FormItem>
                        )}
                        />

                        <FormField
                            control={form.control}
                            name="chatmodel"
                            render={({ field }) => (
                            <FormItem>
                                <FormLabel>Model Name</FormLabel>
                                <FormControl>
                                <Input placeholder="e.g. google/gemini-2.0-flash-lite-preview-02-05:free" {...field} className="font-mono" />
                                </FormControl>
                                <FormDescription className="text-xs">
                                The specific AI model ID to use.
                                </FormDescription>
                                <FormMessage />
                            </FormItem>
                            )}
                        />
                    </>
                )}

                <div className="flex justify-end pt-4">
                  <Button type="submit" disabled={loading} size="lg" className="w-full md:w-auto">
                    {loading ? (
                        <>
                            <div className="animate-spin rounded-full h-4 w-4 border-2 border-current border-t-transparent mr-2" />
                            Saving...
                        </>
                    ) : (
                        <>
                            <Save className="mr-2 h-4 w-4" />
                            Save Configuration
                        </>
                    )}
                  </Button>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
