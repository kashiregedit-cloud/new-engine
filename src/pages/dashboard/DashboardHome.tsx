import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link, useParams } from "react-router-dom";
import {
  MessageSquare,
  Users,
  Settings,
  Plus,
  Zap,
  ExternalLink,
  Smartphone,
  Package,
  Megaphone,
  CreditCard
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export default function DashboardHome() {
  const { platform } = useParams();
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [stats, setStats] = useState({
    sessions: 0,
    messages: 0,
    active: false
  });

  const isWhatsApp = platform === 'whatsapp';
  const platformName = platform ? platform.charAt(0).toUpperCase() + platform.slice(1) : 'Platform';

  useEffect(() => {
    async function getUser() {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setUserEmail(user.email);
        
        if (isWhatsApp) {
          // Fetch simple stats for WhatsApp (Only user's sessions)
          const { count: sessionCount } = await supabase
            .from('whatsapp_sessions')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', user.id);
            
          setStats(prev => ({ ...prev, sessions: sessionCount || 0 }));
        } else if (platform === 'messenger') {
            // Fetch connected pages for Messenger
            let targetEmail = user.email;
            
            // Check if team member
            const { data: teamData } = await (supabase
                .from('team_members') as any)
                .select('owner_email')
                .eq('member_email', user.email)
                .maybeSingle();

            if (teamData) {
                targetEmail = teamData.owner_email;
            }

            const { count: pageCount } = await supabase
                .from('page_access_token_message')
                .select('*', { count: 'exact', head: true })
                .eq('email', targetEmail)
                .in('subscription_status', ['active', 'trial']);
            
            setStats(prev => ({ ...prev, sessions: pageCount || 0 }));
        }
      }
    }
    getUser();
  }, [isWhatsApp, platform]);

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Welcome Section */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            Welcome to {platformName} Dashboard
          </h1>
          <p className="text-muted-foreground mt-1">
            {userEmail ? `Logged in as ${userEmail}` : 'Manage your automation empire'}
          </p>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        <Card className="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-950/20 dark:to-indigo-950/20 border-blue-100 dark:border-blue-900">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-blue-600 dark:text-blue-400 uppercase tracking-wider">
              {isWhatsApp ? 'Total Sessions' : 'Connected Pages'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold text-foreground">{stats.sessions}</div>
            <p className="text-xs text-muted-foreground mt-1">Total {platformName} Sessions</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-950/20 dark:to-emerald-950/20 border-green-100 dark:border-green-900">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-green-600 dark:text-green-400 uppercase tracking-wider">
              System Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <div className="h-3 w-3 rounded-full bg-green-500 animate-pulse" />
              <span className="text-2xl font-bold text-foreground">Operational</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">All systems normal</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-purple-50 to-pink-50 dark:from-purple-950/20 dark:to-pink-950/20 border-purple-100 dark:border-purple-900">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-purple-600 dark:text-purple-400 uppercase tracking-wider">
              AI Provider
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">Active</div>
            <p className="text-xs text-muted-foreground mt-1">Smart replies enabled</p>
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions Grid */}
      <div>
        <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
          <Zap className="h-5 w-5 text-yellow-500" />
          Quick Actions
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <Link to={`/dashboard/${platform}/sessions`} className="group">
            <Card className="h-full hover:shadow-md transition-all border-l-4 border-l-green-500 cursor-pointer">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 group-hover:text-primary transition-colors">
                  <Smartphone className="h-5 w-5" />
                  Connect {platformName}
                </CardTitle>
                <CardDescription>
                  {isWhatsApp ? 'Scan QR code to connect new numbers' : 'Connect your pages'}
                </CardDescription>
              </CardHeader>
            </Card>
          </Link>

          <Link to={`/dashboard/${platform}/control`} className="group">
            <Card className="h-full hover:shadow-md transition-all border-l-4 border-l-blue-500 cursor-pointer">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 group-hover:text-primary transition-colors">
                  <Settings className="h-5 w-5" />
                  Configure Bot
                </CardTitle>
                <CardDescription>
                  Toggle Auto-Reply, Media, and AI settings
                </CardDescription>
              </CardHeader>
            </Card>
          </Link>

          <Link to={`/dashboard/${platform}/settings`} className="group">
            <Card className="h-full hover:shadow-md transition-all border-l-4 border-l-purple-500 cursor-pointer">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 group-hover:text-primary transition-colors">
                  <MessageSquare className="h-5 w-5" />
                  AI Intelligence
                </CardTitle>
                <CardDescription>
                  Change AI provider (GPT, Gemini, Claude)
                </CardDescription>
              </CardHeader>
            </Card>
          </Link>
        </div>
      </div>

      {/* Global Tools Section */}
      <div>
        <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
          <Package className="h-5 w-5 text-blue-500" />
          Global Tools
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <Link to={`/dashboard/${platform}/products`} className="group">
            <Card className="h-full hover:shadow-md transition-all border-t-4 border-t-blue-500 cursor-pointer">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 group-hover:text-primary transition-colors text-base">
                  <Package className="h-5 w-5" />
                  Product Entry
                </CardTitle>
                <CardDescription>Manage your product inventory</CardDescription>
              </CardHeader>
            </Card>
          </Link>
          
          <Link to={`/dashboard/${platform}/ads`} className="group">
            <Card className="h-full hover:shadow-md transition-all border-t-4 border-t-orange-500 cursor-pointer">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 group-hover:text-primary transition-colors text-base">
                  <Megaphone className="h-5 w-5" />
                  Ads Library
                </CardTitle>
                <CardDescription>Manage your ad campaigns</CardDescription>
              </CardHeader>
            </Card>
          </Link>

          <Link to={`/dashboard/${platform}/reseller`} className="group">
            <Card className="h-full hover:shadow-md transition-all border-t-4 border-t-purple-500 cursor-pointer">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 group-hover:text-primary transition-colors text-base">
                  <Users className="h-5 w-5" />
                  Reseller
                </CardTitle>
                <CardDescription>Manage reseller accounts</CardDescription>
              </CardHeader>
            </Card>
          </Link>

          <Link to={`/dashboard/${platform}/payment`} className="group">
            <Card className="h-full hover:shadow-md transition-all border-t-4 border-t-green-500 cursor-pointer">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 group-hover:text-primary transition-colors text-base">
                  <CreditCard className="h-5 w-5" />
                  Payment / Topup
                </CardTitle>
                <CardDescription>Manage payments and billing</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        </div>
      </div>
    </div>
  );
}
