import { Check, ChevronsUpDown, Building, User, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useMessenger } from "@/context/MessengerContext";
import { useWhatsApp } from "@/context/WhatsAppContext";
import { useState } from "react";

interface WorkspaceSwitcherProps {
  platform?: 'messenger' | 'whatsapp';
}

export function WorkspaceSwitcher({ platform = 'messenger' }: WorkspaceSwitcherProps) {
    if (platform === 'messenger') return <MessengerSwitcher />;
    if (platform === 'whatsapp') return <WhatsAppSwitcher />;
    return null;
}

function MessengerSwitcher() {
  const context = useMessenger();
  if (!context) return null;
  return <SwitcherUI context={context} />;
}

function WhatsAppSwitcher() {
  const context = useWhatsApp();
  if (!context) return null;
  return <SwitcherUI context={context} />;
}

function SwitcherUI({ context }: { context: any }) {
  const { 
    isTeamMember, 
    teamOwnerEmail, 
    viewMode, 
    switchViewMode 
  } = context;
  
  const [open, setOpen] = useState(false);

  // If user is not a team member, they don't need a switcher
  if (!isTeamMember) return null;

  const currentWorkspace = viewMode === 'personal' 
    ? { label: "My Workspace", value: "personal", icon: User }
    : { label: `Team (${teamOwnerEmail?.split('@')[0]})`, value: "team", icon: Building };

  return (
    <div className="px-2 mb-2">
        <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
            <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between h-12 px-3 border-dashed bg-sidebar-accent/50 hover:bg-sidebar-accent"
            >
            <div className="flex items-center gap-2 truncate">
                <div className="bg-primary/10 p-1 rounded-md">
                    {currentWorkspace.value === 'personal' ? <User className="h-4 w-4 text-primary" /> : <Users className="h-4 w-4 text-primary" />}
                </div>
                <span className="truncate font-medium">{currentWorkspace.label}</span>
            </div>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[220px] p-0" align="start">
            <Command>
            <CommandList>
                <CommandInput placeholder="Search workspace..." />
                <CommandEmpty>No workspace found.</CommandEmpty>
                <CommandGroup heading="Personal">
                <CommandItem
                    onSelect={() => {
                    switchViewMode("personal");
                    setOpen(false);
                    }}
                    className="text-sm cursor-pointer"
                >
                    <div className="mr-2 bg-primary/10 p-1 rounded-md">
                        <User className="h-4 w-4 text-primary" />
                    </div>
                    My Workspace
                    {viewMode === "personal" && (
                    <Check className="ml-auto h-4 w-4 opacity-100" />
                    )}
                </CommandItem>
                </CommandGroup>
                <CommandSeparator />
                <CommandGroup heading="Teams">
                <CommandItem
                    onSelect={() => {
                    switchViewMode("team");
                    setOpen(false);
                    }}
                    className="text-sm cursor-pointer"
                >
                    <div className="mr-2 bg-orange-500/10 p-1 rounded-md">
                        <Users className="h-4 w-4 text-orange-600" />
                    </div>
                    Team ({teamOwnerEmail?.split('@')[0]})
                    {viewMode === "team" && (
                    <Check className="ml-auto h-4 w-4 opacity-100" />
                    )}
                </CommandItem>
                </CommandGroup>
            </CommandList>
            </Command>
        </PopoverContent>
        </Popover>
    </div>
  );
}
