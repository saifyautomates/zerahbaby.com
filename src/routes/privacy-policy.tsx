import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/privacy-policy")({
  head: () => ({
    meta: [{ title: "Privacy Policy | Zérah Baby And Kid's" }],
  }),
  component: PrivacyPolicyPage,
});

function PrivacyPolicyPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
      <h1 className="font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
        Privacy Policy
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

        <h2 className="text-xl font-semibold text-foreground mt-8">1. Introduction</h2>
        <p>
          Welcome to Zérah Baby And Kid's. We respect your privacy and are committed to protecting
          your personal data. This privacy policy will inform you as to how we look after your
          personal data when you visit our website and tell you about your privacy rights and how
          the law protects you.
        </p>

        <h2 className="text-xl font-semibold text-foreground mt-8">
          2. The data we collect about you
        </h2>
        <p>
          We may collect, use, store and transfer different kinds of personal data about you which
          we have grouped together as follows:
        </p>
        <ul className="list-disc pl-6 space-y-2">
          <li>
            <strong>Identity Data:</strong> includes first name, last name, username or similar
            identifier.
          </li>
          <li>
            <strong>Contact Data:</strong> includes billing address, delivery address, email address
            and telephone numbers.
          </li>
          <li>
            <strong>Financial Data:</strong> includes payment card details (processed securely by
            Razorpay, not stored on our servers).
          </li>
          <li>
            <strong>Transaction Data:</strong> includes details about payments to and from you and
            other details of products you have purchased from us.
          </li>
        </ul>

        <h2 className="text-xl font-semibold text-foreground mt-8">
          3. How we use your personal data
        </h2>
        <p>
          We will only use your personal data when the law allows us to. Most commonly, we will use
          your personal data in the following circumstances:
        </p>
        <ul className="list-disc pl-6 space-y-2">
          <li>
            Where we need to perform the contract we are about to enter into or have entered into
            with you (e.g., fulfilling an order).
          </li>
          <li>
            Where it is necessary for our legitimate interests (or those of a third party) and your
            interests and fundamental rights do not override those interests.
          </li>
          <li>Where we need to comply with a legal obligation.</li>
        </ul>

        <h2 className="text-xl font-semibold text-foreground mt-8">4. Data Security</h2>
        <p>
          We have put in place appropriate security measures to prevent your personal data from
          being accidentally lost, used or accessed in an unauthorised way, altered or disclosed.
        </p>

        <h2 className="text-xl font-semibold text-foreground mt-8">5. Contact Details</h2>
        <p>
          If you have any questions about this privacy policy or our privacy practices, please
          contact us through the provided contact methods on our website.
        </p>
      </div>
    </div>
  );
}
