import { FaEye, FaWaveSquare } from "react-icons/fa";
import { GiLips } from "react-icons/gi";

const Details = () => {
  return (
    <section className="deepfake-detection-container">
      <div className="details-content-wrapper">
        <div className="section-navigation">
          <span className="section-caption">Capability Matrix</span>
        </div>

        <h2 className="main-title">
          <span>Expose Deepfakes</span> with Cinematic-Grade AI Instrumentation
        </h2>

        <p className="main-subtitle">
          Three synchronized verification layers help you investigate manipulated media with
          fast, explainable AI signals.
        </p>

        <div className="modality-grid">
          <article className="modality-card">
            <div className="card-number">01</div>
            <div className="icon-wrapper icon-eye"><FaEye /></div>
            <h3 className="card-title">Face Analysis</h3>
            <p className="card-description">
              Our AI-powered detection system analyzes facial inconsistencies and unnatural movements to uncover deepfakes with precision. It detects micro-expressions and motion anomalies.
            </p>
            <div className="card-tags">
              <span>Micro-expression scan</span>
              <span>Frame consistency</span>
            </div>
          </article>

          <article className="modality-card">
            <div className="card-number">02</div>
            <div className="icon-wrapper icon-lips"><GiLips /></div>
            <h3 className="card-title">Lip Sync Detection</h3>
            <p className="card-description">
              Our AI detects lip-sync mismatches by analyzing speech and facial movements frame by frame, identifying delays and unnatural mouth motions.
            </p>
            <div className="card-tags">
              <span>Viseme alignment</span>
              <span>Speech timing drift</span>
            </div>
          </article>

          <article className="modality-card">
            <div className="card-number">03</div>
            <div className="icon-wrapper icon-audio"><FaWaveSquare /></div>
            <h3 className="card-title">Voice Analysis</h3>
            <p className="card-description">
              Our system analyzes voice anomalies by comparing speech patterns, tone, and cadence to detect inconsistencies and irregularities that suggest AI manipulation.
            </p>
            <div className="card-tags">
              <span>Timbre fingerprint</span>
              <span>Cadence profiling</span>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
};

export default Details;
