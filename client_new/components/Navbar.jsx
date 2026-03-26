'use client';

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";

const Navbar = () => {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  const panelRef = useRef(null);
  const btnRef = useRef(null);

  const { user, isAuthenticated, isLoading, logout } = useAuth();

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 40);
    const handleResize = () => setIsMobile(window.innerWidth <= 900);
    handleResize();
    window.addEventListener("scroll", handleScroll);
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : "auto";
  }, [mobileOpen]);

  useEffect(() => {
    function handleClickOutside(e) {
      if (
        mobileOpen &&
        panelRef.current &&
        !panelRef.current.contains(e.target) &&
        btnRef.current &&
        !btnRef.current.contains(e.target)
      ) {
        setMobileOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [mobileOpen]);

  const authRight = (mobileMenu = false) => {
    if (isLoading) return <div className="text-sm font-light text-black">...</div>;

    if (!isAuthenticated) {
      return (
        <div className="flex items-center gap-4">
          <Link
            href="/register"
            className={`${mobileMenu ? "block" : "hidden sm:block"} text-sm font-light border border-black rounded-full px-5 py-2.5 text-black transition-colors hover:opacity-70`}
          >
            Sign up
          </Link>
          <Link
            href="/login"
            className="rounded-full bg-gradient-to-b from-[#3a3a3a] to-[#1a1a1a] px-5 py-2.5 text-sm font-light text-white shadow-[inset_-4px_-6px_25px_0px_rgba(201,201,201,0.08),inset_4px_4px_10px_0px_rgba(29,29,29,0.24)] transition-all hover:opacity-90"
          >
            Sign in
          </Link>
        </div>
      );
    }

    return (
      <div className="flex items-center gap-4">
        <span className="hidden sm:block text-sm font-light text-black">{user?.userName || user?.email}</span>
        <button
          onClick={logout}
          className="rounded-full bg-gradient-to-b from-[#e53e3e] to-[#c53030] px-5 py-2.5 text-sm font-light text-white shadow-md transition-all hover:opacity-90"
        >
          Logout
        </button>
      </div>
    );
  };

  const closeMobile = () => setMobileOpen(false);

  return (
    <header className={`fixed left-0 right-0 top-0 z-50 px-3 sm:px-5 lg:px-8 transition-all duration-300 ${scrolled ? 'pt-2' : 'pt-4'}`}>
      <nav className="mx-auto flex w-full max-w-[1440px] items-center justify-between rounded-full border border-white/60 bg-white/70 px-4 py-3 sm:px-6 shadow-[0px_4px_24px_0px_rgba(0,0,0,0.04)] backdrop-blur-xl">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2" onClick={closeMobile}>
          <div className="flex h-10 w-28 items-center justify-center">
            <img src="/assets/img/logo.png" alt="Logo" className="h-8 w-auto" />
          </div>
        </Link>

        {/* Desktop Navigation Links */}
        {!isMobile && (
          <div className="hidden items-center gap-8 md:flex">
            <Link href="/" className="text-sm font-light text-black transition-colors hover:opacity-70">Home</Link>
            <Link href="/documentation" className="text-sm font-light text-black transition-colors hover:opacity-70">Features</Link>
            {user?.role === "user" && (
              <Link href="/upload" className="text-sm font-light text-black transition-colors hover:opacity-70">Functionality</Link>
            )}
            {user?.role === "admin" && (
              <Link href="/admin" className="text-sm font-light text-black transition-colors hover:opacity-70">Admin</Link>
            )}
            {!user?.role && (
              <Link href="/upload" className="text-sm font-light text-black transition-colors hover:opacity-70">Functionality</Link>
            )}
          </div>
        )}

        {/* Right Section */}
        <div className="flex items-center gap-4">
          {!isMobile && authRight(false)}
          {isMobile && (
            <button
              ref={btnRef}
              className="flex flex-col gap-1.5 p-2"
              onClick={() => setMobileOpen(prev => !prev)}
              aria-label="Menu"
            >
              <span className={`block h-[2px] w-6 bg-black transition-transform duration-300 ${mobileOpen ? 'translate-y-2 rotate-45' : ''}`}></span>
              <span className={`block h-[2px] w-6 bg-black transition-opacity duration-300 ${mobileOpen ? 'opacity-0' : 'opacity-100'}`}></span>
              <span className={`block h-[2px] w-6 bg-black transition-transform duration-300 ${mobileOpen ? '-translate-y-2 -rotate-45' : ''}`}></span>
            </button>
          )}
        </div>
      </nav>

      {/* Mobile Panel */}
      {isMobile && mobileOpen && (
        <div
          ref={panelRef}
          className="absolute left-3 right-3 top-[76px] mt-2 rounded-2xl border border-white/60 bg-white/95 px-5 py-5 shadow-xl backdrop-blur-xl flex flex-col gap-4 z-40 sm:left-5 sm:right-5"
        >
          <Link href="/" onClick={closeMobile} className="text-base font-medium text-black">Home</Link>
          <Link href="/documentation" onClick={closeMobile} className="text-base font-medium text-black">Features</Link>
          {user?.role === "user" && (
            <Link href="/upload" onClick={closeMobile} className="text-base font-medium text-black">Functionality</Link>
          )}
          {user?.role === "admin" && (
            <Link href="/admin" onClick={closeMobile} className="text-base font-medium text-black">Admin</Link>
          )}
          {!user?.role && (
            <Link href="/upload" onClick={closeMobile} className="text-base font-medium text-black">Functionality</Link>
          )}
          <div className="mt-4 border-t border-gray-200 pt-4 flex flex-col gap-3">
            {authRight(true)}
          </div>
        </div>
      )}
    </header>
  );
};

export default Navbar;
