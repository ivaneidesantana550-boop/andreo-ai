# TODO — Andreo AI

## Chat AI responsivo e mobile-first

- [x] Entregar uma interface de conversa chamada **Andreo**.
- [x] Adaptar a interface para uso no celular, com navegação compacta, composer acessível e ferramentas roláveis.
- [x] Exibir histórico visual de mensagens, campo de composição e estados claros de envio e resposta.
- [x] Integrar o assistente a um modelo de linguagem real para interpretar mensagens e responder conforme o system prompt e as instruções configuradas.

## Ferramentas de programação e web

- [x] Exibir e permitir acionar atalhos para ferramentas de programação e ferramentas web durante as conversas.
- [x] Incluir ferramentas como gerar código, depurar, revisar, pesquisar na web, abrir URL e extrair conteúdo como contextos rápidos do chat.

## Painel admin oculto

- [x] Disponibilizar o painel em uma URL dedicada e não exibida na navegação principal.
- [x] Proteger o acesso ao painel pela senha `251831`, validada no servidor.
- [x] Permitir alterar o nome do chat, o nome exibido, o system prompt e as instruções do assistente.
- [x] Permitir alterar o fundo e o ícone do chat.
- [x] Persistir as configurações administrativas entre sessões e atualizações.
- [x] Aplicar automaticamente as alterações na experiência do chat.

## Assets visuais por upload

- [x] Permitir enviar uma imagem real para substituir o ícone do chat.
- [x] Permitir enviar uma imagem real para substituir o fundo do chat.
- [x] Armazenar os uploads em storage durável e aplicar as URLs no chat após salvar.

## Build Lab e entregas

- [x] Manter o ambiente de projeto integrado e invisível por trás do chat, sem uma aba ou página de ambiente exposta.
- [x] Executar pedidos de site, app, sistema, APK, EXE ou projeto a partir da conversa, sem abrir um painel automático.
- [x] Entregar no próprio chat as respostas, imagens, arquivos e links de download produzidos pela execução.
- [x] Manter a estrutura interna de arquivos/build para uso do executor sem interromper a conversa.
- [ ] Conectar runners nativos de compilação para produzir binários APK/EXE e publicar sites automaticamente em produção.

## Chat multimodal e entregáveis

- [x] Permitir importar múltiplos arquivos pelo chat, armazenando-os no storage e mantendo-os anexados à mensagem.
- [x] Enviar arquivos de texto/código para o contexto do modelo e encaminhar imagens/PDFs/mídia por URL assinada quando o modelo suportar leitura multimodal.
- [x] Permitir solicitar uma imagem diretamente no composer e exibir o resultado com download.
- [x] Permitir pedir um arquivo pelo briefing, gerar seu conteúdo com o Andreo, armazená-lo e entregar um link de download.
