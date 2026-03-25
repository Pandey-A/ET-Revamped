'use client';

import Link from "next/link";
import { motion } from "motion/react";

const Hero = () => {
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { staggerChildren: 0.15, delayChildren: 0.1 },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 30 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.8, ease: [0.25, 0.46, 0.45, 0.94] },
    },
  };

  return (
    <section className="relative min-h-screen w-full overflow-hidden">
      {/* Visual Accents */}
      <div
        className="absolute inset-x-0 top-0 h-[400px] opacity-60 z-[1]"
        style={{
          background: "linear-gradient(to right, #e0f2ff, #f3e8ff, #ffe4e6)",
          maskImage: "radial-gradient(ellipse at top, black 20%, transparent 80%)",
          WebkitMaskImage: "radial-gradient(ellipse at top, black 20%, transparent 80%)",
        }}
      />

      {/* Background Video */}
      <div className="absolute inset-0 z-0">
        <video
          autoPlay
          loop
          muted
          playsInline
          className="h-full w-full object-cover opacity-45"
          style={{ transform: "scaleY(-1)" }}
        >
          <source
            src="https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260302_085640_276ea93b-d7da-4418-a09b-2aa5b490e838.mp4"
            type="video/mp4"
          />
        </video>
        <div
          className="absolute inset-0"
          style={{
            background: "linear-gradient(to bottom, transparent, rgba(255,255,255,0.5) 40%, #ffffff 80%)",
          }}
        />
      </div>

      {/* Animated Content */}
      <motion.div
        className="relative z-10 mx-auto flex max-w-[1000px] flex-col items-center text-center gap-8 px-6 pt-[180px] pb-[80px]"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        <motion.h1
          className="text-left md:text-center font-sans leading-[1.1] tracking-[-0.04em] text-[#1a1a1a]"
          style={{ fontSize: "clamp(48px, 6vw, 84px)", fontWeight: 400, marginBottom: 24 }}
          variants={itemVariants}
        >
          Upload to Uncover <br />
          <span className="font-serif italic" style={{ fontSize: "1.1em" }}>Deepfakes</span>
          <span> with AI</span>
          <br />
          Precision
        </motion.h1>

        <motion.p
          className="max-w-[554px] text-left md:text-center font-sans font-light text-base text-[#666] md:text-lg"
          style={{ lineHeight: 1.6, marginBottom: 40 }}
          variants={itemVariants}
        >
          Discover an advanced AI-assisted verifier that detects facial
          inconsistencies, lip-sync drift, and audio manipulation with confidence.
        </motion.p>

        <motion.div
          className="flex w-full max-w-[520px] flex-col items-center gap-4"
          variants={itemVariants}
        >
          {/* CTA Pill */}
          <div
            className="flex w-full items-center"
            style={{
              background: "#fff",
              border: "1px solid rgba(0,0,0,0.1)",
              borderRadius: "100px",
              boxShadow: "0 20px 40px rgba(0,0,0,0.05)",
              overflow: "hidden",
            }}
          >
            <input
              type="text"
              placeholder="Paste video URL..."
              className="flex-1 border-none px-6 text-base text-[#333] bg-transparent outline-none py-3"
            />
            <Link
              href="/upload"
              style={{
                background: "#111",
                color: "white",
                padding: "12px 32px",
                borderRadius: "100px",
                fontWeight: 500,
                fontSize: 15,
                textDecoration: "none",
                whiteSpace: "nowrap",
                transition: "background 0.2s",
              }}
            >
              Verify Now
            </Link>
          </div>

          {/* Social Proof */}
          <div className="flex items-center gap-3 text-sm text-[#444]">
            <span style={{ letterSpacing: 2, color: "#000" }}>★★★★★</span>
            <span>Trusted by 200+ security researchers</span>
          </div>
        </motion.div>
      </motion.div>
    </section>
  );
};

export default Hero;
