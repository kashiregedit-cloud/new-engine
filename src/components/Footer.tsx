import { Link } from "react-router-dom";
import Logo from "@/components/Logo";
import { Facebook, Instagram, Linkedin, Twitter } from "lucide-react";

const Footer = () => {
  const footerLinks = {
    Product: [
      { name: "Features", href: "/" },
      { name: "Integrations", href: "/" },
      { name: "Pricing", href: "/" },
      { name: "Changelog", href: "/" },
    ],
    Company: [
      { name: "About", href: "/" },
      { name: "Blog", href: "/" },
      { name: "Careers", href: "/" },
      { name: "Contact", href: "/" },
    ],
    Resources: [
      { name: "Documentation", href: "/" },
      { name: "Help Center", href: "/" },
      { name: "API Reference", href: "/" },
      { name: "Status", href: "/" },
    ],
    Legal: [
      { name: "Privacy", href: "/" },
      { name: "Terms", href: "/" },
      { name: "Cookie Policy", href: "/" },
    ],
  };

  return (
    <footer className="border-t border-border bg-card">
      <div className="container mx-auto px-4 py-12">
        <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-6">
          {/* Logo & Description */}
          <div className="lg:col-span-2">
            <Logo animated={false} />
            <p className="mt-4 text-sm text-muted-foreground">
              AI-powered chatbot solution for WhatsApp, Messenger, and Instagram.
              Automate your customer support and boost sales.
            </p>
            <div className="mt-6 flex gap-4">
              <a
                href="#"
                className="text-muted-foreground transition-colors hover:text-primary"
              >
                <Facebook className="h-5 w-5" />
              </a>
              <a
                href="#"
                className="text-muted-foreground transition-colors hover:text-primary"
              >
                <Instagram className="h-5 w-5" />
              </a>
              <a
                href="#"
                className="text-muted-foreground transition-colors hover:text-primary"
              >
                <Twitter className="h-5 w-5" />
              </a>
              <a
                href="#"
                className="text-muted-foreground transition-colors hover:text-primary"
              >
                <Linkedin className="h-5 w-5" />
              </a>
            </div>
          </div>

          {/* Links */}
          {Object.entries(footerLinks).map(([title, links]) => (
            <div key={title}>
              <h4 className="mb-4 font-semibold text-foreground">{title}</h4>
              <ul className="space-y-2">
                {links.map((link) => (
                  <li key={link.name}>
                    <Link
                      to={link.href}
                      className="text-sm text-muted-foreground transition-colors hover:text-primary"
                    >
                      {link.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 border-t border-border pt-8 text-center text-sm text-muted-foreground">
          <p>© {new Date().getFullYear()} SalesmanAI. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
