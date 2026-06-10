'use client';

import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { Link } from "react-scroll";

const Documentation = () => {
  return (
    <div className="doc-page-container">
      <Navbar />

      <div className="doc-layout">
        <aside className="doc-sidebar">
          <div className="sidebar-group">
            <h3 className="sidebar-heading">Getting Started</h3>
            <Link to="doc-section-1" spy smooth offset={-100} duration={500} className="doc-main-link" activeClass="active">
              What is Chattiq?
            </Link>
            <ul className="doc-sub-list">
              <li><Link to="doc-section-1-intro" spy smooth offset={-120} duration={500}>Overview</Link></li>
              <li><Link to="doc-section-1-channels" spy smooth offset={-120} duration={500}>Channels</Link></li>
              <li><Link to="doc-section-1-credits" spy smooth offset={-120} duration={500}>Credits</Link></li>
            </ul>
          </div>

          <div className="sidebar-group">
            <h3 className="sidebar-heading">Configuration</h3>
            <Link to="doc-section-2" spy smooth offset={-100} duration={500} className="doc-main-link" activeClass="active">
              Agents & Knowledge
            </Link>
            <ul className="doc-sub-list">
              <li><Link to="doc-section-2-agents" spy smooth offset={-120} duration={500}>AI Agents</Link></li>
              <li><Link to="doc-section-2-whatsapp" spy smooth offset={-120} duration={500}>WhatsApp</Link></li>
              <li><Link to="doc-section-2-widget" spy smooth offset={-120} duration={500}>Web Widget</Link></li>
            </ul>
          </div>

          <div className="sidebar-group">
            <h3 className="sidebar-heading">Launch</h3>
            <Link to="doc-section-3" spy smooth offset={-100} duration={500} className="doc-main-link" activeClass="active">
              Go Live
            </Link>
          </div>
        </aside>

        <main className="doc-content-area">
          <section id="doc-section-1" className="content-section">
            <div className="doc-badge">Module 01</div>
            <h1 className="main-doc-title">What is Chattiq?</h1>

            <div id="doc-section-1-intro">
              <h2 className="section-subtitle">Overview</h2>
              <p className="intro-text">
                Chattiq is an AI agent platform for deploying conversational assistants on your website
                and WhatsApp Business. You manage agents, channels, credits, and knowledge bases
                from a single admin dashboard.
              </p>
            </div>

            <div id="doc-section-1-channels" className="feature-card">
              <h2 className="section-subtitle">Supported Channels</h2>
              <ul className="modern-list">
                <li><strong>Web widget</strong> — embeddable script for any site.</li>
                <li><strong>WhatsApp</strong> — Meta Cloud API with per-number routing.</li>
              </ul>
            </div>

            <div id="doc-section-1-credits">
              <h2 className="section-subtitle">Credits & Billing</h2>
              <p className="intro-text">
                Usage is tracked per account in Redis. Greeting messages can bypass credit charges when
                configured in the greeting data file. View balance and token usage in the Credits dashboard.
              </p>
            </div>
          </section>

          <section id="doc-section-2" className="content-section">
            <div className="doc-badge">Module 02</div>
            <h1 className="main-doc-title">Agents & Knowledge</h1>

            <div id="doc-section-2-agents" className="modality-box">
              <h3 className="doc-table-title">AI Agents</h3>
              <ul className="modern-list">
                <li>Create agents in Admin → AI Agents with instructions and model settings.</li>
                <li>Attach resources (PDFs, URLs) for retrieval-augmented answers.</li>
                <li>Sync agent metadata to the FastAPI runtime after changes.</li>
              </ul>
            </div>

            <div id="doc-section-2-whatsapp" className="modality-box">
              <h3 className="doc-table-title">WhatsApp Setup</h3>
              <ul className="modern-list">
                <li>Callback URL: <code>https://chatiq.co.in/webhook/whatsapp</code></li>
                <li>Verify token must match <code>WHATSAPP_VERIFY_TOKEN</code> on the server.</li>
                <li>Add WABA ID, Phone Number ID, and access token in Admin → WhatsApp Channels.</li>
              </ul>
            </div>

            <div id="doc-section-2-widget" className="modality-box">
              <h3 className="doc-table-title">Web Widget</h3>
              <ul className="modern-list">
                <li>Use Widget Generator to copy the embed snippet.</li>
                <li>Set <code>data-api-base</code> to your production origin (e.g. https://chatiq.co.in).</li>
                <li>Widget sessions proxy through Next.js BFF routes to the AI runtime.</li>
              </ul>
            </div>
          </section>

          <section id="doc-section-3" className="content-section">
            <div className="doc-badge">Module 03</div>
            <h1 className="main-doc-title">Go Live</h1>
            <div className="steps-container">
              <div className="step-card">
                <span className="step-count">Step 1</span>
                <p>Register and create your first AI agent in the admin panel.</p>
              </div>
              <div className="step-card">
                <span className="step-count">Step 2</span>
                <p>Connect WhatsApp or embed the web widget on your site.</p>
              </div>
              <div className="step-card">
                <span className="step-count">Step 3</span>
                <p>Monitor conversations in Chat Dashboard and manage credits as needed.</p>
              </div>
            </div>
          </section>
        </main>
      </div>
      <Footer />
    </div>
  );
};

export default Documentation;
