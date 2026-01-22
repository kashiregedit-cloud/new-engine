import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Mail, Shield, User } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export default function ProfilePage() {
  const [user, setUser] = useState<{ email?: string; id?: string } | null>(null);

  useEffect(() => {
    const getUser = async () => {
      const { data } = await supabase.auth.getUser();
      if (data.user) {
        setUser({ email: data.user.email, id: data.user.id });
      }
    };
    getUser();
  }, []);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-foreground">Profile</h2>
        <p className="text-muted-foreground">
          View your account information
        </p>
      </div>

      <div className="flex justify-center">
        {/* Profile Card */}
        <Card className="bg-card border-border w-full max-w-md">
          <CardContent className="pt-8 pb-8">
            <div className="flex flex-col items-center text-center">
              <div className="relative mb-4">
                <Avatar className="h-24 w-24 border-4 border-background shadow-xl">
                  <AvatarImage src="" />
                  <AvatarFallback className="bg-primary text-primary-foreground text-3xl font-bold">
                    {user?.email?.charAt(0).toUpperCase() || "U"}
                  </AvatarFallback>
                </Avatar>
              </div>
              
              <h3 className="text-xl font-bold text-foreground">
                {user?.email?.split("@")[0] || "User"}
              </h3>
              <p className="text-sm text-muted-foreground mb-4">{user?.email}</p>
              
              <Badge variant="secondary" className="mb-8 px-4 py-1">
                Verified Account
              </Badge>
              
              <div className="w-full space-y-4 text-left">
                <div className="flex items-center p-4 bg-muted/50 rounded-xl gap-4 transition-colors hover:bg-muted">
                  <div className="p-2 bg-background rounded-full shadow-sm">
                    <User className="text-blue-500 h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Name</p>
                    <p className="text-sm font-semibold truncate">
                      {user?.email?.split("@")[0] || "User"}
                    </p>
                  </div>
                </div>

                <div className="flex items-center p-4 bg-muted/50 rounded-xl gap-4 transition-colors hover:bg-muted">
                  <div className="p-2 bg-background rounded-full shadow-sm">
                    <Mail className="text-green-500 h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Email Address</p>
                    <p className="text-sm font-semibold truncate">
                      {user?.email}
                    </p>
                  </div>
                </div>
                
                <div className="flex items-center p-4 bg-muted/50 rounded-xl gap-4 transition-colors hover:bg-muted">
                   <div className="p-2 bg-background rounded-full shadow-sm">
                    <Shield className="text-purple-500 h-5 w-5" />
                   </div>
                   <div className="flex-1 min-w-0">
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Account ID</p>
                    <p className="text-xs font-mono text-muted-foreground truncate">
                      {user?.id}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
