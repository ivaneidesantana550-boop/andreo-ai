# Andreo Build Runner

O chat gera o projeto e entrega um ZIP. Os workflows deste diretório compilam esse ZIP nos runners nativos do GitHub Actions:

- `build-android.yml`: `ubuntu-latest`, Java 17, Android SDK e Gradle; publica APK debug.
- `build-windows.yml`: `windows-latest`, Node.js e `electron-builder`/script `build:win`; publica EXE.

## Execução

Os workflows são disparados por `workflow_dispatch` com `project_url` apontando para o ZIP gerado pelo endpoint `/api/chat/create-artifact` e `artifact_name` para o nome da entrega.

O runner só gera binário se o ZIP contiver o projeto nativo esperado: `gradlew` para Android ou `package.json` com `build:win`/`dist` para Windows. Caso contrário, o GitHub Actions retorna o erro de configuração em vez de entregar um arquivo inválido.
