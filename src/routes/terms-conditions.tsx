import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/terms-conditions")({
  head: () => ({
    meta: [
      { title: "Terms and Conditions | Zérah Baby And Kids" },
    ],
  }),
  component: TermsConditionsPage,
});

function TermsConditionsPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
      <h1 className="font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
        Terms and Conditions
      </h1>
      <div className="mt-8 space-y-6 text-muted-foreground leading-relaxed">
        <p>
          Last updated: {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
        </p>

        <h2 className="text-xl font-semibold text-foreground mt-8">1. Introduction</h2>
        <p>
          These terms and conditions outline the rules and regulations for the use of Zérah Baby And Kids's Website. 
          By accessing this website we assume you accept these terms and conditions. Do not continue to use Zérah Baby And Kids 
          if you do not agree to take all of the terms and conditions stated on this page.
        </p>

        <h2 className="text-xl font-semibold text-foreground mt-8">2. Products and Services</h2>
        <p>
          We make every effort to display as accurately as possible the colors, features, specifications, and details of the products available on our website. 
          However, we do not guarantee that the colors, features, specifications, and details of the products will be accurate, complete, reliable, current, or free of other errors, 
          and your electronic display may not accurately reflect the actual colors and details of the products.
        </p>

        <h2 className="text-xl font-semibold text-foreground mt-8">3. Purchases and Payment</h2>
        <p>
          We accept payments through Razorpay, which includes Credit Cards, Debit Cards, Net Banking, UPI, and wallets. 
          You agree to provide current, complete, and accurate purchase and account information for all purchases made via the website. 
          You further agree to promptly update account and payment information, including email address, payment method, and payment card expiration date, 
          so that we can complete your transactions and contact you as needed.
        </p>

        <h2 className="text-xl font-semibold text-foreground mt-8">4. Pricing</h2>
        <p>
          All prices are subject to change without notice. We reserve the right at any time to modify or discontinue the Service (or any part or content thereof) without notice at any time. 
          We shall not be liable to you or to any third-party for any modification, price change, suspension, or discontinuance of the Service.
        </p>

        <h2 className="text-xl font-semibold text-foreground mt-8">5. Governing Law</h2>
        <p>
          These terms and conditions are governed by and construed in accordance with the laws of India and you irrevocably submit to the exclusive jurisdiction of the courts in that State or location.
        </p>
      </div>
    </div>
  );
}
