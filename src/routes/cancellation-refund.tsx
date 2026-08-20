import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/cancellation-refund")({
  head: () => ({
    meta: [
      { title: "Cancellation and Refund Policy | Zérah Baby And Kids" },
    ],
  }),
  component: CancellationRefundPage,
});

function CancellationRefundPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
      <h1 className="font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
        Cancellation and Refund Policy
      </h1>
      <div className="mt-8 space-y-6 text-muted-foreground leading-relaxed">
        <p>
          Last updated: {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
        </p>

        <h2 className="text-xl font-semibold text-foreground mt-8">1. Order Cancellations</h2>
        <p>
          You can cancel your order at any time before it has been dispatched from our warehouse. 
          To cancel your order, please contact our support team with your order number. 
          Once the order has been shipped, it cannot be cancelled, but it may be eligible for a return.
        </p>

        <h2 className="text-xl font-semibold text-foreground mt-8">2. Returns and Refunds</h2>
        <p>
          We want you to be completely satisfied with your purchase. If for any reason you are not satisfied, 
          we accept returns within 7 days of the delivery date, provided the items are unused, in their original packaging, 
          and in the same condition that you received them.
        </p>

        <h2 className="text-xl font-semibold text-foreground mt-8">3. Non-Returnable Items</h2>
        <p>
          Certain items cannot be returned for hygiene and safety reasons. These include:
        </p>
        <ul className="list-disc pl-6 space-y-2">
          <li>Teethers and pacifiers</li>
          <li>Underwear and innerwear</li>
          <li>Skincare and bath products (if opened)</li>
          <li>Items marked as final sale or clearance</li>
        </ul>

        <h2 className="text-xl font-semibold text-foreground mt-8">4. Refund Process</h2>
        <p>
          Once your return is received and inspected, we will notify you of the approval or rejection of your refund. 
          If approved, your refund will be processed, and a credit will automatically be applied to your original method of payment 
          (e.g., via Razorpay) within 5-7 business days. Please note that shipping costs are non-refundable.
        </p>

        <h2 className="text-xl font-semibold text-foreground mt-8">5. Damaged or Defective Items</h2>
        <p>
          If you receive a defective or damaged item, please contact us within 48 hours of delivery with photos of the defect. 
          We will arrange for a replacement or a full refund, including shipping costs, at no additional charge to you.
        </p>
      </div>
    </div>
  );
}
