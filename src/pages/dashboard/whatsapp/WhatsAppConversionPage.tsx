import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { MessageSquare, RefreshCw, AlertCircle, Calendar as CalendarIcon, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Link } from "react-router-dom";
import { addDays, format, startOfDay, endOfDay, subDays, isWithinInterval, parseISO } from "date-fns";
import { DateRange } from "react-day-picker";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export default function WhatsAppConversionPage() {
  type WaChat = {
    id?: string | number;
    message_id?: string;
    timestamp: number | string;
    sender_id: string;
    text?: string;
    reply_by?: string;
    status?: string;
    token_usage?: number;
    model_used?: string;
  };
  const [messages, setMessages] = useState<WaChat[]>([]);
  const [loading, setLoading] = useState(false);
  const [filteredBotReplyCount, setFilteredBotReplyCount] = useState(0);
  const [allTimeBotReplies, setAllTimeBotReplies] = useState(0);
  const [filteredTokenCount, setFilteredTokenCount] = useState(0);
  const [allTimeTokenCount, setAllTimeTokenCount] = useState(0);
  const [tokenBreakdown, setTokenBreakdown] = useState<Record<string, number>>({});
  const [activeSessionName, setActiveSessionName] = useState<string | null>(null);
  const [expandedMessageIds, setExpandedMessageIds] = useState<Set<string | number>>(new Set());

  const toggleExpand = (id: string | number) => {
    const newSet = new Set(expandedMessageIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setExpandedMessageIds(newSet);
  };
  
  // Date Filter State
  const [date, setDate] = useState<DateRange | undefined>({
    from: startOfDay(new Date()),
    to: endOfDay(new Date()),
  });
  const [filterType, setFilterType] = useState("today");

  useEffect(() => {
    const checkConnection = () => {
        const storedSessionName = localStorage.getItem("active_wa_session_id");
        setActiveSessionName(storedSessionName);
        if (storedSessionName) {
            fetchStats(storedSessionName);
        } else {
            // Fallback: If no session name but we have a DB ID, maybe we can fetch the session name?
            // This happens if the user refreshes and SessionSelector hasn't run yet.
            const storedDbId = localStorage.getItem("active_wp_db_id");
            if (storedDbId) {
                // We can't easily fetch session name from DB ID here without a query.
                // Let's try to fetch it.
                fetchSessionNameFromId(storedDbId);
            }
        }
    };

    checkConnection();
    window.addEventListener("storage", checkConnection);
    window.addEventListener("db-connection-changed", checkConnection);

    return () => {
        window.removeEventListener("storage", checkConnection);
        window.removeEventListener("db-connection-changed", checkConnection);
    };
  }, []); // Fetch stats once on mount

  const fetchSessionNameFromId = async (id: string) => {
      try {
          const { data, error } = await supabase
              .from('whatsapp_message_database')
              .select('session_name')
              .eq('id', parseInt(id))
              .single();
          
          if (data && (data as any).session_name) {
              const sName = (data as any).session_name;
              localStorage.setItem("active_wa_session_id", sName); // Fix the missing key
              setActiveSessionName(sName);
              fetchStats(sName);
          }
      } catch (e) {
          console.error("Error recovering session name", e);
      }
  };


  useEffect(() => {
    // Fetch messages whenever date or sessionName changes
    if (activeSessionName && date?.from && date?.to) {
        fetchMessages(activeSessionName, date.from, date.to);
    }
  }, [activeSessionName, date]);

  const fetchMessages = async (sessionName: string, from: Date, to: Date) => {
    setLoading(true);
    try {
        const { data, error } = await supabase
            .from('whatsapp_chats')
            .select('*')
            .eq('session_name', sessionName)
            .gte('timestamp', from.getTime()) 
            .lte('timestamp', to.getTime()) 
            .order('timestamp', { ascending: false });

        if (error) throw error;

        // Count stats for selected range
        const rows: WaChat[] = (data as WaChat[]) || [];
        const botReplies = rows.filter(m => m.reply_by === 'bot').length || 0;
        setFilteredBotReplyCount(botReplies);

        const tokens = rows.reduce((acc, curr) => acc + (curr.token_usage || 0), 0) || 0;
        setFilteredTokenCount(tokens);

        setMessages(rows);
    } catch (error: any) {
        console.error("Error fetching messages:", error);
        toast.error("Failed to fetch messages: " + error.message);
    } finally {
        setLoading(false);
    }
  };

  const fetchStats = async (sessionName: string) => {
      try {
          // All time bot replies
          const { count, error: countError } = await supabase
              .from('whatsapp_chats')
              .select('*', { count: 'exact', head: true })
              .eq('session_name', sessionName)
              .eq('reply_by', 'bot');
          
          if (!countError) {
              setAllTimeBotReplies(count || 0);
          }

          // All time tokens
          const { data: tokenData, error: tokenError } = await supabase
              .from('whatsapp_chats')
              .select('token_usage')
              .eq('session_name', sessionName)
              .gt('token_usage', 0); // Only rows with tokens
          
          // @ts-ignore
          const tokenRows = (tokenData as { token_usage?: number }[]) || [];
          const totalTokens = tokenRows.reduce((acc, curr) => acc + (curr.token_usage || 0), 0) || 0;
          setAllTimeTokenCount(totalTokens);

      } catch (e) {
          console.error("Stats fetch error", e);
      }
  };

  const handleRefresh = () => {
    if (activeSessionName && date?.from && date?.to) {
        fetchMessages(activeSessionName, date.from, date.to);
        fetchStats(activeSessionName);
        toast.success("Refreshed data");
    }
  };

  const handleFilterChange = (value: string) => {
    setFilterType(value);
    const now = new Date();
    
    if (value === "today") {
      setDate({ from: startOfDay(now), to: endOfDay(now) });
    } else if (value === "yesterday") {
      const yesterday = subDays(now, 1);
      setDate({ from: startOfDay(yesterday), to: endOfDay(yesterday) });
    } else if (value === "last7") {
      setDate({ from: startOfDay(subDays(now, 6)), to: endOfDay(now) });
    } else if (value === "last30") {
      setDate({ from: startOfDay(subDays(now, 29)), to: endOfDay(now) });
    } else if (value === "custom") {
      // Keep current date or open calendar
    }
  };

  if (!activeSessionName) {
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
                <AlertTitle>No Session Active</AlertTitle>
                <AlertDescription>
                    Please select an active session in the <Link to="/dashboard/whatsapp/sessions" className="underline font-bold">Sessions</Link> page to view conversions.
                </AlertDescription>
            </Alert>
          </div>
      )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div>
                <h1 className="text-3xl font-bold tracking-tight">Conversion</h1>
                <p className="text-muted-foreground">
                Track user messages and bot automated replies for Session: <span className="font-mono text-xs bg-muted px-1 py-0.5 rounded">{activeSessionName}</span>
                </p>
            </div>
            
            <div className="flex items-center gap-2 w-full sm:w-auto">
                <Select value={filterType} onValueChange={handleFilterChange}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="Select period" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="today">Today</SelectItem>
                    <SelectItem value="yesterday">Yesterday</SelectItem>
                    <SelectItem value="last7">Last 7 Days</SelectItem>
                    <SelectItem value="last30">Last 30 Days</SelectItem>
                    <SelectItem value="custom">Custom Range</SelectItem>
                  </SelectContent>
                </Select>

                {filterType === 'custom' && (
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant={"outline"}
                        className={cn(
                          "w-[240px] justify-start text-left font-normal",
                          !date && "text-muted-foreground"
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {date?.from ? (
                          date.to ? (
                            <>
                              {format(date.from, "LLL dd, y")} -{" "}
                              {format(date.to, "LLL dd, y")}
                            </>
                          ) : (
                            format(date.from, "LLL dd, y")
                          )
                        ) : (
                          <span>Pick a date</span>
                        )}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        initialFocus
                        mode="range"
                        defaultMonth={date?.from}
                        selected={date}
                        onSelect={setDate}
                        numberOfMonths={2}
                      />
                    </PopoverContent>
                  </Popover>
                )}

                <Button variant="outline" size="icon" onClick={handleRefresh}>
                    <RefreshCw className="h-4 w-4" />
                </Button>
            </div>
        </div>

        {/* Stats Cards */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">All Time Bot Replies</CardTitle>
              <MessageSquare className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{allTimeBotReplies}</div>
              <p className="text-xs text-muted-foreground">
                Total lifetime bot replies
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Bot Replies (Filtered)</CardTitle>
              <MessageSquare className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{filteredBotReplyCount}</div>
              <p className="text-xs text-muted-foreground">
                Replies in selected range
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">All Time Tokens</CardTitle>
              <Zap className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{allTimeTokenCount.toLocaleString()}</div>
              <p className="text-xs text-muted-foreground">
                Total tokens consumed
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Tokens (Filtered)</CardTitle>
              <Zap className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{filteredTokenCount.toLocaleString()}</div>
              <p className="text-xs text-muted-foreground">
                Tokens in selected range
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Message History</CardTitle>
          <CardDescription>Recent messages from users and bot replies.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Sender ID</TableHead>
                <TableHead>Message</TableHead>
                <TableHead>Reply By</TableHead>
                <TableHead>Usage (Tokens/Model)</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && messages.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center">Loading...</TableCell>
                </TableRow>
              ) : messages.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center">No messages found for this session</TableCell>
                </TableRow>
              ) : (
                messages.map((msg) => (
                  <TableRow key={msg.id || msg.message_id}>
                    <TableCell>{new Date(msg.timestamp).toLocaleString()}</TableCell>
                    <TableCell className="font-mono text-xs">{msg.sender_id}</TableCell>
                    <TableCell 
                        className={`max-w-[300px] cursor-pointer transition-all text-blue-600 dark:text-blue-400 hover:underline ${expandedMessageIds.has(msg.id || msg.message_id || 'unknown') ? 'whitespace-pre-wrap break-words' : 'truncate'}`} 
                        title="Click to expand"
                        onClick={() => toggleExpand(msg.id || msg.message_id || 'unknown')}
                    >
                        {msg.text}
                        {expandedMessageIds.has(msg.id || msg.message_id || 'unknown') && msg.model_used && (
                             <div className="text-[10px] text-muted-foreground mt-1">
                                 {msg.model_used}
                             </div>
                        )}
                    </TableCell>
                    <TableCell>
                      <span className={`px-2 py-1 rounded-full text-xs ${msg.reply_by === 'bot' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300' : 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300'}`}>
                        {msg.reply_by || 'Unknown'}
                      </span>
                    </TableCell>
                    <TableCell>
                        <div className="flex flex-col">
                            <span className="font-bold">{msg.token_usage || 0}</span>
                            <span className="text-[10px] text-muted-foreground truncate max-w-[150px]" title={msg.model_used}>
                                {msg.model_used || '-'}
                            </span>
                        </div>
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
