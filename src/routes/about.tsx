import { createFileRoute, Link } from "@tanstack/react-router";
import { Heart, Leaf, ShieldCheck, Users } from "lucide-react";
import hero from "@/assets/hero-baby.jpg";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: "About Zerah Baby And Kids — Gentle Essentials for Little Ones" },
      {
        name: "description",
        content:
          "Zerah Baby And Kids is a parent-run baby store curating organic clothing, safe toys and trusted nursery gear. Learn how we test and choose every product.",
      },
      {
        property: "og:title",
        content: "About Zerah Baby And Kids — Gentle Essentials for Little Ones",
      },
      {
        property: "og:description",
        content: "How a parent-run baby store curates and safety-tests every product.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AboutPage,
});

const values = [
  {
    icon: Leaf,
    title: "Gentle materials",
    text: "Organic cotton, food-grade silicone and water-based paints come first.",
  },
  {
    icon: ShieldCheck,
    title: "Tested twice",
    text: "Every batch is lab-checked, then trialled by our own parent panel.",
  },
  {
    icon: Heart,
    title: "Honest pricing",
    text: "No inflated MRPs — the discount you see is the discount you get.",
  },
  {
    icon: Users,
    title: "Parent support",
    text: "Real humans on chat, seven days a week, from 8am to 9pm.",
  },
];

function AboutPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-12">
      <h1 className="font-display text-4xl font-bold">We're parents building the shop we wanted</h1>
      <p className="mt-4 max-w-2xl text-muted-foreground">
        Zerah Baby And Kids started in 2026 in a small flat, with two new parents frustrated by
        scratchy fabrics, mystery ingredient lists and gear that fell apart by month three. Today we
        curate a few hundred products across clothing, toys, care and gear — each one chosen because
        we'd use it ourselves.
      </p>

      <img
        src={hero}
        alt="Parent playing with toddlers among soft pastel toys"
        loading="eager"
        width={1600}
        height={900}
        className="mt-8 w-full rounded-3xl object-cover"
      />

      <div className="mt-12 grid gap-5 sm:grid-cols-2">
        {values.map((v) => (
          <div key={v.title} className="rounded-2xl border border-border p-6">
            <span className="grid size-10 place-items-center rounded-full bg-secondary text-primary">
              <v.icon className="size-5" />
            </span>
            <h2 className="mt-4 font-semibold">{v.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{v.text}</p>
          </div>
        ))}
      </div>

      <div className="mt-12 rounded-3xl bg-secondary p-8 text-center">
        <p className="font-display text-4xl font-bold text-primary">2500+</p>
        <p className="mt-1 text-sm text-muted-foreground">Families served</p>
      </div>

      <div className="mt-12 text-center">
        <Link
          to="/shop"
          className="inline-block rounded-full bg-primary px-8 py-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90"
        >
          Browse the collection
        </Link>
      </div>
    </div>
  );
}
