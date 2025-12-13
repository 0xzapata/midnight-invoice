import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import CreateInvoice from "./pages/CreateInvoice";
import ViewInvoice from "./pages/ViewInvoice";
import NotFound from "./pages/NotFound";
import { Footer } from "@/components/Footer";

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
    <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/create" element={<CreateInvoice />} />
          <Route path="/create/:id" element={<CreateInvoice />} />
          <Route path="/invoice/:id" element={<ViewInvoice />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
        <Footer />
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
  );
};

export default App;
