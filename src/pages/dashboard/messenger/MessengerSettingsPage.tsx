import { useEffect, useState } from "react";
import { BACKEND_URL } from "@/config";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Save, Bot, Lock, Sparkles, Key, Check, Image } from "lucide-react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

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

const MANAGED_SECRET_KEY = import.meta.env.VITE_MANAGED_API_KEY || "";
const MANAGED_MODEL = import.meta.env.VITE_MANAGED_MODEL || "gemini-2.5-flash-lite";

type PromptProduct = {
  id: string | number;
  name?: string | null;
  price?: number | null;
  currency?: string | null;
};

export default function MessengerSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [dbId, setDbId] = useState<string | null>(null);
  const [pageId, setPageId] = useState<string | null>(null);
  const [verified, setVerified] = useState(true);
  const [mode, setMode] = useState<"own" | "managed">("own");
  const [activeMode, setActiveMode] = useState<"own" | "managed" | null>(null);
  const [selectedPlan, setSelectedPlan] = useState("5000");
  const [isPricingOpen, setIsPricingOpen] = useState(false);
  const [couponCode, setCouponCode] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState<string | null>(null);
  const [planActive, setPlanActive] = useState(false);
  const [messageCredit, setMessageCredit] = useState(0);
  const [isOwner, setIsOwner] = useState(true);
  
  // New State for System// Prompt State
  const [isPromptOpen, setIsPromptOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("text"); // Add activeTab state
  const [tempPrompt, setTempPrompt] = useState("");
  const [tempImagePrompt, setTempImagePrompt] = useState("");
  const [promptSaving, setPromptSaving] = useState(false);
  
  // New State for Behavior Settings
  const [wait, setWait] = useState<number>(8);
  const [behaviorSaving, setBehaviorSaving] = useState(false);
  const [memoryContextName, setMemoryContextName] = useState("");
  const [memoryLimit, setMemoryLimit] = useState<number>(20);
  const [orderLockMinutes, setOrderLockMinutes] = useState<number>(1440);
  
  // New State for Optimization
  const [optimizing, setOptimizing] = useState(false);

  const [productList, setProductList] = useState<PromptProduct[]>([]);
  const [productLoading, setProductLoading] = useState(false);

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
        chatmodel: "openrouter/auto",
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
        setTempPrompt(dbRow.text_prompt || "");
        setTempImagePrompt(dbRow.image_prompt || ""); // Load Image Prompt

        // Check ownership
        const { data: { user } } = await supabase.auth.getUser();
        const isPageOwner = user?.id === pageRow.user_id;
        setIsOwner(isPageOwner);
        
        const apiKey = pageRow.api_key || "";
        
        // --- SHARED CREDIT FETCH ---
        let currentCredit = 0; // Initialize to 0, ignoring page-specific credit
        
        // If page is linked to a user, fetch the User's shared credit balance
        let ownerId = pageRow.user_id;
        if (!ownerId) {
             // Fallback: Try to get current user ID
             const { data: { user } } = await supabase.auth.getUser();
             if (user) ownerId = user.id;
        }

        if (ownerId) {
            const { data: userData } = await supabase
                .from('user_configs')
                .select('message_credit')
                .eq('user_id', ownerId)
                .maybeSingle();
            
            if (userData) {
                currentCredit = (userData as any).message_credit || 0;
            }
        }
        // ---------------------------

        // Check if plan is active and has credits
        // Show active if strictly active OR if we have credits (meaning user is using shared balance)
        const isActive = (pageRow.subscription_status === 'active' || currentCredit > 0);
        setPlanActive(isActive);
        setMessageCredit(currentCredit);

        // LOGIC FIX: Respect explicit 'cheap_engine' setting from DB
        // If cheap_engine is explicitly FALSE, it means user wants Own API, even if they have credits.
        let isManaged = false;
        
        if (pageRow.cheap_engine === false) {
             isManaged = false; // User explicitly chose Own API
        } else if (pageRow.cheap_engine === true) {
             isManaged = true; // User explicitly chose Managed
        } else {
             // Legacy/Fallback: If apiKey is managed OR (isActive AND apiKey is empty/managed)
             isManaged = apiKey === MANAGED_SECRET_KEY || (isActive && !apiKey);
        }

        setMode(isManaged ? "managed" : "own");
        setActiveMode(isManaged ? "managed" : "own");

        // Clean model name (remove :free suffix for display)
        const rawModel = pageRow.chat_model || "openrouter/auto";
        const displayModel = rawModel.replace(':free', '');

        form.reset({
          provider: pageRow.ai || "openrouter",
          api_key: isManaged ? "" : apiKey, // Hide secret key
          chatmodel: displayModel,
          text_prompt: dbRow.text_prompt || "",
        });
        
        // Set temp prompt for modal
        setTempPrompt(dbRow.text_prompt || "");
        
        // Set behavior settings
        setWait(dbRow.wait || 8);
        setMemoryContextName(dbRow.memory_context_name || "");
        setMemoryLimit(dbRow.check_conversion || 20);
        setOrderLockMinutes(dbRow.order_lock_minutes || 1440);
      }
    } catch (error) {
      console.error("Error fetching config:", error);
      toast.error("Failed to load AI settings");
    } finally {
      setLoading(false);
    }
  };

  const fetchProductsForPrompt = async () => {
    if (!pageId) return;
    setProductLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      const params = new URLSearchParams();
      params.set("page_id", pageId);
      params.set("limit", "50");

      const url = `${BACKEND_URL}/api/products?${params.toString()}`;
      const headers: HeadersInit = {};
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      const res = await fetch(url, { headers });
      if (!res.ok) {
        throw new Error("Failed to load products");
      }

      const data = await res.json();
      let items: PromptProduct[] = [];
      if (data.data && Array.isArray(data.data)) {
        items = data.data as PromptProduct[];
      } else if (Array.isArray(data)) {
        items = data as PromptProduct[];
      }
      setProductList(items);
    } catch (error) {
      console.error("Failed to load products for prompt:", error);
      toast.error("Products load korte parlam na");
    } finally {
      setProductLoading(false);
    }
  };

  const handleOpenPrompt = (tab: "text" | "image") => {
    setActiveTab(tab);
    setIsPromptOpen(true);
    if (!productList.length && pageId) {
      fetchProductsForPrompt();
    }
  };

  const handleInsertProductIntoPrompt = (product: PromptProduct) => {
    const name = product?.name || "Unnamed Product";
    const priceText = product?.price ? `${product.price} ${product.currency || "USD"}` : "";
    const line =
      priceText
        ? `\nIf user asks for ${name}, send image and details of product "${name}" (price ${priceText}).`
        : `\nIf user asks for ${name}, send image and details of product "${name}".`;
    setTempPrompt((prev) => (prev || "") + line);
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
            body: JSON.stringify({ 
                text_prompt: tempPrompt,
                image_prompt: tempImagePrompt
            })
        });

        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            const message = body.error || `Failed with status ${res.status}`;
            throw new Error(message);
        }
        
        // Also update form state to keep in sync
        form.setValue('text_prompt', tempPrompt);
        
        toast.success("System & Image prompts updated successfully!");
        
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

  const handleSaveBehavior = async () => {
    if (!dbId) return;
    setBehaviorSaving(true);
    try {
        const { error } = await (supabase
            .from('fb_message_database') as any)
            .update({ 
                wait: wait,
                memory_context_name: memoryContextName || null,
                check_conversion: memoryLimit,
                order_lock_minutes: orderLockMinutes 
            })
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

  const handlePurchaseCredits = async () => {
      if (!pageId) return;
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
              '1000': 400, 
              '5000': 1500, 
              '10000': 2500 
          };
          const price = priceMap[selectedPlan] || 0;

          // If price > 0, use secure RPC
          if (price > 0) {
              const { data: rpcData, error: rpcError } = await (supabase as any)
                .rpc('purchase_credits', {
                    p_page_id: pageId,
                    p_credit_amount: creditToAdd,
                    p_cost: price
                });

              if (rpcError) throw new Error(rpcError.message);
              toast.success(`Purchased ${creditToAdd} credits for ৳${price}`);
          } else {
              const { error: rpcError } = await (supabase as any)
                .rpc('purchase_credits', {
                    p_page_id: pageId,
                    p_credit_amount: creditToAdd,
                    p_cost: 0
                });
                
              if (rpcError) throw new Error(rpcError.message);
              toast.success(`Activated Free Plan (${creditToAdd} credits)`);
          }

          // Fetch updated credit
          const { data: pageData } = await supabase
            .from('page_access_token_message')
            .select('user_id')
            .eq('page_id', pageId)
            .single();
            
          if ((pageData as any)?.user_id) {
             const { data: ownerConfig } = await supabase
                .from('user_configs')
                .select('message_credit')
                .eq('user_id', (pageData as any).user_id)
                .single();
             
             if (ownerConfig) {
                 setMessageCredit((ownerConfig as any).message_credit);
                 setPlanActive(true);
             }
          }

          setIsPricingOpen(false);

      } catch (error: any) {
          console.error("Purchase error:", error);
          toast.error("Purchase failed: " + error.message);
      } finally {
          setLoading(false);
      }
  };

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    if (!dbId || !pageId) return;
    setLoading(true);

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
        // Strict Isolation: Ensure user's API key is not the managed one
        if (values.api_key === MANAGED_SECRET_KEY) {
            toast.error("Invalid API Key. Please use your own key.");
            setLoading(false);
            return;
        }
    }

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      if (values.text_prompt) {
        const resPrompt = await fetch(`${BACKEND_URL}/messenger/config/${dbId}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {})
          },
          body: JSON.stringify({ text_prompt: values.text_prompt })
        });

        if (!resPrompt.ok) {
          const body = await resPrompt.json().catch(() => ({}));
          const message = body.error || `Failed to save prompt (${resPrompt.status})`;
          throw new Error(message);
        }
      }

      const updates: any = {
          ai: values.provider,
          api_key: values.api_key,
          chat_model: values.chatmodel,
          cheap_engine: mode === "managed" 
      };

      const { error: pageError } = await (supabase
        .from('page_access_token_message') as any)
        .update(updates)
        .eq('page_id', pageId);

      if (pageError) throw pageError;

      setActiveMode(mode); // Update active mode indicator
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
        <div className="flex gap-2">
            <Button 
                onClick={() => handleOpenPrompt("text")} 
                variant="outline"
                className="border-[#00ff88]/40 text-[#00ff88] hover:bg-[#00ff88]/10"
            >
                <Bot className="mr-2 h-4 w-4" />
                Edit System Prompt
            </Button>
            <Button 
                onClick={() => handleOpenPrompt("image")} 
                variant="outline"
                className="border-[#00ff88]/40 text-[#00ff88] hover:bg-[#00ff88]/10"
            >
                <Image className="mr-2 h-4 w-4" />
                Edit Image Prompt
            </Button>
        </div>
      </div>

      {/* System Prompt Full Screen Dialog */}
      <Dialog open={isPromptOpen} onOpenChange={setIsPromptOpen}>
        <DialogContent className="max-w-4xl h-[85vh] flex flex-col">
            <DialogHeader>
                <DialogTitle>Edit AI Instructions</DialogTitle>
                <DialogDescription>
                    Define your AI's persona and how it handles images.
                </DialogDescription>
            </DialogHeader>
            <div className="flex-1 py-4 overflow-hidden">
                <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col">
                    <TabsList>
                        <TabsTrigger value="text">System Prompt (Text)</TabsTrigger>
                        <TabsTrigger value="image">Image Detection Prompt</TabsTrigger>
                    </TabsList>
                    
                    <TabsContent value="text" className="flex-1 mt-4 h-full">
                        <div className="flex flex-col h-full gap-3">
                          <div className="space-y-1">
                            <div className="text-xs font-medium text-muted-foreground">
                              Products shortcut
                            </div>
                            <div className="flex flex-wrap gap-2 max-h-24 overflow-y-auto border border-white/10 rounded-md bg-black/20 p-2">
                              {productLoading && (
                                <span className="text-xs text-muted-foreground">
                                  Loading products...
                                </span>
                              )}
                              {!productLoading && productList.length === 0 && (
                                <span className="text-xs text-muted-foreground">
                                  No products found. Add products first from Global Products.
                                </span>
                              )}
                              {!productLoading &&
                                productList.map((p) => (
                                  <button
                                    key={p.id}
                                    type="button"
                                    onClick={() => handleInsertProductIntoPrompt(p)}
                                    className="text-xs px-2 py-1 rounded-full border border-white/15 bg-black/30 hover:border-[#00ff88] hover:bg-[#00ff88]/10 transition-colors"
                                  >
                                    {p.name || "Untitled"}
                                    {p.price ? ` • ${p.price} ${p.currency || "USD"}` : ""}
                                  </button>
                                ))}
                            </div>
                          </div>
                          <Textarea 
                              value={tempPrompt}
                              onChange={(e) => setTempPrompt(e.target.value)}
                              className="w-full flex-1 min-h-[300px] font-mono text-sm leading-relaxed p-4 resize-none"
                              placeholder="You are a helpful assistant..."
                          />
                        </div>
                    </TabsContent>
                    
                    <TabsContent value="image" className="flex-1 mt-4 h-full">
                         <div className="space-y-2 h-full flex flex-col">
                            <div className="bg-muted/50 p-4 rounded-lg text-sm text-muted-foreground">
                                <p className="font-semibold mb-1">How Image Detection Works:</p>
                                <p>When a user sends an image, the AI will first "see" it using this prompt. The result is then passed to the main chat AI.</p>
                                <p className="mt-2 italic">Example: "Analyze this image. If it's a product, identify the name, price, and color. If it's a payment screenshot, extract the transaction ID."</p>
                            </div>
                            <Textarea 
                                value={tempImagePrompt}
                                onChange={(e) => setTempImagePrompt(e.target.value)}
                                className="w-full flex-1 font-mono text-sm leading-relaxed p-4 resize-none"
                                placeholder="Describe how the AI should analyze images..."
                            />
                        </div>
                    </TabsContent>
                </Tabs>
            </div>
            <DialogFooter className="flex justify-between items-center sm:justify-between w-full">
                <div className="flex gap-2">
                    <Button 
                        variant="secondary" 
                        onClick={handleOptimizePrompt} 
                        disabled={optimizing || promptSaving}
                        className="bg-[#00ff88]/10 hover:bg-[#00ff88]/20 text-[#00ff88]"
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
                        Save Prompts
                    </Button>
                </div>
            </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="grid gap-6">
        <Card className="bg-[#0f0f0f]/80 backdrop-blur-sm border border-white/10">
          <CardHeader>
            <CardTitle className="flex justify-between items-center">
                AI Provider Configuration
                {activeMode && (
                    <Badge
                      variant="outline"
                      className={
                        activeMode === 'managed'
                          ? 'bg-[#00ff88]/10 text-[#00ff88] border-[#00ff88]/60'
                          : 'border-white/30 text-white/70'
                      }
                    >
                        Status: {activeMode === 'managed' ? "User Cloud API" : "Own API"}
                    </Badge>
                )}
            </CardTitle>
            <CardDescription>
              Select an AI provider and enter your API Key.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-4 rounded-xl border border-white/10 bg-black/30 p-3">
                <RadioGroup defaultValue={mode} value={mode} onValueChange={(v) => {
                    setMode(v as "own" | "managed");
                    // Removed auto-open popup behavior
                }} className="grid grid-cols-2 gap-4">
                  <div>
                    <RadioGroupItem value="own" id="own" className="peer sr-only" />
                    <Label
                      htmlFor="own"
                      className="flex h-full min-h-[80px] flex-col items-start justify-center gap-1 rounded-lg border border-white/10 bg-black/40 p-3 text-sm transition-all hover:border-[#00ff88]/50 hover:bg-[#00ff88]/5 peer-data-[state=checked]:border-[#00ff88] peer-data-[state=checked]:bg-[#00ff88]/10 peer-data-[state=checked]:text-[#00ff88] cursor-pointer"
                    >
                      <Key className="mb-1 h-5 w-5 transition-colors peer-data-[state=checked]:text-[#00ff88]" />
                      <span className="font-semibold">Use Own API</span>
                      <span className="text-[11px] text-muted-foreground peer-data-[state=checked]:text-[#00ff88]">
                        Use your own API Key (Gemini, GPT)
                      </span>
                    </Label>
                  </div>
                  <div>
                    <RadioGroupItem value="managed" id="managed" className="peer sr-only" />
                    <Label
                      htmlFor="managed"
                      className="flex h-full min-h-[80px] flex-col items-start justify-center gap-1 rounded-lg border border-white/10 bg-black/40 p-3 text-sm transition-all hover:border-[#00ff88]/50 hover:bg-[#00ff88]/5 peer-data-[state=checked]:border-[#00ff88] peer-data-[state=checked]:bg-[#00ff88]/10 peer-data-[state=checked]:text-[#00ff88] cursor-pointer"
                    >
                      <Sparkles className="mb-1 h-5 w-5 transition-colors peer-data-[state=checked]:text-[#00ff88]" />
                      <span className="font-semibold">User Cloud API</span>
                      <span className="text-[11px] text-muted-foreground peer-data-[state=checked]:text-[#00ff88]">
                        Hassle-free, High Speed Engine
                      </span>
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
                              <Select 
                                onValueChange={(val) => {
                                  field.onChange(val);
                                  if (val === "salesmanchatbot") {
                                    form.setValue("chatmodel", "salesmanchatbot-pro");
                                  }
                                }} 
                                defaultValue={field.value}
                              >
                                <FormControl>
                                  <SelectTrigger>
                                    <SelectValue placeholder="Select a provider" />
                                  </SelectTrigger>
                                </FormControl>
                          <SelectContent>
                            <SelectItem value="salesmanchatbot">SalesmanChatbot API (Pro)</SelectItem>
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
                          {form.watch("provider") === "salesmanchatbot" 
                            ? "Enter your SalesmanChatbot API Key from the Developer API page."
                            : "Your secret API key from the provider dashboard."}
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
                          {form.watch("provider") === "salesmanchatbot" ? (
                            <Select onValueChange={field.onChange} defaultValue={field.value || "salesmanchatbot-pro"}>
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="Select Model" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="salesmanchatbot-pro">SalesmanChatbot Pro (Fast & Accurate)</SelectItem>
                                <SelectItem value="salesmanchatbot-flash">SalesmanChatbot Flash (Ultra Fast)</SelectItem>
                                <SelectItem value="salesmanchatbot-lite">SalesmanChatbot Lite (Simple Tasks)</SelectItem>
                              </SelectContent>
                            </Select>
                          ) : (
                            <Input placeholder="e.g. gpt-4-turbo" {...field} />
                          )}
                        </FormControl>
                        <FormDescription>
                          {form.watch("provider") === "salesmanchatbot" 
                            ? "Choose your preferred SalesmanChatbot model."
                            : "Specific model ID to use (e.g., gpt-4, claude-3-opus)."}
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
                                            {selectedPlan === '500_free' && "Trial Pack (FREE)"}
                                            {selectedPlan === '1000' && "Starter (1k Msgs)"}
                                            {selectedPlan === '5000' && "Pro (5k Msgs)"}
                                            {selectedPlan === '10000' && "Enterprise (10k Msgs)"}
                                        </div>
                                        {(planActive || messageCredit > 0) && (
                                            <div className="text-xs text-green-600 font-medium">
                                                {messageCredit} {isOwner ? "Credits Remaining" : "Owner Credits (Shared)"}
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
                                        Top Up / Change Plan
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
                                        Choose the message capacity that fits your needs. Starter/Pro have no expiry; Enterprise is valid for 30 days.
                                    </DialogDescription>
                                </DialogHeader>

                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 py-4">
                                     <div 
                                        className={`cursor-pointer relative rounded-xl border-2 p-4 shadow-sm transition-all hover:border-purple-500 ${selectedPlan === '1000' ? 'border-purple-600 bg-purple-100 dark:bg-purple-900/40' : 'border-muted bg-card'}`}
                                        onClick={() => setSelectedPlan('1000')}
                                    >
                                        <div className="flex flex-col items-center justify-center space-y-2">
                                            <h3 className="font-semibold text-lg">Starter</h3>
                                            <div className="text-2xl font-bold">৳400</div>
                                            <p className="text-sm text-muted-foreground">1,000 Messages • No expiry</p>
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
                                            <div className="text-2xl font-bold">৳1,500</div>
                                            <p className="text-sm text-muted-foreground">5,000 Messages • No expiry</p>
                                            {selectedPlan === '5000' && <div className="absolute top-2 right-2 text-purple-600"><Check className="h-5 w-5" /></div>}
                                        </div>
                                    </div>

                                    <div 
                                        className={`cursor-pointer relative rounded-xl border-2 p-4 shadow-sm transition-all hover:border-purple-500 ${selectedPlan === '10000' ? 'border-purple-600 bg-purple-100 dark:bg-purple-900/40' : 'border-muted bg-card'}`}
                                        onClick={() => setSelectedPlan('10000')}
                                    >
                                        <div className="flex flex-col items-center justify-center space-y-2">
                                            <h3 className="font-semibold text-lg">Enterprise</h3>
                                            <div className="text-2xl font-bold">৳2,500</div>
                                            <p className="text-sm text-muted-foreground">10,000 Messages • 30 days</p>
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

                                <DialogFooter className="flex flex-row justify-between gap-2 sm:justify-end">
                                    <Button type="button" variant="outline" onClick={() => setIsPricingOpen(false)}>
                                        Cancel
                                    </Button>
                                    <Button type="button" onClick={handlePurchaseCredits} className="w-full sm:w-auto bg-purple-600 hover:bg-purple-700">
                                        Confirm & Pay
                                    </Button>
                                </DialogFooter>
                            </DialogContent>
                        </Dialog>
                    </div>
                )}

                <div className="flex justify-end">
                  <Button 
                    type="submit" 
                    size="lg" 
                    disabled={loading} 
                    className="bg-primary hover:bg-primary/90 w-full md:w-auto"
                  >
                    <Save className="mr-2 h-4 w-4" />
                    Save Configuration
                  </Button>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>

        <Card className="bg-[#0f0f0f]/80 backdrop-blur-sm border border-white/10">
            <CardHeader>
                <CardTitle>Response Behavior</CardTitle>
                <CardDescription>Control how and when the AI replies.</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="space-y-6">
                    <div className="flex flex-col space-y-2">
                        <Label>Smart Reply Delay <span className="text-amber-600 dark:text-amber-400 font-normal ml-2">(Recommended: 5 sec)</span></Label>
                        <div className="flex items-center space-x-4">
                            <Input 
                                type="number" 
                                value={wait} 
                                onChange={(e) => setWait(Number(e.target.value) || 1)} 
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

                    <div className="flex flex-col space-y-2">
                        <Label>Memory Context Name</Label>
                        <Input 
                            value={memoryContextName}
                            onChange={(e) => setMemoryContextName(e.target.value)}
                            placeholder="e.g. Short History, Long History"
                        />
                        <p className="text-sm text-muted-foreground">
                            Optional label to remember this memory behaviour preset.
                        </p>
                    </div>

                    <div className="flex flex-col space-y-2">
                        <Label>Old Messages in Memory <span className="text-amber-600 dark:text-amber-400 font-normal ml-2">(10–50)</span></Label>
                        <div className="flex items-center space-x-4">
                            <Input 
                                type="number" 
                                value={memoryLimit} 
                                onChange={(e) => {
                                    const raw = Number(e.target.value) || 10;
                                    const clamped = Math.max(10, Math.min(50, raw));
                                    setMemoryLimit(clamped);
                                }} 
                                min={10} 
                                max={50}
                                className="w-24 font-mono"
                            />
                            <span className="text-sm text-muted-foreground">messages</span>
                        </div>
                        <p className="text-sm text-muted-foreground">
                            Controls how many recent messages (10–50) the AI uses as memory context.
                        </p>
                    </div>

                    <div className="flex flex-col space-y-2">
                        <Label>Order Lock Window <span className="text-amber-600 dark:text-amber-400 font-normal ml-2">(minutes)</span></Label>
                        <div className="flex items-center space-x-4">
                            <Input 
                                type="number" 
                                value={orderLockMinutes} 
                                onChange={(e) => {
                                    const raw = Number(e.target.value) || 0;
                                    const clamped = Math.max(0, Math.min(1440, raw));
                                    setOrderLockMinutes(clamped);
                                }} 
                                min={0} 
                                max={1440}
                                className="w-24 font-mono"
                            />
                            <span className="text-sm text-muted-foreground">minutes</span>
                        </div>
                        <p className="text-sm text-muted-foreground">
                            Controls how long recent orders are treated as duplicates for the same customer.
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
