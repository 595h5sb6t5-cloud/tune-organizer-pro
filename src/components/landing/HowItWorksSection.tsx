const steps = [
  {
    number: "01",
    title: "Connect your account",
    description: "Link your Spotify account in seconds with secure OAuth.",
  },
  {
    number: "02",
    title: "Import your library",
    description: "We pull your liked songs and saved tracks — nothing else.",
  },
  {
    number: "03",
    title: "AI organizes everything",
    description: "Tracks are analyzed and sorted into cohesive, intelligent playlists.",
  },
  {
    number: "04",
    title: "Sync to your account",
    description: "Export playlists directly back into Spotify with one click.",
  },
];

const HowItWorksSection = () => {
  return (
    <section id="how-it-works" className="py-24 bg-secondary/50">
      <div className="container">
        <div className="text-center mb-16">
          <h2 className="font-heading text-4xl md:text-5xl tracking-tight mb-4">
            How Tempo works
          </h2>
          <p className="text-muted-foreground text-lg max-w-lg mx-auto">
            Four simple steps from chaos to perfectly curated playlists.
          </p>
        </div>

        <div className="grid md:grid-cols-4 gap-8 max-w-4xl mx-auto">
          {steps.map((step) => (
            <div key={step.number} className="text-center">
              <div className="font-heading text-5xl text-accent/30 mb-4">{step.number}</div>
              <h3 className="font-heading text-xl mb-2">{step.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{step.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default HowItWorksSection;
