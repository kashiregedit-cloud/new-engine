import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { 
    AlertCircle, 
    Facebook, 
    Check, 
    Copy, 
    Loader2, 
    Database, 
    Settings, 
    Trash2, 
    CreditCard, 
    Gift,
    Sparkles
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { BACKEND_URL } from "@/config";

// --- Types & Interfaces ---

interface FacebookPage {
    id: string;
    name: string;
    access_token: string;
    tasks?: string[];
}

interface PageData {
    page_id: string;
    name: string;
    page_access_token?: string;
    subscription_status?: string;
    subscription_plan?: string;
    message_credit?: number;
    email?: string;
    secret_key?: string;
    found_id?: string;
    [key: string]: any;
}

declare global {
    interface Window {
        fbAsyncInit: () => void;
        FB: any;
    }
}

// --- Constants ---

const PLANS = {
    '1_month': { label: '1 Month', price: 1000, duration_days: 30 },
    '3_months': { label: '3 Months', price: 2500, duration_days: 90 },
    '1_year': { label: '1 Year', price: 9000, duration_days: 365 },
};

const COUPON_TRIALS: Record<string, number> = {
    'TRIAL7': 7,
    'WELCOME14': 14
};

export default function MessengerIntegrationPage() {
    const navigate = useNavigate();
    
    // --- State ---
    const [userEmail, setUserEmail] = useState<string | null>(null);
    const [userId, setUserId] = useState<string | null>(null);
    const [pages, setPages] = useState<PageData[]>([]);
    const [loading, setLoading] = useState(true);
    const [connecting, setConnecting] = useState(false);
    const [copySuccess, setCopySuccess] = useState(false);

    // Direct Connect State
    const [directPageName, setDirectPageName] = useState("");
    const [directPageId, setDirectPageId] = useState("");
    const [directAccessToken, setDirectAccessToken] = useState("");
    const [directLoading, setDirectLoading] = useState(false);
    const [isManualSetupOpen, setIsManualSetupOpen] = useState(false);

    // Subscription Modal State
    const [isSubscriptionOpen, setIsSubscriptionOpen] = useState(false);
    const [selectedPageForSub, setSelectedPageForSub] = useState<PageData | null>(null);
    const [selectedPlan, setSelectedPlan] = useState("3_months");
    const [couponCode, setCouponCode] = useState("");
    const [isProcessingPayment, setIsProcessingPayment] = useState(false);

    // --- Effects ---

    useEffect(() => {
        // Get user email and check for Team Membership
        const getUser = async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (user?.email) {
                setUserId(user.id); // Store UUID
                
                const { data: teamData } = await (supabase
                    .from('team_members') as any)
                    .select('owner_email')
                    .eq('member_email', user.email)
                    .single();
                
                if (teamData) {
                    setUserEmail(teamData.owner_email);
                    toast.info(`Team Mode: Managing ${teamData.owner_email}'s account`);
                } else {
                    setUserEmail(user.email);
                }
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

    }, []);

    // Fetch pages when userEmail is available
    useEffect(() => {
        if (userEmail) {
            fetchPages();
        }
    }, [userEmail]);

    // --- Helper Functions ---

    const copyWebhook = () => {
        const webhookUrl = `${BACKEND_URL}/webhook`;
        navigator.clipboard.writeText(webhookUrl);
        setCopySuccess(true);
        toast.success("Webhook URL copied!");
        setTimeout(() => setCopySuccess(false), 2000);
    };

    const fetchPages = async () => {
        if (!userEmail) return;
        
        try {
            // 1. Fetch user's own pages
            const { data: userPages, error } = await supabase
                .from('page_access_token_message')
                .select('*')
                .eq('email', userEmail);
            
            if (error) throw error;
            
            let finalPages: PageData[] = userPages || [];

            // 2. Fetch currently active page if not in the list (Shared Access Mode)
            const activeId = localStorage.getItem("active_fb_page_id");
            if (activeId) {
                const isAlreadyInList = finalPages.some((p) => p.page_id === activeId);
                if (!isAlreadyInList) {
                    const { data: activePageData } = await supabase
                        .from('page_access_token_message')
                        .select('*')
                        .eq('page_id', activeId)
                        .maybeSingle();
                    
                    if (activePageData) {
                        // Validate ownership before injecting (Security Fix)
                        // Cast to any to avoid "Property 'email' does not exist on type 'never'" error
                        const pageToCheck = activePageData as any;
                        
                        if (pageToCheck.email === userEmail) {
                            finalPages = [pageToCheck, ...finalPages];
                        } else {
                            // If the cached page doesn't belong to the current user (or their team owner), 
                            // ignore it and clear the invalid cache.
                            localStorage.removeItem("active_fb_page_id");
                        }
                    }
                }
            }

            setPages(finalPages);
        } catch (error) {
            console.error("Error fetching pages:", error);
            toast.error("Failed to load Facebook pages");
        } finally {
            setLoading(false);
        }
    };

    const subscribeAppToPage = (pageId: string, accessToken: string) => {
        return new Promise((resolve) => {
            // Add timeout to prevent hanging
            const timeoutId = setTimeout(() => {
                console.error(`Timeout subscribing app to page ${pageId}`);
                resolve({ success: false, error: 'timeout' });
            }, 10000); // 10 seconds timeout

            // Try using direct fetch first to avoid SDK dependency issues
            fetch(`https://graph.facebook.com/v19.0/${pageId}/subscribed_apps?access_token=${accessToken}&subscribed_fields=messages,messaging_postbacks,feed,changes`, {
                method: 'POST'
            })
            .then(res => res.json())
            .then(data => {
                clearTimeout(timeoutId);
                if (data.error) {
                    console.warn('Direct fetch subscription failed, falling back to SDK:', data.error);
                    // Fallback to SDK if available
                    if (window.FB) {
                        window.FB.api(
                            `/${pageId}/subscribed_apps`,
                            'post',
                            {
                                access_token: accessToken,
                                subscribed_fields: ['messages', 'messaging_postbacks', 'feed', 'changes'] 
                            },
                            function(response: any) {
                                if (!response || response.error) {
                                    console.error('SDK Error subscribing app to page:', response?.error);
                                    resolve({ error: response?.error }); 
                                } else {
                                    console.log('SDK Successfully subscribed app to page:', response);
                                    resolve(response);
                                }
                            }
                        );
                    } else {
                        resolve({ error: data.error });
                    }
                } else {
                    console.log('Direct fetch successfully subscribed app to page:', data);
                    resolve({ success: true });
                }
            })
            .catch(err => {
                clearTimeout(timeoutId);
                console.error('Direct fetch error:', err);
                // Fallback to SDK
                if (window.FB) {
                    window.FB.api(
                        `/${pageId}/subscribed_apps`,
                        'post',
                        {
                            access_token: accessToken,
                            subscribed_fields: ['messages', 'messaging_postbacks', 'feed', 'changes'] 
                        },
                        function(response: any) {
                            if (!response || response.error) {
                                resolve({ error: response?.error }); 
                            } else {
                                resolve(response);
                            }
                        }
                    );
                } else {
                    resolve({ error: err.message });
                }
            });
        });
    };

    const unsubscribeAppFromPage = (pageId: string, accessToken: string) => {
        return new Promise((resolve) => {
            if (window.FB) {
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
            } else {
                resolve(false);
            }
        });
    };

    const savePagesToSupabase = async (facebookPages: FacebookPage[]) => {
        if (!userEmail) {
            toast.error("User email not found. Please reload.");
            setConnecting(false);
            return;
        }

        // Check if primary email is Gmail (User Request)
        const isGmail = userEmail.toLowerCase().endsWith('@gmail.com');
        if (!isGmail) {
            toast.error("Integration is restricted to Gmail accounts only for security.");
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
                        message_credit: 0, // INTEGRATION IS FREE, but usage requires credits
                        email: userEmail,
                        user_id: userId, // Ensure user_id is set to UUID for Centralized Credit Check
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

    // --- Action Handlers ---

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
                const exchangeResponse = await fetch(`${BACKEND_URL}/api/auth/facebook/exchange-token`, {
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

    const handleDirectConnect = async () => {
        if (!directPageId || !directAccessToken || !directPageName) {
            toast.error("Please fill all fields");
            return;
        }
        
        setDirectLoading(true);
        try {
            // Verify token validity by calling FB Graph API manually
            const verifyRes = await fetch(`https://graph.facebook.com/v19.0/${directPageId}?fields=name&access_token=${directAccessToken}`);
            const verifyData = await verifyRes.json();
            
            if (verifyData.error) {
                throw new Error(`Invalid Token or Page ID: ${verifyData.error.message}`);
            }
            
            if (verifyData.id !== directPageId) {
                throw new Error("Page ID mismatch");
            }

            // Use the verified name if provided name is generic
            const finalName = verifyData.name || directPageName;

            const pageObj: FacebookPage = {
                id: directPageId,
                name: finalName,
                access_token: directAccessToken
            };

            await savePagesToSupabase([pageObj]);
            
            setDirectPageName("");
            setDirectPageId("");
            setDirectAccessToken("");
            
        } catch (error: any) {
            console.error("Direct Connect Error:", error);
            toast.error(error.message || "Failed to connect page");
        } finally {
            setDirectLoading(false);
        }
    };

    const handleRemovePage = async (page: PageData) => {
        if (!confirm(`Are you sure you want to disconnect ${page.name}? This will stop the bot from replying.`)) {
            return;
        }

        try {
            // 1. Try to unsubscribe from Facebook (best effort)
            if (page.page_access_token) {
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

    const openSubscriptionModal = (page: PageData) => {
        setSelectedPageForSub(page);
        setCouponCode("");
        setSelectedPlan("3_months");
        setIsSubscriptionOpen(true);
    };

    const handleManage = async (page: PageData) => {
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
                
                // CENTRALIZED CREDIT: Add 500 to user_configs
                const ownerUUID = (selectedPageForSub as any).user_id;
                
                if (ownerUUID) {
                    const { data: userConfig } = await supabase
                        .from('user_configs')
                        .select('message_credit')
                        .eq('user_id', ownerUUID)
                        .maybeSingle();
                    
                    const currentGlobal = (userConfig as any)?.message_credit || 0;
                    
                    await (supabase
                        .from('user_configs') as any)
                        .upsert({ 
                            user_id: ownerUUID,
                            message_credit: currentGlobal + 500
                        }, { onConflict: 'user_id' });
                }

                const { error } = await (supabase
                    .from('page_access_token_message') as any)
                    .update({
                        subscription_status: 'trial',
                        subscription_plan: 'trial',
                        // message_credit: 500, // REMOVED: Centralized credit
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

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Facebook Pages</h2>
                    <p className="text-muted-foreground">
                        Manage your connected Facebook pages and their automation settings.
                    </p>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setIsManualSetupOpen(true)}>
                        <Settings className="mr-2 h-4 w-4" />
                        Open Manual Setup
                    </Button>
                    <Button onClick={handleConnectFacebook} disabled={connecting}>
                        {connecting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Facebook className="mr-2 h-4 w-4" />}
                        {connecting ? "Connecting..." : "Connect with Facebook"}
                    </Button>
                </div>
            </div>

            <Dialog open={isManualSetupOpen} onOpenChange={setIsManualSetupOpen}>
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>Manual Integration Setup</DialogTitle>
                        <DialogDescription>
                            Configure your webhook and connect your page manually.
                        </DialogDescription>
                    </DialogHeader>
                    
                    <div className="grid gap-6 py-4">
                        {/* Section 1: Professional Webhook Configuration */}
                        <div className="space-y-4 border rounded-lg p-4 bg-secondary/10">
                            <div className="flex items-center gap-2">
                                <div className="bg-primary/10 p-1.5 rounded-md">
                                    <Database className="h-4 w-4 text-primary" />
                                </div>
                                <h3 className="font-semibold text-sm">Professional Webhook Configuration</h3>
                            </div>
                            
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label className="text-xs font-medium">Callback URL</Label>
                                    <div className="relative">
                                        <Input readOnly value="https://webhook.salesmanchatbot.online/webhook" className="pr-8" />
                                        <Button
                                            size="icon"
                                            variant="ghost"
                                            className="absolute right-1 top-1 h-7 w-7"
                                            onClick={() => {
                                                navigator.clipboard.writeText("https://webhook.salesmanchatbot.online/webhook");
                                                toast.success("URL Copied!");
                                            }}
                                        >
                                            <Copy className="h-3 w-3" />
                                        </Button>
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <Label className="text-xs font-medium">Verify Token</Label>
                                    <div className="relative">
                                        <Input readOnly value="123456" className="pr-8" />
                                        <Button
                                            size="icon"
                                            variant="ghost"
                                            className="absolute right-1 top-1 h-7 w-7"
                                            onClick={() => {
                                                navigator.clipboard.writeText("123456");
                                                toast.success("Token Copied!");
                                            }}
                                        >
                                            <Copy className="h-3 w-3" />
                                        </Button>
                                    </div>
                                </div>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                * Enter these details in your Facebook App Developer Portal under <strong>Webhooks &gt; Page</strong>.
                            </p>
                        </div>

                        {/* Section 2: Page Connection Fields */}
                        <div className="space-y-4">
                            <div className="grid gap-2">
                                <Label htmlFor="pageName">Page Name (Reference)</Label>
                                <Input 
                                    id="pageName" 
                                    placeholder="e.g. My Business Page" 
                                    value={directPageName}
                                    onChange={(e) => setDirectPageName(e.target.value)}
                                />
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="directPageId">Page ID</Label>
                                <Input 
                                    id="directPageId" 
                                    placeholder="e.g. 10001234567890" 
                                    value={directPageId}
                                    onChange={(e) => setDirectPageId(e.target.value)}
                                />
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="accessToken">Page Access Token</Label>
                                <Input 
                                    id="accessToken" 
                                    type="password"
                                    placeholder="EAA..." 
                                    value={directAccessToken}
                                    onChange={(e) => setDirectAccessToken(e.target.value)}
                                />
                                <p className="text-xs text-muted-foreground">
                                    Ensure this token has <code>pages_messaging</code> permission.
                                </p>
                            </div>
                            <Button onClick={handleDirectConnect} disabled={directLoading} className="w-full">
                                {directLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                                Connect Page
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            <Card>
                <CardHeader>
                    <CardTitle>Connected Pages ({pages.length})</CardTitle>
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
                                            {page.subscription_status === 'invalid_token' && (
                                                <div className="inline-flex items-center text-red-500 font-bold text-xs mr-3 bg-red-50 px-2 py-1 rounded">
                                                    <AlertCircle className="w-3 h-3 mr-1" /> Token Invalid
                                                </div>
                                            )}
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

            {/* Subscription Modal */}
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
                                            Pay Now
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
