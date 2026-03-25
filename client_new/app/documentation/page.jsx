'use client';

import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { Link } from "react-scroll";

const Documentation = () => {
  return (
    <div className="doc-page-container">
      <Navbar />

      <div className="doc-layout">
        {/* LEFT NAV SIDEBAR */}
        <aside className="doc-sidebar">
          <div className="sidebar-group">
            <h3 className="sidebar-heading">Knowledge Base</h3>
            <Link to="doc-section-1" spy={true} smooth={true} offset={-100} duration={500} className="doc-main-link" activeClass="active">
              What is Deepfake?
            </Link>
            <ul className="doc-sub-list">
              <li><Link to="doc-section-1-intro" spy={true} smooth={true} offset={-120} duration={500}>Introduction</Link></li>
              <li><Link to="doc-section-1-how" spy={true} smooth={true} offset={-120} duration={500}>How it Works</Link></li>
              <li><Link to="doc-section-1-types" spy={true} smooth={true} offset={-120} duration={500}>Types</Link></li>
              <li><Link to="doc-section-1-danger" spy={true} smooth={true} offset={-120} duration={500}>Dangers</Link></li>
            </ul>
          </div>

          <div className="sidebar-group">
            <h3 className="sidebar-heading">Detection Logic</h3>
            <Link to="doc-section-2" spy={true} smooth={true} offset={-100} duration={500} className="doc-main-link" activeClass="active">
              How Our AI Detects
            </Link>
            <ul className="doc-sub-list">
              <li><Link to="doc-section-2-lips" spy={true} smooth={true} offset={-120} duration={500}>Lips Manipulation</Link></li>
              <li><Link to="doc-section-2-face" spy={true} smooth={true} offset={-120} duration={500}>Face Analysis</Link></li>
              <li><Link to="doc-section-2-audio" spy={true} smooth={true} offset={-120} duration={500}>Audio Patterns</Link></li>
            </ul>
          </div>

          <div className="sidebar-group">
            <h3 className="sidebar-heading">Guidelines</h3>
            <Link to="doc-section-3" spy={true} smooth={true} offset={-100} duration={500} className="doc-main-link" activeClass="active">
              How to Check
            </Link>
          </div>
        </aside>

        {/* MAIN CONTENT AREA */}
        <main className="doc-content-area">
          <section id="doc-section-1" className="content-section">
            <div className="doc-badge">Module 01</div>
            <h1 className="main-doc-title">What is Deepfake?</h1>

            <div id="doc-section-1-intro">
              <h2 className="section-subtitle">Introduction to Deepfakes</h2>
              <p className="intro-text">Deepfakes are artificially generated or altered videos, images, or audio clips that use artificial intelligence to manipulate content in a way that appears realistic.</p>
            </div>

            <div id="doc-section-1-how" className="feature-card">
              <p>Deepfake technology is powered by deep learning techniques, particularly Generative Adversarial Networks (GANs), which train on large datasets.</p>
            </div>

            <div id="doc-section-1-types">
              <h2 className="section-subtitle">Deepfake Creation Steps</h2>
              <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 12 }}>
                <tbody>
                  {[
                    { title: "Data Collection", details: "Thousands of images gathered for training." },
                    { title: "Encoding", details: "AI models map facial features and voice patterns." },
                    { title: "Training", details: "A GAN learns to refine synthetic outputs." },
                    { title: "Rendering", details: "Final face swap or voice clone is generated." },
                  ].map(item => (
                    <tr key={item.title} style={{ borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
                      <td style={{ padding: "10px 12px", fontWeight: 600, width: "30%", color: "#333" }}>{item.title}</td>
                      <td style={{ padding: "10px 12px", color: "#666" }}>{item.details}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div id="doc-section-1-danger">
              <h2 className="section-subtitle">Risk Assessment</h2>
              <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 12 }}>
                <tbody>
                  {[
                    { title: "Misinformation", details: "Politicians and public figures misrepresented." },
                    { title: "Fraud", details: "Identity theft for malicious purposes." },
                    { title: "Cybersecurity", details: "Deepfake phishing attacks are rising." },
                  ].map(item => (
                    <tr key={item.title} style={{ borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
                      <td style={{ padding: "10px 12px", fontWeight: 600, width: "30%", color: "#333" }}>{item.title}</td>
                      <td style={{ padding: "10px 12px", color: "#666" }}>{item.details}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section id="doc-section-2" className="content-section">
            <div className="doc-badge">Module 02</div>
            <h1 className="main-doc-title">How Our AI Detects Deepfakes</h1>
            <p className="intro-text">Our software analyzes three key modalities:</p>

            <div id="doc-section-2-lips" className="modality-box">
              <h3 className="doc-table-title">Lips Manipulation Detection</h3>
              <ul className="modern-list">
                <li>Phoneme-to-viseme matching to compare spoken words with lip movements.</li>
                <li>Detection of speech track mismatches artificially added to video.</li>
              </ul>
            </div>

            <div id="doc-section-2-face" className="modality-box">
              <h3 className="doc-table-title">Face Manipulation Detection</h3>
              <ul className="modern-list">
                <li>Detects unnatural blending, skin texture inconsistencies, and unrealistic expressions.</li>
                <li>GAN-based analysis for unnatural frame transitions.</li>
              </ul>
            </div>

            <div id="doc-section-2-audio" className="modality-box">
              <h3 className="doc-table-title">Audio Patterns</h3>
              <ul className="modern-list">
                <li>Timbre fingerprinting to detect AI-cloned voices.</li>
                <li>Segment-by-segment spectral analysis for audio deepfakes.</li>
              </ul>
            </div>
          </section>

          <section id="doc-section-3" className="content-section">
            <div className="doc-badge">Module 03</div>
            <h1 className="main-doc-title">How to Check?</h1>
            <div className="steps-container">
              <div id="doc-section-3-step1" className="step-card">
                <span className="step-count">Step 1</span>
                <p>Upload your video (MP4, AVI, MOV) through our secure portal.</p>
              </div>
              <div id="doc-section-3-step2" className="step-card">
                <span className="step-count">Step 2</span>
                <p>AI processing extracts frames and scans for irregularities.</p>
              </div>
              <div id="doc-section-3-step3" className="step-card">
                <span className="step-count">Step 3</span>
                <p>Get a detailed report with confidence scores for each manipulation type.</p>
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
