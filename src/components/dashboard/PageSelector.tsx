import { useMessenger } from "@/context/MessengerContext";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MessageSquare, PlusCircle, Facebook } from "lucide-react";
import { useNavigate } from "react-router-dom";

export function PageSelector() {
  const context = useMessenger();
  const navigate = useNavigate();
  const { pages, currentPage, setCurrentPage } = context;

  const handleValueChange = (value: string) => {
    if (value === "add_new") {
      navigate("/dashboard/messenger/integration");
      return;
    }
    const selected = pages.find((p) => p.page_id === value);
    if (selected) {
      setCurrentPage(selected);
    }
  };

  if (pages.length === 0) {
    return (
       <div 
         className="flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
         onClick={() => navigate("/dashboard/messenger/integration")}
       >
         <PlusCircle size={16} />
         <span>Connect Page</span>
       </div>
    );
  }

  return (
    <div className="px-2 mb-4">
      <label className="text-xs font-medium text-muted-foreground mb-1.5 block px-1">
        Active Page
      </label>
      <Select
        value={currentPage?.page_id || ""}
        onValueChange={handleValueChange}
      >
        <SelectTrigger className="w-full bg-sidebar-accent border-sidebar-border text-sidebar-foreground h-9">
          <div className="flex items-center gap-2 overflow-hidden">
            <Facebook size={14} className="shrink-0" />
            <SelectValue placeholder="Select Page" />
          </div>
        </SelectTrigger>
        <SelectContent>
          {pages.map((page) => (
            <SelectItem key={page.page_id} value={page.page_id}>
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${page.db_id ? 'bg-green-500' : 'bg-yellow-500'}`} />
                {page.name}
              </div>
            </SelectItem>
          ))}
          <div className="h-px bg-border my-1" />
          <SelectItem value="add_new" className="text-primary focus:text-primary cursor-pointer">
            <div className="flex items-center gap-2">
              <PlusCircle size={14} />
              Manage Pages
            </div>
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
