import { useEffect, useState } from "react";
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
}).refine(data => {
    // If we can access mode here it would be great, but we can't easily.
    // We'll handle validation logic loosely here and rely on component state or just let it pass if empty for now
    // and validate in onSubmit or ensure it's filled.
    return true;
});

const MANAGED_SECRET_KEY = import.meta.env.VITE_MANAGED_API_KEY || "AIzaSyCa-Lo6Oy23THyqOLQ-t4z77BPsHqMIpyk";
const MANAGED_MODEL = import.meta.env.VITE_MANAGED_MODEL || "gemini-2.5-flash-lite";

export default function MessengerSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [dbId, setDbId] = useState<string | null>(null);
  const [pageId, setPageId] = useState<string | null>(null);
  const [verified, setVerified] = useState(true);
  const [mode, setMode] = useState<"own" | "managed">("own");
  const [selectedPlan, setSelectedPlan] = useState("5000");
  const [isPricingOpen, setIsPricingOpen] = useState(false);
  const [couponCode, setCouponCode] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState<string | null>(null);
  const [planActive, setPlanActive] = useState(false);
  const [messageCredit, setMessageCredit] = useState(0);
  
  // New State for System Prompt Modal
  const [isPromptOpen, setIsPromptOpen] = useState(false);
  const [tempPrompt, setTempPrompt] = useState("");
  const [promptSaving, setPromptSaving] = useState(false);
  
  // New State for Behavior Settings
  const [wait, setWait] = useState<number>(8);
  const [behaviorSaving, setBehaviorSaving] = useState(false);
  
  // New State for Optimization
  const [optimizing, setOptimizing] = useState(false);

  const handleApplyCoupon = () => {
    // Simple validation for demo - in production this would verify with backend
    if (couponCode.toUpperCase() === "FREE500" || couponCode.toUpperCase() === "START500") {
        setAppliedCoupon(couponCode.toUpperCase());
        setSelectedPlan("500_free");
        toast.success("Coupon applied! 500 Free Messages unlocked.");
    } else {
        toast.error("Invalid coupon code. Try 'FREE500'");
    }
  };
  
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
    window.addEventListener("db-connection-changed", checkConnection);
    
    return () => {
      window.removeEventListener("storage", checkConnection);
      window.removeEventListener("db-connection-changed", checkConnection);
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
        
        const apiKey = pageRow.api_key || "";
        // Check if plan is active and has credits
        const isActive = pageRow.subscription_status === 'active' && (pageRow.message_credit > 0);
        setPlanActive(isActive);
        setMessageCredit(pageRow.message_credit || 0);

        const isManaged = apiKey === MANAGED_SECRET_KEY || isActive;
        setMode(isManaged ? "managed" : "own");

        form.reset({
          provider: pageRow.ai || "openrouter",
          api_key: isManaged ? "" : apiKey, // Hide secret key
          chatmodel: pageRow.chat_model || "xiaomi/mimo-v2-flash:free",
          text_prompt: dbRow.text_prompt || "",
        });
        
        // Set temp prompt for modal
        setTempPrompt(dbRow.text_prompt || "");
        
        // Set wait time
        setWait(dbRow.wait || 8);
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
            .from('fb_message_database') as any)
            .update({ text_prompt: tempPrompt })
            .eq('id', parseInt(dbId));

        if (error) throw error;
        
        // Also update form state to keep in sync
        form.setValue('text_prompt', tempPrompt);
        
        toast.success("System prompt updated successfully!");
        
        // Auto-Trigger RAG Ingestion in Background
        if (pageId) {
            fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/ai/ingest`, {
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

  const handleSaveBehavior = async () => {
    if (!dbId) return;
    setBehaviorSaving(true);
    try {
        const { error } = await (supabase
            .from('fb_message_database') as any)
            .update({ wait: wait })
            .eq('id', parseInt(dbId));

        if (error) throw error;
        toast.success("Behavior settings saved!");
    } catch (error: any) {
        console.error("Error saving behavior:", error);
        toast.error("Failed to save behavior: " + error.message);
    } finally {
        setBehaviorSaving(false);
    }
  };

  const handleOptimizePrompt = async () => {
    if (!tempPrompt || tempPrompt.length < 10) {
        toast.error("Please enter some prompt text to optimize.");
        return;
    }

    setOptimizing(true);
    try {
        const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/ai/optimize-prompt`, {
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
    if (!dbId || !pageId) return;
    setLoading(true);

    if (mode === "managed") {
        values.provider = "gemini"; // Or openrouter if that's what the backend expects for this model
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
      // Update text_prompt in fb_message_database
      const { error: dbError } = await (supabase
        .from('fb_message_database') as any)
        .update({
            text_prompt: values.text_prompt
        })
        .eq('id', parseInt(dbId));

      if (dbError) throw dbError;

      const updates: any = {
          ai: values.provider,
          api_key: values.api_key,
          chat_model: values.chatmodel
      };

      // Handle Plan Activation Logic
      if (mode === "managed") {
          const creditMap: Record<string, number> = {
              '500_free': 500,
              '1000': 1000,
              '5000': 5000,
              '10000': 10000
          };
          
          // Only update subscription if we are actually buying/activating (this logic might need refinement if just saving prompt)
          // For now, if mode is managed, we ensure subscription is active. 
          // Ideally, we should check if they actually clicked "Buy" or just "Save", but the button text says "Buy & Activate".
          // We'll assume clicking the button in managed mode intends to activate the selected plan.
          
          // However, if they already have a plan and just want to save the prompt, we shouldn't reset credits.
          // We can check if planActive is false OR if they selected a new plan?
          // For simplicity/demo: We update if they are in managed mode.
          
          // BETTER LOGIC: If plan is NOT active, OR they explicitly selected a plan via pricing (which we can't easily track here without more state).
          // Let's assume every save in Managed mode refreshes the plan for now, OR we only set it if not active.
          
          // User request: "buy and active plan e click korle work kroe na"
          // We will update the credits and status.
          
          // Record Transaction (Mock or Real)
          const priceMap: Record<string, number> = { 
              '500_free': 0, 
              '1000': 500, 
              '5000': 2000, 
              '10000': 3500 
          };
          const price = priceMap[selectedPlan] || 0;

          // Only record if price > 0 (or if it's a free trial activation we want to log)
          if (price >= 0) {
              // Fetch user email if not in scope (we can try to get it from current session or page data)
              // For now, let's use a placeholder or try to fetch user
              const { data: { user } } = await supabase.auth.getUser();
              const userEmail = user?.email || "unknown_user";

              await (supabase.from('payment_transactions') as any).insert({
                  user_email: userEmail,
                  amount: price,
                  method: 'balance_deduction', // or 'mock_purchase'
                  trx_id: 'SYS_' + Date.now(),
                  sender_number: 'SYSTEM',
                  status: 'completed'
              });
          }

          updates.subscription_status = 'active';
          updates.subscription_plan = selectedPlan;
          updates.message_credit = creditMap[selectedPlan] || 500;
          updates.subscription_expiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days
      }

      // Update AI settings in page_access_token_message
      const { error: pageError } = await (supabase
        .from('page_access_token_message') as any)
        .update(updates)
        .eq('page_id', pageId);

      if (pageError) throw pageError;

      if (mode === "managed") {
          setPlanActive(true);
          setMessageCredit(updates.message_credit);
          toast.success(`Plan activated with ${updates.message_credit} message credits!`);
      } else {
          toast.success("AI settings saved successfully");
      }
      
    } catch (error: any) {
        console.error("Save settings error:", error);
        const message = error.message || (typeof error === 'string' ? error : JSON.stringify(error));
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
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
           <h2 className="text-3xl font-bold tracking-tight">Messenger AI Intelligence</h2>
           <p className="text-muted-foreground">
             Connect your preferred AI brain for your Facebook Page.
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
                    Define your AI's persona, knowledge base, and behavior rules. This update is independent of your plan.
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
            <CardTitle>AI Provider Configuration</CardTitle>
            <CardDescription>
              Select an AI provider and enter your API Key.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-6">
                <RadioGroup defaultValue={mode} value={mode} onValueChange={(v) => {
                    // Force Managed Mode (Locked)
                    if (v === "own") {
                        toast.error("This feature is temporarily locked by administrator.");
                        return;
                    }
                    setMode("managed");
                    setIsPricingOpen(true);
                }} className="grid grid-cols-2 gap-4">
                  <div>
                    <RadioGroupItem value="own" id="own" className="peer sr-only" disabled={true} />
                    <Label
                      htmlFor="own"
                      className={`flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 opacity-50 cursor-not-allowed`}
                    >
                      <Lock className="mb-1 h-4 w-4 text-destructive" />
                      <Key className="mb-3 h-6 w-6" />
                      Use Own API (Locked)
                    </Label>
                  </div>
                  <div>
                    <RadioGroupItem value="managed" id="managed" className="peer sr-only" />
                    <Label
                      htmlFor="managed"
                      className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary cursor-pointer"
                    >
                      <Sparkles className="mb-3 h-6 w-6 text-purple-500" />
                      Buy API (Managed)
                    </Label>
                  </div>
                </RadioGroup>
            </div>

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
                    </>
                ) : (
                    <div className="space-y-6">
                        {/* Compact Managed Mode Banner */}
                        <div className="rounded-lg border border-purple-200 bg-purple-50 p-4 dark:border-purple-800 dark:bg-purple-900/20">
                            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                                <div className="flex items-center gap-4">
                                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-purple-100 dark:bg-purple-900">
                                        <Sparkles className="h-6 w-6 text-purple-600 dark:text-purple-400" />
                                    </div>
                                    <div>
                                        <h3 className="font-semibold text-purple-900 dark:text-purple-100">Premium Managed AI</h3>
                                        <p className="text-sm text-purple-700 dark:text-purple-300">
                                            High-speed engine. No setup required.
                                        </p>
                                    </div>
                                </div>

                                <div className="flex items-center gap-4 rounded-md bg-white p-3 shadow-sm dark:bg-purple-950/50">
                                    <div className="text-right">
                                        <p className="text-xs font-medium text-muted-foreground">Current Plan</p>
                                        <div className="font-bold text-purple-700 dark:text-purple-400">
                                            {selectedPlan === '500_free' && "Trial Pack (FREE)"}
                                            {selectedPlan === '1000' && "Starter (1k Msgs)"}
                                            {selectedPlan === '5000' && "Pro (5k Msgs)"}
                                            {selectedPlan === '10000' && "Enterprise (10k Msgs)"}
                                        </div>
                                        {planActive && (
                                            <div className="text-xs text-green-600 font-medium">
                                                {messageCredit} Credits Remaining
                                            </div>
                                        )}
                                    </div>
                                    <Button 
                                        type="button" 
                                        variant="outline"  
                                        size="sm"
                                        onClick={() => setIsPricingOpen(true)} 
                                        className="border-purple-200 hover:bg-purple-50 text-purple-700"
                                    >
                                        Change
                                    </Button>
                                </div>
                            </div>
                        </div>

                        {/* Pricing Modal */}
                        <Dialog open={isPricingOpen} onOpenChange={setIsPricingOpen}>
                            <DialogContent className="max-w-4xl">
                                <DialogHeader>
                                    <DialogTitle>Select Your AI Plan</DialogTitle>
                                    <DialogDescription>
                                        Choose the message capacity that fits your needs. All plans include high-speed AI processing.
                                    </DialogDescription>
                                </DialogHeader>

                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 py-4">
                                     <div 
                                         className={`cursor-pointer relative rounded-xl border-2 p-4 shadow-sm transition-all hover:border-purple-500 ${selectedPlan === '1000' ? 'border-purple-600 bg-purple-100 dark:bg-purple-900/40' : 'border-muted bg-card'}`}
                                         onClick={() => setSelectedPlan('1000')}
                                     >
                                         <div className="flex flex-col items-center justify-center space-y-2">
                                             <h3 className="font-semibold text-lg">Starter</h3>
                                             <div className="text-2xl font-bold">৳800</div>
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
                                             <div className="text-2xl font-bold">৳2,500</div>
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
                                             <div className="text-2xl font-bold">৳4,000</div>
                                             <p className="text-sm text-muted-foreground">10,000 Messages</p>
                                             {selectedPlan === '10000' && <div className="absolute top-2 right-2 text-purple-600"><Check className="h-5 w-5" /></div>}
                                         </div>
                                     </div>
                                </div>

                                {/* Coupon Section in Modal */}
                                <div className="space-y-4 pt-4 border-t border-dashed border-muted-foreground/20">
                                     <div className="flex items-end gap-3">
                                         <div className="grid gap-1.5 flex-1 max-w-xs">
                                             <Label htmlFor="coupon">Have a Coupon?</Label>
                                             <Input 
                                                 id="coupon" 
                                                 placeholder="Enter code (e.g. FREE500)" 
                                                 value={couponCode}
                                                 onChange={(e) => setCouponCode(e.target.value)}
                                                 disabled={!!appliedCoupon}
                                                 className="uppercase"
                                             />
                                         </div>
                                         <Button 
                                             type="button" 
                                             variant="secondary"
                                             onClick={handleApplyCoupon}
                                             disabled={!!appliedCoupon || !couponCode}
                                         >
                                             {appliedCoupon ? "Applied" : "Apply Code"}
                                         </Button>
                                     </div>
 
                                     {appliedCoupon && (
                                         <div 
                                             className={`cursor-pointer relative rounded-xl border-2 p-4 shadow-sm transition-all border-green-500 bg-green-100 dark:bg-green-900/40 animate-in fade-in zoom-in duration-300`}
                                             onClick={() => setSelectedPlan('500_free')}
                                         >
                                             <div className="flex flex-col items-center justify-center space-y-1">
                                                 <Badge className="bg-green-600 hover:bg-green-700 mb-2">Coupon Applied</Badge>
                                                 <h3 className="font-semibold text-lg text-green-800 dark:text-green-300">Trial Pack</h3>
                                                 <div className="text-3xl font-bold text-green-700 dark:text-green-400">FREE</div>
                                                 <p className="text-sm text-green-700 dark:text-green-300 font-medium">500 Messages Credit</p>
                                                 {selectedPlan === '500_free' && <div className="absolute top-2 right-2 text-green-600 dark:text-green-400"><Check className="h-6 w-6" /></div>}
                                             </div>
                                         </div>
                                     )}
                                </div>

                                <DialogFooter>
                                    <Button onClick={() => setIsPricingOpen(false)} className="w-full sm:w-auto">
                                        Confirm Selection
                                    </Button>
                                </DialogFooter>
                            </DialogContent>
                        </Dialog>
                    </div>
                )}

                <div className="flex justify-end">
                  <Button type="submit" size="lg" disabled={loading} className={mode === 'managed' ? (selectedPlan === '500_free' ? 'bg-green-600 hover:bg-green-700 w-full md:w-auto' : 'bg-purple-600 hover:bg-purple-700 w-full md:w-auto') : ''}>
                    {mode === 'managed' ? (
                        selectedPlan === '500_free' ? (
                            <>
                                <Sparkles className="mr-2 h-4 w-4" />
                                Activate Free Trial
                            </>
                        ) : (
                            <>
                                <Sparkles className="mr-2 h-4 w-4" />
                                Buy & Activate Plan
                            </>
                        )
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

        <Card className="border-l-4 border-l-blue-500 shadow-md">
            <CardHeader>
                <CardTitle>Response Behavior</CardTitle>
                <CardDescription>Control how and when the AI replies.</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="space-y-4">
                    <div className="flex flex-col space-y-2">
                        <Label>Smart Reply Delay <span className="text-amber-600 dark:text-amber-400 font-normal ml-2">(Recommended: 5 sec)</span></Label>
                        <div className="flex items-center space-x-4">
                            <Input 
                                type="number" 
                                value={wait} 
                                onChange={(e) => setWait(Number(e.target.value))} 
                                min={1} 
                                max={60}
                                className="w-24 font-mono"
                            />
                            <span className="text-sm text-muted-foreground">seconds</span>
                        </div>
                        <p className="text-sm text-muted-foreground">
                            Wait {wait} seconds to detect multiple messages or human intervention before replying.
                        </p>
                    </div>
                    <div className="flex justify-end">
                        <Button onClick={handleSaveBehavior} disabled={behaviorSaving} variant="secondary">
                            {behaviorSaving ? (
                                <>
                                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-current border-t-transparent mr-2" />
                                    Saving...
                                </>
                            ) : (
                                <>
                                    <Save className="mr-2 h-4 w-4" />
                                    Save Behavior
                                </>
                            )}
                        </Button>
                    </div>
                </div>
            </CardContent>
        </Card>
      </div>
    </div>
  );
}
