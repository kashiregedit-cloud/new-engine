import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Save, Bot, Lock } from "lucide-react";
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

export default function MessengerSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [dbId, setDbId] = useState<string | null>(null);
  const [pageId, setPageId] = useState<string | null>(null);
  const [verified, setVerified] = useState(true);
  
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      provider: "openrouter",
      api_key: "",
      chatmodel: "xiaomi/mimo-v2-flash:free",
      text_prompt: "You are a helpful assistant for a Facebook page.",
    },
  });

  useEffect(() => {
    const checkConnection = () => {
      const storedDbId = localStorage.getItem("active_fb_db_id");
      const storedPageId = localStorage.getItem("active_fb_page_id");
      
      if (storedDbId && storedPageId) {
        setDbId(storedDbId);
        setPageId(storedPageId);
        fetchConfig(storedDbId, storedPageId);
      } else {
        setDbId(null);
        setPageId(null);
        setLoading(false);
      }
    };

    checkConnection();

    window.addEventListener("storage", checkConnection);
    
    return () => {
      window.removeEventListener("storage", checkConnection);
    };
  }, [form]);

  const fetchConfig = async (id: string, pId: string) => {
    try {
      // Fetch text_prompt from fb_message_database
      const { data: dbData, error: dbError } = await supabase
        .from('fb_message_database')
        .select('*')
        .eq('id', parseInt(id))
        .single();

      if (dbError) throw dbError;

      // Fetch AI settings from page_access_token_message
      const { data: pageData, error: pageError } = await supabase
        .from('page_access_token_message')
        .select('*')
        .eq('page_id', pId)
        .single();
        
      if (pageError) throw pageError;

      if (dbData && pageData) {
        const dbRow = dbData as any;
        const pageRow = pageData as any;
        
        setVerified(dbRow.verified !== false);
        
        form.reset({
          provider: pageRow.ai || "openrouter",
          api_key: pageRow.api_key || "",
          chatmodel: pageRow.chat_model || "xiaomi/mimo-v2-flash:free",
          text_prompt: dbRow.text_prompt || "",
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
    if (!dbId || !pageId) return;
    setLoading(true);
    try {
      // Update text_prompt in fb_message_database
      const { error: dbError } = await (supabase
        .from('fb_message_database') as any)
        .update({
            text_prompt: values.text_prompt
        })
        .eq('id', parseInt(dbId));

      if (dbError) throw dbError;

      // Update AI settings in page_access_token_message
      const { error: pageError } = await (supabase
        .from('page_access_token_message') as any)
        .update({
            ai: values.provider,
            api_key: values.api_key,
            chat_model: values.chatmodel
        })
        .eq('page_id', pageId);

      if (pageError) throw pageError;

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
        <h2 className="text-2xl font-bold">No Page Connected</h2>
        <p className="text-muted-foreground">Please connect to a page to manage AI settings.</p>
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
           <h2 className="text-3xl font-bold tracking-tight">Messenger AI Intelligence</h2>
           <p className="text-muted-foreground">
             Connect your preferred AI brain for your Facebook Page.
           </p>
        </div>
      </div>

      <div className="grid gap-6">
        <Card className="border-l-4 border-l-purple-500 shadow-md">
          <CardHeader>
            <CardTitle>AI Provider Configuration</CardTitle>
            <CardDescription>
              Select an AI provider and enter your API Key.
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
                      <FormLabel>AI Provider</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select a provider" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="openai">OpenAI (GPT-4)</SelectItem>
                          <SelectItem value="anthropic">Anthropic (Claude)</SelectItem>
                          <SelectItem value="gemini">Google Gemini</SelectItem>
                          <SelectItem value="openrouter">OpenRouter (Recommended)</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormDescription>
                        Choose the AI service that powers your bot.
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
                        Your secret API key from the provider dashboard.
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
                        <Input placeholder="e.g. gpt-4-turbo" {...field} />
                      </FormControl>
                      <FormDescription>
                        Specific model ID to use (e.g., gpt-4, claude-3-opus).
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
                      <FormLabel>System Prompt</FormLabel>
                      <FormControl>
                        <Textarea 
                          placeholder="You are a helpful assistant..." 
                          className="min-h-[150px]"
                          {...field} 
                        />
                      </FormControl>
                      <FormDescription>
                        Define how the AI should behave and what it knows about your business.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="flex justify-end">
                  <Button type="submit" size="lg" disabled={loading}>
                    <Save className="mr-2 h-4 w-4" />
                    Save Configuration
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
