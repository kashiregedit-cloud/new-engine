import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Bot, MessageSquare, Clock, Zap, Shield, Bell } from "lucide-react";

export default function ControlPage() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-foreground">Control Page</h2>
        <p className="text-muted-foreground">
          Configure your chatbot behavior and automation settings
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Bot Settings */}
        <Card className="bg-card border-border">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Bot className="h-5 w-5 text-primary" />
              <CardTitle>Bot Settings</CardTitle>
            </div>
            <CardDescription>Configure chatbot behavior</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Auto Reply</Label>
                <p className="text-sm text-muted-foreground">
                  Automatically respond to messages
                </p>
              </div>
              <Switch defaultChecked />
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>AI Powered Responses</Label>
                <p className="text-sm text-muted-foreground">
                  Use AI to generate smart replies
                </p>
              </div>
              <Switch defaultChecked />
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Order Detection</Label>
                <p className="text-sm text-muted-foreground">
                  Automatically detect and process orders
                </p>
              </div>
              <Switch defaultChecked />
            </div>
          </CardContent>
        </Card>

        {/* Response Settings */}
        <Card className="bg-card border-border">
          <CardHeader>
            <div className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-primary" />
              <CardTitle>Response Settings</CardTitle>
            </div>
            <CardDescription>Customize message responses</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label>Response Language</Label>
              <Select defaultValue="bn">
                <SelectTrigger>
                  <SelectValue placeholder="Select language" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bn">বাংলা (Bengali)</SelectItem>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="hi">हिंदी (Hindi)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Response Tone</Label>
              <Select defaultValue="professional">
                <SelectTrigger>
                  <SelectValue placeholder="Select tone" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="professional">Professional</SelectItem>
                  <SelectItem value="friendly">Friendly</SelectItem>
                  <SelectItem value="casual">Casual</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Timing Settings */}
        <Card className="bg-card border-border">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-primary" />
              <CardTitle>Timing Settings</CardTitle>
            </div>
            <CardDescription>Configure response timing</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-4">
              <div className="flex justify-between">
                <Label>Response Delay (seconds)</Label>
                <span className="text-sm text-muted-foreground">3s</span>
              </div>
              <Slider defaultValue={[3]} max={10} step={1} />
            </div>
            <div className="space-y-4">
              <div className="flex justify-between">
                <Label>Typing Indicator Duration</Label>
                <span className="text-sm text-muted-foreground">2s</span>
              </div>
              <Slider defaultValue={[2]} max={5} step={1} />
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Business Hours Only</Label>
                <p className="text-sm text-muted-foreground">
                  Respond only during business hours
                </p>
              </div>
              <Switch />
            </div>
          </CardContent>
        </Card>

        {/* Automation */}
        <Card className="bg-card border-border">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-primary" />
              <CardTitle>Automation</CardTitle>
            </div>
            <CardDescription>Set up automated workflows</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Auto-assign Conversations</Label>
                <p className="text-sm text-muted-foreground">
                  Distribute conversations to team members
                </p>
              </div>
              <Switch />
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Auto-close Inactive Chats</Label>
                <p className="text-sm text-muted-foreground">
                  Close chats after 24 hours of inactivity
                </p>
              </div>
              <Switch defaultChecked />
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Send Follow-up Messages</Label>
                <p className="text-sm text-muted-foreground">
                  Automatically send follow-up after orders
                </p>
              </div>
              <Switch defaultChecked />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Welcome Message */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle>Welcome Message Template</CardTitle>
          <CardDescription>
            This message will be sent when a new conversation starts
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Textarea
            placeholder="Enter your welcome message..."
            defaultValue="আস্সালামু আলাইকুম! 👋 Service Hub BD তে স্বাগতম। আমরা আপনাকে কিভাবে সাহায্য করতে পারি?"
            rows={4}
          />
          <div className="flex gap-2">
            <Button>Save Template</Button>
            <Button variant="outline">Preview</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
