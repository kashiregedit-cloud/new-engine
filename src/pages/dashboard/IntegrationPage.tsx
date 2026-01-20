import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { MessageSquare, Instagram, Facebook, Plus, Settings, RefreshCw } from "lucide-react";

const integrations = [
  {
    id: "whatsapp",
    name: "WhatsApp Business",
    description: "Connect your WhatsApp Business account to handle messages",
    icon: MessageSquare,
    color: "bg-chart-3",
    connected: true,
    status: "Active",
  },
  {
    id: "messenger",
    name: "Facebook Messenger",
    description: "Integrate with Facebook Messenger for customer support",
    icon: Facebook,
    color: "bg-chart-2",
    connected: true,
    status: "Active",
  },
  {
    id: "instagram",
    name: "Instagram DM",
    description: "Connect Instagram Direct Messages to your chatbot",
    icon: Instagram,
    color: "bg-chart-5",
    connected: false,
    status: "Disconnected",
  },
];

export default function IntegrationPage() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Integrations</h2>
          <p className="text-muted-foreground">
            Connect your social media accounts and messaging platforms
          </p>
        </div>
        <Button className="gap-2">
          <Plus size={18} />
          Add Integration
        </Button>
      </div>

      {/* Integration Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {integrations.map((integration) => (
          <Card key={integration.id} className="bg-card border-border">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div className={`p-3 rounded-lg ${integration.color}`}>
                  <integration.icon className="h-6 w-6 text-primary-foreground" />
                </div>
                <Badge
                  variant={integration.connected ? "default" : "secondary"}
                  className={integration.connected ? "bg-chart-3 hover:bg-chart-3" : ""}
                >
                  {integration.status}
                </Badge>
              </div>
              <CardTitle className="text-lg mt-4">{integration.name}</CardTitle>
              <CardDescription>{integration.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between pt-2 border-t border-border">
                <div className="flex items-center gap-2">
                  <Switch checked={integration.connected} />
                  <span className="text-sm text-muted-foreground">
                    {integration.connected ? "Enabled" : "Disabled"}
                  </span>
                </div>
                <div className="flex gap-2">
                  <Button variant="ghost" size="icon">
                    <RefreshCw size={16} />
                  </Button>
                  <Button variant="ghost" size="icon">
                    <Settings size={16} />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Integration Guide */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle>Integration Guide</CardTitle>
          <CardDescription>
            Learn how to connect your accounts
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="p-4 rounded-lg bg-secondary">
              <h4 className="font-medium text-foreground mb-2">Step 1: Select Platform</h4>
              <p className="text-sm text-muted-foreground">
                Choose the messaging platform you want to integrate with your chatbot.
              </p>
            </div>
            <div className="p-4 rounded-lg bg-secondary">
              <h4 className="font-medium text-foreground mb-2">Step 2: Authenticate</h4>
              <p className="text-sm text-muted-foreground">
                Log in to your account and authorize access to your messages.
              </p>
            </div>
            <div className="p-4 rounded-lg bg-secondary">
              <h4 className="font-medium text-foreground mb-2">Step 3: Configure</h4>
              <p className="text-sm text-muted-foreground">
                Set up auto-replies, keywords, and conversation flows.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
