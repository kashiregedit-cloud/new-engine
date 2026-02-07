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
    Sparkles,
    Users
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { BACKEND_URL } from "@/config";
import { useMessenger } from "@/context/MessengerContext";
import { logFrontendError } from "@/lib/logger";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

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

export default function MessengerIntegrationPage() {
    const navigate = useNavigate();
    const { 
        refreshPages, 
        pages: contextPages, 
        isTeamMember, 
        activeTeam, 
        viewMode, 
        switchViewMode 
    } = useMessenger();
    
    // --- State ---
    const [userEmail, setUserEmail] = useState<string | null>(null);
    const [userId, setUserId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [connecting, setConnecting] = useState(false);
    const [copySuccess, setCopySuccess] = useState(false);

    // Direct Connect State
    const [directPageName, setDirectPageName] = useState("");
    const [directPageId, setDirectPageId] = useState("");
    const [directAccessToken, setDirectAccessToken] = useState("");
    const [directLoading, setDirectLoading] = useState(false);
    const [isManualSetupOpen, setIsManualSetupOpen] = useState(false);

    // Subscription Modal State - DEPRECATED/REMOVED
    // const [isSubscriptionOpen, setIsSubscriptionOpen] = useState(false);
    // const [selectedPageForSub, setSelectedPageForSub] = useState<PageData | null>(null);
    // const [selectedPlan, setSelectedPlan] = useState("3_months");
    // const [couponCode, setCouponCode] = useState("");
    // const [isProcessingPayment, setIsProcessingPayment] = useState(false);

    // --- Effects ---

    useEffect(() => {
        // Get user email
        const getUser = async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (user?.email) {
                setUserId(user.id);
                // Determine effective email based on viewMode
                if (viewMode === 'team' && isTeamMember && activeTeam) {
                    setUserEmail(activeTeam.owner_email);
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

    // Use pages from context instead of local fetch
    const pages = contextPages as PageData[];

    // --- Helper Functions ---

    const copyWebhook = () => {
        const webhookUrl = `${BACKEND_URL}/webhook`;
        navigator.clipboard.writeText(webhookUrl);
        setCopySuccess(true);
        toast.success("Webhook URL copied!");
        setTimeout(() => setCopySuccess(false), 2000);
    };

    const fetchPages = async () => {
        // Delegated to MessengerContext
        await refreshPages();
        setLoading(false);
    };

    const subscribeAppToPage = (pageId: string, accessToken: string, fields: string[] = []) => {
        return new Promise((resolve) => {
            // Add timeout to prevent hanging
            const timeoutId = setTimeout(() => {
                console.error(`Timeout subscribing app to page ${pageId}`);
                resolve({ success: false, error: 'timeout' });
            }, 10000); // 10 seconds timeout

            // Extended Fields for Professional Bot & Handover Protocol
            const defaultFields = [
                'messages', 
                'messaging_postbacks', 
                'messaging_optins', 
                'message_deliveries', 
                'message_reads', 
                'messaging_referrals', 
                'standby', // Critical for Handover Protocol
                'feed', 
                'changes'
            ];
            
            const targetFields = fields.length > 0 ? fields : defaultFields;
            const fieldsStr = targetFields.join(',');

            // Try using SDK FIRST to avoid CORS issues on client side
            if (window.FB) {
                 window.FB.api(
                    `/${pageId}/subscribed_apps`,
                    'post',
                    {
                        access_token: accessToken,
                        subscribed_fields: fieldsStr // Send as string for compatibility
                    },
                    function(response: any) {
                        clearTimeout(timeoutId);
                        if (!response || response.error) {
                            console.warn('SDK Subscription failed, trying direct fetch:', response?.error);
                            
                            // Fallback to Direct Fetch
                            fetch(`https://graph.facebook.com/v19.0/${pageId}/subscribed_apps?access_token=${accessToken}&subscribed_fields=${fieldsStr}`, {
                                method: 'POST'
                            })
                            .then(res => res.json())
                            .then(data => {
                                if (data.error) {
                                    resolve({ error: data.error });
                                } else {
                                    console.log('Direct fetch successfully subscribed app to page:', data);
                                    resolve({ success: true });
                                }
                            })
                            .catch(err => {
                                resolve({ error: err.message });
                            });

                        } else {
                            console.log('SDK Successfully subscribed app to page:', response);
                            resolve(response);
                        }
                    }
                );
            } else {
                // Fallback if SDK not ready
                fetch(`https://graph.facebook.com/v19.0/${pageId}/subscribed_apps?access_token=${accessToken}&subscribed_fields=${fieldsStr}`, {
                    method: 'POST'
                })
                .then(res => res.json())
                .then(data => {
                    clearTimeout(timeoutId);
                    if (data.error) {
                        resolve({ error: data.error });
                    } else {
                        resolve({ success: true });
                    }
                })
                .catch(err => {
                    clearTimeout(timeoutId);
                    resolve({ error: err.message });
                });
            }
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
                            logFrontendError({
                                message: `Unsubscribe Error: ${JSON.stringify(response?.error)}`,
                                context: 'MessengerIntegrationPage:unsubscribeAppFromPage',
                                pageId: pageId
                            });
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
                    
                    // Define Field Sets
                    // 'messaging_referrals' requires special permission, 'feed' requires pages_manage_posts
                    const allFields = ['messages', 'messaging_postbacks', 'message_deliveries', 'message_reads', 'messaging_optins', 'messaging_referrals', 'feed', 'changes', 'standby'];
                    const basicFields = ['messages', 'messaging_postbacks', 'message_deliveries', 'message_reads'];

                    // Attempt 1: Try ALL Fields
                    let subResult: any = await subscribeAppToPage(page.id, page.access_token, allFields);
                    
                    // Attempt 2: Fallback to BASIC Fields if first attempt failed
                    if (subResult?.error) {
                         console.warn(`Full subscription failed for ${page.name}:`, subResult.error);
                         toast.warning(`Full connection failed (${subResult.error.message || subResult.error.code}). Retrying with basic chat features...`);
                         
                         // Retry with minimal fields
                         subResult = await subscribeAppToPage(page.id, page.access_token, basicFields);
                    }

                    if (subResult?.error) {
                        // Final Failure
                        console.error(`Basic subscription failed for ${page.name}`, subResult.error);
                        
                        // Log to Backend
                        logFrontendError({
                            message: `Subscription Failed for ${page.name}: ${JSON.stringify(subResult.error)}`,
                            context: 'MessengerIntegrationPage:subscribeAppToPage',
                            pageName: page.name,
                            pageId: page.id
                        });

                        toast.error(`${page.name}: Connection Failed. ${subResult.error.message || 'Check Permissions'}`);
                    } else {
                        console.log(`Subscribed app to page ${page.name}`);
                        
                        // VERIFY SUBSCRIPTION FROM SOURCE
                        try {
                            const verifySub = await fetch(`https://graph.facebook.com/v19.0/${page.id}/subscribed_apps?access_token=${page.access_token}`);
                            const verifyData = await verifySub.json();
                            console.log(`[Verify] Subscribed Apps for ${page.name}:`, verifyData);
                            
                            if (verifyData.data && verifyData.data.length > 0) {
                                toast.success(`${page.name}: Connected Successfully!`);
                            } else {
                                // If verification returns empty, it means even the success response was a lie or token issue
                                toast.error(`${page.name}: Verification Failed. Please Re-login & Grant All Permissions.`);
                            }
                        } catch (vErr) {
                            console.warn('Verification check failed:', vErr);
                            // Assume success if fetch failed (network issue) but subscribe returned success
                            toast.success(`${page.name}: Connected (Verification Skipped)`);
                        }
                    }
                } catch (subError: any) {
                    console.error(`Failed to subscribe app to page ${page.name}`, subError);
                    logFrontendError({
                        message: `Subscription Exception: ${subError.message}`,
                        stack: subError.stack,
                        context: 'MessengerIntegrationPage:subscribeAppToPage:Exception',
                        pageName: page.name,
                        pageId: page.id
                    });
                }

                // 2. Upsert into page_access_token_message
                const { error: tokenError } = await supabase
                    .from('page_access_token_message')
                    .upsert({
                        page_id: page.id,
                        name: page.name,
                        page_access_token: page.access_token,
                        subscription_status: 'active', // ALWAYS ACTIVE (Free Integration)
                        subscription_plan: 'unlimited_free', // No more plans
                        message_credit: 0, // Usage requires credits
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
            } catch (err: any) {
                console.error(`Failed to process page ${page.name}`, err);
                logFrontendError({
                    message: `Process Page Exception: ${err.message}`,
                    stack: err.stack,
                    context: 'MessengerIntegrationPage:savePagesToSupabase',
                    pageName: page.name,
                    pageId: page.id
                });
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
                }, {scope: 'pages_show_list,pages_messaging,pages_read_engagement,pages_manage_metadata,pages_read_user_content'});
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
                    const errorText = await exchangeResponse.text();
                    console.warn('Backend exchange failed:', errorText);
                    try {
                        const errorJson = JSON.parse(errorText);
                        toast.warning(`Token Exchange Failed: ${errorJson.error || 'Unknown Error'}`);
                    } catch (e) {
                        toast.warning(`Backend Error: ${exchangeResponse.status} ${exchangeResponse.statusText}`);
                    }
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
            logFrontendError({
                message: `Facebook Connect Error: ${error.message}`,
                stack: error.stack,
                context: 'MessengerIntegrationPage:handleConnectFacebook'
            });
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
            logFrontendError({
                message: `Direct Connect Error: ${error.message}`,
                stack: error.stack,
                context: 'MessengerIntegrationPage:handleDirectConnect'
            });
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

        } catch (error: any) {
            console.error("Error removing page:", error);
            logFrontendError({
                message: `Remove Page Error: ${error.message}`,
                stack: error.stack,
                context: 'MessengerIntegrationPage:handleRemovePage',
                pageName: page.name,
                pageId: page.page_id
            });
            toast.error("Failed to disconnect page");
        }
    };

    const openSubscriptionModal = (page: PageData) => {
        // setSelectedPageForSub(page);
        // setCouponCode("");
        // setSelectedPlan("3_months");
        // setIsSubscriptionOpen(true);
    };

    const handleManage = async (page: PageData) => {
        // ALWAYS ALLOW MANAGE (Free Integration)
        // Check if active
        // if (page.subscription_status !== 'active' && page.subscription_status !== 'trial') {
        //    openSubscriptionModal(page);
        //    return;
        // }

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
        // FUNCTION REMOVED - FREE INTEGRATION
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Facebook Pages</h2>
                    <p className="text-muted-foreground">
                        Manage your connected Facebook pages and their automation settings.
                    </p>
                </div>
                <div className="flex flex-col sm:flex-row gap-2 w-full md:w-auto mt-4 md:mt-0">
                    <Button variant="outline" onClick={() => setIsManualSetupOpen(true)} className="w-full sm:w-auto">
                        <Settings className="mr-2 h-4 w-4" />
                        Manual Setup
                    </Button>
                    <Button onClick={handleConnectFacebook} disabled={connecting} className="w-full sm:w-auto">
                        {connecting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Facebook className="mr-2 h-4 w-4" />}
                        {connecting ? "Connecting..." : "Connect Facebook"}
                    </Button>
                </div>
            </div>

            <Dialog open={isManualSetupOpen} onOpenChange={setIsManualSetupOpen}>
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>Manual Page Connection</DialogTitle>
                        <DialogDescription>
                            Use this if the automatic Facebook Login button doesn't work. You'll need your Page ID and Access Token.
                        </DialogDescription>
                    </DialogHeader>

                    {/* Webhook Configuration Details */}
                    <div className="bg-muted/50 p-4 rounded-md space-y-3 mb-4 border">
                        <h4 className="font-semibold text-sm flex items-center gap-2">
                            <Database className="h-4 w-4 text-blue-600" />
                            Webhook Configuration
                        </h4>
                        <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">Callback URL</Label>
                            <div className="flex gap-2">
                                <Input 
                                    readOnly 
                                    value={`${BACKEND_URL}/webhook`} 
                                    className="h-8 font-mono text-xs bg-background" 
                                />
                                <Button 
                                    variant="outline" 
                                    size="sm" 
                                    className="h-8 px-2"
                                    onClick={() => {
                                        navigator.clipboard.writeText(`${BACKEND_URL}/webhook`);
                                        toast.success("Copied Callback URL");
                                    }}
                                >
                                    <Copy className="h-3 w-3" />
                                </Button>
                            </div>
                        </div>
                        <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">Verify Token</Label>
                            <div className="flex gap-2">
                                <Input 
                                    readOnly 
                                    value="123456" 
                                    className="h-8 font-mono text-xs bg-background" 
                                />
                                <Button 
                                    variant="outline" 
                                    size="sm" 
                                    className="h-8 px-2"
                                    onClick={() => {
                                        navigator.clipboard.writeText("123456");
                                        toast.success("Copied Verify Token");
                                    }}
                                >
                                    <Copy className="h-3 w-3" />
                                </Button>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-4 py-4 border-t">
                        <div className="space-y-2">
                            <Label>Page Name</Label>
                            <Input 
                                placeholder="My Business Page" 
                                value={directPageName}
                                onChange={(e) => setDirectPageName(e.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Page ID</Label>
                            <Input 
                                placeholder="123456789012345" 
                                value={directPageId}
                                onChange={(e) => setDirectPageId(e.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Page Access Token</Label>
                            <Input 
                                type="password"
                                placeholder="EAA..." 
                                value={directAccessToken}
                                onChange={(e) => setDirectAccessToken(e.target.value)}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsManualSetupOpen(false)}>Cancel</Button>
                        <Button onClick={handleDirectConnect} disabled={directLoading}>
                            {directLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Connect Page"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Card>
                <CardHeader>
                    <CardTitle>Connected Pages</CardTitle>
                    <CardDescription>
                        Pages you have connected to the bot.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="flex justify-center py-8">
                            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                        </div>
                    ) : pages.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">
                            No pages connected yet. Click "Connect with Facebook" to get started.
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Page Name</TableHead>
                                        <TableHead>Page ID</TableHead>
                                        <TableHead>Status</TableHead>
                                        <TableHead className="text-right">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {pages.map((page) => (
                                        <TableRow key={page.page_id}>
                                            <TableCell className="font-medium">
                                                <div className="flex items-center gap-2">
                                                    <Facebook className="h-4 w-4 text-blue-600" />
                                                    <span className="whitespace-nowrap">{page.name}</span>
                                                </div>
                                            </TableCell>
                                            <TableCell className="font-mono text-xs whitespace-nowrap">{page.page_id}</TableCell>
                                            <TableCell>
                                                <span className="text-green-600 flex items-center gap-1 whitespace-nowrap"><Check className="h-3 w-3" /> Active (Free)</span>
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <div className="flex justify-end gap-2">
                                                    <Button variant="outline" size="sm" onClick={() => copyWebhook()}>
                                                        <Copy className="h-4 w-4" />
                                                    </Button>
                                                    <Button variant="default" size="sm" onClick={() => handleManage(page)}>
                                                        <Database className="mr-2 h-4 w-4" />
                                                        Manage
                                                    </Button>
                                                    <Button variant="destructive" size="sm" onClick={() => handleRemovePage(page)}>
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
