import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { CheckCircle2, XCircle, Clock } from "lucide-react";

export function SMSLogsTab() {
  const { data: logs, isLoading } = useQuery({
    queryKey: ["sms_logs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sms_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) throw error;
      return data;
    },
    // Poll every 30 seconds for new logs
    refetchInterval: 30000,
  });

  if (isLoading) {
    return <div className="p-8 text-center text-muted-foreground">Loading SMS logs...</div>;
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h2 className="font-display text-2xl font-bold">SMS Delivery Logs</h2>
        <p className="text-sm text-muted-foreground">
          View recent transactional SMS events and their delivery status.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Timestamp</th>
                <th className="px-4 py-3 font-medium">Phone</th>
                <th className="px-4 py-3 font-medium">Event Type</th>
                <th className="px-4 py-3 font-medium">Order ID</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Error Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {!logs?.length ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                    No SMS logs found.
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.id} className="transition-colors hover:bg-muted/30">
                    <td className="px-4 py-3 whitespace-nowrap">
                      {new Date(log.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 font-medium">{log.phone}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-700/10">
                        {log.message_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {log.order_id ? log.order_id.substring(0, 8) + "..." : "-"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        {log.provider_status === "sent" ||
                        log.provider_status === "mock_success" ? (
                          <>
                            <CheckCircle2 className="size-4 text-green-500" />
                            <span className="text-green-700 font-medium">Sent</span>
                          </>
                        ) : log.provider_status === "error" ? (
                          <>
                            <XCircle className="size-4 text-red-500" />
                            <span className="text-red-700 font-medium">Failed</span>
                          </>
                        ) : (
                          <>
                            <Clock className="size-4 text-amber-500" />
                            <span className="text-amber-700 font-medium">
                              {log.provider_status || "Pending"}
                            </span>
                          </>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-red-600 max-w-[200px] truncate">
                      {log.error_details || "-"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
