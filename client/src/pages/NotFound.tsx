import { Link } from "wouter";

export default function NotFound() {
  return <main className="admin-page auth-page"><div className="auth-card"><div className="eyebrow">404 / ROTA NÃO ENCONTRADA</div><h1>Esse caminho não existe.</h1><p>Volte ao workspace para continuar.</p><Link className="primary-button" href="/">Abrir Andreo</Link></div></main>;
}
