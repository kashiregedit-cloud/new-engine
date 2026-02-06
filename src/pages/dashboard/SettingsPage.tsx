import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Save, ExternalLink, ChevronDown, ChevronUp, Settings2, Bot, Lock } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
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

const formSchema = z.object({
  provider: z.string().min(1, "Please select a provider"),
  api_key: z.string().min(1, "API Key is required"),
  chatmodel: z.string().min(1, "Model name is required"),
  text_prompt: z.string().optional(),
});

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [dbId, setDbId] = useState<string | null>(null);
  const [verified, setVerified] = useState(true);
  
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      provider: "openrouter",
      api_key: "",
      chatmodel: "gemini-2.5-flash",
      text_prompt: "You are a helpful assistant for a WhatsApp store.",
    },
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
  }, [form]);

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
        form.reset({
          provider: row.provider || "google",
          api_key: row.api_key || "",
          chatmodel: row.chatmodel || "gemini-2.5-flash",
          text_prompt: row.text_prompt || "",
        });
      }
    } catch (error) {
      console.error("Error fetching config:", error);
      toast.error("Failed to load AI settings");
    } finally {
      setLoading(false);
    }
  };

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    if (!dbId) return;
    setLoading(true);
    try {
      const { error } = await (supabase
        .from('wp_message_database') as any)
        .update({
            provider: values.provider,
            api_key: values.api_key,
            chatmodel: values.chatmodel,
            text_prompt: values.text_prompt
        })
        .eq('id', parseInt(dbId));

      if (error) throw error;
      toast.success("AI settings saved successfully");
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error";
        toast.error("Failed to save settings: " + message);
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
            <Link to="/dashboard/database">Go to Database</Link>
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
              Your session has expired or is unverified. Please reactivate your account to access AI settings.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
           <h2 className="text-3xl font-bold tracking-tight">AI Intelligence</h2>
           <p className="text-muted-foreground">
             Connect your preferred AI brain (GPT, Claude, Gemini, etc.)
           </p>
        </div>
      </div>

      <div className="grid gap-6">
        <Card className="border-l-4 border-l-purple-500 shadow-md">
          <CardHeader>
            <CardTitle>AI Provider Configuration</CardTitle>
            <CardDescription>
              Select an AI provider and enter your API Key. We'll handle the rest.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                <FormField
                  control={form.control}
                  name="provider"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-base">Select Provider</FormLabel>
                      <Select 
                        onValueChange={(val) => {
                            field.onChange(val);
                            // Auto-set recommended models
                            if (val === 'openai') form.setValue('chatmodel', 'openai/gpt-4o');
                            if (val === 'google') form.setValue('chatmodel', 'google/gemini-2.0-flash-lite-preview-02-05:free');
                            if (val === 'groq') form.setValue('chatmodel', 'groq/llama-3.3-70b-versatile');
                            if (val === 'openrouter') form.setValue('chatmodel', 'arcee-ai/trinity-large-preview');
                            if (val === 'xai') form.setValue('chatmodel', 'xai/grok-beta');
                        }} 
                        defaultValue={field.value} 
                        value={field.value}
                      >
                        <FormControl>
                          <SelectTrigger className="h-12">
                            <SelectValue placeholder="Select a provider" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="openrouter">🚀 OpenRouter (Recommended - All Models)</SelectItem>
                          <SelectItem value="openai">🟢 OpenAI (ChatGPT)</SelectItem>
                          <SelectItem value="google">🔵 Google (Gemini)</SelectItem>
                          <SelectItem value="groq">⚡ Groq (Super Fast)</SelectItem>
                          <SelectItem value="xai">❌ X AI (Grok)</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormDescription>
                         Don't have a key? <a href="https://openrouter.ai/keys" target="_blank" className="text-primary hover:underline inline-flex items-center gap-1">Get one here <ExternalLink size={12}/></a>
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="api_key"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>API Key</FormLabel>
                      <FormControl>
                        <Input placeholder="sk-or-..." type="password" {...field} className="font-mono h-12" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="border rounded-lg p-4 bg-secondary/10">
                    <button 
                        type="button" 
                        onClick={() => setShowAdvanced(!showAdvanced)}
                        className="flex items-center justify-between w-full text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                    >
                        <div className="flex items-center gap-2">
                            <Settings2 size={16} />
                            Advanced Settings (Model & Prompt)
                        </div>
                        {showAdvanced ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </button>

                    {showAdvanced && (
                        <div className="mt-4 space-y-4 animate-in fade-in slide-in-from-top-2">
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

                            <FormField
                              control={form.control}
                              name="text_prompt"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>System Instruction (Prompt)</FormLabel>
                                  <FormControl>
                                    <Textarea 
                                      placeholder="You are a helpful assistant for a WhatsApp store..." 
                                      className="min-h-[150px] font-sans text-base leading-relaxed"
                                      {...field} 
                                    />
                                  </FormControl>
                                  <FormDescription>
                                    Tell the AI how to behave. Include your store name, policies, and tone.
                                  </FormDescription>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                        </div>
                    )}
                </div>

                <Button type="submit" disabled={loading} size="lg" className="w-full">
                  {loading && <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-white mr-2"></div>}
                  <Save className="mr-2 h-4 w-4" />
                  Save AI Settings
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}