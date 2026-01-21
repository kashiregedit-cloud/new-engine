import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Save, ExternalLink, ChevronDown, ChevronUp, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
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
  ai_provider: z.string().min(1, "Please select a provider"),
  api_key: z.string().min(1, "API Key is required"),
  model_name: z.string().min(1, "Model name is required"),
  system_prompt: z.string().optional(),
});

export default function SettingsPage() {
  const [loading, setLoading] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      ai_provider: "openrouter",
      api_key: "",
      model_name: "xiaomi/mimo-v2-flash:free",
      system_prompt: "You are a helpful assistant for a WhatsApp store.",
    },
  });

  useEffect(() => {
    const fetchConfig = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('user_configs')
        .select('*')
        .eq('user_id', user.id)
        .single();

      if (data) {
        form.reset({
          ai_provider: data.ai_provider || "openrouter",
          api_key: data.api_key || "",
          model_name: data.model_name || "xiaomi/mimo-v2-flash:free",
          system_prompt: data.system_prompt || "",
        });
      }
    };
    fetchConfig();
  }, [form]);

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No user found");

      const { error } = await supabase.from('user_configs').upsert({
        user_id: user.id,
        ai_provider: values.ai_provider,
        api_key: values.api_key,
        model_name: values.model_name,
        system_prompt: values.system_prompt,
        updated_at: new Date().toISOString(),
      });

      if (error) throw error;
      toast.success("Settings saved successfully");
    } catch (error: any) {
      console.error("Error saving settings:", error);
      toast.error(error.message || "Failed to save settings");
    } finally {
      setLoading(false);
    }
  };

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
                  name="ai_provider"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-base">Select Provider</FormLabel>
                      <Select 
                        onValueChange={(val) => {
                            field.onChange(val);
                            // Auto-set recommended models
                            if (val === 'openai') form.setValue('model_name', 'openai/gpt-4o');
                            if (val === 'google') form.setValue('model_name', 'google/gemini-2.0-flash-lite-preview-02-05:free');
                            if (val === 'groq') form.setValue('model_name', 'groq/llama-3.3-70b-versatile');
                            if (val === 'openrouter') form.setValue('model_name', 'xiaomi/mimo-v2-flash:free');
                            if (val === 'xai') form.setValue('model_name', 'xai/grok-beta');
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
                                name="model_name"
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
                              name="system_prompt"
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
