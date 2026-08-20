import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/returns")({
  head: () => ({
    meta: [
      { title: "Refund & Return Policy — Zerah Baby And Kid's" },
      {
        name: "description",
        content:
          "Returns accepted within 7 days of delivery. Products must be unused, unwashed and in original packaging. Refunds are processed after inspection.",
      },
      { property: "og:title", content: "Refund & Return Policy — Zerah Baby And Kid's" },
      {
        property: "og:description",
        content:
          "7-day returns, inspection-based refunds and shipping charge rules for Zerah Baby And Kid's orders.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ReturnsPage,
});

export const returnPolicyPoints = [
  <>
    Returns are accepted within <strong>7 days</strong> of delivery.
  </>,
  <>Products must be unused, unwashed, and in their original packaging.</>,
  <>Refunds are processed after the returned product passes inspection.</>,
  <>Shipping charges are non-refundable unless the wrong or damaged item was delivered.</>,
];

function ReturnsPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="font-display text-4xl font-bold">Refund &amp; Return Policy</h1>
      <ul className="mt-8 space-y-4 text-base leading-relaxed text-muted-foreground">
        {returnPolicyPoints.map((point, i) => (
          <li key={i} className="flex gap-3">
            <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />
            <span className="text-foreground/90">{point}</span>
          </li>
        ))}
      </ul>
      <p className="mt-10 text-sm text-muted-foreground">
        To start a return, reach us from the{" "}
        <Link to="/contact" className="font-semibold text-primary hover:underline">
          contact page
        </Link>{" "}
        with your order number.
      </p>
    </div>
  );
}
