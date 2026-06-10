import { FaComments, FaWhatsapp, FaBook } from "react-icons/fa";

const Details = () => {
  return (
    <section className="features-section">
      <div className="details-content-wrapper">
        <div className="section-navigation">
          <span className="section-caption">Platform Capabilities</span>
        </div>

        <h2 className="main-title">
          <span>Deploy AI Agents</span> Across Web and WhatsApp
        </h2>

        <p className="main-subtitle">
          Build, configure, and monitor intelligent agents from one admin dashboard — with credits,
          knowledge bases, and channel-specific flows.
        </p>

        <div className="modality-grid">
          <article className="modality-card">
            <div className="card-number">01</div>
            <div className="icon-wrapper icon-eye"><FaComments /></div>
            <h3 className="card-title">Web Widget</h3>
            <p className="card-description">
              Embed a branded chat widget on any site. Sessions, lead capture, and agent routing are
              handled through the Chattiq API with real-time streaming responses.
            </p>
            <div className="card-tags">
              <span>Embeddable script</span>
              <span>Session memory</span>
            </div>
          </article>

          <article className="modality-card">
            <div className="card-number">02</div>
            <div className="icon-wrapper icon-lips"><FaWhatsapp /></div>
            <h3 className="card-title">WhatsApp Channels</h3>
            <p className="card-description">
              Connect Meta WhatsApp Business numbers to dedicated AI agents. Supports welcome flows,
              menus, bookings, broadcasts, and per-channel configuration from the admin panel.
            </p>
            <div className="card-tags">
              <span>Multi-number</span>
              <span>Webhook routing</span>
            </div>
          </article>

          <article className="modality-card">
            <div className="card-number">03</div>
            <div className="icon-wrapper icon-audio"><FaBook /></div>
            <h3 className="card-title">Knowledge & RAG</h3>
            <p className="card-description">
              Upload documents and URLs so agents answer from your content. Vector search via Weaviate
              keeps responses grounded in your business knowledge.
            </p>
            <div className="card-tags">
              <span>Document Q&A</span>
              <span>Agent resources</span>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
};

export default Details;
