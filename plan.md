# Plano — Andreo AI

## Escopo

Construir um chat AI chamado **Andreo**, otimizado primeiro para celular, com conversa em português, respostas em Markdown, chips de ferramentas de programação e web e um ambiente de execução invisível por trás do chat para criar arquivos, sites/APK/EXE/ZIP e entregar resultados sem abrir uma aba de ambiente. O painel administrativo fica em uma URL dedicada, protegido pela senha `251831`, e altera nome, nome exibido, imagem do ícone, imagem do fundo, system prompt e instruções.

## Implementação

- **Frontend:** React + TypeScript + Tailwind, layout mobile-first com rail desktop opcional, área de conversa, composer fixo, cartões de ferramentas, Build Lab e painel admin.
- **Backend:** Express com endpoints `/api/chat`, `/api/settings`, `/api/admin/login`, `/api/admin/settings` e `/api/admin/upload-asset`. O login admin gera um token HMAC de curta duração armazenado em `sessionStorage`; a senha fica somente no servidor.
- **LLM:** reutilizar `invokeLLM` do starter, enviando system prompt + instruções persistidas + histórico recente.
- **Saída longa:** respostas podem chegar a 1.000.000 de caracteres; se o modelo encerrar uma parte por limite de tokens, o servidor solicita continuações e concatena as partes antes de responder ao cliente.
- **Persistência:** nova tabela singleton `appSettings` no Drizzle/MySQL com identidade, comportamento e URLs de assets configuráveis; imagens são enviadas para o storage durável.
- **Conteúdo administrável:** o console controla a mensagem inicial, etiqueta superior, descrição, placeholder, subtítulo da marca, rótulos de status, nomes de usuário/assistente, botão de nova sessão e as três sugestões rápidas do chat.
- **Rotas:** `/` para o chat e `/andreo-console` para o painel. O executor de projetos permanece interno ao fluxo de conversa e não é exposto como página ou aba.
- **Recursos:** servidor e banco já habilitados; o chat usa a API LLM gerenciada do Manus sem chave externa.

## Estrutura

- `client/src/pages/Home.tsx`: experiência do chat.
- `client/src/pages/AdminPanel.tsx`: autenticação, edição de configuração e upload visual.
- `client/src/pages/HomeWorkspace.tsx`: chat multimodal e ambiente integrado de projeto.
- `client/src/index.css`: tokens visuais, responsividade e superfícies.
- `server/_core/index.ts`: endpoints HTTP e montagem do servidor.
- `server/settings.ts`: leitura/escrita da configuração e autenticação admin.
- `server/chat.ts`: composição do contexto e chamada LLM.
- `drizzle/schema.ts`: tabela de configurações.
- `public/manus-routes.json`: manifesto de páginas.

## Design

### Alternativas consideradas

- **0,07 — Neon developer console:** alto contraste, brilho ciano e linguagem de IDE.
- **0,06 — Editorial AI studio:** tipografia serifada e painéis de revista.
- **0,08 — Quiet command center:** interface escura, precisa, com verde-lima como acento e blocos assimétricos.

### Direção escolhida: Quiet command center

- **Movimento:** dashboard técnico minimalista com referências de command centers e ferramentas de terminal, sem parecer uma IDE pesada.
- **Princípios:** densidade controlada, hierarquia por contraste, foco total na conversa e estados muito claros.
- **Filosofia de cor:** carvão azulado para reduzir fadiga, branco quente para leitura e verde-lima como sinal de ação/execução.
- **Paradigma de layout:** coluna de conversa central emoldurada por uma rail de contexto à esquerda no desktop; no celular, a rail vira uma faixa horizontal rolável.
- **Assinaturas:** marca “A” em bloco com corte diagonal, etiqueta `ONLINE / READY`, linhas de grid quase invisíveis.
- **Interação:** ações rápidas devem inserir contexto no composer, não abrir fluxos complexos; feedback de envio aparece imediatamente.
- **Animação:** entrada sutil de mensagens, pulso curto no estado online e transições de 150–220ms; nada decorativo competindo com o texto.
- **Tipografia:** Inter para interface e JetBrains Mono para labels de ferramenta/código.
- **Essência:** um cockpit de IA para transformar intenção em código e ação na web. Personalidade: preciso, útil, confiante.
- **Voz:** direta e orientada à ação. Exemplos: “O que vamos construir hoje?” e “Entendi o objetivo. Vou separar em passos executáveis.”
- **Wordmark:** “Andreo” com o `A` quadrado e recortado, acompanhado do status `AI / WORKSPACE`.
- **Cor proprietária:** verde-lima elétrico `#B7F34A`.
