import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, Settings, Database, Plus, Facebook } from "lucide-react";
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
      window.FB.api(
        `/${pageId}/subscribed_apps`,
        'post',
        {
          access_token: accessToken,
          subscribed_fields: ['messages', 'messaging_postbacks', 'feed', 'changes'] 
        },
        function(response: any) {
          if (!response || response.error) {
            console.error('Error subscribing app to page:', response?.error);
            reject(response?.error);
          } else {
            console.log('Successfully subscribed app to page:', response);
            resolve(response);
          }
        }
      );
    });
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

  const handleConnectFacebook = () => {
    if (!window.FB) {
        toast.error("Facebook SDK not loaded yet. Please refresh or check your connection.");
        return;
    }

    if (!import.meta.env.VITE_FACEBOOK_APP_ID) {
        toast.warning("Facebook App ID not configured. Please set VITE_FACEBOOK_APP_ID in your environment variables.");
    }

    setConnecting(true);
    window.FB.login(async function(response: any) {
      if (response.authResponse) {
        console.log('Successfully logged in, exchanging token...');
        const shortLivedToken = response.authResponse.accessToken;
        let finalToken = shortLivedToken;

        // Exchange for Long-Lived Token via Backend
        try {
            const exchangeResponse = await fetch('http://localhost:3001/api/auth/facebook/exchange-token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ shortLivedToken })
            });
            const exchangeData = await exchangeResponse.json();
            
            if (exchangeData.access_token) {
                console.log('Obtained long-lived token');
                finalToken = exchangeData.access_token;
            } else {
                console.warn('Failed to exchange token, using short-lived one:', exchangeData.error);
                toast.warning("Using short-lived token (1 hour). Configure backend secrets for 60-day token.");
            }
        } catch (err) {
            console.error('Error contacting backend for token exchange:', err);
            toast.warning("Backend connection failed. Using short-lived token.");
        }
        
        // Fetch User's Pages using the (hopefully) Long-Lived Token
        window.FB.api('/me/accounts', 'get', { access_token: finalToken }, function(pageResponse: any) {
          console.log('Pages fetched:', pageResponse);
          if (pageResponse && pageResponse.data) {
             savePagesToSupabase(pageResponse.data);
          } else {
             toast.error("No pages found or permission denied.");
             setConnecting(false);
          }
        });
      } else {
        console.log('User cancelled login or did not fully authorize.');
        setConnecting(false);
      }
    }, {scope: 'pages_show_list,pages_messaging,pages_read_engagement,pages_manage_metadata'});
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
                await subscribeAppToPage(page.id, page.access_token);
                console.log(`Subscribed app to page ${page.name}`);
              } catch (subError) {
                console.error(`Failed to subscribe app to page ${page.name}`, subError);
                toast.error(`Could not enable bot for ${page.name}. Check permissions.`);
                // Continue saving to DB even if subscription fails, but warn user
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

      setConnecting(false);
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
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" onClick={() => handleManage(page)}>
                        <Settings className="mr-2 h-4 w-4" />
                        Manage
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
