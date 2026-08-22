import {
  Package,
  ShoppingBag,
  Users,
  Scan,
  Settings,
  ArrowRight,
  TrendingUp,
  Plus,
} from "lucide-react";
import { useSession } from "@/lib/auth";

export function DashboardTab({ onNavigate }: { onNavigate?: (tab: string) => void }) {
  const { user } = useSession();

  const userName = user?.email
    ? user.email
        .split("@")[0]
        .replace(/[._]/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase())
    : "Admin";

  const quickActions = [
    {
      title: "Add Product",
      description: "Create a new product in your catalog",
      icon: Plus,
      color: "bg-blue-50 text-blue-600",
      tab: "products",
    },
    {
      title: "Open POS",
      description: "Process offline sales and scan barcodes",
      icon: Scan,
      color: "bg-emerald-50 text-emerald-600",
      tab: "pos",
    },
    {
      title: "View Orders",
      description: "Manage online sales and fulfillments",
      icon: ShoppingBag,
      color: "bg-purple-50 text-purple-600",
      tab: "orders",
    },
    {
      title: "Manage Inventory",
      description: "Update stock levels and pricing",
      icon: Package,
      color: "bg-amber-50 text-amber-600",
      tab: "inventory",
    },
    {
      title: "View Customers",
      description: "Manage your online and offline customer base",
      icon: Users,
      color: "bg-rose-50 text-rose-600",
      tab: "customers",
    },
    {
      title: "Analytics",
      description: "View detailed reports and store performance",
      icon: TrendingUp,
      color: "bg-indigo-50 text-indigo-600",
      tab: "analytics",
    },
  ];

  return (
    <div className="mx-auto max-w-4xl pt-8 pb-16">
      {/* Welcome Header */}
      <div className="mb-10 text-center">
        <h1 className="text-3xl font-extrabold tracking-tight text-gray-900 sm:text-4xl mb-2">
          Welcome back, {userName}
        </h1>
        <p className="text-gray-500 text-sm max-w-lg mx-auto">
          This is your store's control center. Manage products, process sales, and navigate quickly
          to where you need to be.
        </p>
      </div>

      {/* Quick Actions Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {quickActions.map((action) => {
          const Icon = action.icon;
          return (
            <button
              key={action.title}
              onClick={() => onNavigate && onNavigate(action.tab)}
              className="group flex flex-col text-left rounded-2xl bg-white p-6 shadow-sm border border-gray-100 hover:shadow-md hover:border-gray-200 transition-all duration-200"
            >
              <div className={"flex h-12 w-12 items-center justify-center rounded-xl mb-4 "}>
                <Icon className="h-6 w-6" />
              </div>
              <h3 className="text-base font-bold text-gray-900 mb-1 group-hover:text-[#8B2020] transition-colors">
                {action.title}
              </h3>
              <p className="text-xs text-gray-500 flex-1">{action.description}</p>
              <div className="mt-4 flex items-center text-xs font-semibold text-gray-400 group-hover:text-[#8B2020] transition-colors">
                <span>Go to {action.title.split(" ").pop()}</span>
                <ArrowRight className="h-3 w-3 ml-1" />
              </div>
            </button>
          );
        })}
      </div>

      {/* Settings Shortcut */}
      <div className="mt-8 rounded-2xl bg-gray-50 border border-gray-100 p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div>
          <h4 className="text-sm font-bold text-gray-900">Store Settings</h4>
          <p className="text-xs text-gray-500 mt-1">
            Manage your store's configuration, administrators, and general preferences.
          </p>
        </div>
        <button
          onClick={() => onNavigate && onNavigate("settings")}
          className="flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm border border-gray-200 hover:bg-gray-50 transition-colors whitespace-nowrap"
        >
          <Settings className="h-4 w-4 text-gray-500" />
          Open Settings
        </button>
      </div>
    </div>
  );
}
