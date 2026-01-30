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

export default function MessengerConversionPage() {
  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [filteredBotReplyCount, setFilteredBotReplyCount] = useState(0);
  const [allTimeBotReplies, setAllTimeBotReplies] = useState(0);
  const [filteredTokenCount, setFilteredTokenCount] = useState(0);
  const [allTimeTokenCount, setAllTimeTokenCount] = useState(0);
  const [tokenBreakdown, setTokenBreakdown] = useState<Record<string, number>>({});
  const [activePageId, setActivePageId] = useState<string | null>(null);
  
  // Date Filter State
  const [date, setDate] = useState<DateRange | undefined>({
    from: startOfDay(new Date()),
    to: endOfDay(new Date()),
  });
  const [filterType, setFilterType] = useState("today");

  useEffect(() => {
    const storedPageId = localStorage.getItem("active_fb_page_id");
    setActivePageId(storedPageId);
    if (storedPageId) {
        fetchMessages(storedPageId);
    }
  }, []); // Fetch only once on mount or manual refresh

  useEffect(() => {
    // Calculate filtered counts when date or messages change
    if (messages.length > 0 && date?.from && date?.to) {
        const filtered = messages.filter(msg => {
            const msgDate = new Date(msg.created_at);
            return isWithinInterval(msgDate, {
                start: date.from!,
                end: date.to!
            });
        });

        const botReplies = filtered.filter((msg: any) => msg.reply_by === 'bot').length;
        setFilteredBotReplyCount(botReplies);
    } else if (messages.length > 0 && !date?.from) {
         // If no date selected, maybe show all? Or 0? 
         // Usually we default to today, so date is usually set.
         // If date is undefined, show 0 or all. Let's stick to 0 or maintain last state.
         // Actually initial state has Today set.
    }
  }, [date, messages]);

  const handleFilterChange = (value: string) => {
    setFilterType(value);
    const today = new Date();
    
    switch (value) {
        case "today":
            setDate({ from: startOfDay(today), to: endOfDay(today) });
            break;
        case "yesterday":
            const yesterday = subDays(today, 1);
            setDate({ from: startOfDay(yesterday), to: endOfDay(yesterday) });
            break;
        case "last7":
            setDate({ from: startOfDay(subDays(today, 7)), to: endOfDay(today) });
            break;
        case "custom":
            // Keep current date or reset to default
            break;
    }
  };

  const fetchMessages = async (pageId: string) => {
    setLoading(true);
    try {
      // Fetch ALL messages for the page
      let query = supabase
        .from('fb_chats')
        .select('*', { count: 'exact' })
        .eq('page_id', pageId)
        .order('created_at', { ascending: false });

      // @ts-ignore
      const { data, error, count } = await query;

      if (error) throw error;

      setMessages(data || []);
      
      // Calculate All Time Bot Replies
      const allBotReplies = data?.filter((msg: any) => msg.reply_by === 'bot').length || 0;
      setAllTimeBotReplies(allBotReplies);

      // Initial filter calculation will be handled by the useEffect dependent on 'messages'

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
      <div className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div>
                <h1 className="text-3xl font-bold tracking-tight">Conversion</h1>
                <p className="text-muted-foreground">
                Track user messages and bot automated replies for Page ID: <span className="font-mono text-xs bg-muted px-1 py-0.5 rounded">{activePageId}</span>
                </p>
            </div>
            
            <div className="flex items-center gap-2 w-full sm:w-auto">
                <Select value={filterType} onValueChange={handleFilterChange}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="Select Filter" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="today">Today</SelectItem>
                    <SelectItem value="yesterday">Yesterday</SelectItem>
                    <SelectItem value="last7">Last 7 Days</SelectItem>
                    <SelectItem value="custom">Custom Range</SelectItem>
                  </SelectContent>
                </Select>

                {filterType === 'custom' && (
                    <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        id="date"
                        variant={"outline"}
                        className={cn(
                          "w-[260px] justify-start text-left font-normal",
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
                    <PopoverContent className="w-auto p-0" align="end">
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

                <Button onClick={handleRefresh} disabled={loading} variant="outline" size="icon">
                    <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                </Button>
            </div>
        </div>
      </div>

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
            <TooltipProvider>
                <Tooltip>
                    <TooltipTrigger>
                        <Zap className="h-4 w-4 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent>
                        <p className="font-semibold mb-1">Model Breakdown:</p>
                        {Object.entries(tokenBreakdown).length > 0 ? (
                            Object.entries(tokenBreakdown).map(([model, count]) => (
                                <div key={model} className="text-xs flex justify-between gap-4">
                                    <span>{model}:</span>
                                    <span className="font-mono">{count.toLocaleString()}</span>
                                </div>
                            ))
                        ) : (
                            <span className="text-xs text-muted-foreground">No data</span>
                        )}
                    </TooltipContent>
                </Tooltip>
            </TooltipProvider>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{filteredTokenCount.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">
              Tokens in selected range
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
