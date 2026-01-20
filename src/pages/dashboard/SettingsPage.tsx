import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Save } from "lucide-react";
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

      // Check if config exists
      const { data: existing } = await supabase
        .from('user_configs')
        .select('id')
        .eq('user_id', user.id)
        .single();

      let error;
      if (existing) {
        const { error: updateError } = await supabase
          .from('user_configs')
          .update({
            ai_provider: values.ai_provider,
            api_key: values.api_key,
            model_name: values.model_name,
            system_prompt: values.system_prompt,
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', user.id);
        error = updateError;
      } else {
        const { error: insertError } = await supabase
          .from('user_configs')
          .insert({
            user_id: user.id,
            ai_provider: values.ai_provider,
            api_key: values.api_key,
            model_name: values.model_name,
            system_prompt: values.system_prompt,
          });
        error = insertError;
      }

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
      <div>
        <h2 className="text-2xl font-bold tracking-tight">AI Settings</h2>
        <p className="text-muted-foreground">
          Configure your AI provider and model settings.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>AI Provider Configuration</CardTitle>
          <CardDescription>
            Select your preferred AI provider and enter the API key.
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
                    <FormLabel>Provider</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a provider" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="openrouter">OpenRouter (Recommended)</SelectItem>
                        <SelectItem value="openai">OpenAI</SelectItem>
                        <SelectItem value="google">Google (Gemini)</SelectItem>
                        <SelectItem value="groq">Groq</SelectItem>
                        <SelectItem value="xai">X AI (Grok)</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      Choose the AI service you want to use.
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
                      <Input placeholder="sk-..." type="password" {...field} />
                    </FormControl>
                    <FormDescription>
                      Your API key from the selected provider.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="model_name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Model Name</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. gpt-4o, gemini-pro" {...field} />
                    </FormControl>
                    <FormDescription>
                      The specific model identifier to use.
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
                    <FormLabel>System Prompt</FormLabel>
                    <FormControl>
                      <Textarea 
                        placeholder="You are a helpful assistant..." 
                        className="min-h-[100px]"
                        {...field} 
                      />
                    </FormControl>
                    <FormDescription>
                      The initial instruction given to the AI.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button type="submit" disabled={loading}>
                {loading && <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-white mr-2"></div>}
                <Save className="mr-2 h-4 w-4" />
                Save Settings
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
