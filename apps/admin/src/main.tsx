import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import { SessionProvider } from "./auth/Session";
import { ToastProvider } from "./ui/ToastContext";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: (count, error) => count < 2 && !(error as { status?: number }).status?.toString().startsWith("4"),
      refetchOnWindowFocus: false,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </SessionProvider>
    </QueryClientProvider>
  </StrictMode>,
);
