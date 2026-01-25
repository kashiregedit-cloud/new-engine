import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, Settings, Database, Plus, Facebook, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";

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

  const handleManage = async (page: any) => {
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
                  <TableHead>Status</TableHead>
                  <TableHead>Subscription</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pages.map((page) => (
                  <TableRow key={page.page_id}>
                    <TableCell className="font-medium">{page.name}</TableCell>
                    <TableCell className="font-mono text-xs">{page.page_id}</TableCell>
                    <TableCell>
                       <Badge variant={page.subscription_status === 'active' ? 'default' : 'secondary'}>
                         {page.subscription_status || 'Inactive'}
                       </Badge>
                    </TableCell>
                    <TableCell>{page.subscription_plan || 'Free'}</TableCell>
                    <TableCell className="text-right space-x-2">
                      <Button variant="outline" size="sm" onClick={() => handleManage(page)}>
                        <Settings className="mr-2 h-4 w-4" />
                        Manage
                      </Button>
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
    </div>
  );
}
