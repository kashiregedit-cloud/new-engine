import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MessageSquare, Facebook, Instagram, ArrowRight, Zap, Activity, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { BACKEND_URL } from "@/config";

export default function PlatformSelection() {
  const navigate = useNavigate();
  const [userName, setUserName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeSessions, setActiveSessions] = useState<number | string>("--");

  useEffect(() => {
    async function getUser() {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        // Try to get full name from metadata or fallback to email
        const fullName = user.user_metadata?.full_name;
        setUserName(fullName || user.email?.split('@')[0] || "User");
      }
      setLoading(false);
    }
    getUser();

    // Fetch Global Active Sessions
    async function fetchStats() {
        try {
            const res = await fetch(`${BACKEND_URL}/stats/total-sessions`);
            if (res.ok) {
                const data = await res.json();
                setActiveSessions(data.count);
            }
        } catch (e) {
            console.error("Failed to fetch global stats", e);
        }
    }
    fetchStats();
  }, []);

  const platforms = [
    {
      id: "whatsapp",
      name: "WhatsApp Business",
      description: "Automate conversations, send broadcasts, and manage customer support on WhatsApp.",
      icon: MessageSquare,
      color: "bg-green-500",
      stats: "Active",
      action: "Manage"
    },
    {
      id: "messenger",
      name: "Facebook Messenger",
      description: "Connect with customers on Facebook with automated replies and order tracking.",
      icon: Facebook,
      color: "bg-blue-600",
      stats: "Active",
      action: "Manage"
    },
    {
      id: "instagram",
      name: "Instagram Direct",
      description: "Handle DM inquiries, story replies, and boost engagement automatically.",
      icon: Instagram,
      color: "bg-gradient-to-tr from-yellow-400 via-red-500 to-purple-500",
      stats: "Coming Soon",
      action: "Connect"
    },
  ];

  return (
    <div className="space-y-8 animate-fade-in pb-10">
      {/* Hero Section */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-primary/10 via-primary/5 to-background p-8 md:p-12 border border-primary/10">
        <div className="relative z-10 max-w-2xl">
          <div className="inline-flex items-center rounded-full border border-primary/20 bg-background/50 px-3 py-1 text-sm font-medium text-primary backdrop-blur-sm mb-4">
            <Zap className="mr-2 h-3.5 w-3.5 fill-primary" />
            <span>Multi-Channel Automation</span>
          </div>
          <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl mb-4">
            Welcome back, {loading ? "..." : userName}
          </h1>
          <p className="text-lg text-muted-foreground mb-8">
            Manage all your customer conversations in one place. Select a platform below to get started with your automation journey.
          </p>
          <div className="flex flex-wrap gap-4">
            <Button size="lg" onClick={() => navigate('/dashboard/whatsapp/sessions')}>
              Go to WhatsApp <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
            <Button variant="outline" size="lg">
              View Documentation
            </Button>
          </div>
        </div>
        
        {/* Decorative background elements */}
        <div className="absolute right-0 top-0 h-full w-1/3 bg-gradient-to-l from-primary/5 to-transparent opacity-50" />
        <div className="absolute -right-20 -top-20 h-96 w-96 rounded-full bg-primary/10 blur-3xl" />
      </div>

      {/* Stats/Overview Section */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card className="bg-card/50 backdrop-blur-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">System Status</CardTitle>
            <Activity className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">Operational</div>
            <p className="text-xs text-muted-foreground">All systems running smoothly</p>
          </CardContent>
        </Card>
        <Card className="bg-card/50 backdrop-blur-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Active Sessions</CardTitle>
            <ShieldCheck className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activeSessions}</div>
            <p className="text-xs text-muted-foreground">Across all platforms</p>
          </CardContent>
        </Card>
      </div>

      {/* Platforms Grid */}
      <div>
        <h2 className="text-2xl font-semibold tracking-tight mb-6">Your Platforms</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {platforms.map((platform) => (
            <Card 
              key={platform.id} 
              className="group relative overflow-hidden transition-all hover:shadow-lg border-muted/60"
            >
              <div className={`absolute inset-0 opacity-0 group-hover:opacity-5 transition-opacity ${platform.color} pointer-events-none`} />
              
              <CardHeader>
                <div className="flex items-center justify-between mb-2">
                  <div className={`p-3 rounded-xl text-white shadow-md ${platform.color}`}>
                    <platform.icon size={24} />
                  </div>
                  {['whatsapp', 'messenger'].includes(platform.id) ? (
                     <div className="flex items-center gap-1.5 rounded-full bg-green-500/10 px-2.5 py-0.5 text-xs font-medium text-green-600 dark:text-green-400">
                       <span className="relative flex h-2 w-2">
                         <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                         <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                       </span>
                       Active
                     </div>
                  ) : (
                    <div className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                      Coming Soon
                    </div>
                  )}
                </div>
                <CardTitle className="text-xl">{platform.name}</CardTitle>
                <CardDescription className="line-clamp-2 mt-2">
                  {platform.description}
                </CardDescription>
              </CardHeader>
              
              <CardFooter className="pt-2">
                <Button 
                  className="w-full group-hover:bg-primary group-hover:text-primary-foreground transition-colors" 
                  variant={['whatsapp', 'messenger'].includes(platform.id) ? "default" : "outline"}
                  onClick={() => {
                    if (platform.id === 'whatsapp') navigate('/dashboard/whatsapp/sessions');
                    else if (platform.id === 'messenger') navigate('/dashboard/messenger/integration');
                    else navigate(`/dashboard/${platform.id}`);
                  }}
                  disabled={!['whatsapp', 'messenger'].includes(platform.id)}
                >
                  {platform.action}
                  {['whatsapp', 'messenger'].includes(platform.id) && <ArrowRight className="ml-2 h-4 w-4" />}
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
