# ADSCR Control Panel

Painel de controlo local para jogos de bilhar, com integração PortalBilhar e overlays para transmissão.

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
- **Ao arrancar o servidor**: faz reset do estado.
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

## Overlays
O overlay principal está em:

- `http://localhost:3000/overlay.html`

Layouts disponíveis:

- `overlay.html` -> duas mesas fixo (por omissão)
- `overlay_duas_mesas.html` -> duas mesas fixo
- `overlay_mesa1.html` -> Mesa 1 fixa
- `overlay_mesa2.html` -> Mesa 2 fixa
- `overlay.html?layout=scoreboard` -> só marcador

Cada overlay inclui `camera-slot` visuais para ajudar a posicionar manualmente as câmaras no OBS. O posicionamento das câmaras e a gestão de cenas ficam inteiramente do lado do OBS.

### Configuração manual recomendada no OBS
1. Criar as cenas que quiseres usar, por exemplo `2 Mesas`, `Mesa 1` e `Mesa 2`.
1. Adicionar as câmaras manualmente em cada cena.
1. Adicionar uma `Browser Source` com:
   - URL: `http://localhost:3000/overlay.html`
   - Resolução: `1920x1080`
1. Ajustar as câmaras manualmente usando as caixas `camera-slot` mostradas no overlay.

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
