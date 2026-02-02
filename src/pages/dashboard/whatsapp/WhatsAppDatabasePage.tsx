import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Database, Search, CheckCircle, XCircle, Loader2, LogOut } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export default function WhatsAppDatabasePage() {
  const [searchId, setSearchId] = useState("");
  const [loading, setLoading] = useState(false);
  const [connectedDb, setConnectedDb] = useState<any | null>(null);

  useEffect(() => {
    // Check if already connected
    const checkConnection = () => {
      const storedId = localStorage.getItem("active_wp_db_id");
      if (storedId) {
        setSearchId(storedId);
        fetchDatabase(storedId);
      } else {
        setConnectedDb(null);
        setSearchId("");
      }
    };

    checkConnection();

    // Listen for storage changes (from other tabs or same tab custom event)
    window.addEventListener("storage", checkConnection);
    window.addEventListener("db-connection-changed", checkConnection);

    return () => {
      window.removeEventListener("storage", checkConnection);
      window.removeEventListener("db-connection-changed", checkConnection);
    };
  }, []);

  const fetchDatabase = async (id: string) => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('wp_message_database')
        .select('*')
        .eq('id', parseInt(id))
        .single();

      if (error) throw error;
      
      if (data) {
        setConnectedDb(data);
        localStorage.setItem("active_wp_db_id", id);
      } else {
        toast.error("Database not found");
        localStorage.removeItem("active_wp_db_id");
        setConnectedDb(null);
      }
    } catch (error) {
      console.error("Error fetching DB:", error);
      // Only show error if explicitly searching (not on auto-load if ID is stale)
      toast.error("Database ID not found or connection failed");
      if (localStorage.getItem("active_wp_db_id") === id) {
          localStorage.removeItem("active_wp_db_id");
          setConnectedDb(null);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleConnect = () => {
    if (!searchId || searchId.length < 6) {
      toast.error("Please enter a valid 6-digit ID");
      return;
    }
    fetchDatabase(searchId);
  };

  const handleDisconnect = () => {
    localStorage.removeItem("active_wp_db_id");
    setConnectedDb(null);
    setSearchId("");
    toast.info("Disconnected from database");
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-foreground">Database Connect</h2>
        <p className="text-muted-foreground">
          Connect to your WhatsApp Message Database using your unique ID.
        </p>
      </div>

      {/* Connection Status Card */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-card border-border">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Status</p>
                <p className={`text-2xl font-bold ${connectedDb ? "text-green-500" : "text-slate-500"}`}>
                  {connectedDb ? "Connected" : "Disconnected"}
                </p>
              </div>
              {connectedDb ? (
                <CheckCircle className="h-8 w-8 text-green-500" />
              ) : (
                <XCircle className="h-8 w-8 text-slate-500" />
              )}
            </div>
          </CardContent>
        </Card>
        
        {connectedDb && (
             <Card className="bg-card border-border md:col-span-2">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Active Session</p>
                    <p className="text-xl font-bold text-foreground truncate max-w-[200px] md:max-w-md">
                      {connectedDb.session}
                    </p>
                    <div className="flex gap-2 mt-1">
                        <Badge variant={connectedDb.verified ? "default" : "destructive"}>
                            {connectedDb.verified ? "Verified" : "Unverified / Expired"}
                        </Badge>
                    </div>
                  </div>
                  <Database className="h-8 w-8 text-primary" />
                </div>
              </CardContent>
            </Card>
        )}
      </div>

      {/* Connect Form */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle>{connectedDb ? "Database Details" : "Connect to Database"}</CardTitle>
          <CardDescription>
            {connectedDb 
                ? `Connected to ID: ${connectedDb.id}` 
                : "Enter the 6-digit Database ID provided during session creation."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col md:flex-row gap-4 items-end">
            <div className="space-y-2 flex-1 w-full">
              <Label htmlFor="db-id">Database ID</Label>
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input 
                    id="db-id" 
                    placeholder="e.g. 123456" 
                    className="pl-9" 
                    value={searchId}
                    onChange={(e) => setSearchId(e.target.value)}
                    disabled={!!connectedDb}
                />
              </div>
            </div>
            
            {connectedDb ? (
                <Button variant="destructive" onClick={handleDisconnect} className="w-full md:w-auto">
                    <LogOut className="mr-2 h-4 w-4" />
                    Disconnect
                </Button>
            ) : (
                <Button onClick={handleConnect} disabled={loading} className="w-full md:w-auto min-w-[120px]">
                    {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Database className="mr-2 h-4 w-4" />}
                    Connect
                </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
