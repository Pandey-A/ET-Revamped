
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import MyIssues from "./pages/MyIssues";
import ResourceBase from "./pages/ResourceBase";
import NotFound from "./pages/NotFound";
import { ToastContainer } from 'react-toastify';
import AiAgent from "./pages/AiAgent";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter basename="/admin" >
          <ToastContainer />
          
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/my-issues" element={<MyIssues />} />
          <Route path="/resource-base" element={<ResourceBase />} />
          <Route path="/ai-agent" element={<AiAgent />} />
          <Route path="/resource-base/:agentName?" element={<ResourceBase />} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
