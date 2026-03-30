import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const API_URL = import.meta.env.VITE_API_URL || '/api'

const STAGES = [
  { id: 'fetch',    label: 'Fetching repo',         icon: '⬇️', color: '#58a6ff' },
  { id: 'arch',     label: 'Mapping architecture',  icon: '🏗️', color: '#bc8cff' },
  { id: 'bugs',     label: 'Finding bugs',           icon: '🐛', color: '#f85149' },
  { id: 'roadmap',  label: 'Building roadmap',       icon: '🗺️', color: '#3fb950' },
]

const TABS = [
  { id: 'architecture', label: '🏗️ Architecture', key: 'architecture_report' },
  { id: 'bugs',         label: '🐛 Bugs & Issues',  key: 'bugs_report' },
  { id: 'roadmap',      label: '🗺️ Roadmap',         key: 'roadmap_report' },
]

const EXAMPLES = [
  'https://github.com/aaaditt/ai-ship-chartering',
  'https://github.com/tiangolo/fastapi',
  'https://github.com/pallets/flask',
]

function PipelineStage({ stage, status }) {
  const colors = { idle: '#484f58', active: stage.color, done: '#3fb950', error: '#f85149' }
  const color = colors[status] || colors.idle
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '10px',
      padding: '10px 14px',
      borderRadius: '8px',
      background: status === 'active' ? `${color}15` : 'transparent',
      border: `1px solid ${status === 'active' ? color : status === 'done' ? '#3fb95030' : '#30363d'}`,
      transition: 'all 0.3s ease',
    }}>
      <span style={{ fontSize: '1.1rem' }}>{status === 'done' ? '✅' : status === 'error' ? '❌' : stage.icon}</span>
      <span style={{
        fontSize: '0.875rem',
        color: status === 'idle' ? '#484f58' : status === 'active' ? color : status === 'done' ? '#3fb950' : '#f85149',
        fontWeight: status === 'active' ? 600 : 400,
        transition: 'color 0.3s ease',
      }}>
        {stage.label}
      </span>
      {status === 'active' && (
        <span style={{ marginLeft: 'auto', display: 'flex', gap: '3px' }}>
          {[0,1,2].map(i => (
            <span key={i} style={{
              width: '5px', height: '5px', borderRadius: '50%',
              background: color,
              animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite`,
            }} />
          ))}
        </span>
      )}
    </div>
  )
}

function RepoMeta({ repo }) {
  if (!repo) return null
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '12px',
      padding: '12px 16px',
      background: '#161b22',
      border: '1px solid #30363d',
      borderRadius: '8px',
      marginBottom: '20px',
      flexWrap: 'wrap',
    }}>
      <span style={{ fontSize: '1.2rem' }}>📦</span>
      <span style={{ fontWeight: 600, color: '#58a6ff' }}>
        {repo.owner}/{repo.repo}
      </span>
      {repo.description && (
        <span style={{ color: '#8b949e', fontSize: '0.875rem', flex: 1 }}>{repo.description}</span>
      )}
      <div style={{ display: 'flex', gap: '8px', marginLeft: 'auto' }}>
        {repo.language && (
          <Chip color="#bc8cff">{repo.language}</Chip>
        )}
        {repo.stars > 0 && (
          <Chip color="#e3b341">⭐ {repo.stars.toLocaleString()}</Chip>
        )}
        <Chip color="#58a6ff">📄 {repo.file_count} files</Chip>
      </div>
    </div>
  )
}

function Chip({ color, children }) {
  return (
    <span style={{
      padding: '2px 8px',
      background: `${color}20`,
      color,
      borderRadius: '12px',
      fontSize: '0.75rem',
      fontWeight: 500,
      border: `1px solid ${color}40`,
      whiteSpace: 'nowrap',
    }}>
      {children}
    </span>
  )
}

function MarkdownReport({ content }) {
  return (
    <div className="md-content" style={{ padding: '0 4px' }}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  )
}

export default function App() {
  const [url, setUrl]           = useState('')
  const [loading, setLoading]   = useState(false)
  const [stages, setStages]     = useState({})
  const [result, setResult]     = useState(null)
  const [error, setError]       = useState('')
  const [activeTab, setActiveTab] = useState('architecture')

  function setStage(id, status) {
    setStages(prev => ({ ...prev, [id]: status }))
  }

  async function handleAnalyze() {
    if (!url.trim()) return
    setLoading(true)
    setResult(null)
    setError('')
    setStages({})
    setActiveTab('architecture')

    try {
      // Stage 1: fetch
      setStage('fetch', 'active')
      // small delay so users see the stages animate
      await new Promise(r => setTimeout(r, 400))
      setStage('fetch', 'done')

      // Stage 2: arch (active while waiting for response)
      setStage('arch', 'active')
      await new Promise(r => setTimeout(r, 600))
      setStage('arch', 'done')
      setStage('bugs', 'active')
      await new Promise(r => setTimeout(r, 400))

      // Actual API call — this takes a while
      const resp = await fetch(`${API_URL}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo_url: url.trim() }),
      })

      setStage('bugs', 'done')
      setStage('roadmap', 'active')
      await new Promise(r => setTimeout(r, 300))

      if (!resp.ok) {
        const err = await resp.json()
        throw new Error(err.error || 'Analysis failed')
      }

      const data = await resp.json()
      setStage('roadmap', 'done')
      setResult(data)
    } catch (e) {
      setError(e.message || 'Something went wrong')
      STAGES.forEach(s => {
        setStages(prev => {
          if (prev[s.id] === 'active') return { ...prev, [s.id]: 'error' }
          return prev
        })
      })
    } finally {
      setLoading(false)
    }
  }

  const stageStatus = (id) => stages[id] || 'idle'
  const activeReport = result && TABS.find(t => t.id === activeTab)?.key

  return (
    <>
      <style>{`
        @keyframes pulse { 0%,100%{opacity:0.3} 50%{opacity:1} }
        @keyframes fadeIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
        .fade-in { animation: fadeIn 0.4s ease forwards; }
        .tab-btn:hover { background: #21262d !important; }
      `}</style>

      <div style={{ minHeight: '100vh', background: '#0d1117' }}>

        {/* Header */}
        <header style={{
          borderBottom: '1px solid #21262d',
          padding: '0 24px',
          display: 'flex', alignItems: 'center', gap: '16px',
          height: '56px',
          position: 'sticky', top: 0, zIndex: 10,
          background: '#0d1117',
          backdropFilter: 'blur(8px)',
        }}>
          <span style={{ fontSize: '1.3rem' }}>🔬</span>
          <span style={{ fontWeight: 700, fontSize: '1rem', letterSpacing: '-0.02em' }}>
            Code Autopsy
          </span>
          <span style={{
            padding: '2px 8px', background: '#58a6ff20', color: '#58a6ff',
            borderRadius: '12px', fontSize: '0.7rem', fontWeight: 600,
            border: '1px solid #58a6ff40',
          }}>
            Powered by Google ADK
          </span>
          <span style={{ marginLeft: 'auto', color: '#484f58', fontSize: '0.8rem' }}>
            AI-powered codebase analysis
          </span>
        </header>

        <main style={{ maxWidth: '900px', margin: '0 auto', padding: '40px 24px' }}>

          {/* Hero */}
          {!result && !loading && (
            <div className="fade-in" style={{ textAlign: 'center', marginBottom: '48px' }}>
              <h1 style={{
                fontSize: 'clamp(2rem, 5vw, 3rem)', fontWeight: 700,
                letterSpacing: '-0.04em', lineHeight: 1.1, marginBottom: '16px',
              }}>
                Dissect any{' '}
                <span style={{ color: '#58a6ff' }}>GitHub repo</span>
              </h1>
              <p style={{ color: '#8b949e', fontSize: '1.1rem', maxWidth: '500px', margin: '0 auto' }}>
                A multi-agent AI pipeline that maps your architecture, hunts bugs,
                and builds a prioritized improvement roadmap.
              </p>
            </div>
          )}

          {/* Input */}
          <div style={{
            display: 'flex', gap: '10px', marginBottom: '12px',
            flexWrap: 'wrap',
          }}>
            <input
              type="text"
              value={url}
              onChange={e => setUrl(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !loading && handleAnalyze()}
              placeholder="https://github.com/owner/repo"
              disabled={loading}
              style={{
                flex: 1, minWidth: '260px',
                padding: '12px 16px',
                background: '#21262d',
                border: `1px solid ${url ? '#58a6ff60' : '#30363d'}`,
                borderRadius: '8px',
                color: '#e6edf3',
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: '0.9rem',
                outline: 'none',
                transition: 'border-color 0.2s',
              }}
            />
            <button
              onClick={handleAnalyze}
              disabled={loading || !url.trim()}
              style={{
                padding: '12px 24px',
                background: loading ? '#21262d' : '#238636',
                color: loading ? '#484f58' : '#fff',
                border: 'none',
                borderRadius: '8px',
                fontWeight: 600, fontSize: '0.9rem',
                cursor: loading ? 'not-allowed' : 'pointer',
                transition: 'all 0.2s',
                whiteSpace: 'nowrap',
              }}
            >
              {loading ? 'Analyzing…' : '🔬 Analyze'}
            </button>
          </div>

          {/* Example URLs */}
          {!result && !loading && (
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '40px' }}>
              <span style={{ color: '#484f58', fontSize: '0.8rem', paddingTop: '4px' }}>Try:</span>
              {EXAMPLES.map(ex => (
                <button key={ex} onClick={() => setUrl(ex)} style={{
                  background: 'none', border: '1px solid #30363d',
                  borderRadius: '6px', padding: '2px 10px',
                  color: '#8b949e', fontSize: '0.75rem', cursor: 'pointer',
                  fontFamily: 'JetBrains Mono, monospace',
                  transition: 'all 0.15s',
                }}>
                  {ex.replace('https://github.com/', '')}
                </button>
              ))}
            </div>
          )}

          {/* Pipeline progress */}
          {loading && (
            <div className="fade-in" style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: '10px', marginBottom: '32px',
            }}>
              {STAGES.map(s => (
                <PipelineStage key={s.id} stage={s} status={stageStatus(s.id)} />
              ))}
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="fade-in" style={{
              padding: '14px 18px',
              background: '#f8514910',
              border: '1px solid #f8514940',
              borderRadius: '8px',
              color: '#f85149',
              marginBottom: '20px',
            }}>
              ❌ {error}
            </div>
          )}

          {/* Results */}
          {result && (
            <div className="fade-in">
              <RepoMeta repo={result.repo} />

              {/* Tabs */}
              <div style={{
                display: 'flex', gap: '4px',
                borderBottom: '1px solid #21262d',
                marginBottom: '24px',
              }}>
                {TABS.map(tab => (
                  <button
                    key={tab.id}
                    className="tab-btn"
                    onClick={() => setActiveTab(tab.id)}
                    style={{
                      padding: '8px 16px',
                      background: activeTab === tab.id ? '#21262d' : 'none',
                      border: 'none',
                      borderBottom: activeTab === tab.id ? '2px solid #58a6ff' : '2px solid transparent',
                      color: activeTab === tab.id ? '#e6edf3' : '#8b949e',
                      fontWeight: activeTab === tab.id ? 600 : 400,
                      fontSize: '0.875rem',
                      cursor: 'pointer',
                      borderRadius: '6px 6px 0 0',
                      transition: 'all 0.15s',
                    }}
                  >
                    {tab.label}
                  </button>
                ))}

                <button
                  onClick={() => {
                    const text = `# Code Autopsy Report\n## ${result.repo.owner}/${result.repo.repo}\n\n${result.architecture_report}\n\n${result.bugs_report}\n\n${result.roadmap_report}`
                    navigator.clipboard.writeText(text)
                  }}
                  style={{
                    marginLeft: 'auto',
                    padding: '6px 12px',
                    background: 'none',
                    border: '1px solid #30363d',
                    borderRadius: '6px',
                    color: '#8b949e',
                    fontSize: '0.75rem',
                    cursor: 'pointer',
                    alignSelf: 'center',
                  }}
                >
                  📋 Copy all
                </button>
              </div>

              {/* Active tab content */}
              <div style={{
                background: '#161b22',
                border: '1px solid #30363d',
                borderRadius: '10px',
                padding: '24px',
              }}>
                {activeReport && result[activeReport] ? (
                  <MarkdownReport content={result[activeReport]} />
                ) : (
                  <p style={{ color: '#484f58', fontStyle: 'italic' }}>No content for this section.</p>
                )}
              </div>

              {/* New analysis button */}
              <div style={{ textAlign: 'center', marginTop: '32px' }}>
                <button
                  onClick={() => { setResult(null); setError(''); setUrl(''); setStages({}) }}
                  style={{
                    padding: '10px 24px',
                    background: 'none',
                    border: '1px solid #30363d',
                    borderRadius: '8px',
                    color: '#8b949e',
                    cursor: 'pointer',
                    fontSize: '0.875rem',
                  }}
                >
                  🔄 Analyze another repo
                </button>
              </div>
            </div>
          )}
        </main>
      </div>
    </>
  )
}
