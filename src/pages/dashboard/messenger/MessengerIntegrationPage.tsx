import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, Settings, Database, Plus, Facebook, Trash2, CreditCard, Sparkles, Gift, Check, Search } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

// Declare Facebook SDK types globally
declare global {
  interface Window {
    fbAsyncInit: () => void;
    FB: any;
  }
}

export default function MessengerIntegrationPage() {
  const [pages, setPages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const navigate = useNavigate();

  // Subscription Modal State
  const [isSubscriptionOpen, setIsSubscriptionOpen] = useState(false);
  const [selectedPageForSub, setSelectedPageForSub] = useState<any | null>(null);
  const [selectedPlan, setSelectedPlan] = useState("3_months");
  const [couponCode, setCouponCode] = useState("");
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);

  const PLANS = {
    "3_months": { label: "3 Months", price: 500, duration_days: 90 },
    "6_months": { label: "6 Months", price: 800, duration_days: 180 },
    "12_months": { label: "12 Months", price: 1200, duration_days: 365 },
  };

  const COUPON_TRIALS: Record<string, number> = {
    "TRIAL7": 7,
    "FREE7": 7,
    "START7": 7
  };

  const [manualPageId, setManualPageId] = useState("");
  const [manualLoading, setManualLoading] = useState(false);

  useEffect(() => {
    // Get user email
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.email) {
        setUserEmail(user.email);
      }
    };
    getUser();

    // Initialize Facebook SDK
    window.fbAsyncInit = function() {
      window.FB.init({
        appId      : import.meta.env.VITE_FACEBOOK_APP_ID || 'YOUR_APP_ID_HERE',
        cookie     : true,
        xfbml      : true,
        version    : 'v19.0'
      });
    };

    // Load the SDK script
    (function(d, s, id){
       var js, fjs = d.getElementsByTagName(s)[0] as HTMLElement;
       if (d.getElementById(id)) {return;}
       js = d.createElement(s) as HTMLScriptElement; js.id = id;
       js.src = "https://connect.facebook.net/en_US/sdk.js";
       if (fjs && fjs.parentNode) {
         fjs.parentNode.insertBefore(js, fjs);
       } else {
         d.head.appendChild(js);
       }
     }(document, 'script', 'facebook-jssdk'));

    fetchPages();
  }, [userEmail]);

  const subscribeAppToPage = (pageId: string, accessToken: string) => {
    return new Promise((resolve, reject) => {
      // Add timeout to prevent hanging
      const timeoutId = setTimeout(() => {
        console.error(`Timeout subscribing app to page ${pageId}`);
        reject(new Error("Timeout subscribing to page"));
      }, 10000); // 10 seconds timeout

      window.FB.api(
        `/${pageId}/subscribed_apps`,
        'post',
        {
          access_token: accessToken,
          subscribed_fields: ['messages', 'messaging_postbacks', 'feed', 'changes'] 
        },
        function(response: any) {
          clearTimeout(timeoutId);
          if (!response || response.error) {
            console.error('Error subscribing app to page:', response?.error);
            // Don't reject, just resolve with error so we don't break the loop
            resolve({ error: response?.error }); 
          } else {
            console.log('Successfully subscribed app to page:', response);
            resolve(response);
          }
        }
      );
    });
  };

  const unsubscribeAppFromPage = (pageId: string, accessToken: string) => {
    return new Promise((resolve) => {
      window.FB.api(
        `/${pageId}/subscribed_apps`,
        'delete',
        {
          access_token: accessToken
        },
        function(response: any) {
          if (!response || response.error) {
            console.error('Error unsubscribing app from page:', response?.error);
            resolve(false);
          } else {
            console.log('Successfully unsubscribed app from page:', response);
            resolve(true);
          }
        }
      );
    });
  };

  const handleRemovePage = async (page: any) => {
      if (!confirm(`Are you sure you want to disconnect ${page.name}? This will stop the bot from replying.`)) {
          return;
      }

      try {
          // 1. Try to unsubscribe from Facebook (best effort)
          if (page.page_access_token && window.FB) {
              await unsubscribeAppFromPage(page.page_id, page.page_access_token);
          }

          // 2. Remove from page_access_token_message
          const { error } = await supabase
              .from('page_access_token_message')
              .delete()
              .eq('page_id', page.page_id);

          if (error) throw error;

          // 3. Clear from local storage if active
          const activeId = localStorage.getItem("active_fb_page_id");
          if (activeId === page.page_id) {
              localStorage.removeItem("active_fb_db_id");
              localStorage.removeItem("active_fb_page_id");
          }
          
          toast.success(`Disconnected ${page.name}`);
          fetchPages();

      } catch (error) {
          console.error("Error removing page:", error);
          toast.error("Failed to disconnect page");
      }
  };

  const fetchPages = async () => {
    if (!userEmail) return;
    
    try {
      const { data, error } = await supabase
        .from('page_access_token_message')
        .select('*')
        .eq('email', userEmail);
      
      if (error) throw error;
      setPages(data || []);
    } catch (error) {
      console.error("Error fetching pages:", error);
      toast.error("Failed to load Facebook pages");
    } finally {
      setLoading(false);
    }
  };

  const handleConnectFacebook = async () => {
    if (!window.FB) {
        toast.error("Facebook SDK not loaded yet. Please refresh or check your connection.");
        return;
    }

    if (!import.meta.env.VITE_FACEBOOK_APP_ID) {
        toast.warning("Facebook App ID not configured. Please set VITE_FACEBOOK_APP_ID in your environment variables.");
    }

    setConnecting(true);

    try {
        const loginResponse: any = await new Promise((resolve, reject) => {
            window.FB.login((response: any) => {
                if (response.authResponse) {
                    resolve(response);
                } else {
                    reject(new Error("User cancelled login or did not fully authorize."));
                }
            }, {scope: 'pages_show_list,pages_messaging,pages_read_engagement,pages_manage_metadata'});
        });

        console.log('Successfully logged in, exchanging token...');
        const shortLivedToken = loginResponse.authResponse.accessToken;
        let finalToken = shortLivedToken;

        // Exchange for Long-Lived Token via Backend
        try {
            const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
            const exchangeResponse = await fetch(`${backendUrl}/api/auth/facebook/exchange-token`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ shortLivedToken })
            });
            
            if (exchangeResponse.ok) {
                 const exchangeData = await exchangeResponse.json();
                 if (exchangeData.access_token) {
                    console.log('Obtained long-lived token');
                    finalToken = exchangeData.access_token;
                 } else {
                    console.warn('Backend returned no token:', exchangeData);
                 }
            } else {
                 console.warn('Backend exchange failed:', await exchangeResponse.text());
                 toast.warning("Using short-lived token (Backend unreachable).");
            }

        } catch (err) {
            console.error('Error contacting backend for token exchange:', err);
            toast.warning("Backend connection failed. Using short-lived token.");
        }

        // Fetch User's Pages
        const pageResponse: any = await new Promise((resolve, reject) => {
            window.FB.api('/me/accounts', 'get', { access_token: finalToken }, (response: any) => {
                 if (response && response.data) {
                     resolve(response);
                 } else {
                     reject(response?.error || new Error("No pages found or permission denied."));
                 }
            });
        });

        console.log('Pages fetched:', pageResponse);
        await savePagesToSupabase(pageResponse.data);

    } catch (error: any) {
        console.error("Facebook Connect Error:", error);
        toast.error(error.message || "Failed to connect Facebook");
    } finally {
        setConnecting(false);
    }
  };

  const savePagesToSupabase = async (facebookPages: any[]) => {
      if (!userEmail) {
        toast.error("User email not found. Please reload.");
        setConnecting(false);
        return;
      }

      let successCount = 0;
      for (const page of facebookPages) {
          try {
              // 1. Check if configuration already exists to get/generate ID
              const { data: existingConfig } = await supabase
                  .from('fb_message_database')
                  .select('id')
                  .eq('page_id', page.id)
                  .maybeSingle();

              let dbId: number;
              
              if (existingConfig) {
                  dbId = (existingConfig as any).id;
              } else {
                  // Generate random 6-digit code
                  dbId = Math.floor(100000 + Math.random() * 900000);
              }

              // 1.5 Subscribe App to Page (Critical for Webhooks/n8n)
              try {
                console.log(`Attempting to subscribe app to page ${page.name}...`);
                const subResult: any = await subscribeAppToPage(page.id, page.access_token);
                if (subResult?.error) {
                    console.warn(`Subscription warning for ${page.name}:`, subResult.error);
                } else {
                    console.log(`Subscribed app to page ${page.name}`);
                }
              } catch (subError) {
                console.error(`Failed to subscribe app to page ${page.name}`, subError);
              }

              // 2. Upsert into page_access_token_message
              const { error: tokenError } = await supabase
                  .from('page_access_token_message')
                  .upsert({
                      page_id: page.id,
                      name: page.name,
                      page_access_token: page.access_token,
                      subscription_status: 'active', // Default to active on connect
                      subscription_plan: 'free',
                      message_credit: 100, // Give 100 free credits on connection
                      email: userEmail,
                      secret_key: String(dbId),
                      found_id: String(dbId)
                  } as any, { onConflict: 'page_id' });

              if (tokenError) {
                  console.error(`Error saving page ${page.name}:`, tokenError);
                  continue;
              }

              // 3. Create entry in fb_message_database if it didn't exist
              if (!existingConfig) {
                  await supabase
                    .from('fb_message_database')
                    .insert({
                        id: dbId,
                        page_id: page.id,
                        reply_message: false,
                        swipe_reply: false,
                        image_detection: false,
                        image_send: false,
                        template: false,
                        order_tracking: false
                    } as any);
              }

              successCount++;
          } catch (err) {
              console.error(`Failed to process page ${page.name}`, err);
          }
      }

      if (successCount > 0) {
          toast.success(`Successfully connected ${successCount} pages!`);
          fetchPages();
      } else {
          toast.error("Failed to connect pages.");
      }
  };

  const handleSubscribe = async () => {
    if (!selectedPageForSub) return;
    setIsProcessingPayment(true);

    try {
        // 1. Check Coupon Code
        if (couponCode && COUPON_TRIALS[couponCode.toUpperCase()]) {
            const days = COUPON_TRIALS[couponCode.toUpperCase()];
            const expiryDate = new Date();
            expiryDate.setDate(expiryDate.getDate() + days);

            // Activate Trial
            const { error } = await (supabase
                .from('page_access_token_message') as any)
                .update({
                    subscription_status: 'trial',
                    subscription_plan: 'trial',
                    message_credit: 500, // 500 credits for trial
                    expires_at: expiryDate.toISOString()
                })
                .eq('page_id', selectedPageForSub.page_id);

            if (error) throw error;
            
            toast.success(`Trial Activated for ${days} days!`);
            setIsSubscriptionOpen(false);
            fetchPages();
            return;
        }

        // 2. Handle Paid Subscription
        const plan = PLANS[selectedPlan as keyof typeof PLANS];
        if (!plan) throw new Error("Invalid Plan");

        // Create Transaction Record
        const { error: trxError } = await (supabase
            .from('payment_transactions') as any)
            .insert({
                user_email: userEmail,
                amount: plan.price,
                method: 'manual', // or 'bkash', etc.
                trx_id: `SUB-${Math.random().toString(36).substr(2, 9).toUpperCase()}`,
                sender_number: 'N/A', // Since it's internal
                status: 'pending',
            });

        if (trxError) throw trxError;

        // Update Page Status to Pending
        const { error: pageError } = await (supabase
            .from('page_access_token_message') as any)
            .update({
                subscription_status: 'pending_payment',
                subscription_plan: selectedPlan
            })
            .eq('page_id', selectedPageForSub.page_id);

        if (pageError) throw pageError;

        toast.success("Subscription request submitted. Please wait for admin approval.");
        setIsSubscriptionOpen(false);
        fetchPages();

    } catch (error: any) {
        console.error("Subscription Error:", error);
        toast.error(error.message || "Failed to process subscription");
    } finally {
        setIsProcessingPayment(false);
    }
  };

  const openSubscriptionModal = (page: any) => {
    setSelectedPageForSub(page);
    setCouponCode("");
    setSelectedPlan("3_months");
    setIsSubscriptionOpen(true);
  };

  const handleManage = async (page: any) => {
    // Check if active
    if (page.subscription_status !== 'active' && page.subscription_status !== 'trial') {
        openSubscriptionModal(page);
        return;
    }

    try {
      // Find linked database entry
      const { data, error } = await supabase
        .from('fb_message_database')
        .select('id')
        .eq('page_id', page.page_id)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        localStorage.setItem("active_fb_db_id", String((data as any).id));
        localStorage.setItem("active_fb_page_id", page.page_id);
        toast.success(`Connected to ${page.name}`);
        navigate("/dashboard/messenger/control");
      } else {
        // Option to create if missing? For now just warn.
        toast.error("No configuration found for this page. Please contact admin.");
      }
    } catch (error) {
      console.error("Error connecting to page:", error);
      toast.error("Failed to connect to page database");
    }
  };

  const handleManualConnect = async () => {
    if (!manualPageId || manualPageId.length < 3) {
        toast.error("Please enter a valid Secret Code or Found ID");
        return;
    }
    
    setManualLoading(true);
    try {
        // 1. Search in page_access_token_message by secret_key or found_id
        const { data: pageData, error: pageError } = await supabase
            .from('page_access_token_message')
            .select('*')
            .or(`secret_key.eq.${manualPageId},found_id.eq.${manualPageId}`)
            .maybeSingle();
            
        if (pageError || !pageData) {
            toast.error("Page not found with this Secret Code or ID.");
            setManualLoading(false);
            return;
        }
        
        const realPageId = pageData.page_id;
        
        // 2. Search in fb_message_database using the retrieved page_id
        const { data: dbData, error: dbError } = await supabase
            .from('fb_message_database')
            .select('id')
            .eq('page_id', realPageId)
            .maybeSingle();
            
        if (dbError) {
             console.error("DB Error:", dbError);
        }
        
        let dbId = dbData ? (dbData as any).id : null;
        
        if (pageData.page_access_token) {
            // Set as active
            if (dbId) {
                localStorage.setItem("active_fb_db_id", String(dbId));
            }
            localStorage.setItem("active_fb_page_id", realPageId);
            
            // Refresh list
            await fetchPages();
            
            toast.success(`Connected to ${pageData.name || 'Page'} successfully!`);
            setManualPageId("");
        } else {
             toast.error("Page found but has no access token. Please reconnect via Facebook.");
        }

    } catch (err) {
        console.error("Manual connect error:", err);
        toast.error("Failed to connect page.");
    } finally {
        setManualLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Facebook Pages</h2>
          <p className="text-muted-foreground">
            Manage your connected Facebook pages and their automation settings.
          </p>
        </div>
        <Button onClick={handleConnectFacebook} disabled={connecting}>
            {connecting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Facebook className="mr-2 h-4 w-4" />}
            {connecting ? "Connecting..." : "Connect with Facebook"}
        </Button>
      </div>

      {/* Manual Connection Card */}
      <Card>
        <CardHeader>
            <CardTitle>Manual Connection</CardTitle>
            <CardDescription>Enter your Secret Code or Found ID to connect safely.</CardDescription>
        </CardHeader>
        <CardContent className="flex gap-4 items-end">
             <div className="grid w-full max-w-sm items-center gap-1.5">
                <Label htmlFor="pageId">Secret Code / Found ID</Label>
                <Input 
                    type="text" 
                    id="pageId" 
                    placeholder="e.g. secret_123 or found_456" 
                    value={manualPageId}
                    onChange={(e) => setManualPageId(e.target.value)}
                />
             </div>
             <Button onClick={handleManualConnect} disabled={manualLoading}>
                 {manualLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                 Search & Connect
             </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Connected Pages</CardTitle>
          <CardDescription>List of Facebook pages integrated with the bot.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="animate-spin h-8 w-8 text-primary" />
            </div>
          ) : pages.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <Database className="mx-auto h-12 w-12 opacity-20 mb-3" />
              <p>No pages found.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Page Name</TableHead>
                  <TableHead>Page ID</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pages.map((page) => (
                  <TableRow key={page.page_id}>
                    <TableCell className="font-medium">{page.name}</TableCell>
                    <TableCell className="font-mono text-xs">{page.page_id}</TableCell>
                    <TableCell className="text-right space-x-2">
                      {page.subscription_status === 'active' || page.subscription_status === 'trial' ? (
                          <Button variant="outline" size="sm" onClick={() => handleManage(page)}>
                            <Settings className="mr-2 h-4 w-4" />
                            Manage
                          </Button>
                      ) : (
                          <Button variant="default" size="sm" className="bg-purple-600 hover:bg-purple-700" onClick={() => openSubscriptionModal(page)}>
                            <CreditCard className="mr-2 h-4 w-4" />
                            {page.subscription_status === 'pending_payment' ? 'Pending' : 'Subscribe'}
                          </Button>
                      )}
                      <Button variant="destructive" size="sm" onClick={() => handleRemovePage(page)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={isSubscriptionOpen} onOpenChange={setIsSubscriptionOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Subscribe to Activate {selectedPageForSub?.name}</DialogTitle>
            <DialogDescription>
              Choose a subscription plan to enable chatbot automation for this page.
            </DialogDescription>
          </DialogHeader>
          
          <div className="grid gap-4 py-4">
             <RadioGroup value={selectedPlan} onValueChange={setSelectedPlan} className="grid gap-3">
                {Object.entries(PLANS).map(([key, plan]) => (
                    <div key={key}>
                        <RadioGroupItem value={key} id={key} className="peer sr-only" />
                        <Label
                          htmlFor={key}
                          className="flex items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary cursor-pointer"
                        >
                          <div className="flex items-center gap-2">
                             <div className="bg-primary/10 p-2 rounded-full">
                                <Sparkles className="w-4 h-4 text-primary" />
                             </div>
                             <div className="flex flex-col">
                                <span className="font-semibold">{plan.label}</span>
                                <span className="text-xs text-muted-foreground">{plan.duration_days} Days Access</span>
                             </div>
                          </div>
                          <div className="font-bold text-lg">৳{plan.price}</div>
                        </Label>
                    </div>
                ))}
             </RadioGroup>

             <div className="space-y-2 pt-2 border-t">
                <Label htmlFor="coupon">Have a coupon?</Label>
                <div className="flex gap-2">
                    <Input 
                        id="coupon" 
                        placeholder="Enter code (e.g. TRIAL7)" 
                        value={couponCode} 
                        onChange={(e) => setCouponCode(e.target.value)} 
                    />
                    {couponCode && COUPON_TRIALS[couponCode.toUpperCase()] && (
                        <div className="flex items-center text-green-600 text-sm">
                            <Check className="w-4 h-4 mr-1" />
                            Valid
                        </div>
                    )}
                </div>
                <p className="text-xs text-muted-foreground">Use code <b>TRIAL7</b> for 7 days free.</p>
             </div>
          </div>

          <DialogFooter>
            <Button onClick={handleSubscribe} disabled={isProcessingPayment} className="w-full">
              {isProcessingPayment ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Processing...
                  </>
              ) : (
                  <>
                    {couponCode && COUPON_TRIALS[couponCode.toUpperCase()] ? (
                        <>
                            <Gift className="mr-2 h-4 w-4" />
                            Activate Free Trial
                        </>
                    ) : (
                        <>
                            <CreditCard className="mr-2 h-4 w-4" />
                            Pay & Subscribe
                        </>
                    )}
                  </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
