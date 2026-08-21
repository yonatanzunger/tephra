// Scaffolding only. This whole file is replaced when the editor arrives; it
// exists to prove the shell works: React renders, the preload bridge reaches
// main, and the page is served from the custom scheme rather than a file or a
// localhost server.

import { useEffect, useState } from 'react'


export function App(): React.JSX.Element {
  const [hello, setHello] = useState<{ version: string; origin: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.tephra.hello().then(setHello, (e: Error) => setError(e.message))
  }, [])

  const secure = window.isSecureContext
  const scheme = location.protocol.replace(':', '')

  return (
    <main className="scaffold">
      <h1>Tephra</h1>
      <p className="sub">Nothing here yet — this is the shell proving itself.</p>
      <dl>
        <dt>origin</dt>
        <dd className={scheme === 'tephra' ? 'ok' : 'warn'}>
          {location.origin} {scheme === 'tephra' ? '' : '(dev server; production uses tephra://)'}
        </dd>
        <dt>secure context</dt>
        <dd className={secure ? 'ok' : 'bad'}>{String(secure)}</dd>
        <dt>bridge to main</dt>
        <dd className={hello ? 'ok' : error ? 'bad' : ''}>
          {hello ? `Electron ${hello.version}` : error ? error : 'asking…'}
        </dd>
      </dl>
    </main>
  )
}
