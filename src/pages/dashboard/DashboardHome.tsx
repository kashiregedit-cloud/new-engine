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
  Smartphone
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
          // Fetch simple stats for WhatsApp
          const { count: sessionCount } = await supabase.from('whatsapp_sessions').select('*', { count: 'exact', head: true });
          // @ts-ignore
          setStats(prev => ({ ...prev, sessions: sessionCount || 0 }));
        }
      }
    }
    getUser();
  }, [isWhatsApp]);

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
        <div className="flex gap-3">
          <Button asChild variant="outline">
            <Link to={`/dashboard/${platform}/settings`}>
              <Settings className="mr-2 h-4 w-4" />
              Settings
            </Link>
          </Button>
          <Button asChild>
            <Link to={`/dashboard/${platform}/${isWhatsApp ? 'sessions' : 'integration'}`}>
              <Plus className="mr-2 h-4 w-4" />
              {isWhatsApp ? 'New Session' : 'Connect Page'}
            </Link>
          </Button>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        <Card className="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-950/20 dark:to-indigo-950/20 border-blue-100 dark:border-blue-900">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-blue-600 dark:text-blue-400 uppercase tracking-wider">
              {isWhatsApp ? 'Active Sessions' : 'Connected Pages'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold text-foreground">{stats.sessions}</div>
            <p className="text-xs text-muted-foreground mt-1">Connected {platformName} Accounts</p>
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
          <Link to="/dashboard/whatsapp/sessions" className="group">
            <Card className="h-full hover:shadow-md transition-all border-l-4 border-l-green-500 cursor-pointer">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 group-hover:text-primary transition-colors">
                  <Smartphone className="h-5 w-5" />
                  Connect WhatsApp
                </CardTitle>
                <CardDescription>
                  Scan QR code to connect new numbers
                </CardDescription>
              </CardHeader>
            </Card>
          </Link>

          <Link to="/dashboard/whatsapp/control" className="group">
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

          <Link to="/dashboard/whatsapp/settings" className="group">
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
    </div>
  );
}
