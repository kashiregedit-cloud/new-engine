import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import {
  MessageCircle,
  Bot,
  Zap,
  BarChart3,
  Users,
  ShieldCheck,
  ArrowRight,
  CheckCircle2,
  Star,
} from "lucide-react";
import heroBg from "@/assets/hero-bg.jpg";

const Index = () => {
  const features = [
    {
      icon: Bot,
      title: "AI Chatbot Agent",
      desc: "স্মার্ট AI যা আপনার গ্রাহকদের সাথে স্বয়ংক্রিয়ভাবে কথা বলে",
    },
    {
      icon: MessageCircle,
      title: "Multi-Platform",
      desc: "WhatsApp, Messenger, Instagram - সব প্ল্যাটফর্মে একসাথে কাজ করে",
    },
    {
      icon: Zap,
      title: "Instant Response",
      desc: "24/7 তাৎক্ষণিক উত্তর দিয়ে গ্রাহক সন্তুষ্টি বাড়ান",
    },
    {
      icon: BarChart3,
      title: "Analytics Dashboard",
      desc: "বিস্তারিত রিপোর্ট ও অ্যানালিটিক্স দিয়ে পারফরম্যান্স ট্র্যাক করুন",
    },
    {
      icon: Users,
      title: "Lead Generation",
      desc: "স্বয়ংক্রিয়ভাবে লিড ক্যাপচার ও কোয়ালিফাই করুন",
    },
    {
      icon: ShieldCheck,
      title: "Secure & Reliable",
      desc: "এন্টারপ্রাইজ-গ্রেড সিকিউরিটি ও 99.9% আপটাইম",
    },
  ];

  const stats = [
    { value: "10,000+", label: "Active Users" },
    { value: "50M+", label: "Messages/Month" },
    { value: "99.9%", label: "Uptime" },
    { value: "4.9/5", label: "User Rating" },
  ];

  const testimonials = [
    {
      name: "Rahim Ahmed",
      role: "E-commerce Owner",
      content: "SalesmanAI দিয়ে আমার বিক্রি ৩ গুণ বেড়ে গেছে। অসাধারণ সার্ভিস!",
      rating: 5,
    },
    {
      name: "Fatima Khan",
      role: "Marketing Manager",
      content: "গ্রাহক সেবায় সময় ও খরচ দুটোই কমেছে। Highly recommend!",
      rating: 5,
    },
    {
      name: "Kamal Hossain",
      role: "Business Owner",
      content: "24/7 customer support এখন সম্ভব শুধুমাত্র SalesmanAI এর জন্য।",
      rating: 5,
    },
  ];

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      {/* Hero Section */}
      <section className="relative overflow-hidden pt-16">
        <div
          className="absolute inset-0 bg-cover bg-center opacity-20"
          style={{ backgroundImage: `url(${heroBg})` }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-background/50 via-background/80 to-background" />

        <div className="container relative mx-auto px-4 py-24 md:py-32">
          <div className="mx-auto max-w-4xl text-center">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-2 text-sm text-primary">
              <Zap className="h-4 w-4" />
              <span>AI-Powered Chatbot Solution</span>
            </div>

            <h1 className="mb-6 text-4xl font-bold leading-tight text-foreground md:text-5xl lg:text-6xl">
              Turn Social Messages Into{" "}
              <span className="text-primary">Sales & Support</span>
            </h1>

            <p className="mx-auto mb-8 max-w-2xl text-lg text-muted-foreground md:text-xl">
              WhatsApp, Messenger, এবং Instagram এ AI-powered chatbot দিয়ে আপনার
              গ্রাহক সেবা ও বিক্রি অটোমেট করুন। ২৪/৭ সাপোর্ট, লিড জেনারেশন, এবং
              অর্ডার ম্যানেজমেন্ট।
            </p>

            <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Button variant="hero" size="xl" asChild>
                <Link to="/register">
                  Start Free Trial
                  <ArrowRight className="h-5 w-5" />
                </Link>
              </Button>
              <Button variant="outline" size="xl" asChild>
                <Link to="/">Watch Demo</Link>
              </Button>
            </div>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-6 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-primary" />
                <span>No credit card required</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-primary" />
                <span>14-day free trial</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-primary" />
                <span>Cancel anytime</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="border-y border-border bg-card/50 py-12">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
            {stats.map((stat) => (
              <div key={stat.label} className="text-center">
                <div className="text-3xl font-bold text-primary md:text-4xl">
                  {stat.value}
                </div>
                <div className="mt-1 text-sm text-muted-foreground">
                  {stat.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20">
        <div className="container mx-auto px-4">
          <div className="mx-auto mb-16 max-w-2xl text-center">
            <h2 className="mb-4 text-3xl font-bold text-foreground md:text-4xl">
              Everything You Need to Scale
            </h2>
            <p className="text-lg text-muted-foreground">
              আপনার ব্যবসা বাড়াতে প্রয়োজনীয় সব ফিচার এক জায়গায়
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {features.map((feature) => (
              <div
                key={feature.title}
                className="group rounded-xl border border-border bg-card p-6 transition-all duration-300 hover:border-primary/50 hover:shadow-lg hover:shadow-primary/5"
              >
                <div className="mb-4 inline-flex rounded-lg bg-primary/10 p-3">
                  <feature.icon className="h-6 w-6 text-primary" />
                </div>
                <h3 className="mb-2 text-xl font-semibold text-foreground">
                  {feature.title}
                </h3>
                <p className="text-muted-foreground">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials Section */}
      <section className="bg-card/50 py-20">
        <div className="container mx-auto px-4">
          <div className="mx-auto mb-16 max-w-2xl text-center">
            <h2 className="mb-4 text-3xl font-bold text-foreground md:text-4xl">
              Trusted by Thousands
            </h2>
            <p className="text-lg text-muted-foreground">
              আমাদের গ্রাহকদের সফলতার গল্প
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-3">
            {testimonials.map((testimonial) => (
              <div
                key={testimonial.name}
                className="rounded-xl border border-border bg-card p-6"
              >
                <div className="mb-4 flex gap-1">
                  {[...Array(testimonial.rating)].map((_, i) => (
                    <Star
                      key={i}
                      className="h-5 w-5 fill-primary text-primary"
                    />
                  ))}
                </div>
                <p className="mb-4 text-foreground">"{testimonial.content}"</p>
                <div>
                  <div className="font-semibold text-foreground">
                    {testimonial.name}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {testimonial.role}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20">
        <div className="container mx-auto px-4">
          <div className="relative overflow-hidden rounded-2xl bg-primary p-8 md:p-12">
            <div className="absolute inset-0 bg-[url('/grid.svg')] opacity-10" />
            <div className="relative mx-auto max-w-2xl text-center">
              <h2 className="mb-4 text-3xl font-bold text-primary-foreground md:text-4xl">
                Ready to Transform Your Business?
              </h2>
              <p className="mb-8 text-lg text-primary-foreground/80">
                আজই শুরু করুন এবং দেখুন কিভাবে SalesmanAI আপনার ব্যবসা বদলে দিতে পারে
              </p>
              <Button
                variant="secondary"
                size="xl"
                className="bg-background text-foreground hover:bg-background/90"
                asChild
              >
                <Link to="/register">
                  Start Free Trial
                  <ArrowRight className="h-5 w-5" />
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
};

export default Index;
