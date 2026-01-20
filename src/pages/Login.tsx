import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Logo from "@/components/Logo";
import { Eye, EyeOff, ArrowLeft, Mail, Lock, MessageCircle, Zap, Shield, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import logoImage from "@/assets/logo.png";

const Login = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        toast.error(error.message);
      } else {
        toast.success("Login successful!");
        navigate("/dashboard");
      }
    } catch (error) {
      toast.error("An error occurred during login");
    } finally {
      setLoading(false);
    }
  };

  const features = [
    { icon: MessageCircle, text: "WhatsApp, Messenger & Instagram" },
    { icon: Zap, text: "AI-Powered Automation" },
    { icon: Shield, text: "Secure & Reliable" },
    { icon: Users, text: "24/7 Customer Support" },
  ];

  return (
    <div className="flex min-h-screen bg-background">
      {/* Left Panel - Decorative */}
      <div className="relative hidden w-0 flex-1 lg:block">
        <div className="absolute inset-0 bg-gradient-to-br from-primary via-primary/90 to-accent">
          {/* Animated background elements */}
          <div className="absolute inset-0 overflow-hidden">
            <div className="absolute -left-20 -top-20 h-96 w-96 rounded-full bg-primary-foreground/5 blur-3xl animate-pulse" />
            <div className="absolute -bottom-32 -right-32 h-[500px] w-[500px] rounded-full bg-accent/20 blur-3xl animate-pulse" style={{ animationDelay: "1s" }} />
            <div className="absolute left-1/2 top-1/3 h-64 w-64 rounded-full bg-primary-foreground/10 blur-2xl animate-pulse" style={{ animationDelay: "2s" }} />
          </div>
          
          {/* Grid pattern */}
          <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:50px_50px]" />
          
          <div className="relative flex h-full flex-col items-center justify-center p-12">
            {/* Logo */}
            <div className="mb-12">
              <img src={logoImage} alt="SalesmanAI" className="h-24 w-24 animate-pulse" />
            </div>
            
            <div className="max-w-lg text-center">
              <h3 className="mb-6 text-4xl font-bold text-primary-foreground">
                Transform Your Business
              </h3>
              <p className="mb-12 text-xl text-primary-foreground/80">
                AI-powered chatbot automation for your social media platforms. 
                Boost sales and customer engagement effortlessly.
              </p>
              
              {/* Features */}
              <div className="grid grid-cols-2 gap-4">
                {features.map((feature, index) => (
                  <div 
                    key={index}
                    className="flex items-center gap-3 rounded-xl bg-primary-foreground/10 p-4 backdrop-blur-sm transition-all hover:bg-primary-foreground/15"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-foreground/20">
                      <feature.icon className="h-5 w-5 text-primary-foreground" />
                    </div>
                    <span className="text-sm font-medium text-primary-foreground">{feature.text}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Right Panel - Form */}
      <div className="flex flex-1 flex-col justify-center px-4 py-12 sm:px-6 lg:flex-none lg:px-20 xl:px-24">
        <div className="mx-auto w-full max-w-md">
          <div className="mb-6">
            <Link to="/" className="inline-flex items-center gap-2 text-muted-foreground transition-colors hover:text-foreground">
              <ArrowLeft className="h-4 w-4" />
              <span>Return to Home</span>
            </Link>
          </div>

          <div className="mb-10">
            <Logo size="lg" />
            <h2 className="mt-8 text-3xl font-bold text-foreground">Welcome back</h2>
            <p className="mt-3 text-base text-muted-foreground">
              Sign in to your account to continue managing your chatbots
            </p>
          </div>

          <form onSubmit={handleLogin} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm font-medium">Email Address</Label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-12 pl-12 text-base"
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password" className="text-sm font-medium">Password</Label>
                <Link to="/forgot-password" className="text-sm font-medium text-primary transition-colors hover:text-primary/80">
                  Forgot password?
                </Link>
              </div>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-12 pl-12 pr-12 text-base"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
            </div>

            <Button type="submit" variant="hero" className="h-12 w-full text-base font-semibold" disabled={loading}>
              {loading ? (
                <span className="flex items-center gap-2">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                  Signing in...
                </span>
              ) : (
                "Sign In"
              )}
            </Button>
          </form>

          <div className="mt-8">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="bg-background px-4 text-muted-foreground">New to SalesmanAI?</span>
              </div>
            </div>
            
            <div className="mt-6 text-center">
              <Link to="/register" className="text-base font-semibold text-primary transition-colors hover:text-primary/80">
                Create a free account →
              </Link>
            </div>
          </div>

          {/* Trust badges */}
          <div className="mt-10 flex items-center justify-center gap-6 border-t border-border pt-8">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Shield className="h-4 w-4" />
              <span>Secure Login</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Zap className="h-4 w-4" />
              <span>Fast & Reliable</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
