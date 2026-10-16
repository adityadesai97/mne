import '@/styles/landing.css'

interface Props {
  onSignIn: () => void
  loading: boolean
  error: string
}

const ENTRIES = [
  {
    pos: 'noun',
    senses: [
      {
        text: 'Everything you own, in one calm place: stocks, crypto, bonds, retirement and cash.',
        example: 'I opened mne and the whole picture was there.',
      },
      {
        text: 'A way to ask your money questions and get straight answers.',
        example: 'Ask mne what I’d owe if I sold my oldest lots.',
      },
    ],
  },
  {
    pos: 'verb',
    senses: [{ text: 'To check on your holdings.', example: 'I’ll mne it after lunch.' }],
  },
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

          {ENTRIES.map(entry => (
            <section key={entry.pos} className="landing-group">
              <p className="landing-pos">{entry.pos}</p>
              <ol className="landing-senses">
                {entry.senses.map((sense, i) => (
                  <li key={sense.text}>
                    <b>{i + 1}.</b>
                    <div>
                      <p>{sense.text}</p>
                      <p className="landing-ex">“{sense.example}”</p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          ))}

          <p className="landing-ety">
            <b>Origin</b>
            Money, with the vowels taken out.
          </p>

          <a className="landing-quiet" href="https://github.com/adityadesai97/mne" target="_blank" rel="noopener noreferrer">
            View source on GitHub
          </a>
        </article>
      </main>
    </div>
  )
}
