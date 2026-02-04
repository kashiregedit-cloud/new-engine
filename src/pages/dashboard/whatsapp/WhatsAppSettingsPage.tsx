import { useEffect, useState } from "react";
import { BACKEND_URL } from "@/config";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Save, Bot, Lock, Sparkles, Key, Check, RefreshCw, ArrowLeft, CreditCard } from "lucide-react";
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
  const [remainingCredits, setRemainingCredits] = useState<number | null>(null);
  
  // New State for System Prompt Modal
  const [isPromptOpen, setIsPromptOpen] = useState(false);
  const [tempPrompt, setTempPrompt] = useState("");
  const [promptSaving, setPromptSaving] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  
  const [wait, setWait] = useState<number>(8);
  const [behaviorSaving, setBehaviorSaving] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState("5000");
  const [isPricingOpen, setIsPricingOpen] = useState(false);
  const [couponCode, setCouponCode] = useState("");
  const [planActive, setPlanActive] = useState(false);
  const [messageCredit, setMessageCredit] = useState(0);

  const handleApplyCoupon = () => {
    if (couponCode.toUpperCase() === "FREE500" || couponCode.toUpperCase() === "START500") {
        setSelectedPlan("500_free");
        toast.success("Coupon applied! 500 Free Messages unlocked.");
    } else {
        toast.error("Invalid coupon code. Try 'FREE500'");
    }
  };

  const handlePurchaseCredits = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        toast.error("User not authenticated");
        return;
    }

    const { data: pageData } = await supabase
        .from('page_access_token_message')
        .select('page_id')
        .eq('user_id', user.id)
        .limit(1)
        .maybeSingle();
        
    let targetPageId = pageData ? (pageData as any).page_id : null;
    
    setLoading(true);
    try {
        const creditMap: Record<string, number> = {
            '500_free': 500,
            '1000': 1000,
            '5000': 5000,
            '10000': 10000
        };
        
        const creditToAdd = creditMap[selectedPlan] || 500;
        
        const priceMap: Record<string, number> = { 
            '500_free': 0, 
            '1000': 500, 
            '5000': 2000, 
            '10000': 3500 
        };
        const price = priceMap[selectedPlan] || 0;

        if (!targetPageId) {
             const { error: updateError } = await (supabase
                .from('user_configs') as any)
                .update({ message_credit: messageCredit + creditToAdd })
                .eq('user_id', user.id);
             
             if (updateError) throw updateError;
             toast.success(`Purchased ${creditToAdd} credits (Direct Update)`);
        } else {
             const { data: rpcData, error: rpcError } = await (supabase as any)
              .rpc('purchase_credits', {
                  p_page_id: targetPageId,
                  p_credit_amount: creditToAdd,
                  p_cost: price
              });

            if (rpcError) throw new Error(rpcError.message);
            toast.success(`Purchased ${creditToAdd} credits for ৳${price}`);
        }

        fetchConfig(dbId!, sessionId);
        setIsPricingOpen(false);

    } catch (error: any) {
        console.error("Purchase error:", error);
        toast.error("Purchase failed: " + error.message);
    } finally {
        setLoading(false);
    }
  };

  const handleSaveBehavior = async () => {
    if (!dbId) return;
    setBehaviorSaving(true);
    try {
        const { error } = await (supabase
            .from('whatsapp_message_database') as any)
            .update({ wait_time: wait })
            .eq('id', parseInt(dbId));

        if (error) throw error;
        toast.success("Behavior settings saved");
    } catch (error: any) {
        console.error("Behavior save error", error);
        toast.error("Failed to save behavior: " + error.message);
    } finally {
        setBehaviorSaving(false);
    }
  };

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
      const storedSessionId = localStorage.getItem("active_wa_session_id");
      
      if (storedDbId) {
        setDbId(storedDbId);
        setSessionId(storedSessionId);
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
      const { data: dbData, error: dbError } = await supabase
        .from('whatsapp_message_database')
        .select('*')
        .eq('id', parseInt(id))
        .single();

      if (dbError) throw dbError;

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
        setIsOwner(true);
        setRemainingCredits(typeof configRow.message_credit === 'number' ? configRow.message_credit : null);

        const apiKey = configRow.api_key || "";
        let isManaged = false;
        
        if (apiKey === MANAGED_SECRET_KEY) {
             isManaged = true;
        }

        setMode(isManaged ? "managed" : "own");
        setActiveMode(isManaged ? "managed" : "own");

        const rawModel = configRow.model_name || "xiaomi/mimo-v2-flash:free";
        const displayModel = rawModel.replace(':free', '');

        const credit = (configRow as any).message_credit || 0;
        setMessageCredit(credit);
        setPlanActive(credit > 0);
        setRemainingCredits(credit);
        
        if ((dbRow as any).wait_time) {
            setWait((dbRow as any).wait_time);
        }

        form.reset({
          provider: configRow.ai_provider || "openrouter",
          api_key: isManaged ? "" : apiKey,
          chatmodel: displayModel,
          text_prompt: dbRow.text_prompt || "",
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
            .from('whatsapp_message_database') as any)
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
      const { error: dbError } = await (supabase
        .from('whatsapp_message_database') as any)
        .update({
            text_prompt: values.text_prompt
        })
        .eq('id', parseInt(dbId));

      if (dbError) throw dbError;

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
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-8">
          <div className="flex items-center gap-4">
            <Button variant="outline" size="sm" asChild className="gap-2 hover:bg-secondary/80">
                <Link to="/dashboard/whatsapp">
                    <ArrowLeft size={16} />
                    Back
                </Link>
            </Button>
            <div>
                <h1 className="text-3xl font-bold tracking-tight">AI Settings</h1>
                <p className="text-muted-foreground mt-1">Configure your AI brain and behavior</p>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
             <div className="flex items-center gap-2 bg-primary/10 text-primary px-3 py-1.5 rounded-full">
                <CreditCard size={14} />
                <span className="font-mono font-bold">{messageCredit.toLocaleString()}</span>
                <span className="text-xs font-medium uppercase tracking-wider opacity-80">Credits</span>
             </div>
             <Button onClick={() => setIsPricingOpen(true)} size="sm" className="gap-2 shadow-sm">
                <Sparkles size={14} />
                Add Credits
             </Button>
          </div>
      </div>

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
                        {promptSaving ? <div className="animate-spin rounded-full h-4 w-4 border-2 border-current border-t-transparent" /> : "Save Prompt"}
                    </Button>
                </div>
            </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="space-y-8">
        {/* AI Provider Section */}
        <div className="space-y-6">
            <RadioGroup value={mode} onValueChange={(v) => {
                setMode(v as "own" | "managed");
            }} className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <RadioGroupItem value="own" id="own" className="peer sr-only" />
                <Label
                  htmlFor="own"
                  className="flex flex-col items-center justify-between rounded-xl border-2 border-muted bg-card p-4 transition-all hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-blue-500 peer-data-[state=checked]:bg-blue-50 peer-data-[state=checked]:text-blue-700 dark:peer-data-[state=checked]:bg-blue-950/30 dark:peer-data-[state=checked]:text-blue-400 cursor-pointer shadow-sm"
                >
                  <Key className="mb-3 h-8 w-8 transition-colors peer-data-[state=checked]:text-blue-600" />
                  <span className="font-semibold text-lg">Use Own API</span>
                  <span className="text-xs text-muted-foreground mt-1 text-center peer-data-[state=checked]:text-blue-600/80">
                    Use your own API Key (Gemini, GPT)
                  </span>
                </Label>
              </div>
              <div>
                <RadioGroupItem value="managed" id="managed" className="peer sr-only" />
                <Label
                  htmlFor="managed"
                  className="flex flex-col items-center justify-between rounded-xl border-2 border-muted bg-card p-4 transition-all hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-purple-500 peer-data-[state=checked]:bg-purple-50 peer-data-[state=checked]:text-purple-700 dark:peer-data-[state=checked]:bg-purple-950/30 dark:peer-data-[state=checked]:text-purple-400 cursor-pointer shadow-sm"
                >
                  <Sparkles className="mb-3 h-8 w-8 transition-colors peer-data-[state=checked]:text-purple-600" />
                  <span className="font-semibold text-lg">User Cloud API</span>
                  <span className="text-xs text-muted-foreground mt-1 text-center peer-data-[state=checked]:text-purple-600/80">
                    Hassle-free, High Speed Engine
                  </span>
                </Label>
              </div>
            </RadioGroup>

            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                {mode === "own" ? (
                    <>
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
                                  <SelectItem value="openrouter">OpenRouter (Recommended)</SelectItem>
                                  <SelectItem value="openai">OpenAI (GPT-4)</SelectItem>
                                  <SelectItem value="anthropic">Anthropic (Claude)</SelectItem>
                                  <SelectItem value="gemini">Google Gemini</SelectItem>
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
                              <FormLabel>API Key</FormLabel>
                              <FormControl>
                                <Input type="password" placeholder="sk-..." {...field} />
                              </FormControl>
                              <FormDescription>
                                Your API key is stored locally and securely.
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
                                <Input placeholder="gpt-4o-mini" {...field} />
                              </FormControl>
                              <FormDescription>
                                e.g. gpt-4o, claude-3-sonnet, gemini-pro
                              </FormDescription>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                    </>
                ) : (
                    <div className="space-y-6">
                        <div className="rounded-lg border border-purple-200 bg-purple-50 p-4 dark:border-purple-800 dark:bg-purple-900/20">
                            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                                <div className="flex items-center gap-4">
                                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-purple-100 dark:bg-purple-900">
                                        <Sparkles className="h-6 w-6 text-purple-600 dark:text-purple-400" />
                                    </div>
                                    <div>
                                        <h3 className="font-semibold text-purple-900 dark:text-purple-100">User Cloud API</h3>
                                        <p className="text-sm text-purple-700 dark:text-purple-300">
                                            High-speed engine. No setup required.
                                        </p>
                                    </div>
                                </div>

                                <div className="flex items-center gap-4 rounded-md bg-white p-3 shadow-sm dark:bg-purple-950/50">
                                    <div className="text-right">
                                        <p className="text-xs font-medium text-muted-foreground">Current Plan</p>
                                        <div className="font-bold text-purple-700 dark:text-purple-400">
                                            {messageCredit > 0 ? "Active Plan" : "No Credits"}
                                        </div>
                                        <div className="text-xs text-green-600 font-medium">
                                            {messageCredit.toLocaleString()} {isOwner ? "Credits Remaining" : "Owner Credits (Shared)"}
                                        </div>
                                    </div>
                                    <Button 
                                        type="button" 
                                        onClick={() => setIsPricingOpen(true)}
                                        className="bg-purple-600 hover:bg-purple-700 text-white"
                                    >
                                        Upgrade
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
              <div className="flex justify-between items-center pt-4 border-t">
                  <Button 
                    type="button" 
                    variant="outline" 
                    onClick={() => setIsPromptOpen(true)}
                    className="gap-2"
                  >
                    <Bot size={16} />
                    Edit System Prompt
                  </Button>
                  
                  <Button type="submit" disabled={loading} className="gap-2 min-w-[120px]">
                    {loading ? <div className="animate-spin rounded-full h-4 w-4 border-2 border-current border-t-transparent" /> : <Save size={16} />}
                    Save Changes
                  </Button>
              </div>
            </form>
          </Form>
        </div>

        {/* Behavior Settings Section (Moved under AI Settings) */}
        <div className="space-y-6 pt-6 border-t">
            <div>
                <h2 className="text-xl font-semibold tracking-tight">Behavior Settings</h2>
                <p className="text-muted-foreground">Configure how your AI interacts with customers.</p>
            </div>
            
            <Card>
                <CardHeader>
                    <CardTitle className="text-lg">Response Timing</CardTitle>
                    <CardDescription>
                        Control the delay before the AI replies to simulate human typing.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <div className="flex justify-between">
                            <Label>Response Delay (Seconds)</Label>
                            <span className="text-sm font-medium text-muted-foreground">{wait}s</span>
                        </div>
                        <div className="flex items-center gap-4">
                            <span className="text-xs text-muted-foreground">Instant</span>
                            <input 
                                type="range" 
                                min="1" 
                                max="60" 
                                value={wait} 
                                onChange={(e) => setWait(parseInt(e.target.value))}
                                className="flex-1 h-2 bg-secondary rounded-lg appearance-none cursor-pointer"
                            />
                            <span className="text-xs text-muted-foreground">60s</span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                            A small delay (5-10s) feels more natural to customers.
                        </p>
                    </div>
                    <div className="flex justify-end">
                        <Button onClick={handleSaveBehavior} disabled={behaviorSaving}>
                            {behaviorSaving ? "Saving..." : "Save Behavior"}
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </div>
      </div>

      <Dialog open={isPricingOpen} onOpenChange={setIsPricingOpen}>
        <DialogContent className="max-w-3xl">
             <DialogHeader>
                 <DialogTitle className="text-2xl font-bold text-center">Add Message Credits</DialogTitle>
                 <DialogDescription className="text-center">
                     Purchase credits to use the Managed Cloud API. Credits never expire.
                 </DialogDescription>
             </DialogHeader>
             
             <div className="grid grid-cols-1 md:grid-cols-3 gap-4 py-6">
                 <div 
                     className={`cursor-pointer relative rounded-xl border-2 p-4 shadow-sm transition-all hover:border-purple-500 ${selectedPlan === '1000' ? 'border-purple-600 bg-purple-100 dark:bg-purple-900/40' : 'border-muted bg-card'}`}
                     onClick={() => setSelectedPlan('1000')}
                 >
                     <div className="flex flex-col items-center justify-center space-y-2">
                         <h3 className="font-semibold text-lg">Starter</h3>
                         <div className="text-2xl font-bold">৳500</div>
                         <p className="text-sm text-muted-foreground">1,000 Messages</p>
                         {selectedPlan === '1000' && <div className="absolute top-2 right-2 text-purple-600"><Check className="h-5 w-5" /></div>}
                     </div>
                 </div>

                 <div 
                     className={`cursor-pointer relative rounded-xl border-2 p-4 shadow-sm transition-all hover:border-purple-500 ${selectedPlan === '5000' ? 'border-purple-600 bg-purple-100 dark:bg-purple-900/40' : 'border-muted bg-card'}`}
                     onClick={() => setSelectedPlan('5000')}
                 >
                     <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                         <Badge className="bg-purple-600 hover:bg-purple-700 shadow-sm">Most Popular</Badge>
                     </div>
                     <div className="flex flex-col items-center justify-center space-y-2 pt-2">
                         <h3 className="font-semibold text-lg">Pro</h3>
                         <div className="text-2xl font-bold">৳2,000</div>
                         <p className="text-sm text-muted-foreground">5,000 Messages</p>
                         {selectedPlan === '5000' && <div className="absolute top-2 right-2 text-purple-600"><Check className="h-5 w-5" /></div>}
                     </div>
                 </div>

                 <div 
                     className={`cursor-pointer relative rounded-xl border-2 p-4 shadow-sm transition-all hover:border-purple-500 ${selectedPlan === '10000' ? 'border-purple-600 bg-purple-100 dark:bg-purple-900/40' : 'border-muted bg-card'}`}
                     onClick={() => setSelectedPlan('10000')}
                 >
                     <div className="flex flex-col items-center justify-center space-y-2">
                         <h3 className="font-semibold text-lg">Enterprise</h3>
                         <div className="text-2xl font-bold">৳3,500</div>
                         <p className="text-sm text-muted-foreground">10,000 Messages</p>
                         {selectedPlan === '10000' && <div className="absolute top-2 right-2 text-purple-600"><Check className="h-5 w-5" /></div>}
                     </div>
                 </div>
            </div>

            <div className="space-y-4 pt-4 border-t border-dashed border-muted-foreground/20">
                 <div className="flex items-end gap-3">
                      <div className="grid gap-1.5 flex-1 max-w-xs">
                           <Label htmlFor="coupon">Coupon Code</Label>
                           <Input 
                                id="coupon" 
                                placeholder="Enter code..." 
                                value={couponCode}
                                onChange={(e) => setCouponCode(e.target.value)}
                           />
                      </div>
                      <Button variant="secondary" onClick={handleApplyCoupon}>Apply</Button>
                 </div>
                 {selectedPlan === '500_free' && (
                     <div className="p-3 bg-green-100 text-green-700 rounded-md text-sm font-medium flex items-center gap-2">
                         <Check size={16} />
                         Coupon Active: 500 Free Credits
                     </div>
                 )}
            </div>

            <DialogFooter className="mt-6">
                <Button variant="outline" onClick={() => setIsPricingOpen(false)}>Cancel</Button>
                <Button onClick={handlePurchaseCredits} disabled={loading} className="bg-purple-600 hover:bg-purple-700 text-white">
                    {loading ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : "Confirm Purchase"}
                </Button>
            </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
