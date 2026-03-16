# ADSCR Control Panel

Painel de controlo local para jogos de bilhar, com integração OBS e PortalBilhar.

## Requisitos
- Windows 10/11 (recomendado) ou macOS/Linux
- Node.js 18+

## Como instalar
```bash
npm install
```

## Como correr
```bash
npm install
npm start
```

Abre em `http://localhost:3000`.

## Utilização rápida
1. Abrir a aplicação no browser.
1. Escolher modo (Competição ou Open).
1. Preencher equipas/jogadores e iniciar jogos nas mesas.
1. Os resultados ficam no Histórico e sincronizam a classificação.

Para detalhes do modo competição, ver `MANUAL_COMPETICAO.md`.

## Comportamento Importante
- **Ao arrancar o servidor**: faz reset do estado e limpa ficheiros OBS.
- **Ao fazer refresh no browser**: faz reset total do estado e limpa `localStorage`.

## Modos
### Competição
- Equipas a partir do PortalBilhar ou entradas manuais.
- Quadros: seleciona 4 jogadores por equipa e gera 4 jogos (1-1, 2-2, 3-3, 4-4).
- As mesas só aceitam resultado por **vitória** (1-0 ou 0-1).

### Open
- Lista livre de jogadores (um por linha).
- Fila com jogadores de qualquer lado.

## Histórico
O “Histórico” mostra os jogos concluídos por quadro e permite **alterar o resultado** (sem apagar).

## OBS Files
Os ficheiros para o OBS são escritos em pastas separadas por modo:

- `obs_files/competicao/`
- `obs_files/modo_open/`

Ficheiros gerados (por pasta):
- `nome_equipa_casa.txt`
- `nome_equipa_visitante.txt`
- `classificacao.txt`
- `mesa1_jogador_casa.txt`
- `mesa1_jogador_visitante.txt`
- `mesa2_jogador_casa.txt`
- `mesa2_jogador_visitante.txt`
- `mesa1_classificacao.txt` (usado no modo Open)
- `mesa2_classificacao.txt` (usado no modo Open)

## OBS Browser Overlay
O overlay principal está em:

- `http://localhost:3000/overlay.html`

Layouts disponíveis:

- `overlay.html` -> automático
- `overlay.html?layout=scoreboard` -> só marcador
- `overlay.html?layout=tables` -> só mesas
- `overlay.html?layout=single&table=1` -> só Mesa 1
- `overlay.html?layout=single&table=2` -> só Mesa 2

O modo automático decide assim:

- 2 jogos ativos -> vista dupla
- 1 jogo ativo -> vista de mesa única da mesa ativa
- 0 jogos ativos -> só marcador

## OBS Remote Control
Além dos ficheiros TXT/PNG, a aplicação pode controlar o OBS via WebSocket para manter as câmaras e mudar automaticamente o enquadramento.

### Pré-requisitos
- OBS Studio 28+ (o servidor WebSocket já vem incluído)
- O servidor WebSocket do OBS deve estar ativo
- O projeto deve correr na mesma máquina do OBS, ou ter acesso de rede à máquina do OBS

### Cena e fontes assumidas
O código assume estes nomes no OBS:

- Cena: `Jogo`
- Fonte vídeo 1: `Cam Mesa 1`
- Fonte vídeo 2: `Cam Mesa 2`
- Browser Source do overlay: `Overlay Browser`

Podes mudar estes nomes por variáveis de ambiente.

### Como funciona
Quando o estado das mesas muda, o backend liga-se ao OBS WebSocket e ajusta os `scene items` da cena `Jogo`:

- `split` -> `Cam Mesa 1` e `Cam Mesa 2` visíveis lado a lado
- `table1` -> `Cam Mesa 1` em destaque, `Cam Mesa 2` escondida
- `table2` -> `Cam Mesa 2` em destaque, `Cam Mesa 1` escondida
- `scoreboard` -> as duas câmaras ficam escondidas

O overlay HTML continua sempre ativo por cima.

### Variáveis de ambiente
Configuração suportada:

- `OBS_REMOTE_ENABLED` -> `true` para ativar controlo remoto
- `OBS_REMOTE_HOST` -> por omissão `127.0.0.1`
- `OBS_REMOTE_PORT` -> por omissão `4455`
- `OBS_REMOTE_PASSWORD` -> password do WebSocket do OBS
- `OBS_SCENE_NAME` -> por omissão `Jogo`
- `OBS_CAM1_SOURCE` -> por omissão `Cam Mesa 1`
- `OBS_CAM2_SOURCE` -> por omissão `Cam Mesa 2`
- `OBS_OVERLAY_SOURCE` -> por omissão `Overlay Browser`
- `OBS_CANVAS_WIDTH` -> por omissão `1920`
- `OBS_CANVAS_HEIGHT` -> por omissão `1080`
- `OBS_TOP_SAFE_HEIGHT` -> por omissão `82`
- `OBS_SPONSOR_SAFE_HEIGHT` -> por omissão `136`
- `OBS_OUTER_MARGIN` -> por omissão `20`

### Windows: exemplo de arranque
No Windows, antes de arrancar a app:

```powershell
$env:OBS_REMOTE_ENABLED="true"
$env:OBS_REMOTE_HOST="127.0.0.1"
$env:OBS_REMOTE_PORT="4455"
$env:OBS_REMOTE_PASSWORD="A_SUA_PASSWORD"
$env:OBS_SCENE_NAME="Jogo"
$env:OBS_CAM1_SOURCE="Cam Mesa 1"
$env:OBS_CAM2_SOURCE="Cam Mesa 2"
$env:OBS_OVERLAY_SOURCE="Overlay Browser"
node server.js
```

Se usares NSSM ou Task Scheduler, define estas variáveis no ambiente do processo ou cria um script `.bat`/`.ps1` que as configure antes de arrancar o `node`.

### Configuração recomendada no OBS
1. Criar a cena `Jogo`.
1. Adicionar as fontes `Cam Mesa 1` e `Cam Mesa 2`.
1. Adicionar uma `Browser Source` chamada `Overlay Browser` com:
   - URL: `http://localhost:3000/overlay.html`
   - Resolução: `1920x1080`
1. Em `Tools -> WebSocket Server Settings`:
   - ativar `Enable WebSocket server`
   - confirmar a porta `4455`
   - definir uma password

### Verificação
Depois de arrancar a app, podes confirmar o estado do controlo remoto em:

- `GET /api/obs/status`

Se o OBS não estiver acessível ou a password estiver errada, a aplicação continua a funcionar normalmente; apenas não muda o layout das câmaras no OBS.

## API (resumo)
- `GET /api/state`
- `POST /api/set-teams`
- `POST /api/set-team-scores`
- `POST /api/queue/save`
- `POST /api/table/set`
- `POST /api/table/score`
- `POST /api/table/finish`
- `POST /api/history/update`
- `POST /api/reset-all`

## Notas
- A integração com PortalBilhar usa scraping público.
- Para alterar comportamentos do UI, ver `app.js`.

---

## Windows: correr sempre ao arrancar e recuperar de falhas

### Opção recomendada: NSSM (serviço Windows)
1. Instalar o NSSM.
1. Abrir PowerShell como Administrador.
1. Criar o serviço:
   ```powershell
   nssm install CueManager
   ```
1. Na janela do NSSM:
   - **Path**: caminho para o `node.exe`
   - **Startup directory**: pasta do projeto (ex: `C:\CueManager`)
   - **Arguments**: `server.js`
1. Em **Exit actions**, escolher **Restart**.
1. Guardar e iniciar:
   ```powershell
   nssm start CueManager
   ```

Para remover:
```powershell
nssm remove CueManager confirm
```

### Opção alternativa: Agendador de Tarefas
1. Abrir **Task Scheduler**.
1. Criar tarefa “CueManager”.
1. Trigger: **At startup**.
1. Action: **Start a program**
   - Program: caminho para `node.exe`
   - Arguments: `server.js`
   - Start in: pasta do projeto
1. Ativar **Restart on failure** em “Settings”.

### Verificação rápida
Depois de iniciar o serviço/tarefa, abrir:
```
http://localhost:3000
```
