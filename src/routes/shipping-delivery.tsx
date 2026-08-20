import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/shipping-delivery")({
  head: () => ({
    meta: [{ title: "Shipping and Delivery Policy | Zérah Baby And Kid's" }],
  }),
  component: ShippingDeliveryPage,
});

function ShippingDeliveryPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
      <h1 className="font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
        Shipping and Delivery Policy
      </h1>
      <div className="mt-8 space-y-6 text-muted-foreground leading-relaxed">
        <p>
          Last updated:{" "}
          {new Date().toLocaleDateString("en-US", {
            month: "long",
            day: "numeric",
            year: "numeric",
          })}
        </p>

        <h2 className="text-xl font-semibold text-foreground mt-8">1. Processing Time</h2>
        <p>
          All orders are processed within 1 to 2 business days (excluding weekends and holidays)
          after receiving your order confirmation email. You will receive another notification when
          your order has shipped. In case of a high volume of orders, shipments may be delayed by a
          few days.
        </p>

        <h2 className="text-xl font-semibold text-foreground mt-8">
          2. Shipping Rates and Estimates
        </h2>
        <p>
          Shipping charges for your order will be calculated and displayed at checkout. Delivery
          estimates typically range from 3 to 7 business days depending on your location within
          India. We use trusted courier partners to ensure safe and timely delivery.
        </p>

        <h2 className="text-xl font-semibold text-foreground mt-8">3. Order Tracking</h2>
        <p>
          When your order has shipped, you will receive an email notification from us which will
          include a tracking number you can use to check its status. Please allow 24 hours for the
          tracking information to become available.
        </p>

        <h2 className="text-xl font-semibold text-foreground mt-8">
          4. Domestic and International Shipping
        </h2>
        <p>
          Currently, we only ship within India. We do not offer international shipping at this time.
        </p>

        <h2 className="text-xl font-semibold text-foreground mt-8">5. Missing or Lost Packages</h2>
        <p>
          If you haven't received your order within 10 days of receiving your shipping confirmation
          email, please contact us with your name and order number, and we will look into it for
          you.
        </p>
      </div>
    </div>
  );
}
