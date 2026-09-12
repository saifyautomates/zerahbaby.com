//
import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 1000 * 30, // 30 seconds default before marking stale
        gcTime: 1000 * 60 * 10, // 10 minutes cache garbage collection
        retry: 1, // Reduce retries for faster failure feedback
        refetchOnWindowFocus: true, // Automatically synchronize when user switches tabs/windows
        refetchOnReconnect: true,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPreloadStaleTime: 1000 * 60 * 2, // 2 minutes: reuse preloaded data without spamming network requests
  });

  return router;
};
