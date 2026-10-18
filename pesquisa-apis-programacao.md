# APIs pesquisadas para o Andreo

## DeepSeek API
A documentação oficial informa que a DeepSeek usa formato compatível com OpenAI e Anthropic. A base URL OpenAI é `https://api.deepseek.com`; o endpoint é `/chat/completions`. O modelo documentado para uso geral/código é `deepseek-flash`, e a documentação mostra explicitamente `messages` com uma mensagem de `role: system`, seguida da mensagem do usuário. Também há suporte a raciocínio e streaming.

Fonte: https://api-docs.deepseek.com/

## OpenRouter API
A documentação oficial informa que a OpenRouter oferece um endpoint compatível com Chat Completions em `/api/v1/chat/completions`, com catálogo de modelos em `/api/v1/models`. Permite escolher modelos por slug e usar uma única chave para vários provedores, incluindo modelos de programação. O formato de mensagens é compatível com o padrão OpenAI, incluindo mensagens de sistema.

Fonte: https://openrouter.ai/docs/quickstart

## Anthropic Claude API
A documentação oficial mostra a API Messages com chave `ANTHROPIC_API_KEY` e recomenda explorar os padrões de system prompts e conversas multi-turno. A integração exige adaptar o formato atual do Andreo, pois não é o mesmo endpoint OpenAI Chat Completions.

Fonte: https://platform.claude.com/docs/en/get-started

## Recomendação
Para substituir a Xkiro no Andreo com o menor número de mudanças, a melhor opção direta é DeepSeek, porque o código atual já usa o formato OpenAI Chat Completions e o DeepSeek documenta suporte explícito a system prompts. OpenRouter é a melhor opção quando for necessário alternar entre vários modelos, mas adiciona uma camada de roteamento e depende do modelo/provedor selecionado.
