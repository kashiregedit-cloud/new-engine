import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Mail, Shield, User, Users, Trash2, Plus, AlertCircle, UserPlus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default function ProfilePage() {
  const [user, setUser] = useState<{ email?: string; id?: string } | null>(null);
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [newMemberEmail, setNewMemberEmail] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const getUser = async () => {
      const { data } = await supabase.auth.getUser();
      if (data.user) {
        setUser({ email: data.user.email, id: data.user.id });
        fetchTeamMembers(data.user.email || "");
      }
    };
    getUser();
  }, []);

  const fetchTeamMembers = async (email: string) => {
    if (!email) return;
    const { data, error } = await (supabase
      .from('team_members') as any)
      .select('*')
      .eq('owner_email', email);
    
    if (error) {
      console.error('Error fetching team:', error);
    } else {
      setTeamMembers(data || []);
    }
  };

  const handleAddMember = async () => {
    if (!newMemberEmail || !user?.email) return;
    
    if (teamMembers.length >= 3) {
      toast.error("Maximum 3 team members allowed");
      return;
    }

    if (newMemberEmail.toLowerCase() === user.email.toLowerCase()) {
      toast.error("You cannot add yourself");
      return;
    }

    const exists = teamMembers.some(m => m.member_email.toLowerCase() === newMemberEmail.toLowerCase());
    if (exists) {
      toast.error("User is already in your team");
      return;
    }

    setLoading(true);
    const { error } = await (supabase.from('team_members') as any).insert({
      owner_email: user.email,
      member_email: newMemberEmail.toLowerCase(),
      status: 'active'
    });

    if (error) {
      toast.error("Failed to add member: " + error.message);
    } else {
      toast.success("Team member added successfully");
      setNewMemberEmail("");
      fetchTeamMembers(user.email);
    }
    setLoading(false);
  };

  const handleRemoveMember = async (id: string) => {
    const { error } = await (supabase.from('team_members') as any).delete().eq('id', id);
    if (error) {
      toast.error("Failed to remove member");
    } else {
      toast.success("Member removed");
      if (user?.email) fetchTeamMembers(user.email);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-foreground">Profile & Team</h2>
        <p className="text-muted-foreground">
          Manage your account and team members
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Profile Card */}
        <Card className="bg-card border-border">
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

        {/* Team Management Card */}
        <Card className="bg-card border-border h-fit">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Team Management</CardTitle>
                <CardDescription>Share your account access (Max 3 members)</CardDescription>
              </div>
              <Badge variant={teamMembers.length >= 3 ? "destructive" : "secondary"}>
                {teamMembers.length}/3 Members
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            
            {/* Add Member Form */}
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Mail className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Enter member email"
                  type="email"
                  className="pl-9"
                  value={newMemberEmail}
                  onChange={(e) => setNewMemberEmail(e.target.value)}
                />
              </div>
              <Button onClick={handleAddMember} disabled={loading || teamMembers.length >= 3}>
                <UserPlus className="h-4 w-4 mr-2" />
                Add
              </Button>
            </div>

            {/* Members List */}
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Member Email</TableHead>
                    <TableHead className="w-[100px] text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {teamMembers.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={2} className="text-center text-muted-foreground py-8">
                        No team members added yet
                      </TableCell>
                    </TableRow>
                  ) : (
                    teamMembers.map((member) => (
                      <TableRow key={member.id}>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center">
                              <User className="h-4 w-4 text-muted-foreground" />
                            </div>
                            {member.member_email}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-red-500 hover:text-red-600 hover:bg-red-50"
                            onClick={() => handleRemoveMember(member.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

            <div className="bg-blue-50 p-4 rounded-lg flex gap-3 text-blue-700 text-sm">
              <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
              <p>
                Team members can access your Facebook pages, messages, and automation settings. They cannot delete your account.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
