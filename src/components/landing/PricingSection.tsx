import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";
import { Link } from "react-router-dom";

const plans = [
  {
    name: "Free",
    price: "$0",
    period: "forever",
    description: "Get started with your library",
    features: [
      "Connect one platform",
      "Import up to 300 songs",
      "3 playlists per month",
      "2 exports per month",
      "Basic mood analysis",
    ],
    cta: "Start free",
    variant: "hero-outline" as const,
  },
  {
    name: "Premium",
    price: "$9",
    period: "per month",
    description: "Unlock the full Tempo experience",
    features: [
      "Unlimited imports",
      "Unlimited playlists",
      "Unlimited exports & syncs",
      "Advanced vibe controls",
      "Playlist refresh & fine-tuning",
      "Cross-platform support",
      "Priority analysis",
    ],
    cta: "Go Premium",
    variant: "hero" as const,
    popular: true,
  },
];

const PricingSection = () => {
  return (
    <section id="pricing" className="py-24">
      <div className="container">
        <div className="text-center mb-16">
          <h2 className="font-heading text-4xl md:text-5xl tracking-tight mb-4">
            Simple pricing
          </h2>
          <p className="text-muted-foreground text-lg max-w-lg mx-auto">
            Start for free. Upgrade when you need more.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-8 max-w-3xl mx-auto">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className={`relative p-8 rounded-2xl border transition-all duration-300 ${
                plan.popular
                  ? "bg-primary text-primary-foreground border-primary shadow-xl shadow-navy/20"
                  : "bg-surface-elevated border-border hover:border-border hover:shadow-lg"
              }`}
            >
              {plan.popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-accent text-accent-foreground text-xs font-medium">
                  Most popular
                </div>
              )}

              <div className="mb-6">
                <h3 className="font-heading text-2xl mb-1">{plan.name}</h3>
                <p className={`text-sm ${plan.popular ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                  {plan.description}
                </p>
              </div>

              <div className="mb-6">
                <span className="font-heading text-4xl">{plan.price}</span>
                <span className={`text-sm ml-1 ${plan.popular ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                  /{plan.period}
                </span>
              </div>

              <ul className="space-y-3 mb-8">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-center gap-2 text-sm">
                    <Check className={`w-4 h-4 flex-shrink-0 ${plan.popular ? "text-accent" : "text-accent"}`} />
                    {feature}
                  </li>
                ))}
              </ul>

              <Button
                variant={plan.popular ? "warm" : plan.variant}
                className="w-full rounded-xl h-11"
                asChild
              >
                <Link to="/dashboard">{plan.cta}</Link>
              </Button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default PricingSection;
