import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  MessageSquare,
  Users,
  ShoppingCart,
  TrendingUp,
  Activity,
  Clock,
} from "lucide-react";

const stats = [
  {
    title: "Total Messages",
    value: "12,543",
    change: "+12.5%",
    icon: MessageSquare,
    color: "text-primary",
  },
  {
    title: "Active Users",
    value: "2,345",
    change: "+8.2%",
    icon: Users,
    color: "text-chart-2",
  },
  {
    title: "Orders Today",
    value: "156",
    change: "+23.1%",
    icon: ShoppingCart,
    color: "text-chart-3",
  },
  {
    title: "Conversion Rate",
    value: "3.2%",
    change: "+2.4%",
    icon: TrendingUp,
    color: "text-chart-4",
  },
];

const recentActivities = [
  { action: "New order received", time: "2 mins ago", icon: ShoppingCart },
  { action: "New user registered", time: "5 mins ago", icon: Users },
  { action: "Message replied", time: "10 mins ago", icon: MessageSquare },
  { action: "Product updated", time: "15 mins ago", icon: Activity },
  { action: "Integration connected", time: "30 mins ago", icon: Activity },
];

export default function DashboardHome() {
  return (
    <div className="space-y-6">
      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6">
        {stats.map((stat) => (
          <Card key={stat.title} className="bg-card border-border">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {stat.title}
              </CardTitle>
              <stat.icon className={`h-5 w-5 ${stat.color}`} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-foreground">{stat.value}</div>
              <p className="text-xs text-chart-3 mt-1">{stat.change} from last month</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Chart Placeholder */}
        <Card className="lg:col-span-2 bg-card border-border">
          <CardHeader>
            <CardTitle className="text-foreground">Analytics Overview</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64 flex items-center justify-center bg-secondary/30 rounded-lg">
              <div className="text-center text-muted-foreground">
                <Activity className="h-12 w-12 mx-auto mb-2 opacity-50" />
                <p>Chart data will appear here</p>
                <p className="text-sm">Connect integrations to see analytics</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Recent Activity */}
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-foreground">Recent Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {recentActivities.map((activity, index) => (
                <div key={index} className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-full bg-secondary flex items-center justify-center">
                    <activity.icon className="h-4 w-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {activity.action}
                    </p>
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {activity.time}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-foreground">Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            {[
              { label: "Add Integration", icon: "🔌" },
              { label: "Add Product", icon: "📦" },
              { label: "Create Ad", icon: "📢" },
              { label: "Add Reseller", icon: "👥" },
              { label: "View Reports", icon: "📊" },
              { label: "Settings", icon: "⚙️" },
            ].map((action) => (
              <button
                key={action.label}
                className="p-4 rounded-lg bg-secondary hover:bg-secondary/80 transition-colors text-center"
              >
                <span className="text-2xl block mb-2">{action.icon}</span>
                <span className="text-sm text-foreground">{action.label}</span>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
