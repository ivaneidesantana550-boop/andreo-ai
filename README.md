# Andreo AI

Chat AI mobile-first para criar código, sites e artefatos reais. O Andreo gera sites com ZIP e preview testável, arquivos baixáveis e pacotes de projeto para APK/EXE.

## Desenvolvimento

- `pnpm dev`: servidor de desenvolvimento; respeita `PORT` (padrão 3000).
- `pnpm build` / `pnpm start`: compilam e servem `dist/index.js` e `dist/public/`.
- `pnpm db:migrate`: aplica migrações versionadas.
- `pnpm db:push`: gera e aplica alterações do schema.
- `pnpm check` / `pnpm test`: checagem TypeScript e testes.

## Entregas

- Sites: o chat gera `index.html`, estilos e scripts, publica um preview em storage e entrega um ZIP.
- APK: o chat entrega um ZIP de projeto; `.github/workflows/build-android.yml` compila com Java 17, Android SDK e Gradle no GitHub Actions.
- EXE: o chat entrega um ZIP de projeto; `.github/workflows/build-windows.yml` compila em `windows-latest` e publica o EXE.

Consulte [`BUILD_RUNNER.md`](BUILD_RUNNER.md) para os inputs dos workflows.

## Configuração

O painel administrativo fica em `/andreo-console`. A senha é validada no servidor. O banco persiste identidade, textos do chat, system prompt, instruções e URLs de imagens.

`server/_core/publicConfig.ts` expõe somente valores públicos nomeados. Chaves privadas permanecem no servidor. O storage gerenciado serve assets em `/manus-storage/`.

A configuração da plataforma é legível e editável por `webdev.config`. Os valores padrão são iniciais, não restrições permanentes.
