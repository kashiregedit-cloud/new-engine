import { useState } from "react";
import { Link } from "react-router-dom";
import { Menu, X, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import Logo from "@/components/Logo";
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuList,
  NavigationMenuTrigger,
} from "@/components/ui/navigation-menu";

const Navbar = () => {
  const [isOpen, setIsOpen] = useState(false);

  const features = [
    { title: "AI Agent", desc: "স্বয়ংক্রিয় গ্রাহক সেবা" },
    { title: "Automation", desc: "সময় বাঁচানো চ্যাট" },
    { title: "Lead Generation", desc: "লিড ক্যাপচার করুন" },
    { title: "Sales Tools", desc: "অর্ডার অটোমেশন" },
  ];

  const integrations = [
    { title: "Facebook Messenger", desc: "মেসেঞ্জারে বিক্রি" },
    { title: "WhatsApp", desc: "AI চ্যাট সাপোর্ট" },
    { title: "Instagram", desc: "DM অটোমেশন" },
  ];

  return (
    <nav className="fixed top-0 z-50 w-full border-b border-border/50 bg-background/80 backdrop-blur-lg">
      <div className="container mx-auto px-4">
        <div className="flex h-16 items-center justify-between">
          <Link to="/" className="flex items-center">
            <Logo />
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden items-center gap-1 lg:flex">
            <NavigationMenu>
              <NavigationMenuList>
                <NavigationMenuItem>
                  <NavigationMenuTrigger className="bg-transparent">
                    Features
                  </NavigationMenuTrigger>
                  <NavigationMenuContent>
                    <div className="grid w-[400px] gap-2 p-4">
                      {features.map((item) => (
                        <Link
                          key={item.title}
                          to="/"
                          className="block rounded-lg p-3 hover:bg-accent"
                        >
                          <div className="font-medium text-foreground">{item.title}</div>
                          <div className="text-sm text-muted-foreground">{item.desc}</div>
                        </Link>
                      ))}
                    </div>
                  </NavigationMenuContent>
                </NavigationMenuItem>

                <NavigationMenuItem>
                  <NavigationMenuTrigger className="bg-transparent">
                    Integrations
                  </NavigationMenuTrigger>
                  <NavigationMenuContent>
                    <div className="grid w-[400px] gap-2 p-4">
                      {integrations.map((item) => (
                        <Link
                          key={item.title}
                          to="/"
                          className="block rounded-lg p-3 hover:bg-accent"
                        >
                          <div className="font-medium text-foreground">{item.title}</div>
                          <div className="text-sm text-muted-foreground">{item.desc}</div>
                        </Link>
                      ))}
                    </div>
                  </NavigationMenuContent>
                </NavigationMenuItem>

                <NavigationMenuItem>
                  <Link to="/" className="block px-4 py-2 text-sm font-medium text-foreground hover:text-primary">
                    Pricing
                  </Link>
                </NavigationMenuItem>

                <NavigationMenuItem>
                  <Link to="/" className="block px-4 py-2 text-sm font-medium text-foreground hover:text-primary">
                    Resources
                  </Link>
                </NavigationMenuItem>
              </NavigationMenuList>
            </NavigationMenu>
          </div>

          {/* Desktop Auth Buttons */}
          <div className="hidden items-center gap-3 lg:flex">
            <Button variant="ghost" asChild>
              <Link to="/login">Login</Link>
            </Button>
            <Button variant="hero" asChild>
              <Link to="/register">Get Started</Link>
            </Button>
          </div>

          {/* Mobile Menu Button */}
          <button
            className="lg:hidden"
            onClick={() => setIsOpen(!isOpen)}
          >
            {isOpen ? (
              <X className="h-6 w-6 text-foreground" />
            ) : (
              <Menu className="h-6 w-6 text-foreground" />
            )}
          </button>
        </div>

        {/* Mobile Navigation */}
        {isOpen && (
          <div className="border-t border-border py-4 lg:hidden">
            <div className="flex flex-col gap-2">
              <Link
                to="/"
                className="px-4 py-2 text-foreground hover:bg-accent rounded-lg"
                onClick={() => setIsOpen(false)}
              >
                Features
              </Link>
              <Link
                to="/"
                className="px-4 py-2 text-foreground hover:bg-accent rounded-lg"
                onClick={() => setIsOpen(false)}
              >
                Integrations
              </Link>
              <Link
                to="/"
                className="px-4 py-2 text-foreground hover:bg-accent rounded-lg"
                onClick={() => setIsOpen(false)}
              >
                Pricing
              </Link>
              <Link
                to="/"
                className="px-4 py-2 text-foreground hover:bg-accent rounded-lg"
                onClick={() => setIsOpen(false)}
              >
                Resources
              </Link>
              <div className="mt-4 flex flex-col gap-2 px-4">
                <Button variant="outline" asChild className="w-full">
                  <Link to="/login">Login</Link>
                </Button>
                <Button variant="hero" asChild className="w-full">
                  <Link to="/register">Get Started</Link>
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </nav>
  );
};

export default Navbar;
