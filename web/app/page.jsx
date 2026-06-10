import Navbar from "@/components/Navbar";
import Hero from "@/components/Hero";
import Details from "@/components/Details";
import Footer from "@/components/Footer";

export const metadata = {
  title: "Home | Chattiq",
  description: "AI agent platform for web widgets and WhatsApp",
};

export default function Home() {
  return (
    <div>
      <Navbar />
      <main>
        <Hero />
        <Details />
      </main>
      <Footer />
    </div>
  );
}
