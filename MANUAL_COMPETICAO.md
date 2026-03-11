# Manual de Utilizador — Modo Competição

Este manual descreve o fluxo recomendado para operar o modo competição no CueManager.  
Pensado para utilização rápida por operadores durante um encontro.

---

## 1) Preparação
1. Abrir a aplicação no navegador.
1. Confirmar que o modo está em **Competição** (toggle desativado).
1. Selecionar a **fonte de equipas**:
   - **PortalBilhar**: escolher competição e equipas.
   - **Manual**: introduzir nomes de equipas e jogadores.
1. Confirmar que os **logótipos** aparecem corretamente (ou os padrões se não houver ligação).

---

## 2) Selecionar jogadores do Quadro 1
1. Em **Classificação e Gestão de Quadros**, escolher 4 jogadores para **Locais** e 4 para **Visitantes**.
1. Verificar que não existem duplicados.

---

## 3) Iniciar o Quadro 1
1. Carregar **Jogar quadro**.
1. Ao iniciar o Quadro 1, os jogadores ficam bloqueados (não editáveis).

---

## 4) Enviar jogos para as mesas
1. Em cada linha do quadro, usar **Mesa 1** ou **Mesa 2** para enviar o jogo.
1. O jogo aparece na mesa com os jogadores correspondentes.
1. No fim da partida, clicar **Locais venceram** ou **Visitantes venceram**.

---

## 5) Substituições (Quadros 2–4)
1. As substituições ficam disponíveis a partir do **Quadro 2**.
1. Cada substituição tem:
   - **Sai** (jogador que sai)
   - **Entra** (jogador que entra)
   - **Confirmar**
   - **Reverter** (uma vez por substituição)
1. Só é possível avançar se todas as substituições iniciadas estiverem confirmadas.

---

## 6) Quadros 2, 3 e 4
1. Selecionar o **Quadro** no topo.
1. Confirmar se a ordem/jogadores está correta (incluindo substituições).
1. Carregar **Jogar quadro** e enviar os jogos às mesas.

---

## 7) Terminar o encontro
1. O encontro termina quando:
   - Uma equipa chega a **9 vitórias**, ou
   - Há empate **8–8** após todos os jogos.
1. Após terminar:
   - A edição é bloqueada após 10 minutos.
   - Apenas **Começar de Novo** permanece ativo.

---

## 8) Corrigir um resultado
1. No **Histórico**, mudar o vencedor no dropdown do jogo.
1. A classificação é recalculada automaticamente.
1. O jogo pode reabrir o encontro, mantendo filas/quadros como estavam.

---

## 9) Reset completo
1. Carregar **Começar de Novo** no topo.
1. Isto limpa todos os dados e reinicia o estado.

---

## Dicas rápidas
- Se não houver ligação ao PortalBilhar, o sistema muda para **Manual** automaticamente.
- Use o histórico para corrigir qualquer erro sem perder o estado atual.
- Em caso de dúvida, confira os jogos no quadro antes de os enviar para a mesa.

---

Se quiseres, posso adicionar imagens de cada secção (Gestão de Quadros, Mesas, Histórico e Substituições). Indica quais queres e em que tamanho.  

---

## OBS (Transmissão Facebook Live)
1. Abrir o **OBS Studio**.
1. Criar/selecionar a **Cena** da transmissão.
1. Em **Definições → Stream**:
   - Serviço: **Facebook Live**
   - Ligar a conta do Facebook ou colar a **Stream Key** gerada no Facebook.
1. No Facebook, abrir **Live Producer** e criar uma nova transmissão.
1. Copiar a **Stream Key** (se não estiver autenticado no OBS).
1. Voltar ao OBS e clicar **Iniciar transmissão**.
1. No Live Producer, confirmar que o sinal chegou e clicar **Go Live**.
