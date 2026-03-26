'use client';

import { useState, useEffect, useRef } from "react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import io from "socket.io-client";
import Chart from 'chart.js/auto';
import { FiUpload, FiLink, FiShield, FiAlertTriangle, FiCheckCircle, FiFileText, FiPlay } from "react-icons/fi";
import { useAuth } from "@/context/AuthContext";
import RequireAuth from "@/components/RequireAuth";
import "react-toastify/dist/ReactToastify.css";

const VIDEO_MODEL_API_URL = "http://103.22.140.216:5009/predict/video";
const IMAGE_MODEL_API_URL = "http://103.22.140.216:5009/predict/image";

/* ─── Verdict copy ────────────────────────────────────────────── */
function buildFakeNarrative(result) {
  const conf = (Number(result?.confidence || 0) * 100).toFixed(1);
  const faceScore = typeof result?.avg_face === "number" ? result.avg_face.toFixed(1) : null;
  const lipsScore = typeof result?.avg_lips === "number" ? result.avg_lips.toFixed(1) : null;
  const fakeClips = typeof result?.fake_clip_count === "number" ? result.fake_clip_count : null;

  const lines = [];
  lines.push(`Our neural network has flagged this media as DEEPFAKE with ${conf}% confidence.`);
  if (fakeClips !== null) lines.push(`${fakeClips} manipulated clip segment${fakeClips !== 1 ? "s" : ""} were identified across the video timeline.`);
  if (faceScore !== null) lines.push(`Face integrity score: ${(100 - parseFloat(faceScore)).toFixed(1)}% authentic — the model detected visual artifact patterns inconsistent with genuine footage.`);
  if (lipsScore !== null) lines.push(`Lip-sync consistency score: ${(100 - parseFloat(lipsScore)).toFixed(1)}% — phoneme-to-viseme mismatches were detected, suggesting audio-visual desynchronisation.`);
  if (faceScore !== null && lipsScore !== null) {
    const dominant = parseFloat(lipsScore) > parseFloat(faceScore) ? "lip-sync drift" : "facial rendering artifacts";
    lines.push(`The primary manipulation signal is ${dominant}.`);
  }
  lines.push("We recommend treating this content as unverified and not sharing it without further investigation.");
  return lines;
}

function buildRealNarrative(result) {
  const conf = (Number(result?.confidence || 0) * 100).toFixed(1);
  const faceScore = typeof result?.avg_face === "number" ? result.avg_face.toFixed(1) : null;
  const lipsScore = typeof result?.avg_lips === "number" ? result.avg_lips.toFixed(1) : null;

  const lines = [];
  lines.push(`Our neural network has assessed this media as AUTHENTIC with ${conf}% confidence.`);
  if (faceScore !== null) lines.push(`Face integrity score: ${(100 - parseFloat(faceScore)).toFixed(1)}% — facial geometry and texture patterns appear consistent with genuine capture.`);
  if (lipsScore !== null) lines.push(`Lip-sync consistency score: ${(100 - parseFloat(lipsScore)).toFixed(1)}% — audio-visual alignment falls within expected natural thresholds.`);
  lines.push("No significant manipulation signals were detected. However, always exercise judgment when sharing sensitive media — no detection system is infallible.");
  return lines;
}

function VerdictReport({ videoResult, imageResult }) {
  const isFake = videoResult
    ? videoResult.overall_result?.toLowerCase().includes("fake")
    : imageResult?.prediction?.toLowerCase().includes("fake");

  const narrative = videoResult
    ? (isFake ? buildFakeNarrative(videoResult) : buildRealNarrative(videoResult))
    : null;

  const conf = imageResult ? (Number(imageResult.confidence || 0) * 100).toFixed(1) : null;

  return (
    <div className="forensic-report">
      <h2 className="report-title">Forensic Analysis Report</h2>

      {/* ── Big verdict banner ── */}
      <div
        className={`verdict-banner ${isFake ? "is-fake" : "is-real"}`}
      >
        <div style={{ fontSize: 40, marginTop: 2 }}>
          {isFake ? "⚠️" : "✅"}
        </div>
        <div>
          <div style={{ fontSize: "1.35rem", fontWeight: 700, color: isFake ? "#b91c1c" : "#166534", marginBottom: 4 }}>
            {isFake ? "DEEPFAKE DETECTED" : "AUTHENTIC MEDIA"}
          </div>
          <div style={{ fontSize: "0.88rem", color: isFake ? "#dc2626" : "#15803d", fontWeight: 500 }}>
            {videoResult
              ? `Model confidence: ${(Number(videoResult.confidence || 0) * 100).toFixed(1)}%`
              : `Model confidence: ${conf}%`}
          </div>
        </div>
      </div>

      {/* ── Video: detailed narrative + stat bars ── */}
      {videoResult && narrative && (
        <>
          <div className="glass-card" style={{ marginBottom: 16 }}>
            <h4 style={{ marginBottom: 14, fontSize: "0.95rem", fontWeight: 700, color: "#0a0b14" }}>
              {isFake ? "Why This Video Was Flagged" : "Why This Video Passed"}
            </h4>
            <ul style={{ paddingLeft: 18, display: "flex", flexDirection: "column", gap: 8 }}>
              {narrative.map((line, i) => (
                <li key={i} style={{ color: "#555", fontSize: "0.88rem", lineHeight: 1.6 }}>{line}</li>
              ))}
            </ul>
          </div>

          {videoResult.overall_result && (
            <div className="stats-grid" style={{ marginBottom: 20 }}>
              <div className="stat-card">
                <label>Face Integrity</label>
                <div className="stat-bar">
                  <div style={{
                    width: `${typeof videoResult.avg_face === "number" ? 100 - videoResult.avg_face : 100}%`,
                    background: typeof videoResult.avg_face === "number" ? (isFake ? "#ef4444" : "#22c55e") : "#ccc",
                  }}></div>
                </div>
                <span>{typeof videoResult.avg_face === "number" ? (100 - videoResult.avg_face).toFixed(1) + "% authentic" : "N/A"}</span>
              </div>
              <div className="stat-card">
                <label>Lip-Sync Match</label>
                <div className="stat-bar">
                  <div style={{
                    width: `${typeof videoResult.avg_lips === "number" ? 100 - videoResult.avg_lips : 100}%`,
                    background: typeof videoResult.avg_lips === "number" ? (isFake ? "#f97316" : "#22c55e") : "#ccc",
                  }}></div>
                </div>
                <span>{typeof videoResult.avg_lips === "number" ? (100 - videoResult.avg_lips).toFixed(1) + "% aligned" : "N/A"}</span>
              </div>
              <div className="stat-card">
                <label>Overall Confidence</label>
                <div className="stat-bar">
                  <div style={{
                    width: `${(Number(videoResult.confidence || 0) * 100).toFixed(0)}%`,
                    background: isFake ? "#ef4444" : "#22c55e",
                  }}></div>
                </div>
                <span>{(Number(videoResult.confidence || 0) * 100).toFixed(1)}% model certainty</span>
              </div>
              <div className="stat-card">
                <label>Manipulated Segments</label>
                <div style={{ fontSize: "1.4rem", fontWeight: 700, color: isFake ? "#ef4444" : "#22c55e", margin: "4px 0" }}>
                  {typeof videoResult.fake_clip_count === "number" ? videoResult.fake_clip_count : "—"}
                </div>
                <span>{videoResult.fake_clip_count === 1 ? "clip" : "clips"} flagged</span>
              </div>
            </div>
          )}

          {videoResult.video_segments && videoResult.video_segments.length > 0 ? (
            <div className="glass-card" style={{ marginTop: 16 }}>
              <h4 style={{ marginBottom: 14, fontSize: "0.95rem", fontWeight: 700, color: "#0a0b14" }}>
                Video Segments Breakdown
              </h4>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem", textAlign: "center" }}>
                  <thead style={{ background: "#4a90d9", color: "#fff" }}>
                    <tr>
                      <th style={{ padding: "10px", fontWeight: 600 }}>Time Range (s)</th>
                      <th style={{ padding: "10px", fontWeight: 600 }}>Lips Manipulation (%)</th>
                      <th style={{ padding: "10px", fontWeight: 600 }}>Face Manipulation (%)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {videoResult.video_segments.map((seg, idx) => (
                      <tr key={idx} style={{ borderBottom: "1px solid #eee", background: idx % 2 === 0 ? "#fafafa" : "#fff" }}>
                        <td style={{ padding: "8px", fontWeight: 500 }}>{seg.time_range}</td>
                        <td style={{ padding: "8px", color: seg.lips_manipulation > 50 ? "#e74c3c" : "#27ae60", fontWeight: 600 }}>{seg.lips_manipulation}%</td>
                        <td style={{ padding: "8px", color: seg.face_manipulation > 50 ? "#e74c3c" : "#27ae60", fontWeight: 600 }}>{seg.face_manipulation}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="glass-card" style={{ marginTop: 16 }}>
              <h4 style={{ marginBottom: 14, fontSize: "0.95rem", fontWeight: 700, color: "#0a0b14" }}>
                Video Segments Breakdown
              </h4>
              <p style={{ color: "#666", fontStyle: "italic", fontSize: "0.85rem" }}>Detailed temporal video analysis not currently available for this media.</p>
            </div>
          )}

          {videoResult.audio_analysis ? (
            <div className="glass-card" style={{ marginTop: 20 }}>
              <div style={{ borderBottom: "1px solid #eee", paddingBottom: 12, marginBottom: 20 }}>
                <h4 style={{ fontSize: "1rem", fontWeight: 700, color: "#0a0b14" }}>
                  Audio Forensic Analysis
                </h4>
              </div>
              
              <div className="audio-summary-grid">
                <div>
                  <p style={{ fontSize: "0.85rem", fontWeight: 600, color: "#666", marginBottom: 6 }}>Probabilistic Verdict</p>
                  <p style={{ 
                    color: videoResult.audio_analysis.prediction?.includes("Fake") ? "#ef4444" : "#22c55e",
                    fontWeight: 800, fontSize: "1.8rem", margin: 0, letterSpacing: "-0.02em"
                  }}>
                    {videoResult.audio_analysis.prediction === "Fake" ? "AUDIO MANIPULATION" : "AUTHENTIC AUDIO"}
                  </p>
                  <p style={{ fontSize: "0.88rem", color: "#666", marginTop: 4 }}>
                    Segment-based neural analysis detected {videoResult.audio_analysis.fake_segments_count || 0} anomaly clusters.
                  </p>
                </div>
                
                <div className="audio-confidence-wrap">
                  <div style={{
                    width: "110px", height: "110px", borderRadius: "50%",
                    background: `conic-gradient(${videoResult.audio_analysis.prediction?.includes("Fake") ? "#ef4444" : "#22c55e"} ${(videoResult.audio_analysis.prediction?.includes("Fake") ? videoResult.audio_analysis.overall_score : 100 - (videoResult.audio_analysis.overall_score || 0)) * 3.6}deg, #f3f4f6 0deg)`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    boxShadow: "0 4px 12px rgba(0,0,0,0.06)", border: "4px solid #fff"
                  }}>
                    <div style={{
                      width: "82px", height: "82px", borderRadius: "50%", background: "#fff",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontWeight: 800, fontSize: "1.2rem", color: "#111",
                      boxShadow: "inset 0 2px 6px rgba(0,0,0,0.05)"
                    }}>
                      {(videoResult.audio_analysis.prediction?.includes("Fake") ? videoResult.audio_analysis.overall_score : 100 - (videoResult.audio_analysis.overall_score || 0)).toFixed(0)}%
                    </div>
                  </div>
                  <span style={{ fontSize: "0.7rem", color: "#888", fontWeight: 600, marginTop: 8, display: "block" }}>CONFIDENCE</span>
                </div>
              </div>

              <div className="audio-metrics-grid">
                <div style={{ padding: "16px", background: "#f9fafb", borderRadius: "14px", border: "1px solid #efefef", textAlign: "center" }}>
                  <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "#888", textTransform: "uppercase", marginBottom: 4 }}>Total Segments</div>
                  <div style={{ fontSize: "1.6rem", fontWeight: 700, color: "#111" }}>{videoResult.audio_analysis.total_segments || 0}</div>
                </div>
                <div style={{ padding: "16px", background: videoResult.audio_analysis.fake_segments_count > 0 ? "rgba(254,242,242,0.6)" : "#f0fdf4", borderRadius: "14px", border: `1px solid ${videoResult.audio_analysis.fake_segments_count > 0 ? "#fee2e2" : "#dcfce7"}`, textAlign: "center" }}>
                  <div style={{ fontSize: "0.75rem", fontWeight: 600, color: videoResult.audio_analysis.fake_segments_count > 0 ? "#ef4444" : "#16a34a", textTransform: "uppercase", marginBottom: 4 }}>Flagged Cells</div>
                  <div style={{ fontSize: "1.6rem", fontWeight: 700, color: videoResult.audio_analysis.fake_segments_count > 0 ? "#ef4444" : "#16a34a" }}>{videoResult.audio_analysis.fake_segments_count || 0}</div>
                </div>
              </div>

              {videoResult.audio_analysis.segments && videoResult.audio_analysis.segments.length > 0 && (
                <div>
                  <h5 style={{ fontWeight: 700, color: "#111", marginBottom: 12, fontSize: "0.9rem" }}>Acoustic Timeline Breakdown</h5>
                  <div style={{ overflowX: "auto", borderRadius: "12px", border: "1px solid #eee" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem", textAlign: "center" }}>
                      <thead style={{ background: "#111", color: "#fff" }}>
                        <tr>
                          <th style={{ padding: "14px 10px", fontWeight: 600 }}>Temporal Block</th>
                          <th style={{ padding: "14px 10px", fontWeight: 600 }}>Neural Verdict</th>
                          <th style={{ padding: "14px 10px", fontWeight: 600 }}>Signal Confidence</th>
                        </tr>
                      </thead>
                      <tbody>
                        {videoResult.audio_analysis.segments.map((seg, idx) => (
                          <tr key={idx} style={{ borderBottom: "1px solid #eee", background: idx % 2 === 0 ? "#fff" : "#fafafa" }}>
                            <td style={{ padding: "12px", fontWeight: 500, color: "#555" }}>{seg.segment}</td>
                            <td style={{ padding: "12px" }}>
                              <span style={{ 
                                padding: "4px 10px", borderRadius: "100px", fontSize: "0.75rem", fontWeight: 700,
                                background: seg.prediction === "Fake" ? "rgba(239,68,68,0.1)" : "rgba(34,197,94,0.1)",
                                color: seg.prediction === "Fake" ? "#ef4444" : "#16a34a"
                              }}>
                                {seg.prediction.toUpperCase()}
                              </span>
                            </td>
                            <td style={{ padding: "12px", fontWeight: 600, color: "#111" }}>{seg.confidence}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="glass-card" style={{ marginTop: 20 }}>
               <h4 style={{ marginBottom: 14, fontSize: "1rem", fontWeight: 700, color: "#0a0b14", borderBottom: "1px solid #eee", paddingBottom: "10px" }}>
                Audio Forensic Analysis
              </h4>
              <p style={{ color: "#888", fontStyle: "italic", fontSize: "0.85rem", padding: "10px 0" }}>No audio track was detected or processed for this verification session.</p>
            </div>
          )}
        </>
      )}

      {/* ── Image result ── */}
      {imageResult && (
        <div className="glass-card" style={{ marginTop: 4 }}>
          <h4 style={{ marginBottom: 12, fontSize: "0.95rem", fontWeight: 700, color: "#0a0b14" }}>
            {isFake ? "Why This Image Was Flagged" : "Why This Image Passed"}
          </h4>
          <ul style={{ paddingLeft: 18, display: "flex", flexDirection: "column", gap: 8 }}>
            {isFake ? (
              <>
                <li style={{ color: "#555", fontSize: "0.88rem", lineHeight: 1.6 }}>
                  The model detected facial rendering artifacts inconsistent with genuine photographs.
                </li>
                <li style={{ color: "#555", fontSize: "0.88rem", lineHeight: 1.6 }}>
                  Neural confidence of {conf}% indicates high likelihood of GAN or diffusion-based synthesis.
                </li>
                <li style={{ color: "#555", fontSize: "0.88rem", lineHeight: 1.6 }}>
                  Common indicators include unnatural skin texture, eye reflections, or hair boundary blending errors.
                </li>
                <li style={{ color: "#555", fontSize: "0.88rem", lineHeight: 1.6 }}>
                  Do not use this image as a trusted source without further verification.
                </li>
              </>
            ) : (
              <>
                <li style={{ color: "#555", fontSize: "0.88rem", lineHeight: 1.6 }}>
                  Facial geometry, skin texture, and lighting appear consistent with genuine photographic capture.
                </li>
                <li style={{ color: "#555", fontSize: "0.88rem", lineHeight: 1.6 }}>
                  Neural confidence of {conf}% — no significant GAN or diffusion synthesis signals were detected.
                </li>
                <li style={{ color: "#555", fontSize: "0.88rem", lineHeight: 1.6 }}>
                  Always verify context and source independently even for media that passes automated checks.
                </li>
              </>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ─── Main component ──────────────────────────────────────────── */
const MAX_USAGE = 5;

function getStorageKey(user) {
  const id = user?._id || user?.id || user?.email || "anon";
  return `deepfake_usage_count_${id}`;
}

function UploadContent() {
  const { user, setUser } = useAuth();
  const socketRef = useRef(null);
  const chartRef = useRef(null);
  const localVideoRef = useRef(null);

  const [videoResult, setVideoResult] = useState(null);
  const [audioResult, setAudioResult] = useState(null);
  const [imageResult, setImageResult] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState(null);
  const [fileName, setFileName] = useState("");
  const [progress, setProgress] = useState(0);
  const [videoUrl, setVideoUrl] = useState("");
  // Local preview — blob URL, never stored
  const [localPreviewUrl, setLocalPreviewUrl] = useState(null);
  const [previewType, setPreviewType] = useState(null); // 'video' | 'image' | 'url'
  const [urlEmbedId, setUrlEmbedId] = useState(null); // YouTube embed ID

  // ── Client-side usage limiter (localStorage) ──
  const [usageCount, setUsageCount] = useState(0);

  useEffect(() => {
    const key = getStorageKey(user);
    const stored = parseInt(localStorage.getItem(key) || "0", 10);
    setUsageCount(stored);
  }, [user]);

  const incrementUsage = () => {
    const key = getStorageKey(user);
    const next = usageCount + 1;
    localStorage.setItem(key, String(next));
    setUsageCount(next);
  };

  const remainingRequests = Math.max(MAX_USAGE - usageCount, 0);
  const isLimitReached = usageCount >= MAX_USAGE;
  const upgradeMessage = "Maximum limit reached. You have used all 5 free analysis requests.";

  // Cleanup blob URL on unmount
  useEffect(() => {
    return () => { if (localPreviewUrl) URL.revokeObjectURL(localPreviewUrl); };
  }, [localPreviewUrl]);

  const setLocalPreview = (file, type) => {
    if (localPreviewUrl) URL.revokeObjectURL(localPreviewUrl);
    if (file) {
      setLocalPreviewUrl(URL.createObjectURL(file));
      setPreviewType(type);
    } else {
      setLocalPreviewUrl(null);
      setPreviewType(null);
    }
  };

  const syncQuota = (quota) => {
    if (!quota || !user) return;
    setUser({
      ...user,
      analysisRequestsUsed: quota.analysisRequestsUsed ?? user.analysisRequestsUsed,
      analysisRequestLimit: quota.analysisRequestLimit ?? user.analysisRequestLimit,
      remainingAnalysisRequests: quota.remainingAnalysisRequests ?? user.remainingAnalysisRequests,
      upgradeRequired: quota.upgradeRequired ?? user.upgradeRequired,
    });
  };

  const parseErrorResponse = async (response, fallbackMessage) => {
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const payload = await response.json();
      return { message: payload?.message || fallbackMessage, quota: payload?.quota || payload, code: payload?.code };
    }
    const message = await response.text();
    return { message: message || fallbackMessage, quota: null, code: null };
  };

  const blockForUpgrade = (quota, message) => {
    syncQuota(quota);
    setError(message || upgradeMessage);
    setUploading(false);
    setProcessing(false);
  };

  const resetResults = () => {
    setVideoResult(null);
    setAudioResult(null);
    setImageResult(null);
    setError(null);
    setProgress(0);
  };

  const handleUrlCheck = async () => {
    if (isLimitReached) {
      setError(upgradeMessage);
      return;
    }
    if (!videoUrl.trim()) {
      setError("Please paste a video URL.");
      return;
    }
    resetResults();
    setFileName("");
    setLocalPreview(null, null);

    // Extract YouTube embed ID if possible
    const ytMatch = videoUrl.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{11})/);
    if (ytMatch) {
      setUrlEmbedId(ytMatch[1]);
      setPreviewType('url');
    } else {
      setUrlEmbedId(null);
      setPreviewType('url');
      setLocalPreviewUrl(videoUrl); // store the raw URL for display
    }

    setUploading(true);
    setProcessing(true);

    let simulatedProgress = 0;
    const progressInterval = setInterval(() => {
      simulatedProgress += Math.random() * 5;
      setProgress(Math.min(90, simulatedProgress));
    }, 800);

    try {
      const res = await fetch("/api/analysis/url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ url: videoUrl }),
      });
      if (!res.ok) {
        const { message } = await parseErrorResponse(res, "URL analysis failed");
        throw new Error(message);
      }
      const data = await res.json();
      // Normalize — the video model returns prediction/score
      const normalizedResult = {
        ...data,
        overall_result: data?.prediction || "Unknown",
        confidence: typeof data?.overall_score === "number" ? data.overall_score / 100 : Number(data?.score ?? 0),
        fake_clip_count: typeof data?.fake_clips_detected === "number" ? data.fake_clips_detected : (typeof data?.fake_clip_count === "number" ? data.fake_clip_count : null),
        avg_face: typeof data?.avg_face_manipulation === "number" ? data.avg_face_manipulation : (typeof data?.avg_face === "number" ? data.avg_face : null),
        avg_lips: typeof data?.avg_lips_manipulation === "number" ? data.avg_lips_manipulation : (typeof data?.avg_lips === "number" ? data.avg_lips : null),
        video_segments: data?.video_segments || [],
        audio_analysis: data?.audio_analysis || null,
      };
      setVideoResult(normalizedResult);
      setAudioResult(null);
      setProgress(100);
      incrementUsage();
    } catch (err) {
      setError(err?.message || "Error analyzing URL. Please try again.");
    } finally {
      clearInterval(progressInterval);
      setUploading(false);
      setProcessing(false);
    }
  };

  useEffect(() => {
    socketRef.current = io("https://proxy-handler-2.onrender.com");
    socketRef.current.on("progress_update", (data) => {
      setProgress(data.progress);
      setProcessing(true);
    });
    return () => socketRef.current.disconnect();
  }, []);

  const renderBarChart = (segmentPredictions) => {
    if (!chartRef.current || !segmentPredictions || segmentPredictions.length === 0) return;
    const labels = segmentPredictions.map((seg, i) => `Segment ${i + 1}`);
    const confidences = segmentPredictions.map(seg => seg.confidence);
    const colors = segmentPredictions.map(seg => seg.prediction === 'Fake' ? '#e74c3c' : '#27ae60');
    if (chartRef.current.chartInstance) chartRef.current.chartInstance.destroy();
    chartRef.current.chartInstance = new Chart(chartRef.current, {
      type: 'bar',
      data: { labels, datasets: [{ label: 'Confidence', data: confidences, backgroundColor: colors }] },
      options: {
        plugins: { legend: { display: false } },
        scales: {
          y: { min: 0, max: 1, title: { display: true, text: 'Confidence (0-1)' } },
          x: { title: { display: true, text: 'Segment' } },
        },
      },
    });
  };

  const handleFileChange = async (e) => {
    const selectedFile = e.target.files[0];
    if (!selectedFile) return;
    if (isLimitReached) {
      setError(upgradeMessage);
      e.target.value = "";
      return;
    }

    // Show local preview immediately — blob URL, no upload to DB
    setLocalPreview(selectedFile, 'video');
    setFileName(selectedFile.name);
    resetResults();
    setUploading(true);
    setProcessing(true);

    let simulatedProgress = 0;
    const progressInterval = setInterval(() => {
      simulatedProgress += Math.random() * 10;
      setProgress(Math.min(95, simulatedProgress));
    }, 500);

    try {
      const videoFormData = new FormData();
      videoFormData.append("video", selectedFile);
      const videoResponse = await fetch(VIDEO_MODEL_API_URL, { method: "POST", body: videoFormData });
      if (!videoResponse.ok) {
        const { message, quota, code } = await parseErrorResponse(videoResponse, `Video analysis failed (${videoResponse.status})`);
        if (code === "ANALYSIS_LIMIT_REACHED") { blockForUpgrade(quota, message); e.target.value = ""; return; }
        throw new Error(message);
      }
      const videoData = await videoResponse.json();
      const normalizedVideoResult = {
        ...videoData,
        overall_result: videoData?.prediction || "Unknown",
        confidence: typeof videoData?.overall_score === "number" ? videoData.overall_score / 100 : Number(videoData?.score ?? 0),
        fake_clip_count: typeof videoData?.fake_clips_detected === "number" ? videoData.fake_clips_detected : (typeof videoData?.fake_clip_count === "number" ? videoData.fake_clip_count : null),
        avg_face: typeof videoData?.avg_face_manipulation === "number" ? videoData.avg_face_manipulation : (typeof videoData?.avg_face === "number" ? videoData.avg_face : null),
        avg_lips: typeof videoData?.avg_lips_manipulation === "number" ? videoData.avg_lips_manipulation : (typeof videoData?.avg_lips === "number" ? videoData.avg_lips : null),
        video_segments: videoData?.video_segments || [],
        audio_analysis: videoData?.audio_analysis || null,
      };
      setVideoResult(normalizedVideoResult);
      setAudioResult(null);
      setProgress(100);
      incrementUsage();
    } catch (err) {
      setError(err?.message || "Error analyzing file. Please try again.");
    } finally {
      clearInterval(progressInterval);
      setUploading(false);
      setProcessing(false);
    }
  };

  const handleImageChange = async (e) => {
    const selectedFile = e.target.files[0];
    if (!selectedFile) return;
    if (isLimitReached) {
      setError(upgradeMessage);
      e.target.value = "";
      return;
    }

    // Show local image preview
    setLocalPreview(selectedFile, 'image');
    setFileName(selectedFile.name);
    resetResults();
    setUploading(true);
    setProcessing(true);

    let simulatedProgress = 0;
    const progressInterval = setInterval(() => {
      simulatedProgress += Math.random() * 14;
      setProgress(Math.min(95, simulatedProgress));
    }, 350);

    try {
      const imageFormData = new FormData();
      imageFormData.append("image", selectedFile);
      const imageResponse = await fetch(IMAGE_MODEL_API_URL, { method: "POST", body: imageFormData });
      if (!imageResponse.ok) {
        const { message, quota, code } = await parseErrorResponse(imageResponse, `Image analysis failed (${imageResponse.status})`);
        if (code === "ANALYSIS_LIMIT_REACHED") { blockForUpgrade(quota, message); e.target.value = ""; return; }
        throw new Error(message);
      }
      const imageData = await imageResponse.json();
      setImageResult({ ...imageData, prediction: imageData?.prediction || "Unknown", confidence: Number(imageData?.score ?? imageData?.confidence ?? 0) });
      setProgress(100);
      incrementUsage();
    } catch (err) {
      setError(err?.message || "Error analyzing image. Please try again.");
    } finally {
      clearInterval(progressInterval);
      setUploading(false);
      setProcessing(false);
    }
  };

  useEffect(() => {
    if (audioResult && audioResult.segment_predictions) {
      renderBarChart(audioResult.segment_predictions);
    }
  }, [audioResult]);

  const hasResult = !!(videoResult || imageResult);

  return (
    <div className="upload-root">
      <Navbar />
      <div className="upload-bg-overlay"></div>

      <main className="upload-container">
        <header className="upload-header">
          <h1 className="glitch-text">AI Forensic Hub</h1>
          <p className="subtitle">Verify media integrity with deep-learning neural networks.</p>
        </header>

        {/* Quota bar */}
        <div className={`status-bar ${isLimitReached ? "limit-hit" : ""}`}>
          <div className="status-info">
            <FiShield className="status-icon" />
            <span>{remainingRequests} / {MAX_USAGE} Free Verifications Left</span>
          </div>
          {isLimitReached && <button className="upgrade-mini-btn">Upgrade Now</button>}
        </div>

        {/* Upload controls + live preview side-by-side */}
        <div className="upload-top-grid">

          {/* Left — controls */}
          <section className="upload-left-stack">
            {/* Media Upload */}
            <div className="glass-card">
              <h3 style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, fontSize: "1rem", fontWeight: 600 }}>
                <FiUpload /> Media Upload
              </h3>
              <div className="drop-zone">
                <input type="file" id="videoInput" accept=".mp4,.avi,.mov,.mkv" hidden onChange={handleFileChange} disabled={uploading || processing} />
                <button className="main-upload-btn" onClick={() => document.getElementById('videoInput').click()}>
                  Analyze Video
                </button>
                <p style={{ fontSize: "0.72rem", color: "#999", marginTop: 6 }}>Accepted: MP4, AVI, MOV, MKV (max 100 MB)</p>
                <input type="file" id="imageInput" accept=".jpg,.jpeg,.png,.bmp" hidden onChange={handleImageChange} disabled={uploading || processing} />
                <button className="secondary-upload-btn" onClick={() => document.getElementById('imageInput').click()}>
                  Analyze Image
                </button>
                <p style={{ fontSize: "0.72rem", color: "#999", marginTop: 6 }}>Accepted: JPG, JPEG, PNG, BMP</p>
              </div>
            </div>

            {/* FAKE URL Detection */}
            <div className="glass-card">
              <h3 style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, fontSize: "1rem", fontWeight: 600 }}>
                <FiLink /> FAKE URL Detection
              </h3>
              <div className="url-input-wrapper">
                <input
                  type="url"
                  placeholder="Paste YouTube or Social Link..."
                  value={videoUrl}
                  onChange={(e) => setVideoUrl(e.target.value)}
                  disabled={uploading || processing}
                />
                <button onClick={handleUrlCheck} disabled={uploading || processing}>
                  {uploading || processing ? "Analyzing..." : "Check"}
                </button>
              </div>
              <p style={{ fontSize: "0.72rem", color: "#999", marginTop: 8 }}>Supports: YouTube, Instagram, Twitter/X, Facebook &amp; most social platforms</p>
            </div>

            {/* Status / loader */}
            {(uploading || processing) && (
              <div className="analysis-loader">
                <div className="scanner-line"></div>
                <div className="progress-circle">
                  <span>{progress.toFixed(0)}%</span>
                </div>
                <p>{uploading ? "Sending to AI Model..." : "Neural Analysis in Progress..."}</p>
              </div>
            )}
            {error && (
              <div className="error-toast"><FiAlertTriangle /> {error}</div>
            )}
            {!uploading && !processing && !hasResult && !localPreviewUrl && (
              <div className="empty-state">
                <FiFileText size={48} />
                <p>Awaiting media for forensic scanning</p>
              </div>
            )}
          </section>

          {/* Right — media preview */}
          {(localPreviewUrl || urlEmbedId) && (
            <section className="upload-preview-section">
              <div className="glass-card upload-preview-card">
                <h3 style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, fontSize: "1rem", fontWeight: 600 }}>
                  <FiPlay /> Preview
                </h3>

                {previewType === 'video' ? (
                  <video
                    ref={localVideoRef}
                    src={localPreviewUrl}
                    controls
                    className="upload-preview-media upload-preview-video"
                  />
                ) : previewType === 'url' && urlEmbedId ? (
                  <iframe
                    src={`https://www.youtube.com/embed/${urlEmbedId}`}
                    title="Video Preview"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    className="upload-preview-media upload-preview-iframe"
                  />
                ) : previewType === 'url' ? (
                  <div style={{
                    padding: 20, borderRadius: 10, background: "#f4f4f4",
                    textAlign: "center", color: "#666", fontSize: "0.85rem",
                    display: "flex", flexDirection: "column", alignItems: "center", gap: 10,
                  }}>
                    <FiLink size={32} />
                    <p style={{ wordBreak: "break-all" }}>{videoUrl}</p>
                    <span style={{ fontSize: "0.7rem", color: "#aaa" }}>Downloading &amp; analyzing video from this URL...</span>
                  </div>
                ) : (
                  <img
                    src={localPreviewUrl}
                    alt="Preview"
                    className="upload-preview-media upload-preview-image"
                  />
                )}

                {(fileName || videoUrl) && (
                  <p className="upload-preview-filename">
                    {fileName || videoUrl}
                  </p>
                )}

                {(uploading || processing) && (
                  <div className="upload-progress-track">
                    <div style={{
                      height: "100%", width: `${progress}%`,
                      background: "linear-gradient(to right, #6366f1, #8b5cf6)",
                      borderRadius: 100, transition: "width 0.4s",
                    }} />
                  </div>
                )}
              </div>
            </section>
          )}
        </div>

        {/* Results */}
        {hasResult && (
          <VerdictReport videoResult={videoResult} imageResult={imageResult} />
        )}
      </main>
      <Footer />
    </div>
  );
}

export default function Upload() {
  return (
    <RequireAuth allowedRoles={['user', 'admin']}>
      <UploadContent />
    </RequireAuth>
  );
}
