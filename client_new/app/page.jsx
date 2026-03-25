import Navbar from "@/components/Navbar";
import Hero from "@/components/Hero";
import Details from "@/components/Details";
import Footer from "@/components/Footer";

export const metadata = {
  title: "Home | ElevateTrust.AI",
  description: "Advanced AI deepfake detection platform",
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
