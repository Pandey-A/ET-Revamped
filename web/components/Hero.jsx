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
      <div
        className="absolute inset-x-0 top-0 h-[400px] opacity-60 z-[1]"
        style={{
          background: "linear-gradient(to right, #e0f2ff, #f3e8ff, #ffe4e6)",
          maskImage: "radial-gradient(ellipse at top, black 20%, transparent 80%)",
          WebkitMaskImage: "radial-gradient(ellipse at top, black 20%, transparent 80%)",
        }}
      />

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

      <motion.div
        className="relative z-10 mx-auto flex w-full max-w-[1360px] flex-col items-center text-center gap-8 px-4 sm:px-6 lg:px-10 pt-[150px] md:pt-[170px] pb-[72px]"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        <motion.h1
          className="text-left md:text-center font-sans leading-[1.1] tracking-[-0.04em] text-[#1a1a1a]"
          style={{ fontSize: "clamp(34px, 6vw, 84px)", fontWeight: 400, marginBottom: 20 }}
          variants={itemVariants}
        >
          Build & Deploy <br />
          <span className="font-serif italic" style={{ fontSize: "1.1em" }}>AI Agents</span>
          <span> for Your Business</span>
        </motion.h1>

        <motion.p
          className="max-w-[680px] text-left md:text-center font-sans font-light text-[15px] text-[#666] md:text-lg"
          style={{ lineHeight: 1.6, marginBottom: 28 }}
          variants={itemVariants}
        >
          Chattiq helps you launch intelligent agents on your website and WhatsApp —
          with admin controls, credits billing, and knowledge-base powered answers.
        </motion.p>

        <motion.div
          className="flex w-full max-w-[700px] flex-col items-center gap-4"
          variants={itemVariants}
        >
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/register"
              style={{
                background: "#111",
                color: "white",
                padding: "14px 36px",
                borderRadius: "100px",
                fontWeight: 500,
                fontSize: 15,
                textDecoration: "none",
                whiteSpace: "nowrap",
              }}
            >
              Get Started
            </Link>
            <Link
              href="/widget-generator"
              style={{
                background: "#fff",
                color: "#111",
                padding: "14px 36px",
                borderRadius: "100px",
                fontWeight: 500,
                fontSize: 15,
                textDecoration: "none",
                border: "1px solid rgba(0,0,0,0.12)",
                whiteSpace: "nowrap",
              }}
            >
              Widget Generator
            </Link>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3 text-sm text-[#444]">
            <span style={{ letterSpacing: 2, color: "#000" }}>★★★★★</span>
            <span>Web · WhatsApp</span>
          </div>
        </motion.div>
      </motion.div>
    </section>
  );
};

export default Hero;
