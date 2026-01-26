import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Database } from "@/integrations/supabase/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Trash, Plus, Check, X } from "lucide-react";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type ApiItem = Database['public']['Tables']['api_list']['Row'];

export default function ApiManagementPage() {
    const [apis, setApis] = useState<ApiItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [newApi, setNewApi] = useState("");
    const [provider, setProvider] = useState("gemini");
    const [model, setModel] = useState("gemini-2.5-flash-lite");

    useEffect(() => {
        fetchApis();
    }, []);

    const fetchApis = async () => {
        setLoading(true);
        const { data, error } = await supabase.from('api_list').select('*').order('id', { ascending: false });
        if (error) {
            toast.error("Failed to fetch API list");
        } else {
            setApis(data || []);
        }
        setLoading(false);
    };

    const addApi = async () => {
        if (!newApi) return;
        const { error } = await supabase.from('api_list').insert([{
            provider,
            model,
            api: newApi,
            is_active: true
        }] as any);

        if (error) {
            toast.error("Failed to add API Key");
        } else {
            toast.success("API Key added successfully");
            setNewApi("");
            fetchApis();
        }
    };

    const deleteApi = async (id: number) => {
        const { error } = await supabase.from('api_list').delete().eq('id', id);
        if (error) {
            toast.error("Failed to delete API Key");
        } else {
            toast.success("API Key deleted");
            fetchApis();
        }
    };

    return (
        <div className="container mx-auto p-6 space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle>API Key Management (Global Pool)</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex gap-4">
                        <Select value={provider} onValueChange={setProvider}>
                            <SelectTrigger className="w-[180px]">
                                <SelectValue placeholder="Provider" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="gemini">Gemini (Google)</SelectItem>
                                <SelectItem value="openai">OpenAI</SelectItem>
                                <SelectItem value="openrouter">OpenRouter</SelectItem>
                            </SelectContent>
                        </Select>
                        
                        <Input 
                            placeholder="Model Name (e.g., gemini-2.5-flash-lite)" 
                            value={model} 
                            onChange={(e) => setModel(e.target.value)}
                            className="w-[250px]"
                        />

                        <Input 
                            placeholder="Paste API Key here..." 
                            value={newApi} 
                            onChange={(e) => setNewApi(e.target.value)}
                            className="flex-1"
                        />
                        <Button onClick={addApi}><Plus className="mr-2 h-4 w-4" /> Add Key</Button>
                    </div>

                    <div className="rounded-md border">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>ID</TableHead>
                                    <TableHead>Provider</TableHead>
                                    <TableHead>Model</TableHead>
                                    <TableHead>API Key (Masked)</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead className="text-right">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {apis.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={6} className="text-center h-24">No API keys found.</TableCell>
                                    </TableRow>
                                ) : (
                                    apis.map((api) => (
                                        <TableRow key={api.id}>
                                            <TableCell>{api.id}</TableCell>
                                            <TableCell className="capitalize">{api.provider}</TableCell>
                                            <TableCell>{api.model}</TableCell>
                                            <TableCell className="font-mono">
                                                {api.api ? `${api.api.substring(0, 8)}...${api.api.substring(api.api.length - 4)}` : '******'}
                                            </TableCell>
                                            <TableCell>
                                                {api.is_active ? <Check className="text-green-500 h-4 w-4" /> : <X className="text-red-500 h-4 w-4" />}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <Button variant="ghost" size="icon" onClick={() => deleteApi(api.id)}>
                                                    <Trash className="h-4 w-4 text-red-500" />
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
