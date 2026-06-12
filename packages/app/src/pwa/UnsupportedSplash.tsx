/**
 * Rendered when the browser does not meet the minimum requirements to run the
 * app. Intentionally self-contained: no app store, no i18n, no router —
 * nothing that could itself fail if the environment is deficient.
 */
export function UnsupportedSplash() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        backgroundColor: '#1f1f1f',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        color: '#e0e0e0',
        padding: '24px',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          backgroundColor: '#2a2a2a',
          border: '1px solid #3a3a3a',
          borderRadius: '12px',
          padding: '40px 48px',
          maxWidth: '520px',
          width: '100%',
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: '40px', marginBottom: '16px' }}>⚠️</div>
        <h1
          style={{
            margin: '0 0 12px',
            fontSize: '22px',
            fontWeight: 600,
            color: '#f0f0f0',
          }}
        >
          Browser not supported
        </h1>
        <p style={{ margin: '0 0 20px', fontSize: '15px', lineHeight: '1.6', color: '#aaa' }}>
          ZilInventor requires features that are not available in your current browser:
          Origin Private File System (OPFS) storage and module Web Workers.
        </p>
        <div
          style={{
            backgroundColor: '#1a1a1a',
            borderRadius: '8px',
            padding: '16px 20px',
            marginBottom: '24px',
            textAlign: 'left',
          }}
        >
          <p style={{ margin: '0 0 8px', fontSize: '13px', fontWeight: 600, color: '#ccc' }}>
            Supported browsers:
          </p>
          <ul
            style={{
              margin: 0,
              paddingLeft: '18px',
              fontSize: '14px',
              lineHeight: '1.8',
              color: '#aaa',
            }}
          >
            <li>Google Chrome 86+</li>
            <li>Microsoft Edge 86+</li>
            <li>Mozilla Firefox 111+</li>
          </ul>
        </div>
        <p style={{ margin: 0, fontSize: '13px', color: '#777' }}>
          The app must also be served over HTTPS or localhost.
        </p>
      </div>
    </div>
  );
}
