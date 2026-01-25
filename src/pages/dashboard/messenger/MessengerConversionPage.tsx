import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { MessageSquare, RefreshCw, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Link } from "react-router-dom";

export default function MessengerConversionPage() {
  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [botReplyCount, setBotReplyCount] = useState(0);
  const [activePageId, setActivePageId] = useState<string | null>(null);

  useEffect(() => {
    const storedPageId = localStorage.getItem("active_fb_page_id");
    setActivePageId(storedPageId);
    if (storedPageId) {
        fetchMessages(storedPageId);
    }
  }, []);

  const fetchMessages = async (pageId: string) => {
    setLoading(true);
    try {
      // @ts-ignore
      const { data, error } = await supabase
        .from('fb_chats')
        .select('*')
        .eq('page_id', pageId)
        .order('id', { ascending: false });

      if (error) throw error;

      setMessages(data || []);
      
      // Calculate bot replies
      const botReplies = data?.filter((msg: any) => msg.reply_by === 'bot').length || 0;
      setBotReplyCount(botReplies);

    } catch (error) {
      console.error("Error fetching messages:", error);
      toast.error("Failed to fetch messages");
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = () => {
    const storedPageId = localStorage.getItem("active_fb_page_id");
    if (storedPageId) {
        fetchMessages(storedPageId);
    } else {
        toast.error("No active page found. Please connect a database.");
    }
  };

  if (!activePageId) {
      return (
          <div className="space-y-6">
              <div>
                <h1 className="text-3xl font-bold tracking-tight">Conversion</h1>
                <p className="text-muted-foreground">
                Track user messages and bot automated replies.
                </p>
            </div>
            <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>No Database Connected</AlertTitle>
                <AlertDescription>
                    Please connect a database in the <Link to="/dashboard/messenger/database" className="underline font-bold">Database Connect</Link> page to view conversions.
                </AlertDescription>
            </Alert>
          </div>
      )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
            <div>
                <h1 className="text-3xl font-bold tracking-tight">Conversion</h1>
                <p className="text-muted-foreground">
                Track user messages and bot automated replies for Page ID: <span className="font-mono text-xs bg-muted px-1 py-0.5 rounded">{activePageId}</span>
                </p>
            </div>
            <Button onClick={handleRefresh} disabled={loading} variant="outline" size="icon">
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Bot Replies</CardTitle>
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{botReplyCount}</div>
            <p className="text-xs text-muted-foreground">
              Automated responses sent
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Message History</CardTitle>
          <CardDescription>
            Recent messages from users and bot replies.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Sender ID</TableHead>
                <TableHead>Message</TableHead>
                <TableHead>Reply By</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && messages.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center">Loading...</TableCell>
                </TableRow>
              ) : messages.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center">No messages found for this page</TableCell>
                </TableRow>
              ) : (
                messages.map((msg) => (
                  <TableRow key={msg.id}>
                    <TableCell>{new Date(msg.created_at).toLocaleString()}</TableCell>
                    <TableCell className="font-mono text-xs">{msg.sender_id}</TableCell>
                    <TableCell className="max-w-[300px] truncate" title={msg.text}>{msg.text}</TableCell>
                    <TableCell>
                      <span className={`px-2 py-1 rounded-full text-xs ${msg.reply_by === 'bot' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300' : 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300'}`}>
                        {msg.reply_by || 'Unknown'}
                      </span>
                    </TableCell>
                    <TableCell>
                        <span className={`px-2 py-1 rounded-full text-xs ${msg.status === 'sent' ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300' : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300'}`}>
                            {msg.status}
                        </span>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
