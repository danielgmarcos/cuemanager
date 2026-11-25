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
- Jogos individuais isolados (sem quadros), ganha quem chegar primeiro a N jogos ("Jogos a", 5 por omissão; o painel não deixa passar de N).
- **Importar do PortalBilhar (provas individuais)**: escolher **Região** → **Prova** → *Carregar jogos*; filtrar por **Fase**, **Ronda** (Ronda Inicial, Vencedores 1, Perdedores 1, …), **Local** e "só jogos por jogar"; *Importar para a fila*. Todos os jogadores da prova ficam disponíveis para jogos manuais.
- Ou lista livre de jogadores (um por linha) e jogos criados à mão na fila.
- **Informação do Open** (título, jornada/detalhe, jogos a N): aparece nos overlays e nos ecrãs de início/fim; é preenchida automaticamente ao importar do portal.
- Overlays em modo Open (mesmos URLs, incluindo os `zoom`): logótipo da ADSCR Valada-Atadoa-Atadoinha, informação do Open, "Jogos a N", resultado e ronda de cada mesa, histórico com resultados.

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
- `marcador-tv.html` -> marcador de ecrã inteiro para TV/Chromecast, sincronizado com o painel, com música local e patrocinadores rotativos
- `overlay_zoom_duas_mesas.html` / `overlay_zoom_mesa1.html` / `overlay_zoom_mesa2.html` -> estilo **zoom** (`&estilo=zoom`): equipas e resultado na barra de cima, patrocinadores por baixo das mesas, nomes dos jogadores por cima da câmara e câmaras de 900x840 (mais zoom nas mesas)
- `ecra_comeca.html` -> ecrã "A transmissão começa em breve"
- `ecra_fim.html` -> ecrã "Obrigado por nos acompanhar" (com resultado final)

Os ecrãs de início/fim mostram o logótipo da equipa visitada, "Visitado vs Visitante", a competição/série/jornada do PortalBilhar e todos os patrocinadores. Títulos e tamanhos editam-se no `CONFIG` de `ecra.html`.

Todos os layouts usam o mesmo `overlay.html` (1920x1080): fundo verde com "buracos" transparentes onde entram as câmaras, painel central com equipas, logótipos e resultado, barra de jogadores em cada mesa e colunas de patrocinadores com rotação ponderada.

- Fora do OBS, as zonas de câmara aparecem tracejadas ("CÂMARA (pré-visualização)") para facilitar o alinhamento. Dentro do OBS ficam transparentes.
- Patrocinadores e pesos: lista única em `assets/overlay/patrocinadores.js` (usada pelo overlay e pelos ecrãs). Tempo da rotação: `CONFIG` em `overlay.html`. As imagens estão em `assets/overlay/`.
- Layouts de mesa única (`overlay_mesa1.html` / `overlay_mesa2.html`): mantém-se a disposição das duas mesas (resultado ao centro) e a câmara da outra mesa é substituída pelo histórico de jogos terminados, com o vencedor a verde e o derrotado a vermelho.
- O texto da competição (ex.: "Distrital de Coimbra / 3.ª Divisão, 1.ª Série · Jornada 7") vem do PortalBilhar: ao escolher competição e equipas, o servidor procura o jogo entre as duas equipas (em todas as fases/séries) e guarda-o em `state.matchInfo`. Com equipas manuais, o texto pode ser editado diretamente no overlay (no OBS: botão direito → Interagir).
- Modo Open: esconde equipas e resultado de equipas e mostra o resultado de cada mesa na barra de jogadores.

### Configuração manual recomendada no OBS
1. Criar as cenas que quiseres usar, por exemplo `2 Mesas`, `Mesa 1` e `Mesa 2`.
1. Adicionar uma `Browser Source` com:
   - URL: `http://localhost:3000/overlay_duas_mesas.html` (ou `overlay_mesa1.html` / `overlay_mesa2.html`)
   - Resolução: `1920x1080`
1. Colocar as câmaras **por baixo** da Browser Source, alinhadas com as zonas transparentes (608x1080 cada).

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
