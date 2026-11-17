import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router";
import Index from "./pages/Index";
import CreateInvoice from "./pages/CreateInvoice";
import ViewInvoice from "./pages/ViewInvoice";
import NotFound from "./pages/NotFound";
import Agents from "./pages/Agents";
import ApproveAgent from "./pages/ApproveAgent";
import AuthorizeAgent from "./pages/oauth/AuthorizeAgent";
import Clients from "./pages/Clients";
import Templates from "./pages/Templates";
import Activity from "./pages/Activity";
import { CloudSyncRuntime } from "@/components/sync/CloudSyncRuntime";
import { Footer } from "@/components/Footer";
import { AppThemeProvider } from "@/components/AppThemeProvider";

import { useEffect } from "react";
import { env } from "@/env";

const queryClient = new QueryClient();

const App = () => {
  useEffect(() => {
    if (env.VITE_APP_ENV === "DEVELOPMENT") {
      const link = document.querySelector("link[rel*='icon']") as HTMLLinkElement;
      if (link) {
        link.href = "/favicon-dev.svg";
      }
    }
  }, []);

  return (
    <AppThemeProvider>
    <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Sonner />
      <CloudSyncRuntime />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/create" element={<CreateInvoice />} />
          <Route path="/create/:id" element={<CreateInvoice />} />
          <Route path="/invoice/:id" element={<ViewInvoice />} />
          <Route path="/agents" element={<Agents />} />
          <Route path="/agents/approve" element={<ApproveAgent />} />
          <Route path="/agents/authorize" element={<AuthorizeAgent />} />
          <Route path="/clients" element={<Clients />} />
          <Route path="/templates" element={<Templates />} />
          <Route path="/activity" element={<Activity />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
        <Footer />
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
    </AppThemeProvider>
  );
};

export default App;
