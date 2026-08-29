import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface PolicySection {
  id: string;
  title: string;
  content: string;
  bullets?: string[];
}

export interface PolicyPageContent {
  title: string;
  lastUpdated: string;
  intro?: string;
  sections: PolicySection[];
}

export interface AboutPageContent {
  title: string;
  subtitle: string;
  story: string;
  mission: string;
  values: Array<{ title: string; text: string }>;
}

export interface ContactPageContent {
  title: string;
  subtitle: string;
  email: string;
  phone: string;
  whatsapp: string;
  address: string;
  hours: string;
}

// ---------------- DEFAULT CONTENT TEMPLATES ---------------- //

export const DEFAULT_CANCELLATION_REFUND: PolicyPageContent = {
  title: "Cancellation and Refund Policy",
  lastUpdated: "August 27, 2026",
  intro:
    "We strive to give you a transparent, hassle-free shopping experience with clear cancellation and return timelines.",
  sections: [
    {
      id: "sec-1",
      title: "1. Order Cancellations",
      content:
        "You can cancel your order at any time before it has been dispatched from our warehouse. To cancel your order, please contact our support team with your order number. Once the order has been shipped, it cannot be cancelled, but it may be eligible for a return.",
    },
    {
      id: "sec-2",
      title: "2. Returns and Refunds",
      content:
        "We want you to be completely satisfied with your purchase. If for any reason you are not satisfied, we accept returns within 7 days of the delivery date, provided the items are unused, in their original packaging, with all tags intact, and in the same condition that you received them.",
    },
    {
      id: "sec-3",
      title: "3. Non-Returnable Items",
      content:
        "Certain items cannot be returned for hygiene and child safety reasons. These include:",
      bullets: [
        "Teethers, pacifiers, and feeding nipples",
        "Baby underwear, innerwear, and cloth diapers (if opened)",
        "Opened skincare, bath lotions, washes, and personal care products",
        "Items marked as Final Sale or Clearance",
      ],
    },
    {
      id: "sec-4",
      title: "4. Refund Process",
      content:
        "Once your return is received and inspected by our warehouse quality team, we will notify you of the approval or rejection of your refund. If approved, your refund will be processed, and a credit will automatically be applied to your original method of payment (e.g. via Razorpay, UPI, Credit/Debit Card) within 5-7 business days. Please note that original shipping costs are non-refundable unless the return was due to our error.",
    },
    {
      id: "sec-5",
      title: "5. Damaged or Defective Items",
      content:
        "If you receive a defective or damaged item, please contact us within 48 hours of delivery with photos/videos of the package and item defect. We will arrange a free reverse pickup and immediate replacement or full 100% refund at no additional charge to you.",
    },
  ],
};

export const DEFAULT_PRIVACY_POLICY: PolicyPageContent = {
  title: "Privacy Policy",
  lastUpdated: "August 27, 2026",
  intro:
    "Welcome to Zérah Baby And Kid's. We respect your privacy and are deeply committed to protecting your personal information.",
  sections: [
    {
      id: "sec-1",
      title: "1. Introduction",
      content:
        "This Privacy Policy describes how Zérah Baby And Kid's collects, uses, and safeguards your personal data when you visit our website, place orders, or interact with our customer support team.",
    },
    {
      id: "sec-2",
      title: "2. The Data We Collect",
      content:
        "We collect personal information necessary to provide our services and process your orders safely:",
      bullets: [
        "Identity Data: First name, last name, and family details you share with us.",
        "Contact Data: Delivery address, billing address, email address, and mobile phone number.",
        "Payment Data: Transaction IDs and payment confirmation details (processed securely via PCI-DSS compliant Razorpay — we never store your full card numbers).",
        "Order History: Details of products purchased, invoice amounts, and delivery tracking status.",
      ],
    },
    {
      id: "sec-3",
      title: "3. How We Use Your Data",
      content:
        "We use your personal data strictly to process and ship your orders, send order confirmation & tracking SMS/WhatsApp notifications, provide customer support, and improve your shopping experience.",
    },
    {
      id: "sec-4",
      title: "4. Data Security",
      content:
        "We implement industry-standard encryption, secure SSL connections, and access control measures to prevent unauthorized access, alteration, or disclosure of your data.",
    },
    {
      id: "sec-5",
      title: "5. Contact Our Privacy Team",
      content:
        "If you have any questions about this Privacy Policy or wish to request data correction or deletion, please contact us at support@zerahkids.com or +91 91703 14786.",
    },
  ],
};

export const DEFAULT_TERMS_CONDITIONS: PolicyPageContent = {
  title: "Terms and Conditions",
  lastUpdated: "August 27, 2026",
  intro:
    "Please read these terms and conditions carefully before using our website and placing orders with Zérah Baby And Kid's.",
  sections: [
    {
      id: "sec-1",
      title: "1. Acceptance of Terms",
      content:
        "By accessing and using this website, you agree to be bound by these Terms and Conditions, our Privacy Policy, and all applicable Indian laws and regulations.",
    },
    {
      id: "sec-2",
      title: "2. Product Information & Pricing",
      content:
        "We strive to display product colors, specifications, prices, and stock availability as accurately as possible. All prices are listed in Indian Rupees (INR) and include applicable GST taxes unless specified otherwise.",
    },
    {
      id: "sec-3",
      title: "3. Orders & Payment",
      content:
        "When you place an order, you agree that all details provided are true and accurate. Payments must be made via authorized online payment gateways (Razorpay, UPI, Net Banking, Cards) or confirmed Cash on Delivery if enabled.",
    },
    {
      id: "sec-4",
      title: "4. Shipping & Risk of Loss",
      content:
        "All items purchased from Zérah Baby And Kid's are made pursuant to a shipment contract with trusted courier partners. Risk of loss and title for items pass to you upon delivery by the carrier.",
    },
    {
      id: "sec-5",
      title: "5. Governing Law",
      content:
        "These terms shall be governed by and construed in accordance with the laws of India, and any disputes shall be subject to the exclusive jurisdiction of the competent courts.",
    },
  ],
};

export const DEFAULT_SHIPPING_DELIVERY: PolicyPageContent = {
  title: "Shipping and Delivery Policy",
  lastUpdated: "August 27, 2026",
  intro:
    "We take utmost care in packaging and shipping your baby essentials quickly, safely, and across all pin codes in India.",
  sections: [
    {
      id: "sec-1",
      title: "1. Order Processing Time",
      content:
        "All orders are processed and packaged within 1 to 2 business days (excluding Sundays and national holidays). Orders placed before 2:00 PM are dispatched on the same day whenever possible.",
    },
    {
      id: "sec-2",
      title: "2. Shipping Rates & Free Delivery",
      content:
        "Standard delivery fee across India is ₹79. We offer 100% FREE Delivery on all orders above ₹999 or for specially marked Free Delivery items. Exact delivery rates are calculated and shown upfront before checkout.",
    },
    {
      id: "sec-3",
      title: "3. Delivery Timelines",
      content:
        "Delivery typically takes up to 7 days across India.",
    },
    {
      id: "sec-4",
      title: "4. Live Order Tracking",
      content:
        "As soon as your package is dispatched, we send a tracking link and courier AWB number via SMS, WhatsApp, and email so you can track your delivery in real time.",
    },
    {
      id: "sec-5",
      title: "5. Missing or Delayed Packages",
      content:
        "If you haven't received your shipment within 7 business days of dispatch, please contact our support desk immediately at +91 91703 14786 with your order ID.",
    },
  ],
};

export const DEFAULT_RETURNS_POLICY: PolicyPageContent = {
  title: "Returns & Exchange Policy",
  lastUpdated: "August 27, 2026",
  intro:
    "Simple, transparent, and parent-friendly 7-day return policy for peace of mind with every purchase.",
  sections: [
    {
      id: "sec-1",
      title: "1. 7-Day Easy Return Window",
      content:
        "Items can be returned within 7 days from the date of delivery provided they are unused, unwashed, in original packaging, and with all tags intact.",
    },
    {
      id: "sec-2",
      title: "2. How to Request a Return",
      content:
        "To initiate a return, visit your 'My Orders' page on our website or contact our support team on WhatsApp at +91 91703 14786 with your Order ID and reason for return.",
    },
    {
      id: "sec-3",
      title: "3. Reverse Pickup",
      content:
        "Once your return request is approved, we will arrange a reverse courier pickup from your doorstep within 24 to 48 hours.",
    },
    {
      id: "sec-4",
      title: "4. Inspection & Instant Refund",
      content:
        "Upon receipt at our warehouse, our quality team inspects the returned item and initiates your refund within 24 hours to your original payment method.",
    },
  ],
};

export const DEFAULT_ABOUT_CONTENT: AboutPageContent = {
  title: "We're parents building the shop we always wanted",
  subtitle:
    "Curating the gentlest, safest organic clothing, developmental toys, and trusted baby gear for little ones across India.",
  story:
    "Zérah Baby And Kid's started in 2026 with a simple mission: two new parents frustrated by scratchy fabrics, mystery chemical lists, and flimsy gear decided to build a trusted sanctuary for parents. Today we curate hundreds of lab-tested, parent-approved essentials across clothing, toys, care, and nursery gear.",
  mission:
    "Our mission is to make safe, comfortable, non-toxic, and affordable baby care accessible to every parent with transparency, honest pricing, and genuine warmth.",
  values: [
    {
      title: "Gentle Materials",
      text: "100% GOTS certified organic cotton, food-grade silicone, and non-toxic water-based finishes come first.",
    },
    {
      title: "Tested Twice",
      text: "Every product is lab safety certified and tested hands-on by our parent panel before being listed.",
    },
    {
      title: "Honest Pricing",
      text: "No inflated MRPs or deceptive sales — real discounts, fair prices, and transparent delivery costs.",
    },
    {
      title: "Dedicated Parent Support",
      text: "Real humans on WhatsApp & call, 7 days a week from 8:00 AM to 9:00 PM.",
    },
  ],
};

export const DEFAULT_CONTACT_CONTENT: ContactPageContent = {
  title: "Get in touch with us",
  subtitle:
    "Have a question about an order, size, or product? Our support team is here to help you every day.",
  email: "support@zerahkids.com",
  phone: "+91 91703 14786",
  whatsapp: "+919170314786",
  address: "Zérah Baby & Kids, Sector 18, Main Retail Plaza, Gurugram, Haryana 122001, India",
  hours: "Monday to Sunday: 8:00 AM – 9:00 PM IST",
};

// ---------------- HOOKS FOR PAGE CONTENT ---------------- //

export function usePageContent<T>(pageKey: string, defaultContent: T) {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<T>({
    queryKey: ["page_content", pageKey],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("site_settings")
        .select("value")
        .eq("key", pageKey)
        .maybeSingle();

      if (error) {
        console.warn(`[PageContent] Fetch error for ${pageKey}:`, error);
        return defaultContent;
      }

      if (!data?.value) {
        return defaultContent;
      }

      try {
        const parsed = JSON.parse(data.value);
        return { ...defaultContent, ...parsed };
      } catch (err) {
        console.warn(`[PageContent] JSON parse error for ${pageKey}:`, err);
        return defaultContent;
      }
    },
    staleTime: 1000 * 60 * 5, // 5 mins
  });

  const save = useMutation({
    mutationFn: async (newContent: T) => {
      const jsonStr = JSON.stringify(newContent);
      const { error } = await supabase
        .from("site_settings")
        .upsert({ key: pageKey, value: jsonStr }, { onConflict: "key" });

      if (error) throw error;
      return newContent;
    },
    onSuccess: (savedData) => {
      toast.success("Page content updated and synced to live website!");
      qc.setQueryData(["page_content", pageKey], savedData);
      qc.invalidateQueries({ queryKey: ["page_content", pageKey] });
      qc.invalidateQueries({ queryKey: ["site_settings"] });
    },
    onError: (err: Error) => {
      toast.error(`Failed to save page content: ${err.message}`);
    },
  });

  const reset = useMutation({
    mutationFn: async () => {
      const jsonStr = JSON.stringify(defaultContent);
      const { error } = await supabase
        .from("site_settings")
        .upsert({ key: pageKey, value: jsonStr }, { onConflict: "key" });

      if (error) throw error;
      return defaultContent;
    },
    onSuccess: () => {
      toast.success("Page reset to standard default template");
      qc.setQueryData(["page_content", pageKey], defaultContent);
      qc.invalidateQueries({ queryKey: ["page_content", pageKey] });
      qc.invalidateQueries({ queryKey: ["site_settings"] });
    },
    onError: (err: Error) => {
      toast.error(`Reset failed: ${err.message}`);
    },
  });

  return {
    content: data ?? defaultContent,
    isLoading,
    save: save.mutate,
    isSaving: save.isPending,
    resetToDefault: reset.mutate,
    isResetting: reset.isPending,
  };
}
