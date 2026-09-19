import { useRef, useState } from 'react';

const BACKEND_URL = 'http://localhost:5000';
const MAX_FILE_SIZE = 20 * 1024 * 1024;

async function readJson(response) {
  const raw = await response.text();
  let data = {};

  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = {
      error: raw || 'Server returned an invalid response.',
    };
  }

  if (!response.ok) {
    throw new Error(
      data.details ||
      data.error ||
      `Request failed (${response.status})`
    );
  }

  return data;
}

function App() {
  const fileInputRef = useRef(null);

  const [file, setFile] = useState(null);
  const [extractedText, setExtractedText] = useState('');
  const [topic, setTopic] = useState('');

  const [explanation, setExplanation] = useState('');
  const [example, setExample] = useState('');
  const [recap, setRecap] = useState('');

  const [videoUrl, setVideoUrl] = useState('');
  const [videoTitle, setVideoTitle] = useState('');
  const [videoDuration, setVideoDuration] = useState(null);
  const [scenes, setScenes] = useState([]);

  const [studentAnswer, setStudentAnswer] = useState('');
  const [evaluation, setEvaluation] = useState(null);
  const [evaluationLoading, setEvaluationLoading] = useState(false);

  const [loading, setLoading] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  function resetResults() {
    setExplanation('');
    setExample('');
    setRecap('');
    setVideoUrl('');
    setVideoTitle('');
    setVideoDuration(null);
    setScenes([]);
    setStudentAnswer('');
    setEvaluation(null);
    setEvaluationLoading(false);
  }

  function handleFileChange(event) {
    const selected = event.target.files?.[0];

    if (!selected) return;

    if (!selected.name.toLowerCase().endsWith('.pdf')) {
      setError('Please select a PDF file.');
      return;
    }

    if (selected.size > MAX_FILE_SIZE) {
      setError('PDF must be 20 MB or smaller.');
      return;
    }

    setFile(selected);
    setExtractedText('');
    setTopic('');
    resetResults();
    setError('');
    setNotice('');
  }

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  async function handleUpload() {
    if (!file) {
      setError('Please select a PDF first.');
      return;
    }

    setLoading('upload');
    setError('');
    setNotice('');
    resetResults();

    try {
      const form = new FormData();
      form.append('file', file);

      const response = await fetch(`${BACKEND_URL}/upload`, {
        method: 'POST',
        body: form,
      });

      const data = await readJson(response);

      if (!data.text?.trim()) {
        throw new Error('No readable text was found in the PDF.');
      }

      setExtractedText(data.text);

      setNotice(
        `PDF loaded successfully — ${Math.round(
          data.text.length / 1000
        )}k characters extracted.`
      );
    } catch (e) {
      setError(e.message || 'Failed to upload PDF.');
    } finally {
      setLoading('');
    }
  }

  async function handleExplain() {
    if (!extractedText) {
      setError('Upload your PDF first.');
      return;
    }

    if (!topic.trim()) {
      setError('Enter the topic you want to learn.');
      return;
    }

    setLoading('explain');
    setError('');
    setNotice('');

    try {
      const response = await fetch(`${BACKEND_URL}/explain`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: extractedText,
          topic: topic.trim(),
          language: 'english',
        }),
      });

      const data = await readJson(response);

      setExplanation(data.explanation || '');
      setExample(data.example || '');
      setRecap(data.recap || '');

      setNotice(
        'Simple English explanation generated successfully.'
      );
    } catch (e) {
      setError(e.message || 'Failed to generate explanation.');
    } finally {
      setLoading('');
    }
  }

  async function handleEvaluate() {
    if (!extractedText) {
      setError('Upload your PDF first.');
      return;
    }

    if (!topic.trim()) {
      setError('Enter the topic you want to learn.');
      return;
    }

    if (!studentAnswer.trim()) {
      setError('Explain the topic in your own words first.');
      return;
    }

    if (studentAnswer.trim().length < 20) {
      setError('Please give a little more explanation so TeachBack can evaluate your understanding.');
      return;
    }

    setEvaluationLoading(true);
    setError('');
    setNotice('');

    try {
      const response = await fetch(`${BACKEND_URL}/evaluate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: extractedText,
          topic: topic.trim(),
          studentAnswer: studentAnswer.trim(),
          explanation,
          example,
          recap,
          language: 'english',
        }),
      });

      const data = await readJson(response);

      setEvaluation(data);
      setNotice('Your explanation has been checked by TeachBack.');
    } catch (e) {
      setError(e.message || 'Failed to evaluate your explanation.');
    } finally {
      setEvaluationLoading(false);
    }
  }

  async function handleGenerateVideo() {
    if (!extractedText) {
      setError('Upload your PDF first.');
      return;
    }

    if (!topic.trim()) {
      setError('Enter the topic you want to learn.');
      return;
    }

    setLoading('video');
    setError('');
    setNotice('');
    setVideoUrl('');
    setScenes([]);

    try {
      let currentExplanation = explanation;
      let currentExample = example;
      let currentRecap = recap;

      if (!currentExplanation) {
        const explainResponse = await fetch(
          `${BACKEND_URL}/explain`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              text: extractedText,
              topic: topic.trim(),
              language: 'english',
            }),
          }
        );

        const explainData = await readJson(explainResponse);

        currentExplanation = explainData.explanation || '';
        currentExample = explainData.example || '';
        currentRecap = explainData.recap || '';

        setExplanation(currentExplanation);
        setExample(currentExample);
        setRecap(currentRecap);
      }

      const response = await fetch(
        `${BACKEND_URL}/generate-video`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            text: extractedText,
            topic: topic.trim(),
            language: 'english',
            explanation: currentExplanation,
            example: currentExample,
            recap: currentRecap,
          }),
        }
      );

      const data = await readJson(response);

      if (!data.videoUrl) {
        throw new Error(
          'The server completed without returning a video URL.'
        );
      }

      const completeVideoUrl = data.videoUrl.startsWith('http')
        ? data.videoUrl
        : `${BACKEND_URL}${data.videoUrl}`;

      setVideoUrl(completeVideoUrl);
      setVideoTitle(
        data.title || `Understanding ${topic.trim()}`
      );
      setVideoDuration(data.duration ?? null);
      setScenes(
        Array.isArray(data.scenes) ? data.scenes : []
      );

      setNotice(
        `Video generated successfully in approximately ${Math.round(
          data.duration || 0
        )} seconds.`
      );
    } catch (e) {
      setError(
        e.message || 'Failed to generate video.'
      );
    } finally {
      setLoading('');
    }
  }

  function resetAll() {
    setFile(null);
    setExtractedText('');
    setTopic('');
    resetResults();
    setError('');
    setNotice('');
    setLoading('');

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }

  const learningReady = Boolean(extractedText);
  const hasExplanation = Boolean(explanation);
  const hasVideo = Boolean(videoUrl);

  return (
    <>
      <style>{`
        * {
          box-sizing: border-box;
        }

        html {
          scroll-behavior: smooth;
        }

        body {
          margin: 0;
          min-width: 320px;
          background: #f7fbff;
        }

        button,
        input {
          font-family: inherit;
        }

        button {
          -webkit-tap-highlight-color: transparent;
        }

        button:focus-visible,
        input:focus-visible {
          outline: 3px solid rgba(66, 165, 245, 0.22);
          outline-offset: 2px;
        }

        input:focus {
          border-color: #5b9ee8 !important;
          box-shadow: 0 0 0 4px rgba(66, 165, 245, 0.11) !important;
        }

        textarea:focus {
          border-color: #8a6bdc !important;
          box-shadow: 0 0 0 4px rgba(118, 84, 216, 0.10) !important;
          outline: none;
        }

        .tb-card ul {
          margin: 8px 0 0;
          padding-left: 20px;
        }

        .tb-card li {
          margin: 5px 0;
          line-height: 1.55;
        }

        .tb-card h4 {
          margin: 0;
          font-size: 13px;
        }

        .tb-card p {
          line-height: 1.6;
        }

        .tb-hero-visual {
          animation: tbFloat 6s ease-in-out infinite;
        }

        .tb-loading-shimmer {
          animation: tbShimmer 1.6s linear infinite;
          background-size: 200% 100%;
        }

        .tb-spinner {
          animation: tbSpin 0.8s linear infinite;
        }

        .tb-pulse {
          animation: tbPulse 1.7s ease-in-out infinite;
        }

        @keyframes tbFloat {
          0%,
          100% {
            transform: translateY(0);
          }

          50% {
            transform: translateY(-7px);
          }
        }

        @keyframes tbSpin {
          to {
            transform: rotate(360deg);
          }
        }

        @keyframes tbPulse {
          0%,
          100% {
            opacity: 0.55;
          }

          50% {
            opacity: 1;
          }
        }

        @keyframes tbShimmer {
          0% {
            background-position: 200% 0;
          }

          100% {
            background-position: -200% 0;
          }
        }

        @media (max-width: 850px) {
          .tb-hero {
            grid-template-columns: 1fr !important;
            padding: 38px 28px !important;
          }

          .tb-hero-visual {
            min-height: 280px !important;
          }

          .tb-stats {
            grid-template-columns: 1fr !important;
          }

          .tb-action-grid {
            grid-template-columns: 1fr !important;
          }

          .tb-scene-grid {
            grid-template-columns: 1fr !important;
          }

          .tb-workspace {
            align-items: flex-start !important;
            flex-direction: column !important;
          }

          .tb-progress {
            width: 100% !important;
          }
        }

        @media (max-width: 560px) {
          .tb-navbar {
            padding: 10px 11px !important;
          }

          .tb-nav-right {
            display: none !important;
          }

          .tb-container {
            width: 94% !important;
          }

          .tb-hero {
            border-radius: 25px !important;
            padding: 31px 22px !important;
            min-height: auto !important;
          }

          .tb-hero-title {
            font-size: 49px !important;
            letter-spacing: -2.8px !important;
          }

          .tb-hero-visual {
            transform: scale(0.88);
            margin: -10px 0;
          }

          .tb-card {
            padding: 21px !important;
            border-radius: 20px !important;
          }

          .tb-card-top {
            flex-wrap: wrap;
          }

          .tb-ready {
            margin-left: 61px;
          }

          .tb-video-header {
            flex-direction: column !important;
          }

          .tb-video-card {
            padding: 21px !important;
          }

          .tb-teachback-card {
            padding: 21px !important;
          }

          .tb-result-title {
            font-size: 23px !important;
          }

          .tb-floating-top {
            right: -12px !important;
          }

          .tb-floating-bottom {
            left: -10px !important;
          }
        }
      `}</style>

      <div style={styles.page}>
        <div style={styles.ambientOne} />
        <div style={styles.ambientTwo} />

        <header style={styles.header}>
          <div
            style={styles.navbar}
            className="tb-navbar"
          >
            <button
              type="button"
              style={styles.brandButton}
              onClick={resetAll}
              aria-label="TeachBack home"
            >
              <img
                src="./teachback-logo.png"
                alt="TeachBack"
                style={styles.logoImage}
              />

              <div>
                <div style={styles.brandName}>
                  TeachBack
                </div>

                <div style={styles.brandMini}>
                  AI LEARNING STUDIO
                </div>
              </div>
            </button>

            <div
              style={styles.navRight}
              className="tb-nav-right"
            >
              <div style={styles.localBadge}>
                <span style={styles.liveDot} />
                Local AI
              </div>

              <div style={styles.englishNav}>
                ENGLISH
              </div>
            </div>
          </div>
        </header>

        <main
          style={styles.container}
          className="tb-container"
        >
          <section
            style={styles.hero}
            className="tb-hero"
          >
            <div style={styles.heroGlow} />

            <div style={styles.heroCopy}>
              <div style={styles.heroPill}>
                <span style={styles.spark}>✦</span>
                YOUR PERSONAL AI STUDY TUTOR
              </div>

              <h1
                style={styles.heroTitle}
                className="tb-hero-title"
              >
                Learn it.
                <br />
                <span style={styles.heroAccent}>
                  Explain it.
                </span>
                <br />
                Master it.
              </h1>

              <p style={styles.heroText}>
                Turn your lecture PDFs into simple,
                focused lessons. Pick a topic,
                understand it clearly, and watch
                TeachBack turn it into a short
                visual lesson.
              </p>

              <div style={styles.heroActions}>
                <button
                  type="button"
                  onClick={openFilePicker}
                  style={styles.heroButton}
                >
                  <span>Start learning</span>

                  <span style={styles.arrow}>
                    →
                  </span>
                </button>

                <div style={styles.heroHint}>
                  <span style={styles.checkCircle}>
                    ✓
                  </span>

                  No API keys · Runs locally
                </div>
              </div>
            </div>

            <div
              style={styles.heroVisual}
              className="tb-hero-visual"
            >
              <div
                style={{
                  ...styles.orbit,
                  ...styles.orbitA,
                }}
              />

              <div
                style={{
                  ...styles.orbit,
                  ...styles.orbitB,
                }}
              />

              <div
                style={styles.floatingCardTop}
                className="tb-floating-top"
              >
                <span style={styles.miniIconBlue}>
                  ✦
                </span>

                <div>
                  <strong>
                    Simple explanations
                  </strong>

                  <span>
                    Made for students
                  </span>
                </div>
              </div>

              <div style={styles.studyOrb}>
                <img
                  src="./teachback-logo.png"
                  alt=""
                  style={styles.heroLogo}
                />

                <div style={styles.orbRing} />
              </div>

              <div
                style={styles.floatingCardBottom}
                className="tb-floating-bottom"
              >
                <span style={styles.miniIconOrange}>
                  ▶
                </span>

                <div>
                  <strong>
                    Visual lessons
                  </strong>

                  <span>
                    Topic-specific video
                  </span>
                </div>
              </div>
            </div>
          </section>

          <section
            style={styles.statsRow}
            className="tb-stats"
          >
            <div style={styles.statCard}>
              <span style={styles.statNumber}>
                01
              </span>

              <div>
                <strong>Upload</strong>

                <p>
                  Give TeachBack your study
                  material.
                </p>
              </div>
            </div>

            <div style={styles.statCard}>
              <span
                style={{
                  ...styles.statNumber,
                  ...styles.orangeText,
                }}
              >
                02
              </span>

              <div>
                <strong>Understand</strong>

                <p>
                  Get a simple explanation of one
                  topic.
                </p>
              </div>
            </div>

            <div style={styles.statCard}>
              <span
                style={{
                  ...styles.statNumber,
                  ...styles.purpleText,
                }}
              >
                03
              </span>

              <div>
                <strong>Teach back</strong>

                <p>
                  Watch and learn until you can
                  explain it.
                </p>
              </div>
            </div>
          </section>

          <section
            style={styles.workspaceHeader}
            className="tb-workspace"
          >
            <div>
              <div style={styles.sectionEyebrow}>
                LEARNING WORKSPACE
              </div>

              <h2 style={styles.workspaceTitle}>
                Build your lesson
              </h2>

              <p style={styles.workspaceSub}>
                Everything you need, in one focused
                learning flow.
              </p>
            </div>

            <div
              style={styles.progressTrack}
              className="tb-progress"
            >
              <div
                style={{
                  ...styles.progressFill,
                  width: hasVideo
                    ? '100%'
                    : evaluation
                      ? '84%'
                      : hasExplanation
                        ? '66%'
                        : learningReady
                          ? '33%'
                          : '8%',
                }}
              />
            </div>
          </section>

          <section
            style={styles.card}
            className="tb-card"
          >
            <div
              style={styles.cardTop}
              className="tb-card-top"
            >
              <div style={styles.stepBadge}>
                01
              </div>

              <div style={styles.cardHeading}>
                <span style={styles.cardEyebrow}>
                  SOURCE MATERIAL
                </span>

                <h2 style={styles.cardTitle}>
                  Upload your PDF
                </h2>

                <p style={styles.cardText}>
                  Lecture notes, textbooks or
                  question banks. PDF only,
                  maximum 20 MB.
                </p>
              </div>

              <div
                style={{
                  ...styles.readyPill,
                  ...(learningReady
                    ? styles.readyPillDone
                    : {}),
                }}
                className="tb-ready"
              >
                <span>
                  {learningReady ? '✓' : '○'}
                </span>

                {learningReady
                  ? 'READY'
                  : 'WAITING'}
              </div>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,application/pdf"
              onChange={handleFileChange}
              style={{ display: 'none' }}
            />

            <button
              type="button"
              onClick={openFilePicker}
              style={{
                ...styles.dropZone,
                ...(file
                  ? styles.dropZoneSelected
                  : {}),
              }}
            >
              <div style={styles.uploadIcon}>
                <span>↑</span>
              </div>

              <div style={styles.dropTitle}>
                {file
                  ? file.name
                  : 'Drop your PDF here or browse'}
              </div>

              <div style={styles.dropSub}>
                {file
                  ? `${(
                    file.size /
                    1024 /
                    1024
                  ).toFixed(2)} MB selected`
                  : 'Your material stays on your local machine'}
              </div>
            </button>

            <div style={styles.buttonRow}>
              <button
                type="button"
                onClick={openFilePicker}
                style={styles.outlineButton}
              >
                {file
                  ? 'Change PDF'
                  : 'Choose PDF'}
              </button>

              <button
                type="button"
                onClick={handleUpload}
                disabled={
                  !file || loading === 'upload'
                }
                style={{
                  ...styles.gradientButton,
                  ...(!file ||
                    loading === 'upload'
                    ? styles.disabledButton
                    : {}),
                }}
              >
                {loading === 'upload' ? (
                  <>
                    <span
                      style={styles.buttonSpinner}
                      className="tb-spinner"
                    />

                    Reading PDF…
                  </>
                ) : extractedText ? (
                  'Reload PDF →'
                ) : (
                  'Upload & continue →'
                )}
              </button>
            </div>
          </section>

          {learningReady && (
            <section
              style={styles.card}
              className="tb-card"
            >
              <div
                style={styles.cardTop}
                className="tb-card-top"
              >
                <div
                  style={{
                    ...styles.stepBadge,
                    ...styles.orangeBadge,
                  }}
                >
                  02
                </div>

                <div style={styles.cardHeading}>
                  <span style={styles.cardEyebrow}>
                    FOCUSED LEARNING
                  </span>

                  <h2 style={styles.cardTitle}>
                    What do you want to learn?
                  </h2>

                  <p style={styles.cardText}>
                    Enter one specific concept from
                    your uploaded material.
                  </p>
                </div>

                <div style={styles.englishPill}>
                  <span>EN</span>
                  ENGLISH ONLY
                </div>
              </div>

              <div style={styles.topicWrap}>
                <span style={styles.topicSearch}>
                  ⌕
                </span>

                <input
                  value={topic}
                  onChange={(e) =>
                    setTopic(e.target.value)
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleExplain();
                    }
                  }}
                  placeholder="Example: Quantum coherence"
                  style={styles.topicInput}
                />

                {topic && (
                  <button
                    type="button"
                    onClick={() => setTopic('')}
                    style={styles.clearTopic}
                  >
                    ×
                  </button>
                )}
              </div>

              <div style={styles.languageBox}>
                <div style={styles.languageIcon}>
                  Aa
                </div>

                <div style={{ flex: 1 }}>
                  <strong
                    style={{
                      fontSize: 13,
                    }}
                  >
                    Simple English,
                    student-friendly wording
                  </strong>

                  <p style={styles.languageText}>
                    The explanation stays focused on
                    your requested topic. Video
                    narration uses natural Indian
                    English.
                  </p>
                </div>

                <span style={styles.languageCheck}>
                  ✓
                </span>
              </div>

              <div
                style={styles.actionGrid}
                className="tb-action-grid"
              >
                <button
                  type="button"
                  onClick={handleExplain}
                  disabled={
                    loading === 'explain' ||
                    loading === 'video'
                  }
                  style={{
                    ...styles.explainButton,
                    ...(loading === 'explain' ||
                      loading === 'video'
                      ? styles.disabledButton
                      : {}),
                  }}
                >
                  <span style={styles.actionIconBlue}>
                    ✦
                  </span>

                  <span>
                    <strong>
                      {loading === 'explain'
                        ? 'Explaining…'
                        : 'Explain this topic'}
                    </strong>

                    <small>
                      Understand the concept first
                    </small>
                  </span>

                  <span style={styles.actionArrow}>
                    →
                  </span>
                </button>

                <button
                  type="button"
                  onClick={handleGenerateVideo}
                  disabled={loading === 'video'}
                  style={{
                    ...styles.videoButton,
                    ...(loading === 'video'
                      ? styles.disabledButton
                      : {}),
                  }}
                >
                  <span
                    style={styles.actionIconOrange}
                  >
                    ▶
                  </span>

                  <span>
                    <strong>
                      {loading === 'video'
                        ? 'Creating video…'
                        : 'Generate video'}
                    </strong>

                    <small>
                      Visual lesson + narration
                    </small>
                  </span>

                  <span style={styles.actionArrow}>
                    →
                  </span>
                </button>
              </div>

              {loading === 'video' && (
                <div style={styles.generationBox}>
                  <div
                    style={styles.generationOrb}
                    className="tb-pulse"
                  >
                    <span>✦</span>
                  </div>

                  <div style={{ flex: 1 }}>
                    <strong>
                      TeachBack is creating your
                      lesson
                    </strong>

                    <p style={styles.generationText}>
                      Generating the explanation,
                      topic-specific key-point
                      visuals, motion and natural
                      Indian English narration.
                    </p>

                    <div
                      style={styles.loadingBar}
                      className="tb-loading-shimmer"
                    >
                      <div
                        style={
                          styles.loadingBarFill
                        }
                      />
                    </div>
                  </div>
                </div>
              )}
            </section>
          )}

          {notice && (
            <div style={styles.notice}>
              <span style={styles.noticeIcon}>
                ✓
              </span>

              <span>{notice}</span>
            </div>
          )}

          {error && (
            <div style={styles.error}>
              <span style={styles.errorIcon}>
                !
              </span>

              <div>
                <strong>
                  Something needs attention
                </strong>

                <div>{error}</div>
              </div>
            </div>
          )}

          {explanation && (
            <section
              style={styles.explanationCard}
              className="tb-card tb-teachback-card"
            >
              <div style={styles.resultTop}>
                <div style={styles.resultIconBlue}>
                  ✦
                </div>

                <div style={{ flex: 1 }}>
                  <span style={styles.cardEyebrow}>
                    TEACHBACK EXPLANATION
                  </span>

                  <h2
                    style={styles.resultTitle}
                    className="tb-result-title"
                  >
                    {topic}
                  </h2>
                </div>

                <span style={styles.resultBadge}>
                  ENGLISH
                </span>
              </div>

              <div style={styles.explanationText}>
                {explanation}
              </div>

              {example && (
                <div style={styles.infoBoxOrange}>
                  <div style={styles.infoIconOrange}>
                    ?
                  </div>

                  <div>
                    <h3 style={styles.infoHeading}>
                      Easy example
                    </h3>

                    <p
                      style={
                        styles.infoParagraphOrange
                      }
                    >
                      {example}
                    </p>
                  </div>
                </div>
              )}

              {recap && (
                <div style={styles.infoBoxBlue}>
                  <div style={styles.infoIconBlue}>
                    ✓
                  </div>

                  <div>
                    <h3 style={styles.infoHeading}>
                      Quick recap
                    </h3>

                    <p
                      style={
                        styles.infoParagraphBlue
                      }
                    >
                      {recap}
                    </p>
                  </div>
                </div>
              )}
            </section>
          )}

          {explanation && (
            <section
              style={styles.teachBackCard}
              className="tb-card"
            >
              <div style={styles.resultTop}>
                <div style={styles.resultIconPurple}>
                  ↗
                </div>

                <div style={{ flex: 1 }}>
                  <span style={styles.cardEyebrow}>
                    TEACHBACK CHECK
                  </span>

                  <h2
                    style={styles.resultTitle}
                    className="tb-result-title"
                  >
                    Explain it back
                  </h2>

                  <p style={styles.teachBackIntro}>
                    Close the explanation and describe <strong>{topic}</strong> in your own words.
                    TeachBack will check what you understood and what needs a little more work.
                  </p>
                </div>

                <span style={styles.resultBadgePurple}>
                  YOUR TURN
                </span>
              </div>

              <textarea
                value={studentAnswer}
                onChange={(e) => {
                  setStudentAnswer(e.target.value);
                  if (evaluation) setEvaluation(null);
                }}
                placeholder={`Example: "${topic}" means...`}
                style={styles.teachBackInput}
                rows={7}
              />

              <div style={styles.teachBackBottom}>
                <span style={styles.characterHint}>
                  {studentAnswer.trim().length} characters
                </span>

                <button
                  type="button"
                  onClick={handleEvaluate}
                  disabled={evaluationLoading}
                  style={{
                    ...styles.evaluateButton,
                    ...(evaluationLoading
                      ? styles.disabledButton
                      : {}),
                  }}
                >
                  {evaluationLoading ? (
                    <>
                      <span
                        style={styles.buttonSpinner}
                        className="tb-spinner"
                      />
                      Checking…
                    </>
                  ) : (
                    <>
                      Check my explanation →
                    </>
                  )}
                </button>
              </div>

              {evaluation && (
                <div style={styles.evaluationResult}>
                  <div style={styles.evaluationStatus}>
                    <span style={styles.evaluationStatusIcon}>
                      ✓
                    </span>
                    <div>
                      <span style={styles.cardEyebrow}>
                        TEACHBACK FEEDBACK
                      </span>
                      <h3 style={styles.evaluationTitle}>
                        {evaluation.overall || 'Your understanding'}
                      </h3>
                    </div>
                  </div>

                  {Array.isArray(evaluation.understood) &&
                    evaluation.understood.length > 0 && (
                      <div style={styles.feedbackBoxGreen}>
                        <h4>What you understood</h4>
                        <ul>
                          {evaluation.understood.map((item, i) => (
                            <li key={i}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                  {Array.isArray(evaluation.partial) &&
                    evaluation.partial.length > 0 && (
                      <div style={styles.feedbackBoxOrange}>
                        <h4>Partially understood</h4>
                        <ul>
                          {evaluation.partial.map((item, i) => (
                            <li key={i}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                  {Array.isArray(evaluation.missing) &&
                    evaluation.missing.length > 0 && (
                      <div style={styles.feedbackBoxBlue}>
                        <h4>What is missing</h4>
                        <ul>
                          {evaluation.missing.map((item, i) => (
                            <li key={i}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                  {evaluation.correction && (
                    <div style={styles.feedbackCorrection}>
                      <h4>Simple correction</h4>
                      <p>{evaluation.correction}</p>
                    </div>
                  )}

                  {evaluation.betterExplanation && (
                    <div style={styles.feedbackBetter}>
                      <h4>A clearer way to explain it</h4>
                      <p>{evaluation.betterExplanation}</p>
                    </div>
                  )}

                  {evaluation.retryPrompt && (
                    <div style={styles.retryPrompt}>
                      <span>↻</span>
                      <div>
                        <strong>Try once more</strong>
                        <p>{evaluation.retryPrompt}</p>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </section>
          )}

          {videoUrl && (
            <section
              style={styles.videoCard}
              className="tb-video-card"
            >
              <div
                style={styles.videoHeader}
                className="tb-video-header"
              >
                <div>
                  <div style={styles.videoEyebrow}>
                    03 · VISUAL LESSON
                  </div>

                  <h2 style={styles.videoTitle}>
                    {videoTitle}
                  </h2>

                  <p
                    style={
                      styles.videoDescription
                    }
                  >
                    A focused vertical lesson with
                    fresh topic-specific key-point
                    visuals and natural Indian
                    English narration.
                  </p>
                </div>

                <div style={styles.videoBadge}>
                  ▶ READY
                </div>
              </div>

              <div style={styles.videoStage}>
                <video
                  key={videoUrl}
                  controls
                  preload="metadata"
                  src={videoUrl}
                  style={styles.video}
                />
              </div>

              <div style={styles.videoMetaRow}>
                <span>
                  ⏱{' '}
                  {videoDuration
                    ? `${Math.round(
                      videoDuration
                    )} seconds`
                    : 'Video ready'}
                </span>

                <a
                  href={videoUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={styles.openLink}
                >
                  Open video ↗
                </a>
              </div>

              {scenes.length > 0 && (
                <div style={styles.sceneList}>
                  <div style={styles.sceneHeader}>
                    <div>
                      <span
                        style={styles.cardEyebrow}
                      >
                        LESSON MAP
                      </span>

                      <h3
                        style={styles.sceneHeading}
                      >
                        Your lesson structure
                      </h3>
                    </div>

                    <span style={styles.sceneCount}>
                      {scenes.length} scenes
                    </span>
                  </div>

                  <div
                    style={styles.sceneGrid}
                    className="tb-scene-grid"
                  >
                    {scenes.map((scene, i) => (
                      <div
                        key={i}
                        style={styles.sceneItem}
                      >
                        <div
                          style={{
                            ...styles.sceneNumber,
                            background:
                              i % 2 === 0
                                ? 'linear-gradient(135deg,#1565c0,#42a5f5)'
                                : 'linear-gradient(135deg,#ff7a18,#ffad42)',
                          }}
                        >
                          {String(i + 1).padStart(
                            2,
                            '0'
                          )}
                        </div>

                        <div
                          style={styles.sceneContent}
                        >
                          <strong>
                            {scene.title ||
                              `Scene ${i + 1}`}
                          </strong>

                          {scene.narration && (
                            <p>
                              {scene.narration}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}

          {(file || extractedText) && (
            <button
              type="button"
              onClick={resetAll}
              style={styles.resetButton}
            >
              ↻ Start with another PDF
            </button>
          )}

          <footer style={styles.footer}>
            <img
              src="./teachback-logo.png"
              alt="TeachBack"
              style={styles.footerLogo}
            />

            <span>
              TeachBack · Learn it. Explain it.
              Master it.
            </span>

            <span>
              Local AI study assistant
            </span>
          </footer>
        </main>
      </div>
    </>
  );
}

const styles = {
  page: {
    minHeight: '100vh',
    position: 'relative',
    overflow: 'hidden',
    background:
      'radial-gradient(circle at 8% 10%, rgba(66,165,245,.13), transparent 26%), radial-gradient(circle at 92% 18%, rgba(255,152,0,.13), transparent 25%), linear-gradient(135deg,#f7fbff 0%,#ffffff 48%,#f7f4ff 100%)',
    fontFamily:
      'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    color: '#10213f',
    paddingBottom: 70,
  },

  ambientOne: {
    position: 'absolute',
    width: 360,
    height: 360,
    borderRadius: '50%',
    background: 'rgba(21,101,192,.07)',
    filter: 'blur(10px)',
    top: 420,
    left: -180,
    pointerEvents: 'none',
  },

  ambientTwo: {
    position: 'absolute',
    width: 420,
    height: 420,
    borderRadius: '50%',
    background: 'rgba(255,143,0,.06)',
    filter: 'blur(12px)',
    top: 1150,
    right: -220,
    pointerEvents: 'none',
  },

  header: {
    position: 'relative',
    zIndex: 2,
    maxWidth: 1180,
    margin: '0 auto',
    padding: '22px 24px',
  },

  navbar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 20,
    padding: '12px 16px',
    borderRadius: 22,
    background: 'rgba(255,255,255,.82)',
    border: '1px solid rgba(148,163,184,.22)',
    boxShadow: '0 10px 35px rgba(30,64,175,.07)',
    backdropFilter: 'blur(18px)',
  },

  brandButton: {
    border: 0,
    background: 'transparent',
    display: 'flex',
    alignItems: 'center',
    gap: 11,
    cursor: 'pointer',
    padding: 0,
    textAlign: 'left',
  },

  /*
   * ONLY LOGO CHANGE #1
   * Top-left logo:
   * - circular
   * - zoomed slightly
   * - black square corners are cropped away
   */
  logoImage: {
    width: 48,
    height: 48,
    objectFit: 'cover',
    objectPosition: 'center',
    borderRadius: '50%',
    transform: 'scale(1.34)',
    clipPath: 'circle(50% at 50% 50%)',
  },

  brandName: {
    fontSize: 21,
    fontWeight: 900,
    letterSpacing: '-.7px',
    color: '#10213f',
  },

  brandMini: {
    fontSize: 8,
    fontWeight: 900,
    letterSpacing: '1.5px',
    color: '#71809a',
    marginTop: 1,
  },

  navRight: {
    display: 'flex',
    alignItems: 'center',
    gap: 9,
  },

  localBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: 7,
    padding: '8px 11px',
    borderRadius: 20,
    background: '#effcf5',
    color: '#18794e',
    fontSize: 12,
    fontWeight: 800,
  },

  liveDot: {
    width: 7,
    height: 7,
    borderRadius: '50%',
    background: '#22c55e',
    boxShadow:
      '0 0 0 4px rgba(34,197,94,.12)',
  },

  englishNav: {
    padding: '8px 11px',
    borderRadius: 20,
    background: '#f1f5ff',
    color: '#2454a6',
    fontSize: 11,
    fontWeight: 900,
  },

  container: {
    width: 'min(1180px,92%)',
    margin: '0 auto',
    position: 'relative',
    zIndex: 1,
  },

  hero: {
    position: 'relative',
    minHeight: 480,
    borderRadius: 34,
    overflow: 'hidden',
    padding: '58px 60px',
    display: 'grid',
    gridTemplateColumns: '1.15fr .85fr',
    gap: 30,
    alignItems: 'center',
    background:
      'linear-gradient(135deg,#071d46 0%,#0c3c83 52%,#145ea9 100%)',
    boxShadow:
      '0 25px 70px rgba(8,43,94,.22)',
  },

  heroGlow: {
    position: 'absolute',
    width: 540,
    height: 540,
    borderRadius: '50%',
    right: -100,
    top: -220,
    background:
      'radial-gradient(circle,rgba(255,166,61,.32),rgba(255,166,61,0) 68%)',
  },

  heroCopy: {
    position: 'relative',
    zIndex: 2,
  },

  heroPill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 12px',
    borderRadius: 30,
    background: 'rgba(255,255,255,.10)',
    border:
      '1px solid rgba(255,255,255,.15)',
    color: '#bcd9ff',
    fontSize: 10,
    fontWeight: 900,
    letterSpacing: '1.4px',
  },

  spark: {
    color: '#ffad42',
    fontSize: 15,
  },

  heroTitle: {
    margin: '20px 0 15px',
    color: '#fff',
    fontSize: 'clamp(46px,6vw,78px)',
    lineHeight: 0.98,
    letterSpacing: '-4px',
    fontWeight: 900,
  },

  heroAccent: {
    color: '#ff9b2f',
  },

  heroText: {
    maxWidth: 610,
    color: '#d9e8ff',
    fontSize: 16,
    lineHeight: 1.7,
    margin: 0,
  },

  heroActions: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 18,
    marginTop: 28,
  },

  heroButton: {
    border: 0,
    display: 'flex',
    alignItems: 'center',
    gap: 18,
    padding: '14px 18px 14px 22px',
    borderRadius: 15,
    background:
      'linear-gradient(135deg,#ff7b1a,#ffae42)',
    color: '#fff',
    fontWeight: 900,
    fontSize: 14,
    cursor: 'pointer',
    boxShadow:
      '0 12px 30px rgba(255,128,23,.28)',
  },

  arrow: {
    display: 'grid',
    placeItems: 'center',
    width: 30,
    height: 30,
    borderRadius: 10,
    background: 'rgba(255,255,255,.2)',
    fontSize: 18,
  },

  heroHint: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    color: '#b8d1ef',
    fontSize: 12,
    fontWeight: 700,
  },

  checkCircle: {
    display: 'grid',
    placeItems: 'center',
    width: 21,
    height: 21,
    borderRadius: '50%',
    background:
      'rgba(77,208,147,.17)',
    color: '#69e0aa',
  },

  heroVisual: {
    minHeight: 360,
    position: 'relative',
    display: 'grid',
    placeItems: 'center',
  },

  orbit: {
    position: 'absolute',
    border:
      '1px solid rgba(255,255,255,.13)',
    borderRadius: '50%',
  },

  orbitA: {
    width: 350,
    height: 350,
  },

  orbitB: {
    width: 260,
    height: 260,
  },

  studyOrb: {
    width: 185,
    height: 185,
    position: 'relative',
    borderRadius: '50%',
    display: 'grid',
    placeItems: 'center',
    background:
      'radial-gradient(circle at 35% 25%,#fff,#d8ecff 45%,#7bb7ef 100%)',
    boxShadow:
      '0 0 0 15px rgba(255,255,255,.06), 0 25px 60px rgba(0,0,0,.22)',
  },

  /*
   * ONLY LOGO CHANGE #2
   * Middle-right hero logo:
   * - circular
   * - black square frame is cropped
   * - keeps the TeachBack mark centered
   */
  heroLogo: {
    width: 115,
    height: 115,
    objectFit: 'cover',
    objectPosition: 'center',
    borderRadius: '50%',
    transform: 'scale(1.34)',
    clipPath: 'circle(50% at 50% 50%)',
    position: 'relative',
    zIndex: 2,
  },

  orbRing: {
    position: 'absolute',
    inset: 12,
    borderRadius: '50%',
    border:
      '1px solid rgba(21,101,192,.16)',
  },

  floatingCardTop: {
    position: 'absolute',
    top: 12,
    right: 0,
    display: 'flex',
    gap: 10,
    alignItems: 'center',
    padding: 13,
    borderRadius: 16,
    background:
      'rgba(255,255,255,.12)',
    border:
      '1px solid rgba(255,255,255,.15)',
    backdropFilter: 'blur(14px)',
    color: '#fff',
  },

  floatingCardBottom: {
    position: 'absolute',
    bottom: 18,
    left: 5,
    display: 'flex',
    gap: 10,
    alignItems: 'center',
    padding: 13,
    borderRadius: 16,
    background:
      'rgba(255,255,255,.12)',
    border:
      '1px solid rgba(255,255,255,.15)',
    backdropFilter: 'blur(14px)',
    color: '#fff',
  },

  miniIconBlue: {
    width: 34,
    height: 34,
    display: 'grid',
    placeItems: 'center',
    borderRadius: 11,
    background: '#42a5f5',
  },

  miniIconOrange: {
    width: 34,
    height: 34,
    display: 'grid',
    placeItems: 'center',
    borderRadius: 11,
    background: '#ff922f',
  },

  statsRow: {
    display: 'grid',
    gridTemplateColumns:
      'repeat(3,1fr)',
    gap: 14,
    marginTop: 16,
  },

  statCard: {
    display: 'flex',
    gap: 15,
    alignItems: 'center',
    padding: '18px 20px',
    borderRadius: 20,
    background:
      'rgba(255,255,255,.88)',
    border:
      '1px solid rgba(148,163,184,.18)',
    boxShadow:
      '0 10px 28px rgba(30,64,175,.05)',
  },

  statNumber: {
    color: '#1976d2',
    fontSize: 23,
    fontWeight: 900,
    letterSpacing: '-1px',
  },

  orangeText: {
    color: '#ef8a18',
  },

  purpleText: {
    color: '#7654d8',
  },

  workspaceHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'end',
    gap: 30,
    margin: '54px 3px 20px',
  },

  sectionEyebrow: {
    color: '#3971bd',
    fontSize: 10,
    fontWeight: 900,
    letterSpacing: '1.8px',
  },

  workspaceTitle: {
    fontSize: 34,
    margin: '5px 0 3px',
    letterSpacing: '-1.5px',
  },

  workspaceSub: {
    margin: 0,
    color: '#6b7a91',
    fontSize: 14,
  },

  progressTrack: {
    width: 190,
    height: 7,
    borderRadius: 20,
    background: '#e5edf7',
    overflow: 'hidden',
    marginBottom: 7,
  },

  progressFill: {
    height: '100%',
    borderRadius: 20,
    background:
      'linear-gradient(90deg,#1565c0,#42a5f5,#ff9b2f)',
    transition: 'width .4s ease',
  },

  card: {
    background:
      'rgba(255,255,255,.94)',
    borderRadius: 25,
    padding: 30,
    marginTop: 18,
    border:
      '1px solid rgba(148,163,184,.20)',
    boxShadow:
      '0 16px 45px rgba(30,64,175,.07)',
    backdropFilter: 'blur(12px)',
  },

  cardTop: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 15,
  },

  stepBadge: {
    flexShrink: 0,
    width: 46,
    height: 46,
    borderRadius: 14,
    display: 'grid',
    placeItems: 'center',
    color: '#fff',
    fontWeight: 900,
    fontSize: 13,
    background:
      'linear-gradient(135deg,#1565c0,#42a5f5)',
    boxShadow:
      '0 9px 20px rgba(21,101,192,.22)',
  },

  orangeBadge: {
    background:
      'linear-gradient(135deg,#ef7d16,#ffad42)',
    boxShadow:
      '0 9px 20px rgba(239,125,22,.20)',
  },

  cardHeading: {
    flex: 1,
  },

  cardEyebrow: {
    color: '#75849b',
    fontSize: 9,
    fontWeight: 900,
    letterSpacing: '1.5px',
  },

  cardTitle: {
    margin: '4px 0 4px',
    fontSize: 24,
    letterSpacing: '-.8px',
  },

  cardText: {
    margin: 0,
    color: '#718096',
    fontSize: 13,
    lineHeight: 1.55,
  },

  readyPill: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '7px 10px',
    borderRadius: 20,
    color: '#7b8799',
    background: '#f4f7fb',
    fontSize: 10,
    fontWeight: 900,
  },

  readyPillDone: {
    color: '#168052',
    background: '#ecfbf3',
  },

  englishPill: {
    display: 'flex',
    alignItems: 'center',
    gap: 7,
    padding: '8px 11px',
    borderRadius: 20,
    color: '#315b9c',
    background: '#eef5ff',
    fontSize: 9,
    fontWeight: 900,
  },

  dropZone: {
    width: '100%',
    minHeight: 190,
    boxSizing: 'border-box',
    marginTop: 23,
    border:
      '2px dashed #c8d7ea',
    borderRadius: 20,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    cursor: 'pointer',
    background:
      'linear-gradient(135deg,rgba(244,250,255,.96),rgba(250,248,255,.96))',
    transition: 'all .2s ease',
  },

  dropZoneSelected: {
    border:
      '2px dashed #5b9ee8',
    background:
      'linear-gradient(135deg,#f0f8ff,#f8f4ff)',
  },

  uploadIcon: {
    width: 58,
    height: 58,
    borderRadius: 17,
    display: 'grid',
    placeItems: 'center',
    color: '#fff',
    fontSize: 28,
    fontWeight: 500,
    background:
      'linear-gradient(135deg,#1565c0,#42a5f5)',
    boxShadow:
      '0 12px 28px rgba(21,101,192,.2)',
  },

  dropTitle: {
    fontWeight: 850,
    color: '#233654',
    fontSize: 15,
    maxWidth: '90%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },

  dropSub: {
    color: '#7c8da5',
    fontSize: 12,
  },

  buttonRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 11,
    marginTop: 16,
  },

  outlineButton: {
    border:
      '1px solid #d3deeb',
    borderRadius: 13,
    padding: '13px 19px',
    background: '#fff',
    color: '#27405f',
    fontSize: 13,
    fontWeight: 800,
    cursor: 'pointer',
  },

  gradientButton: {
    border: 0,
    borderRadius: 13,
    padding: '13px 20px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    background:
      'linear-gradient(135deg,#1565c0,#2788dd)',
    color: '#fff',
    fontSize: 13,
    fontWeight: 850,
    cursor: 'pointer',
    boxShadow:
      '0 9px 22px rgba(21,101,192,.19)',
  },

  disabledButton: {
    opacity: 0.55,
    cursor: 'not-allowed',
    boxShadow: 'none',
  },

  buttonSpinner: {
    width: 14,
    height: 14,
    border:
      '2px solid rgba(255,255,255,.35)',
    borderTopColor: '#fff',
    borderRadius: '50%',
    display: 'inline-block',
  },

  topicWrap: {
    position: 'relative',
    marginTop: 23,
  },

  topicSearch: {
    position: 'absolute',
    left: 17,
    top: 13,
    fontSize: 25,
    color: '#7c91ad',
    zIndex: 1,
    transform: 'rotate(-15deg)',
  },

  topicInput: {
    width: '100%',
    boxSizing: 'border-box',
    padding: '16px 46px',
    border:
      '1px solid #cfdae8',
    borderRadius: 15,
    fontSize: 16,
    color: '#203552',
    background: '#fbfdff',
    outline: 'none',
    boxShadow:
      'inset 0 1px 2px rgba(15,23,42,.02)',
  },

  clearTopic: {
    position: 'absolute',
    right: 10,
    top: 9,
    width: 34,
    height: 34,
    border: 0,
    borderRadius: 10,
    background: '#edf2f8',
    color: '#61718a',
    fontSize: 20,
    cursor: 'pointer',
  },

  languageBox: {
    marginTop: 15,
    padding: 15,
    borderRadius: 16,
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    background:
      'linear-gradient(135deg,#f5f9ff,#fff8ef)',
    border:
      '1px solid #e0e8f2',
  },

  languageIcon: {
    width: 42,
    height: 42,
    flexShrink: 0,
    display: 'grid',
    placeItems: 'center',
    borderRadius: 12,
    color: '#fff',
    background:
      'linear-gradient(135deg,#1565c0,#42a5f5)',
    fontSize: 12,
    fontWeight: 900,
  },

  languageText: {
    margin: '5px 0 0',
    color: '#687990',
    lineHeight: 1.5,
    fontSize: 12,
  },

  languageCheck: {
    marginLeft: 'auto',
    width: 25,
    height: 25,
    flexShrink: 0,
    borderRadius: '50%',
    display: 'grid',
    placeItems: 'center',
    color: '#168052',
    background: '#e5f8ee',
    fontWeight: 900,
  },

  actionGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 13,
    marginTop: 18,
  },

  explainButton: {
    border:
      '1px solid #cbdcf0',
    borderRadius: 17,
    padding: 16,
    background: '#f7fbff',
    color: '#19395f',
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    textAlign: 'left',
    cursor: 'pointer',
  },

  videoButton: {
    border: 0,
    borderRadius: 17,
    padding: 16,
    background:
      'linear-gradient(135deg,#ff7a18,#ffad42)',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    textAlign: 'left',
    cursor: 'pointer',
    boxShadow:
      '0 11px 28px rgba(255,132,26,.2)',
  },

  actionIconBlue: {
    width: 40,
    height: 40,
    flexShrink: 0,
    borderRadius: 12,
    display: 'grid',
    placeItems: 'center',
    color: '#fff',
    background: '#2d83d4',
  },

  actionIconOrange: {
    width: 40,
    height: 40,
    flexShrink: 0,
    borderRadius: 12,
    display: 'grid',
    placeItems: 'center',
    color: '#fff',
    background:
      'rgba(255,255,255,.18)',
  },

  actionArrow: {
    marginLeft: 'auto',
    fontSize: 20,
  },

  generationBox: {
    marginTop: 18,
    display: 'flex',
    alignItems: 'center',
    gap: 15,
    padding: 17,
    borderRadius: 17,
    background: '#f4f8fd',
    border:
      '1px solid #dbe7f4',
  },

  generationOrb: {
    width: 48,
    height: 48,
    flexShrink: 0,
    display: 'grid',
    placeItems: 'center',
    borderRadius: '50%',
    color: '#fff',
    background:
      'linear-gradient(135deg,#1565c0,#8c6de2)',
    boxShadow:
      '0 0 0 8px #e8f1fb',
  },

  generationText: {
    margin: '5px 0 0',
    color: '#657790',
    fontSize: 12,
    lineHeight: 1.5,
  },

  loadingBar: {
    height: 5,
    borderRadius: 20,
    background: '#dce7f2',
    overflow: 'hidden',
    marginTop: 11,
  },

  loadingBarFill: {
    width: '45%',
    height: '100%',
    borderRadius: 20,
    background:
      'linear-gradient(90deg,#1565c0,#ff9b2f)',
  },

  notice: {
    marginTop: 17,
    padding: 13,
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    borderRadius: 14,
    background: '#edfbf4',
    color: '#176d49',
    border:
      '1px solid #c8efd9',
    fontSize: 13,
    fontWeight: 650,
  },

  noticeIcon: {
    width: 25,
    height: 25,
    flexShrink: 0,
    borderRadius: '50%',
    display: 'grid',
    placeItems: 'center',
    background: '#d7f5e5',
    color: '#13804f',
    fontWeight: 900,
  },

  error: {
    marginTop: 17,
    padding: 14,
    display: 'flex',
    gap: 11,
    borderRadius: 14,
    background: '#fff3f4',
    color: '#9c2341',
    border:
      '1px solid #f8ccd5',
    lineHeight: 1.55,
    fontSize: 13,
  },

  errorIcon: {
    width: 25,
    height: 25,
    flexShrink: 0,
    display: 'grid',
    placeItems: 'center',
    borderRadius: '50%',
    background: '#ffdce3',
    color: '#b42348',
    fontWeight: 900,
  },

  explanationCard: {
    marginTop: 18,
    padding: 30,
    borderRadius: 25,
    background: '#fff',
    border:
      '1px solid rgba(66,165,245,.18)',
    boxShadow:
      '0 18px 48px rgba(21,101,192,.08)',
  },

  resultTop: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
  },

  resultIconBlue: {
    width: 48,
    height: 48,
    flexShrink: 0,
    display: 'grid',
    placeItems: 'center',
    borderRadius: 15,
    color: '#fff',
    background:
      'linear-gradient(135deg,#1565c0,#42a5f5)',
    fontSize: 20,
  },

  resultTitle: {
    fontSize: 29,
    margin: '4px 0 0',
    letterSpacing: '-1px',
    overflowWrap: 'anywhere',
  },

  resultBadge: {
    padding: '7px 10px',
    borderRadius: 20,
    color: '#2464aa',
    background: '#edf6ff',
    fontSize: 10,
    fontWeight: 900,
  },

  explanationText: {
    marginTop: 23,
    whiteSpace: 'pre-wrap',
    lineHeight: 1.82,
    fontSize: 16,
    color: '#2c405d',
  },

  infoBoxOrange: {
    marginTop: 22,
    padding: 17,
    display: 'flex',
    gap: 13,
    borderRadius: 17,
    background: '#fff8ee',
    border:
      '1px solid #ffe2b8',
  },

  infoBoxBlue: {
    marginTop: 12,
    padding: 17,
    display: 'flex',
    gap: 13,
    borderRadius: 17,
    background: '#f2f8ff',
    border:
      '1px solid #d7e9fb',
  },

  infoIconOrange: {
    width: 34,
    height: 34,
    flexShrink: 0,
    display: 'grid',
    placeItems: 'center',
    borderRadius: 10,
    background: '#ff9d31',
    color: '#fff',
    fontWeight: 900,
  },

  infoIconBlue: {
    width: 34,
    height: 34,
    flexShrink: 0,
    display: 'grid',
    placeItems: 'center',
    borderRadius: 10,
    background: '#2c82d1',
    color: '#fff',
    fontWeight: 900,
  },

  infoHeading: {
    margin: 0,
    fontSize: 14,
  },

  infoParagraphOrange: {
    margin: '5px 0 0',
    lineHeight: 1.6,
    color: '#6d5b43',
    fontSize: 14,
  },

  infoParagraphBlue: {
    margin: '5px 0 0',
    lineHeight: 1.6,
    color: '#52677f',
    fontSize: 14,
  },

  teachBackCard: {
    marginTop: 18,
    padding: 30,
    borderRadius: 25,
    background:
      'linear-gradient(135deg,#ffffff 0%,#fbf9ff 100%)',
    border:
      '1px solid rgba(118,84,216,.18)',
    boxShadow:
      '0 18px 48px rgba(118,84,216,.07)',
  },

  resultIconPurple: {
    width: 48,
    height: 48,
    flexShrink: 0,
    display: 'grid',
    placeItems: 'center',
    borderRadius: 15,
    color: '#fff',
    background:
      'linear-gradient(135deg,#7654d8,#a178e8)',
    fontSize: 21,
    fontWeight: 900,
  },

  resultBadgePurple: {
    padding: '7px 10px',
    borderRadius: 20,
    color: '#6d4bc2',
    background: '#f2edff',
    fontSize: 10,
    fontWeight: 900,
  },

  teachBackIntro: {
    margin: '7px 0 0',
    color: '#687990',
    lineHeight: 1.6,
    fontSize: 13,
  },

  teachBackInput: {
    width: '100%',
    marginTop: 22,
    padding: 17,
    boxSizing: 'border-box',
    resize: 'vertical',
    minHeight: 150,
    border:
      '1px solid #d7d0eb',
    borderRadius: 17,
    background: '#fff',
    color: '#263b59',
    fontFamily: 'inherit',
    fontSize: 15,
    lineHeight: 1.7,
    outline: 'none',
  },

  teachBackBottom: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 12,
  },

  characterHint: {
    color: '#7a879b',
    fontSize: 11,
    fontWeight: 700,
  },

  evaluateButton: {
    border: 0,
    borderRadius: 13,
    padding: '13px 19px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    background:
      'linear-gradient(135deg,#7654d8,#9a76e5)',
    color: '#fff',
    fontSize: 13,
    fontWeight: 850,
    cursor: 'pointer',
    boxShadow:
      '0 9px 22px rgba(118,84,216,.20)',
  },

  evaluationResult: {
    marginTop: 24,
    paddingTop: 23,
    borderTop:
      '1px solid #e8e1f5',
  },

  evaluationStatus: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },

  evaluationStatusIcon: {
    width: 42,
    height: 42,
    display: 'grid',
    placeItems: 'center',
    borderRadius: 13,
    background: '#e9f8ef',
    color: '#178151',
    fontWeight: 900,
    fontSize: 18,
  },

  evaluationTitle: {
    margin: '4px 0 0',
    fontSize: 21,
    color: '#263b59',
  },

  feedbackBoxGreen: {
    marginTop: 17,
    padding: 16,
    borderRadius: 16,
    background: '#effaf4',
    border: '1px solid #cfeedd',
    color: '#315e49',
  },

  feedbackBoxOrange: {
    marginTop: 11,
    padding: 16,
    borderRadius: 16,
    background: '#fff8ee',
    border: '1px solid #ffe1b6',
    color: '#6b573b',
  },

  feedbackBoxBlue: {
    marginTop: 11,
    padding: 16,
    borderRadius: 16,
    background: '#f2f8ff',
    border: '1px solid #d7e8fb',
    color: '#405d7b',
  },

  feedbackCorrection: {
    marginTop: 11,
    padding: 16,
    borderRadius: 16,
    background: '#f8f5ff',
    border: '1px solid #e2d9fa',
    color: '#554578',
  },

  feedbackBetter: {
    marginTop: 11,
    padding: 16,
    borderRadius: 16,
    background: '#f5f9ff',
    border: '1px solid #dce8f7',
    color: '#405774',
  },

  feedbackBoxGreen_h4: {
    margin: 0,
  },

  retryPrompt: {
    marginTop: 13,
    padding: 15,
    display: 'flex',
    gap: 12,
    borderRadius: 15,
    background: '#f4f0ff',
    border: '1px solid #e2d9fb',
    color: '#5c4a82',
  },

  videoCard: {
    marginTop: 20,
    padding: 30,
    borderRadius: 27,
    color: '#fff',
    background:
      'linear-gradient(145deg,#07182f 0%,#0b2c58 55%,#112f58 100%)',
    boxShadow:
      '0 25px 65px rgba(3,20,45,.22)',
  },

  videoHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 20,
    alignItems: 'flex-start',
  },

  videoEyebrow: {
    color: '#78b9f5',
    fontSize: 10,
    fontWeight: 900,
    letterSpacing: '1.7px',
  },

  videoTitle: {
    fontSize: 30,
    margin: '6px 0 5px',
    letterSpacing: '-1px',
    overflowWrap: 'anywhere',
  },

  videoDescription: {
    maxWidth: 760,
    margin: 0,
    color: '#adc4de',
    lineHeight: 1.6,
    fontSize: 13,
  },

  videoBadge: {
    flexShrink: 0,
    padding: '8px 11px',
    borderRadius: 20,
    background:
      'rgba(255,151,44,.15)',
    border:
      '1px solid rgba(255,151,44,.25)',
    color: '#ffb052',
    fontSize: 10,
    fontWeight: 900,
  },

  videoStage: {
    marginTop: 23,
    padding: 15,
    borderRadius: 22,
    background:
      'rgba(0,0,0,.26)',
    border:
      '1px solid rgba(255,255,255,.08)',
  },

  video: {
    display: 'block',
    width: 'min(570px,100%)',
    height: 'auto',
    maxHeight: '760px',
    margin: '0 auto',
    borderRadius: 14,
    background: '#000',
  },

  videoMetaRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 15,
    marginTop: 13,
    color: '#9eb6d1',
    fontSize: 12,
  },

  openLink: {
    color: '#79c2ff',
    textDecoration: 'none',
    fontWeight: 800,
  },

  sceneList: {
    marginTop: 27,
    paddingTop: 23,
    borderTop:
      '1px solid rgba(255,255,255,.09)',
  },

  sceneHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 15,
  },

  sceneHeading: {
    margin: '5px 0 0',
    fontSize: 20,
  },

  sceneCount: {
    padding: '7px 10px',
    borderRadius: 20,
    background:
      'rgba(255,255,255,.08)',
    color: '#b8cbe0',
    fontSize: 10,
    fontWeight: 900,
  },

  sceneGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 10,
    marginTop: 15,
  },

  sceneItem: {
    display: 'flex',
    gap: 12,
    padding: 14,
    borderRadius: 15,
    background:
      'rgba(255,255,255,.045)',
    border:
      '1px solid rgba(255,255,255,.06)',
  },

  sceneNumber: {
    width: 38,
    height: 38,
    flexShrink: 0,
    borderRadius: 11,
    display: 'grid',
    placeItems: 'center',
    color: '#fff',
    fontSize: 10,
    fontWeight: 900,
  },

  sceneContent: {
    minWidth: 0,
  },

  resetButton: {
    display: 'block',
    margin: '25px auto',
    border:
      '1px solid #d4dfec',
    background:
      'rgba(255,255,255,.82)',
    color: '#536982',
    borderRadius: 13,
    padding: '11px 17px',
    cursor: 'pointer',
    fontWeight: 750,
  },

  footer: {
    marginTop: 52,
    paddingTop: 23,
    borderTop:
      '1px solid rgba(148,163,184,.18)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: 10,
    color: '#8492a7',
    fontSize: 11,
  },

  footerLogo: {
    width: 28,
    height: 28,
    objectFit: 'contain',
  },
};

export default App;
