import '@/styles/landing.css'

interface Props {
  onSignIn: () => void
  loading: boolean
  error: string
}

const SENSES = [
  {
    text: 'Everything you own, in one calm place: stocks, crypto, bonds, retirement and cash.',
    example: 'I opened mne and the whole picture was there.',
  },
  {
    text: 'A plain-English answer to why that total moved.',
    example: 'Ask mne why it dropped on Tuesday.',
  },
  { text: 'Taxes, lots and RSU vests, kept straight. Private by default.' },
]

// The pronunciation is the joke: "mne" is said "money".
function speakMoney() {
  try {
    const u = new SpeechSynthesisUtterance('money')
    u.rate = 0.85
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(u)
  } catch {
    // speech synthesis unavailable; the respelling is still on the page
  }
}

function SpeakerIcon() {
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} fill="currentColor" aria-hidden="true">
      <path d="M3 9v6h4l5 4V5L7 9H3zm13.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z" />
    </svg>
  )
}

export default function Landing({ onSignIn, loading, error }: Props) {
  return (
    <div className="landing">
      <main className="landing-main landing-wrap">
        <article className="landing-entry">
          <header className="landing-entry-head">
            <span>mne</span>
            <button onClick={onSignIn} disabled={loading} className="landing-link">
              {loading ? 'Redirecting...' : 'Sign in'}
            </button>
          </header>

          {error && <p role="alert" className="landing-error">▼ {error}</p>}

          <h1 className="landing-word">
            mne<sup>1</sup>
          </h1>

          <div className="landing-pron">
            <span className="landing-ipa">/ˈmʌn.i/</span>
            <span className="landing-resp">pronounced “money”</span>
            <button type="button" className="landing-say" onClick={speakMoney} aria-label="Hear the pronunciation">
              <SpeakerIcon />
              Listen
            </button>
          </div>

          <p className="landing-pos">noun</p>
          <ol className="landing-senses">
            {SENSES.map((s, i) => (
              <li key={s.text}>
                <b>{i + 1}.</b>
                <div>
                  <p>{s.text}</p>
                  {s.example && <p className="landing-ex">“{s.example}”</p>}
                </div>
              </li>
            ))}
          </ol>

          <p className="landing-ety">
            <b>Origin</b>
            Money, with the vowels taken out and nothing else lost.
          </p>

          <a className="landing-quiet" href="https://github.com/adityadesai97/mne" target="_blank" rel="noopener noreferrer">
            View source on GitHub
          </a>
        </article>
      </main>
    </div>
  )
}
