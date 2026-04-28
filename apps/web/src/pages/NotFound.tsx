import { Link } from 'react-router-dom';

export function NotFound() {
  return (
    <div style={{ minHeight: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', color: 'var(--txt)', padding: 24 }}>
      <div style={{ textAlign: 'center', maxWidth: 440 }}>
        <div style={{ fontSize: 96, lineHeight: 1, fontWeight: 800, color: 'var(--teal)', fontFamily: 'var(--mono)', marginBottom: 12 }}>404</div>
        <h1 style={{ fontSize: 26, fontWeight: 800, marginBottom: 8 }}>Página não encontrada</h1>
        <p style={{ color: 'var(--txt-2)', marginBottom: 22 }}>A página que você está procurando não existe</p>
        <Link to="/" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', height: 38, padding: '0 16px', borderRadius: 'var(--r)', background: 'var(--teal)', color: 'var(--on-teal)', textDecoration: 'none', fontWeight: 800 }}>
          Voltar ao início
        </Link>
      </div>
    </div>
  );
}
